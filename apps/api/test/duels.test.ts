import { DUEL_JOINER_TIMEOUT_HOURS, ECONOMY, XP, dayNum, duelFee, duelPayout, type CreateDuelResponse, type DuelsResponse, type NotificationsResponse, type StartRunResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { expireDuels } from '../src/services/duels';
import { GAME, OTHER_GAME, distinctPlans, errCode, freshApp, guest, ledgerCount, playRun, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

const START = ECONOMY.startBalance;
const fees = async (): Promise<number> => (await t.ctx.db.counter.findUnique({ where: { key: 'fees:' + dayNum(t.now()) } }))?.value ?? 0;

test('duels need a signed-in adult account, an offered stake and an Idempotency-Key', async () => {
  expect((await (await visitor(t)).post('/duels', { game: GAME, stake: 50 })).status).toBe(401);
  expect((await (await visitor(t)).get('/duels')).status).toBe(401);
  expect(errCode(await (await guest(t)).post('/duels', { game: GAME, stake: 50 }))).toBe('guest_not_allowed');
  const c = await signUp(t);
  expect((await c.post('/duels', { game: GAME, stake: 75 })).status).toBe(400);
  expect((await c.post('/duels', { game: 'nope', stake: 50 })).status).toBe(400);
  expect((await c.post('/duels', { game: GAME, stake: 50 }, { idem: null })).status).toBe(400);
  await t.ctx.db.user.update({ where: { id: c.id }, data: { balance: 49 } });
  expect(errCode(await c.post('/duels', { game: GAME, stake: 50 }))).toBe('not_enough_chips');
  expect(await t.ctx.db.duel.count()).toBe(0);
  expect((await c.get<DuelsResponse>('/duels')).body).toEqual({ open: null, waiting: [], history: [], won: 0, lost: 0 });
});

test('two accounts complete a duel: the winner nets payout minus stake, the loser loses the stake; replays change nothing', async () => {
  const stake = 100;
  const [low, high] = distinctPlans(GAME, t.seed, 2);
  const a = await signUp(t, { name: 'Creator' });
  const b = await signUp(t, { name: 'Joiner' });
  const feesBefore = await fees();

  const created = await a.post<CreateDuelResponse>('/duels', { game: GAME, stake }, { idem: 'duel-create-01' });
  expect(created.status).toBe(200);
  expect(created.body).toMatchObject({ role: 'creator', target: null, opponent: null, balance: START - stake });
  expect(created.body.duel).toMatchObject({ status: 'waiting', canPlay: true, stake, game: GAME });
  const replayed = await a.post<CreateDuelResponse>('/duels', { game: GAME, stake }, { idem: 'duel-create-01' });
  expect(replayed.body).toEqual(created.body);
  expect(await t.ctx.db.duel.count({ where: { creatorId: a.id } })).toBe(1);
  expect(await a.balance()).toBe(START - stake);
  // One open duel at a time.
  expect((await a.post('/duels', { game: GAME, stake })).status).toBe(409);
  const duelId = created.body.duel.id;

  // Nobody can join before the creator has a score: Ben would create his own duel, so he waits.
  const aRun = await playRun(a, GAME, 'duel', { duelId, plan: low });
  expect(aRun.start.body.entry).toBe(0);
  expect(aRun.finish.body).toMatchObject({ score: low!.score, badges: ['duel_waiting'], duel: { won: null, opponent: null, payout: 0, stake } });
  expect(await a.balance()).toBe(START - stake);
  expect((await a.post('/runs', { game: GAME, mode: 'duel', duelId })).status).toBe(409); // one run per side
  expect((await a.get<DuelsResponse>('/duels')).body).toMatchObject({ open: null, waiting: [{ id: duelId, myScore: low!.score, canPlay: false }] });

  const joined = await b.post<CreateDuelResponse>('/duels', { game: GAME, stake });
  expect(joined.body).toMatchObject({ role: 'joiner', target: low!.score, opponent: 'Creator', balance: START - stake });
  expect(joined.body.duel).toMatchObject({ id: duelId, status: 'matched', canPlay: true });
  expect((await b.get<DuelsResponse>('/duels')).body.open).toMatchObject({ id: duelId, role: 'joiner', target: low!.score });
  expect((await (await signUp(t)).post('/runs', { game: GAME, mode: 'duel', duelId })).status).toBe(404); // not a participant

  const bRun = await playRun(b, GAME, 'duel', { duelId, plan: high, idem: 'duel-finish-01' });
  expect(bRun.finish.status).toBe(200);
  const payout = duelPayout(stake);
  expect(bRun.finish.body).toMatchObject({
    score: high!.score, xpGained: XP.duelWin, badges: ['duel_won'],
    duel: { won: true, opponent: 'Creator', opponentScore: low!.score, payout, stake },
    user: { balance: START - stake + payout },
  });
  expect(bRun.finish.body.top5).toEqual([{ place: 1, name: 'Joiner', score: high!.score, me: true }, { place: 2, name: 'Creator', score: low!.score, me: false }]);
  // Replaying the finish does not pay again.
  const again = await b.post(`/runs/${bRun.start.body.runId}/finish`, { score: high!.score, frames: high!.frames, inputLog: high!.log }, { idem: 'duel-finish-01' });
  expect(again.body).toEqual(bRun.finish.body);

  expect(await b.balance()).toBe(START - stake + payout); // net +payout - stake
  expect(await a.balance()).toBe(START - stake);
  expect(payout).toBe(Math.round(stake * 2 * (1 - ECONOMY.fee)));
  expect(await ledgerCount(t, b.id, 'duel')).toBe(2); // stake out, winnings in
  expect(await fees()).toBe(feesBefore + duelFee(stake));
  const [ua, ub] = await Promise.all([a.me(), b.me()]);
  expect(ub.user).toMatchObject({ xp: XP.duelWin, stats: { duelsWon: 1, duelsLost: 0, won: payout, spent: stake } });
  expect(ua.user).toMatchObject({ xp: XP.duelLoss, stats: { duelsWon: 0, duelsLost: 1, won: 0 } });
  const duel = await t.ctx.db.duel.findUniqueOrThrow({ where: { id: duelId } });
  expect(duel).toMatchObject({ status: 'settled', winnerId: b.id, creatorScore: low!.score, joinerScore: high!.score });

  const hb = (await b.get<DuelsResponse>('/duels')).body;
  expect(hb).toMatchObject({ open: null, won: 1, lost: 0 });
  expect(hb.history).toEqual([{ id: duelId, game: GAME, opponent: 'Creator', myScore: high!.score, theirScore: low!.score, win: true, amount: payout - stake }]);
  const ha = (await a.get<DuelsResponse>('/duels')).body;
  expect(ha.history).toEqual([{ id: duelId, game: GAME, opponent: 'Joiner', myScore: low!.score, theirScore: high!.score, win: false, amount: -stake }]);
  const na = (await a.get<NotificationsResponse>('/notifications')).body.items.map((n) => n.body);
  expect(na.some((x) => x.includes('<b>Joiner</b> beat you'))).toBe(true);
  const nb = (await b.get<NotificationsResponse>('/notifications')).body.items.map((n) => n.body);
  expect(nb.some((x) => x.startsWith('You won a duel against <b>Creator</b>'))).toBe(true);
});

test('a tie goes to the earlier score (the creator)', async () => {
  const stake = 250;
  const [p] = distinctPlans(GAME, t.seed, 1);
  const a = await signUp(t, { name: 'TieFirst' });
  const b = await signUp(t, { name: 'TieSecond' });
  const d = await a.post<CreateDuelResponse>('/duels', { game: GAME, stake });
  await playRun(a, GAME, 'duel', { duelId: d.body.duel.id, plan: p });
  const j = await b.post<CreateDuelResponse>('/duels', { game: GAME, stake });
  expect(j.body.role).toBe('joiner');
  const fin = await playRun(b, GAME, 'duel', { duelId: d.body.duel.id, plan: p });
  expect(fin.finish.body).toMatchObject({ badges: ['duel_lost'], xpGained: XP.duelLoss, duel: { won: false, payout: 0, opponentScore: p!.score } });
  expect(fin.finish.body.top5.map((r) => r.name)).toEqual(['TieFirst', 'TieSecond']);
  expect(await a.balance()).toBe(START - stake + duelPayout(stake));
  expect(await b.balance()).toBe(START - stake);
});

test('nobody joins within the expiry window: the stake is refunded once', async () => {
  const stake = 500;
  const [p] = distinctPlans(OTHER_GAME, t.seed, 1);
  const a = await signUp(t, { name: 'Lonely' });
  const d = await a.post<CreateDuelResponse>('/duels', { game: OTHER_GAME, stake });
  await playRun(a, OTHER_GAME, 'duel', { duelId: d.body.duel.id, plan: p });
  expect(await a.balance()).toBe(START - stake);
  expect(await expireDuels(t.ctx, t.now())).toEqual({ refunded: 0, forfeited: 0 });
  t.advance(ECONOMY.duelExpiryHours * 3_600_000 + 1000);
  expect(await expireDuels(t.ctx, t.now())).toEqual({ refunded: 1, forfeited: 0 });
  expect(await expireDuels(t.ctx, t.now())).toEqual({ refunded: 0, forfeited: 0 });
  expect(await a.balance()).toBe(START);
  expect(await ledgerCount(t, a.id, 'duel_refund')).toBe(1);
  expect((await t.ctx.db.ledger.findFirstOrThrow({ where: { userId: a.id, reason: 'duel_refund' } })).idemKey).toBe(`refund:${d.body.duel.id}`);
  expect((await t.ctx.db.duel.findUniqueOrThrow({ where: { id: d.body.duel.id } })).status).toBe('refunded');
  // An expired duel is not offered to a late joiner: they get a duel of their own.
  const late = await signUp(t);
  expect((await late.post<CreateDuelResponse>('/duels', { game: OTHER_GAME, stake })).body.role).toBe('creator');
});

test('a joiner who never finishes forfeits to the creator', async () => {
  const stake = 50;
  const [p] = distinctPlans(OTHER_GAME, t.seed, 1);
  const a = await signUp(t, { name: 'Patient' });
  const b = await signUp(t, { name: 'NoShow' });
  const d = await a.post<CreateDuelResponse>('/duels', { game: OTHER_GAME, stake });
  await playRun(a, OTHER_GAME, 'duel', { duelId: d.body.duel.id, plan: p });
  expect((await b.post<CreateDuelResponse>('/duels', { game: OTHER_GAME, stake })).body.role).toBe('joiner');
  t.advance(DUEL_JOINER_TIMEOUT_HOURS * 3_600_000 + 1000);
  expect(await expireDuels(t.ctx, t.now())).toMatchObject({ forfeited: 1 });
  expect(await expireDuels(t.ctx, t.now())).toMatchObject({ forfeited: 0 });
  expect(await a.balance()).toBe(START - stake + duelPayout(stake));
  expect(await b.balance()).toBe(START - stake);
  expect((await t.ctx.db.duel.findUniqueOrThrow({ where: { id: d.body.duel.id } }))).toMatchObject({ status: 'settled', winnerId: a.id, joinerScore: null });
});

test('a rejected duel run forfeits: the joiner loses to the creator; a creator\'s stake goes to fees', async () => {
  const stake = 50;
  const [p] = distinctPlans(GAME, t.seed, 1);
  const a = await signUp(t, { name: 'Honest' });
  const b = await signUp(t, { name: 'Cheater' });
  const d = await a.post<CreateDuelResponse>('/duels', { game: GAME, stake });
  await playRun(a, GAME, 'duel', { duelId: d.body.duel.id, plan: p });
  await b.post('/duels', { game: GAME, stake });
  const cheat = await playRun(b, GAME, 'duel', { duelId: d.body.duel.id, plan: p, waitMs: 0 });
  expect(cheat.finish.status).toBe(422);
  expect(await a.balance()).toBe(START - stake + duelPayout(stake));
  expect(await b.balance()).toBe(START - stake);
  expect((await t.ctx.db.duel.findUniqueOrThrow({ where: { id: d.body.duel.id } })).winnerId).toBe(a.id);

  const c = await signUp(t, { name: 'SelfFoul' });
  const before = await fees();
  const own = await c.post<CreateDuelResponse>('/duels', { game: GAME, stake });
  expect(own.body.role).toBe('creator');
  const foul = await playRun(c, GAME, 'duel', { duelId: own.body.duel.id, plan: p, waitMs: 0 });
  expect(foul.finish.status).toBe(422);
  expect(await c.balance()).toBe(START - stake);
  expect((await t.ctx.db.duel.findUniqueOrThrow({ where: { id: own.body.duel.id } }))).toMatchObject({ status: 'settled', winnerId: null });
  expect(await fees()).toBe(before + stake);
  await expireDuels(t.ctx, new Date(+t.now() + 48 * 3_600_000));
  expect(await c.balance()).toBe(START - stake); // a forfeited stake is never refunded
  expect(await ledgerCount(t, c.id, 'duel_refund')).toBe(0);
});

test('a duel run needs the duel\'s game and a duel that is waiting for it', async () => {
  const a = await signUp(t);
  const d = await a.post<CreateDuelResponse>('/duels', { game: OTHER_GAME, stake: 250 });
  expect((await a.post('/runs', { game: GAME, mode: 'duel', duelId: d.body.duel.id })).status).toBe(400);
  expect((await a.post('/runs', { game: OTHER_GAME, mode: 'duel', duelId: 'missing' })).status).toBe(404);
  const ok = await a.post<StartRunResponse>('/runs', { game: OTHER_GAME, mode: 'duel', duelId: d.body.duel.id });
  expect(ok.body).toMatchObject({ entry: 0, balance: START - 250 });
});
