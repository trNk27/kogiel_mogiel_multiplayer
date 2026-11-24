import { describe, expect, it } from 'vitest';
import {
  ENTRANCES,
  FIND_BASE,
  LAUF_GOAL,
  LAUF_GRACE_MS,
  LAUF_MS,
  LAUF_PENALTY,
  LAUF_SPEED,
  NEVER_FOUND_BONUS,
  SPOTS,
  TENT,
  canHide,
  distance,
  edgeKey,
  findPoints,
  hidePoints,
  hiderOrder,
  howTo,
  laufPoints,
  lookSchedule,
  looking,
  makeCrowds,
  mulberry32,
  neighbours,
  simulateLauf,
  sniff,
  trueRumour,
  walkMs,
} from '../client/src/games/markt/logic';

describe('the market', () => {
  it('is a 4×3 grid with unique stalls', () => {
    expect(SPOTS).toHaveLength(12);
    expect(new Set(SPOTS.map((s) => `${s.col},${s.row}`)).size).toBe(12);
    expect(new Set(SPOTS.map((s) => s.id)).size).toBe(12);
  });
  it('walks only to stalls next door, both ways', () => {
    for (let i = 0; i < SPOTS.length; i++)
      for (const j of neighbours(i)) {
        expect(distance(i, j)).toBe(1);
        expect(neighbours(j)).toContain(i);
      }
    expect(neighbours(0)).toHaveLength(2);
    expect(neighbours(5)).toHaveLength(4);
  });
  it("can't hide in the tent or at the entrances", () => {
    expect(canHide(TENT)).toBe(false);
    for (const e of ENTRANCES) expect(canHide(e)).toBe(false);
    expect(SPOTS.filter((_, i) => canHide(i)).length).toBe(9);
    expect(canHide(-1)).toBe(false);
    expect(canHide(99)).toBe(false);
  });
  it('gives every path a crowd of 1–3, the same either way', () => {
    const c = makeCrowds(mulberry32(4));
    for (let i = 0; i < SPOTS.length; i++)
      for (const j of neighbours(i)) {
        expect(c[edgeKey(i, j)]).toBeGreaterThanOrEqual(1);
        expect(c[edgeKey(i, j)]).toBeLessThanOrEqual(3);
        expect(edgeKey(i, j)).toBe(edgeKey(j, i));
      }
  });
  it('crowds slow you down, glühwein speeds you up', () => {
    expect(walkMs(3, false)).toBeGreaterThan(walkMs(1, false));
    expect(walkMs(2, true)).toBeLessThan(walkMs(2, false));
  });
});

describe('clues', () => {
  it('sniffing says how close you are', () => {
    expect(sniff(5, 5)).toBe('here');
    expect(sniff(5, 6)).toBe('hot');
    expect(sniff(5, 7)).toBe('warm');
    expect(sniff(0, 11)).toBe('cold');
  });
  it('true rumours are next to the hider, never the tent', () => {
    const rng = mulberry32(8);
    for (let h = 0; h < SPOTS.length; h++) {
      if (!canHide(h)) continue;
      for (let k = 0; k < 30; k++) {
        const r = trueRumour(h, rng);
        expect(distance(r, h)).toBeLessThanOrEqual(1);
        expect(r).not.toBe(TENT);
      }
    }
  });
});

describe('scoring', () => {
  it('finding fast is worth more', () => {
    expect(findPoints(40_000)).toBeGreaterThan(findPoints(5_000));
    expect(findPoints(0)).toBe(FIND_BASE);
  });
  it('the hider scores for time hidden, plus a bonus if never found', () => {
    expect(hidePoints(30_000, true)).toBeGreaterThan(hidePoints(10_000, true));
    expect(hidePoints(45_000, false) - hidePoints(45_000, true)).toBe(NEVER_FOUND_BONUS);
  });
  it('everyone hides once, or two hide in a tournament', () => {
    expect(hiderOrder(['a', 'b', 'c'], false)).toEqual(['a', 'b', 'c']);
    expect(hiderOrder(['a', 'b', 'c'], true)).toEqual(['a', 'b']);
  });
});

describe('Krampuslauf', () => {
  const look: [number, number][] = [[4000, 5500]];
  it('looks are inside the race and never overlap', () => {
    const rng = mulberry32(2);
    for (let k = 0; k < 50; k++) {
      const s = lookSchedule(rng);
      expect(s.length).toBeGreaterThan(0);
      for (let i = 0; i < s.length; i++) {
        expect(s[i][0]).toBeLessThan(s[i][1]);
        expect(s[i][1]).toBeLessThanOrEqual(LAUF_MS);
        if (i) expect(s[i][0]).toBeGreaterThan(s[i - 1][1]);
      }
    }
    expect(looking(look, 4500)).toBe(true);
    expect(looking(look, 3000)).toBe(false);
  });
  it('skating while he looks away moves you', () => {
    const r = simulateLauf([[0, 3000]], look);
    expect(r).toEqual({ dist: 3 * LAUF_SPEED, caught: 0 });
  });
  it('letting go in time is safe; holding on gets you caught', () => {
    expect(simulateLauf([[0, 4000 + LAUF_GRACE_MS - 50]], look).caught).toBe(0);
    const held = simulateLauf([[0, 6000]], look);
    expect(held.caught).toBe(1);
    expect(held.dist).toBe(Math.max(0, 4 * LAUF_SPEED - LAUF_PENALTY));
  });
  it('pressing while he looks gets you caught', () => {
    const r = simulateLauf(
      [
        [0, 2000],
        [4200, 4400],
      ],
      look,
    );
    expect(r.caught).toBe(1);
  });
  it('holding the whole race never wins, playing it smart does', () => {
    const rng = mulberry32(11);
    const s = lookSchedule(rng);
    const lazy = simulateLauf([[0, null]], s);
    const smart: [number, number | null][] = [];
    let t = 0;
    for (const [a, b] of s) {
      if (a - 100 > t) smart.push([t, a - 100]);
      t = b + 50;
    }
    smart.push([t, LAUF_MS]);
    expect(simulateLauf(smart, s).dist).toBeGreaterThan(lazy.dist);
    expect(simulateLauf(smart, s).dist).toBeLessThanOrEqual(LAUF_GOAL);
  });
  it('shrugs off junk', () => {
    expect(simulateLauf([[Number.NaN, 5], [9000, 100]] as [number, number | null][], look)).toEqual({ dist: 0, caught: 0 });
  });
  it('places score most, nobody scores for standing still', () => {
    const p = laufPoints({ a: 80, b: 40, c: 0 });
    expect(p.a).toBeGreaterThan(p.b);
    expect(p.c).toBe(0);
  });
});

describe('howTo', () => {
  it('has three lines', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)[2]).toContain('2 rounds');
  });
});
