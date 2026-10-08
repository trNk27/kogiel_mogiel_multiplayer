import { describe, expect, it } from 'vitest';
import {
  AMMO,
  FIRE_GAP,
  GALLERY_ROUNDS,
  GALLERY_ROUNDS_SHORT,
  GallerySim,
  HIT_PAD,
  MAX_SPEED,
  OPENINGS,
  PLAY,
  POINTS,
  RELOAD_S,
  ROUND_SECONDS,
  ROUND_SECONDS_SHORT,
  SPOTS,
  corks,
  eventLife,
  howTo,
  makeSchedule,
  newShooter,
  newTally,
  pickTarget,
  resolveShots,
  roundsFor,
  scoreHit,
  secondsFor,
  stepShooter,
  targetBounds,
  tryFire,
  tryReload,
  type Cand,
  type Target,
} from '../client/src/games/gallery/logic';

const run = (s: ReturnType<typeof newShooter>, sx: number, sy: number, secs: number, t0 = 0) => {
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) stepShooter(s, sx, sy, 1 / 60, t0 + i / 60);
};

describe('crosshair motion', () => {
  it('full deflection crosses the stage in about 2.2 s, with a light acceleration', () => {
    const s = newShooter(0, 1);
    s.x = PLAY.x0;
    s.y = 500;
    run(s, 1, 0, 0.1);
    expect(s.vx).toBeGreaterThan(0);
    expect(s.vx).toBeLessThan(MAX_SPEED * 0.8);
    run(s, 1, 0, 2.4, 0.1);
    expect(s.x).toBe(PLAY.x1);
    // Without the clamp it would take ~2.2 s: cross 1808 px at full speed.
    const t = newShooter(0, 1);
    t.x = PLAY.x0;
    let secs = 0;
    while (t.x < PLAY.x1 && secs < 5) {
      stepShooter(t, 1, 0, 1 / 60, secs);
      secs += 1 / 60;
    }
    expect(secs).toBeGreaterThan(2.0);
    expect(secs).toBeLessThan(2.5);
  });

  it('gentle deflections are much slower (precision)', () => {
    const s = newShooter(0, 1);
    s.x = 500;
    run(s, 0.33, 0, 1);
    expect(s.x - 500).toBeLessThan(450);
    expect(s.x - 500).toBeGreaterThan(100);
  });

  it('stays inside the play area and loses speed at the walls', () => {
    const s = newShooter(0, 1);
    run(s, -1, -1, 3);
    expect(s.x).toBe(PLAY.x0);
    expect(s.y).toBe(PLAY.y0);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    run(s, 1, 1, 4);
    expect(s.x).toBe(PLAY.x1);
    expect(s.y).toBe(PLAY.y1);
  });

  it('coasts to a stop when the stick is let go', () => {
    const s = newShooter(0, 1);
    run(s, 1, 0, 0.3);
    const x = s.x;
    run(s, 0, 0, 1);
    expect(s.x).toBeGreaterThan(x);
    expect(Math.abs(s.vx)).toBeLessThan(1);
  });

  it('spreads the starting crosshairs across the stage', () => {
    const xs = [0, 1, 2, 3].map((i) => newShooter(i, 4).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(4);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(PLAY.x0);
  });
});

describe('corks and reloading', () => {
  it('six corks, then dry', () => {
    const s = newShooter(0, 1);
    let t = 0;
    for (let i = 0; i < AMMO; i++) {
      expect(tryFire(s, t)).toBe('shot');
      t += FIRE_GAP + 0.01;
    }
    expect(s.ammo).toBe(0);
    expect(tryFire(s, t)).toBe('dry');
    expect(s.ammo).toBe(0);
  });

  it('limits the rate of fire', () => {
    const s = newShooter(0, 1);
    expect(tryFire(s, 1)).toBe('shot');
    expect(tryFire(s, 1.05)).toBe('wait');
    expect(s.ammo).toBe(AMMO - 1);
    expect(tryFire(s, 1 + FIRE_GAP + 0.001)).toBe('shot');
  });

  it('reloads in RELOAD_S, cannot fire meanwhile, and never auto-reloads', () => {
    const s = newShooter(0, 1);
    s.ammo = 0;
    expect(tryReload(s, 5)).toBe(true);
    expect(tryReload(s, 5.1)).toBe(false);
    expect(tryFire(s, 5.2)).toBe('reloading');
    expect(stepShooter(s, 0, 0, 1 / 60, 5 + RELOAD_S - 0.05)).toBe(false);
    expect(s.ammo).toBe(0);
    expect(stepShooter(s, 0, 0, 1 / 60, 5 + RELOAD_S + 0.001)).toBe(true);
    expect(s.ammo).toBe(AMMO);
    expect(tryFire(s, 7)).toBe('shot');
  });

  it('can reload early, and not when full', () => {
    const s = newShooter(0, 1);
    expect(tryReload(s, 0)).toBe(false);
    tryFire(s, 1);
    tryFire(s, 2);
    expect(s.ammo).toBe(AMMO - 2);
    expect(tryReload(s, 3)).toBe(true);
    stepShooter(s, 0, 0, 1 / 60, 3 + RELOAD_S);
    expect(s.ammo).toBe(AMMO);
  });

  it('draws the corks', () => {
    expect(corks(6)).toBe('●●●●●●');
    expect(corks(4)).toBe('●●●●○○');
    expect(corks(0)).toBe('○○○○○○');
  });
});

describe('hit test', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  const ghost = (id: number, r: ReturnType<typeof rect>, depth = 0): Cand => ({ id, kind: 'ghost', rect: r, depth });

  it('hits inside a projected rectangle, with a little tolerance', () => {
    const c = [ghost(1, rect(100, 100, 200, 220))];
    expect(pickTarget(150, 160, c)?.id).toBe(1);
    expect(pickTarget(200 + HIT_PAD - 1, 100, c)?.id).toBe(1);
    expect(pickTarget(200 + HIT_PAD + 2, 160, c)).toBeNull();
    expect(pickTarget(150, 99 - HIT_PAD - 1, c)).toBeNull();
  });

  it('prefers the nearest target when they overlap', () => {
    const far = ghost(1, rect(100, 100, 300, 300), -2);
    const near: Cand = { id: 2, kind: 'babcia', rect: rect(150, 150, 250, 350), depth: 1.5 };
    expect(pickTarget(200, 200, [far, near])?.id).toBe(2);
    expect(pickTarget(120, 120, [far, near])?.id).toBe(1);
    expect(pickTarget(200, 200, [near, far])?.id).toBe(2);
  });

  it('breaks ties at equal depth by distance to the centre', () => {
    const a = ghost(1, rect(100, 100, 200, 200));
    const b = ghost(2, rect(150, 100, 250, 200));
    expect(pickTarget(190, 150, [a, b])?.id).toBe(2);
    expect(pickTarget(110, 150, [b, a])?.id).toBe(1);
  });

  it('misses on empty space', () => {
    expect(pickTarget(10, 10, [])).toBeNull();
  });
});

