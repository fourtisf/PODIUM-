//! Podium Phase 3 ledger. DEVNET / LOCAL VALIDATOR ONLY. The token is a valueless test token.
//! Mainnet is locked until the owner has a written legal opinion and a contract audit.
//!
//! TRUST MODEL: hybrid custody.
//!
//! The program owns one token vault. Players deposit the SPL token into the vault and withdraw
//! from it. Every in-game movement (pool entries, pool payouts, duel locks and settlements, shop
//! spends with burn, reward credits) is internal accounting inside this program, submitted by an
//! OPERATOR key (the game server). Game results are decided off-chain by server-side replay; this
//! program cannot verify a score, so it trusts the operator to say WHO won. A compromised or
//! dishonest operator can therefore misdirect pool and duel payouts, charge entries and shop
//! spends to any registered player, and refuse to co-sign withdrawals. It cannot do more than
//! that, because the program enforces:
//!
//!  * balances never go negative (checked arithmetic everywhere, overflow-checks on);
//!  * a pool's entry, fee and split are fixed when the pool is created and never change;
//!  * payouts never exceed what the pool or duel holds, nor what the fixed split / fee allows
//!    (plus one `unit` of rounding tolerance); what is not paid out goes to the treasury balance;
//!  * a duel pays only its creator or joiner;
//!  * rewards are paid only from a funded rewards pot, never minted;
//!  * reward tokens vest: spendable in games at once, withdrawable only after `unlock_at`, and the
//!    locked fraction of a pool or duel pot stays locked in the winner's hands;
//!  * a strictly increasing operation sequence number makes operator instructions idempotent;
//!  * a withdrawal needs the player's AND the operator's signature and can only go to a token
//!    account owned by the player's wallet; the operator alone cannot move tokens out of the
//!    vault (only the admin can, and only the treasury balance, to the fixed treasury wallet);
//!  * the vault always holds at least
//!    treasury_balance + rewards_balance + total_player_balance + total_escrow;
//!  * the admin can pause.
//!
//! Every instruction logs one line starting with "podium:" for the indexer.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

pub mod errors;
pub mod state;

use errors::PodiumError;
use state::*;

// declare_id!("...") with the id chosen at build time (see build.rs).
include!(concat!(env!("OUT_DIR"), "/program_id.rs"));

pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const PLAYER_SEED: &[u8] = b"player";
pub const POOL_SEED: &[u8] = b"pool";
pub const DUEL_SEED: &[u8] = b"duel";

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

/// Re-reads the vault and checks it covers the ledger. Called after every token movement.
fn assert_solvent<'info>(config: &Config, vault: &mut Account<'info, TokenAccount>) -> Result<()> {
    vault.reload()?;
    require!(vault.amount >= config.liabilities()?, PodiumError::VaultInvariant);
    Ok(())
}

fn vault_transfer<'info>(
    config: &Account<'info, Config>,
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer { from: vault.to_account_info(), to: to.to_account_info(), authority: config.to_account_info() },
            &[seeds],
        ),
        amount,
    )
}

#[program]
pub mod podium {
    use super::*;

    // ------------------------------------------------------------------ admin

    pub fn initialize(
        ctx: Context<Initialize>,
        operator: Pubkey,
        fee_bps: u16,
        burn_bps: u16,
        vest_seconds: i64,
        unit: u64,
    ) -> Result<()> {
        require!(fee_bps as u64 <= BPS && burn_bps as u64 <= BPS, PodiumError::InvalidParam);
        require!(vest_seconds >= 0 && unit > 0, PodiumError::InvalidParam);
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.operator = operator;
        c.mint = ctx.accounts.mint.key();
        c.vault = ctx.accounts.vault.key();
        c.treasury_wallet = ctx.accounts.treasury_wallet.key();
        c.fee_bps = fee_bps;
        c.burn_bps = burn_bps;
        c.vest_seconds = vest_seconds;
        c.unit = unit;
        c.op_seq = 0;
        c.treasury_balance = 0;
        c.rewards_balance = 0;
        c.total_player_balance = 0;
        c.total_escrow = 0;
        c.total_burned = 0;
        c.paused = false;
        c.bump = ctx.bumps.config;
        msg!(
            "podium:initialize admin={} operator={} mint={} vault={} treasury_wallet={} fee_bps={} burn_bps={} vest_seconds={} unit={}",
            c.admin, c.operator, c.mint, c.vault, c.treasury_wallet, fee_bps, burn_bps, vest_seconds, unit
        );
        Ok(())
    }

