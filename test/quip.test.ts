import { describe, expect, it } from 'vitest';
import data from '../data/quip.json';
import { mulberry32 } from '../client/src/games/rng';
import {
  QP_FINAL_MULT,
  QP_FINAL_VOTES,
  QP_MAX,
  QP_RIPOSTA_BONUS,
  QP_WRITE_MS,
  QP_WRITE_MS_SHORT,
  answerKey,
  authorsAt,
  canPickFinal,
  finalAuthorsAt,
  finalJinxed,
  finalRevealMs,
  finalVotesFor,
  howTo,
  layoutFor,
  matchupRevealMs,
  multiplier,
  orderMatchups,
  pairKey,
  pairUp,
  pickPrompts,
  safetyAnswer,
  sanitizeAnswer,
  scoreFinal,
  scoreMatchup,
  slotsFor,
  type FinalEntry,
  type QpPrompt,
} from '../client/src/games/quip/logic';

const PROMPTS = data.prompts as QpPrompt[];
const SAFETY = data.safety as string[];
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('layout and text', () => {
  it('has a full game of two rounds and a short one of one', () => {
    expect(layoutFor(false)).toEqual({ rounds: 2, writeMs: QP_WRITE_MS });
    expect(layoutFor(true)).toEqual({ rounds: 1, writeMs: QP_WRITE_MS_SHORT });
    expect(QP_WRITE_MS).toBe(80_000);
    expect(QP_MAX).toBe(45);
  });
  it('pays double in round 2 and never less than 1', () => {
    expect(multiplier(1)).toBe(1);
    expect(multiplier(2)).toBe(2);
    expect(multiplier(0)).toBe(1);
    expect(multiplier(5)).toBe(2);
  });
  it('howTo has exactly 3 lines', () => {
    for (const short of [false, true]) {
      const h = howTo(short);
      expect(h).toHaveLength(3);
      expect(h.join(' ')).not.toMatch(/coming soon/i);
    }
    expect(howTo(true)[2]).toMatch(/One round/);
    expect(howTo(false)[2]).toMatch(/Two rounds/);
  });
  it('cleans answers', () => {
    expect(sanitizeAnswer('  a   <b>sad</b>\n cowboy ')).toBe('a bsad/b cowboy');
    expect(sanitizeAnswer('x'.repeat(100))).toHaveLength(QP_MAX);
    expect(sanitizeAnswer(`${'x'.repeat(44)} yyyy`)).toBe('x'.repeat(44));
    expect(sanitizeAnswer(42)).toBe('');
    expect(sanitizeAnswer(null)).toBe('');
    expect(sanitizeAnswer('   ')).toBe('');
  });
  it('compares answers without case, accents, punctuation or articles', () => {
    expect(answerKey('The Haunted toaster!')).toBe(answerKey('a haunted  toaster'));
    expect(answerKey('Babcia’s hat')).toBe(answerKey("babcias hat"));
    expect(answerKey('Żółw')).toBe('zolw');
    expect(answerKey('A cat')).not.toBe(answerKey('A dog'));
    expect(answerKey('The')).toBe('');
  });
});

describe('safety answers and prompts', () => {
  it('avoids what was already said', () => {
    const rng = mulberry32(1);
    const pool = ['A', 'B', 'C'];
    for (let i = 0; i < 20; i++) expect(safetyAnswer(pool, ['a', 'the B'], rng)).toBe('C');
  });
  it('falls back to the whole pool when everything is taken', () => {
    expect(['A', 'B']).toContain(safetyAnswer(['A', 'B'], ['A', 'B'], mulberry32(2)));
  });
  it('never returns nothing, even from an empty pool', () => {
    expect(safetyAnswer([], [], mulberry32(3)).length).toBeGreaterThan(0);
  });
  it('picks prompts without repeats and recycles', () => {
    const used = new Set<string>();
    const a = pickPrompts(PROMPTS, used, 8, mulberry32(1));
    const b = pickPrompts(PROMPTS, used, 8, mulberry32(2));
    expect(new Set([...a, ...b]).size).toBe(16);
    const small = PROMPTS.slice(0, 5);
    const u2 = new Set<string>();
    pickPrompts(small, u2, 4, mulberry32(3));
    expect(pickPrompts(small, u2, 4, mulberry32(4))).toHaveLength(4);
  });
});

