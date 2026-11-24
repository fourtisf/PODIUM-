import { XP, type GhostsResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Client, GAME, OTHER_GAME, distinctPlans, freshApp, playRun, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('an empty board has no ghosts: nothing is generated', async () => {
  const r = await new Client(t).get<GhostsResponse>('/ghosts/' + GAME);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ game: GAME, ghosts: [] });
  expect((await new Client(t).get('/ghosts/nope')).status).toBe(404);
});

test('ghosts are the best real run per player this week, the caller excluded, playable as free challenges', async () => {
  const plans = distinctPlans(GAME, t.seed, 7);
  const players = [];
  for (let i = 0; i < 7; i++) {
    const c = await signUp(t, { name: `Ghost${i}` });
    // Player i's best is plans[i]; player 0 also has a worse run that must not show up.
    if (i === 0) await playRun(c, GAME, 'ranked', { plan: plans[0] });
    await playRun(c, GAME, 'ranked', { plan: plans[i] });
    players.push(c);
  }
  await playRun(players[6]!, OTHER_GAME, 'ranked'); // another game's board does not leak in

  // A visitor (no account) can read them: the top five of the week, in board order.
  const pub = await (await visitor(t)).get<GhostsResponse>('/ghosts/' + GAME);
  expect(pub.status).toBe(200);
  expect(pub.body.ghosts.map((g) => [g.name, g.score, g.place])).toEqual([6, 5, 4, 3, 2].map((i, k) => [`Ghost${i}`, plans[i]!.score, k + 1]));
  expect(pub.body.ghosts.every((g) => /^[A-HJKMNP-Z2-9]{7}$/.test(g.code) && g.avatar === 0 && g.frame === 'none')).toBe(true);
  // One challenge per run, reused on the next read.
  const again = await new Client(t).get<GhostsResponse>('/ghosts/' + GAME);
  expect(again.body).toEqual(pub.body);
  expect(await t.ctx.db.challenge.count()).toBe(5);

  // The best player does not see their own run; the next one moves up and keeps its real place.
  const mine = await players[6]!.get<GhostsResponse>('/ghosts/' + GAME);
  expect(mine.body.ghosts.map((g) => [g.name, g.place])).toEqual([5, 4, 3, 2, 1].map((i, k) => [`Ghost${i}`, k + 2]));

  // Playing a ghost is the existing challenge flow: free, XP only.
  const chaser = await signUp(t, { name: 'Chaser' });
  const top = (await chaser.get<GhostsResponse>('/ghosts/' + GAME)).body.ghosts[4]!;
  expect(top.name).toBe('Ghost2');
  const before = await chaser.balance();
  const run = await playRun(chaser, GAME, 'challenge', { challengeCode: top.code, plan: plans[6] });
  expect(run.start.body.entry).toBe(0);
  expect(run.finish.body).toMatchObject({ mode: 'challenge', xpGained: XP.challengeWin, challenge: { won: true, opponent: 'Ghost2', target: plans[2]!.score } });
  expect(await chaser.balance()).toBe(before);
});
