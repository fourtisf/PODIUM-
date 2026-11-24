// Pacing helper for version 2 rules. Pure arithmetic, safe in init/update.

/**
 * A difficulty clock that starts further along and rejoins the real one.
 * At x = 0 it reads `from`; it rises in a straight line to meet x at x = `until`, and equals x from then on.
 * So a game that used to ramp on x opens at the level it used to reach at `from`, and is unchanged after `until`
 * (no level is ever harder than the old curve reached later, and the caps are the same).
 */
export function ramp(x: number, from: number, until: number): number {
  return x >= until ? x : from + (x * (until - from)) / until;
}
