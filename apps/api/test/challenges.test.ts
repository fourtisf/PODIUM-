import { XP, type ChallengeResponse, type CreateChallengeResponse, type StartRunResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Client, GAME, OTHER_GAME, distinctPlans, errCode, freshApp, guest, playRun, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('a challenge is a short code for one of my accepted runs; a replay returns the same code', async () => {
  const [low, high] = distinctPlans(GAME, t.seed, 2);
  const a = await signUp(t, { name: 'Dare' });
  const b = await signUp(t, { name: 'Taker' });
  const run = await playRun(a, GAME, 'ranked', { plan: low });
  const runId = run.start.body.runId;

  expect((await (await visitor(t)).post('/challenges', { runId })).status).toBe(401);
  expect(errCode(await (await guest(t)).post('/challenges', { runId }))).toBe('guest_not_allowed');
  expect((await b.post('/challenges', { runId })).status).toBe(404); // not my run
  expect((await a.post('/challenges', { runId }, { idem: null })).status).toBe(400);

  const made = await a.post<CreateChallengeResponse>('/challenges', { runId }, { idem: 'challenge-key-1' });
  expect(made.status).toBe(200);
  expect(made.body.code).toMatch(/^[A-HJKMNP-Z2-9]{6,8}$/);
  expect((await a.post<CreateChallengeResponse>('/challenges', { runId }, { idem: 'challenge-key-1' })).body).toEqual(made.body);
  expect((await a.post<CreateChallengeResponse>('/challenges', { runId })).body).toEqual(made.body); // one code per run
  expect(await t.ctx.db.challenge.count()).toBe(1);

  // Reading it is public and case-insensitive; the score comes from the server, not the link.
  const read = await new Client(t).get<ChallengeResponse>('/challenges/' + made.body.code.toLowerCase());
  expect(read.status).toBe(200);
  expect(read.body).toEqual({ code: made.body.code, game: GAME, score: low!.score, name: 'Dare', avatar: 0, frame: 'none' });
  expect((await new Client(t).get('/challenges/ZZZZZZZ')).status).toBe(404);

  // Taking it: free, XP for the first attempt only, no chips.
  const code = made.body.code;
  expect((await a.post('/runs', { game: GAME, mode: 'challenge', challengeCode: code })).status).toBe(400); // my own
  expect((await b.post('/runs', { game: OTHER_GAME, mode: 'challenge', challengeCode: code })).status).toBe(400);
  expect((await b.post('/runs', { game: GAME, mode: 'challenge', challengeCode: 'ZZZZZZZ' })).status).toBe(404);
  const balance = await b.balance();
  const lost = await playRun(b, GAME, 'challenge', { challengeCode: code, plan: low });
  expect(lost.start.body.entry).toBe(0);
  expect(lost.finish.body).toMatchObject({ mode: 'challenge', xpGained: XP.challengeLoss, badges: ['challenge_lost'], challenge: { won: false, opponent: 'Dare', target: low!.score } });
  const won = await playRun(b, GAME, 'challenge', { challengeCode: code, plan: high });
  expect(won.finish.body).toMatchObject({ xpGained: 0, badges: ['challenge_won'], challenge: { won: true, opponent: 'Dare', target: low!.score } });
  expect(won.finish.body.top5).toEqual([{ place: 1, name: 'Taker', score: high!.score, me: true }, { place: 2, name: 'Dare', score: low!.score, me: false }]);
  expect(await b.balance()).toBe(balance);
  expect((await b.me()).user.xp).toBe(XP.challengeLoss);

  const c = await signUp(t, { name: 'Winner' });
  const first = await playRun(c, GAME, 'challenge', { challengeCode: code, plan: high });
  expect(first.finish.body).toMatchObject({ xpGained: XP.challengeWin, challenge: { won: true } });
});

test('only a finished, accepted run can be shared', async () => {
  const a = await signUp(t);
  const open = await a.post<StartRunResponse>('/runs', { game: GAME, mode: 'ranked' });
  expect((await a.post('/challenges', { runId: open.body.runId })).status).toBe(409);
  const rejected = await playRun(a, GAME, 'ranked', { waitMs: 0 });
  expect(rejected.finish.status).toBe(422);
  expect((await a.post('/challenges', { runId: rejected.start.body.runId })).status).toBe(409);
  expect((await a.post('/challenges', { runId: 'missing' })).status).toBe(404);
});
