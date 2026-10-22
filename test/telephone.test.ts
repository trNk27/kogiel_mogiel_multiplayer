import { describe, expect, it } from 'vitest';
import sentences from '../data/telephone.json';
import { DOODLE_SPACE, type Stroke } from '../shared/protocol';
import { mulberry32 } from '../client/src/games/rng';
import {
  LEFT_GAME,
  NO_IDEA,
  TEL_DESCRIBE_MS,
  TEL_DRAW_MS,
  TEL_MAX_POINTS,
  TEL_MAX_TEXT,
  TEL_VOTE_POINTS,
  TEL_WRITE_MS,
  Telephone,
  chainFor,
  cleanStrokes,
  howTo,
  pickSentences,
  revealMs,
  sanitizeText,
  seatFor,
  seating,
  stepCount,
  stepKind,
  stepMs,
  type TelSentence,
} from '../client/src/games/telephone/logic';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const line = (n: number): Stroke => [0, 1, ...Array.from({ length: n * 2 }, (_, i) => (i * 37) % DOODLE_SPACE)];

/** Everyone hands in something for the current step. */
function playStep(t: Telephone) {
  for (const id of t.pending()) {
    const ok = t.kind === 'draw' ? t.submit(id, { strokes: [line(3)] }) : t.submit(id, { text: `${id} at step ${t.step}` });
    expect(ok).toBe(true);
  }
  t.endStep();
}

describe('content', () => {
  const pool = sentences as TelSentence[];
  it('has at least 150 short, unique starting sentences with unique ids', () => {
    expect(pool.length).toBeGreaterThanOrEqual(150);
    expect(new Set(pool.map((s) => s.id)).size).toBe(pool.length);
    expect(new Set(pool.map((s) => s.text.toLowerCase())).size).toBe(pool.length);
    for (const s of pool) {
      expect(s.text.length, s.text).toBeLessThanOrEqual(TEL_MAX_TEXT);
      expect(sanitizeText(s.text)).toBe(s.text);
      expect(s.text).toMatch(/^[A-Z]/);
    }
  });
  it('picks fresh sentences until the pool runs out', () => {
    const used = new Set<string>();
    const a = pickSentences(pool, used, 20, mulberry32(1));
    const b = pickSentences(pool, used, 20, mulberry32(2));
    expect(new Set([...a, ...b]).size).toBe(40);
    expect(pickSentences(pool.slice(0, 3), new Set(), 10)).toHaveLength(3);
  });
});

describe('howTo', () => {
  it('has exactly three lines in both versions', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);
  });
});

describe('rotation', () => {
  it('caps the steps at 6 (4 in the short version)', () => {
    expect([3, 4, 5, 6, 7, 8].map((n) => stepCount(n))).toEqual([3, 4, 5, 6, 6, 6]);
    expect([3, 4, 5, 6, 7, 8].map((n) => stepCount(n, true))).toEqual([3, 4, 4, 4, 4, 4]);
  });

  for (const short of [false, true]) {
    for (let n = 3; n <= 8; n++) {
      it(`${n} players${short ? ' (short)' : ''}: nobody twice in a chain, everybody busy every step`, () => {
        const steps = stepCount(n, short);
        for (let c = 0; c < n; c++) {
          const seats = Array.from({ length: steps }, (_, s) => seatFor(c, s, n));
          expect(new Set(seats).size).toBe(steps);
          expect(seats[0]).toBe(c);
        }
        for (let s = 0; s < steps; s++) {
          const seats = Array.from({ length: n }, (_, c) => seatFor(c, s, n));
          expect(new Set(seats).size).toBe(n);
          for (let p = 0; p < n; p++) expect(seatFor(chainFor(p, s, n), s, n)).toBe(p);
        }
        // and the same through a played game
        const t = new Telephone(ids(n), short);
        expect(t.steps).toBe(steps);
        for (let s = 0; s < steps; s++) {
          expect(t.pending()).toHaveLength(n);
          expect(new Set(ids(n).map((id) => t.chainOf(id))).size).toBe(n);
          playStep(t);
        }
        expect(t.done).toBe(true);
        for (const chain of t.chains) {
          expect(chain).toHaveLength(steps);
          expect(new Set(chain.map((e) => e.by)).size).toBe(steps);
        }
        if (n <= (short ? 4 : 6)) {
          // everyone touched every chain once
          for (const id of ids(n)) expect(t.chains.every((ch) => ch.some((e) => e.by === id))).toBe(true);
        }
      });
    }
  }

  it('seats players in a shuffled order', () => {
    const seats = seating(ids(8), mulberry32(4));
    expect([...seats].sort()).toEqual(ids(8));
  });
});

