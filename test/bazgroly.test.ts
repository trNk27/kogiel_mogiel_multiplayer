import { describe, expect, it } from 'vitest';
import prompts from '../data/bazgroly.json';
import { MAX_TITLE_LENGTH } from '../shared/protocol';
import { mulberry32 } from '../client/src/games/rng';
import {
  BZ_ARTIST_POINTS,
  BZ_LIE_POINTS,
  BZ_MIN_OPTIONS,
  BZ_TRUTH_POINTS,
  assignPrompts,
  buildOptions,
  revealOrder,
  roundsFor,
  sanitizeTitle,
  scoreDrawing,
  titleKey,
  type BzOption,
} from '../client/src/games/bazgroly/logic';

describe('titles', () => {
  it('compares titles without case, accents, punctuation or articles', () => {
    expect(titleKey('The Haunted  toaster!')).toBe(titleKey('a haunted toaster'));
    expect(titleKey('Babcia’s secret dance move')).toBe(titleKey("babcias secret dance-move"));
    expect(titleKey('Bazgroły')).toBe('bazgroly');
    expect(titleKey('A cat')).not.toBe(titleKey('A dog'));
  });
  it('cleans up typed titles', () => {
    expect(sanitizeTitle('  a   <b>sad</b>\ncowboy ')).toBe('a bsad/b cowboy');
    expect(sanitizeTitle('x'.repeat(100))).toHaveLength(MAX_TITLE_LENGTH);
    expect(sanitizeTitle(42)).toBe('');
  });
});

describe('buildOptions', () => {
  it('merges identical lies and drops lies that match the truth', () => {
    const options = buildOptions('A haunted toaster', { a: 'A sad cowboy', b: 'sad cowboy!', c: 'the haunted toaster', d: 'A goat' }, [], mulberry32(1));
    expect(options).toHaveLength(3);
    expect(options.find((o) => o.truth)?.text).toBe('A haunted toaster');
    expect(options.find((o) => o.text === 'A sad cowboy')?.authors).toEqual(['a', 'b']);
    expect(options.find((o) => o.text === 'A goat')?.authors).toEqual(['d']);
  });
  it('fills up with decoys, skipping ones that are already there', () => {
    const options = buildOptions('A cat', {}, ['a cat', 'A dog', 'A dog', 'A cow', 'A hen'], mulberry32(2));
    expect(options).toHaveLength(BZ_MIN_OPTIONS);
    expect(options.map((o) => o.text).sort()).toEqual(['A cat', 'A cow', 'A dog']);
    expect(options.every((o) => o.authors.length === 0)).toBe(true);
  });
  it('adds no decoys when there are enough lies', () => {
    const options = buildOptions('A cat', { a: 'A dog', b: 'A cow' }, ['A hen'], mulberry32(3));
    expect(options.map((o) => o.text)).not.toContain('A hen');
  });
});

describe('scoreDrawing', () => {
  const options: BzOption[] = [
    { text: 'A cat', truth: true, authors: [] },
    { text: 'A dog', truth: false, authors: ['b'] },
    { text: 'A cow', truth: false, authors: ['c', 'd'] },
    { text: 'A hen', truth: false, authors: [] },
  ];
  it('pays guessers and the artist for the truth, and liars per player fooled', () => {
    const s = scoreDrawing(options, { b: 0, c: 1, d: 0, e: 2 }, 'a');
    expect(s.found).toBe(2);
    expect(s.points.a).toBe(2 * BZ_ARTIST_POINTS);
    expect(s.points.b).toBe(BZ_TRUTH_POINTS + BZ_LIE_POINTS);
    expect(s.points.c).toBe(BZ_LIE_POINTS);
    expect(s.points.d).toBe(BZ_TRUTH_POINTS + BZ_LIE_POINTS);
    expect(s.points.e).toBeUndefined();
    expect(s.pickers).toEqual([['b', 'd'], ['c'], ['e'], []]);
  });
  it('ignores the artist’s pick and picks of your own lie, and applies the multiplier', () => {
    const s = scoreDrawing(options, { a: 0, b: 1, c: 2, e: 3 }, 'a', 2);
    expect(s.found).toBe(0);
    expect(s.points).toEqual({});
    expect(s.pickers).toEqual([[], [], [], ['e']]);
    expect(scoreDrawing(options, { b: 0 }, 'a', 2).points).toEqual({ a: 2 * BZ_ARTIST_POINTS, b: 2 * BZ_TRUTH_POINTS });
  });
});

describe('revealOrder', () => {
  it('shows lies that fooled somebody, least popular first, then the truth', () => {
    const options: BzOption[] = [
      { text: 'A dog', truth: false, authors: ['b'] },
      { text: 'A cat', truth: true, authors: [] },
      { text: 'A cow', truth: false, authors: ['c'] },
      { text: 'A hen', truth: false, authors: ['d'] },
    ];
    expect(revealOrder(options, [['x', 'y'], ['z'], [], ['w']])).toEqual([3, 0, 1]);
    expect(revealOrder(options, [[], [], [], []])).toEqual([1]);
  });
});

describe('rounds and prompts', () => {
  it('plays two rounds in small groups and one in big ones', () => {
    expect(roundsFor(3)).toBe(2);
    expect(roundsFor(4)).toBe(2);
    expect(roundsFor(5)).toBe(1);
    expect(roundsFor(8)).toBe(1);
  });
  it('gives every player a different prompt', () => {
    const used = new Set<string>();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (let seed = 1; seed < 20; seed++) {
      const got = assignPrompts(prompts, used, ids, mulberry32(seed));
      expect(Object.keys(got)).toEqual(ids);
      expect(new Set(Object.values(got)).size).toBe(ids.length);
    }
  });
});

describe('bazgroły data', () => {
  it('has 200 distinct, short prompts', () => {
    expect(prompts.length).toBeGreaterThanOrEqual(200);
    expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length);
    expect(new Set(prompts.map((p) => titleKey(p.prompt))).size).toBe(prompts.length);
    for (const p of prompts) {
      expect(p.prompt.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(p.prompt).toBe(sanitizeTitle(p.prompt));
      expect(p.prompt).not.toMatch(/[.?!]$/);
    }
  });
});
