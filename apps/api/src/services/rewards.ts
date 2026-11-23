// Missions, streak, season, mystery boxes, shop and refill. Every function runs inside the caller's
// transaction (opened by the idempotency wrapper) and starts by locking the player's row.
import { randomInt } from 'node:crypto';
import {
  ANTI_ABUSE, BOX, ECONOMY, FRAMES, PAID_FRAMES, PREMIUM_AVATARS, SEASON, SEASON_NUMBER, STREAK, STREAK_BOX_INDEX, dayNum, isFrameKey,
  missionsForDay, type BoxOpenResponse, type BoxPrize, type EmissionPaid, type MissionClaimResponse, type MissionId, type RefillResponse,
  type SeasonClaimResponse, type ShopBuyRequest, type ShopBuyResponse, type ShopResponse, type StreakClaimResponse,
} from '@podium/shared';
import type { User } from '@prisma/client';
import { enqueueOp, walletOf } from '../chain/outbox';
import type { Ctx, Tx } from '../ctx';
import { AppError, conflict, forbidden, invalid, notFound } from '../errors';
import { BURNED, applyLedger, bump, emit, lockUser, readCounter } from './ledger';
import { notify } from './notifications';
import { ownedItems, rewardsUnlocked, streakState } from './users';

/** Phase 2 gating: mission, streak and inviter rewards need a few validated ranked runs and a clean account. */
export function assertRewardsUnlocked(u: User): void {
  if (rewardsUnlocked(u)) return;
  const runsLeft = Math.max(0, ANTI_ABUSE.minValidatedRuns - u.validatedRanked);
  const message = u.flagged
    ? 'Rewards are on hold while this account is reviewed.'
    : `Play ${runsLeft} more ranked ${runsLeft === 1 ? 'run' : 'runs'} to unlock rewards.`;
  throw new AppError(403, 'rewards_locked', message, { runsLeft, flagged: u.flagged });
}

const fresh = (tx: Tx, id: string): Promise<User> => tx.user.findUniqueOrThrow({ where: { id } });

export async function claimMission(ctx: Ctx, tx: Tx, userId: string, id: string): Promise<MissionClaimResponse> {
  const now = ctx.clock.now();
  const day = dayNum(now);
  await lockUser(tx, userId);
  const user = await fresh(tx, userId);
  const defs = missionsForDay(day);
  const def = defs.find((m) => m.id === id);
  if (!def) throw notFound('That is not one of today\'s missions.');
  assertRewardsUnlocked(user);
  const row = await tx.missionProgress.findUnique({ where: { userId_day_mission: { userId, day, mission: def.id } } });
  if (!row || row.progress < def.target) throw conflict('That mission is not complete yet.');
  if (row.claimed) throw conflict('That mission is already claimed.');
  await tx.missionProgress.update({ where: { id: row.id }, data: { claimed: true } });
  const paid = await emit(ctx, tx, { userId, nominal: def.chips, reason: 'mission', idemKey: `mission:${userId}:${day}:${def.id}`, ref: def.id, at: now });
  // Clearing all three adds one mystery box, once: the "bonus" row is the marker.
  const claimed = await tx.missionProgress.count({ where: { userId, day, mission: { in: defs.map((d) => d.id) }, claimed: true } });
  let bonusBox = false;
  if (claimed === defs.length) {
    const made = await tx.missionProgress.createMany({ data: [{ userId, day, mission: 'bonus', progress: 1, claimed: true }], skipDuplicates: true });
    bonusBox = made.count === 1;
    if (bonusBox) await notify(tx, userId, 'mission', 'All daily missions cleared. <b>Mystery box</b> added.', now);
  }
  const u = await tx.user.update({ where: { id: userId }, data: { xp: { increment: def.xp }, boxes: { increment: bonusBox ? 1 : 0 } } });
  return { id: def.id as MissionId, ...paid, xp: def.xp, bonusBox, balance: u.balance, boxes: u.boxes };
}

