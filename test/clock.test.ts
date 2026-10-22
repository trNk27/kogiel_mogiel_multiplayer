import { describe, expect, it } from 'vitest';
import {
  ALL_TARGETS,
  BONUS,
  CLOCK_ROUNDS,
  CLOCK_ROUNDS_SHORT,
  ClockRound,
  PERFECT_PTS,
  TIMEOUT_S,
  basePoints,
  closenessRanks,
  errLabel,
  flagLanes,
  howTo,
  mulberry32,
  rulerRange,
  secs,
  targetsFor,
} from '../client/src/games/clock/logic';

const GO = 1_000_000;
/** A round with target `t` s that has started, and presses at these seconds after GO (null = none). */
function played(t: number, at: (number | null)[]) {
  const r = new ClockRound(at.length, t);
  r.begin(GO);
  at.forEach((s, i) => s !== null && r.press(i, GO + s * 1000));
  return r;
}

describe('points', () => {
  it('pays 10 for spot on (within 0.10 s either way)', () => {
    for (const e of [0, 40, -40, 100, -100]) expect(basePoints(e)).toBe(PERFECT_PTS);
  });
  it('then max(0, round(8 − 10·|e|))', () => {
    expect(basePoints(101)).toBe(7); // 8 − 1.01 = 6.99
    expect(basePoints(230)).toBe(6); // 8 − 2.3 = 5.7
    expect(basePoints(-500)).toBe(3);
    expect(basePoints(550)).toBe(3); // 2.5 rounds up
    expect(basePoints(800)).toBe(0);
    expect(basePoints(-5000)).toBe(0);
  });
  it('never goes up as you get further off', () => {
    let last = Infinity;
    for (let e = 0; e < 3000; e += 7) {
      const p = basePoints(e);
      expect(p).toBeLessThanOrEqual(last);
      expect(basePoints(-e)).toBe(p);
      last = p;
    }
  });
});

describe('ranks and the closeness bonus', () => {
  it('ranks by closeness, ties share a rank', () => {
    expect(closenessRanks([300, 100, null, 100, 50])).toEqual([4, 2, null, 2, 1]);
  });
  it('gives +3/+2/+1 to the three closest', () => {
    const r = played(7, [7.3, 6.9, 7.5, 8.2]).results();
    expect(r.players.map((p) => p.rank)).toEqual([2, 1, 3, 4]);
    expect(r.players.map((p) => p.bonus)).toEqual([2, 3, 1, 0]);
    expect(r.players.map((p) => p.pts)).toEqual([5 + 2, PERFECT_PTS + 3, 3 + 1, 0]);
    expect(r.winners).toEqual([1]);
  });
  it('shares the bonus on a tie and skips the next place', () => {
    const r = played(5, [5.2, 4.8, 5.4, 6]).results();
    expect(r.players.map((p) => p.rank)).toEqual([1, 1, 3, 4]);
    expect(r.players.map((p) => p.bonus)).toEqual([3, 3, 1, 0]);
    expect(r.winners).toEqual([0, 1]);
    expect(r.players[0].err).toBe(200);
    expect(r.players[1].err).toBe(-200);
  });
  it('marks spot-on presses', () => {
    const r = played(10, [10.08, 9.5]).results();
    expect(r.players[0].perfect).toBe(true);
    expect(r.players[0].pts).toBe(PERFECT_PTS + BONUS[0]);
    expect(r.players[1].perfect).toBe(false);
  });
  it('gives no bonus on your own', () => {
    const r = played(7, [7.05]).results();
    expect(r.solo).toBe(true);
    expect(r.players[0].pts).toBe(PERFECT_PTS);
    expect(r.winners).toEqual([0]);
  });
});