describe('steps', () => {
  it('starts with a sentence, then alternates drawing and describing', () => {
    expect([0, 1, 2, 3, 4, 5].map(stepKind)).toEqual(['write', 'draw', 'describe', 'draw', 'describe', 'draw']);
    expect([0, 1, 2].map(stepMs)).toEqual([TEL_WRITE_MS, TEL_DRAW_MS, TEL_DESCRIBE_MS]);
  });

  it('hands each player the previous entry of their chain', () => {
    const t = new Telephone(ids(4));
    t.submit('p0', { text: 'A goose stealing pierogi' });
    t.submit('p1', { text: 'Dziadek surfing' });
    t.submit('p2', { text: 'A cat conductor' });
    t.submit('p3', { text: 'A stork' });
    t.endStep();
    expect(t.kind).toBe('draw');
    expect(t.task('p1')).toEqual({ chain: 0, step: 1, kind: 'draw', prompt: 'A goose stealing pierogi' });
    expect(t.task('p0')?.prompt).toBe('A stork');
    const pic = [line(5)];
    t.submit('p1', { strokes: pic });
    for (const id of t.pending()) t.submit(id, { strokes: [] });
    t.endStep();
    expect(t.task('p2')).toEqual({ chain: 0, step: 2, kind: 'describe', pic });
  });

  it('only takes the right kind of answer, once', () => {
    const t = new Telephone(ids(3));
    expect(t.submit('p0', { strokes: [line(2)] })).toBe(false);
    expect(t.submit('p0', { text: '   ' })).toBe(false);
    expect(t.submit('p0', { text: 'Hello' })).toBe(true);
    expect(t.submit('p0', { text: 'Again' })).toBe(false);
    expect(t.submit('nobody', { text: 'Hi' })).toBe(false);
    t.endStep(() => 'A cat');
    expect(t.submit('p1', { text: 'not a drawing' })).toBe(false);
    expect(t.submit('p1', { strokes: 'junk' })).toBe(false);
    expect(t.submit('p1', { strokes: [] })).toBe(true);
    expect(t.chains[t.chainOf('p1')][1]).toEqual({ by: 'p1', kind: 'draw', strokes: [] });
  });

  it('"Pick for me" uses the dice sentence (first step only)', () => {
    const t = new Telephone(ids(3));
    expect(t.submit('p0', { auto: 'A cat conducting an orchestra' })).toBe(true);
    expect(t.current('p0')).toMatchObject({ text: 'A cat conducting an orchestra', auto: true });
    t.endStep(() => 'A dog');
    expect(t.submit('p0', { auto: 'Nope' })).toBe(false);
  });
});

describe('timeouts', () => {
  it('picks a sentence for anyone who wrote nothing, then passes on empty drawings and "(no idea)"', () => {
    const t = new Telephone(ids(4));
    t.submit('p0', { text: 'A goose' });
    t.endStep(() => 'A potato wearing a crown');
    expect(t.chains[1][0]).toEqual({ by: 'p1', kind: 'write', text: 'A potato wearing a crown', auto: true });
    // draw: p1 draws chain 0, nobody else draws
    t.submit('p1', { strokes: [line(4)] });
    t.endStep();
    expect(t.chains[1][1]).toEqual({ by: 'p2', kind: 'draw', strokes: [], empty: 'timeout' });
    // describe: chain 1's describer gets a blank page
    expect(t.task('p3')).toMatchObject({ chain: 1, kind: 'describe', pic: [] });
    t.endStep();
    expect(t.chains[1][2]).toEqual({ by: 'p3', kind: 'describe', text: NO_IDEA, empty: 'timeout' });
    // draw: the next drawer of chain 1 is told to draw anything
    expect(t.task('p0')).toMatchObject({ chain: 1, kind: 'draw', prompt: '' });
  });

  it('without a sentence to pick, the first step times out as "(no idea)"', () => {
    const t = new Telephone(ids(3));
    t.endStep();
    expect(t.chains[0][0]).toMatchObject({ text: NO_IDEA, empty: 'timeout' });
    expect(t.task('p1')?.prompt).toBe('');
  });
});