export async function claimStreak(ctx: Ctx, tx: Tx, userId: string): Promise<StreakClaimResponse> {
  const now = ctx.clock.now();
  const day = dayNum(now);
  await lockUser(tx, userId);
  const user = await fresh(tx, userId);
  assertRewardsUnlocked(user);
  const st = streakState(user, now);
  if (st.claimedToday) throw conflict('Today\'s streak is already claimed.');
  const i = (st.nextDay - 1) % STREAK.length;
  const box = i === STREAK_BOX_INDEX;
  const paid = await emit(ctx, tx, { userId, nominal: STREAK[i]!, reason: 'streak', idemKey: `streak:${userId}:${day}`, at: now });
  const u = await tx.user.update({ where: { id: userId }, data: { streak: st.nextDay, streakDay: day, boxes: { increment: box ? 1 : 0 } } });
  await notify(tx, userId, 'streak', `Daily streak day <b>${st.nextDay}</b> claimed.`, now);
  return { day: st.nextDay, box, ...paid, balance: u.balance, boxes: u.boxes };
}

export async function claimSeason(ctx: Ctx, tx: Tx, userId: string, tier: number): Promise<SeasonClaimResponse> {
  const now = ctx.clock.now();
  const t = SEASON[tier];
  if (!t) throw notFound('No such season tier.');
  await lockUser(tx, userId);
  const user = await fresh(tx, userId);
  if (user.xp < t.xp) throw conflict(`That tier unlocks at ${t.xp} XP.`);
  const made = await tx.seasonClaim.createMany({ data: [{ userId, season: SEASON_NUMBER, tier }], skipDuplicates: true });
  if (made.count === 0) throw conflict('That tier is already claimed.');
  const idemKey = `season:${userId}:${SEASON_NUMBER}:${tier}`;
  let paid: EmissionPaid = { chips: 0, nominal: 0, scaled: false };
  let fallback = false;
  let boxes = 0;
  const r = t.reward;
  if (r.kind === 'chips') paid = await emit(ctx, tx, { userId, nominal: r.amount, reason: 'season', idemKey, at: now });
  else if (r.kind === 'box') boxes = 1;
  else {
    const kind = r.kind;
    const ref = r.kind === 'avatar' ? String(r.avatar) : r.frame;
    const got = await tx.item.createMany({ data: [{ userId, kind, ref }], skipDuplicates: true });
    if (got.count === 0) {
      fallback = true;
      paid = await emit(ctx, tx, { userId, nominal: ECONOMY.ownedCosmeticFallback, reason: 'season', idemKey, at: now });
    }
  }
  const u = await tx.user.update({ where: { id: userId }, data: { boxes: { increment: boxes } } });
  return { tier, reward: r, fallback, ...paid, balance: u.balance, boxes: u.boxes };
}

/** Uniform pick from min..max in steps of BOX.step. */
const stepped = (min: number, max: number): number => min + randomInt((max - min) / BOX.step + 1) * BOX.step;
const unit = (): number => randomInt(1_000_000) / 1_000_000;

/**
 * Opens one mystery box. The outcome is drawn here, once; the idempotency record stores the answer,
 * so a replayed request returns the same prize without drawing again.
 */
export async function openBox(ctx: Ctx, tx: Tx, userId: string, openId: string): Promise<BoxOpenResponse> {
  const now = ctx.clock.now();
  await lockUser(tx, userId);
  const took = await tx.user.updateMany({ where: { id: userId, boxes: { gte: 1 } }, data: { boxes: { decrement: 1 } } });
  if (took.count === 0) throw conflict('You have no mystery boxes.');
  const own = await ownedItems(tx, userId);
  const lockedAvatars = Object.keys(PREMIUM_AVATARS).map(Number).filter((i) => !own.avatars.includes(i));
  const lockedFrames = PAID_FRAMES.filter((f) => !own.frames.includes(f));
  const r = unit();
  let prize: BoxPrize;
  if (r < BOX.cosmetic && (lockedAvatars.length || lockedFrames.length)) {
    if (lockedAvatars.length && (unit() < BOX.avatarShare || !lockedFrames.length)) {
      const avatar = lockedAvatars[randomInt(lockedAvatars.length)]!;
      await tx.item.create({ data: { userId, kind: 'avatar', ref: String(avatar) } });
      prize = { kind: 'avatar', avatar, name: PREMIUM_AVATARS[avatar]!.name };
    } else {
      const frame = lockedFrames[randomInt(lockedFrames.length)]!;
      await tx.item.create({ data: { userId, kind: 'frame', ref: frame } });
      prize = { kind: 'frame', frame, name: FRAMES[frame].name };
    }
  } else if (r < BOX.xp) {
    const amount = stepped(BOX.xpMin, BOX.xpMax);
    await tx.user.update({ where: { id: userId }, data: { xp: { increment: amount } } });
    prize = { kind: 'xp', amount };
  } else {
    const paid = await emit(ctx, tx, { userId, nominal: stepped(BOX.chipsMin, BOX.chipsMax), reason: 'box', idemKey: `box:${userId}:${openId}`, at: now });
    prize = { kind: 'chips', ...paid };
  }
  const u = await fresh(tx, userId);
  return { prize, boxes: u.boxes, balance: u.balance, xp: u.xp };
}