describe('scoring', () => {
  const c1: Cand = { id: 7, kind: 'ghost', rect: { x0: 100, y0: 100, x1: 200, y1: 200 }, depth: 0 };
  const babcia: Cand = { id: 8, kind: 'babcia', rect: { x0: 400, y0: 100, x1: 500, y1: 300 }, depth: 0 };
  const gold: Cand = { id: 9, kind: 'gold', rect: { x0: 700, y0: 100, x1: 800, y1: 200 }, depth: 0 };

  it('has the point values of the rules', () => {
    expect(POINTS).toEqual({ ghost: 1, bat: 2, gold: 5, babcia: -3 });
  });

  it('two players hitting the same target in the same frame both score', () => {
    const { hits, misses } = resolveShots(
      [
        { player: 0, x: 150, y: 150 },
        { player: 1, x: 120, y: 190 },
        { player: 2, x: 900, y: 900 },
      ],
      [c1, babcia, gold],
    );
    expect(hits.map((h) => [h.player, h.id, h.points])).toEqual([
      [0, 7, 1],
      [1, 7, 1],
    ]);
    expect(misses).toEqual([2]);
  });

  it('applies a babcia penalty and tallies per kind', () => {
    const t = newTally();
    scoreHit(t, 'ghost');
    scoreHit(t, 'gold');
    scoreHit(t, 'babcia');
    scoreHit(t, 'bat');
    expect(t.points).toBe(1 + 5 - 3 + 2);
    expect(t.hits).toBe(3);
    expect(t.kinds.babcia).toBe(1);
    const { hits } = resolveShots([{ player: 0, x: 450, y: 200 }], [c1, babcia, gold]);
    expect(hits[0].points).toBe(-3);
  });

  it('a target hit by two players is one target in the sim', () => {
    const sim = new GallerySim(5, 1, false, 2);
    for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60);
    const before = sim.targets.length;
    const first = sim.hittable()[0];
    expect(first).toBeTruthy();
    sim.applyHits([
      { player: 0, id: first.target.id, kind: first.target.kind, points: 1 },
      { player: 1, id: first.target.id, kind: first.target.kind, points: 1 },
    ]);
    expect(first.target.state).toBe('hit');
    expect(first.target.by).toEqual([0, 1]);
    expect(sim.targets.length).toBe(before);
    expect(sim.hittable().find((h) => h.target.id === first.target.id)).toBeUndefined();
    for (let i = 0; i < 90; i++) sim.step(1 / 60);
    expect(sim.targets.find((x) => x.id === first.target.id)).toBeUndefined();
  });
});

