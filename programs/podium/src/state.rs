use crate::errors::PodiumError;
use anchor_lang::prelude::*;

pub const BPS: u64 = 10_000;
pub const MAX_WINNERS: usize = 5;

pub const DUEL_OPEN: u8 = 0;
pub const DUEL_MATCHED: u8 = 1;
pub const DUEL_SETTLED: u8 = 2;
pub const DUEL_REFUNDED: u8 = 3;

/// floor(amount * num / den) without intermediate overflow.
pub fn mul_div(amount: u64, num: u64, den: u64) -> Result<u64> {
    require!(den != 0, PodiumError::Overflow);
    let v = (amount as u128).checked_mul(num as u128).ok_or(PodiumError::Overflow)? / den as u128;
    u64::try_from(v).map_err(|_| error!(PodiumError::Overflow))
}

pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(|| error!(PodiumError::Overflow))
}

pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or_else(|| error!(PodiumError::Overflow))
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub mint: Pubkey,
    /// Token account at PDA [b"vault"], token authority = this config PDA.
    pub vault: Pubkey,
    /// Token account that `treasury_withdraw` pays to. Fixed at initialize.
    pub treasury_wallet: Pubkey,
    pub fee_bps: u16,
    pub burn_bps: u16,
    pub vest_seconds: i64,
    /// Base units per whole chip. Used only as the rounding tolerance on payout and burn caps.
    pub unit: u64,
    /// Sequence number of the last applied operator instruction.
    pub op_seq: u64,
    pub treasury_balance: u64,
    pub rewards_balance: u64,
    pub total_player_balance: u64,
    pub total_escrow: u64,
    pub total_burned: u64,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    /// Everything the vault must be able to cover.
    pub fn liabilities(&self) -> Result<u64> {
        add(add(add(self.treasury_balance, self.rewards_balance)?, self.total_player_balance)?, self.total_escrow)
    }

    /// Operator instructions are applied in strict order: seq must be op_seq + 1.
    pub fn take_seq(&mut self, seq: u64, allowed_while_paused: bool) -> Result<()> {
        require!(allowed_while_paused || !self.paused, PodiumError::Paused);
        require!(Some(seq) == self.op_seq.checked_add(1), PodiumError::BadSequence);
        self.op_seq = seq;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub wallet: Pubkey,
    /// Spendable in games and withdrawable.
    pub available: u64,
    /// Vesting reward tokens: spendable in games, not withdrawable before `unlock_at`.
    pub locked: u64,
    /// Never decreases.
    pub unlock_at: i64,
    pub frozen: bool,
    pub bump: u8,
}

impl Player {
    /// Matured locked tokens become available. Called first by every instruction touching a player.
    pub fn fold(&mut self, now: i64) -> Result<()> {
        if self.locked > 0 && now >= self.unlock_at {
            self.available = add(self.available, self.locked)?;
            self.locked = 0;
        }
        Ok(())
    }

    /// Takes `amount` from available first, then locked. Returns how much came from locked.
    pub fn debit(&mut self, amount: u64) -> Result<u64> {
        let from_available = amount.min(self.available);
        let from_locked = amount - from_available;
        require!(from_locked <= self.locked, PodiumError::InsufficientBalance);
        self.available -= from_available;
        self.locked -= from_locked;
        Ok(from_locked)
    }

    /// Credits `amount`, of which `locked_share` vests until at least `now + vest_seconds`.
    pub fn credit_vesting(&mut self, amount: u64, locked_share: u64, now: i64, vest_seconds: i64) -> Result<()> {
        let free = sub(amount, locked_share)?;
        self.available = add(self.available, free)?;
        if locked_share > 0 {
            self.locked = add(self.locked, locked_share)?;
            let until = now.checked_add(vest_seconds).ok_or(PodiumError::Overflow)?;
            self.unlock_at = self.unlock_at.max(until);
            self.fold(now)?; // vest_seconds == 0
        }
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    /// 0 weekly, 1 cup.
    pub kind: u8,
    pub game: [u8; 16],
    pub period_start: i64,
    pub period_end: i64,
    // entry, fee_bps, split_bps and winners are written once in create_pool and never again.
    pub entry: u64,
    pub fee_bps: u16,
    /// Shares of the after-fee pot per place. Unused places are zero.
    pub split_bps: [u16; 5],
    pub winners: u8,
    pub total: u64,
    /// How much of `total` came from players' locked balances.
    pub locked_part: u64,
    pub entries: u32,
    pub closed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Duel {
    pub id: [u8; 16],
    pub creator: Pubkey,
    /// Pubkey::default() until matched.
    pub joiner: Pubkey,
    pub stake: u64,
    /// Copied from the config at open; later config changes do not affect this duel.
    pub fee_bps: u16,
    /// 0 open, 1 matched, 2 settled, 3 refunded.
    pub state: u8,
    /// How much of the pot came from locked balances.
    pub locked_part: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}
