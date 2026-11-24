// /api/admin: operator tools. Operators come from ADMIN_EMAILS / ADMIN_WALLETS only.
import {
  ECONOMY, XP,
  type AdminOverviewResponse, type AdminRunActionResponse, type AdminRunsResponse, type AdminUserActionResponse, type AdminUserDetail, type AdminUsersResponse,
  type FinishRunResponse, type LeaderboardResponse, type StartRunResponse,
} from '@podium/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { settleRun } from '../src/services/runs';
import { CHAIN_READY, chainApp, drain, walletUser, type ChainTest } from './chain-helpers';
import { Client, GAME, errCode, freshApp, guest, plan, playRun, signUp, visitor, type TestApp } from './helpers';

const BOSS = 'boss@example.com';

let t: TestApp;
let admin: Client;
beforeAll(async () => {
  t = await freshApp({ config: { adminEmails: [BOSS], adminWallets: [] } });
  admin = await signUp(t, { email: BOSS, name: 'Boss' });
});
afterAll(() => t.close());

/** A ranked run of `c` that the judge flagged (machine-regular timing): held, off the board, entry kept. */
async function flaggedRun(c: Client): Promise<{ runId: string; score: number; frames: number }> {
  const s = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'ranked' });
  expect(s.status).toBe(200);
  const p = plan(GAME, s.body.seed, 1);
  t.advance((p.frames / 60) * 1000 + 500);
  const input = { frames: p.frames, log: p.log, clientScore: p.score };
  const out = await t.ctx.db.$transaction((tx) => settleRun(t.ctx, tx, s.body.runId, input, { kind: 'flag', score: p.score, seconds: p.frames / 60, reason: 'machine-regular input timing' }, 0));
  expect(out.body).toMatchObject({ status: 'flagged', rewardsHeld: true });
  return { runId: s.body.runId, score: p.score, frames: p.frames };
}

const ROUTES: [method: 'get' | 'post', url: string][] = [
  ['get', '/admin/overview'],
  ['get', '/admin/runs?status=flagged'],
  ['post', '/admin/runs/x/approve'],
  ['post', '/admin/runs/x/reject'],
  ['get', '/admin/users?q=a'],
  ['get', '/admin/users/x'],
  ['post', '/admin/users/x/flag'],
  ['post', '/admin/users/x/clear-hold'],
];

test('unauthenticated calls get 401 and everyone who is not listed gets 403', async () => {
  const anon = await visitor(t);
  const g = await guest(t);
  const player = await signUp(t, { email: 'player@example.com' });
  for (const [m, url] of ROUTES) {
    const body = m === 'post' ? { flagged: true } : undefined;
    expect((m === 'get' ? await anon.get(url) : await anon.post(url, body)).status, url).toBe(401);
    expect(errCode(m === 'get' ? await g.get(url) : await g.post(url, body)), url).toBe('forbidden');
    const r = m === 'get' ? await player.get(url) : await player.post(url, body);
    expect([r.status, errCode(r)], url).toEqual([403, 'forbidden']);
  }
  // Mutations still need the CSRF token and an Idempotency-Key, admin or not.
  expect(errCode(await admin.post('/admin/users/x/flag', { flagged: true }, { csrf: null }))).toBe('csrf');
  expect((await admin.post(`/admin/users/${player.id}/flag`, { flagged: true }, { idem: null })).status).toBe(400);
  expect(await t.ctx.db.adminAction.count()).toBe(0);
});

test('overview counts real rows', async () => {
  const p = await signUp(t);
  await playRun(p, GAME, 'ranked');
  await flaggedRun(p);
  const r = await admin.get<AdminOverviewResponse>('/admin/overview');
  expect(r.status).toBe(200);
  const users = await t.ctx.db.user.count();
  expect(r.body).toMatchObject({ users, signedInUsers: await t.ctx.db.user.count({ where: { guest: false } }), flaggedPending: 1, openDuels: 0, chain: null });
  expect(r.body.runsToday).toBeGreaterThanOrEqual(2);
  expect(r.body.pools.find((x) => x.game === GAME)!.pool).toBe(2 * ECONOMY.rankedEntry);
  expect(r.body.pools).toHaveLength(13);
  // Clean up for the next tests: this flagged run is rejected through the API.
  const list = await admin.get<AdminRunsResponse>('/admin/runs?status=flagged');
  for (const run of list.body.runs) expect((await admin.post(`/admin/runs/${run.id}/reject`, { note: 'cleanup' })).status).toBe(200);
});

