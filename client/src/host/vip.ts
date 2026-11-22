/**
 * Who's VIP. Normally the first player to join; after every game it passes on in joining order.
 * For testing, a player called "Mani" (any capitals) is VIP of the first round instead, wherever
 * they are in the queue; from then on it passes on from Mani as usual.
 */
export const FIRST_VIP_NAME = 'mani';

export interface VipCandidate {
  id: string;
  name: string;
  joinedAt: number;
}

/** The VIP now. `chosen` is whose turn it is (null until the first game ends). */
export function currentVip(players: Iterable<VipCandidate>, chosen: string | null): string | null {
  let first: VipCandidate | null = null;
  let mani: VipCandidate | null = null;
  for (const p of players) {
    if (p.id === chosen) return p.id;
    if (!first || p.joinedAt < first.joinedAt) first = p;
    if (p.name.trim().toLowerCase() === FIRST_VIP_NAME) mani = p;
  }
  // Mani only takes over before the first turn has been handed on.
  return (chosen === null && mani ? mani : first)?.id ?? null;
}
