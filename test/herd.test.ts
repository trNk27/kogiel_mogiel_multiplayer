import { describe, expect, it } from 'vitest';
import questions from '../data/herd.json';
import { mulberry32 } from '../client/src/games/rng';
import {
  ANSWER_MS,
  COW_PENALTY,
  HERD_QUESTIONS,
  HERD_QUESTIONS_SHORT,
  HerdMatch,
  MAX_ANSWER,
  clusterOffsets,
  clusterRadius,
  groupAnswers,
  herdSpots,
  homeSpots,
  howTo,
  levenshtein,
  normalizeAnswer,
  pickHerdQuestions,
  questionsFor,
  revealOrder,
  sameAnswer,
  sanitizeAnswer,
  scoreQuestion,
  typoAllowance,
  type HerdEntry,
} from '../client/src/games/herd/logic';

const E = (...texts: string[]): HerdEntry[] => texts.map((text, i) => ({ id: 'p' + (i + 1), text }));

describe('constants and texts', () => {
  it('has the documented sizes', () => {
    expect(questionsFor(false)).toBe(HERD_QUESTIONS);
    expect(questionsFor(true)).toBe(HERD_QUESTIONS_SHORT);
    expect(HERD_QUESTIONS).toBe(10);
    expect(HERD_QUESTIONS_SHORT).toBe(6);
    expect(ANSWER_MS).toBe(30_000);
    expect(MAX_ANSWER).toBe(30);
  });
  it('howTo has exactly 3 short lines', () => {
    for (const short of [false, true]) {
      const h = howTo(short);
      expect(h).toHaveLength(3);
      for (const l of h) expect(l.length).toBeGreaterThan(5);
      expect(h.join(' ')).not.toMatch(/coming soon/i);
    }
    expect(howTo(true)[2]).toContain('6');
    expect(howTo(false)[2]).toContain('10');
  });
});

describe('sanitizeAnswer', () => {
  it('cleans control characters, angle brackets and whitespace', () => {
    expect(sanitizeAnswer('  a   <b>cat</b>\n ')).toBe('a bcat/b');
    expect(sanitizeAnswer('tab\tbed')).toBe('tab bed');
  });
  it('caps the length and handles non-strings', () => {
    expect(sanitizeAnswer('x'.repeat(100))).toHaveLength(MAX_ANSWER);
    expect(sanitizeAnswer(42)).toBe('');
    expect(sanitizeAnswer(undefined)).toBe('');
    expect(sanitizeAnswer('   ')).toBe('');
  });
});

describe('normalizeAnswer', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeAnswer('Żółć!')).toBe(normalizeAnswer('zolc'));
    expect(normalizeAnswer('Kraków')).toBe(normalizeAnswer('krakow'));
    expect(normalizeAnswer('ice-cream')).toBe(normalizeAnswer('ice cream'));
    expect(normalizeAnswer("Babcia's soup")).toBe(normalizeAnswer('babcias soup'));
  });
  it('strips leading articles', () => {
    expect(normalizeAnswer('The cat')).toBe(normalizeAnswer('cat'));
    expect(normalizeAnswer('a dog')).toBe(normalizeAnswer('Dog'));
    expect(normalizeAnswer('An apple')).toBe(normalizeAnswer('apple'));
    // …but only at the start
    expect(normalizeAnswer('cat the')).not.toBe(normalizeAnswer('cat'));
  });
  it('turns number words into digits, in English and Polish', () => {
    expect(normalizeAnswer('seven')).toBe('7');
    expect(normalizeAnswer('Seven')).toBe(normalizeAnswer('7'));
    expect(normalizeAnswer('twenty')).toBe('20');
    expect(normalizeAnswer('siedem')).toBe('7');
    expect(normalizeAnswer('dziewięć')).toBe('9');
    expect(normalizeAnswer('07')).toBe('7');
    expect(normalizeAnswer('The Seven Dwarfs!')).toBe('7dwarf');
  });
  it('folds plurals', () => {
    expect(normalizeAnswer('cats')).toBe(normalizeAnswer('cat'));
    expect(normalizeAnswer('tomatoes')).toBe(normalizeAnswer('tomato'));
    expect(normalizeAnswer('boxes')).toBe(normalizeAnswer('box'));
    expect(normalizeAnswer('berries')).toBe(normalizeAnswer('berry'));
    expect(normalizeAnswer('glasses')).toBe(normalizeAnswer('glass'));
  });
  it('treats blank input as no answer', () => {
    expect(normalizeAnswer('')).toBe('');
    expect(normalizeAnswer('  !? ')).toBe('');
  });
});

