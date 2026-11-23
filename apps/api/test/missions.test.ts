import { ECONOMY, MISSIONS, dayNum, missionDef, missionsForDay, type MissionClaimResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { GAME, OTHER_GAME, errCode, freshApp, guest, ledgerCount, playRun, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await freshApp();
  // A day whose missions are "2 different games", "win a duel" and "finish 5 runs".
  while (!missionsForDay(dayNum(t.now())).some((m) => m.id === 'p5')) t.advance(86_400_000);
});
afterAll(() => t.close());

const complete = (userId: string, id: string): Promise<unknown> =>
  t.ctx.db.missionProgress.upsert({
    where: { userId_day_mission: { userId, day: dayNum(t.now()), mission: id } },
    create: { userId, day: dayNum(t.now()), mission: id, progress: missionDef(id)!.target },
    update: { progress: missionDef(id)!.target },
  });

test('claims need a signed-in adult account and an Idempotency-Key', async () => {
  expect((await (await visitor(t)).post('/missions/p5/claim')).status).toBe(401);
  expect(errCode(await (await guest(t)).post('/missions/p5/claim'))).toBe('guest_not_allowed');
  const c = await signUp(t, { unlocked: true });
  expect((await c.post('/missions/p5/claim', {}, { idem: null })).status).toBe(400);
});

test('runs move today\'s missions; a complete mission pays once, however often it is claimed', async () => {
  const c = await signUp(t, { unlocked: true });
  const p5 = missionDef('p5')!;
  expect((await c.me()).missions.map((m) => m.id).sort()).toEqual(['d1', 'g2', 'p5']);
  let completed: string[] = [];
  for (let i = 0; i < p5.target; i++) {
    const r = await playRun(c, i === 0 ? OTHER_GAME : GAME, 'practice');
    expect(r.finish.status).toBe(200);
    completed = completed.concat(r.finish.body.missionsCompleted);
    if (i === 0) expect((await c.post('/missions/p5/claim')).status).toBe(409); // not complete yet
  }
  expect(completed.sort()).toEqual(['g2', 'p5']);
  const me = await c.me();
  expect(me.missions.map((m) => [m.id, m.progress, m.claimed]).sort()).toEqual([['d1', 0, false], ['g2', 2, false], ['p5', 5, false]]);
  expect(me.unread).toBe(2);
  const before = me.user.balance;
  expect(before).toBe(ECONOMY.startBalance - (p5.target - ECONOMY.freePracticeRuns) * ECONOMY.practiceEntry);

  const first = await c.post<MissionClaimResponse>('/missions/p5/claim', {}, { idem: 'mission-key-01' });
  expect(first.status).toBe(200);
  expect(first.body).toEqual({ id: 'p5', chips: p5.chips, nominal: p5.chips, scaled: false, xp: p5.xp, bonusBox: false, balance: before + p5.chips, boxes: ECONOMY.startBoxes });
  const replay = await c.post<MissionClaimResponse>('/missions/p5/claim', {}, { idem: 'mission-key-01' });
  expect(replay.body).toEqual(first.body);
  const second = await c.post('/missions/p5/claim');
  expect([second.status, errCode(second)]).toEqual([409, 'conflict']);
  expect(await c.balance()).toBe(before + p5.chips);
  expect(await ledgerCount(t, c.id, 'mission')).toBe(1);
  expect((await t.ctx.db.ledger.findFirstOrThrow({ where: { userId: c.id, reason: 'mission' } })).idemKey).toBe(`mission:${c.id}:${dayNum(t.now())}:p5`);
  expect((await c.me()).user.xp).toBe(p5.xp);

  expect((await c.post('/missions/d1/claim')).status).toBe(409); // today's, but not done
  expect((await c.post('/missions/r3/claim')).status).toBe(404); // not one of today's
  expect((await c.post('/missions/nope/claim')).status).toBe(404);

  // Clearing all three adds one mystery box, once.
  const g2 = await c.post<MissionClaimResponse>('/missions/g2/claim');
  expect(g2.body).toMatchObject({ bonusBox: false, boxes: ECONOMY.startBoxes });
  await complete(c.id, 'd1');
  const d1 = await c.post<MissionClaimResponse>('/missions/d1/claim', {}, { idem: 'mission-key-d1' });
  expect(d1.body).toMatchObject({ bonusBox: true, boxes: ECONOMY.startBoxes + 1 });
  expect((await c.post<MissionClaimResponse>('/missions/d1/claim', {}, { idem: 'mission-key-d1' })).body).toEqual(d1.body);
  const end = await c.me();
  expect(end.missionsBonusClaimed).toBe(true);
  expect(end.user.boxes).toBe(ECONOMY.startBoxes + 1);
  expect(end.user.stats.won).toBe(p5.chips + missionDef('g2')!.chips + missionDef('d1')!.chips);

  // Tomorrow is a new set with fresh progress.
  t.advance(86_400_000);
  const next = await c.me();
  expect(next.missions.map((m) => m.id).sort()).toEqual(['pb', 'r3', 's45']);
  expect(next.missions.every((m) => m.progress === 0 && !m.claimed)).toBe(true);
  expect(next.missionsBonusClaimed).toBe(false);
  t.advance(86_400_000);
});

test('every mission in the table is reachable on some day', () => {
  const seen = new Set([0, 1].flatMap((d) => missionsForDay(d).map((m) => m.id)));
  expect([...seen].sort()).toEqual(MISSIONS.map((m) => m.id).sort());
});
