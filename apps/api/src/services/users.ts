// Accounts: guests, sign-in / upgrade, names, referral on sign-up, and the /me view.
import {
  ANTI_ABUSE, ECONOMY, FREE_AVATARS, REFERRAL, SEASON, SEASON_NUMBER, STREAK, STREAK_BOX_INDEX, dayNum, levelOf, missionsForDay,
  nameErrorText, validateName, type MeResponse, type MeUser, type MissionId, type StreakState,
} from '@podium/shared';
import type { User } from '@prisma/client';
import type { Ctx, Tx } from '../ctx';
import { AppError, conflict, invalid } from '../errors';
import { digits, shortCode } from '../util';
import { enqueueOp } from '../chain/outbox';
import { isUniqueViolation } from '../util';
import { lockUser, payReward } from './ledger';
import { notify } from './notifications';

export type Identity = { email: string } | { googleId: string; email?: string } | { wallet: string };

async function freeName(tx: Tx, prefix: 'Guest' | 'Player'): Promise<string> {
  for (let n = 6; n <= 10; n++) {
    const name = prefix + digits(n);
    if (!(await tx.user.findUnique({ where: { nameLower: name.toLowerCase() } }))) return name;
  }
  throw new Error('could not generate a free name');
}

async function freeRefCode(tx: Tx): Promise<string> {
  for (;;) {
    const refCode = shortCode(8);
    if (!(await tx.user.findUnique({ where: { refCode } }))) return refCode;
  }
}

/** Validates a chosen display name and checks it is free (case-insensitively). */
export async function checkName(tx: Tx, name: string, exceptUserId?: string): Promise<string> {
  const err = validateName(name);
  if (err) throw invalid(nameErrorText[err]);
  const taken = await tx.user.findUnique({ where: { nameLower: name.toLowerCase() } });
  if (taken && taken.id !== exceptUserId) throw conflict('That name is taken.');
  return name;
}

export interface Origin {
  deviceHash: string | null;
  ip: string | null;
}

/** The free starting balance exists only while tChips are plain test chips; in chain mode every balance is deposited or earned. */
export const startBalance = (ctx: Ctx): number => (ctx.chain ? 0 : ECONOMY.startBalance);

/**
 * The invited player's welcome bonus, paid once. In chain mode it is a reward from the on-chain
 * pot and needs a wallet, so it waits until one is linked.
 */
export async function payInvitedBonus(ctx: Ctx, tx: Tx, user: User, now: Date): Promise<void> {
  if (!user.referredById || (ctx.chain && !user.wallet)) return;
  const paid = await payReward(ctx, tx, { userId: user.id, amount: REFERRAL.invitedBonus, reason: 'referral', idemKey: `referral:invited:${user.id}`, ref: user.referredById, at: now });
  if (paid > 0) await notify(tx, user.id, 'referral', `Welcome bonus: <b>+${paid} tChips</b> for joining through an invite.`, now);
}

export async function createGuest(ctx: Ctx, o: Origin): Promise<User> {
  return ctx.db.$transaction(async (tx) => {
    const name = await freeName(tx, 'Guest');
    return tx.user.create({
      data: {
        guest: true, name, nameLower: name.toLowerCase(), refCode: await freeRefCode(tx), createdAt: ctx.clock.now(),
        balance: startBalance(ctx), boxes: ECONOMY.startBoxes, freePractice: ECONOMY.freePracticeRuns,
        deviceHash: o.deviceHash, lastIp: o.ip,
      },
    });
  });
}

export interface SignInOpts {
  /** The user of the current session, if any (a guest is upgraded in place). */
  current: User | null;
  /** The player ticked "I am 18 or over". */
  adult: boolean;
  /** Refuse to create an account without the age confirmation (email and wallet). Google confirms afterwards. */
  requireAdult: boolean;
  name?: string;
  ref?: string;
  origin: Origin;
}

/**
 * Signs in with a proven identity.
 *  - the identity already has an account: the session switches to it;
 *  - the session is a guest: that same row becomes a signed-in account and keeps its progress;
 *  - the session is already signed in: the identity is linked to it;
 *  - otherwise a new account is created.
 */
