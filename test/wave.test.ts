import { describe, expect, it } from 'vitest';
import pool from '../data/wave.json';
import { DOODLE_COLORS, DOODLE_SPACE, DOODLE_WIDTHS } from '../shared/protocol';
import { mulberry32 } from '../client/src/games/rng';
import {
  NO_CLUE,
  TARGET_MARGIN,
  WAVE_CLUE_MAX,
  WaveMatch,
  clueProblem,
  howTo,
  pickSpectra,
  pointsFor,
  psychicPlan,
  psychicPoints,
  randomTarget,
  roundsFor,
  sanitizeClue,
  sanitizeGuess,
  scoreRound,
  type Spectrum,
} from '../client/src/games/wave/logic';
import { angleOf, dialStrokes, markerTiers, pointAt, slicePath } from '../client/src/games/wave/dial';

const POOL = pool as Spectrum[];
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

function match(n: number, opts: { short?: boolean; seed?: number } = {}) {
  const m = new WaveMatch(ids(n), { short: opts.short, pool: POOL, rng: mulberry32(opts.seed ?? 1) });
  m.nextRound();
  return m;
}

/** Intro → clue phase. */
function toClue(m: WaveMatch) {
  expect(m.phase).toBe('intro');
  m.advance();
  expect(m.phase).toBe('clue');
}

describe('content', () => {
  it('has at least 120 distinct, tidy spectra', () => {
    expect(POOL.length).toBeGreaterThanOrEqual(120);
    expect(new Set(POOL.map((s) => s.id)).size).toBe(POOL.length);
    expect(new Set(POOL.map((s) => `${s.left}|${s.right}`.toLowerCase())).size).toBe(POOL.length);
    for (const s of POOL) {
      expect(s.left.trim()).toBe(s.left);
      expect(s.right.trim()).toBe(s.right);
      expect(s.left.length).toBeGreaterThan(1);
      expect(s.left.length).toBeLessThanOrEqual(26);
      expect(s.right.length).toBeLessThanOrEqual(26);
      expect(s.left.toLowerCase()).not.toBe(s.right.toLowerCase());
    }
  });
  it('includes the classics', () => {
    const pairs = POOL.map((s) => `${s.left} ↔ ${s.right}`);
    for (const p of ['Cold ↔ Hot', 'Babcia would approve ↔ Babcia would faint', 'Mild ↔ Spicy', 'Bad film ↔ Good film']) expect(pairs).toContain(p);
  });
  it('has three short how-to lines', () => {
    for (const short of [false, true]) {
      const lines = howTo(short);
      expect(lines).toHaveLength(3);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(70);
    }
  });
});

describe('scoring', () => {
  it('scores by distance bands, edges included', () => {
    expect(pointsFor(50, 50)).toBe(4);
    expect(pointsFor(54, 50)).toBe(4);
    expect(pointsFor(46, 50)).toBe(4);
    expect(pointsFor(55, 50)).toBe(3);
    expect(pointsFor(60, 50)).toBe(3);
    expect(pointsFor(40, 50)).toBe(3);
    expect(pointsFor(61, 50)).toBe(2);
    expect(pointsFor(67, 50)).toBe(2);
    expect(pointsFor(33, 50)).toBe(2);
    expect(pointsFor(68, 50)).toBe(0);
    expect(pointsFor(32, 50)).toBe(0);
    expect(pointsFor(100, 5)).toBe(0);
    expect(pointsFor(0, 5)).toBe(3);
  });
  it('gives the Psychic the rounded average of the guessers', () => {
    expect(psychicPoints([])).toBe(0);
    expect(psychicPoints([4])).toBe(4);
    expect(psychicPoints([4, 0])).toBe(2);
    expect(psychicPoints([3, 2])).toBe(3); // 2.5 rounds up
    expect(psychicPoints([2, 2, 3])).toBe(2); // 2.33
    expect(psychicPoints([3, 3, 2])).toBe(3); // 2.67
    expect(psychicPoints([0, 0, 0, 2])).toBe(1); // 0.5
    expect(psychicPoints([0, 0, 0, 0, 2])).toBe(0); // 0.4
    expect(psychicPoints([0, 0])).toBe(0);
  });
  it('scores a round for guessers and the Psychic, ignoring a Psychic guess', () => {
    const r = scoreRound(70, { a: 70, b: 80, c: 10, psy: 70 }, 'psy');
    expect(r.points).toEqual({ a: 4, b: 3, c: 0, psy: 2 });
    expect(scoreRound(30, {}, 'psy').points).toEqual({ psy: 0 });
  });
  it('cleans guesses', () => {
    expect(sanitizeGuess(42.6)).toBe(43);
    expect(sanitizeGuess(-5)).toBe(0);
    expect(sanitizeGuess(250)).toBe(100);
    expect(sanitizeGuess('50')).toBeNull();
    expect(sanitizeGuess(NaN)).toBeNull();
    expect(sanitizeGuess(undefined)).toBeNull();
  });
});