describe('removal', () => {
  it('fills a removed player’s steps with placeholders, so the chains keep their shape', () => {
    const t = new Telephone(ids(4));
    t.submit('p2', { text: 'Babcia on a motorbike' });
    t.remove('p2');
    expect(t.current('p2')?.text).toBe('Babcia on a motorbike');
    t.remove('p3');
    expect(t.current('p3')).toEqual({ by: 'p3', kind: 'write', text: LEFT_GAME, empty: 'left' });
    expect(t.pending()).toEqual(['p0', 'p1']);
    expect(t.task('p3')).toBeNull();
    t.submit('p0', { text: 'A' });
    t.submit('p1', { text: 'B' });
    t.endStep();
    expect(t.current('p2')).toEqual({ by: 'p2', kind: 'draw', strokes: [], empty: 'left' });
    expect(t.current('p3')).toMatchObject({ empty: 'left' });
    expect(t.pending()).toEqual(['p0', 'p1']);
    while (!t.done) playStep(t);
    for (const ch of t.chains) expect(ch).toHaveLength(4);
    expect(t.chains.flat().filter((e) => e.empty === 'left')).toHaveLength(7);
    expect(Object.keys(t.scores()).sort()).toEqual(['p0', 'p1']);
  });

  it('ignores removing a stranger, and a game with nobody left just times out', () => {
    const t = new Telephone(ids(3));
    t.remove('x');
    expect(t.left.size).toBe(0);
    for (const id of ids(3)) t.remove(id);
    expect(t.pending()).toEqual([]);
    while (!t.done) t.endStep();
    expect(t.chains.flat().every((e) => e.empty === 'left')).toBe(true);
    expect(t.scores()).toEqual({});
  });
});

describe('votes', () => {
  function played(n: number) {
    const t = new Telephone(ids(n));
    while (!t.done) playStep(t);
    return t;
  }

  it('can’t vote for your own entry or a placeholder', () => {
    const t = new Telephone(ids(3));
    t.submit('p0', { text: 'A' });
    t.endStep(() => '');
    while (!t.done) playStep(t);
    // chain 1 starts with p1's "(no idea)"
    expect(t.canPick(1, 'p0')).toEqual([false, true, false]);
    expect(t.canPick(1, 'p1')[0]).toBe(false);
    expect(t.vote(1, 'p0', 0)).toBe(false);
    expect(t.vote(1, 'p0', 2)).toBe(false);
    expect(t.vote(1, 'p0', 1.5)).toBe(false);
    expect(t.vote(1, 'p0', 9)).toBe(false);
    expect(t.vote(1, 'p0', 1)).toBe(true);
    expect(t.vote(1, 'p0', 1)).toBe(false);
  });

  it('scores +100 per vote for the author', () => {
    const t = played(4);
    const chain = t.chains[0];
    // p1 drew entry 1 of chain 0
    expect(chain[1].by).toBe('p1');
    expect(t.vote(0, 'p0', 1)).toBe(true);
    expect(t.vote(0, 'p2', 1)).toBe(true);
    expect(t.vote(0, 'p3', 0)).toBe(true);
    expect(t.vote(0, 'p1', 1)).toBe(false);
    expect(t.vote(0, 'p1', 3)).toBe(true);
    expect(t.pendingVoters(0)).toEqual([]);
    const r = t.tally(0);
    expect(r.counts).toEqual([1, 2, 0, 1]);
    expect(r.points).toEqual({ p0: TEL_VOTE_POINTS, p1: 2 * TEL_VOTE_POINTS, p3: TEL_VOTE_POINTS });
    expect(r.voters[1]).toEqual(['p0', 'p2']);
    expect(t.vote(1, 'p0', 0)).toBe(true); // chain 1 starts with p1
    expect(t.scores()).toEqual({ p0: 100, p1: 300, p2: 0, p3: 100 });
    expect(t.scores(0)).toEqual({ p0: 100, p1: 200, p2: 0, p3: 100 });
    expect(t.scores(-1)).toEqual({ p0: 0, p1: 0, p2: 0, p3: 0 });
  });

  it('players with nothing to pick (7–8 players, shorter chains) can still vote for anyone', () => {
    const t = played(8);
    expect(t.chains[0]).toHaveLength(6);
    const outsider = ids(8).find((id) => !t.chains[0].some((e) => e.by === id))!;
    expect(t.canPick(0, outsider).every(Boolean)).toBe(true);
    expect(t.pendingVoters(0)).toHaveLength(8);
  });

  it('votes for a removed player’s entry earn nothing, and removed players stop voting', () => {
    const t = played(3);
    t.vote(0, 'p0', 1);
    t.remove('p1');
    expect(t.canVote(1, 'p1')).toBe(false);
    expect(t.vote(1, 'p1', 2)).toBe(false);
    expect(t.tally(0).counts[1]).toBe(1);
    expect(t.scores()).toEqual({ p0: 0, p2: 0 });
  });

  it('nobody can vote when only your own entries and placeholders are left', () => {
    const t = new Telephone(ids(3));
    t.remove('p1');
    t.remove('p2');
    while (!t.done) playStep(t);
    expect(t.canVote(0, 'p0')).toBe(false);
    expect(t.pendingVoters(0)).toEqual([]);
  });
});

