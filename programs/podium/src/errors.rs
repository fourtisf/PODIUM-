use anchor_lang::prelude::*;

// Codes start at 6000 in this order. packages/chain/src/errors.ts mirrors the list: append only.
#[error_code]
pub enum PodiumError {
    #[msg("Signer is not allowed to do this")]
    Unauthorized, // 6000
    #[msg("The program is paused")]
    Paused, // 6001
    #[msg("The player is frozen")]
    Frozen, // 6002
    #[msg("Operation sequence must be exactly config.op_seq + 1")]
    BadSequence, // 6003
    #[msg("Player balance is too low")]
    InsufficientBalance, // 6004
    #[msg("The rewards pot does not hold that much")]
    InsufficientRewards, // 6005
    #[msg("The treasury balance does not hold that much")]
    InsufficientTreasury, // 6006
    #[msg("The pool is closed")]
    PoolClosed, // 6007
    #[msg("The pool period has not ended")]
    PoolNotEnded, // 6008
    #[msg("Payout is above what the fixed split and fee allow")]
    PayoutTooHigh, // 6009
    #[msg("Split must sum to at most 10000 bps, with unused places zero")]
    BadSplit, // 6010
    #[msg("Winner accounts do not match the payouts")]
    BadWinners, // 6011
    #[msg("The duel is not in a state that allows this")]
    BadDuelState, // 6012
    #[msg("The duel has expired")]
    DuelExpired, // 6013
    #[msg("Winner must be the duel's creator or joiner")]
    BadDuelWinner, // 6014
    #[msg("Burn is above what burn_bps allows")]
    BurnTooHigh, // 6015
    #[msg("Arithmetic overflow")]
    Overflow, // 6016
    #[msg("Invalid amount")]
    InvalidAmount, // 6017
    #[msg("Invalid parameter")]
    InvalidParam, // 6018
    #[msg("Account does not match the config or the player")]
    BadAccount, // 6019
    #[msg("Vault holds less than the ledger owes")]
    VaultInvariant, // 6020
}
