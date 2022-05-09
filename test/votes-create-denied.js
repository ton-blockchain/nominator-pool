const {funcer} = require("./funcer");
const {
    FC, VALIDATOR_ADDR, ELECTOR_ADDR, ANYBODY_ADDR, NOMINATOR_1_ADDR, NOMINATOR_2_ADDR, makeNominator, makeStorage,
    TON, CONFIG_PARAMS
} = require("./utils");

const storage = (votes) => {
    return makeStorage({
        votes,
        config: {
            validator_address: '0x' + VALIDATOR_ADDR,
            validator_reward_share: 4000,
            max_nominators_count: 100,
            min_validator_stake: 100000 * TON,
            min_nominator_stake: 100000 * TON
        },
        nominators: {
            ['0x' + NOMINATOR_1_ADDR]: makeNominator(400000 * TON, 0),
            ['0x' + NOMINATOR_2_ADDR]: makeNominator(0, 400000 * TON)
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
    'data': storage({}),
    'in_msgs': [
        {
            "sender": '0:' + ANYBODY_ADDR,
            "amount": 8 * TON,
            "body": [
                "uint32", 0, // op = 0 - text comment
                "uint8", 121, // "y"
                "uint256", "21796157974083048550319244236929488537086114760591164995662604048548353814576", // 0000
                "uint256", "21796157974083048550319244236929488537086114760591164995662604048548353880627", // 00123
            ],
            "exit_code": 122
        },
    ],
});
