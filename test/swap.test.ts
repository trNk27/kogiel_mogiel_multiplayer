import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../client/src/games/rng';
import { SWAP_ITEMS, SWAP_MAX_POINTS, SWAP_MIN_POINTS, SWAP_PICK_MS, SWAP_ROUNDS, SWAP_SLOTS, makeRound, swapDifficulty, swapPoints } from '../client/src/games/swap/logic';

describe('swap items', () => {
  it('have unique ids and a sprite on disk', () => {
    expect(new Set(SWAP_ITEMS.map((x) => x.id)).size).toBe(SWAP_ITEMS.length);
    const files = new Set(Object.keys(import.meta.glob('../client/public/sprites/**/*.webp')).map((f) => f.replace('../client/public', '')));
    expect(files.size).toBeGreaterThan(50);
    for (const it of SWAP_ITEMS) expect(files.has(it.src), it.src).toBe(true);
  });
  it('have enough lookalikes for sneaky swaps', () => {
    const groups = new Map<string, number>();
    for (const it of SWAP_ITEMS) groups.set(it.group, (groups.get(it.group) ?? 0) + 1);
    for (const [g, n] of groups) expect(n, g).toBeGreaterThanOrEqual(3);
  });
});

describe('makeRound', () => {
  it('swaps exactly one thing for something new', () => {
    for (let seed = 1; seed < 200; seed++) {
      const rng = mulberry32(seed);
      const i = seed % SWAP_ROUNDS;
      const r = makeRound(i, SWAP_ROUNDS, rng);
      expect(r.before).toHaveLength(SWAP_SLOTS);
      expect(r.after).toHaveLength(SWAP_SLOTS);
      expect(new Set(r.after.map((x) => x.id)).size).toBe(SWAP_SLOTS);
      const was = new Set(r.before.map((x) => x.id));
      const newOnes = r.after.filter((x) => !was.has(x.id));
      expect(newOnes).toHaveLength(1);
      expect(r.after[r.answer]).toBe(newOnes[0]);
      expect(r.before).toContain(r.removed);
      expect(r.after).not.toContain(r.removed);
      if (r.lookalike) expect(r.after[r.answer].group).toBe(r.removed.group);
      if (!r.shuffled) {
        // Same places: only the swapped slot differs.
        const diff = r.after.filter((x, k) => x !== r.before[k]);
        expect(diff).toEqual([r.after[r.answer]]);
      }
    }
  });
  it('never uses the same new thing twice in a game', () => {
    const fresh = new Set(SWAP_ITEMS.map((x) => x.id));
    const rng = mulberry32(5);
    const added = Array.from({ length: SWAP_ROUNDS }, (_, i) => makeRound(i, SWAP_ROUNDS, rng, fresh)).map((r) => r.after[r.answer].id);
    expect(new Set(added).size).toBe(SWAP_ROUNDS);
  });
  it('gets harder: less time to look, rearranged shelves, then lookalikes', () => {
    const first = swapDifficulty(0, SWAP_ROUNDS);
    const last = swapDifficulty(SWAP_ROUNDS - 1, SWAP_ROUNDS);
    expect(first).toEqual({ lookMs: 9000, shuffled: false, lookalike: false });
    expect(last).toEqual({ lookMs: 5000, shuffled: true, lookalike: true });
    const sneaky = Array.from({ length: 50 }, (_, s) => makeRound(SWAP_ROUNDS - 1, SWAP_ROUNDS, mulberry32(s)));
    expect(sneaky.filter((r) => r.lookalike).length).toBeGreaterThan(45);
  });
});

describe('swapPoints', () => {
  it('pays more for faster right answers and nothing for wrong ones', () => {
    expect(swapPoints(true, 0)).toBe(SWAP_MAX_POINTS);
    expect(swapPoints(true, SWAP_PICK_MS)).toBe(SWAP_MIN_POINTS);
    expect(swapPoints(true, SWAP_PICK_MS / 2)).toBe(750);
    expect(swapPoints(false, 100)).toBe(0);
  });
});
