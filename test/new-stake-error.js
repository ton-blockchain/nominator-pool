const {funcer} = require("./funcer");
const {
    FC, VALIDATOR_ADDR, ELECTOR_ADDR, ANYBODY_ADDR, NOMINATOR_1_ADDR, NOMINATOR_2_ADDR, makeNominator, makeStorage,
    TON, CONFIG_PARAMS
} = require("./utils");

const storage = (state, stake_amount_sent) => {
    return makeStorage({
        state,
        stake_amount_sent,
        validator_amount: 100000 * TON,
        config: {
            validator_address: '0x' + VALIDATOR_ADDR,
            validator_reward_share: 4000,
            max_nominators_count: 100,
            min_validator_stake: 100000 * TON,
            min_nominator_stake: 100000 * TON
        },
        nominators: {
            ['0x' + NOMINATOR_1_ADDR]: makeNominator(400000 * TON, 0),
            ['0x' + NOMINATOR_2_ADDR]: makeNominator(500000 * TON, 200000 * TON)
        },
        withdraw_requests: {
        }
    });
}

funcer({'logVmOps': false, 'logFiftCode': false}, {
    'path': './func/',
    'fc': FC,
    "configParams": CONFIG_PARAMS,
    'data': storage(0, 0 ),
    'in_msgs': [
        // not validator
        {
            "contract_balance": 1000000 * TON,
            "sender": '-1:' + ANYBODY_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0x4e73744b, // new_stake
                "uint64", 123, // query_id
                "coins", 501 * TON, // amount
                "uint256", 0, // validator_pubkey
                "uint32", 0, // stake_at
                "uint32", 0, // max_factor
                "uint256", 0, // adnl_addr
                "cell", ['uint256', 0, 'uint256', 0], // signature
            ],
            "exit_code": 78
        },
        // no query id
        {
            "contract_balance": 1000000 * TON,
            "sender": '-1:' + VALIDATOR_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0x4e73744b, // new_stake
                "uint64", 0, // query_id
                "coins", 501 * TON, // amount
                "uint256", 0, // validator_pubkey
                "uint32", 0, // stake_at
                "uint32", 0, // max_factor
                "uint256", 0, // adnl_addr
                "cell", ['uint256', 0, 'uint256', 0], // signature
            ],
            "exit_code": 80
        },
        // invalid body
        {
            "contract_balance": 1000000 * TON,
            "sender": '-1:' + VALIDATOR_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0x4e73744b, // new_stake
                "uint64", 123, // query_id
                "coins", 501 * TON, // amount
                "uint256", 0, // validator_pubkey
                "uint32", 0, // max_factor
                "uint256", 0, // adnl_addr
                "cell", ['uint256', 0, 'uint256', 0], // signature
            ],
            "exit_code": 9
        },
        // zero value
        {
            "contract_balance": 1000000 * TON,
            "sender": '-1:' + VALIDATOR_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0x4e73744b, // new_stake
                "uint64", 123, // query_id
                "coins", 0 * TON, // amount
                "uint256", 0, // validator_pubkey
                "uint32", 0, // stake_at
                "uint32", 0, // max_factor
                "uint256", 0, // adnl_addr
                "cell", ['uint256', 0, 'uint256', 0], // signature
            ],
            "exit_code": 81
        },
        // little value
        {
            "contract_balance": 1000000 * TON,
            "sender": '-1:' + VALIDATOR_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0x4e73744b, // new_stake
                "uint64", 123, // query_id
                "coins", 100 * TON, // amount
                "uint256", 0, // validator_pubkey
                "uint32", 0, // stake_at
                "uint32", 0, // max_factor
                "uint256", 0, // adnl_addr
                "cell", ['uint256', 0, 'uint256', 0], // signature
            ],
            "exit_code": 81
        },
        //  value > balance
        {
            "contract_balance": 1000000 * TON,
            "sender": '-1:' + VALIDATOR_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0x4e73744b, // new_stake
                "uint64", 123, // query_id
                "coins", 1000000 * TON, // amount
                "uint256", 0, // validator_pubkey
                "uint32", 0, // stake_at
                "uint32", 0, // max_factor
                "uint256", 0, // adnl_addr
                "cell", ['uint256', 0, 'uint256', 0], // signature
            ],
            "exit_code": 82
        },
        //  value > balance
        {
            "contract_balance": 1000000 * TON,
            "sender": '-1:' + VALIDATOR_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0x4e73744b, // new_stake
                "uint64", 123, // query_id
                "coins", 1100000 * TON, // amount
                "uint256", 0, // validator_pubkey
                "uint32", 0, // stake_at
                "uint32", 0, // max_factor
                "uint256", 0, // adnl_addr
                "cell", ['uint256', 0, 'uint256', 0], // signature
            ],
            "exit_code": 82
        },
    ],
});