describe('target bounds', () => {
  const base = { x: 0, y: 0, hw: 0.6, hh: 0.8, mode: 'glide' as const, state: 'alive' as const };
  it('uses the full box for gliders', () => {
    const b = targetBounds({ ...base, ev: { slot: 0 } as never });
    expect(b).toEqual({ x0: -0.6, x1: 0.6, y0: -0.8, y1: 0.8 });
  });
  it('pop-ups only count above the cut-out they hide behind', () => {
    const top = SPOTS[1].top;
    const t = { ...base, mode: 'popup' as const, ev: { slot: 1 } as never, x: SPOTS[1].x };
    expect(targetBounds({ ...t, y: top - 0.9 })).toBeNull();
    const b = targetBounds({ ...t, y: top })!;
    expect(b.y0).toBe(top);
    expect(b.y1).toBeCloseTo(top + 0.8);
  });
  it('window targets are clipped to the opening', () => {
    const o = OPENINGS[0];
    const t = { ...base, mode: 'window' as const, ev: { slot: 0 } as never, x: o.x + 0.2, y: o.y };
    const b = targetBounds(t)!;
    expect(b.x0).toBeGreaterThanOrEqual(o.x - o.w / 2);
    expect(b.x1).toBeLessThanOrEqual(o.x + o.w / 2);
    expect(b.y1).toBeLessThanOrEqual(o.y + o.h / 2);
  });
  it('hit targets cannot be hit again', () => {
    expect(targetBounds({ ...base, state: 'hit' as never, ev: { slot: 0 } as never })).toBeNull();
  });
});

