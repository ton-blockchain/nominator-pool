const {funcer} = require("./funcer");
const {
    FC, VALIDATOR_ADDR, ELECTOR_ADDR, ANYBODY_ADDR, NOMINATOR_1_ADDR, NOMINATOR_2_ADDR, makeNominator, makeStorage,
    TON, CONFIG_PARAMS
} = require("./utils");

const storage1 = makeStorage({
    state: 0,
    nominators_count: 2,
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
    withdraw_requests: {}
});

funcer({'logVmOps': false, 'logFiftCode': false}, {
    'path': './func/',
    'fc': FC,
    "configParams": CONFIG_PARAMS,
    'data': storage1,
    'in_msgs': [
        // not enough for storage
        {
            "contract_balance": 400000 * TON,
            "sender": '0:' + NOMINATOR_1_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0, // simple transfer
                "uint8", 119, // 'w' - withdraw request nominator
            ],
            "out_msgs": [
                {
                    "type": "Internal",
                    "to": "0:" + NOMINATOR_1_ADDR,
                    "amount": 0,
                    "sendMode": 64 + 2,
                    "body": [],
                }
            ]
        },
        // not enough contract balance
        {
            "contract_balance": 21 * TON,
            "sender": '0:' + NOMINATOR_1_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 0, // simple transfer
                "uint8", 119, // 'w' - withdraw request nominator
            ],
            "out_msgs": [
                {
                    "type": "Internal",
                    "to": "0:" + NOMINATOR_1_ADDR,
                    "amount": 0,
                    "sendMode": 64 + 2,
                    "body": [],
                }
            ]
        },
    ],
});
