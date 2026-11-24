import { missionGain, missionsForDay, type MissionId, type RunEvent } from '@podium/shared';
import type { Tx } from '../ctx';
import { notify } from './notifications';

/**
 * Adds a finished, accepted run to today's three missions. Returns the missions it completed.
 * The caller holds the player's row lock, so progress cannot be lost to a concurrent run.
 */
export async function trackRun(tx: Tx, userId: string, day: number, e: RunEvent, at: Date): Promise<MissionId[]> {
  const defs = missionsForDay(day);
  const rows = await tx.missionProgress.findMany({ where: { userId, day, mission: { in: defs.map((d) => d.id) } } });
  const done: MissionId[] = [];
  for (const def of defs) {
    const row = rows.find((r) => r.mission === def.id);
    const before = row?.progress ?? 0;
    if (before >= def.target) continue;
    const games = [...(((row?.meta as { games?: string[] } | null)?.games) ?? [])];
    const gain = missionGain(def.id, e, games);
    if (gain <= 0) continue;
    const progress = Math.min(def.target, before + gain);
    const meta = def.id === 'g2' ? { games } : undefined;
    await tx.missionProgress.upsert({
      where: { userId_day_mission: { userId, day, mission: def.id } },
      create: { userId, day, mission: def.id, progress, meta },
      update: { progress, meta },
    });
    if (progress >= def.target) {
      done.push(def.id);
      await notify(tx, userId, 'mission', `Mission complete: <b>${def.title}</b>. Claim ${def.chips} tChips.`, at);
    }
  }
  return done;
}

/** A duel the creator wins is settled by the joiner's run, so the creator's "Win a duel or beat a challenge" mission is credited here. */
export function trackDuelWin(tx: Tx, userId: string, day: number, game: string, at: Date): Promise<MissionId[]> {
  if (!missionsForDay(day).some((m) => m.id === 'd1')) return Promise.resolve([]);
  return trackOnly(tx, userId, day, 'd1', { game, mode: 'duel', newBest: false, duelWin: true, challengeWin: false, seconds: 0 }, at);
}

async function trackOnly(tx: Tx, userId: string, day: number, id: MissionId, e: RunEvent, at: Date): Promise<MissionId[]> {
  const def = missionsForDay(day).find((m) => m.id === id);
  if (!def) return [];
  const row = await tx.missionProgress.findUnique({ where: { userId_day_mission: { userId, day, mission: id } } });
  const before = row?.progress ?? 0;
  if (before >= def.target) return [];
  const progress = Math.min(def.target, before + missionGain(id, e, []));
  if (progress === before) return [];
  await tx.missionProgress.upsert({ where: { userId_day_mission: { userId, day, mission: id } }, create: { userId, day, mission: id, progress }, update: { progress } });
  if (progress < def.target) return [];
  await notify(tx, userId, 'mission', `Mission complete: <b>${def.title}</b>. Claim ${def.chips} tChips.`, at);
  return [id];
}