export async function signIn(ctx: Ctx, id: Identity, o: SignInOpts): Promise<{ user: User; created: boolean }> {
  const now = ctx.clock.now();
  return ctx.db.$transaction(async (tx) => {
    const idData = 'wallet' in id ? { wallet: id.wallet } : 'googleId' in id ? { googleId: id.googleId, ...(id.email ? { email: id.email } : {}) } : { email: id.email };
    let existing =
      'wallet' in id ? await tx.user.findUnique({ where: { wallet: id.wallet } })
      : 'googleId' in id ? await tx.user.findUnique({ where: { googleId: id.googleId } })
      : await tx.user.findUnique({ where: { email: id.email } });
    if (!existing && 'googleId' in id && id.email) {
      // A Google account with a verified address that already signed in by email code is the same player.
      const byEmail = await tx.user.findUnique({ where: { email: id.email } });
      if (byEmail) existing = await tx.user.update({ where: { id: byEmail.id }, data: { googleId: id.googleId } });
    }
    if (existing) {
      const user = await tx.user.update({
        where: { id: existing.id },
        data: { lastIp: o.origin.ip, deviceHash: o.origin.deviceHash ?? existing.deviceHash, ...(o.adult ? { adult: true } : {}) },
      });
      return { user, created: false };
    }
    if ('googleId' in id && id.email && (await tx.user.findUnique({ where: { email: id.email } }))) delete (idData as { email?: string }).email;

    if (o.current && !o.current.guest) {
      // In chain mode the wallet holds the player's tChips on-chain, so it can never be swapped for another.
      if (ctx.chain && 'wallet' in id && o.current.wallet && o.current.wallet !== id.wallet) throw conflict('This account already has a wallet linked.');
      const user = await tx.user.update({ where: { id: o.current.id }, data: { ...idData, ...(o.adult ? { adult: true } : {}) } });
      if (ctx.chain) {
        await payInvitedBonus(ctx, tx, user, now);
        return { user: await tx.user.findUniqueOrThrow({ where: { id: user.id } }), created: false };
      }
      return { user, created: false };
    }
    if (o.requireAdult && !o.adult) throw new AppError(403, 'not_adult', 'You must confirm you are 18 or over to create an account.');
    const name = o.name ? await checkName(tx, o.name, o.current?.id) : await freeName(tx, 'Player');
    const base = { guest: false, adult: o.adult, name, nameLower: name.toLowerCase(), lastIp: o.origin.ip, deviceHash: o.origin.deviceHash, ...idData };
    let user = o.current
      ? await tx.user.update({ where: { id: o.current.id }, data: { ...base, deviceHash: o.origin.deviceHash ?? o.current.deviceHash } })
      : await tx.user.create({
          data: {
            ...base, refCode: await freeRefCode(tx), createdAt: now,
            balance: startBalance(ctx), boxes: ECONOMY.startBoxes, freePractice: ECONOMY.freePracticeRuns,
          },
        });

    // Referral: the invited player's bonus is paid once, at sign-up. The inviter is paid later (see runs.ts).
    if (o.ref && !user.referredById) {
      const inviter = await tx.user.findUnique({ where: { refCode: o.ref.toUpperCase() } });
      const sameDevice = !!inviter?.deviceHash && inviter.deviceHash === user.deviceHash; // inviting yourself from one device
      if (inviter && inviter.id !== user.id && !inviter.guest && !sameDevice) {
        user = await tx.user.update({ where: { id: user.id }, data: { referredById: inviter.id } });
        await payInvitedBonus(ctx, tx, user, now);
        user = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      }
    }
    return { user, created: true };
  });
}

/** Links a proven wallet to a signed-in account. 409 when either side is already taken. */
export async function linkWallet(ctx: Ctx, userId: string, wallet: string): Promise<User> {
  const now = ctx.clock.now();
  try {
    return await ctx.db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const me = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (me.wallet === wallet) return me;
      if (me.wallet) throw conflict('This account already has a wallet linked.');
      if (await tx.user.findUnique({ where: { wallet } })) throw conflict('That wallet belongs to another account.');
      const u = await tx.user.update({ where: { id: userId }, data: { wallet } });
      await payInvitedBonus(ctx, tx, u, now);
      return tx.user.findUniqueOrThrow({ where: { id: userId } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('That wallet belongs to another account.');
    throw e;
  }
}

/**
 * Removes the wallet from an account that can still sign in another way (email or Google).
 * Refused in chain mode, where the wallet holds the account's test tokens. Idempotent.
 */
export async function unlinkWallet(ctx: Ctx, userId: string): Promise<User> {
  if (ctx.cfg.chain.mode !== 'off') throw conflict('In test-token mode the linked wallet holds your balance and cannot be removed.');
  return ctx.db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const me = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!me.wallet) return me;
    if (!me.email && !me.googleId) throw conflict('This wallet is how you sign in. Sign out instead, or add an email first.');
    return tx.user.update({ where: { id: userId }, data: { wallet: null } });
  });
}

