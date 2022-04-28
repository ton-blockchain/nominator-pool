const {funcer} = require("./funcer");
const {
    FC, VALIDATOR_ADDR, ELECTOR_ADDR, ANYBODY_ADDR, NOMINATOR_1_ADDR, NOMINATOR_2_ADDR, makeNominator, makeStorage,
    TON, CONFIG_PARAMS
} = require("./utils");

const storage = makeStorage({
    state: 0,
    validator_set_changes_count: 3,
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
            "contract_balance": 110 * TON,
            "sender": '-1:' + VALIDATOR_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0x47657424, // recover_stake
                "uint64", 123, // query_id
            ],
            "new_data": storage,
            "out_msgs": [
                {
                    "type": "Internal",
                    "to": "-1:" + ELECTOR_ADDR,
                    "amount": 0,
                    "sendMode": 64,
                    "body": [
                        "uint32", 0x47657424, // recover_stake
                        "uint64", 123, // query_id
                    ],
                }
            ]
        },
    ],
});
