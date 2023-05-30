import { Address, toNano, Cell, beginCell, contractAddress, ContractProvider, OpenedContract, TonClient4} from "ton";
import { compile } from "@ton-community/blueprint";
import { SendMessageResult, Blockchain, SmartContract, BlockchainSender, BlockchainContractProvider, SandboxContract, TreasuryContract, internal, createShardAccount, BlockchainSnapshot} from "@ton-community/sandbox";
import { Message, CommonMessageInfoInternal, ShardAccount, Sender, Transaction, Dictionary } from "ton-core";
import { NominatorPool, NominatorConf } from "./wrappers/NominatorPool";
import { getRandom, randomAddress, differentAddress, LispList, buff2bigint, NominatorDesc, getRandomTon, getRandomInt, computedGeneric, getMsgExcess } from "./utils";
import { getMsgPrices, computeMessageForwardFees} from "./fees";
import { testNominatorList } from "./TestWraps";
import * as errCode from './NominatorExceptions';
import "@ton-community/test-utils";
import { ElectorTest } from "./wrappers/ElectorTest";
import { ConfigTest  } from "./wrappers/ConfigTest";
import { keyPairFromSeed, getSecureRandomBytes, getSecureRandomWords, KeyPair } from 'ton-crypto';
import { getStakeConf, getValidatorsConf, loadConfig, packStakeConf, packElectionsConf, packValidatorsConf, getVset, getElectionsConf, packValidatorsSet } from "./wrappers/ValidatorUtils";
import { flattenTransaction } from "@ton-community/test-utils";
import { Maybe } from "ton-core/dist/utils/maybe";
import { bigint2buff } from "./utils";
import { Elector } from "./wrappers/Elector";

type Validator = {
  wallet: SandboxContract<TreasuryContract>,
  keys: KeyPair
};

