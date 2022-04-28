const ELECTOR_ADDR = '3333333333333333333333333333333333333333333333333333333333333333';
const VALIDATOR_ADDR = '348bcf827469c5fc38541c77fdd91d4e347eac200f6f2d9fd62dc08885f0415f';
const NOMINATOR_1_ADDR = '448bcf827469c5fc38541c77fdd91d4e347eac200f6f2d9fd62dc08885f0415f';
const NOMINATOR_2_ADDR = '548bcf827469c5fc38541c77fdd91d4e347eac200f6f2d9fd62dc08885f0415f';
const ANYBODY_ADDR = '648bcf827469c5fc38541c77fdd91d4e347eac200f6f2d9fd62dc08885f0415f';

const FC = [
    'stdlib.fc',
    'pool.fc',
];

const TON = 1e9;

const CONFIG_PARAMS = {
    1: [
        'cell', [
            "uint256", '0x' + ELECTOR_ADDR, // elector address
        ]
    ],
    15: [
        'cell', [
            'uint32', 0, // validators_elected_for
            'uint32', 0, // elections_start_before
            'uint32', 0, // elections_end_before
            'uint32', 0, // stake_held_for
        ]
    ],
    34: [
        'cell', [
            'uint8', 0x12,
            'uint32', 0, // utime_since
            'uint32', 0, // utime_until
        ]
    ],
    40: [
        'cell', [
            'uint8', 0,
            'coins', 101 * TON, 'uint32', 0,
            'uint16', 0, 'uint16', 0,
            'uint16', 0,
            'uint16', 0, 'uint16', 0, 'uint16', 0,
        ]
    ]
};

const makeNominator = (amount, pendingDepositAmount) => {
    return ['coins', amount, 'coins', pendingDepositAmount];
}

const makeStorageConfig = ({
                               validator_address,
                               validator_reward_share,
                               max_nominators_count,
                               min_validator_stake,
                               min_nominator_stake
                           }) => {
    return [
        'uint256', validator_address || 0,
        'uint16', validator_reward_share || 0,
        'uint16', max_nominators_count || 0,
        'coins', min_validator_stake || 0,
        'coins', min_nominator_stake || 0,
    ]
}

const makeStorage = ({
                         state,
                         nominators_count,
                         stake_amount_sent,
                         validator_amount,
                         config,
                         nominators,
                         withdraw_requests,
                         saved_validator_set_hash,
                         validator_set_changes_count,
                         votes
                     }) => {
    return [
        "uint8", state || 0, // state
        "uint16", nominators_count || 0, // nominators_count
        "coins", stake_amount_sent || 0, // stake_amount_sent
        "coins", validator_amount || 0, // validator_amount
        "cell", makeStorageConfig(config || {}),
        "uint256->any", nominators || {}, // nominators
        "uint256->any", withdraw_requests || {}, // withdraw_requests
        "uint32", 0, // stake_at
        "uint256", saved_validator_set_hash || 0, // saved_validator_set_hash
        "uint8", validator_set_changes_count || 0, // validator_set_changes_count
        "uint32", 0, // validator_set_change_time
        "uint32", 0, // stake_held_for,
        "uint256->any", votes || {}, // config_proposal_votings
    ];
}

module.exports = {
    ELECTOR_ADDR,
    VALIDATOR_ADDR,
    NOMINATOR_1_ADDR,
    NOMINATOR_2_ADDR,
    ANYBODY_ADDR,
    FC,
    TON,
    CONFIG_PARAMS,
    makeNominator,
    makeStorageConfig,
    makeStorage,
};