describe('pairing', () => {
  for (let n = 3; n <= 8; n++) {
    it(`gives each of ${n} players two prompts against two different opponents`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const players = ids(n);
        const pairs = pairUp(players, mulberry32(seed));
        expect(pairs).toHaveLength(n);
        for (const id of players) {
          const slots = slotsFor(id, pairs);
          expect(slots).toHaveLength(2);
          expect(slots[0]).not.toBe(slots[1]);
          const opponents = slots.map((s) => pairs[s].find((x) => x !== id)!);
          if (n >= 3) expect(new Set(opponents).size).toBe(n === 3 ? 2 : 2);
        }
        for (const [a, b] of pairs) expect(a).not.toBe(b);
      }
    });
  }
  it('with 3 players every pair meets exactly once', () => {
    const pairs = pairUp(ids(3), mulberry32(5));
    expect(new Set(pairs.map(([a, b]) => pairKey(a, b))).size).toBe(3);
  });
  it('with two players both prompts go to both', () => {
    const pairs = pairUp(ids(2), mulberry32(1));
    expect(pairs).toHaveLength(2);
    for (const p of pairs) expect([...p].sort()).toEqual(['p1', 'p2']);
  });
  it('with fewer than two players there is nothing to pair', () => {
    expect(pairUp([], mulberry32(1))).toEqual([]);
    expect(pairUp(['p1'], mulberry32(1))).toEqual([]);
  });
  it('avoids last round’s pairs where it can', () => {
    const players = ids(6);
    for (let seed = 1; seed <= 15; seed++) {
      const first = pairUp(players, mulberry32(seed));
      const avoid = new Set(first.map(([a, b]) => pairKey(a, b)));
      const second = pairUp(players, mulberry32(seed + 100), avoid);
      expect(second.filter(([a, b]) => avoid.has(pairKey(a, b)))).toHaveLength(0);
    }
  });
  it('pairKey is order independent', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'));
  });
  it('orders matchups as a permutation and avoids back-to-back authors', () => {
    for (let n = 4; n <= 8; n++) {
      const pairs = pairUp(ids(n), mulberry32(n));
      const order = orderMatchups(pairs, mulberry32(n + 1));
      expect([...order].sort((a, b) => a - b)).toEqual(pairs.map((_, i) => i));
      const clashes = order.slice(1).filter((m, k) => pairs[m].some((a) => pairs[order[k]].includes(a)));
      expect(clashes.length).toBeLessThanOrEqual(1);
    }
    expect(orderMatchups([], mulberry32(1))).toEqual([]);
  });
});

describe('scoreMatchup', () => {
  const authors: [string, string] = ['a', 'b'];
  const texts: [string, string] = ['Soup', 'Gravel'];
  it('gives 100 per vote', () => {
    const r = scoreMatchup(texts, authors, { v1: 0, v2: 0, v3: 1 });
    expect(r.points).toEqual({ a: 200, b: 100 });
    expect(r.winner).toBe(0);
    expect(r.riposta).toBeNull();
    expect(r.voters).toEqual([['v1', 'v2'], ['v3']]);
    expect(r.jinx).toBe(false);
  });
  it('multiplies by the round', () => {
    expect(scoreMatchup(texts, authors, { v1: 0, v2: 1 }, 2).points).toEqual({ a: 200, b: 200 });
  });
  it('gives RIPOSTA for all the votes (at least two)', () => {
    const r = scoreMatchup(texts, authors, { v1: 1, v2: 1, v3: 1 });
    expect(r.riposta).toBe(1);
    expect(r.points).toEqual({ a: 0, b: 300 + QP_RIPOSTA_BONUS });
    expect(r.winner).toBe(1);
    expect(scoreMatchup(texts, authors, { v1: 0, v2: 0 }, 2).points.a).toBe(2 * (200 + QP_RIPOSTA_BONUS));
  });
  it('gives no RIPOSTA for a single vote', () => {
    const r = scoreMatchup(texts, authors, { v1: 0 });
    expect(r.riposta).toBeNull();
    expect(r.points).toEqual({ a: 100, b: 0 });
  });
  it('treats a tie as no winner', () => {
    const r = scoreMatchup(texts, authors, { v1: 0, v2: 1 });
    expect(r.winner).toBeNull();
    expect(r.points).toEqual({ a: 100, b: 100 });
  });
  it('scores nothing with no votes', () => {
    const r = scoreMatchup(texts, authors, {});
    expect(r.points).toEqual({ a: 0, b: 0 });
    expect(r.winner).toBeNull();
    expect(r.riposta).toBeNull();
  });
  it('ignores the authors’ own votes and garbage', () => {
    const r = scoreMatchup(texts, authors, { a: 0, b: 1, v1: 0, v2: 5, v3: -1, v4: 0.5 });
    expect(r.points).toEqual({ a: 100, b: 0 });
    expect(r.voters[0]).toEqual(['v1']);
  });
  it('jinx: identical answers score nothing and ignore votes', () => {
    const r = scoreMatchup(['The Cat!', 'a cat'], authors, { v1: 0, v2: 1, v3: 1 });
    expect(r.jinx).toBe(true);
    expect(r.points).toEqual({ a: 0, b: 0 });
    expect(r.riposta).toBeNull();
    expect(r.winner).toBeNull();
  });
  it('handles two answers by the same player (2-player prompts)', () => {
    const r = scoreMatchup(texts, ['a', 'a'], { v1: 0 });
    expect(r.points).toEqual({ a: 100 });
  });
});