describe('text and drawings', () => {
  it('cleans typed text', () => {
    expect(sanitizeText('  a   <b>goose</b>\n ')).toBe('a bgoose/b');
    expect(sanitizeText('x'.repeat(100))).toHaveLength(TEL_MAX_TEXT);
    expect(sanitizeText(null)).toBe('');
  });

  it('checks drawings and keeps them small', () => {
    expect(cleanStrokes([])).toEqual([]);
    expect(cleanStrokes('nope')).toBeNull();
    expect(cleanStrokes([[0, 1, 5]])).toBeNull();
    expect(cleanStrokes([[99, 1, 5, 5]])).toBeNull();
    expect(cleanStrokes([[0, 1, 5, Number.NaN]])).toBeNull();
    expect(cleanStrokes([[0, 1, -20, 1200.6, 3.4, 4.6]])).toEqual([[0, 1, 0, 1000, 3, 5]]);
    // a huge drawing is cut down to the point budget instead of being lost
    const huge = Array.from({ length: 40 }, () => line(200));
    const cut = cleanStrokes(huge)!;
    const points = cut.reduce((n, s) => n + (s.length - 2) / 2, 0);
    expect(points).toBe(TEL_MAX_POINTS);
  });

  it('a describe view with the biggest drawing stays well under 96 KB', () => {
    const worst = cleanStrokes(Array.from({ length: 600 }, (_, i) => [7, 2, ...Array.from({ length: 20 }, (_, k) => 990 + ((i + k) % 10))]))!;
    const t = new Telephone(ids(3));
    t.endStep(() => 'A cat');
    t.submit('p1', { strokes: worst });
    t.endStep();
    const task = t.task('p2')!;
    const view = {
      v: 'ask',
      game: 'telephone',
      key: 99,
      note: 'Step 3 / 3',
      title: 'What is this?',
      text: 'Describe the drawing in a few words.',
      endsAt: Date.now(),
      pic: task.pic,
      input: { k: 'text', max: TEL_MAX_TEXT, sent: null, button: 'Pass it on' },
    };
    expect(JSON.stringify(view).length).toBeLessThan(48_000);
  });

  it('times the show: drawings longer than sentences, placeholders quick', () => {
    expect(revealMs({ by: 'a', kind: 'draw', strokes: [line(3)] })).toBeGreaterThan(revealMs({ by: 'a', kind: 'describe', text: 'x' }));
    expect(revealMs({ by: 'a', kind: 'describe', text: LEFT_GAME, empty: 'left' })).toBeLessThan(3000);
    for (const e of [{ by: 'a', kind: 'write' as const, text: 'x' }, { by: 'a', kind: 'draw' as const, strokes: [line(2)] }]) {
      expect(revealMs(e)).toBeGreaterThanOrEqual(2500);
      expect(revealMs(e)).toBeLessThanOrEqual(7000);
    }
    expect(revealMs(undefined)).toBe(0);
  });
});
