const {funcer} = require("./funcer");
const {
    FC, VALIDATOR_ADDR, ELECTOR_ADDR, ANYBODY_ADDR, NOMINATOR_1_ADDR, NOMINATOR_2_ADDR, makeNominator, makeStorage,
    TON, CONFIG_PARAMS
} = require("./utils");

const storage1 = makeStorage({
    state: 2,
    nominators_count: 2,
    stake_amount_sent: 800000 * TON,
    validator_amount: 123000 * TON,
    config: {
        validator_address: '0x' + VALIDATOR_ADDR,
        validator_reward_share: (0.2 * 10000),
        max_nominators_count: 100,
        min_validator_stake: 100000 * TON,
        min_nominator_stake: 100000 * TON
    },
    nominators: {
        ['0x' + NOMINATOR_1_ADDR]: makeNominator(400000 * TON, 0),
        ['0x' + NOMINATOR_2_ADDR]: makeNominator(600000 * TON, 200000 * TON)
    },
    withdraw_requests: {
        ['0x' + NOMINATOR_2_ADDR]: []
    }
});

const storage2 = makeStorage({
    state: 0,
    nominators_count: 2,
    stake_amount_sent: 0 * TON,
    validator_amount: 123000 * TON + (200 * 0.2) * TON,
    config: {
        validator_address: '0x' + VALIDATOR_ADDR,
        validator_reward_share: (0.2 * 10000),
        max_nominators_count: 100,
        min_validator_stake: 100000 * TON,
        min_nominator_stake: 100000 * TON
    },
    nominators: {
        ['0x' + NOMINATOR_1_ADDR]: makeNominator(400000 * TON + (200 * 0.8) * TON * 0.4, 0),
        ['0x' + NOMINATOR_2_ADDR]: makeNominator(600000 * TON + 200000 * TON + (200 * 0.8)  * TON * 0.6, 0)
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
            "sender": '-1:' + ELECTOR_ADDR,
            "amount": 800200 * TON,
            "body": [
                "uint32", 0xf96f7324, // recover_stake_ok
                "uint64", 123, // query_id
            ],
            "new_data": storage2,
            "out_msgs": []
        },
    ],
});