describe('Ostatnia Riposta', () => {
  const entries: FinalEntry[] = [
    { author: 'p1', text: 'Soup' },
    { author: 'p2', text: 'Gravel' },
    { author: 'p3', text: 'Geese' },
    { author: 'p4', text: 'Moon' },
  ];
  it('detects jinxed answers', () => {
    expect(finalJinxed(entries)).toEqual([false, false, false, false]);
    expect(finalJinxed([...entries, { author: 'p5', text: 'the soup' }])).toEqual([true, false, false, false, true]);
  });
  it('lets a player give three votes, not to themselves, jinxes or twice', () => {
    const jinxed = finalJinxed([...entries, { author: 'p5', text: 'soup!' }]);
    const all = [...entries, { author: 'p5', text: 'soup!' }];
    expect(canPickFinal('p1', all, jinxed, [], 0)).toBe(false); // own (and jinxed)
    expect(canPickFinal('p2', all, jinxed, [], 0)).toBe(false); // jinxed
    expect(canPickFinal('p1', all, jinxed, [], 1)).toBe(true);
    expect(canPickFinal('p1', all, jinxed, [1], 1)).toBe(false); // twice
    expect(canPickFinal('p1', all, jinxed, [1, 2, 3], 1)).toBe(false); // out of votes
    expect(canPickFinal('p1', all, jinxed, [], 9)).toBe(false);
    expect(canPickFinal('p1', all, jinxed, [], -1)).toBe(false);
    expect(canPickFinal('p1', all, jinxed, [], 1.5)).toBe(false);
  });
  it('gives fewer votes when there are fewer answers to vote for', () => {
    expect(finalVotesFor('p1', entries, finalJinxed(entries))).toBe(3);
    expect(finalVotesFor('p1', entries.slice(0, 3), [false, false, false])).toBe(2);
    expect(finalVotesFor('p1', entries.slice(0, 1), [false])).toBe(0);
    expect(QP_FINAL_VOTES).toBe(3);
  });
  it('pays 300 per vote', () => {
    const r = scoreFinal(entries, { p1: [1, 2, 3], p2: [2], p3: [1, 3], p4: [2, 1] });
    expect(r.voters[1].sort()).toEqual(['p1', 'p3', 'p4']);
    expect(r.voters[2].sort()).toEqual(['p1', 'p2', 'p4']);
    expect(r.points).toEqual({ p1: 0, p2: 3 * 100 * QP_FINAL_MULT, p3: 3 * 100 * QP_FINAL_MULT, p4: 2 * 100 * QP_FINAL_MULT });
    expect(r.winners.sort()).toEqual([1, 2]);
  });
  it('drops invalid picks: own answer, doubles, too many', () => {
    const r = scoreFinal(entries, { p1: [0, 1, 1, 2, 3, 3], p2: [9, -2] });
    expect(r.points.p1).toBe(0);
    expect(r.points.p2).toBe(300); // p1's valid picks: 1, 2, 3 (the own pick 0 is dropped and doesn't use a vote)
    expect(r.points.p3).toBe(300);
    expect(r.points.p4).toBe(300);
    expect(r.voters[0]).toEqual([]);
  });
  it('counts no votes for jinxed answers', () => {
    const e = [...entries, { author: 'p5', text: 'The Soup' }];
    const r = scoreFinal(e, { p2: [0, 4, 2] });
    expect(r.points).toEqual({ p1: 0, p2: 0, p3: 300, p4: 0, p5: 0 });
  });
  it('has no winners without votes', () => {
    const r = scoreFinal(entries, {});
    expect(r.winners).toEqual([]);
    expect(Object.values(r.points).every((p) => p === 0)).toBe(true);
  });
});

describe('timing', () => {
  it('reveals authors after the voters have popped in', () => {
    expect(authorsAt(4)).toBeGreaterThan(authorsAt(1));
    expect(matchupRevealMs(3, false)).toBeGreaterThan(authorsAt(3));
    expect(matchupRevealMs(3, true)).toBeLessThan(matchupRevealMs(3, false));
    expect(finalRevealMs(10)).toBeGreaterThan(finalAuthorsAt(10));
    expect(finalAuthorsAt(6)).toBeGreaterThan(finalAuthorsAt(1));
  });
});

describe('data', () => {
  it('has at least 220 unique prompts', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(220);
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length);
    expect(new Set(PROMPTS.map((p) => p.prompt.toLowerCase())).size).toBe(PROMPTS.length);
  });
  it('has well-formed prompts', () => {
    for (const p of PROMPTS) {
      expect(p.id).toMatch(/^qp\d+$/);
      expect(p.prompt.trim()).toBe(p.prompt);
      expect(p.prompt.length).toBeGreaterThan(8);
      expect(p.prompt.length).toBeLessThanOrEqual(90);
    }
  });
  it('has about 60 safety answers that fit and are unique', () => {
    expect(SAFETY.length).toBeGreaterThanOrEqual(55);
    expect(new Set(SAFETY.map(answerKey)).size).toBe(SAFETY.length);
    for (const s of SAFETY) {
      expect(s.length).toBeGreaterThan(2);
      expect(s.length).toBeLessThanOrEqual(QP_MAX);
      expect(sanitizeAnswer(s)).toBe(s);
    }
  });
});