describe('targets and clues', () => {
  it('keeps targets away from the very ends', () => {
    expect(randomTarget(() => 0)).toBe(TARGET_MARGIN);
    expect(randomTarget(() => 0.999999)).toBe(100 - TARGET_MARGIN);
    const rng = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const t = randomTarget(rng);
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(5);
      expect(t).toBeLessThanOrEqual(95);
      seen.add(t);
    }
    expect(seen.size).toBe(91);
  });
  it('cleans clues and turns down the target number', () => {
    expect(sanitizeClue('  bigos   on\nthe <stove> ')).toBe('bigos on the stove');
    expect(sanitizeClue('x'.repeat(100))).toHaveLength(WAVE_CLUE_MAX);
    expect(sanitizeClue(5)).toBe('');
    expect(clueProblem('', 50)).not.toBeNull();
    expect(clueProblem('about 73 I guess', 73)).not.toBeNull();
    expect(clueProblem('73', 73)).not.toBeNull();
    expect(clueProblem('1973 film', 73)).toBeNull();
    expect(clueProblem('Top 10 song', 73)).toBeNull();
    expect(clueProblem('Bigos', 73)).toBeNull();
  });
});

describe('rounds and rotation', () => {
  it('plays 2 × players rounds (4..8), short: players (2..4)', () => {
    const full = [2, 3, 4, 5, 6, 7, 8].map((n) => roundsFor(n));
    expect(full).toEqual([4, 6, 8, 8, 8, 8, 8]);
    const short = [2, 3, 4, 5, 6, 7, 8].map((n) => roundsFor(n, true));
    expect(short).toEqual([2, 3, 4, 4, 4, 4, 4]);
    expect(roundsFor(1)).toBe(4);
    expect(roundsFor(1, true)).toBe(2);
  });
  it('rotates the Psychic through the players in order, once or twice each', () => {
    for (let n = 2; n <= 8; n++) {
      const plan = psychicPlan(ids(n), roundsFor(n));
      plan.forEach((p, r) => expect(p).toBe(`p${r % n}`));
      const counts = ids(n).map((id) => plan.filter((p) => p === id).length);
      for (const c of counts) {
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(2);
      }
    }
    expect(psychicPlan([], 4)).toEqual([]);
  });
  it('never repeats a spectrum within a game', () => {
    for (let seed = 1; seed < 40; seed++) {
      const used = new Set<string>();
      for (let g = 0; g < 20; g++) {
        const picked = pickSpectra(POOL, used, 8, mulberry32(seed * 100 + g));
        expect(picked).toHaveLength(8);
        expect(new Set(picked.map((s) => s.id)).size).toBe(8);
      }
    }
  });
  it('moves on to fresh spectra across games in a session', () => {
    const used = new Set<string>();
    const a = pickSpectra(POOL, used, 8, mulberry32(1)).map((s) => s.id);
    const b = pickSpectra(POOL, used, 8, mulberry32(2)).map((s) => s.id);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });
});

/** Play one round: a clue and the given guesses, then the reveal. */
function playRound(m: WaveMatch, guesses: Record<string, number | ((t: number) => number)>, clue = 'Bigos') {
  toClue(m);
  expect(m.submitClue(m.psychic, m.key, clue)).toBe('ok');
  m.advance();
  expect(m.phase).toBe('guess');
  for (const [id, g] of Object.entries(guesses)) m.submitGuess(id, m.key, typeof g === 'function' ? g(m.target) : g);
  m.advance();
  expect(m.phase).toBe('reveal');
  return m.result!;
}

