import type { Tx } from '../ctx';

/** `body` may contain only the <b> tags written by the caller; every player name must go through esc(). */
export async function notify(tx: Tx, userId: string, kind: string, body: string, at: Date): Promise<void> {
  await tx.notification.create({ data: { userId, kind, body, createdAt: at } });
}

/** A real event for the home page ticker, e.g. ("Ada", "scored 1,447 in", "Duck Dash"). */
export async function addActivity(tx: Tx, name: string, text: string, game: string, at: Date): Promise<void> {
  await tx.activity.create({ data: { name, text, game, createdAt: at } });
}
