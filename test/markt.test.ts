import { describe, expect, it } from 'vitest';
import {
  ENTRANCES,
  FIND_BASE,
  ATTACKS,
  DODGE_MS,
  LAUF_ATTACKS,
  LAUF_MS,
  QUICK_MS,
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
  attackSchedule,
  dodgePoints,
  lapsAt,
  makeCrowds,
  mulberry32,
  neighbours,
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

describe('Krampus auf dem Eis', () => {
  it('attacks are spaced out inside the race, never the same three times running', () => {
    const rng = mulberry32(2);
    for (let k = 0; k < 50; k++) {
      const s = attackSchedule(rng);
      expect(s).toHaveLength(LAUF_ATTACKS);
      for (let i = 0; i < s.length; i++) {
        expect(s[i][0] + DODGE_MS).toBeLessThanOrEqual(LAUF_MS);
        if (i) expect(s[i][0] - s[i - 1][0]).toBeGreaterThan(DODGE_MS);
        if (i >= 2) expect(s[i][1] === s[i - 1][1] && s[i][1] === s[i - 2][1]).toBe(false);
      }
    }
  });
  it('every attack has its own dodge', () => {
    expect(new Set(ATTACKS.map((a) => a.dodge)).size).toBe(ATTACKS.length);
  });
  it('the right move in time scores, quick ones score more', () => {
    const jump = ATTACKS.findIndex((a) => a.dodge === 'jump');
    expect(dodgePoints(jump, 'jump', 300)).toBeGreaterThan(dodgePoints(jump, 'jump', QUICK_MS + 100));
    expect(dodgePoints(jump, 'jump', QUICK_MS + 100)).toBeGreaterThan(0);
  });
  it('the wrong move, too late, or no move: you fall', () => {
    const jump = ATTACKS.findIndex((a) => a.dodge === 'jump');
    expect(dodgePoints(jump, 'duck', 300)).toBe(0);
    expect(dodgePoints(jump, 'jump', DODGE_MS + 1)).toBe(0);
    expect(dodgePoints(jump, null, null)).toBe(0);
    expect(dodgePoints(jump, 'jump', -50)).toBe(0);
  });
  it('dodging pushes you round the rink, falling holds you back', () => {
    expect(lapsAt(5000, 3, 0)).toBeGreaterThan(lapsAt(5000, 0, 0));
    expect(lapsAt(5000, 0, 3)).toBeLessThan(lapsAt(5000, 0, 0));
    expect(lapsAt(0, 0, 5)).toBe(0);
  });
  it('places add a bonus, nobody scores for falling every time', () => {
    const p = laufPoints({ a: 300, b: 100, c: 0 });
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