/**
 * Puts an account under review, or clears it. In chain mode the wallet is frozen on-chain as
 * well (set_frozen), which blocks withdrawals there too.
 */
export async function setFlagged(ctx: Ctx, userId: string, flagged: boolean, tx?: Tx): Promise<User> {
  const apply = async (t: Tx): Promise<User> => {
    const u = await t.user.update({ where: { id: userId }, data: { flagged } });
    if (u.wallet) await enqueueOp(ctx, t, 'setFrozen', `frozen:${userId}:${+ctx.clock.now()}`, { wallet: u.wallet, frozen: flagged }, userId);
    return u;
  };
  // Inside the caller's transaction (the admin route), or in one of its own.
  return tx ? apply(tx) : ctx.db.$transaction(apply);
}

// ---------------------------------------------------------------- views
export async function ownedItems(db: Tx, userId: string): Promise<{ avatars: number[]; frames: string[] }> {
  const items = await db.item.findMany({ where: { userId } });
  const avatars = Array.from({ length: FREE_AVATARS }, (_, i) => i);
  const frames = ['none'];
  for (const it of items) {
    if (it.kind === 'avatar') avatars.push(Number(it.ref));
    else if (it.kind === 'frame') frames.push(it.ref);
  }
  return { avatars: [...new Set(avatars)].sort((a, b) => a - b), frames: [...new Set(frames)] };
}

export const rewardsUnlocked = (u: Pick<User, 'guest' | 'flagged' | 'validatedRanked'>): boolean =>
  !u.guest && !u.flagged && u.validatedRanked >= ANTI_ABUSE.minValidatedRuns;

export function streakState(u: Pick<User, 'streak' | 'streakDay'>, now: Date): StreakState {
  const d = dayNum(now);
  const claimedToday = u.streakDay === d;
  const nextDay = claimedToday ? u.streak : u.streakDay === d - 1 ? u.streak + 1 : 1;
  const i = (nextDay - 1) % STREAK.length;
  return { claimedToday, nextDay, amount: STREAK[i]!, box: i === STREAK_BOX_INDEX };
}

export function meUser(u: User, items: { avatars: number[]; frames: string[] }): MeUser {
  return {
    id: u.id, name: u.name, guest: u.guest, adult: u.adult, avatar: u.avatar, frame: u.frame, balance: u.balance, xp: u.xp,
    level: levelOf(u.xp), boxes: u.boxes, freePractice: u.freePractice, refCode: u.refCode,
    stats: { plays: u.plays, spent: u.spent, won: u.won, duelsWon: u.duelsWon, duelsLost: u.duelsLost },
    items, flagged: u.flagged,
    wallet: u.wallet, canUnlinkWallet: !!u.wallet && !!(u.email || u.googleId),
  };
}

export async function meView(ctx: Ctx, u: User, csrf: string): Promise<MeResponse> {
  const now = ctx.clock.now();
  const day = dayNum(now);
  const [items, progress, claims, unread] = await Promise.all([
    ownedItems(ctx.db, u.id),
    ctx.db.missionProgress.findMany({ where: { userId: u.id, day } }),
    ctx.db.seasonClaim.findMany({ where: { userId: u.id, season: SEASON_NUMBER } }),
    ctx.db.notification.count({ where: { userId: u.id, read: false } }),
  ]);
  const by = new Map(progress.map((p) => [p.mission, p]));
  const claimed = new Set(claims.map((c) => c.tier));
  return {
    user: meUser(u, items),
    streak: streakState(u, now),
    missions: missionsForDay(day).map((m) => ({
      id: m.id as MissionId, title: m.title, target: m.target, chips: m.chips, xp: m.xp,
      progress: Math.min(m.target, by.get(m.id)?.progress ?? 0), claimed: by.get(m.id)?.claimed ?? false,
    })),
    missionsBonusClaimed: by.has('bonus'),
    season: SEASON.map((t, tier) => ({ tier, xp: t.xp, reward: t.reward, claimed: claimed.has(tier), ready: !claimed.has(tier) && u.xp >= t.xp })),
    unread,
    csrf,
    canRefill: !ctx.chain && u.balance < ECONOMY.refillUnder,
    rewardsUnlocked: rewardsUnlocked(u),
    validatedRuns: u.validatedRanked,
    validatedRunsNeeded: ANTI_ABUSE.minValidatedRuns,
    serverTime: now.toISOString(),
    chain: ctx.chain ? { mode: ctx.chain.mode, wallet: u.wallet, needsWallet: !u.guest && !u.wallet } : null,
  };
}
