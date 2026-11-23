// Daily missions, from the prototype's MISS array. Three per day, chosen by day number.
export type MissionId = 'r3' | 'g2' | 'pb' | 'd1' | 's45' | 'p5';

export interface MissionDef {
  id: MissionId;
  title: string;
  target: number;
  chips: number;
  xp: number;
}

export const MISSIONS: MissionDef[] = [
  { id: 'r3', title: 'Play 3 ranked runs', target: 3, chips: 150, xp: 40 },
  { id: 'g2', title: 'Play 2 different games', target: 2, chips: 120, xp: 40 },
  { id: 'pb', title: 'Set a new personal best', target: 1, chips: 200, xp: 60 },
  { id: 'd1', title: 'Win a duel', target: 1, chips: 200, xp: 60 },
  { id: 's45', title: 'Survive 45 seconds in one run', target: 1, chips: 150, xp: 50 },
  { id: 'p5', title: 'Finish 5 runs of any kind', target: 5, chips: 100, xp: 30 },
];

export const missionDef = (id: string): MissionDef | undefined => MISSIONS.find((m) => m.id === id);

/** The three missions for a day: indices d, d+2, d+4 modulo 6. */
export const missionsForDay = (day: number): MissionDef[] => [0, 2, 4].map((o) => MISSIONS[(((day + o) % 6) + 6) % 6]!);

/** What a finished run looks like to the mission tracker. */
export interface RunEvent {
  game: string;
  mode: 'ranked' | 'practice' | 'cup' | 'duel' | 'challenge';
  newBest: boolean;
  duelWin: boolean;
  seconds: number;
}

/** Progress a run adds to a mission. `games` is the list of games already counted for 'g2'; it is mutated. */
export function missionGain(id: MissionId, e: RunEvent, games: string[]): number {
  switch (id) {
    case 'r3':
      return e.mode === 'ranked' ? 1 : 0;
    case 'g2':
      if (games.includes(e.game)) return 0;
      games.push(e.game);
      return 1;
    case 'pb':
      return e.newBest ? 1 : 0;
    case 'd1':
      return e.duelWin && e.mode === 'duel' ? 1 : 0;
    case 's45':
      return e.seconds >= 45 ? 1 : 0;
    case 'p5':
      return 1;
  }
}
