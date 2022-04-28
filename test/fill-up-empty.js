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
    },
    withdraw_requests: {
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
                ["int", 0], // found
            ]
        },
    ]
});