describe('WaveMatch', () => {
  it('plays a whole game and adds up the scores', () => {
    for (let n = 2; n <= 8; n++) {
      const m = match(n, { seed: n });
      const totals: Record<string, number> = Object.fromEntries(ids(n).map((id) => [id, 0]));
      let rounds = 0;
      const spectra = new Set<string>();
      while (m.phase !== 'over') {
        spectra.add(m.spectrum.id);
        const psychic = m.psychic;
        expect(psychic).toBe(`p${rounds % n}`);
        const guesses = Object.fromEntries(m.guessers.map((id, i) => [id, (t: number) => t + i * 3]));
        const r = playRound(m, guesses);
        for (const [id, p] of Object.entries(r.points)) totals[id] += p;
        rounds++;
        m.advance();
        expect(m.phase).toBe('scores');
        m.advance();
      }
      expect(rounds).toBe(roundsFor(n));
      expect(m.played).toBe(rounds);
      expect(spectra.size).toBe(rounds);
      expect(m.scores).toEqual(totals);
    }
  });

  it('a perfect read scores 4 for everyone', () => {
    const m = match(3);
    const r = playRound(m, { p1: (t) => t, p2: (t) => t + 4 });
    expect(r.points).toEqual({ p0: 4, p1: 4, p2: 4 });
  });

  it('two players: one guesser, and the Psychic scores what they score', () => {
    const m = match(2, { seed: 3 });
    expect(m.rounds).toBe(4);
    const r = playRound(m, { p1: (t) => t + 8 });
    expect(r.points).toEqual({ p0: 3, p1: 3 });
  });

  it('times out: no clue plays on with "(no clue)", no guess scores nothing', () => {
    const m = match(3);
    toClue(m);
    m.advance(); // the clue timer ran out
    expect(m.phase).toBe('guess');
    expect(m.clue).toBe(NO_CLUE);
    m.submitGuess('p1', m.key, m.target);
    m.advance(); // the guess timer ran out
    expect(m.result!.points).toEqual({ p1: 4, p0: 4 });
    expect(m.result!.guesses).toEqual({ p1: m.target });
    // Nobody guesses at all.
    m.advance();
    m.advance();
    toClue(m);
    m.advance();
    m.advance();
    expect(m.result!.points).toEqual({ p1: 0 });
    expect(m.scores).toEqual({ p0: 4, p1: 4, p2: 0 });
  });

  it('ignores stale keys, double answers and answers from the wrong player', () => {
    const m = match(3);
    toClue(m);
    const clueKey = m.key;
    expect(m.submitClue(m.psychic, clueKey - 1, 'Old')).toBe('stale');
    expect(m.submitClue('p1', clueKey, 'Not mine')).toBe('ignored');
    expect(m.submitGuess('p1', clueKey, 50)).toBe('ignored');
    expect(m.submitClue(m.psychic, clueKey, `It is ${m.target}`)).toBe('rejected');
    expect(m.clueError).not.toBeNull();
    expect(m.submitClue(m.psychic, clueKey, 'Pierogi')).toBe('ok');
    expect(m.clueError).toBeNull();
    expect(m.submitClue(m.psychic, clueKey, 'Again')).toBe('ignored');
    m.advance();
    expect(m.key).not.toBe(clueKey);
    expect(m.submitGuess('p1', clueKey, 50)).toBe('stale');
    expect(m.submitGuess('p0', m.key, 50)).toBe('ignored'); // the Psychic
    expect(m.submitGuess('zz', m.key, 50)).toBe('ignored');
    expect(m.submitGuess('p1', m.key, 'x')).toBe('rejected');
    expect(m.submitGuess('p1', m.key, 20)).toBe('ok');
    expect(m.submitGuess('p1', m.key, 80)).toBe('ignored');
    expect(m.guesses.get('p1')).toBe(20);
    // A late guess after the reveal does nothing.
    const key = m.key;
    m.advance();
    expect(m.submitGuess('p2', key, 50)).toBe('ignored');
    expect(m.result!.guesses).toEqual({ p1: 20 });
  });

  it('knows when every connected guesser is in', () => {
    const m = match(4);
    toClue(m);
    m.advance();
    expect(m.allGuessed()).toBe(false);
    m.submitGuess('p1', m.key, 10);
    m.submitGuess('p2', m.key, 10);
    expect(m.allGuessed()).toBe(false);
    expect(m.allGuessed((id) => id !== 'p3')).toBe(true);
    expect(m.allGuessed(() => false)).toBe(false);
    m.submitGuess('p3', m.key, 10);
    expect(m.allGuessed()).toBe(true);
  });

  it('drops a removed player’s later turns as Psychic', () => {
    const m = match(3); // 6 rounds: p0 p1 p2 p0 p1 p2
    expect(m.plan).toEqual(['p0', 'p1', 'p2', 'p0', 'p1', 'p2']);
    playRound(m, { p1: 50, p2: 50 });
    expect(m.remove('p2')).toEqual({ aborted: false });
    expect(m.plan).toEqual(['p0', 'p1', 'p0', 'p1']);
    expect(m.scores).not.toHaveProperty('p2');
    expect(m.result!.points.p2).toBeDefined(); // already scored this round, but not counted any more
    m.advance();
    m.advance();
    expect(m.psychic).toBe('p1');
    expect(m.remove('nobody')).toEqual({ aborted: false });
  });

  it('calls off the round when the Psychic leaves mid-round, and keeps spectra fresh', () => {
    const m = match(3, { seed: 5 });
    playRound(m, { p1: 50, p2: 50 });
    m.advance();
    m.advance();
    expect(m.psychic).toBe('p1');
    toClue(m);
    const seen = [m.spectra[0].id, m.spectrum.id];
    const before = { ...m.scores };
    expect(m.remove('p1')).toEqual({ aborted: true });
    expect(m.plan).toEqual(['p0', 'p2', 'p0', 'p2']);
    expect(m.nextRound()).toBe('intro');
    expect(m.psychic).toBe('p2');
    expect(seen).not.toContain(m.spectrum.id);
    expect(m.ri).toBe(1);
    delete before.p1;
    expect(m.scores).toEqual(before);
    // Play out the rest: every spectrum still different.
    const ids = new Set(seen);
    let played = 1;
    while (m.phase !== 'over') {
      expect(ids.has(m.spectrum.id)).toBe(false);
      ids.add(m.spectrum.id);
      playRound(m, { p0: 50, p2: 50 });
      played++;
      m.advance();
      m.advance();
    }
    expect(played).toBe(4);
  });

  it('removing a guesser drops their guess and keeps the round going', () => {
    const m = match(4);
    toClue(m);
    m.submitClue('p0', m.key, 'Hm');
    m.advance();
    m.submitGuess('p1', m.key, 50);
    m.submitGuess('p2', m.key, 50);
    expect(m.remove('p3')).toEqual({ aborted: false });
    expect(m.allGuessed()).toBe(true);
    expect(m.remove('p2')).toEqual({ aborted: false });
    m.advance();
    expect(Object.keys(m.result!.guesses)).toEqual(['p1']);
  });

  it('ends when fewer than two players are left', () => {
    const m = match(2);
    m.remove('p1');
    expect(m.nextRound()).toBe('over');
    const solo = new WaveMatch(['a'], { pool: POOL, rng: mulberry32(1) });
    expect(solo.nextRound()).toBe('over');
  });

  it('short game: one turn each, up to 4', () => {
    const m = match(6, { short: true });
    expect(m.plan).toEqual(['p0', 'p1', 'p2', 'p3']);
  });
});

