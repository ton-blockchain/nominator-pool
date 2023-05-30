import { Address, Tuple, TupleItem, TupleItemInt, TupleReader, toNano } from "ton";
import { Cell, Slice, Sender, SenderArguments, ContractProvider, Message, beginCell, Dictionary, MessageRelaxed, Transaction } from "ton-core";
import { Blockchain } from "@ton-community/sandbox";
import { NominatorConf, NominatorPool } from "./wrappers/NominatorPool";
import { computeMessageForwardFees, MsgPrices } from "./fees";


const randomAddress = (wc: number = 0) => {
    const buf = Buffer.alloc(32);
    for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.floor(Math.random() * 256);
    }
    return new Address(wc, buf);
};

const differentAddress = (oldAddr:Address) => {

    let newAddr = oldAddr;

    do {
        newAddr = randomAddress(newAddr.workChain);
    } while(newAddr.equals(oldAddr));

    return newAddr;
}

export const getRandom = (min:number, max:number) => {
    return Math.random() * (max - min) + min;
}

enum roundMode {floor, ceil, round};

export const getRandomInt = (min:number, max:number, mode: roundMode = roundMode.floor) => {
    let res = getRandom(min, max);

    if(mode == roundMode.floor) {
        res = Math.floor(res);
    }
    else if(mode == roundMode.ceil) {
        res = Math.ceil(res);
    }
    else {
        res = Math.round(res);
    }

    return res;
}

export const getRandomTon = (min:number, max:number): bigint => {
    return toNano(getRandom(min, max).toFixed(9));
}

interface TupleItemConstructor <T> {
    new (item: TupleItem) : T;
}

interface IAny {}
interface TupleReaderConstructor <T extends IAny>{
    new (...args: any[]) : T
    fromReader(rdr: TupleReader) : T;
}

class TupleReaderFactory<T extends IAny>{
    private constructable: TupleReaderConstructor<T>;
    constructor(constructable: TupleReaderConstructor<T>) {
        this.constructable = constructable;
    }
    createObject(rdr: TupleReader) : T {
        return this.constructable.fromReader(rdr);
    }
}

class LispIterator <T extends IAny> implements Iterator <T> {

    private curItem:TupleReader | null;
    private done:boolean;
    private ctor: TupleReaderFactory<T>;

    constructor(tuple:TupleReader | null, ctor: TupleReaderFactory<T>) {
        this.done    = false; //tuple === null || tuple.remaining == 0;
        this.curItem = tuple;
        this.ctor    = ctor;
    }

    public next(): IteratorResult<T> {

        this.done = this.curItem === null || this.curItem.remaining  == 0;
        let value: TupleReader;
        if( ! this.done) {
            const head = this.curItem!.readTuple();
            const tail = this.curItem!.readTupleOpt();

            if(tail !== null) {
                this.curItem = tail;
            }

            value = head;
            return {done: this.done, value:  this.ctor.createObject(value)};
        }
        else {
            return {done: true, value: null}
        }
    }
}

class LispList <T extends IAny> {
    private tuple: TupleReader | null;
    private ctor: TupleReaderFactory<T>;

    constructor(tuple: TupleReader | null, ctor: TupleReaderConstructor<T>) {
        this.tuple = tuple;
        this.ctor  = new TupleReaderFactory(ctor);
    }

    toArray() : T[] {
        return [...this];
    }

    [Symbol.iterator]() {
        return new LispIterator(this.tuple, this.ctor);
    }
}

class NominatorDesc {

    constructor(readonly hash:bigint,
                readonly balance: bigint,
                readonly pending: bigint,
                readonly withdraw: boolean) {}

    static fromReader(rdr: TupleReader) {
        return new NominatorDesc(
            rdr.readBigNumber(),
            rdr.readBigNumber(),
            rdr.readBigNumber(),
            rdr.readBoolean()
        );
    }


    eq(b: NominatorDesc) : boolean {
        return ((this.hash == b.hash)
                && (this.balance == b.balance)
                && (this.pending == b.pending)
                && (this.withdraw == b.withdraw));
    }
}

export class VoteDesc {
    constructor(readonly hash:bigint, readonly createTime:number) {}
    eq(cmp:VoteDesc) {
        return ((this.hash == cmp.hash)
                && (this.createTime == cmp.createTime));
    }
    static fromReader(rdr: TupleReader) {
        return new VoteDesc(rdr.readBigNumber(), rdr.readNumber());
    }
}

export class Voter {
    constructor(readonly address:Address, readonly support:boolean, readonly voteTime:number) {}
    eq(cmp:Voter) {
        return ((this.address.equals(cmp.address))
                && (this.support == cmp.support)
                && (this.voteTime == cmp.voteTime));
    }
    static fromReader(rdr:TupleReader) {
        return new Voter(new Address(0, bigint2buff(rdr.readBigNumber())), rdr.readBoolean(), rdr.readNumber());
    }
}

const buff2bigint = (buff: Buffer) : bigint => {
    return BigInt("0x" + buff.toString("hex"));
}

export const bigint2buff = (num:bigint) : Buffer => {
    return Buffer.from(num.toString(16), 'hex')
}

/*
// Mock sender
class NominatorSender implements Sender {
    readonly address: Address;
    private bc : Blockchain;

    constructor(addr: Address, bc: Blockchain) {
        this.address = addr;
        this.bc = bc;
    }

    async send( args: SenderArguments) {

        const msg: Message = { 
            info: {
                type : "internal",
                ihrDisabled: true,
                bounce: args.bounce ? true : false,
                bounced: false,
                src: this.address,
                dest: args.to,
                value: { coins:args.value },
                ihrFee: BigInt(0),
                forwardFee: BigInt(0),
                createdLt: this.bc.lt,
                createdAt: 0,

            },

            init: args.init,

            body: <Cell>args.body ?? new Cell()
        };

        const res = await this.bc.pushMessage(msg);
    }
}
*/

//Shameless borrow from:https://github.com/ton-community/ton/blob/v12.3.3/src/contracts/configs/configParsing.ts#L359


const configParseMsgPrices = (sc: Slice) => {

    let magic = sc.loadUint(8);

    if(magic != 0xea) {
        throw Error("Invalid magic number!");
    }
    return {
        lumpPrice:sc.loadUintBig(64),
        bitPrice: sc.loadUintBig(64),
        cellPrice: sc.loadUintBig(64),
        ihrPriceFactor: sc.loadUintBig(32),
        firstFrac: sc.loadUintBig(16),
        nextFrac:  sc.loadUintBig(16)
    };
}

export const computedGeneric = (trans:Transaction) => {
    if(trans.description.type !== "generic")
        throw("Expected generic transaction");
    if(trans.description.computePhase.type !== "vm")
        throw("Compute phase expected")
    return trans.description.computePhase;
};

export const getMsgExcess = (trans:Transaction, msg:Message, value:bigint, msgConf:MsgPrices) => {
  const fwdFees = computeMessageForwardFees(msgConf, msg);
  return value - computedGeneric(trans).gasFees - fwdFees.remaining - fwdFees.fees;
}

export {
    randomAddress,
    differentAddress,
    LispList,
    buff2bigint,
    NominatorDesc,
};