describe('schedule', () => {
  it('is deterministic from the seed', () => {
    expect(makeSchedule(1234, 2, false, 3)).toEqual(makeSchedule(1234, 2, false, 3));
    expect(makeSchedule(1234, 2, false, 3)).not.toEqual(makeSchedule(1235, 2, false, 3));
    expect(makeSchedule(1234, 1, false)).not.toEqual(makeSchedule(1234, 2, false));
  });

  it('is sorted, inside the round and has its own pattern per round', () => {
    for (let round = 1; round <= 3; round++) {
      const ev = makeSchedule(42, round, false, 4);
      expect(ev.length).toBeGreaterThan(15);
      for (let i = 1; i < ev.length; i++) expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t);
      for (const e of ev) {
        expect(e.t).toBeGreaterThanOrEqual(0);
        expect(e.t + eventLife(e)).toBeLessThan(ROUND_SECONDS + 8);
      }
    }
    const r1 = makeSchedule(42, 1, false, 4);
    const r2 = makeSchedule(42, 2, false, 4);
    const r3 = makeSchedule(42, 3, false, 4);
    expect(r1.every((e) => e.mode === 'glide' || e.kind === 'gold')).toBe(true);
    expect(r1.some((e) => e.kind === 'bat')).toBe(false);
    expect(r2.some((e) => e.mode === 'window')).toBe(true);
    expect(r2.some((e) => e.mode === 'popup')).toBe(true);
    expect(r2.some((e) => e.kind === 'bat')).toBe(true);
    const babcias = (l: typeof r1) => l.filter((e) => e.kind === 'babcia').length / l.length;
    expect(babcias(r3)).toBeGreaterThan(babcias(r1));
    expect(r3.filter((e) => e.kind === 'gold').length).toBeGreaterThan(r1.filter((e) => e.kind === 'gold').length);
    const modes = new Set(r3.map((e) => e.mode));
    expect(modes.size).toBe(4);
  });

  it('never double-books a pop-up spot or an opening', () => {
    for (const round of [1, 2, 3]) {
      const ev = makeSchedule(99, round, false, 8);
      for (const mode of ['popup', 'window'] as const) {
        const by = new Map<number, typeof ev>();
        for (const e of ev.filter((x) => x.mode === mode)) by.set(e.slot, [...(by.get(e.slot) ?? []), e]);
        for (const list of by.values())
          for (let i = 1; i < list.length; i++) expect(list[i].t).toBeGreaterThanOrEqual(list[i - 1].t + eventLife(list[i - 1]));
      }
    }
  });

  it('gets busier with more players', () => {
    expect(makeSchedule(7, 2, false, 8).length).toBeGreaterThan(makeSchedule(7, 2, false, 1).length);
  });

  it('mixes everything in the short version', () => {
    const ev = makeSchedule(3, 1, true, 4);
    expect(new Set(ev.map((e) => e.mode)).size).toBe(4);
    expect(ev.some((e) => e.kind === 'babcia')).toBe(true);
    expect(Math.max(...ev.map((e) => e.t))).toBeGreaterThan(ROUND_SECONDS);
  });
});

describe('rounds', () => {
  it('counts rounds and seconds for full and short games', () => {
    expect(roundsFor(false)).toBe(GALLERY_ROUNDS);
    expect(roundsFor(true)).toBe(GALLERY_ROUNDS_SHORT);
    expect(GALLERY_ROUNDS).toBe(3);
    expect(GALLERY_ROUNDS_SHORT).toBe(1);
    expect(secondsFor(false)).toBe(ROUND_SECONDS);
    expect(secondsFor(true)).toBe(ROUND_SECONDS_SHORT);
  });

  it('a sim ends after the round length and spawns the schedule', () => {
    const sim = new GallerySim(11, 1, false, 2);
    let seen = new Set<number>();
    let frames = 0;
    while (!sim.done && frames < 60 * 60) {
      sim.step(1 / 60);
      for (const t of sim.targets) seen.add(t.id);
      frames++;
    }
    expect(frames / 60).toBeCloseTo(ROUND_SECONDS, 0);
    expect(seen.size).toBe(sim.events.length);
    const left: Target[] = sim.targets;
    expect(left.length).toBeLessThan(12);
  });

  it('has three short sentences of instructions', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);
    expect(howTo(true)[2]).not.toBe(howTo(false)[2]);
  });
});
