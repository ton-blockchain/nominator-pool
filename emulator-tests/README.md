# Nominator pool testing plan

## Terms

### Excess
Message carrying value leftovers.
Initial message value - gas and messages fees.
[More about fees](https://docs.ton.org/develop/howto/fees-low-level#in_fwd_fees-out_fwd_fees).

## States

### Initial

Means that pool stake is not deposited yet(**0**).

### Transit

Stake has been sent to `elector`, but no confirmation yet(**1**).

### Deposit

Stake is deposited to `elector` successfully(**2**).

## Structures

`nc`: Nominators count. Total count of nominators in nm.  
`nm`: Nominators. Dictionary containing current nominators data.  
`pw`: Pending withdraws. Dictionary contains data about withdraw requests.  
`pd`: Pending deposits. Dictionary conains data about pending deposits.  
`pd_amount`: Pending deposits amount  
`pv`: Proposal votingss. Dictionary contains data about config proposal votings.  

## Simple deposit

- Message should exceed deposit processing fee.
- Deposit fee should be deducted from `message value`.
- If nominator is not present in `nm`, `nc` should increase by one.
- In `Initial` state `message value` should be accounted in `nm` dictionary.
- In any other state `message value` should be accounted in `pd` dictionary.
- Total nominator `message value + nm + pd` should exceed minimal nominator stake.

## Simple withdraw in initial mode

- Nominator should be present in `nm`. Exit code:**60** otherwise.
- Withdraw amount should equal `nm + pd`.
- Withdraw amount should be less than total pool balance - minimal storage fee.
- Any requests for this nominator present in `pw`, should be cleared.
- `nc` should decrease by one.
- If withdraw amoun exceeds *one TON*, message with according value is sent back.
- If pool balance - `message value` exceeds minimal storage fee, message with excess is sent back.

## Simple withdraw in other modes

- Nominator should be present in `nm`. Exit code:**69** otherwise.
- Withdraw request should be registered in `pw`.
- Excess message send back.

## Vote

### Terms

#### Authorized
Sender is validator

#### Lookup fee

Fee is taken in case of vote being conducred on proposal hash not present in `pv`.  
Fee formula: `(1.5 TON) ** depth of pv`.

### Testable

- Not authorized sender message should be from basechain.(Exit code:**121** otherwise).
- Not authorized sender address should be preset in `nm`.(Exit code:**122** otherwise).
- Not authorized sender should have actual(not pending)  deposit.(Exit code:**123** otherwise).
- If proposal hash is not present in `pv`, `lookup fee` is taken.
- Message value should exceed `lookup fee`(if any). (Exit code:**123** otherwise). 
- If proposal is found in `pv`, `excess` message is sent back.
- If sender address is not present in `pv`(not voted), vote and vote time is saved to `pv`. (Exit code:**124** otherwise).

## Celan up votes

`op`:**7**  

### Summary

Cleans up expired(Created more than 30 days ago) votes in `pv`.  

### Get methods

- `get_votes`

### Testable

- Should clean all the proposals matching that criteria.
- Should clean **only** the proposals matching this criteria
- Should send *excess* message.


## Top up

`op`:**1**  
Simply credit message value to pool balance.

## Process withdraw requests

`op`:**2**  

### Body
`process_withdraw#_ limit:uint8`

### Testable
- Iterates over `pw` withdrawl requests(if any) and atempts [withdraw](#simple-withdraw-in-initial-mode) up to `limit` times or first failed withdraw.
- `Excess` message is sent back.

## Emergency withdraw request

`op`:**3**  

### Body
`emergency_withdraw#_ req_addr:uint256`

### Testable

- `req_addr` should be present in `pw`. Exit code:**71** otherwise.
- Process [withdraw](#simple-withdraw-in-initial-mode)
- If balance after processing exceeds minimal storage fee, send `excess` message.

## Update current validator set hash

`op`:**6**  

### Summary

Triggers check of current validators set `Config Param 34` against
hash saved in contract state.  

### Changes

Retreivable by `get_pool_data`.

- `validator_set_changes_count`
- `saved_validator_set_hash`
- `validator_set_change_time`

### Testable

- `validator_set_changes_count` should increase by one.
- `validator_set_changes_count` can't exceed 3. Exit code **113**.
- `saved_validator_set_hash` should match cell hash of `Config Param 34`.
- `validator_set_change_time` should match current time.
- *Excess* message should be sent back.

If set hash hasn't changed, none of above should change.  
*Excess* message should be sent back regardless of validator set changes.

## Deposit from validator

`op`:**4**.

### Changes

Retreivable by `get_pool_data`.

- `validator_amount`

### Testable

- Sender address should be from masterchain. Exit code:**73**
- Sender address should equal expected validator address. Exit code: **73**.
- Message value should exceed deposit processing fee. Exit code: **74**.
- Should increase `validator_amount` by message value with deduction of processing fee.

## Withdraw from validator

`op`:**5**

### Summary

Allows validator to withdraw everything from contract balance, except nominaots stake

### Body

`withdraw_nominator#_ request_amount:Coins`

### Changed
- `validator_amount`

### Testable

- Only allowed at *initial* state. Exit code:**74**
- Sender address should be from masterchain. Exit code:**75**
- Sender address should equal expected validator address. Exit code: **75**.
- `request_amount` should exceed 0. Exit code: **78**
- Contract balance after withdraw with deduction of nominators stake should exceed storage fee. Exit code **76**
- `validator_amount` should decrease by `request_amount`.
- If `request_amount` > `validator_amount`,  `validator_amount` should equal **0**.
- Message carrying `request_amount` of TONs should be sent to *validator address*.
- If contract balance after operation with dedeuction of incoming message value exceeds storage fee, *excess* message is sent back.

## New stake

### Summary

Submits new stake of specified amount to *elector* contract.

### Body

```
elector_new_stake#_
	pubkey:bits256
	stake_at:uint32
	max_factor:uint32
	adnl_addr:bits256
	^[signature:bits512]

new_stake#_ 
	stake_amount:Coins
	elector_data:elector_new_stake


```

### Changes

- `saved_validator_set_hash`
- `validator_set_changes_count`
- `validator_set_change_time`
- `stake_held_for`

### Testable

- Sender address should be from masterchain. Exit code:**76**.
- Sender address should equal expected validator address. Exit code: **76**.
- New stake only allowed in *initial* state. Exit code:**79**.
- Message *query id* should exceed 0 to receive confirmation from *elector* contract. Exit code: **80**.
- Message value should exeed *elector* new stake fee.(Currently 1 TON). Exit code:**86**.
- `stake_amount` should exceed minimal stake.(Currently 500 TON). Exit code:**81**.
- `stake_amount` should **not** exceed contract balance with deduction of storage fee. Exit code:**82**.
- `validator_amount` should be >= minimal validator stake. Exit code:**83**.
- `validator_amount` should be >= maximum punishent value for validator. Exit code:**84**.
- `pw` should be empty. Exit code:**85**
- State should change to *transit* till *elector* confirmation.
- `saved_validator_set_hash` should set to `Config Param 34 cell hash`.
- `validator_set_changes_count` should set to 0.
- `validator_set_change_time` should set to `utime_since` field of `Config Param 34`.
- `stake_held_for` should set to correspondig parameter of `Config Param 15`.
- `elector_new_stake` formatted message should be sent to *elector* carrying `stake_amount` value.

## Elector new stake ok 

Happens after [New stake](#New-stake) and indicates stake deposit success.

### Testable

- State should set to *deposit*.
- Should be possilbe to trigger from *elector* address **only**.

## Elector new stake error

Happens after [New stake](#New stake) and indicates stake deposit failed.

### Testable

- State should set to *initial*.
- Should be possilbe to trigger from *elector* address **only**.

## Recover stake

### Summary

Atempt to recover surplus/unfrozen/complaint reward from *elector* contract.

### Body

`recover_stake_# op:##0x47657424 query_id:uint64`

### Testable

- `validator_set_changes_count` should be >=2 (two or more elections have passed). Exit code: **111**.
- If `validator_set_changes_count` equals 2, time since last validators set changed should exceed `stake_held_for` by at least 60 sec. Exit code:**112**.
- `recover_stake` message is sent to *elector* contract.

## Stake recovered

### Summary

Incoming message from elector carrying recovered stake.  
Should trigger reward distributuion mechanism.

### Testable

- State should set to *initial*.
- Should be possible to trigger from *elector* address **only**.
- Should distribute rewards according to pool configuration.
