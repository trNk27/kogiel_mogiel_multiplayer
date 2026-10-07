import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../client/src/games/rng';
import { PEDAL_GOAL, PEDAL_MAX_RATE, acceptStrokes, heatPlaces, heatPoints, isStroke } from '../client/src/games/pedal/logic';
import {
  FORK_LIMIT_MS,
  STAB_EARLY,
  STAB_FOOLED,
  forkRoundLength,
  makeForkRound,
  scoreFork,
  stabAt,
  validStab,
} from '../client/src/games/fork/logic';
import { PARADE_COLORS, PARADE_LANES, makeParade, paradePoints, validCount } from '../client/src/games/parade/logic';

describe('Tour de Pierogi', () => {
  it('only counts alternating pedals', () => {
    expect(isStroke(null, 'l')).toBe(true);
    expect(isStroke(null, 'r')).toBe(true);
    expect(isStroke('l', 'r')).toBe(true);
    expect(isStroke('l', 'l')).toBe(false);
  });

  it('caps strokes at the believable rate, the goal, and never goes backwards', () => {
    expect(acceptStrokes(0, 10, 1000)).toBe(10);
    expect(acceptStrokes(0, 500, 1000)).toBe(PEDAL_MAX_RATE + 2);
    expect(acceptStrokes(0, 500, 60_000)).toBe(PEDAL_GOAL);
    expect(acceptStrokes(40, 30, 5000)).toBe(40);
    expect(acceptStrokes(5, Number.NaN, 5000)).toBe(5);
    expect(acceptStrokes(0, 3, -500)).toBe(2);
  });

  it('ranks finishers by time, then the rest by distance', () => {
    const places = heatPlaces([
      { dist: 100, time: 9000 },
      { dist: 60, time: null },
      { dist: 100, time: 8000 },
      { dist: 80, time: null },
      { dist: 60, time: null },
    ]);
    expect(places).toEqual([2, 4, 1, 3, 4]);
  });

  it('pays 10, 8, 6… per heat', () => {
    expect([1, 2, 3, 8, 9].map(heatPoints)).toEqual([10, 8, 6, 1, 0]);
  });
});

describe('Fork Fight', () => {
  it('ends every round with the pierogi, after any fakes, without overlaps', () => {
    for (let seed = 1; seed < 300; seed++) {
      const steps = makeForkRound(seed % 10, mulberry32(seed));
      expect(steps.at(-1)!.k).toBe('pierogi');
      expect(steps.filter((s) => s.k === 'pierogi')).toHaveLength(1);
      expect(steps[0].at).toBeGreaterThanOrEqual(1200);
      for (let i = 1; i < steps.length; i++) expect(steps[i].at).toBeGreaterThan(steps[i - 1].at + steps[i - 1].dur);
      expect(forkRoundLength(steps)).toBe(steps.at(-1)!.at + FORK_LIMIT_MS);
    }
  });

  it('later rounds have more fakes', () => {
    const fakes = (round: number) => {
      let n = 0;
      for (let seed = 1; seed <= 400; seed++) n += makeForkRound(round, mulberry32(seed)).length - 1;
      return n;
    };
    expect(fakes(7)).toBeGreaterThan(fakes(0));
  });

  it('knows what is on the plate at any moment', () => {
    const steps = [
      { k: 'sock' as const, at: 1000, dur: 900 },
      { k: 'pierogi' as const, at: 2500, dur: 1500 },
    ];
    expect(stabAt(steps, 500).k).toBeNull();
    expect(stabAt(steps, 1200).k).toBe('sock');
    expect(stabAt(steps, 2000).k).toBeNull();
    expect(stabAt(steps, 2700)).toEqual({ k: 'pierogi', since: 200 });
    expect(stabAt(steps, 4000).k).toBeNull();
  });

  it('accepts reaction times and foul codes only', () => {
    expect(validStab(250)).toBe(true);
    expect(validStab(STAB_EARLY)).toBe(true);
    expect(validStab(STAB_FOOLED)).toBe(true);
    expect(validStab(-3)).toBe(false);
    expect(validStab(FORK_LIMIT_MS + 1)).toBe(false);
    expect(validStab(12.5)).toBe(false);
    expect(validStab('300')).toBe(false);
  });

  it('scores 3 / 2 / 1 for the fastest stabs and -1 for fouls', () => {
    const { points, places } = scoreFork({ a: 320, b: 250, c: STAB_FOOLED, d: 250, e: 600, f: 700, g: STAB_EARLY });
    expect(points).toEqual({ a: 1, b: 3, c: -1, d: 3, e: 0, f: 0, g: -1 });
    expect(places).toEqual({ a: 3, b: 1, d: 1, e: 4, f: 5 });
  });
});

