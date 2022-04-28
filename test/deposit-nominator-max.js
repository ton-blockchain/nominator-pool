const {funcer} = require("./funcer");
const {
    FC, VALIDATOR_ADDR, ELECTOR_ADDR, ANYBODY_ADDR, NOMINATOR_1_ADDR, NOMINATOR_2_ADDR, makeNominator, makeStorage,
    TON, CONFIG_PARAMS
} = require("./utils");

const storage = (state, amount, pending_deposit_amount, nominators_count) => {
    return makeStorage({
        state,
        nominators_count,
        config: {
            validator_address: '0x' + VALIDATOR_ADDR,
            validator_reward_share: 4000,
            max_nominators_count: 2,
            min_validator_stake: 100000 * TON,
            min_nominator_stake: 100000 * TON
        },
        nominators: {
            ['0x' + NOMINATOR_1_ADDR]: makeNominator(400000 * TON, 0),
            ['0x' + NOMINATOR_2_ADDR]: makeNominator(amount, pending_deposit_amount)
        },
        withdraw_requests: {
            ['0x' + NOMINATOR_2_ADDR]: []
        }
    });
}


funcer({'logVmOps': false, 'logFiftCode': false}, {
    'path': './func/',
    'fc': FC,
    "configParams": CONFIG_PARAMS,
    'data': makeStorage({
        state: 0,
        nominators_count: 1,
        config: {
            validator_address: '0x' + VALIDATOR_ADDR,
            validator_reward_share: 4000,
            max_nominators_count: 1,
            min_validator_stake: 100000 * TON,
            min_nominator_stake: 100000 * TON
        },
        nominators: {
            ['0x' + NOMINATOR_1_ADDR]: makeNominator(400000 * TON, 0),
        },
        withdraw_requests: {
            ['0x' + NOMINATOR_2_ADDR]: []
        }
    }),
    'in_msgs': [
        {
            "sender": '0:' + NOMINATOR_2_ADDR,
            "amount": 200000 * TON,
            "body": [
                "uint32", 0, // simple transfer
                "uint8", 100, // 'd' - deposit nominator
            ],
            "exit_code": 65,
        },
    ],
});