describe ('Nominator pool', () => {
  const minStorage			  = toNano('10');
  const depositFee 				= toNano('1')
  const minStake          = toNano('500');

  let bc:Blockchain;
  let prevState:BlockchainSnapshot;
  let snapStates:Map<string,BlockchainSnapshot>
  let electorCode:Cell;
  let configCode:Cell;
  let nmCode:Cell;
  let pool:SandboxContract<NominatorPool>;
  let elector:SandboxContract<ElectorTest>;
  let config:SandboxContract<ConfigTest>;
  let nmUser:SandboxContract<TreasuryContract>;
  let validator:SandboxContract<TreasuryContract>;
  let validatorKeys:KeyPair;
  let otherValidators:Validator[]; // Other elections participants
  let nmConf:NominatorConf;
  let sConf : ReturnType<typeof getStakeConf>;
  let vConf : ReturnType<typeof getValidatorsConf>;
  let eConf : ReturnType<typeof getElectionsConf>;
  let msgConf:ReturnType<typeof getMsgPrices>;
  let validDeposit:(minVal?:bigint) => bigint;
  let getContractData:(address: Address) => Promise<Cell>;
  let updateConfig:() => Promise<Cell>;
  let testValidatorWithdrawNeg:(exp_code:number,
                                via:Sender,
                                amount:bigint,
                                msg_val?:bigint) => Promise<void>;
  let testNewValidatorStakeNegative:(exp_code:number,
                                     via:Sender,
                                     stake_val:bigint,
                                     query_id?:bigint | number,
                                     value?:bigint) => Promise<void>;
  let runElections:(validators?:Validator[]) => Promise<void>;
  let waitNextRound:() => Promise<void>;
  let randVset:() => void;
  let loadSnapshot:(snap:string) => Promise<void>;


  beforeAll(async () => {
    jest.setTimeout(15000);
    electorCode = await compile("Elector");
    configCode  = await compile("Config");
    nmCode      = await compile("NominatorPool");
    bc          = await Blockchain.create({config: 'default'});
    [nmUser]    = await bc.createWallets(1);
    [validator] = await bc.createWallets(1,{workchain:-1});
    validatorKeys = keyPairFromSeed(await getSecureRandomBytes(32));
    const confDict = loadConfig(bc.config);
    sConf = getStakeConf(confDict);
    vConf = getValidatorsConf(confDict);
    eConf = getElectionsConf(confDict)
    const maxStakeCount     = Number(sConf.min_total_stake / toNano('500000'));
    // console.log(maxStakeCount);
    // minus one pool validator
    // Reducing required stake and validator count for performance sake
    const validatorsCount   = 10; // Math.max(maxStakeCount, vConf.min_validators) - 1;
    const validatorsWallets = await bc.createWallets(validatorsCount - 1, {workchain: -1});
    // console.log("validatorsCount:", validatorsCount);
    otherValidators = [];
    for (let i = 0; i < validatorsCount; i++) {
      otherValidators.push({
        wallet: validatorsWallets[i],
        keys: await keyPairFromSeed(await getSecureRandomBytes(32))
      });
    }

    vConf.min_validators  = validatorsCount;
    sConf.min_total_stake = BigInt(validatorsCount) * sConf.min_stake;
    confDict.set(17, packStakeConf(sConf));
    confDict.set(16, packValidatorsConf(vConf));
    // Updating config params
    bc.setConfig(beginCell().storeDictDirect(confDict).endCell());

    nmConf = {
        validatorAddress:validator.address,
        rewardShare: 0.6 * 10000, // 60% goes to validator 40% to nominators
        maxNominatorCount: 40,
        minNominatorStake: toNano('10000'),
        minValidatorStake: sConf.min_stake
    };


    msgConf = getMsgPrices(bc.config, -1);
    validDeposit = (minVal:bigint = nmConf.minNominatorStake) => {
      if(minVal < nmConf.minNominatorStake)
        minVal = nmConf.minNominatorStake;
      return minVal + depositFee + getRandomTon(1, 100);
    };

    getContractData = async (address: Address) => {
      const smc = await bc.getContract(address);
      if(!smc.account.account)
        throw("Account not found")
      if(smc.account.account.storage.state.type != "active" )
        throw("Atempting to get data on inactive account");
      if(!smc.account.account.storage.state.state.data)
        throw("Data is not present");
      return smc.account.account.storage.state.state.data
    }

    runElections = async (validators: Validator[] = otherValidators) => {
      let electState  = await elector.getParticipantListExtended();
      const partCount = electState.list.length;
      let curStake    = electState.total_stake;
      let stakeSize   = sConf.min_stake + toNano('1');
      let i           = 0;

      while(i < validators.length
            && (curStake < sConf.min_total_stake || i + partCount < vConf.min_validators)) {
        const validator = validators[i++];
        const res       = await elector.sendNewStake(validator.wallet.getSender(),
                                                     stakeSize,
                                                     validator.wallet.address,
                                                     validator.keys.publicKey,
                                                     validator.keys.secretKey,
                                                     electState.elect_at);
        expect(res.transactions).not.toHaveTransaction({
          from: elector.address,
          to: validator.wallet.address,
          op: 0xee6f454c
        });
        curStake += stakeSize;
      }

      // Skipping time till elections
      bc.now    = electState.elect_at;
      // Run elections
      const res = await elector.sendTickTock("tock");

      /*
       * TODO fix test-utils for non generic transactions
      expect(res.transactions).toHaveTransaction({
        from: elector.address,
        to: config.address
        ...
      });
      */
      // console.log(res.transactions[0].vmLogs);
      electState     = await elector.getParticipantListExtended();
      expect(electState.finished).toBe(true);
      await updateConfig();

    }

    waitNextRound = async () => {
      const nextVset = getVset(bc.config, 36);
      // Setting vset
      bc.now = nextVset.utime_since;
      await config.sendTickTock("tock");
      const newConf = await updateConfig();
      // Should change to the current vset
      const newVset = getVset(newConf, 34);
      expect(newVset).toEqual(nextVset);
    }
    loadSnapshot = async (name:string) => {
      const state = snapStates.get(name);
      if(!state)
        throw(Error(`Can't find state ${name}\nCheck tests execution order`));
      await bc.loadFrom(state);
    }

    const electorAddress = Address.parse('Ef8zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM0vF');
    const configAddress  = Address.parse('Ef9VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVbxn');

    // Loading config from config contract
    updateConfig = async () => {
      const confData = await getContractData(configAddress);
      const confCell = confData.beginParse().preloadRef();
      bc.setConfig(confCell);
      return confCell;
    }

    randVset = () => {
      const vset = getVset(bc.config, 34);
      if(!bc.now)
        bc.now = Math.floor(Date.now() / 1000);
      vset.utime_since = bc.now
      vset.utime_unitl = vset.utime_since + eConf.elected_for;
      bc.now += 100;
      confDict.set(34, packValidatorsSet(vset));
      bc.setConfig(beginCell().storeDictDirect(confDict).endCell());
    }

    // There is no tick_tock support, so we dance around
    await bc.setShardAccount(electorAddress, createShardAccount({
      address: electorAddress,
      code: electorCode,
      //data: ElectorTest.electionsAnnounced(bc.config),
      data: ElectorTest.emptyState(buff2bigint(confDict.get(34)!.hash())),
      balance: toNano('1000')
    }));

    await bc.setShardAccount(configAddress, createShardAccount({
      address: configAddress,
      code: configCode,
      data: ConfigTest.configState(bc.config),
      balance: toNano('1000')
    }));

    config  = bc.openContract(ConfigTest.createFromAddress(configAddress));
    elector = bc.openContract(ElectorTest.createFromAddress(electorAddress));
    // Should announce elections
    await elector.sendTickTock("tick");
    /*
    const electorShard: ShardAccount = {
      account: {
        addr: electorAddress,
        storage: {
          lastTransLt: 0n,
          balance: {coins: toNano('1000')},
          state: {
            type: 'active',
            state: {
              special: {tick: true, tock:true},
              code: electorCode,
              data: elector.init!.data,
            }
          }
        },
        storageStats: {
          used: {
            cells: 0n,
            bits: 0n,
            publicCells: 0n,
          },
          lastPaid: 0,
          duePayment: null
        }
      },
      lastTransactionLt: 0n,
      lastTransactionHash: 0n
    }
    */

    pool  = bc.openContract(NominatorPool.createFromConfig(nmConf, nmCode))
    await pool.sendDeploy(nmUser.getSender(), minStorage + toNano('1'));

    testValidatorWithdrawNeg = async (exp_code:number,
                                      via:Sender,
                                      amount:bigint,
                                      msg_val:bigint = toNano('0.5')) => {
      const dataBefore = await getContractData(pool.address);
      const res        = await pool.sendValidatorWithdraw(via, amount, msg_val);

      expect(res.transactions).toHaveTransaction({
        from: via.address,
        to: pool.address,
        success: false,
        exitCode: exp_code
      });

      const dataAfter = await getContractData(pool.address);
      expect(dataBefore.equals(dataAfter)).toBe(true);
    };

    testNewValidatorStakeNegative = async (exp_code: number,
                                  via:Sender,
                                  stake_val:bigint,
                                  query_id:bigint | number = 1,
                                  value:bigint = toNano('1')) => {
      const dataBefore = await getContractData(pool.address);
      const electId    = await elector.getActiveElectionId();
      const res        = await pool.sendNewStake(via,
                                                 stake_val,
                                                 validatorKeys.publicKey,
                                                 validatorKeys.secretKey,
                                                 electId,
                                                 1 << 16,
                                                 0n,
                                                 query_id,
                                                 value)
      expect(res.transactions).toHaveTransaction({
        from: via.address,
        to: pool.address,
        success: exp_code == 0,
        exitCode: exp_code,
      });
      if(exp_code != 0) {
        expect(res.transactions).not.toHaveTransaction({
          from: pool.address,
          to: elector.address
        });
        const dataAfter = await getContractData(pool.address);
        expect(dataBefore.equals(dataAfter)).toBe(true);
      }
      else {
        expect(res.transactions).toHaveTransaction({
          from: pool.address,
          to: elector.address
        });
      }
    };

    // Saving initial state
    prevState  = bc.snapshot();
    snapStates = new Map<string, BlockchainSnapshot>();
  });

  afterEach(async () => {
    // rolling back to initial state every test
    await bc.loadFrom(prevState);
  });

  it('Nominator deposit not basechain', async () => {
    const mcAddr = randomAddress(-1);
    const bcAddr = new Address(0, mcAddr.hash);

    const minVal = validDeposit();
    let   nm     = bc.sender(mcAddr);
    let   res    = await pool.sendNmDeposit(nm, minVal);

    expect(res.transactions).toHaveTransaction({
      from: nm.address,
      to: pool.address,
      success: false,
      exitCode: errCode.wrongBc
    });

    nm           = bc.sender(bcAddr);
    res          = await pool.sendNmDeposit(nm, minVal);

    expect(res.transactions).toHaveTransaction({
      from: nm.address,
      to: pool.address,
      value: minVal,
      success: true,
      exitCode: 0
    });

  });

  it('Nominator deposit from validator', async () => {

    const minVal = validDeposit();

    // Address matching validator but on basechain
    const vldtrAddr = new Address(0, nmConf.validatorAddress.hash);
    let   nm        = bc.sender(vldtrAddr);
    let   res       = await pool.sendNmDeposit(nm, minVal);

    expect(res.transactions).toHaveTransaction({
      from: nm.address,
      to: pool.address,
      value: minVal,
      success: false,
      exitCode: errCode.wrongAddr
    });

    const goodAddr = differentAddress(vldtrAddr);
    nm             = bc.sender(goodAddr);
    res            = await pool.sendNmDeposit(nm, minVal);

    expect(res.transactions).toHaveTransaction({
      from: nm.address,
      to: pool.address,
      value: minVal,
      success: true
    });

  });


  it('Nominator deposit lower than deposit fee', async () => {

    const addr   = randomAddress();
    const nm     = bc.sender(addr);
    const delta  = BigInt(getRandomInt(1, Number(depositFee) / 2));
    const lowVal = depositFee - delta;

    let   res    = await pool.sendNmDeposit(nm, lowVal);

    expect(res.transactions).toHaveTransaction({
      from: nm.address,
      to: pool.address,
      value: lowVal,
      success: false,
      exitCode: errCode.lowerDepositFee
    });

    const goodVal = validDeposit();
    res           = await pool.sendNmDeposit(nm, goodVal);

    expect(res.transactions).toHaveTransaction({
      from: nm.address,
      to: pool.address,
      value: goodVal,
      success: true
    });

  });

  it('Nominator deposit lower than min nominator stake', async() => {

    const nm     = bc.sender(randomAddress());

    const minVal = nmConf.minNominatorStake + depositFee;
    const lowVal = minVal - BigInt(getRandomInt(1, Number(toNano('1'))));

    let   res    = await pool.sendNmDeposit(nm, lowVal);

    expect(res.transactions).toHaveTransaction({
      from: nm.address,
      to: pool.address,
      value: lowVal,
      success: false,
      exitCode: errCode.lowNominatorStake
    });

    res = await pool.sendNmDeposit(nm, minVal);

    expect(res.transactions).toHaveTransaction({
      from: nm.address,
      to: pool.address,
      value: minVal,
      success: true
    });

  });

  it('Nominator deposit success', async() => {

    const nm   = nmUser.getSender();

    const depoCount = getRandomInt(2, 10);
    const hash      = buff2bigint(nmUser.address.hash);

    const poolData  = await pool.getPoolData();
    let   totalDepo = 0n;

    for (let i = 0; i < depoCount; i++) {
      const depo = validDeposit();
      const res  = await pool.sendNmDeposit(nm, depo);
      const expDepo = depo - depositFee;
      totalDepo    += expDepo;
      const expNominator = new NominatorDesc(
        hash,
        totalDepo,
        0n,
        false
      );

      const resNm = await pool.getNominatorData(hash);

      expect(resNm.eq(expNominator)).toBe(true);

      await testNominatorList(pool, [resNm]);
    }
    // Saving success deposit state
    snapStates.set('nmDeposit', bc.snapshot());
  });

  it('Trigger max nominator count', async () =>{
    await loadSnapshot('nmDeposit');
    let poolData = await pool.getPoolData();

    let i = nmConf.maxNominatorCount - poolData.nmCount;
    let nmList : NominatorDesc[] = [];

    while (i--) {
      const depo    = validDeposit();
      const expDepo = depo - depositFee;
      const newSend = bc.sender(randomAddress(0));
      const newNm   = new NominatorDesc(
          buff2bigint(newSend.address!.hash),
          expDepo,
          0n,
          false
        );

       const res   = await pool.sendNmDeposit(newSend, depo);

       expect(res.transactions).toHaveTransaction({
         from: newSend.address,
         to: pool.address,
         value: depo,
         success: true
       });

       const resNm = await pool.getNominatorData(newNm.hash);
       expect(resNm.eq(newNm)).toBe(true);

       nmList.push(newNm);

    }

    poolData = await pool.getPoolData();
    expect(poolData.nmCount).toEqual(nmConf.maxNominatorCount);
    const lastDepo = validDeposit();
    const lastSend = bc.sender(randomAddress());
    const res      = await pool.sendNmDeposit(lastSend, lastDepo);
    expect(res.transactions).toHaveTransaction({
      from: lastSend.address,
      to: pool.address,
      value: lastDepo,
      success: false,
      exitCode: errCode.tooManyNominators,
    });

    await testNominatorList(pool, nmList);

    snapStates.set('nmDepositFull', bc.snapshot());
  });

  it('Nominator withdraw not found', async () => {
    // Using deposited state
    await loadSnapshot('nmDeposit');
    const amount  = validDeposit();
    const msgVal  = toNano('0.5');
    const badNm   = bc.sender(differentAddress(nmUser.address));
    let   res     = await pool.sendNmWithdraw(badNm, msgVal);

    expect(res.transactions).toHaveTransaction({
      from: badNm.address,
      to: pool.address,
      value: msgVal,
      success: false,
      exitCode: errCode.notFound
    });
  });

  it('Nominator withdraw success', async() => {
    await loadSnapshot('nmDepositFull');
    const amount  = validDeposit();
    const msgVal  = toNano('0.5');
    const hash    = buff2bigint(nmUser.address.hash);
    // Nominators without the nmUser (We want to keep it for other tests)
    const nms     = (await pool.getNominatorsList()).filter(x => x.hash != hash);;
    // Pick at random
    const testNm  = nms[getRandomInt(0, nms.length - 1)];
    const nmAddr  = new Address(0, bigint2buff(testNm.hash))
    const sender  = bc.sender(nmAddr);
    let expDepo   = testNm.balance;
    const res     = await pool.sendNmWithdraw(sender, msgVal);

    const targetTrans = res.transactions[0];
    expect(targetTrans.outMessagesCount).toBe(2);
    const withdrawMsg = targetTrans.outMessages.get(0)!;
    const excessMsg   = targetTrans.outMessages.get(1)!;

    expect(res.transactions).toHaveTransaction({
      from:nmAddr,
      to: pool.address,
      outMessagesCount: 2,
      success: true
    });

    const msgFees = computeMessageForwardFees(msgConf, withdrawMsg);
    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: nmAddr,
      value: expDepo - msgFees.fees - msgFees.remaining,
    });

    const excess  = getMsgExcess(targetTrans, excessMsg, msgVal, msgConf);
    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: nmAddr,
      value: excess
    });
    /*
     Deposit back
     await pool.sendNmDeposit(nmUser.getSender(), curData.balance);
    */

    snapStates.set('hasFreeSpot', bc.snapshot());
  });

  it('Validator stake can only be submited from masterchain', async() => {
    const validatorBase = new Address(0, validator.address.hash);
    const dataBefore = await getContractData(pool.address);
    const res = await pool.sendValidatorDeposit(bc.sender(validatorBase), nmConf.minValidatorStake);
    expect(res.transactions).toHaveTransaction({
      from: validatorBase,
      to: pool.address,
      success: false,
      exitCode: 73
    });

    const dataAfter = await getContractData(pool.address);
    expect(dataBefore.equals(dataAfter)).toBe(true);
  });

  it('Not validator should be able to deposit on validator behalf', async() => {
    const randWallet = randomAddress(-1);
    const dataBefore = await getContractData(pool.address);
    const res = await pool.sendValidatorDeposit(bc.sender(randWallet), nmConf.minValidatorStake);
    expect(res.transactions).toHaveTransaction({
      from: randWallet,
      to: pool.address,
      success: false,
      exitCode: 73
    });

    const dataAfter = await getContractData(pool.address);
    expect(dataBefore.equals(dataAfter)).toBe(true);
  });

  it('Validator deposit should exceed deposit fee', async() => {
    const dataBefore = await getContractData(pool.address);
    let res = await pool.sendValidatorDeposit(validator.getSender(), depositFee);
    expect(res.transactions).toHaveTransaction({
      from: validator.address,
      to: pool.address,
      success: false,
      exitCode: 74
    });
    expect(res.transactions).not.toHaveTransaction({
      from: pool.address,
      to: elector.address
    });

    const dataAfter = await getContractData(pool.address);
    expect(dataBefore.equals(dataAfter)).toBe(true);
    res = await pool.sendValidatorDeposit(validator.getSender(), depositFee + 1n);
    expect(res.transactions).toHaveTransaction({
      from: validator.address,
      to: pool.address,
      success: true
    });
  });

  it('Validator should be able to deposit to pool', async () => {
    await loadSnapshot('hasFreeSpot');
    const deposit = nmConf.minValidatorStake * 2n + getRandomTon(100, 1000);
    let   poolSmc = await bc.getContract(pool.address);
    const balanceBefore = poolSmc.balance;
    const dataBefore = await pool.getPoolData();
    const res = await pool.sendValidatorDeposit(validator.getSender(), deposit + depositFee);
    poolSmc   = await bc.getContract(pool.address);
    // console.log(res.transactions[1].totalFees.coins);
    // expect(poolSmc.balance).toEqual(balanceBefore + deposit + conf.depositFee - computedGeneric(res.transactions[1]).gasFees);
    const dataAfter = await pool.getPoolData();
    expect(dataAfter.validatorAmount).toEqual(dataBefore.validatorAmount + deposit);
    snapStates.set('validatorDeposit', bc.snapshot());
  });

  it('Validator share widthdraw should be possible from validator address only', async () => {

    await loadSnapshot('validatorDeposit');
    const poolData   = await pool.getPoolData();
    const randWallet = differentAddress(validator.address);
    await testValidatorWithdrawNeg(75, bc.sender(randWallet), poolData.validatorAmount / 2n);
  });
  it('Validator share widthdraw should be possible from masterchain', async () => {
    await loadSnapshot('validatorDeposit');
    const poolData   = await pool.getPoolData();
    const bcValidator = new Address(0, validator.address.hash);
    await testValidatorWithdrawNeg(75, bc.sender(bcValidator), poolData.validatorAmount / 2n);
  });
  it('Validator withdraw request amount should be > 0', async () => {
    await loadSnapshot('validatorDeposit');
    const poolData   = await pool.getPoolData();
    await testValidatorWithdrawNeg(78, validator.getSender(), 0n);
  });
  it('Validator can withdraw everything except min_storage + nominators share', async() => {
    await loadSnapshot('validatorDeposit');
    const nmStake = await pool.getNominatorsStake();
    const poolSmc = await bc.getContract(pool.address);
    const msgVal  = toNano('0.5');
    // message value is creditated to balance
    const maxWithdraw = poolSmc.balance + msgVal - minStorage - nmStake;
    await testValidatorWithdrawNeg(76, validator.getSender(), maxWithdraw + 1n, msgVal);
  });


  it('Validator should be able to withdraw from pool', async () => {
    await loadSnapshot('validatorDeposit');
    const poolData = await pool.getPoolData();
    const req      = poolData.validatorAmount / 2n;
    const msgVal   = toNano('0.5');
    const res      = await pool.sendValidatorWithdraw(validator.getSender(), req, msgVal);
    const targetTrans = res.transactions[1];
    expect(res.transactions[1].outMessagesCount).toBe(2);
    const withdrawMsg = targetTrans.outMessages.get(0)!;
    const excessMsg   = targetTrans.outMessages.get(1)!;
    const msgFees     = computeMessageForwardFees(msgConf, withdrawMsg);

    const excess  = getMsgExcess(targetTrans, excessMsg, msgVal, msgConf);

    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: validator.address,
      value: req - msgFees.fees - msgFees.remaining
    });

    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: validator.address,
      value: excess
    });
  });

  it('Not validator should not be able to deposit to elector', async() => {
    await loadSnapshot('validatorDeposit');
    const deposit    = nmConf.minValidatorStake;
    const randWallet = randomAddress(-1);
    await testNewValidatorStakeNegative(78, bc.sender(randWallet), deposit);
  });

  it('Elector deposit should only be possible from masterchain', async() =>{
    await loadSnapshot('validatorDeposit');
    const deposit    = nmConf.minValidatorStake;
    const bcValidator= new Address(0, validator.address.hash);
    await testNewValidatorStakeNegative(78, bc.sender(bcValidator), deposit);
  });

  it('Pool should only accept new elector stake with confirmation', async() =>{
    await loadSnapshot('validatorDeposit');
    const deposit    = nmConf.minValidatorStake;
    // 0 query id means no confirmation
    await testNewValidatorStakeNegative(80, validator.getSender(), deposit, 0);
  });

  it('New stake message value should exceed elector fee', async () => {
    await loadSnapshot('validatorDeposit');
    const deposit    = nmConf.minValidatorStake;
    await testNewValidatorStakeNegative(86, validator.getSender(), deposit, 1234, toNano('0.99'));
  });

  it('New stake should exceed minimal stake', async () => {
    await loadSnapshot('validatorDeposit');
    // 500 is a minimal stake
    const deposit = minStake - 1n;
    await testNewValidatorStakeNegative(81, validator.getSender(), deposit);
  });

  it('Balance after new stake should be >= min_storage', async() => {
    await loadSnapshot('validatorDeposit');
    const poolSmc = await bc.getContract(pool.address);
    const msgVal  = toNano('1');
    // msgVal is added to balance in compute phase
    const deposit = poolSmc.balance + msgVal - minStorage + 1n;
    await testNewValidatorStakeNegative(82, validator.getSender(), deposit, 1234, msgVal);
  });

  it('Validator stake has to be >= min_validator_stake prior to elector deposit', async() => {
    await loadSnapshot('validatorDeposit');
    let   poolData = await pool.getPoolData();
    const withdraw = poolData.validatorAmount - nmConf.minValidatorStake + 1n;

    if(withdraw > 0n) {
      await pool.sendValidatorWithdraw(validator.getSender(), withdraw);
      poolData.validatorAmount -= withdraw;
    }

    const deposit = poolData.validatorAmount + (await pool.getNominatorsStake());
    await testNewValidatorStakeNegative(83, validator.getSender(), deposit);
    /*
    // Deposit back if needed
    if(withdraw > 0n)
      await pool.sendValidatorDeposit(validator.getSender(), withdraw);
    */
  });

  it('Pool should recover state when stake is rejected by elector', async () => {
    await loadSnapshot('validatorDeposit');
    let poolData = await pool.getPoolData();
    if(poolData.state != 0)
      throw("Expect 0 state");
    const electId = await elector.getActiveElectionId();
    // Let's vote on wrong elections so elector would reject the stake
    const res = await pool.sendNewStake(validator.getSender(),
                                        nmConf.minValidatorStake,
                                        validatorKeys.publicKey,
                                        validatorKeys.secretKey,
                                        electId + 1);
    expect(res.transactions).toHaveTransaction({
      from: elector.address,
      to: pool.address,
      op: 0xee6f454c
    });
    poolData = await pool.getPoolData();
    expect(poolData.state).toBe(0);
  });
  it('Stake ok/err message should only be accepted from elector', async() => {
    await loadSnapshot('validatorDeposit');
    const deposit = nmConf.minValidatorStake;
    const electAt = await elector.getActiveElectionId();
    expect(electAt).not.toEqual(0);
    // Send message should execute just one tx and not the whole chain
    const poolSmc = await bc.getContract(pool.address);
    const newStakeBody = NominatorPool.newStakeMessage(deposit,
                                                       pool.address,
                                                       validatorKeys.publicKey,
                                                       validatorKeys.secretKey,
                                                       electAt,
                                                       1 << 16,
                                                       0n);
    await poolSmc.receiveMessage(internal({
      from: validator.address,
      to: pool.address,
      body: newStakeBody,
      value: toNano('1')
    }))
    const poolBefore = await pool.getPoolData();
    // Expect transit state
    expect(poolBefore.state).toEqual(1);
    // snapStates.set('transit', bc.snapshot());
    const transit    = bc.snapshot();
    const dataBefore = await getContractData(pool.address);
    const notElector = differentAddress(elector.address);
    const stakeOk    = beginCell().storeUint(0xf374484c, 32).storeUint(0, 64).endCell();
    const stakeErr    = beginCell().storeUint(0xee6f454c, 32).storeUint(0, 64).endCell();
    const testStakeMsg = async (body:Cell, state:number) => {
      let   res        = await bc.sendMessage(internal({
        from: notElector,
        to: pool.address,
        body,
        value: toNano('1')
      }));
      expect(res.transactions).toHaveTransaction({
        from:notElector,
        to: pool.address,
        success: false,
        exitCode: 70
      });
      expect(await getContractData(pool.address)).toEqualCell(dataBefore);
      res  = await bc.sendMessage(internal({
        from: elector.address,
        to: pool.address,
        body,
        value: toNano('1')
      }));
      expect(res.transactions).toHaveTransaction({
        from:elector.address,
        to: pool.address,
        success: true,
      });
      // Should successfully change the state
      let poolAfter = await pool.getPoolData();
      expect(poolAfter.state).toEqual(state);
    };
    await testStakeMsg(stakeOk, 2);
    // Rolling back to test error message
    await bc.loadFrom(transit)
    // Should switch to initial state on successufll stake error
    await testStakeMsg(stakeErr, 0);

    // Let's test for special case when new_stake message has bounced from elector
    await bc.loadFrom(transit);
    const bouncedBody = beginCell().storeUint(0xFFFFFFFF,32).storeSlice(newStakeBody.beginParse()).endCell()
    await bc.sendMessage(internal({
      from: notElector,
      to: pool.address,
      // Bounced prefix
      body: bouncedBody,
      value: toNano('1'),
      bounced: true
    }));
    expect(await getContractData(pool.address)).toEqualCell(dataBefore);
    // Now test successfull
    await bc.sendMessage(internal({
      from: elector.address,
      to: pool.address,
      // Bounced prefix
      body: bouncedBody,
      value: toNano('1'),
      bounced: true
    }));
    // Should switch back to initial state
    expect((await pool.getPoolData()).state).toEqual(0);
  })

  it('Validator should be able to submit new stake to elector', async() => {
    await loadSnapshot('validatorDeposit');
    let poolData    = await pool.getPoolData();
    expect(poolData.state).toBe(0);
    const nmList      = await pool.getNominatorsList();
    let   totalStaked = (await pool.getNominatorsStake()) + poolData.validatorAmount;

    if(totalStaked < nmConf.minValidatorStake + minStorage){
      const topUp = nmConf.minValidatorStake - totalStaked + depositFee;
      await pool.sendValidatorDeposit(validator.getSender(), topUp);
      totalStaked += topUp - depositFee;
    }

    const electId = await elector.getActiveElectionId();
    const res = await pool.sendNewStake(validator.getSender(),
                                        totalStaked,
                                        validatorKeys.publicKey,
                                        validatorKeys.secretKey,
                                        electId);
    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: elector.address,
      value: totalStaked,
      success: true
    });
    // No stake return
    expect(res.transactions).not.toHaveTransaction({
      from: elector.address,
      to: pool.address,
      op: 0xee6f454c
    });
    // Confirmation
    expect(res.transactions).toHaveTransaction({
      from: elector.address,
      to: pool.address,
      op: 0xf374484c
    });

    const expStake = totalStaked - toNano('1');
    const stake = await elector.getStake(validatorKeys.publicKey);
    expect(stake).toEqual(expStake);

    poolData      = await pool.getPoolData();
    const config  = loadConfig(bc.config);
    expect(poolData.state).toEqual(2);
    expect(poolData.validatorSetHash).toEqual(buff2bigint(config.get(34)!.hash()));
    const curVset = getVset(config, 34);
    expect(poolData.validatorSetChangesCnt).toBe(0);
    expect(poolData.stakeAmountSent).toEqual(expStake);
    expect(poolData.validatorSetChangeTime).toEqual(curVset.utime_since);
    expect(poolData.stakeHeldFor).toEqual(eConf.stake_held_for);
    // Saving staked state
    snapStates.set('staked', bc.snapshot());
  });

  it('Validator should not submit new stake if previous is not recovered', async() => {

    await loadSnapshot('staked');
    let poolData = await pool.getPoolData();
    const totalPooled = poolData.validatorAmount + (await pool.getNominatorsStake());
    /*
     * Pre snapshot code
    if(poolData.state !== 2) {
      if(poolData.state == 0) {
        const electId     = await elector.getActiveElectionId();
        await pool.sendNewStake(validator.getSender(),
                                nmConf.minValidatorStake,
                                validatorKeys.publicKey,
                                validatorKeys.secretKey,
                                electId);
        poolData = await pool.getPoolData();
      }
      else {
        throw("Caught in the middle(state 1)");
      }
    }
    */
    expect(poolData.state).toBe(2);
    await testNewValidatorStakeNegative(79, validator.getSender(), nmConf.minValidatorStake);

  });
  it('Deposit in "staked" state should go to pending deposits', async() => {
    await loadSnapshot('staked');
    const uHash      = buff2bigint(nmUser.address.hash);
    const depoBefore = await pool.getNominatorData(uHash);
    const deposit    = validDeposit();
    await pool.sendNmDeposit(nmUser.getSender(), deposit);
    const nmAfter = await pool.getNominatorData(uHash);
    expect(nmAfter.pending).toEqual(depoBefore.pending + deposit - depositFee);
    snapStates.set('pending_deposit', bc.snapshot());
  });

  it('Withdraw in "staked" state should go to withdraw requests', async() => {
    await loadSnapshot('staked');
    const uHash = buff2bigint(nmUser.address.hash);
    const msgVal = toNano('1');
    const res   = await pool.sendNmWithdraw(nmUser.getSender(), msgVal);
    const nmAfter = await pool.getNominatorData(uHash);
    const poolData = await pool.getPoolData();
    expect(nmAfter.withdraw).toBe(true);
    expect(poolData.withdrawReq).not.toBeNull();
    expect(poolData.withdrawReq!.get(uHash)).not.toBe(null);
    // excess
    const trans = res.transactions[1];
    expect(trans.outMessagesCount).toEqual(1);
    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: nmUser.address,
      value: getMsgExcess(trans, trans.outMessages.get(0)!, msgVal, msgConf )
    });
    // Saving stat with pending withdraws
    snapStates.set('staked_pending', bc.snapshot());
  });
  it('Should update validators set', async () => {
    await loadSnapshot('staked');
    const dataBefore = await pool.getPoolData();
    let confDict   = loadConfig(bc.config);
    expect(dataBefore.validatorSetHash).toEqual(buff2bigint(confDict.get(34)!.hash()))
    const msgVal    = toNano('1');
    let res = await pool.sendVsetUpdate(nmUser.getSender(), msgVal);
    let dataAfter = await pool.getPoolData();
    // Should not change since set didn't change
    expect(dataAfter.validatorSetHash).toEqual(dataBefore.validatorSetHash);
    expect(dataAfter.validatorSetChangeTime).toEqual(dataBefore.validatorSetChangeTime);
    expect(dataAfter.validatorSetChangesCnt).toEqual(dataBefore.validatorSetChangesCnt);

    await runElections();
    await waitNextRound();
    // Reload new config
    confDict = loadConfig(bc.config)
    // vset should change
    expect(dataBefore.validatorSetHash).not.toEqual(buff2bigint(confDict.get(34)!.hash()))
    bc.now = Math.floor(Date.now() / 1000);
    res = await pool.sendVsetUpdate(nmUser.getSender(), msgVal);
    dataAfter = await pool.getPoolData();

    expect(dataAfter.validatorSetChangesCnt).toEqual(dataBefore.validatorSetChangesCnt + 1);
    expect(dataAfter.validatorSetChangeTime).toEqual(bc.now);
    expect(dataAfter.validatorSetHash).toEqual(buff2bigint(confDict.get(34)!.hash()));

    const trans = res.transactions[1];
    expect(trans.outMessagesCount).toEqual(1);
    const excessMsg = trans.outMessages.get(0)!;
    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: nmUser.address,
      value: getMsgExcess(trans, excessMsg, msgVal, msgConf)
    });
  });

  it('Should not update vset more than 3 times till stake recovery', async () => {
    await loadSnapshot('staked');
    const confDict = loadConfig(bc.config);
    const dataBefore = await pool.getPoolData();
    expect(dataBefore.validatorSetChangesCnt).toBe(0);
    for(let i = 0; i < 3;) {
      randVset();
      await pool.sendVsetUpdate(nmUser.getSender());
      expect((await pool.getPoolData()).validatorSetChangesCnt).toEqual(++i);
    }

    randVset();
    const res   = await pool.sendVsetUpdate(nmUser.getSender());
    expect(res.transactions).toHaveTransaction({
      from: nmUser.address,
      to: pool.address,
      success: false,
      exitCode: 113
    });
  });
  it('At least 2 validators set changes and stake_held_for time is required to trigger recover stake', async () =>{
    await loadSnapshot('staked_pending');
    let poolData = await pool.getPoolData();
    expect(poolData.validatorSetChangesCnt).toEqual(0);
    // this will set up vset with our pool amongst participants
    await runElections();
    await waitNextRound();
    const recoverTrans = {
      from: pool.address,
      to: elector.address,
      body: NominatorPool.recoverStakeMessage()
    };

    for(let i = 0; i < 2; i++) {
      let res = await pool.sendRecoverStake(nmUser.getSender());
      randVset();
      expect(res.transactions).toHaveTransaction({
        from: nmUser.address,
        to: pool.address,
        success: false,
        exitCode: 111
      });
      expect(res.transactions).not.toHaveTransaction(recoverTrans);
      // Next vset
      //randVset()
      await pool.sendVsetUpdate(nmUser.getSender());
    }
    poolData = await pool.getPoolData();
    expect(poolData.validatorSetChangesCnt).toEqual(2);
    // Saving state
    const twoRounds = bc.snapshot();
    let   res       = await pool.sendRecoverStake(nmUser.getSender());
    // Now we ither need to wait till unfreeze or have 3 set changes.
    expect(res.transactions).toHaveTransaction({
      from: nmUser.address,
      to: pool.address,
      success: false,
      exitCode: 112
    });
    expect(res.transactions).not.toHaveTransaction(recoverTrans);
    // Let's wait first
    const vSet = getVset(bc.config, 34);
    bc.now = vSet.utime_unitl + eConf.stake_held_for + 60;
    // Saving for later use
    snapStates.set('recover_ready', bc.snapshot());
    res    = await pool.sendRecoverStake(nmUser.getSender());
    expect(res.transactions).toHaveTransaction({
      from: nmUser.address,
      to: pool.address,
      success: true
    });
    expect(res.transactions).toHaveTransaction(recoverTrans);
    // Roll back to test > 2 vset's would allow recover
    await bc.loadFrom(twoRounds);
    randVset();
    await pool.sendVsetUpdate(nmUser.getSender());
    poolData = await pool.getPoolData();
    expect(poolData.validatorSetChangesCnt).toEqual(3);
    res    = await pool.sendRecoverStake(nmUser.getSender());
    expect(res.transactions).toHaveTransaction({
      from: nmUser.address,
      to: pool.address,
      success: true
    });
    expect(res.transactions).toHaveTransaction(recoverTrans);
  });
  it('Should recover stake successfully', async () => {
    await loadSnapshot('recover_ready');
    const poolBefore = await pool.getPoolData();
    expect(poolBefore.state).toEqual(2);
    let   retStake:bigint;
    // Top up elector with fees
    await bc.sendMessage(internal({
      from: new Address(-1, Buffer.alloc(32, 0)),
      to: elector.address,
      body: beginCell().endCell(),
      value: toNano('100000'),
    }));
    // Waiting unfreeze check
    do {
      retStake = await elector.getReturnedStake(pool.address);
      await elector.sendTickTock("tock");
    } while(retStake != poolBefore.stakeAmountSent);
    const msgVal = toNano('1');
    const res    = await pool.sendRecoverStake(nmUser.getSender(), msgVal);
    let   reward = 0n;

    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: elector.address,
      body: NominatorPool.recoverStakeMessage(),
      outMessagesCount: 1
    });
    expect(res.transactions).toHaveTransaction({
      from: elector.address,
      to: pool.address,
      op: 0xf96f7324,
      value: (x:bigint | undefined) => {
        if(!x)
          return false;
        // We should get more due to bonus
        reward = x - poolBefore.stakeAmountSent;
        return x > poolBefore.stakeAmountSent
      }
    });

    const poolAfter = await pool.getPoolData();
    expect(poolAfter.state).toEqual(0);
    const validatorReward = reward! * BigInt(nmConf.rewardShare) / 10000n;
    const nominatorReward = reward! - validatorReward;
    expect(poolAfter.validatorAmount).toEqual(poolBefore.validatorAmount + validatorReward);
    const nmsBefore = poolBefore.nominators!.values();
    const nmsAfter  = poolAfter.nominators!.values();
    // Base for bonus calculation
    const totalNmAmount   = poolBefore.nominators!.values().reduce((sum, curNm) => sum + curNm.balance, 0n) 
    // Check reward distribution
    for(let i = 0; i < nmsBefore.length; i++) {
      const curNm    = nmsBefore[i];
      // Pending deposits should credit + reward share
      const nmResult = (nominatorReward * curNm.balance / totalNmAmount) + curNm.balance + curNm.pending;
      expect(nmsAfter[i].balance).toEqual(nmResult);
      expect(nmsAfter[i].pending).toEqual(0n);
    }
    snapStates.set('recovered_pending', bc.snapshot());
  });
  it('Stake recover_ok message should only be accepted from elector', async() => {
    await loadSnapshot('staked');

    const notElector = differentAddress(elector.address);
    const poolBefore = await pool.getPoolData();
    expect(poolBefore.state).toEqual(2);
    const dataBefore = await getContractData(pool.address);
    let res = await bc.sendMessage(internal({
      from: notElector,
      to: pool.address,
      body: beginCell().storeUint(0xf96f7324, 32).storeUint(0, 64).endCell(),
      value: toNano('1000000')
    }));
    expect(await getContractData(pool.address)).toEqualCell(dataBefore);
    res = await bc.sendMessage(internal({
      from: elector.address,
      to: pool.address,
      body: beginCell().storeUint(0xf96f7324, 32).storeUint(0, 64).endCell(),
      value: toNano('1000000')
    }));
    expect((await pool.getPoolData()).state).toEqual(0);
  });
  it('New stake should not trigger when pending withdraws present', async() => {
    await loadSnapshot('recovered_pending');
    expect(await pool.getHasWithdrawRequests()).toBe(true);
    const deposit    = nmConf.minValidatorStake;
    await testNewValidatorStakeNegative(85, validator.getSender(), deposit);
    // Cleaning out all pending withdraws
    await pool.sendProcessWithdraw(nmUser.getSender(), 100, toNano('10'));
    // Should succeed
    await testNewValidatorStakeNegative(0, validator.getSender(), deposit);
  });
  it('Process withdrawl requests with regards to limit', async () => {
    await loadSnapshot('staked');
    const nms = await pool.getNominatorsList();
    const withdraws: {hash:bigint, balance:bigint}[] = [];
    let reqBalance = 0n;
    const poolBefore = await pool.getPoolData();
    expect(poolBefore.withdrawReq).toBeNull();
    let pending:bigint;

    for(let i = 0; i < 5; i++) {
      const curNm = nms[i];
      let pending = curNm.pending;
      if(pending == 0n) {
        // Make pending deposit for better testing
        const sendAddr = new Address(0, bigint2buff(curNm.hash));
        pending        = getRandomTon(100, 200);
        await pool.sendNmDeposit(bc.sender(sendAddr), pending);
        pending -= depositFee;
      }
      const exp   = {hash:curNm.hash, balance: curNm.balance + pending};
      withdraws.push(exp);
      reqBalance  += exp.balance;
      const nmAddr = new Address(0, bigint2buff(nms[i].hash));
      await pool.sendNmWithdraw(bc.sender(nmAddr));
    }
    // Should top up pool balance
    const testAddr  = randomAddress(0);
    await pool.sendDeploy(nmUser.getSender(), reqBalance);

    const randLimit = getRandomInt(1, 4);
    const msgVal    = toNano('10');
    const res       = await pool.sendProcessWithdraw(nmUser.getSender(), randLimit, msgVal);
    const poolAfter = await pool.getPoolData();
    expect(res.transactions).toHaveTransaction({
      from: nmUser.address,
      to: pool.address,
      success: true,
      // Limit number of withraw and one excess
      outMessagesCount: randLimit + 1
    });

    expect(poolAfter.nmCount).toEqual(poolBefore.nmCount - randLimit);
    const trans     = res.transactions[1];
    const msgs      = trans.outMessages.values();
    const excessMsg = msgs[randLimit];
    const withdrawMsgs = msgs.slice(0,randLimit);
    expect(excessMsg).not.toBeUndefined();
    expect((excessMsg.info as CommonMessageInfoInternal).value.coins).toEqual(getMsgExcess(trans, excessMsg, msgVal, msgConf));
    // After splice we only have withdraw messages left
    for(let msg of withdrawMsgs) {
      const addrHash = buff2bigint((msg.info as CommonMessageInfoInternal).dest.hash)
      // Check that it was present in withdraw requests
      const wInfo    = withdraws.find(x => x.hash == addrHash)!;
      expect(wInfo).not.toBeUndefined();
      const fwdFee  = computeMessageForwardFees(msgConf, msg);
      expect((msg.info as CommonMessageInfoInternal).value.coins).toEqual(wInfo.balance - fwdFee.fees - fwdFee.remaining);
    }
  });

  it('Emergency withdraw request should only allow existing pending withdraws', async () => {
    await loadSnapshot('staked');
    const poolBefore = await pool.getPoolData();
    expect(poolBefore.withdrawReq).toBeNull();
    let res = await pool.sendEmergencyWithdraw(nmUser.getSender(), nmUser.address);
    expect(res.transactions).toHaveTransaction({
      from: nmUser.address,
      to: pool.address,
      success: false,
      exitCode: 71
    });

    await pool.sendNmWithdraw(nmUser.getSender());
    expect(await pool.getHasWithdrawRequests()).toBe(true);

    res = await pool.sendEmergencyWithdraw(nmUser.getSender(), nmUser.address);
    expect(res.transactions).toHaveTransaction({
      from: nmUser.address,
      to: pool.address,
      success: true,
    });
  });

  it('Emergency withdraw request handling', async () =>{
    await loadSnapshot('staked');
    const poolBefore = await pool.getPoolData();
    await pool.sendNmWithdraw(nmUser.getSender());
    const hash = buff2bigint(nmUser.address.hash);
    const userData = await pool.getNominatorData(hash)
    let pending    = userData.pending;
    if(pending == 0n) {
      pending = getRandomTon(100, 200);
      await pool.sendNmDeposit(nmUser.getSender(), pending);
      pending -= depositFee;
    }
    const reqBalance = userData.balance + pending;
    await pool.sendDeploy(nmUser.getSender(), reqBalance);
    const msgVal = toNano('1');
    const res = await pool.sendEmergencyWithdraw(nmUser.getSender(), nmUser.address, msgVal)
    expect(res.transactions).toHaveTransaction({
      from: nmUser.address,
      to: pool.address,
      success: true,
      outMessagesCount: 2
    });

    const trans = res.transactions[1];
    const withdrawMsg = trans.outMessages.get(0)!;
    const excessMsg   = trans.outMessages.get(1)!;
    const fwdFee      = computeMessageForwardFees(msgConf, withdrawMsg);
    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: nmUser.address,
      value: getMsgExcess(trans, excessMsg, msgVal, msgConf)
    });
    expect(res.transactions).toHaveTransaction({
      from: pool.address,
      to: nmUser.address,
      value: reqBalance - fwdFee.fees - fwdFee.remaining
    });
    const poolAfter = await pool.getPoolData()
    expect(poolAfter.nmCount).toEqual(poolBefore.nmCount - 1);
  });

  describe('Votes', () =>{
    let voterAddr:Address;
    let propHash: Buffer;
    const randHash = () => {
      return randomAddress(0).hash;
    };
    let testVote:(prop:Buffer,
                  address:Address,
                  support:boolean,
                  exp_code:number,
                  value?:bigint) => Promise<SendMessageResult>;

    beforeAll(async () => {
      // Picking a random nominator voter
      await loadSnapshot('staked');
      let voterIdx:number;
      const nmList    = await pool.getNominatorsList();

      do {
        voterIdx  = getRandomInt(0,nmList.length - 1);
      } while(nmList[voterIdx].balance == 0n && nmList[voterIdx].hash != buff2bigint(nmUser.address.hash));

      voterAddr       = new Address(0, bigint2buff(nmList[voterIdx].hash));
      // Lazy but works
      propHash = randomAddress().hash;
      testVote = async (prop:Buffer,
                                address:Address,
                                support: boolean,
                                exp_code:number,
                                value?:bigint) => {

        let dataBefore:Cell;
        if(exp_code != 0)
          dataBefore = await getContractData(pool.address);
        const res = await pool.sendVote(bc.sender(address), prop, support, value);

        expect(res.transactions).toHaveTransaction({
          from: address,
          to: pool.address,
          success: exp_code == 0,
          exitCode: exp_code
        });

        if(exp_code != 0) {
          expect(await getContractData(pool.address)).toEqualCell(dataBefore!);
        }
        return res;
      }

    });
    // All vote test should start in staked state
    beforeEach(async () => await loadSnapshot('staked'))

    it('Not authorized voter should be on basechain', async () =>{
      const nmMaster = new Address(-1, voterAddr.hash);
      const nmBase   = new Address(0, voterAddr.hash);
      await testVote(propHash, nmMaster, true, 121);
      await testVote(propHash, nmBase, true, 0);
    });

    it('Not authorized voter should be a nominator', async () => {
      let notNmAddr:Address;
      let notNmHash:bigint;
      const nmList = await pool.getNominatorsList();
      // Make absolutely sure we don't ocasionally generate address from nm's
      do {
        notNmAddr  = randomAddress(0);
        notNmHash  = buff2bigint(notNmAddr.hash);
      } while(nmList.find(x => x.hash == notNmHash));

      await testVote(propHash, notNmAddr, true, 122);
      await testVote(propHash, voterAddr, true, 0);
    })

    it('Voting nominator should have some non-pending deposit', async () =>{
      const nmList    = await pool.getNominatorsList();
      let   newNmAddr:Address;
      let   newNmHash:bigint;
      // Make absolutely sure we don't ocasionally generate address from nm's
      do {
        newNmAddr  = randomAddress(0);
        newNmHash  = buff2bigint(newNmAddr.hash);
      } while(nmList.find(x => x.hash == newNmHash));
      // We're in staked state, so whole deposit will go to pending
      await pool.sendNmDeposit(bc.sender(newNmAddr), validDeposit());
      const newNm = await pool.getNominatorData(newNmHash);
      // Makre sure we got that right
      expect(newNm.balance).toBe(0n);
      expect(newNm.pending).toBeGreaterThan(0n);
      await testVote(propHash, newNmAddr, true, 123);

      const oldNm = await pool.getNominatorData(buff2bigint(voterAddr.hash));
      expect(oldNm.balance).toBeGreaterThan(0n);
      await testVote(propHash, voterAddr, true, 0);
    });

    it('Message value should exceed lookup fee', async () => {
      //1.5 ** 0
      let fee = toNano('1');
      const nmList = await pool.getNominatorsList();
      const newNm  = (await pool.getNominatorsList()).find(x => x.hash != buff2bigint(voterAddr.hash));
      const newAddr = new Address(0, bigint2buff(newNm!.hash));
      for(let i = 0; i < 4; i++) {
        fee = toNano((1.5 ** i).toFixed(9));
        const prop = randHash();
        await testVote(prop, newAddr, true, 123, fee - 1n);
        await testVote(prop, newAddr, true, 0, fee);
      }
    });
    it('Should vote successfully', async () => {
      // Stop the ticking
      bc.now    = Math.floor(Date.now() / 1000)
      let res   = await pool.sendVote(bc.sender(voterAddr), propHash, true);
      expect(res.transactions).toHaveTransaction({
        from: voterAddr,
        to: pool.address,
        outMessagesCount: 0,
        success: true
      });
      // No excess, since proposal is not found(just created)
      expect(res.transactions).not.toHaveTransaction({
        from: pool.address,
        to: voterAddr
      });
      let votes = await pool.getVotes();
      const curVote = votes.find(x => x.hash == buff2bigint(propHash))!;

      expect(curVote).not.toBeUndefined();
      expect(curVote.createTime).toEqual(bc.now);
      bc.now += 100;
      // Control message value for simplicity
      const msgVal = toNano('2');
      // Add one more voter
      res = await pool.sendVote(nmUser.getSender(), propHash, false, msgVal);
      expect(res.transactions).toHaveTransaction({
        from: nmUser.address,
        to: pool.address,
        success: true,
        outMessagesCount: 1
      });

      const trans     = res.transactions[1];
      const excessMsg = trans.outMessages.get(0)!;
      const excess    = getMsgExcess(trans, excessMsg, msgVal, msgConf);
      // Check excess
      expect(res.transactions).toHaveTransaction({
        from: pool.address,
        to: nmUser.address,
        value: excess
      });

      const voters = await pool.getVoters(curVote!.hash);
      expect(voters.length).toBe(2);
      const firstIdx = voters.findIndex(x => x.address.equals(voterAddr));
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      const secondIdx  = Math.abs(firstIdx - 1);
      const firstVote  = voters[firstIdx];
      const secondVote = voters[secondIdx];

      expect(firstVote.support).toBe(true);
      // Very first vote
      expect(firstVote.voteTime).toEqual(curVote.createTime);
      expect(firstVote.support).toBe(true);
      // Won't hurt to check address
      expect(secondVote.address).toEqualAddress(nmUser.address);
      // Different opinion and time
      expect(secondVote.support).toBe(false);
      expect(secondVote.voteTime).toEqual(bc.now);
    })

    it('Should not be able to vote twice', async () => {
      const sender = bc.sender(voterAddr);
      // First succeeds
      await testVote(propHash, voterAddr, true, 0);
      // Second fails
      await testVote(propHash, voterAddr, true, 124);
      // Even if we change opinion
      await testVote(propHash, voterAddr, false, 124);
    });

    it('Should clean up votes older than 30 days(2592000)', async () => {
      let votesCount = getRandomInt(2, 4);
      const sender   = bc.sender(voterAddr);

      const addNVotes = async (votesCount:number, offset:number=0) => {
        const props:Buffer[] = [];
        for (let i = offset; i < offset + votesCount; i++) {
          const prop = randHash();
          await pool.sendVote(sender, prop, true, toNano('10'))
          props.push(prop)
        }
        return props;
      }

      // Stop ticking
      bc.now = Math.floor(Date.now() / 1000);
      const expVotes    = await addNVotes(getRandomInt(2, 4));
      const votesBefore = await pool.getVotes();
      // Try no expired votes
      let res = await pool.sendVoteCleanup(nmUser.getSender());
      // Should not change
      expect(votesBefore).toEqual(await pool.getVotes());
      // Current time + 30 days and 10 sec in case it ticks
      bc.now += 2592000 + 10;
      // Create some more votes
      const newVotes = await addNVotes(getRandomInt(2, 4), expVotes.length);
      res = await pool.sendVoteCleanup(nmUser.getSender());
      // Should remove expired votes but keep new
      const votesAfter = await pool.getVotes();
      expect(votesAfter.length).toEqual(newVotes.length);
      for(let i = 0; i < votesAfter.length; i++) {
        const testBuff = bigint2buff(votesAfter[i].hash);
        //Not in expired
        expect(expVotes.find(x => x.equals(testBuff))).toBeUndefined();
        //But present in newVotes
        expect(newVotes.find(x => x.equals(testBuff))).not.toBeUndefined();
      }
    })
  });

  /*
  it('Should elect new vset', async () => {
     Self test
    await runElections();
    await waitNextRound();
  });
  */
});
