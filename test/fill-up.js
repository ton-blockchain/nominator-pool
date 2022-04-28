const {funcer} = require("./funcer");
const {
    FC, VALIDATOR_ADDR, ELECTOR_ADDR, ANYBODY_ADDR, NOMINATOR_1_ADDR, NOMINATOR_2_ADDR, makeNominator, makeStorage,
    TON, CONFIG_PARAMS
} = require("./utils");

const storage = makeStorage({
    state: 0,
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
        ['0x' + NOMINATOR_2_ADDR]: []
    }
});

funcer({'logVmOps': false, 'logFiftCode': false}, {
    'path': './func/',
    'fc': FC,
    "configParams": CONFIG_PARAMS,
    'data': storage,
    'in_msgs': [
        {
            "sender": '0:' + ANYBODY_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 1, // just_accept
                "uint64", 123, // query_id
            ],
            "new_data": storage,
            "out_msgs": []
        },
    ],
    "get_methods": [
        {
            "name": "has_withdraw_requests",
            "args": [],
            "output": [
                ["int", -1], // found
            ]
        },
        {
            "name": "get_nominator_data",
            "args": [['int', '0x' + NOMINATOR_1_ADDR]],
            "output": [
                ["int", 400000 * TON], // amount
                ["int", 0], // pending_deposit_amount
                ["int", 0], // withdraw_found
            ]
        },
        {
            "name": "get_nominator_data",
            "args": [['int', '0x' + NOMINATOR_2_ADDR]],
            "output": [
                ["int", 500000 * TON], // amount
                ["int", 200000 * TON], // pending_deposit_amount
                ["int", -1], // withdraw_found
            ]
        },
        // {
        //     "name": "get_nominator_data",
        //     "args": [['int', '0x' + ANYBODY_ADDR]],
        //     "output": [
        //         ["int", 5], // amount
        //         ["int", 2], // pending_deposit_amount
        //         ["int", 0], // withdraw_found
        //     ]
        // }
    ]
});