describe('levenshtein and typo tolerance', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
  });
  it('gives up early past max', () => {
    expect(levenshtein('aaaaaaaa', 'bbbbbbbb', 2)).toBeGreaterThan(2);
    expect(levenshtein('a', 'abcdef', 2)).toBeGreaterThan(2);
  });
  it('allows 0 typos for short words, 1 from 5 letters, 2 from 9, none with digits', () => {
    expect(typoAllowance('cat', 'cut')).toBe(0);
    expect(typoAllowance('abcd', 'abce')).toBe(0);
    expect(typoAllowance('abcde', 'abcdf')).toBe(1);
    expect(typoAllowance('abcdefghi', 'abcdefghj')).toBe(2);
    expect(typoAllowance('abcde', 'abcdefghijkl')).toBe(1); // the shorter one counts
    expect(typoAllowance('12345', '12346')).toBe(0);
  });
  it('merges typos but not different short words', () => {
    expect(sameAnswer('burger', 'burgar')).toBe(true);
    expect(sameAnswer('pizza', 'piza')).toBe(false); // the shorter word has only 4 letters
    expect(sameAnswer('chocolate', 'chocolat')).toBe(true);
    expect(sameAnswer('strawberry', 'strawbery')).toBe(true);
    expect(sameAnswer('cat', 'car')).toBe(false);
    expect(sameAnswer('dog', 'dig')).toBe(false);
    expect(sameAnswer('red', 'bed')).toBe(false);
    expect(sameAnswer('7', '8')).toBe(false);
    expect(sameAnswer('banana', 'bananas')).toBe(true);
    expect(sameAnswer('apple', 'orange')).toBe(false);
  });
  it('blank never matches', () => {
    expect(sameAnswer('', '')).toBe(false);
    expect(sameAnswer('', 'cat')).toBe(false);
    expect(sameAnswer('!!', '??')).toBe(false);
  });
  it('is symmetric', () => {
    for (const [a, b] of [['burger', 'burgar'], ['cat', 'car'], ['Seven', '7'], ['strawberry', 'strawbery']]) {
      expect(sameAnswer(a, b)).toBe(sameAnswer(b, a));
    }
  });
});

describe('groupAnswers', () => {
  it('groups identical and near-identical answers', () => {
    const herds = groupAnswers(E('Burger', 'burger', 'burgar', 'Sushi'));
    expect(herds).toHaveLength(2);
    expect(herds[0].members).toEqual(['p1', 'p2', 'p3']);
    expect(herds[1].members).toEqual(['p4']);
  });
  it('is transitive (A~B, B~C → one herd)', () => {
    // abcdef ~ abcdeg (1), abcdeg ~ abcdhg (1), abcdef vs abcdhg = 2 > 1
    expect(sameAnswer('abcdef', 'abcdhg')).toBe(false);
    const herds = groupAnswers(E('abcdef', 'abcdhg', 'abcdeg'));
    expect(herds).toHaveLength(1);
    expect(herds[0].members.sort()).toEqual(['p1', 'p2', 'p3']);
  });
  it('does not depend on entry order', () => {
    const sizes = (xs: HerdEntry[]) => groupAnswers(xs).map((h) => h.members.length).sort();
    const a = E('abcdef', 'abcdhg', 'abcdeg', 'zebra');
    const b = [a[3], a[1], a[2], a[0]];
    expect(sizes(a)).toEqual(sizes(b));
  });
  it('labels a herd with its most typed spelling, the earliest on a tie', () => {
    expect(groupAnswers(E('Burgar', 'Burger', 'Burger'))[0].label).toBe('Burger');
    expect(groupAnswers(E('Burgar', 'Burger'))[0].label).toBe('Burgar');
  });
  it('makes blanks herds of one each', () => {
    const herds = groupAnswers(E('', '', 'cat', 'cat'));
    expect(herds).toHaveLength(3);
    expect(herds.filter((h) => h.blank)).toHaveLength(2);
    expect(herds.filter((h) => h.blank).every((h) => h.members.length === 1 && h.label === '')).toBe(true);
  });
  it('handles no entries', () => {
    expect(groupAnswers([])).toEqual([]);
  });
});

