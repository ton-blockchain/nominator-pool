import { Address, beginCell, Cell, Slice, Contract, contractAddress, ContractProvider, Dictionary, DictionaryValue, Sender, toNano, TupleReader, Tuple, TupleItem, TupleItemInt, SendMode, ContractState } from "ton-core";
import { SendMessageResult } from "@ton-community/sandbox";
import { compile } from "@ton-community/blueprint";
import { buff2bigint, bigint2buff, LispList, NominatorDesc, VoteDesc, Voter } from "../utils";
import { signData } from "./ValidatorUtils";

export type NominatorConf = {
	validatorAddress: Address,
	rewardShare: number,
	maxNominatorCount: number,
	minValidatorStake: bigint,
	minNominatorStake: bigint
};

type NominatorValue = {balance: bigint, pending: bigint};
export type NominatorState = {
	state: number,
	nmCount: number,
	stakeAmountSent: bigint,
	validatorAmount: bigint,
	conf: NominatorConf,
	nominators:  Dictionary<bigint,NominatorValue> | null,
	withdrawReq: Dictionary<bigint, void> | null,
	stakeSentTime: number,
	validatorSetHash: bigint,
	validatorSetChangesCnt: number,
	validatorSetChangeTime: number,
	stakeHeldFor: number,
	proposals?: Dictionary<bigint, void>
}

function nominatorMsgBody ( op:number , action: number, queryId:bigint|number=0 ) {

		let builder = beginCell().storeUint(op, 32);

		if (op != 0) {
			builder = builder.storeUint(queryId, 64);
		}

		return builder.storeUint(action, 8).endCell();
}

const NominatorValue: DictionaryValue<NominatorValue> = {
    serialize: (src, builder) => {
        builder.storeCoins(src.balance).storeCoins(src.pending)
    },
    parse: (src) => {
        return {
            balance: src.loadCoins(),
            pending: src.loadCoins()
        };
    }
}
const EmptyDictionaryValue: DictionaryValue<void> = {
        serialize: (src, builder) => {},
        parse: (src) => {}
};


export class NominatorPool implements Contract {

	constructor(readonly address:Address, readonly init?: {code:Cell; data: Cell}) {}

	static poolConfigToCell(config:NominatorConf) {

		const confCell = beginCell().storeUint(buff2bigint(config.validatorAddress.hash), 256)
																	.storeUint(config.rewardShare, 16)
																	.storeUint(config.maxNominatorCount, 16)
																	.storeCoins(config.minValidatorStake)
																	.storeCoins(config.minNominatorStake)
											.endCell();
			
		return beginCell()
						.storeUint(0, 8)
						.storeUint(0, 16)
						.storeCoins(0)
						.storeCoins(0)
						.storeRef(confCell)
						.storeDict(null)
						.storeDict(null)
						.storeUint(0, 32)
						.storeUint(0, 256)
						.storeUint(0, 8)
						.storeUint(0, 32)
						.storeUint(0, 32)
						.storeDict(null)
					.endCell();
	}

	static parsePoolConfig(config:Cell):NominatorConf {
		const sc = config.beginParse();
		return {
			validatorAddress: sc.loadAddress(),
			rewardShare: sc.loadUint(16),
			maxNominatorCount: sc.loadUint(16),
			minValidatorStake: sc.loadCoins(),
			minNominatorStake: sc.loadCoins()
		}
	}

	static createFromAddress(address:Address) {
		return new NominatorPool(address);
	}

	static createFromConfig(config:NominatorConf, code:Cell, workchain:number = -1) {
		const data = NominatorPool.poolConfigToCell(config);
		const init = {code, data};
		return new NominatorPool(contractAddress(workchain, init), init);
	}

	async sendDeploy(provider: ContractProvider, via:Sender, value:bigint=toNano('10')) {
		const body = nominatorMsgBody(1,0);
		await provider.internal(via, {body, value, sendMode: SendMode.PAY_GAS_SEPARATELY});
	}

	static nmDepositMessage() {
		return nominatorMsgBody(0, 100);
	}

	async sendNmDeposit(provider: ContractProvider, src: Sender, value: bigint) {
		// Topping up initial balance
		const body = NominatorPool.nmDepositMessage();
		await provider.internal(src, {body, value, sendMode: SendMode.PAY_GAS_SEPARATELY});
	}

	static validatorDepositMessage(query_id: bigint | number = 0) {
		return beginCell().storeUint(4, 32).storeUint(query_id, 64).endCell();
	}

