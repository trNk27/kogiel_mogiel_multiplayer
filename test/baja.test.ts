import { describe, expect, it } from 'vitest';
import {
  BAJA_TRIES,
  CAT_STARVED_BONUS,
  ROWS,
  TRY_POINTS,
  catPoints,
  clueText,
  dealClues,
  hits,
  howTo,
  makeCraving,
  mostVoted,
  mulberry32,
  owners,
  partsFor,
  reactionFor,
  shuffle,
  teamPoints,
  treatClue,
  validPlate,
  type Clue,
} from '../client/src/games/baja/logic';

/** What the whole team knows if everyone shares honestly: for each part, the options left. */
function solve(clues: Clue[], parts: number): number[][] {
  return Array.from({ length: parts }, (_, p) => {
    const sure = clues.find((c) => c.part === p && c.is !== undefined);
    if (sure) return [sure.is!];
    const out = new Set(clues.filter((c) => c.part === p).flatMap((c) => c.not ?? []));
    return ROWS[p].options.map((_, i) => i).filter((i) => !out.has(i));
  });
}

describe('the plate', () => {
  it('has a trick part with 4+ players', () => {
    expect(partsFor(2)).toBe(3);
    expect(partsFor(3)).toBe(3);
    expect(partsFor(4)).toBe(4);
    expect(partsFor(8)).toBe(4);
  });
  it('every part has an owner, spread over the players', () => {
    expect(owners(['a', 'b'], 3)).toEqual(['a', 'b', 'a']);
    expect(owners(['a', 'b', 'c', 'd', 'e'], 4)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('rejects bad plates and counts hits', () => {
    expect(validPlate([0, 0, 0], 3)).toBe(true);
    expect(validPlate([6, 0, 0], 3)).toBe(false);
    expect(hits([1, 2, 0], [1, 2, 1])).toBe(2);
    expect(reactionFor(3, 3)).toBe('eat');
    expect(reactionFor(3, 4)).toBe('spit');
  });
});

describe('clues', () => {
  it('together they pin down the craving exactly', () => {
    const rng = mulberry32(3);
    for (let n = 2; n <= 8; n++) {
      for (let k = 0; k < 30; k++) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const parts = partsFor(n);
        const craving = makeCraving(parts, rng);
        const own = owners(shuffle(ids, rng), parts);
        const clues = dealClues(craving, own, ids, rng);
        const all = Object.values(clues).flat();
        expect(solve(all, parts)).toEqual(craving.map((c) => [c]));
      }
    }
  });
  it('you never get a clue about your own part', () => {
    const rng = mulberry32(9);
    for (let n = 2; n <= 8; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const parts = partsFor(n);
      const craving = makeCraving(parts, rng);
      const own = owners(ids, parts);
      const clues = dealClues(craving, own, ids, rng);
      for (const id of ids) for (const c of clues[id]) expect(own[c.part]).not.toBe(id);
    }
  });
  it('nobody can solve it alone (with 3+ players)', () => {
    const rng = mulberry32(21);
    for (let k = 0; k < 40; k++) {
      const ids = ['a', 'b', 'c', 'd'];
      const craving = makeCraving(4, rng);
      const own = owners(ids, 4);
      const clues = dealClues(craving, own, ids, rng);
      for (const id of ids) {
        const mine = solve(clues[id], 4);
        expect(mine.every((opts) => opts.length === 1)).toBe(false);
      }
    }
  });
  it('clues never claim she hates what she wants', () => {
    const rng = mulberry32(4);
    const craving = makeCraving(4, rng);
    const clues = dealClues(craving, owners(['a', 'b', 'c', 'd'], 4), ['a', 'b', 'c', 'd'], rng);
    for (const c of Object.values(clues).flat()) expect(c.not).not.toContain(craving[c.part]);
  });
  it('read nicely', () => {
    expect(clueText({ part: 0, not: [0, 1] })).toBe('Food: not 🍗 Chicken or 🧀 Cheese');
    expect(clueText({ part: 1, is: 0 })).toContain('she wants');
  });
  it('a treat gives a sure answer for a part you are not sure about', () => {
    const rng = mulberry32(1);
    const craving = [2, 1, 0];
    const known: Clue[] = [{ part: 0, is: 2 }];
    for (let k = 0; k < 20; k++) {
      const c = treatClue(craving, known, rng)!;
      expect(c.part).not.toBe(0);
      expect(c.is).toBe(craving[c.part]);
    }
    expect(
      treatClue(
        craving,
        craving.map((v, part) => ({ part, is: v })),
        rng,
      ),
    ).toBeNull();
  });
});

describe('scoring', () => {
  it('the team scores more for feeding her early', () => {
    expect(teamPoints(1)).toBe(TRY_POINTS[0]);
    expect(teamPoints(2)).toBeLessThan(teamPoints(1));
    expect(teamPoints(null)).toBe(0);
  });
  it('the cat scores for every miss, most if she starves', () => {
    expect(catPoints(1)).toBe(0);
    expect(catPoints(3)).toBeGreaterThan(catPoints(2));
    expect(catPoints(null)).toBeGreaterThan(catPoints(BAJA_TRIES));
    expect(catPoints(null) - catPoints(BAJA_TRIES) - 200).toBeLessThanOrEqual(CAT_STARVED_BONUS);
  });
  it('counts the votes', () => {
    expect(mostVoted({ a: 'c', b: 'c', c: 'a' })).toEqual(['c']);
    expect(mostVoted({ a: 'b', b: 'a' }).sort()).toEqual(['a', 'b']);
    expect(mostVoted({})).toEqual([]);
  });
});

describe('howTo', () => {
  it('has three lines', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)[2]).toContain('2 cravings');
  });
});