describe('Pierogi Parade', () => {
  it('marches exactly `answer` pierogi of the target colour', () => {
    for (let seed = 1; seed < 200; seed++) {
      const p = makeParade(seed % 3, mulberry32(seed));
      expect(p.marchers.filter((m) => m.c === p.target)).toHaveLength(p.answer);
      expect(p.marchers.some((m) => m.c !== p.target)).toBe(true);
      expect(p.target).toBeLessThan(PARADE_COLORS.length);
      expect(p.length).toBe(Math.max(...p.marchers.map((m) => m.at + m.dur)));
      for (const m of p.marchers) {
        expect(m.lane).toBeGreaterThanOrEqual(0);
        expect(m.lane).toBeLessThan(PARADE_LANES);
      }
    }
  });

  it('later rounds are busier', () => {
    const size = (round: number) => {
      let n = 0;
      for (let seed = 1; seed <= 50; seed++) n += makeParade(round, mulberry32(seed)).marchers.length;
      return n;
    };
    expect(size(2)).toBeGreaterThan(size(1));
    expect(size(1)).toBeGreaterThan(size(0));
  });

  it('keeps pierogi in one lane from walking into each other', () => {
    for (let seed = 1; seed < 100; seed++) {
      const p = makeParade(2, mulberry32(seed));
      // Sample positions over time: two pierogi in a lane are never closer than a few percent of the walk.
      for (let t = 0; t < p.length; t += 100) {
        const on = p.marchers.filter((m) => t >= m.at && t <= m.at + m.dur).map((m) => ({ lane: m.lane, dir: m.dir, x: ((t - m.at) / m.dur) * m.dir }));
        for (let i = 0; i < on.length; i++)
          for (let j = i + 1; j < on.length; j++) if (on[i].lane === on[j].lane) expect(Math.abs(on[i].x - on[j].x)).toBeGreaterThan(0.05);
      }
    }
  });

  it('gets busier in the background each round', () => {
    const busy = (round: number) => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const sc = makeParade(round, mulberry32(seed)).scene;
        n += sc.props.length + sc.trams.length * 3 + sc.balloons.length + sc.kites.length + sc.birds.length + sc.fireworks.length;
      }
      return n;
    };
    expect(busy(1)).toBeGreaterThan(busy(0));
    expect(busy(2)).toBeGreaterThan(busy(1));
    for (let seed = 1; seed <= 40; seed++) expect(makeParade(2, mulberry32(seed)).scene.trams.length).toBeGreaterThan(0);
  });

  it('only hides pierogi for a moment', () => {
    for (let seed = 1; seed < 100; seed++) {
      const { scene, marchers } = makeParade(seed % 3, mulberry32(seed));
      // Props stand away from the edges, so everybody is seen walking on and off.
      for (const p of scene.props) {
        expect(p.x).toBeGreaterThan(0.15);
        expect(p.x).toBeLessThan(0.85);
      }
      // Trams are much faster than any pierogi, so they can't hide one for its whole walk.
      const slowest = Math.min(...marchers.map((m) => m.dur));
      for (const t of scene.trams) expect(t.dur).toBeLessThan(slowest);
    }
  });

  it('sends some pierogi marching in tight groups in later rounds', () => {
    let grouped = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ms = makeParade(2, mulberry32(seed)).marchers;
      grouped += ms.filter((m) => ms.some((o) => o !== m && o.lane === m.lane && Math.abs(o.at - m.at) <= m.dur * 0.15)).length;
    }
    expect(grouped).toBeGreaterThan(50);
  });

  it('scores 10 / 6 / 3 / 1 by how far off the count is', () => {
    expect(paradePoints(12, 12)).toBe(10);
    expect(paradePoints(11, 12)).toBe(6);
    expect(paradePoints(14, 12)).toBe(3);
    expect(paradePoints(9, 12)).toBe(1);
    expect(paradePoints(20, 12)).toBe(0);
  });

  it('accepts sensible counts only', () => {
    expect(validCount(0)).toBe(true);
    expect(validCount(17)).toBe(true);
    expect(validCount(-1)).toBe(false);
    expect(validCount(2.5)).toBe(false);
    expect(validCount(1000)).toBe(false);
  });
});
