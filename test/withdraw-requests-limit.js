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
    withdraw_requests: {
        ['0x' + NOMINATOR_1_ADDR]: [],
        ['0x' + NOMINATOR_2_ADDR]: []
    }
});

const storage2 = makeStorage({
    state: 0,
    nominators_count: 1,
    config: {
        validator_address: '0x' + VALIDATOR_ADDR,
        validator_reward_share: 4000,
        max_nominators_count: 100,
        min_validator_stake: 100000 * TON,
        min_nominator_stake: 100000 * TON
    },
    nominators: {
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
    'data': storage1,
    'in_msgs': [
        {
            "contract_balance": 2000000 * TON,
            "sender": '0:' + ANYBODY_ADDR,
            "amount": 10 * TON,
            "body": [
                "uint32", 2, // withdraw requests
                "uint64", 123, // query_id
                "uint8", 1 // limit
            ],
            "new_data": storage2,
            "out_msgs": [
                {
                    "type": "Internal",
                    "to": "0:" + NOMINATOR_1_ADDR,
                    "amount": 400000 * TON,
                    "sendMode": 0,
                    "body": [],
                },
                {
                    "type": "Internal",
                    "to": "0:" + ANYBODY_ADDR,
                    "amount": 0,
                    "sendMode": 64 + 2,
                    "body": [],
                },
            ]
        },
    ],
});