    pub fn set_operator(ctx: Context<AdminOnly>, operator: Pubkey) -> Result<()> {
        ctx.accounts.config.operator = operator;
        msg!("podium:set_operator operator={}", operator);
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        msg!("podium:set_paused paused={}", paused as u8);
        Ok(())
    }

    /// Applies to rewards credited from now on; existing unlock times are not shortened.
    pub fn set_vest_seconds(ctx: Context<AdminOnly>, vest_seconds: i64) -> Result<()> {
        require!(vest_seconds >= 0, PodiumError::InvalidParam);
        ctx.accounts.config.vest_seconds = vest_seconds;
        msg!("podium:set_vest_seconds vest_seconds={}", vest_seconds);
        Ok(())
    }

    /// Collected fees leave the vault, only to the treasury wallet fixed at initialize.
    pub fn treasury_withdraw(ctx: Context<TreasuryWithdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, PodiumError::InvalidAmount);
        let c = &mut ctx.accounts.config;
        require!(amount <= c.treasury_balance, PodiumError::InsufficientTreasury);
        c.treasury_balance -= amount;
        vault_transfer(&ctx.accounts.config, &ctx.accounts.vault, &ctx.accounts.treasury_wallet, &ctx.accounts.token_program, amount)?;
        assert_solvent(&ctx.accounts.config, &mut ctx.accounts.vault)?;
        msg!("podium:treasury_withdraw amount={} treasury_balance={}", amount, ctx.accounts.config.treasury_balance);
        Ok(())
    }

    /// Fees fund rewards.
    pub fn treasury_to_rewards(ctx: Context<AdminOnly>, amount: u64) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require!(amount > 0, PodiumError::InvalidAmount);
        require!(amount <= c.treasury_balance, PodiumError::InsufficientTreasury);
        c.treasury_balance -= amount;
        c.rewards_balance = add(c.rewards_balance, amount)?;
        msg!("podium:treasury_to_rewards amount={} treasury_balance={} rewards_balance={}", amount, c.treasury_balance, c.rewards_balance);
        Ok(())
    }

    // ------------------------------------------------------------------ anyone

    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        require!(amount > 0, PodiumError::InvalidAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.source.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
        )?;
        let c = &mut ctx.accounts.config;
        c.rewards_balance = add(c.rewards_balance, amount)?;
        assert_solvent(&ctx.accounts.config, &mut ctx.accounts.vault)?;
        msg!("podium:fund_rewards funder={} amount={} rewards_balance={}", ctx.accounts.funder.key(), amount, ctx.accounts.config.rewards_balance);
        Ok(())
    }

    pub fn register_player(ctx: Context<RegisterPlayer>, wallet: Pubkey) -> Result<()> {
        let p = &mut ctx.accounts.player;
        p.wallet = wallet;
        p.available = 0;
        p.locked = 0;
        p.unlock_at = 0;
        p.frozen = false;
        p.bump = ctx.bumps.player;
        msg!("podium:register_player wallet={}", wallet);
        Ok(())
    }

    // ------------------------------------------------------------------ player

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, PodiumError::InvalidAmount);
        require!(!ctx.accounts.config.paused, PodiumError::Paused);
        let now = now()?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.source.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.wallet.to_account_info(),
                },
            ),
            amount,
        )?;
        let p = &mut ctx.accounts.player;
        p.fold(now)?;
        p.available = add(p.available, amount)?;
        let c = &mut ctx.accounts.config;
        c.total_player_balance = add(c.total_player_balance, amount)?;
        assert_solvent(&ctx.accounts.config, &mut ctx.accounts.vault)?;
        msg!("podium:deposit wallet={} amount={} available={} locked={}", p.wallet, amount, p.available, p.locked);
        Ok(())
    }

    /// Needs the player's signature and the operator's (the server checks its own ledger first).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, PodiumError::InvalidAmount);
        require!(!ctx.accounts.config.paused, PodiumError::Paused);
        let now = now()?;
        let p = &mut ctx.accounts.player;
        require!(!p.frozen, PodiumError::Frozen);
        p.fold(now)?;
        require!(amount <= p.available, PodiumError::InsufficientBalance);
        p.available -= amount;
        let c = &mut ctx.accounts.config;
        c.total_player_balance = sub(c.total_player_balance, amount)?;
        vault_transfer(&ctx.accounts.config, &ctx.accounts.vault, &ctx.accounts.destination, &ctx.accounts.token_program, amount)?;
        assert_solvent(&ctx.accounts.config, &mut ctx.accounts.vault)?;
        let p = &ctx.accounts.player;
        msg!("podium:withdraw wallet={} amount={} available={} locked={}", p.wallet, amount, p.available, p.locked);
        Ok(())
    }

    // ------------------------------------------------------------------ operator

    pub fn create_pool(
        ctx: Context<CreatePool>,
        seq: u64,
        kind: u8,
        game: [u8; 16],
        period_start: i64,
        period_end: i64,
        entry: u64,
        split_bps: [u16; 5],
        winners: u8,
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.take_seq(seq, false)?;
        require!(kind <= 1, PodiumError::InvalidParam);
        require!(period_end > period_start, PodiumError::InvalidParam);
        require!(entry > 0, PodiumError::InvalidAmount);
        require!(winners >= 1 && winners as usize <= MAX_WINNERS, PodiumError::BadSplit);
        let mut sum: u64 = 0;
        for (i, s) in split_bps.iter().enumerate() {
            require!(i < winners as usize || *s == 0, PodiumError::BadSplit);
            sum += *s as u64;
        }
        require!(sum <= BPS, PodiumError::BadSplit);
        let pool = &mut ctx.accounts.pool;
        pool.kind = kind;
        pool.game = game;
        pool.period_start = period_start;
        pool.period_end = period_end;
        pool.entry = entry;
        pool.fee_bps = c.fee_bps;
        pool.split_bps = split_bps;
        pool.winners = winners;
        pool.total = 0;
        pool.locked_part = 0;
        pool.entries = 0;
        pool.closed = false;
        pool.bump = ctx.bumps.pool;
        msg!(
            "podium:create_pool seq={} pool={} kind={} period_start={} period_end={} entry={} fee_bps={} winners={} split_bps={},{},{},{},{}",
            seq, pool.key(), kind, period_start, period_end, entry, pool.fee_bps, winners,
            split_bps[0], split_bps[1], split_bps[2], split_bps[3], split_bps[4]
        );
        Ok(())
    }

    pub fn enter_pool(ctx: Context<EnterPool>, seq: u64) -> Result<()> {
        let now = now()?;
        let c = &mut ctx.accounts.config;
        c.take_seq(seq, false)?;
        let before = c.liabilities()?;
        let pool = &mut ctx.accounts.pool;
        require!(!pool.closed, PodiumError::PoolClosed);
        let p = &mut ctx.accounts.player;
        p.fold(now)?;
        let from_locked = p.debit(pool.entry)?;
        pool.total = add(pool.total, pool.entry)?;
        pool.locked_part = add(pool.locked_part, from_locked)?;
        pool.entries = pool.entries.checked_add(1).ok_or(PodiumError::Overflow)?;
        c.total_player_balance = sub(c.total_player_balance, pool.entry)?;
        c.total_escrow = add(c.total_escrow, pool.entry)?;
        require!(c.liabilities()? == before, PodiumError::VaultInvariant);
        msg!(
            "podium:enter_pool seq={} pool={} wallet={} amount={} from_locked={} pool_total={} entries={}",
            seq, pool.key(), p.wallet, pool.entry, from_locked, pool.total, pool.entries
        );
        Ok(())
    }

    /// Remaining accounts: the winners' Player accounts (writable), in place order, one per payout.
    pub fn close_pool<'info>(ctx: Context<'_, '_, 'info, 'info, ClosePool<'info>>, seq: u64, payouts: Vec<u64>) -> Result<()> {
        let now = now()?;
        let c = &mut ctx.accounts.config;
        c.take_seq(seq, false)?;
        let before = c.liabilities()?;
        let pool = &mut ctx.accounts.pool;
        require!(!pool.closed, PodiumError::PoolClosed);
        require!(now >= pool.period_end, PodiumError::PoolNotEnded);
        require!(payouts.len() <= pool.winners as usize, PodiumError::PayoutTooHigh);
        require!(ctx.remaining_accounts.len() == payouts.len(), PodiumError::BadWinners);

        let total = pool.total;
        let min_fee = mul_div(total, pool.fee_bps as u64, BPS)?;
        let pot = sub(total, min_fee)?;
        let mut paid: u64 = 0;
        for (i, payout) in payouts.iter().enumerate() {
            let cap = add(mul_div(pot, pool.split_bps[i] as u64, BPS)?, c.unit)?;
            require!(*payout <= cap, PodiumError::PayoutTooHigh);
            paid = add(paid, *payout)?;
        }
        require!(paid <= add(pot, c.unit)? && paid <= total, PodiumError::PayoutTooHigh);
        let fee = total - paid;

        for (i, payout) in payouts.iter().enumerate() {
            let info = &ctx.remaining_accounts[i];
            // A player can hold one place only.
            require!(ctx.remaining_accounts[..i].iter().all(|a| a.key != info.key), PodiumError::BadWinners);
            require!(info.is_writable, PodiumError::BadWinners);
            // Checks the account is owned by this program and is a Player.
            let mut winner: Account<Player> = Account::try_from(info)?;
            winner.fold(now)?;
            // The locked fraction of the pool stays locked for the winner.
            let locked_share = if total == 0 { 0 } else { mul_div(*payout, pool.locked_part, total)? };
            winner.credit_vesting(*payout, locked_share, now, c.vest_seconds)?;
            winner.exit(&crate::ID)?;
            msg!(
                "podium:pool_payout seq={} pool={} place={} wallet={} amount={} locked_share={}",
                seq, pool.key(), i + 1, winner.wallet, payout, locked_share
            );
        }

        c.total_escrow = sub(c.total_escrow, total)?;
        c.total_player_balance = add(c.total_player_balance, paid)?;
        c.treasury_balance = add(c.treasury_balance, fee)?;
        pool.closed = true;
        require!(c.liabilities()? == before, PodiumError::VaultInvariant);
        msg!("podium:close_pool seq={} pool={} total={} paid={} fee={} entries={}", seq, pool.key(), total, paid, fee, pool.entries);
        Ok(())
    }

    pub fn duel_open(ctx: Context<DuelOpen>, seq: u64, id: [u8; 16], stake: u64, expires_at: i64) -> Result<()> {
        let now = now()?;
        let c = &mut ctx.accounts.config;
        c.take_seq(seq, false)?;
        let before = c.liabilities()?;
        require!(stake > 0, PodiumError::InvalidAmount);
        require!(expires_at > now, PodiumError::InvalidParam);
        let p = &mut ctx.accounts.creator;
        p.fold(now)?;
        let from_locked = p.debit(stake)?;
        let d = &mut ctx.accounts.duel;
        d.id = id;
        d.creator = p.wallet;
        d.joiner = Pubkey::default();
        d.stake = stake;
        d.fee_bps = c.fee_bps;
        d.state = DUEL_OPEN;
        d.locked_part = from_locked;
        d.created_at = now;
        d.expires_at = expires_at;
        d.bump = ctx.bumps.duel;
        c.total_player_balance = sub(c.total_player_balance, stake)?;
        c.total_escrow = add(c.total_escrow, stake)?;
        require!(c.liabilities()? == before, PodiumError::VaultInvariant);
        msg!(
            "podium:duel_open seq={} duel={} creator={} stake={} from_locked={} fee_bps={} expires_at={}",
            seq, d.key(), d.creator, stake, from_locked, d.fee_bps, expires_at
        );
        Ok(())
    }

    pub fn duel_join(ctx: Context<DuelJoin>, seq: u64) -> Result<()> {
        let now = now()?;
        let c = &mut ctx.accounts.config;
        c.take_seq(seq, false)?;
        let before = c.liabilities()?;
        let d = &mut ctx.accounts.duel;
        require!(d.state == DUEL_OPEN, PodiumError::BadDuelState);
        require!(now < d.expires_at, PodiumError::DuelExpired);
        let p = &mut ctx.accounts.joiner;
        require!(p.wallet != d.creator, PodiumError::BadDuelState);
        p.fold(now)?;
        let from_locked = p.debit(d.stake)?;
        d.joiner = p.wallet;
        d.state = DUEL_MATCHED;
        d.locked_part = add(d.locked_part, from_locked)?;
        c.total_player_balance = sub(c.total_player_balance, d.stake)?;
        c.total_escrow = add(c.total_escrow, d.stake)?;
        require!(c.liabilities()? == before, PodiumError::VaultInvariant);
        msg!("podium:duel_join seq={} duel={} joiner={} stake={} from_locked={}", seq, d.key(), d.joiner, d.stake, from_locked);
        Ok(())
    }

    /// Matched duel: pays `payout` to the winner (creator or joiner), the rest to the treasury;
    /// with no winner account the whole pot goes to the treasury.
    /// Open duel (creator forfeits): no winner is possible, the stake goes to the treasury.
    pub fn duel_settle(ctx: Context<DuelSettle>, seq: u64, payout: u64) -> Result<()> {
        let now = now()?;
        let c = &mut ctx.accounts.config;
        c.take_seq(seq, false)?;
        let before = c.liabilities()?;
        let d = &mut ctx.accounts.duel;
        let pot = match d.state {
            DUEL_OPEN => d.stake,
            DUEL_MATCHED => add(d.stake, d.stake)?,
            _ => return err!(PodiumError::BadDuelState),
        };
        let min_fee = mul_div(pot, d.fee_bps as u64, BPS)?;
        require!(payout <= add(sub(pot, min_fee)?, c.unit)? && payout <= pot, PodiumError::PayoutTooHigh);
        let mut locked_share = 0;
        let mut winner_key = Pubkey::default();
        match ctx.accounts.winner.as_mut() {
            Some(w) => {
                require!(d.state == DUEL_MATCHED, PodiumError::BadDuelState);
                require!(w.wallet == d.creator || w.wallet == d.joiner, PodiumError::BadDuelWinner);
                w.fold(now)?;
                locked_share = mul_div(payout, d.locked_part, pot)?;
                w.credit_vesting(payout, locked_share, now, c.vest_seconds)?;
                winner_key = w.wallet;
            }
            None => require!(payout == 0, PodiumError::PayoutTooHigh),
        }
        let fee = pot - payout;
        c.total_escrow = sub(c.total_escrow, pot)?;
        c.total_player_balance = add(c.total_player_balance, payout)?;
        c.treasury_balance = add(c.treasury_balance, fee)?;
        d.state = DUEL_SETTLED;
        require!(c.liabilities()? == before, PodiumError::VaultInvariant);
        msg!(
            "podium:duel_settle seq={} duel={} winner={} pot={} payout={} locked_share={} fee={}",
            seq, d.key(), winner_key, pot, payout, locked_share, fee
        );
        Ok(())
    }

    /// Open duels only. Allowed while paused.
    pub fn duel_refund(ctx: Context<DuelRefund>, seq: u64) -> Result<()> {
        let now = now()?;
        let c = &mut ctx.accounts.config;
        c.take_seq(seq, true)?;
        let before = c.liabilities()?;
        let d = &mut ctx.accounts.duel;
        require!(d.state == DUEL_OPEN, PodiumError::BadDuelState);
        let p = &mut ctx.accounts.creator;
        p.fold(now)?;
        // What came from locked goes back to locked under the player's own unlock time. unlock_at
        // never decreases, so it is at least the time that applied when the stake was taken.
        let back_locked = d.locked_part;
        p.available = add(p.available, sub(d.stake, back_locked)?)?;
        if back_locked > 0 {
            p.locked = add(p.locked, back_locked)?;
            if p.unlock_at == 0 {
                p.unlock_at = now.checked_add(c.vest_seconds).ok_or(PodiumError::Overflow)?;
            }
            p.fold(now)?;
        }
        c.total_escrow = sub(c.total_escrow, d.stake)?;
        c.total_player_balance = add(c.total_player_balance, d.stake)?;
        d.state = DUEL_REFUNDED;
        require!(c.liabilities()? == before, PodiumError::VaultInvariant);
        msg!("podium:duel_refund seq={} duel={} creator={} stake={} to_locked={}", seq, d.key(), d.creator, d.stake, back_locked);
        Ok(())
    }

    /// Shop purchase: the player pays `amount`; `burn_amount` is burned from the vault, the rest
    /// goes to the treasury balance.
    pub fn spend(ctx: Context<Spend>, seq: u64, amount: u64, burn_amount: u64) -> Result<()> {
        let now = now()?;
        let c = &mut ctx.accounts.config;
        c.take_seq(seq, false)?;
        let before = c.liabilities()?;
        require!(amount > 0, PodiumError::InvalidAmount);
        let cap = add(mul_div(amount, c.burn_bps as u64, BPS)?, c.unit)?;
        require!(burn_amount <= cap && burn_amount <= amount, PodiumError::BurnTooHigh);
        let p = &mut ctx.accounts.player;
        p.fold(now)?;
        let from_locked = p.debit(amount)?;
        c.total_player_balance = sub(c.total_player_balance, amount)?;
        c.treasury_balance = add(c.treasury_balance, amount - burn_amount)?;
        c.total_burned = add(c.total_burned, burn_amount)?;
        require!(add(c.liabilities()?, burn_amount)? == before, PodiumError::VaultInvariant);
        if burn_amount > 0 {
            let seeds: &[&[u8]] = &[CONFIG_SEED, &[c.bump]];
            token::burn(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.vault.to_account_info(),
                        authority: c.to_account_info(),
                    },
                    &[seeds],
                ),
                burn_amount,
            )?;
        }
        assert_solvent(&ctx.accounts.config, &mut ctx.accounts.vault)?;
        msg!(
            "podium:spend seq={} wallet={} amount={} burned={} to_treasury={} from_locked={}",
            seq, ctx.accounts.player.wallet, amount, burn_amount, amount - burn_amount, from_locked
        );
        Ok(())
    }

    /// Rewards come out of the funded pot and vest.
    pub fn credit_reward(ctx: Context<PlayerOp>, seq: u64, amount: u64) -> Result<()> {
        let now = now()?;
        let c = &mut ctx.accounts.config;
        c.take_seq(seq, false)?;
        let before = c.liabilities()?;
        require!(amount > 0, PodiumError::InvalidAmount);
        require!(amount <= c.rewards_balance, PodiumError::InsufficientRewards);
        c.rewards_balance -= amount;
        c.total_player_balance = add(c.total_player_balance, amount)?;
        let p = &mut ctx.accounts.player;
        p.fold(now)?;
        p.credit_vesting(amount, amount, now, c.vest_seconds)?;
        require!(c.liabilities()? == before, PodiumError::VaultInvariant);
        msg!(
            "podium:credit_reward seq={} wallet={} amount={} unlock_at={} rewards_balance={}",
            seq, p.wallet, amount, p.unlock_at, c.rewards_balance
        );
        Ok(())
    }

    pub fn set_frozen(ctx: Context<PlayerOp>, seq: u64, frozen: bool) -> Result<()> {
        ctx.accounts.config.take_seq(seq, false)?;
        let p = &mut ctx.accounts.player;
        p.frozen = frozen;
        msg!("podium:set_frozen seq={} wallet={} frozen={}", seq, p.wallet, frozen as u8);
        Ok(())
    }
}

