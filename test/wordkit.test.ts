import { describe, expect, it } from 'vitest';
import { canVote, cleanText, derange, freshLine, round50, scoreVotes } from '../client/src/games/wordkit/logic';
import { mulberry32 } from '../client/src/games/rng';

describe('word game kit', () => {
  it('cleans typed text', () => {
    expect(cleanText('  hello\n  <b>world</b>  ', 40)).toBe('hello bworld/b');
    expect(cleanText('x'.repeat(50), 10)).toBe('x'.repeat(10));
    expect(cleanText(42, 10)).toBe('');
    expect(cleanText('   ', 10)).toBe('');
  });

  it('rounds to 50', () => {
    expect([0, 24, 26, 74, 76, 1000].map(round50)).toEqual([0, 0, 50, 50, 100, 1000]);
  });

  it('picks a line nobody has used', () => {
    const pool = ['A', 'B', 'C'];
    for (let k = 0; k < 20; k++) expect(freshLine(pool, ['a', 'c'], mulberry32(k))).toBe('B');
    expect(pool).toContain(freshLine(pool, pool));
  });

  it('scores a vote: points per vote, a bonus for the most, no voting for yourself', () => {
    const r = scoreVotes(['a', 'b', 'c'], { a: 1, b: 2, c: 1, d: 1, e: 0 }, 100, 200);
    expect(r.voters).toEqual([['e'], ['a', 'c', 'd'], ['b']]);
    expect(r.winners).toEqual([1]);
    expect(r.points).toEqual({ a: 100, b: 500, c: 100 });
    const self = scoreVotes(['a', 'b'], { a: 0, b: 1 }, 100, 200);
    expect(self.voters).toEqual([[], []]);
    expect(self.winners).toEqual([]);
    expect(self.points).toEqual({ a: 0, b: 0 });
    const tie = scoreVotes(['a', 'b', 'c'], { a: 1, b: 0, c: 9 }, 100, 200);
    expect(tie.winners).toEqual([0, 1]);
    expect(tie.points).toEqual({ a: 300, b: 300, c: 0 });
  });

  it('knows who can vote for what', () => {
    expect(canVote('a', ['a', 'b'], 1)).toBe(true);
    expect(canVote('a', ['a', 'b'], 0)).toBe(false);
    expect(canVote('a', ['a', 'b'], 2)).toBe(false);
    expect(canVote('a', ['a', 'b'], '1')).toBe(false);
    expect(canVote('a', ['a', 'b'], 0.5)).toBe(false);
  });

  it('hands everyone someone else’s item, in one loop', () => {
    for (let n = 2; n <= 8; n++)
      for (let s = 0; s < 10; s++) {
        const to = derange(n, mulberry32(s));
        expect([...to].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, k) => k));
        to.forEach((t, k) => expect(t).not.toBe(k));
        // Following it from 0 visits everyone.
        const seen = new Set<number>();
        for (let k = 0; !seen.has(k); k = to[k]) seen.add(k);
        expect(seen.size).toBe(n);
      }
    expect(derange(1)).toEqual([0]);
    expect(derange(0)).toEqual([]);
  });
});
