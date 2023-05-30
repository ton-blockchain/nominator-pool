import { SendMessageResult, Blockchain, SandboxContract } from "@ton-community/sandbox";
import { Address, Slice, toNano, Cell, beginCell, contractAddress } from "ton";
import { OpenedContract } from "ton-core";
import { randomAddress, LispList, NominatorDesc } from "./utils";
import { NominatorPool } from "./wrappers/NominatorPool";

const testNominatorList = async (pool: SandboxContract<NominatorPool>, nmList: NominatorDesc[], strict:boolean = false) => {

  const rsList = await pool.getNominatorsList();
  // In strict mode number of elements should match
  if(strict)
    expect(rsList.length).toEqual(nmList.length);

  // every expected nominator should match in result list
  for (let exNm of nmList) {
    let exFound = false;
    for (let resNm of rsList) {
      exFound = exNm.eq(resNm);
      if(exFound) {
        break;
      }
    } 
    expect(exFound).toBe(true);
  }

}

export {
  testNominatorList
}