describe('presses', () => {
  it('counts only the first press', () => {
    const r = new ClockRound(2, 7);
    r.begin(GO);
    expect(r.press(0, GO + 7000)).toBe('ok');
    expect(r.press(0, GO + 9000)).toBe('again');
    expect(r.presses[0]).toBe(7000);
  });
  it('ignores presses before GO, which don’t lock you in', () => {
    const r = new ClockRound(2, 7);
    expect(r.press(0, GO - 10)).toBe('early');
    r.begin(GO);
    expect(r.press(0, GO - 1)).toBe('early');
    expect(r.pressed(0)).toBe(false);
    expect(r.press(0, GO + 6500)).toBe('ok');
    expect(r.presses[0]).toBe(6500);
  });
  it('times out whoever hasn’t pressed by target + 6 s', () => {
    const r = new ClockRound(3, 5);
    r.begin(GO);
    r.press(0, GO + 5100);
    expect(r.deadline).toBe(GO + (5 + TIMEOUT_S) * 1000);
    expect(r.done(r.deadline - 1)).toBe(false);
    expect(r.done(r.deadline)).toBe(true);
    expect(r.press(1, r.deadline + 1)).toBe('late');
    expect(r.press(2, r.deadline)).toBe('ok');
    const res = r.results();
    expect(res.players[1]).toMatchObject({ ms: null, pts: 0, timedOut: true, rank: null, bonus: 0 });
    expect(res.players[2].pts).toBe(0 + BONUS[1]);
  });
  it('scores 0 for everybody when nobody presses', () => {
    const res = played(7, [null, null]).results();
    expect(res.players.every((p) => p.pts === 0 && p.timedOut)).toBe(true);
    expect(res.winners).toEqual([]);
  });
  it('is done once everybody pressed, or the rest are offline', () => {
    const r = new ClockRound(3, 10);
    r.begin(GO);
    r.press(0, GO + 9000);
    expect(r.allIn()).toBe(false);
    expect(r.allIn([true, false, false])).toBe(true);
    r.press(1, GO + 9500);
    r.press(2, GO + 9800);
    expect(r.done(GO + 9800)).toBe(true);
  });
  it('doesn’t end when everybody drops out before anyone pressed', () => {
    const r = new ClockRound(2, 10);
    r.begin(GO);
    expect(r.allIn([false, false])).toBe(false);
  });
});

describe('removal', () => {
  it('drops a removed player’s press and they score nothing', () => {
    const r = played(7, [7.0, 7.4, 7.8]);
    r.remove(0);
    expect(r.press(0, GO + 7100)).toBe('gone');
    const res = r.results();
    expect(res.players[0]).toMatchObject({ gone: true, pts: 0, timedOut: false });
    expect(res.players[1].rank).toBe(1);
    expect(res.winners).toEqual([1]);
  });
  it('doesn’t wait for removed players', () => {
    const r = new ClockRound(2, 7);
    r.begin(GO);
    r.press(0, GO + 7000);
    expect(r.allIn()).toBe(false);
    r.remove(1);
    expect(r.allIn()).toBe(true);
    expect(r.solo).toBe(true);
  });
  it('starts later rounds without players who left', () => {
    const r = new ClockRound(3, 5, [false, true, false]);
    expect(r.live()).toEqual([0, 2]);
  });
});

describe('targets', () => {
  it('get longer every round and come from the list', () => {
    for (let seed = 1; seed < 200; seed++) {
      for (const n of [CLOCK_ROUNDS, CLOCK_ROUNDS_SHORT, 1]) {
        const ts = targetsFor(n, mulberry32(seed));
        expect(ts).toHaveLength(n);
        ts.forEach((t, k) => {
          expect(ALL_TARGETS).toContain(t);
          if (k) expect(t).toBeGreaterThan(ts[k - 1]);
        });
      }
    }
  });
  it('start short and end long', () => {
    const ts = targetsFor(CLOCK_ROUNDS, mulberry32(9));
    expect(ts[0]).toBeLessThanOrEqual(7);
    expect(ts[ts.length - 1]).toBeGreaterThanOrEqual(15);
    const short = targetsFor(CLOCK_ROUNDS_SHORT, mulberry32(9));
    expect(short[0]).toBeLessThanOrEqual(7);
    expect(short[2]).toBeGreaterThanOrEqual(15);
  });
  it('are the same for the same seed, and vary between seeds', () => {
    expect(targetsFor(5, mulberry32(42))).toEqual(targetsFor(5, mulberry32(42)));
    const seen = new Set<string>();
    for (let s = 0; s < 50; s++) seen.add(targetsFor(5, mulberry32(s)).join(','));
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('the reveal ruler', () => {
  it('covers the target and every press, in whole seconds, at least 6 s wide', () => {
    expect(rulerRange(7, [7000])).toEqual({ lo: 4, hi: 10 });
    const { lo, hi } = rulerRange(12, [9300, null, 14800]);
    expect(lo).toBeLessThanOrEqual(9.3 - 1);
    expect(hi).toBeGreaterThanOrEqual(14.8 + 1);
    expect(rulerRange(5, [200]).lo).toBe(0);
  });
  it('stacks labels that would overlap', () => {
    expect(flagLanes([0, 10, 50, 5], 20)).toEqual([0, 2, 0, 1]);
    expect(flagLanes([0, 30, 60], 20)).toEqual([0, 0, 0]);
  });
  it('labels errors', () => {
    expect(errLabel(230)).toBe('0.23 s late');
    expect(errLabel(-400)).toBe('0.40 s early');
    expect(errLabel(2)).toBe('spot on');
    expect(secs(7234)).toBe('7.23');
  });
});

describe('how to play', () => {
  it('has three short lines', () => {
    for (const s of [false, true]) {
      expect(howTo(s)).toHaveLength(3);
      howTo(s).forEach((l) => expect(l.length).toBeLessThan(50));
    }
  });
});
