/**
 * Scoring for last-one-standing rounds (Skakanka, Petarda, Babcia Mówi), the same rules as Babcia’s
 * Cookbook: with 2+ players you score one point for every player who went out before you, and the last
 * ones standing – a lone survivor, or everyone who went out together at the very end – get +2 more.
 * On your own you score how far you got.
 *
 * `outAt[i]` is when player i went out (a jump, turn or call number; null = still standing at the end);
 * `gone[i]` marks players who left the game. `reached` is how far a survivor got, for solo play.
 */
export function eliminationPoints(outAt: (number | null)[], gone: boolean[], solo: boolean, reached: number): number[] {
  if (solo) return outAt.map((o, i) => (gone[i] ? 0 : o === null ? reached : o - 1));
  const key = outAt.map((o) => (o === null ? Infinity : o));
  const live = key.map((_, i) => i).filter((i) => !gone[i]);
  const best = Math.max(...live.map((i) => key[i]), -Infinity);
  return key.map((k, i) => {
    if (gone[i]) return 0;
    const before = live.filter((j) => j !== i && key[j] < k).length;
    return before + (k === best ? 2 : 0);
  });
}

/** Who won the round (more than one on a tie); nobody when playing on your own. */
export function eliminationWinners(outAt: (number | null)[], gone: boolean[], solo: boolean): number[] {
  if (solo) return [];
  const key = outAt.map((o) => (o === null ? Infinity : o));
  const live = key.map((_, i) => i).filter((i) => !gone[i]);
  if (!live.length) return [];
  const best = Math.max(...live.map((i) => key[i]));
  return live.filter((i) => key[i] === best);
}