test('approving a flagged run settles it exactly once, like an accepted run', async () => {
  const p = await signUp(t, { name: 'Held' });
  const f = await flaggedRun(p);
  const before = await t.ctx.db.user.findUniqueOrThrow({ where: { id: p.id } });
  expect(await t.ctx.db.score.count({ where: { userId: p.id } })).toBe(0);

  const list = await admin.get<AdminRunsResponse>('/admin/runs?status=flagged');
  expect(list.status).toBe(200);
  const row = list.body.runs.find((r) => r.id === f.runId)!;
  expect(row).toMatchObject({ user: { id: p.id, name: 'Held' }, game: GAME, mode: 'ranked', status: 'flagged', score: f.score, clientScore: f.score, reason: 'machine-regular input timing' });
  expect(row.press).not.toBeNull();
  expect(list.body.next).toBeNull();

  const ok = await admin.post<AdminRunActionResponse>(`/admin/runs/${f.runId}/approve`, { note: 'looked human' }, { idem: 'admin-approve-1' });
  expect(ok.status).toBe(200);
  expect(ok.body.run).toMatchObject({ id: f.runId, status: 'finished', score: f.score });
  const replay = await admin.post<AdminRunActionResponse>(`/admin/runs/${f.runId}/approve`, { note: 'looked human' }, { idem: 'admin-approve-1' });
  expect(replay.body).toEqual(ok.body);
  expect(replay.headers['idempotent-replay']).toBe('true');
  // A second approval (new key) finds nothing to approve; a reject after approval is refused too.
  expect((await admin.post(`/admin/runs/${f.runId}/approve`)).status).toBe(409);
  expect((await admin.post(`/admin/runs/${f.runId}/reject`)).status).toBe(409);

  const run = await t.ctx.db.run.findUniqueOrThrow({ where: { id: f.runId } });
  expect(run).toMatchObject({ status: 'finished', rewardsHeld: false });
  // Board: one score row, the run's replayed score.
  expect(await t.ctx.db.score.findMany({ where: { userId: p.id }, select: { score: true, runId: true } })).toEqual([{ score: f.score, runId: f.runId }]);
  const board = await new Client(t).get<LeaderboardResponse>('/leaderboard/' + GAME);
  expect(board.body.rows.filter((r) => r.userId === p.id).map((r) => r.score)).toEqual([f.score]);
  const after = await t.ctx.db.user.findUniqueOrThrow({ where: { id: p.id } });
  const xp = (f.frames / 60 >= XP.minRunSeconds ? XP.rankedRun : 0) + XP.personalBest;
  expect(after.xp - before.xp).toBe(xp);
  expect(after).toMatchObject({ rankedDone: before.rankedDone + 1, validatedRanked: before.validatedRanked + 1, balance: before.balance });
  expect(await t.ctx.db.adminAction.findMany({ where: { targetRunId: f.runId }, select: { action: true, adminId: true, targetUserId: true, note: true } })).toEqual([
    { action: 'run.approve', adminId: admin.id, targetUserId: p.id, note: 'looked human' },
  ]);
  // The player's own client, finishing late, gets the approved result.
  const fin = await p.post<FinishRunResponse>(`/runs/${f.runId}/finish`, { score: f.score, frames: f.frames, inputLog: [] });
  expect(fin.body).toMatchObject({ status: 'finished', newBest: true, rewardsHeld: false });
  expect(await t.ctx.db.score.count({ where: { userId: p.id } })).toBe(1);
});

test('rejecting a flagged run pays nothing and keeps the entry', async () => {
  const p = await signUp(t);
  const f = await flaggedRun(p);
  const before = await p.balance();
  const r = await admin.post<AdminRunActionResponse>(`/admin/runs/${f.runId}/reject`, { note: 'bot' }, { idem: 'admin-reject-1' });
  expect(r.status).toBe(200);
  expect(r.body.run).toMatchObject({ status: 'rejected' });
  expect((await admin.post<AdminRunActionResponse>(`/admin/runs/${f.runId}/reject`, { note: 'bot' }, { idem: 'admin-reject-1' })).body).toEqual(r.body);
  expect((await admin.post(`/admin/runs/${f.runId}/reject`)).status).toBe(409);
  expect((await admin.post(`/admin/runs/${f.runId}/approve`)).status).toBe(409);
  expect(await p.balance()).toBe(before);
  expect(await t.ctx.db.score.count({ where: { userId: p.id } })).toBe(0);
  expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: p.id } })).xp).toBe(0);
  expect(await t.ctx.db.adminAction.count({ where: { targetRunId: f.runId, action: 'run.reject' } })).toBe(1);
  const rejected = await admin.get<AdminRunsResponse>('/admin/runs?status=rejected');
  expect(rejected.body.runs.map((x) => x.id)).toContain(f.runId);
  expect((await admin.post('/admin/runs/missing/approve')).status).toBe(404);
});

