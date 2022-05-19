# Nominator pool smart contract

## Get-method `get_pool_data` 

Returns:

1. state - uint - current state of nominator pool. 0 - does not participate in validation, 1 - sent a `new_stake` request to participate in the validation round, 2 - received a successful confirmation about participation in the validation round.   
2. nominators_count - uint - current number of nominators in the pool.
3. stake_amount_sent - nanotons - with such a stake amount, the pool participates in the current round of validation.
4. validator_amount - nanotons - amount of coins owned by the validator.
5. validator_address - immutable - validator wallet address. To get the address do `"-1:" + dec_to_hex(validator_address)`.
6. validator_reward_share - immutable - uint - what share of the reward from validation goes to the validator. `validator_reward = (reward * validator_reward_share) / 10000`.  For example set 4000 to get 40%.
7. max_nominators_count - immutable - uint - the maximum number of nominators in this pool.
8. min_validator_stake - immutable - nanotons - minimum stake for a validator in this pool.
9. min_nominator_stake - immutable - nanotons - minimum stake for a nominator in this pool.
10. nominators - Cell - raw dictionary with nominators.
11. withdraw_requests - Cell - raw dictionary with withdrawal requests from nominators.
12. stake_at - uint - ID of the validation round in which we are/are going to participate. Supposed start of next validation round (`utime_since`).  
13. saved_validator_set_hash - uint - technical information.
14. validator_set_changes_count - uint - technical information.
15. validator_set_change_time - uint - technical information.
16. stake_held_for - uint - technical information.
17. config_proposal_votings - Cell - raw dictionary with config proposals votings.

## Get-method `list_nominators`

Returns list of current pool's nominators.

Each entry contains:

1. address - nominator wallet address. To get the address do `"0:" + dec_to_hex(address)`.
2. amount - nanotons - current active stake of the nominator.
3. pending_deposit_amount - nanotons - deposit amount that will be added to the nominator's active stake at the next round of validation.
4. withdraw_request - if `-1` then this nominator sent a request to withdraw all of his funds.

## Get-method `get_nominator_data`

It takes as an argument the address of the nominator and returns:

1. amount - nanotons - current active stake of the nominator.
2. pending_deposit_amount - nanotons - deposit amount that will be added to the nominator's active stake at the next round of validation.
3. withdraw_request - if `-1` then this nominator sent a request to withdraw all of his funds.

Throws an `86` error if there is no such nominator in the pool.

To get a nominator for example with an address `EQA0i8-CdGnF_DhUHHf92R1ONH6sIA9vLZ_WLcCIhfBBXwtG` you need to convert address to raw form `0:348bcf827469c5fc38541c77fdd91d4e347eac200f6f2d9fd62dc08885f0415f`, drop `0:` and invoke `get_nominator_data 0x348bcf827469c5fc38541c77fdd91d4e347eac200f6f2d9fd62dc08885f0415f`.

## Reward distribution

For each round of validation, the pool sends a stake to the elector smart contract.

After the completion of the validation round, the pool recover its funds from the elector.

Usually the amount received is greater than the amount sent, the difference is the validation reward.

The validator receives a share of the reward, according to the pool configuration parameter `validator_reward_share`.

```
validator_reward = (reward * validator_reward_share) / 10000;
nominators_reward = reward - validator_reward;
```

Nominators share the remaining reward according to the size of their stakes.

For example, if there are two nominators in the pool with stakes of 100k and 300k TON, then the first one will take 25% and the second 75% of the `nominator_reward`.

In case of a large validation fine, when the amount received is less than the amount sent, the loss is debited from the validator's funds. 

If the validator's funds are not enough, then the remaining loss will be deducted from the nominators in proportion to their stakes.

Note that the pool is designed in such a way that validator funds should always be enough to cover the maximum fine.

## Nominator's deposit

In order for the nominator to make a deposit, he needs to send message to nominator-pool smart contract with Toncoins and text comment "d".

The nominator can only send message from a wallet located in the basechain (with raw address `0:...`).

The amount of Toncoins must be greater than or equal to `min_nominator_stake + 1 TON`.

1 TON upon deposit is deducted as a commission for deposit processing.

If the pool is not currently participating in validation (`state == 0`), then the deposit will be credited immediately.

If the pool is currently participating in the validation (`state != 0`), then the amount will be added to the `pending_deposit_amount` of the nominator, and will be credited after the completion of the current round of validation.

The nominator can subsequently send more Toncoins to increase his deposit.

Note that if the nominator-pool has already reached the number of nominators equal to the `max_nominators_count`, then deposits from new nominators will be rejected (they will bounce back to the sender).

## Nominator's withdrawal

In order for the nominator to make a withdrawal, he needs to send message to nominator-pool smart contract with text comment "w" and some Toncoins for network fee (1 TON is enough). Unspent TONs attached to message will be returned except in very rare cases.

If there are enough Toncoins on the balance of the nominator-pool, the withdrawal will be made immediately. All funds will be on the balance of the nominator-pool when it has completed participation in the validation round, but has not yet submitted a request for participation in a new round.

If there are not enough Toncoins on the nominator-pool balance, then a `withdraw_request` will be made for the nominator, and the Toncoins will be withdrawn after the end of the current validation round.

The nominator can only withdraw all of his funds at once. Partial withdrawal not supported.

## Emergency withdrawal

When operating normally, the validator must periodically send operational messages to the nominator pool, such as `process withdraw requests`, `update current validator set`, `new_stake`, `recover_stake`.

The validator software mytonctrl does this automatically.

In an emergency, for example if a validator goes missing and ceases to perform his duties, these operational messages can be sent by anyone and thus the nominators can withdraw their funds.

