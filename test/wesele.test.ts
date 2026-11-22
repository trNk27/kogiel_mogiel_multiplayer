import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_IDS,
  MAX_DRUNK,
  PAIR_LATE_MS,
  PAIR_TASKS,
  PER_SONG,
  SPILL,
  TRAIN_MISS_MS,
  TWIRL_MAX,
  WESELE_SONGS,
  WESELE_SONGS_SHORT,
  clockFor,
  dizzy,
  drink,
  grade,
  gradeGorzko,
  gradeMoves,
  gradePour,
  gradeTrain,
  gradeTwirl,
  howTo,
  makeMoves,
  makePairs,
  movesNeeded,
  movesRight,
  mulberry32,
  pairOk,
  pairWindowMs,
  planNight,
  pointsFor,
  pourLine,
  pourRate,
  spilled,
  trainBeatMs,
  trainError,
  twirlsNeeded,
  wujekRelease,
  zurekSong,
} from '../client/src/games/wesele/logic';
import { TRACKS, parsePart, trackForGame } from '../client/src/lib/tracks';

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
  it('serves żurek halfway through', () => {
    expect(zurekSong(WESELE_SONGS)).toBe(3);
    expect(zurekSong(WESELE_SONGS_SHORT)).toBe(2);
    expect(zurekSong(1)).toBe(0);
  });
  it('plans three different challenges a song, never one twice in a row, and uses them all', () => {
    for (let seed = 1; seed < 40; seed++) {
      for (const songs of [WESELE_SONGS, WESELE_SONGS_SHORT]) {
        const plan = planNight(songs, mulberry32(seed));
        expect(plan).toHaveLength(songs);
        for (const s of plan) {
          expect(s).toHaveLength(PER_SONG);
          expect(new Set(s).size).toBe(PER_SONG);
        }
        const flat = plan.flat();
        for (let i = 1; i < flat.length; i++) expect(flat[i]).not.toBe(flat[i - 1]);
        if (songs * PER_SONG >= CHALLENGE_IDS.length) expect(new Set(flat).size).toBe(CHALLENGE_IDS.length);
      }
    }
  });
});

describe('grading', () => {
  it('the best wins, the rest are safe, failures drink', () => {
    const v = grade({ a: 10, b: 5, c: 3, d: null }, { higherBetter: true, worstDrinks: false, fail: (x) => x < 4 });
    expect(v).toEqual({ a: 'win', b: 'safe', c: 'drink', d: 'drink' });
  });
  it('the worst drinks too, unless everyone ties', () => {
    expect(grade({ a: 3, b: 2, c: 1 }, { higherBetter: true, worstDrinks: true })).toEqual({ a: 'win', b: 'safe', c: 'drink' });
    expect(grade({ a: 2, b: 2 }, { higherBetter: true, worstDrinks: true })).toEqual({ a: 'win', b: 'win' });
    expect(grade({ a: 5 }, { higherBetter: true, worstDrinks: true })).toEqual({ a: 'win' });
  });
  it('lower can be better', () => {
    expect(grade({ a: 30, b: 10, c: 50 }, { higherBetter: false, worstDrinks: true })).toEqual({ a: 'safe', b: 'win', c: 'drink' });
  });
  it('points: win 300, safe 100, drink nothing', () => {
    expect(pointsFor('win')).toBeGreaterThan(pointsFor('safe'));
    expect(pointsFor('drink')).toBe(0);
  });
});

