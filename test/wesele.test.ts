import { describe, expect, it } from 'vitest';
import {
  MAX_DRUNK,
  PAIR_LATE_MS,
  PAIR_TASKS,
  DANCE_MAX,
  WESELE_SONGS,
  WESELE_SONGS_SHORT,
  clockFor,
  drink,
  dancePassed,
  dizzy,
  gorzkoPoints,
  howTo,
  makePairs,
  mulberry32,
  pairOk,
  pairWindowMs,
  twirlsNeeded,
  wujekRelease,
} from '../client/src/games/wesele/logic';

describe('the night', () => {
  it('runs from 18:00 to 3:00', () => {
    expect(clockFor(1, WESELE_SONGS)).toBe('18:00');
    expect(clockFor(WESELE_SONGS + 1, WESELE_SONGS)).toBe('03:00');
    expect(clockFor(WESELE_SONGS_SHORT + 1, WESELE_SONGS_SHORT)).toBe('03:00');
    expect(clockFor(3, WESELE_SONGS) > clockFor(2, WESELE_SONGS)).toBe(true);
  });
  it('every shot makes you drunker, and one too many puts you under the table', () => {
    let level = 0;
    for (let i = 0; i < MAX_DRUNK; i++) {
      const d = drink(level);
      expect(d.out).toBe(false);
      expect(d.level).toBe(level + 1);
      level = d.level;
    }
    expect(drink(level)).toEqual({ level: MAX_DRUNK, out: true });
  });
});

describe('twirl dance', () => {
  it('needs more twirls later in the night', () => {
    expect(twirlsNeeded(WESELE_SONGS, WESELE_SONGS)).toBeGreaterThan(twirlsNeeded(1, WESELE_SONGS));
    expect(twirlsNeeded(1, WESELE_SONGS)).toBeLessThan(DANCE_MAX);
  });
  it('passes with enough twirls', () => {
    expect(dancePassed(6, 6)).toBe(true);
    expect(dancePassed(5, 6)).toBe(false);
  });
  it('the drunker, the dizzier', () => {
    expect(dizzy(0)).toBe(1);
    for (let d = 1; d <= MAX_DRUNK; d++) expect(dizzy(d)).toBeLessThan(dizzy(d - 1));
    expect(dizzy(MAX_DRUNK)).toBeGreaterThan(0);
  });
});

describe('oczepiny pair game', () => {
  it('needs both to let go close together, around NOW!', () => {
    const w = pairWindowMs(0, 0);
    expect(pairOk(0, 0, w)).toBe(true);
    expect(pairOk(100, 150, w)).toBe(true);
    expect(pairOk(0, w + 1, w)).toBe(false);
    expect(pairOk(null, 0, w)).toBe(false);
    expect(pairOk(PAIR_LATE_MS + 10, PAIR_LATE_MS + 10, w)).toBe(false);
    expect(pairOk(-2000, -2000, w)).toBe(false);
  });
  it('is harder the drunker you are', () => {
    expect(pairWindowMs(5, 5)).toBeLessThan(pairWindowMs(0, 0));
    expect(pairWindowMs(5, 5)).toBeGreaterThan(0);
  });
  it('pairs everyone once, with Wujek for an odd one out', () => {
    const rng = mulberry32(5);
    for (let n = 1; n <= 8; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const pairs = makePairs(ids, rng, true);
      const seen = pairs.flatMap(([a, b]) => (b ? [a, b] : [a]));
      expect(seen.sort()).toEqual(ids.slice().sort());
      expect(pairs.filter(([, b]) => b === null)).toHaveLength(n % 2);
    }
  });
  it('Wujek lets go somewhere sensible', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 200; i++) expect(Math.abs(wujekRelease(rng))).toBeLessThan(1000);
  });
  it('has tasks', () => {
    expect(PAIR_TASKS.length).toBeGreaterThanOrEqual(WESELE_SONGS);
  });
});

describe('Gorzko!', () => {
  it('the fastest scores most and the slowest drinks', () => {
    const { pts, slowest } = gorzkoPoints({ a: 30, b: 20, c: 10 });
    expect(pts.a).toBeGreaterThan(pts.b);
    expect(pts.b).toBeGreaterThan(pts.c);
    expect(slowest).toEqual(['c']);
  });
  it('nobody drinks when everyone ties, or on your own', () => {
    expect(gorzkoPoints({ a: 10, b: 10 }).slowest).toEqual([]);
    expect(gorzkoPoints({ a: 10 }).slowest).toEqual([]);
  });
});

describe('howTo', () => {
  it('has three lines', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)[2]).toContain('2 songs');
  });
});
