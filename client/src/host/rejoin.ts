/**
 * Players who left the room keep their party points for the rest of the session, so someone who
 * drops out (phone locked too long, kicked by mistake) and joins again carries on where they were.
 *
 * A returning player is found by their phone's id first, then by name (a new phone, or cleared
 * storage). When the id changed, their old id is renamed to the new one everywhere scores are kept,
 * so the score chart and the tournament still add up.
 */

/** What we remember about someone who left. */
export interface Departed {
  id: string;
  name: string;
  party: number;
}

/** Anything that keeps points by player id: party history entries, tournament logs. */
type Gains = { gained: Record<string, number> };

/** The departed player this join belongs to, if any: same phone first, then same name. */
export function findReturning(departed: readonly Departed[], id: string, name: string): Departed | null {
  const lower = name.toLowerCase();
  return departed.find((d) => d.id === id) ?? departed.find((d) => d.name.toLowerCase() === lower) ?? null;
}

/** Move the points kept under `from` to `to` (in place). */
export function renameIn(record: Record<string, number>, from: string, to: string) {
  if (from === to || !(from in record)) return;
  record[to] = (record[to] ?? 0) + record[from];
  delete record[from];
}

/** Move a player's points from their old id to their new one in every entry of a log (in place). */
export function renameInLog(log: readonly Gains[], from: string, to: string) {
  for (const entry of log) renameIn(entry.gained, from, to);
}