describe('scoreQuestion', () => {
  it('scores the single biggest herd', () => {
    const o = scoreQuestion(E('cat', 'Cat', 'cats', 'dog'));
    expect(o.verdict).toBe('herd');
    expect(o.scorers.sort()).toEqual(['p1', 'p2', 'p3']);
    expect(o.winner).toBeGreaterThanOrEqual(0);
    expect(o.herds[o.winner].members).toHaveLength(3);
  });
  it('scores nobody on a tie for biggest', () => {
    const o = scoreQuestion(E('cat', 'cat', 'dog', 'dog', 'fish'));
    expect(o.verdict).toBe('tie');
    expect(o.winner).toBe(-1);
    expect(o.scorers).toEqual([]);
  });
  it('scores nobody when nobody agrees', () => {
    const o = scoreQuestion(E('cat', 'dog', 'fish'));
    expect(o.verdict).toBe('apart');
    expect(o.scorers).toEqual([]);
    expect(o.cow).toBeNull();
  });
  it('a herd of two beats singletons', () => {
    const o = scoreQuestion(E('cat', 'cat', 'dog', 'fish'));
    expect(o.verdict).toBe('herd');
    expect(o.scorers).toEqual(['p1', 'p2']);
    expect(o.cow).toBeNull(); // two singletons
  });
  it('blanks never score', () => {
    const o = scoreQuestion(E('', '', '', 'cat'));
    expect(o.scorers).toEqual([]);
    expect(o.verdict).toBe('apart');
  });
  it('handles solo and pairs (no cow, can agree)', () => {
    expect(scoreQuestion(E('cat')).scorers).toEqual([]);
    expect(scoreQuestion(E('cat')).cow).toBeNull();
    const two = scoreQuestion(E('cat', 'cat'));
    expect(two.scorers).toEqual(['p1', 'p2']);
    expect(two.cow).toBeNull();
    expect(scoreQuestion(E('cat', 'dog')).cow).toBeNull();
  });
  it('gives the Pink Cow to exactly one lone player', () => {
    const o = scoreQuestion(E('cat', 'cat', 'dog', 'dog', 'fish'));
    expect(o.cow).toBe('p5');
    expect(o.verdict).toBe('tie');
    expect(scoreQuestion(E('cat', 'cat', 'cat', 'fish')).cow).toBe('p4');
  });
  it('gives no cow when everyone is in a herd', () => {
    expect(scoreQuestion(E('cat', 'cat', 'dog', 'dog')).cow).toBeNull();
  });
  it('no cow with two or more singletons', () => {
    expect(scoreQuestion(E('cat', 'cat', 'dog', 'fish')).cow).toBeNull();
  });
  it('a lone blank among herds gets the cow; two blanks do not', () => {
    expect(scoreQuestion(E('cat', 'cat', '')).cow).toBe('p3');
    expect(scoreQuestion(E('cat', 'cat', '', '')).cow).toBeNull();
    expect(scoreQuestion(E('cat', 'cat', '', 'dog')).cow).toBeNull();
  });
  it('requires at least three players for the cow', () => {
    expect(scoreQuestion(E('cat', '')).cow).toBeNull();
  });
  it('uses typo tolerance when scoring', () => {
    const o = scoreQuestion(E('burger', 'burgar', 'Burger!', 'soup'));
    expect(o.scorers.sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('revealOrder', () => {
  it('lists blanks first, then smallest to biggest, stable', () => {
    const herds = groupAnswers(E('cat', 'cat', 'cat', 'dog', '', 'fish', 'fish'));
    const order = revealOrder(herds);
    expect(order).toHaveLength(herds.length);
    const sizes = order.map((i) => (herds[i].blank ? 0 : herds[i].members.length));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(herds[order[0]].blank).toBe(true);
    expect(herds[order[order.length - 1]].members).toHaveLength(3);
  });
  it('is a permutation', () => {
    const herds = groupAnswers(E('a1', 'b2', 'c3', 'a1'));
    expect([...revealOrder(herds)].sort()).toEqual([0, 1, 2]);
  });
});

describe('HerdMatch', () => {
  const ids = ['p1', 'p2', 'p3', 'p4'];
  it('awards points to the biggest herd', () => {
    const m = new HerdMatch(ids);
    const a = m.apply(scoreQuestion(E('cat', 'cat', 'cat', 'dog')));
    expect(a.gained.sort()).toEqual(['p1', 'p2', 'p3']);
    expect(m.scores).toEqual({ p1: 1, p2: 1, p3: 1, p4: 0 });
    expect(a.cowTo).toBe('p4');
    expect(a.cowMoved).toBe(true);
    expect(a.cowFrom).toBeNull();
  });
  it('moves the cow from one player to another', () => {
    const m = new HerdMatch(ids);
    m.apply(scoreQuestion(E('cat', 'cat', 'cat', 'dog')));
    const a = m.apply(scoreQuestion(E('x1x', 'cat', 'cat', 'cat')));
    expect(a.cowFrom).toBe('p4');
    expect(a.cowTo).toBe('p1');
    expect(m.cow).toBe('p1');
  });
  it('keeps the cow when nobody is alone', () => {
    const m = new HerdMatch(ids);
    m.apply(scoreQuestion(E('cat', 'cat', 'cat', 'dog')));
    const a = m.apply(scoreQuestion(E('cat', 'cat', 'dog', 'dog')));
    expect(a.cowMoved).toBe(false);
    expect(m.cow).toBe('p4');
  });
  it('the same player getting the cow again is not a move', () => {
    const m = new HerdMatch(ids);
    m.apply(scoreQuestion(E('cat', 'cat', 'cat', 'dog')));
    expect(m.apply(scoreQuestion(E('cat', 'cat', 'cat', 'fish'))).cowMoved).toBe(false);
  });
  it('final subtracts 2 from the cow holder, never below 0', () => {
    const m = new HerdMatch(ids);
    for (let i = 0; i < 3; i++) m.apply(scoreQuestion(E('cat', 'cat', 'dog', 'dog')));
    expect(m.final()).toEqual({ p1: 0, p2: 0, p3: 0, p4: 0 });
    const n = new HerdMatch(ids);
    for (let i = 0; i < 4; i++) n.apply(scoreQuestion(E('cat', 'cat', 'cat', 'zzz')));
    expect(n.cow).toBe('p4');
    expect(n.final().p4).toBe(0);
    expect(n.penalty('p4')).toBe(0);
    // holder with points pays the full penalty
    const k = new HerdMatch(ids);
    k.apply(scoreQuestion(E('cat', 'cat', 'cat', 'dog')));
    for (let i = 0; i < 3; i++) k.apply(scoreQuestion(E('dog', 'cat', 'cat', 'cat')));
    k.apply(scoreQuestion(E('cat', 'cat', 'cat', 'dog'))); // p4 holds the cow again
    k.scores.p4 = 5;
    expect(k.penalty('p4')).toBe(COW_PENALTY);
    expect(k.final().p4).toBe(3);
    expect(k.final().p1).toBe(k.scores.p1);
  });
  it('ignores unknown players', () => {
    const m = new HerdMatch(['p1', 'p2']);
    const a = m.apply({ herds: [], winner: -1, scorers: ['ghost'], verdict: 'herd', cow: 'ghost' });
    expect(a.gained).toEqual([]);
    expect(m.cow).toBeNull();
    expect(m.scores).toEqual({ p1: 0, p2: 0 });
  });
  it('drops a removed player and the cow they held', () => {
    const m = new HerdMatch(ids);
    m.apply(scoreQuestion(E('cat', 'cat', 'cat', 'dog')));
    m.remove('p4');
    expect(m.cow).toBeNull();
    expect(Object.keys(m.final()).sort()).toEqual(['p1', 'p2', 'p3']);
    m.remove('p1');
    expect(m.cow).toBeNull();
    expect('p1' in m.scores).toBe(false);
  });
  it('plays a whole game', () => {
    const m = new HerdMatch(ids);
    const rounds = [
      E('cat', 'cat', 'cat', 'dog'),
      E('a', 'b', 'c', 'd'),
      E('red', 'red', 'blue', 'blue'),
      E('moon', 'sun', 'sun', 'sun'),
    ];
    for (const r of rounds) m.apply(scoreQuestion(r));
    expect(m.scores).toEqual({ p1: 1, p2: 2, p3: 2, p4: 1 });
    expect(m.cow).toBe('p1'); // last lone player
    expect(m.final()).toEqual({ p1: 0, p2: 2, p3: 2, p4: 1 });
  });
});

describe('pasture layout', () => {
  it('has a home spot per player, spread out and within the meadow', () => {
    for (let n = 1; n <= 8; n++) {
      const spots = homeSpots(n);
      expect(spots).toHaveLength(n);
      for (const s of spots) expect(Math.abs(s.x)).toBeLessThanOrEqual(13);
      expect(new Set(spots.map((s) => s.x.toFixed(2))).size).toBe(n);
    }
  });
  it('has a herd spot per herd, one row up to 4, two rows beyond', () => {
    for (let n = 1; n <= 8; n++) {
      const spots = herdSpots(n);
      expect(spots).toHaveLength(n);
      const zs = new Set(spots.map((s) => s.z));
      expect(zs.size).toBe(n <= 4 ? 1 : 2);
      for (const s of spots) expect(Math.abs(s.x)).toBeLessThanOrEqual(13);
    }
    expect(herdSpots(0)).toEqual([]);
  });
  it('has an offset per herd member, distinct', () => {
    for (let n = 1; n <= 8; n++) {
      const o = clusterOffsets(n);
      expect(o).toHaveLength(n);
      expect(new Set(o.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`)).size).toBe(n);
    }
    expect(clusterRadius(8)).toBeGreaterThan(clusterRadius(2));
    expect(clusterRadius(1)).toBeGreaterThan(0);
  });
});

describe('question data', () => {
  const list = questions as { id: string; q: string }[];
  it('has at least 160 questions', () => {
    expect(list.length).toBeGreaterThanOrEqual(160);
  });
  it('has unique ids and unique question texts', () => {
    expect(new Set(list.map((q) => q.id)).size).toBe(list.length);
    expect(new Set(list.map((q) => q.q.toLowerCase())).size).toBe(list.length);
  });
  it('has well-formed questions', () => {
    for (const q of list) {
      expect(q.id).toMatch(/^hd\d+$/);
      expect(q.q.trim()).toBe(q.q);
      expect(q.q.length).toBeGreaterThan(3);
      expect(q.q.length).toBeLessThanOrEqual(60);
      expect(Object.keys(q).sort()).toEqual(['id', 'q']);
    }
  });
});

describe('pickHerdQuestions', () => {
  const list = questions as { id: string; q: string }[];
  it('picks the right number without repeats', () => {
    const used = new Set<string>();
    const a = pickHerdQuestions(list, used, HERD_QUESTIONS, mulberry32(1));
    expect(a).toHaveLength(10);
    expect(new Set(a.map((q) => q.id)).size).toBe(10);
    const b = pickHerdQuestions(list, used, HERD_QUESTIONS, mulberry32(2));
    const ids = new Set(a.map((q) => q.id));
    expect(b.every((q) => !ids.has(q.id))).toBe(true);
  });
  it('recycles the pool once it is exhausted', () => {
    const used = new Set<string>();
    const pool = list.slice(0, 12);
    pickHerdQuestions(pool, used, 10, mulberry32(3));
    const next = pickHerdQuestions(pool, used, 10, mulberry32(4));
    expect(next).toHaveLength(10);
  });
  it('is deterministic for a seed', () => {
    const a = pickHerdQuestions(list, new Set(), 6, mulberry32(9)).map((q) => q.id);
    const b = pickHerdQuestions(list, new Set(), 6, mulberry32(9)).map((q) => q.id);
    expect(a).toEqual(b);
  });
});
