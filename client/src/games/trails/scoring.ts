/** Trails scoring: every time someone dies, each player still alive gets +1. */

export function trailsTarget(players: number): number {
  return 10 * Math.max(1, players - 1);
}

/**
 * Apply one tick's deaths. Players who die in the same tick don't score off each other.
 * `alive` is the set of player indices still alive *after* this tick.
 */
export function awardDeaths(scores: number[], deaths: number[], alive: number[]): number[] {
  const next = [...scores];
  for (let d = 0; d < deaths.length; d++) for (const i of alive) next[i]++;
  return next;
}

/** The winner once someone reached the target with a clear lead; `null` to keep playing. */
export function trailsWinner(scores: number[], target: number): number | null {
  let best = -1;
  let bestScore = -Infinity;
  let tie = false;
  scores.forEach((s, i) => {
    if (s > bestScore) {
      best = i;
      bestScore = s;
      tie = false;
    } else if (s === bestScore) tie = true;
  });
  if (best < 0 || bestScore < target || tie) return null;
  return best;
}
