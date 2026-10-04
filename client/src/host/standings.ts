/** Competition ranking ("1224"): equal scores share a place. Higher score = better. */
export function placesFor(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}