// ---------------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(init, payer = admin, seeds = [VAULT_SEED], bump, token::mint = mint, token::authority = config)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(token::mint = mint)]
    pub treasury_wallet: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct TreasuryWithdraw<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, address = config.vault @ PodiumError::BadAccount)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, address = config.treasury_wallet @ PodiumError::BadAccount)]
    pub treasury_wallet: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    pub funder: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, token::mint = config.mint)]
    pub source: Account<'info, TokenAccount>,
    #[account(mut, address = config.vault @ PodiumError::BadAccount)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct RegisterPlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Player::INIT_SPACE, seeds = [PLAYER_SEED, wallet.as_ref()], bump)]
    pub player: Account<'info, Player>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub wallet: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PLAYER_SEED, wallet.key().as_ref()], bump = player.bump, has_one = wallet @ PodiumError::Unauthorized)]
    pub player: Account<'info, Player>,
    #[account(mut, token::mint = config.mint, token::authority = wallet)]
    pub source: Account<'info, TokenAccount>,
    #[account(mut, address = config.vault @ PodiumError::BadAccount)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub wallet: Signer<'info>,
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PLAYER_SEED, wallet.key().as_ref()], bump = player.bump, has_one = wallet @ PodiumError::Unauthorized)]
    pub player: Account<'info, Player>,
    #[account(mut, address = config.vault @ PodiumError::BadAccount)]
    pub vault: Account<'info, TokenAccount>,
    /// Must be a token account owned by the player's wallet.
    #[account(mut, token::mint = config.mint, token::authority = wallet)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(seq: u64, kind: u8, game: [u8; 16], period_start: i64)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init, payer = operator, space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, &[kind], game.as_ref(), &period_start.to_le_bytes()], bump
    )]
    pub pool: Account<'info, Pool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnterPool<'info> {
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &[pool.kind], pool.game.as_ref(), &pool.period_start.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [PLAYER_SEED, player.wallet.as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct ClosePool<'info> {
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &[pool.kind], pool.game.as_ref(), &pool.period_start.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
#[instruction(seq: u64, id: [u8; 16])]
pub struct DuelOpen<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init, payer = operator, space = 8 + Duel::INIT_SPACE, seeds = [DUEL_SEED, id.as_ref()], bump)]
    pub duel: Account<'info, Duel>,
    #[account(mut, seeds = [PLAYER_SEED, creator.wallet.as_ref()], bump = creator.bump)]
    pub creator: Account<'info, Player>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DuelJoin<'info> {
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [DUEL_SEED, duel.id.as_ref()], bump = duel.bump)]
    pub duel: Account<'info, Duel>,
    #[account(mut, seeds = [PLAYER_SEED, joiner.wallet.as_ref()], bump = joiner.bump)]
    pub joiner: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct DuelSettle<'info> {
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [DUEL_SEED, duel.id.as_ref()], bump = duel.bump)]
    pub duel: Account<'info, Duel>,
    /// Optional: pass the program id in this slot for "no winner".
    #[account(mut)]
    pub winner: Option<Account<'info, Player>>,
}

#[derive(Accounts)]
pub struct DuelRefund<'info> {
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [DUEL_SEED, duel.id.as_ref()], bump = duel.bump)]
    pub duel: Account<'info, Duel>,
    #[account(
        mut, seeds = [PLAYER_SEED, creator.wallet.as_ref()], bump = creator.bump,
        constraint = creator.wallet == duel.creator @ PodiumError::BadAccount
    )]
    pub creator: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct Spend<'info> {
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PLAYER_SEED, player.wallet.as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    #[account(mut, address = config.mint @ PodiumError::BadAccount)]
    pub mint: Account<'info, Mint>,
    #[account(mut, address = config.vault @ PodiumError::BadAccount)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// credit_reward and set_frozen.
#[derive(Accounts)]
pub struct PlayerOp<'info> {
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ PodiumError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PLAYER_SEED, player.wallet.as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
}