describe('dial', () => {
  it('maps 0 to the left, 50 up and 100 to the right', () => {
    expect(angleOf(0)).toBeCloseTo(Math.PI);
    expect(angleOf(50)).toBeCloseTo(Math.PI / 2);
    expect(angleOf(100)).toBeCloseTo(0);
    const [x, y] = pointAt(100, 100, 50, 50);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(50);
    expect(slicePath(0, 0, 10, -20, 10)).toMatch(/^M0 0L-10\.0 /);
  });
  it('draws the Psychic’s dial as valid doodle strokes', () => {
    for (const t of [5, 50, 95]) {
      const strokes = dialStrokes(t);
      let points = 0;
      for (const s of strokes) {
        expect(s.length % 2).toBe(0);
        expect(s.length).toBeGreaterThanOrEqual(4);
        expect(s[0]).toBeLessThan(DOODLE_COLORS.length);
        expect(s[1]).toBeLessThan(DOODLE_WIDTHS.length);
        for (let i = 2; i < s.length; i++) {
          expect(s[i]).toBeGreaterThanOrEqual(0);
          expect(s[i]).toBeLessThanOrEqual(DOODLE_SPACE);
        }
        points += (s.length - 2) / 2;
      }
      expect(points).toBeLessThan(2500);
    }
  });
  it('puts close markers on different rings', () => {
    expect(markerTiers([10, 50, 90])).toEqual([0, 0, 0]);
    expect(markerTiers([50, 52, 54, 80])).toEqual([0, 1, 2, 0]);
    expect(markerTiers([50, 60, 52])).toEqual([0, 0, 1]);
    expect(markerTiers([])).toEqual([]);
  });
});