export async function shopBuy(ctx: Ctx, tx: Tx, userId: string, body: ShopBuyRequest, clientKey: string): Promise<ShopBuyResponse> {
  const now = ctx.clock.now();
  await lockUser(tx, userId);
  let price: number;
  let item: { kind: 'avatar' | 'frame'; ref: string } | null = null;
  if (body.kind === 'box') price = ECONOMY.boxPrice;
  else if (body.kind === 'avatar') {
    const def = typeof body.id === 'number' ? PREMIUM_AVATARS[body.id] : undefined;
    if (!def) throw invalid('No such avatar.');
    price = def.price;
    item = { kind: 'avatar', ref: String(body.id) };
  } else {
    if (!isFrameKey(body.id) || !PAID_FRAMES.includes(body.id)) throw invalid('No such frame.');
    price = FRAMES[body.id].price;
    item = { kind: 'frame', ref: body.id };
  }
  if (item && (await tx.item.findUnique({ where: { userId_kind_ref: { userId, ...item } } }))) throw conflict('You already own that.');
  const idem = `shop:${userId}:${clientKey}`;
  await applyLedger(tx, { userId, amount: -price, reason: 'shop', idemKey: idem, ref: item ? `${item.kind}:${item.ref}` : 'box', at: now, stat: 'spent' });
  const burn = Math.round(price * ECONOMY.shopBurn);
  // Chain mode: the same amount is spent on-chain and the same rounded share is burned from the mint.
  if (ctx.chain) await enqueueOp(ctx, tx, 'spend', idem, { wallet: await walletOf(tx, userId), chips: price, burn }, userId);
  const burned = await bump(tx, BURNED, burn);
  if (item) await tx.item.create({ data: { userId, ...item } });
  const u = await tx.user.update({
    where: { id: userId },
    data: body.kind === 'box' ? { boxes: { increment: 1 } } : body.kind === 'avatar' ? { avatar: Number(body.id) } : { frame: String(body.id) },
  });
  return { kind: body.kind, id: body.kind === 'box' ? null : body.id!, price, burned, balance: u.balance, boxes: u.boxes };
}

export async function shopView(ctx: Ctx, userId: string | null): Promise<ShopResponse> {
  const own = userId ? await ownedItems(ctx.db, userId) : { avatars: [] as number[], frames: [] as string[] };
  return {
    burned: await readCounter(ctx.db, BURNED),
    box: { price: ECONOMY.boxPrice },
    avatars: Object.entries(PREMIUM_AVATARS).map(([id, a]) => ({ id: Number(id), name: a.name, price: a.price, owned: own.avatars.includes(Number(id)) })),
    frames: PAID_FRAMES.map((id) => ({ id, name: FRAMES[id].name, price: FRAMES[id].price, owned: own.frames.includes(id) })),
  };
}

export async function refill(ctx: Ctx, tx: Tx, userId: string, clientKey: string): Promise<RefillResponse> {
  // Chain mode has no free tChips: every balance is a deposit, a prize or a reward from the pot.
  if (ctx.chain) throw forbidden('There is no refill while tChips are a devnet test token. Deposit test tokens from the Wallet.');
  await lockUser(tx, userId);
  const user = await fresh(tx, userId);
  if (user.balance >= ECONOMY.refillUnder) throw conflict(`Refill opens once you are under ${ECONOMY.refillUnder} tChips.`);
  const added = ECONOMY.refillTo - user.balance;
  await applyLedger(tx, { userId, amount: added, reason: 'refill', idemKey: `refill:${userId}:${clientKey}`, at: ctx.clock.now() });
  return { added, balance: ECONOMY.refillTo };
}