test('user search and detail', async () => {
  const p = await signUp(t, { name: 'Findable', email: 'findable@example.com' });
  await playRun(p, GAME, 'practice');
  for (const q of ['findab', 'FINDABLE@EX', p.id]) {
    const r = await admin.get<AdminUsersResponse>('/admin/users?q=' + encodeURIComponent(q));
    expect(r.status).toBe(200);
    expect(r.body.users.map((u) => u.name), q).toEqual(['Findable']);
  }
  expect((await admin.get<AdminUsersResponse>('/admin/users')).body.users.length).toBeLessThanOrEqual(20);
  const d = await admin.get<AdminUserDetail>('/admin/users/' + p.id);
  expect(d.status).toBe(200);
  expect(d.body).toMatchObject({ id: p.id, name: 'Findable', email: 'findable@example.com', guest: false, flagged: false, chainHold: false, balance: await p.balance() });
  expect(d.body.runs).toHaveLength(1);
  expect(d.body.ledger.length).toBeGreaterThanOrEqual(0);
  expect((await admin.get('/admin/users/nope')).status).toBe(404);
});

test('flag and unflag an account; clear-hold needs chain mode', async () => {
  const p = await signUp(t);
  const on = await admin.post<AdminUserActionResponse>(`/admin/users/${p.id}/flag`, { flagged: true, note: 'cluster' }, { idem: 'admin-flag-1' });
  expect(on.status).toBe(200);
  expect(on.body.user).toMatchObject({ id: p.id, flagged: true });
  expect((await admin.post<AdminUserActionResponse>(`/admin/users/${p.id}/flag`, { flagged: true, note: 'cluster' }, { idem: 'admin-flag-1' })).body).toEqual(on.body);
  expect(await t.ctx.db.adminAction.count({ where: { targetUserId: p.id } })).toBe(1);
  expect((await p.me()).user.flagged).toBe(true);
  const off = await admin.post<AdminUserActionResponse>(`/admin/users/${p.id}/flag`, { flagged: false });
  expect(off.body.user.flagged).toBe(false);
  expect((await admin.post(`/admin/users/${p.id}/flag`, {})).status).toBe(400);
  expect((await admin.post('/admin/users/nope/flag', { flagged: true })).status).toBe(404);
  expect((await admin.get<AdminUserDetail>('/admin/users/' + p.id)).body.actions.map((a) => [a.action, a.admin])).toEqual([['user.unflag', 'Boss'], ['user.flag', 'Boss']]);
  // No chain mode, no holds.
  expect((await admin.post(`/admin/users/${p.id}/clear-hold`)).status).toBe(409);
  expect(await t.ctx.db.chainOp.count()).toBe(0);
});

describe.skipIf(!CHAIN_READY)('chain mode', () => {
  let c: ChainTest;
  beforeAll(async () => {
    await t.close();
    c = await chainApp();
  });
  afterAll(async () => {
    await c.close();
    t = await freshApp(); // so the file-level afterAll has an app to close
  });

  test('a listed wallet is an operator; flagging freezes the wallet on-chain; clear-hold releases a hold', async () => {
    const boss = await walletUser(c);
    const p = await walletUser(c, { deposit: 100 });
    expect((await boss.get('/admin/overview')).status).toBe(403);
    c.ctx.cfg.adminWallets = [boss.address];
    const ov = await boss.get<AdminOverviewResponse>('/admin/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.chain).toMatchObject({ holds: 0 });

    const r = await boss.post<AdminUserActionResponse>(`/admin/users/${p.id}/flag`, { flagged: true });
    expect(r.body.user.flagged).toBe(true);
    expect(await c.ctx.db.chainOp.count({ where: { kind: 'setFrozen', userId: p.id } })).toBe(1);
    await drain(c);
    expect((await c.world.player(p.kp.publicKey))!.frozen).toBe(true);
    await boss.post(`/admin/users/${p.id}/flag`, { flagged: false });
    await drain(c);
    expect((await c.world.player(p.kp.publicKey))!.frozen).toBe(false);

    await c.ctx.db.user.update({ where: { id: p.id }, data: { chainHold: true } });
    const cleared = await boss.post<AdminUserActionResponse>(`/admin/users/${p.id}/clear-hold`, { note: 'checked' }, { idem: 'admin-hold-1' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.user.chainHold).toBe(false);
    expect((await boss.post<AdminUserActionResponse>(`/admin/users/${p.id}/clear-hold`, { note: 'checked' }, { idem: 'admin-hold-1' })).body).toEqual(cleared.body);
    expect(await c.ctx.db.adminAction.count({ where: { targetUserId: p.id } })).toBe(3);
  });
});