describe('twirl dance', () => {
  it('needs more twirls later in the night', () => {
    expect(twirlsNeeded(WESELE_SONGS, WESELE_SONGS)).toBeGreaterThan(twirlsNeeded(1, WESELE_SONGS));
    expect(twirlsNeeded(1, WESELE_SONGS)).toBeLessThan(TWIRL_MAX);
  });
  it('too few twirls drinks; most twirls wins', () => {
    expect(gradeTwirl({ a: 9, b: 6, c: 4 }, 6)).toEqual({ a: 'win', b: 'safe', c: 'drink' });
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
    expect(PAIR_TASKS.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Gorzko!', () => {
  it('the fastest wins and the slowest drinks', () => {
    expect(gradeGorzko({ a: 30, b: 20, c: 10 })).toEqual({ a: 'win', b: 'safe', c: 'drink' });
  });
  it('nobody drinks when everyone ties; not tapping at all drinks', () => {
    expect(gradeGorzko({ a: 10, b: 10 })).toEqual({ a: 'win', b: 'win' });
    expect(gradeGorzko({ a: 10, b: 0 }).b).toBe('drink');
  });
});

describe('pouring', () => {
  it('draws the line somewhere you can hit', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const l = pourLine(rng);
      expect(l).toBeGreaterThan(0.5);
      expect(l + SPILL).toBeLessThan(1);
    }
  });
  it('spilling drinks, the closest wins, the furthest drinks', () => {
    const line = 0.7;
    expect(spilled(line + SPILL + 0.01, line)).toBe(true);
    expect(spilled(line + SPILL / 2, line)).toBe(false);
    expect(gradePour({ a: 0.69, b: 0.6, c: 0.4, d: 0.9, e: null }, line)).toEqual({ a: 'win', b: 'safe', c: 'drink', d: 'drink', e: 'drink' });
  });
  it('the bottle surges more the drunker you are', () => {
    const spread = (drunk: number) => {
      const r = Array.from({ length: 100 }, (_, i) => pourRate(i / 20, drunk));
      return Math.max(...r) - Math.min(...r);
    };
    expect(spread(0)).toBe(0);
    expect(spread(5)).toBeGreaterThan(spread(2));
    for (let i = 0; i < 100; i++) expect(pourRate(i / 10, 5)).toBeGreaterThan(0);
  });
});

describe('duck dance', () => {
  it('gets longer later in the night', () => {
    expect(movesNeeded(WESELE_SONGS, WESELE_SONGS)).toBeGreaterThan(movesNeeded(1, WESELE_SONGS));
  });
  it('never repeats a move three times running', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 100; i++) {
      const m = makeMoves(6, rng);
      expect(m).toHaveLength(6);
      for (let k = 2; k < m.length; k++) expect(m[k] === m[k - 1] && m[k] === m[k - 2]).toBe(false);
    }
  });
  it('checks the moves, and the fastest right one wins', () => {
    expect(movesRight([0, 1, 2], [0, 1, 2])).toBe(true);
    expect(movesRight([0, 1, 2], [0, 2, 1])).toBe(false);
    expect(movesRight([0, 1, 2], [0, 1])).toBe(false);
    expect(movesRight([0, 1, 2], null)).toBe(false);
    expect(gradeMoves({ a: 3000, b: 4000, c: null })).toEqual({ a: 'win', b: 'safe', c: 'drink' });
  });
});

describe('the conga train', () => {
  const beats = [1000, 1600, 2200, 2800];
  it('scores taps right on the beat as perfect', () => {
    expect(trainError(beats, beats)).toEqual({ err: 0, hits: 4 });
  });
  it('counts missed beats and extra taps against you', () => {
    expect(trainError([], beats)).toEqual({ err: TRAIN_MISS_MS, hits: 0 });
    const sloppy = trainError([1050, 1650, 2250, 2850], beats);
    expect(sloppy.err).toBe(50);
    const mashed = trainError([...beats, 1300, 1900, 2500], beats);
    expect(mashed.err).toBeGreaterThan(0);
    expect(mashed.hits).toBe(4);
  });
  it('the best rhythm wins, the worst drinks, missing the train drinks', () => {
    expect(gradeTrain({ a: 30, b: 60, c: 120, d: TRAIN_MISS_MS })).toEqual({ a: 'win', b: 'safe', c: 'drink', d: 'drink' });
  });
  it('speeds up later in the night', () => {
    expect(trainBeatMs(WESELE_SONGS, WESELE_SONGS)).toBeLessThan(trainBeatMs(1, WESELE_SONGS));
  });
});

describe('music', () => {
  it('plays disco polo at the wedding', () => {
    expect(trackForGame('wesele')).toBe('disco');
    const t = TRACKS.disco;
    const barSteps = t.beatsPerBar * t.steps;
    for (const p of t.parts) {
      const { length } = parsePart(p.seq, p.inst === 'drums');
      expect(length).toBe(t.bars * barSteps * ((p.steps ?? t.steps) / t.steps));
    }
  });
});

describe('howTo', () => {
  it('says how to win in three lines', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(false)[0]).toContain('5 songs');
    expect(howTo(true)[0]).toContain('2 songs');
  });
});