	async sendValidatorDeposit(provider: ContractProvider, via: Sender, value:bigint, query_id: bigint | number = 0) {
		await provider.internal(via, {
			value,
			body: NominatorPool.validatorDepositMessage(query_id),
			sendMode: SendMode.PAY_GAS_SEPARATELY
		})
	}

	static validatorWithdrawMessage(request_amount:bigint, query_id: bigint | number = 0) {
		return beginCell().storeUint(5, 32).storeUint(query_id, 64).storeCoins(request_amount).endCell();
	}

	async sendValidatorWithdraw(provider: ContractProvider, via: Sender, request_amount: bigint, value:bigint = toNano('0.5'), query_id: bigint | number = 0) {
		await provider.internal(via, {
			value,
			body: NominatorPool.validatorWithdrawMessage(request_amount, query_id),
			sendMode: SendMode.PAY_GAS_SEPARATELY
		});
	}

	static nmWithdrawMessage() {
		return nominatorMsgBody(0, 119);
	}

	async sendNmWithdraw(provider: ContractProvider, via: Sender, value: bigint = toNano('0.15')) {
		const body = NominatorPool.nmWithdrawMessage();
		await provider.internal(via, {value, body, sendMode: SendMode.PAY_GAS_SEPARATELY});
	}

	static processWithdrawMessage(limit:number, query_id:number | bigint = 0) {
		return beginCell().storeUint(2, 32).storeUint(query_id, 64).storeUint(limit, 8).endCell();
	}
	async sendProcessWithdraw(provider:ContractProvider, via: Sender, limit:number, value:bigint = toNano('1.5'), query_id:number | bigint = 0) {
		await provider.internal(via, {
			value,
			body: NominatorPool.processWithdrawMessage(limit),
			sendMode: SendMode.PAY_GAS_SEPARATELY
		});
	}

	static emergencryWithdrawMessage(nmAddr:Address, query_id: bigint|number = 0) {
		const hash = buff2bigint(nmAddr.hash);
		return beginCell().storeUint(3, 32).storeUint(query_id, 64).storeUint(hash, 256).endCell();
	}

	async sendEmergencyWithdraw(provider: ContractProvider, via: Sender, nmAddr: Address, value:bigint = toNano('1'), query_id: bigint|number = 0) {
		await provider.internal(via, {
			value,
			body: NominatorPool.emergencryWithdrawMessage(nmAddr, query_id),
			sendMode: SendMode.PAY_GAS_SEPARATELY
		});

	}
	static vsetUpdateMessage(query_id:bigint = 0n) {
		return beginCell().storeUint(6, 32).storeUint(query_id, 64).endCell();
	}
	async sendVsetUpdate(provider: ContractProvider, via: Sender, value:bigint = toNano('1'), query_id:bigint = 0n) {
		await provider.internal(via, {
			body: NominatorPool.vsetUpdateMessage(query_id),
			sendMode: SendMode.PAY_GAS_SEPARATELY,
			value
		});
	}
  static newStakeMessage(stake_val: bigint,
												 src: Address,
                         public_key: Buffer,
                         private_key: Buffer,
                         stake_at: number | bigint,
                         max_factor: number,
                         adnl_address: bigint,
                         query_id:bigint | number = 1) {

      const signCell = beginCell().storeUint(0x654c5074, 32)
                                  .storeUint(stake_at, 32)
                                  .storeUint(max_factor, 32)
                                  .storeUint(buff2bigint(src.hash), 256)
                                  .storeUint(adnl_address, 256)
                       .endCell()

      const signature = signData(signCell, private_key);

      return  beginCell().storeUint(0x4e73744b, 32)
                         .storeUint(query_id, 64)
												 .storeCoins(stake_val)
                         .storeUint(buff2bigint(public_key), 256)
                         .storeUint(stake_at, 32)
                         .storeUint(max_factor, 32)
                         .storeUint(adnl_address, 256)
                         .storeRef(signature)
              .endCell();
  }


  async sendNewStake(provider: ContractProvider,
                     via: Sender,
										 stake_val: bigint,
                     public_key: Buffer,
                     private_key: Buffer,
                     stake_at: number | bigint,
                     max_factor: number = 1 << 16,
                     adnl_address: bigint = 0n,
                     query_id:bigint | number = 1,
										 value: bigint = toNano('1')) {
      await provider.internal(via,{
          value, 
          body: NominatorPool.newStakeMessage(stake_val,
																							this.address,
                                              public_key,
                                              private_key,
                                              stake_at,
                                              max_factor,
                                              adnl_address,
                                              query_id),
          sendMode: SendMode.PAY_GAS_SEPARATELY
      });
  }

	static recoverStakeMessage(query_id: bigint | number = 0) {
		return beginCell().storeUint(0x47657424, 32).storeUint(query_id, 64).endCell();
	}

	async sendRecoverStake(provider: ContractProvider, via: Sender, value:bigint = toNano('1'), query_id: bigint | number = 0) {
		await provider.internal(via, {
			body: NominatorPool.recoverStakeMessage(query_id),
			sendMode: SendMode.PAY_GAS_SEPARATELY,
			value
		});
	}

	static voteMessage(proposal: bigint | Buffer, vote: boolean) {
		const action =  vote ? 121 : 110;
		const prop   = Buffer.from((proposal instanceof Buffer ? proposal : bigint2buff(proposal)).toString('hex'));
		return beginCell().storeUint(0, 32).storeUint(action, 8).storeBuffer(prop, 64).endCell();
	}

	async sendVote(provider: ContractProvider, via: Sender, prop: bigint | Buffer, vote: boolean, value:bigint = toNano('1.5')) {
		await provider.internal(via, {
			body: NominatorPool.voteMessage(prop, vote),
			sendMode: SendMode.PAY_GAS_SEPARATELY,
			value
		});
	}
	static voteCleanupMessage(query_id:bigint = 0n) {
		return beginCell().storeUint(7, 32).storeUint(query_id, 64).endCell();
	}
	async sendVoteCleanup(provider: ContractProvider, via: Sender, value:bigint = toNano('0.25')) {
		await provider.internal(via, {
			body: NominatorPool.voteCleanupMessage(),
			sendMode: SendMode.PAY_GAS_SEPARATELY,
			value
		});
	}


	async getPoolData(provider: ContractProvider): Promise<NominatorState>{
		const nmEmpty = (data:Cell | null) => {
			if(data == null) {
				return null;
			}
			else {
				return Dictionary.loadDirect(Dictionary.Keys.BigUint(256), NominatorValue, data);
			}
		};

		const nmWithdraw = (data:Cell | null) => {
			if(data == null) {
				return null;
			}
			else {
				return Dictionary.loadDirect(Dictionary.Keys.BigUint(256), EmptyDictionaryValue, data);
			}
		}

		const res = await provider.get('get_pool_data', []);
		const stack = res.stack;
		return {
			state:stack.readNumber(),
			nmCount: stack.readNumber(),
			stakeAmountSent: stack.readBigNumber(),
			validatorAmount: stack.readBigNumber(),
			conf: {
				validatorAddress: new Address(-1, bigint2buff(stack.readBigNumber())),
				rewardShare: stack.readNumber(),
				maxNominatorCount: stack.readNumber(),
				minValidatorStake: stack.readBigNumber(),
				minNominatorStake: stack.readBigNumber(),
			},
			nominators: nmEmpty(stack.readCellOpt()),
			withdrawReq: nmWithdraw(stack.readCellOpt()),
			stakeSentTime: stack.readNumber(),
			validatorSetHash: stack.readBigNumber(),
			validatorSetChangesCnt: stack.readNumber(),
			validatorSetChangeTime: stack.readNumber(),
			stakeHeldFor: stack.readNumber(),
		};
	}

	async getNominatorData(provider: ContractProvider, nmHash: bigint): Promise<NominatorDesc> {
		const res = await provider.get('get_nominator_data', [{type: "int", value: nmHash}]);
		return new NominatorDesc(
			nmHash,
			res.stack.readBigNumber(),
			res.stack.readBigNumber(),
			res.stack.readBoolean()
		);
	}

	async getNominatorsList(provider: ContractProvider) : Promise<NominatorDesc[]> {
		const res  = await provider.get('list_nominators', []);
		const list = new LispList(res.stack.readTupleOpt(), NominatorDesc);
		let   nmList  = list.toArray();

		return nmList;
	}

	async getHasWithdrawRequests(provider: ContractProvider) {
		const res = await provider.get('has_withdraw_requests', []);
		return res.stack.readBoolean();
	}

	async getVotes(provider: ContractProvider) : Promise<VoteDesc[]> {
		const res = await provider.get('list_votes', []);
		return new LispList(res.stack.readTuple(), VoteDesc).toArray();
	}


	async getVoters(provider: ContractProvider, vote: Buffer | bigint) {
		const voteHash = vote instanceof Buffer ? buff2bigint(vote) : vote;
		const res      = await provider.get('list_voters', [{type:"int", value:voteHash}]);
		return new LispList(res.stack.readTuple(), Voter).toArray();
	}
	async getNominatorsStake(provider: ContractProvider) {
		const list = await this.getNominatorsList(provider);
		return list.reduce((sum, curNm) => sum  + curNm.balance + curNm.pending, 0n);
	}
}
