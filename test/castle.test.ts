import { describe, expect, it } from 'vitest';
import { SIEGE_MODES } from '../shared/protocol';
import {
  ARCHER_Y,
  COOLDOWN_S,
  CastleSim,
  DT,
  MONSTERS,
  MONSTER_SCALE,
  RANGE_MAX,
  SKILL_COOLDOWN_S,
  VOLLEY_ARROWS,
  VOLLEY_GAP_S,
  VOLLEY_SHOTS,
  WALL_HP,
  WALL_Y,
  WAVES,
  archerX,
  crowd,
  depthScale,
  dragonHp,
  groupCount,
  rangeFor,
  segmentHit,
  starsFor,
  type CEvent,
} from '../client/src/games/castle/logic';

function run(sim: CastleSim, seconds: number, each?: () => void) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    sim.step();
    each?.();
  }
}

/** A sim that is already fighting wave 1, with the field cleared so tests can place monsters. */
function fighting(players = 1, mode = 2) {
  const sim = new CastleSim(players, 1, mode);
  run(sim, 7.1);
  expect(sim.phase).toBe('play');
  sim.monsters = [];
  // Stop the wave's own monsters from turning up mid-test.
  (sim as unknown as { queue: unknown[] }).queue = [{ at: 1e9, kind: 'imp', x: 0 }];
  return sim;
}

/** Angle (degrees from straight up) from archer i to a point. */
function angleTo(sim: CastleSim, i: number, x: number, y: number) {
  const a = sim.archers[i];
  return (Math.atan2(x - a.x, a.y - 26 - y) * 180) / Math.PI;
}

/** A bot that shoots at the monster nearest the wall, leading it a little, at full draw. */
function bot(sim: CastleSim) {
  sim.archers.forEach((a, i) => {
    if (sim.t < a.readyAt) return;
    const targets = sim.monsters.filter((m) => m.y > 0 && Math.hypot(m.x - a.x, m.y - a.y) < RANGE_MAX - 40);
    if (!targets.length) return;
    // Spread the archers over the targets: each takes the one nearest to them, front ones first.
    const m = targets.sort((p, q) => Math.abs(p.x - a.x) - q.y / 3 - (Math.abs(q.x - a.x) - p.y / 3))[0];
    const flight = Math.hypot(m.x - a.x, m.y - a.y) / 1900;
    sim.fire(i, angleTo(sim, i, m.x, m.y + (m.atWall ? 0 : m.speed * flight)), 1);
  });
}

describe('castle geometry', () => {
  it('finds where a segment first touches a circle', () => {
    expect(segmentHit(0, 0, 100, 0, 50, 0, 10)).toBeCloseTo(0.4);
    expect(segmentHit(0, 0, 100, 0, 50, 20, 10)).toBeNull();
    expect(segmentHit(0, 0, 100, 0, 150, 0, 10)).toBeNull();
    expect(segmentHit(48, 0, 100, 0, 50, 0, 10)).toBe(0);
  });

  it('spreads the archers along the wall and draws far things smaller', () => {
    expect(archerX(0, 1)).toBe(960);
    const xs = Array.from({ length: 8 }, (_, i) => archerX(i, 8));
    for (let i = 1; i < 8; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(150);
    expect(depthScale(0)).toBeLessThan(depthScale(WALL_Y));
    expect(rangeFor(1)).toBe(RANGE_MAX);
    expect(rangeFor(0.2)).toBeLessThan(rangeFor(0.8));
  });
});

describe('castle shooting', () => {
  it('kills a monster in the arrow’s path and gives the archer its points', () => {
    const sim = fighting();
    const m = sim.spawn({ kind: 'imp', x: 960, y: 600 });
    m.speed = 0;
    expect(sim.fire(0, 0, 0.8)).toBe(true);
    run(sim, 0.5);
    expect(sim.monsters).toHaveLength(0);
    expect(sim.archers[0].points).toBe(MONSTERS.imp.pts);
    expect(sim.archers[0].kills).toBe(1);
    expect(sim.kills).toBe(1);
  });

  it('needs a proper draw, and a moment to nock the next arrow', () => {
    const sim = fighting();
    expect(sim.fire(0, 0, 0.05)).toBe(false);
    expect(sim.fire(0, 0, 0.5)).toBe(true);
    expect(sim.fire(0, 0, 0.5)).toBe(false);
    run(sim, COOLDOWN_S + 0.02);
    expect(sim.fire(0, 0, 0.5)).toBe(true);
    expect(sim.archers[0].shots).toBe(2);
  });

  it('only reaches far monsters with a long draw', () => {
    const sim = fighting();
    const m = sim.spawn({ kind: 'imp', x: 960, y: 200 });
    m.speed = 0;
    sim.fire(0, 0, 0.2);
    run(sim, 1.5);
    expect(sim.monsters).toHaveLength(1);
    sim.fire(0, 0, 1);
    run(sim, 1);
    expect(sim.monsters).toHaveLength(0);
  });

  it('aims left and right', () => {
    const sim = fighting();
    const left = sim.spawn({ kind: 'imp', x: 500, y: 500 });
    const right = sim.spawn({ kind: 'imp', x: 1400, y: 500 });
    left.speed = right.speed = 0;
    sim.fire(0, angleTo(sim, 0, 1400, 500), 1);
    run(sim, 0.6);
    expect(sim.monsters).toEqual([left]);
    sim.fire(0, angleTo(sim, 0, 500, 500), 1);
    run(sim, 0.6);
    expect(sim.monsters).toHaveLength(0);
  });

  it('stops a normal arrow at the first monster, but a charged one goes through and hits twice as hard', () => {
    const sim = fighting();
    const line = [700, 550, 400].map((y) => {
      const m = sim.spawn({ kind: 'giant', x: 960, y });
      m.speed = 0;
      return m;
    });
    sim.fire(0, 0, 1);
    run(sim, 0.6);
    expect(line.map((m) => m.hp)).toEqual([7, 8, 8]);
    run(sim, COOLDOWN_S);
    sim.fire(0, 0, 1, true);
    run(sim, 0.6);
    expect(line.map((m) => m.hp)).toEqual([5, 6, 6]);
  });

  it('lets arrows pass through a Zmora while she has faded', () => {
    const sim = fighting();
    const g = sim.spawn({ kind: 'ghost', x: 960, y: 500 });
    g.speed = 0;
    g.ph = 0;
    g.age = 2.6; // faded until 3.6
    sim.fire(0, 0, 1);
    run(sim, 0.5);
    expect(g.hp).toBe(g.maxHp);
    g.age = 0.5;
    run(sim, COOLDOWN_S);
    sim.fire(0, 0, 1);
    run(sim, 0.5);
    expect(g.hp).toBe(g.maxHp - 1);
  });

  it('lets you shoot down the dragon’s fireballs', () => {
    const sim = fighting();
    const fb = sim.spawn({ kind: 'fireball', x: 960, y: 300 });
    fb.tx = 960;
    fb.ty = WALL_Y + 24;
    sim.fire(0, 0, 1);
    run(sim, 0.5);
    expect(sim.monsters).toHaveLength(0);
    expect(sim.wall).toBe(WALL_HP);
  });
});

describe('castle volley', () => {
  it('is ready only after its cooldown, then loads five shots of three arrows', () => {
    const sim = new CastleSim(1, 1, 2);
    expect(sim.skill(0)).toBe(false);
    run(sim, SKILL_COOLDOWN_S + 0.05);
    expect(sim.skill(0)).toBe(true);
    expect(sim.archers[0].volley).toBe(VOLLEY_SHOTS);
    expect(sim.drain().filter((e) => e.e === 'skill')).toEqual([{ e: 'skill', by: 0, on: true }]);
    // Pressing it again while it's on does nothing.
    expect(sim.skill(0)).toBe(false);
  });

  it('looses three arrows in a row along the same line for each of the next five shots', () => {
    const sim = fighting();
    sim.archers[0].skillAt = 0;
    expect(sim.skill(0)).toBe(true);
    const line = [700, 550, 400].map((y) => {
      const m = sim.spawn({ kind: 'giant', x: 960, y });
      m.speed = 0;
      return m;
    });
    expect(sim.fire(0, 0, 1)).toBe(true);
    expect(sim.arrows).toHaveLength(1);
    run(sim, VOLLEY_GAP_S * (VOLLEY_ARROWS - 1) + 0.02);
    expect(sim.archers[0].shots).toBe(VOLLEY_ARROWS);
    run(sim, 0.6);
    // All three stop at the first giant in the line.
    expect(line.map((m) => m.hp)).toEqual([8 - VOLLEY_ARROWS, 8, 8]);
    expect(sim.archers[0].volley).toBe(VOLLEY_SHOTS - 1);
    for (let k = 1; k < VOLLEY_SHOTS; k++) {
      run(sim, COOLDOWN_S);
      expect(sim.fire(0, 0, 1)).toBe(true);
    }
    expect(sim.archers[0].volley).toBe(0);
    const events = sim.drain();
    expect(events.filter((e) => e.e === 'skill')).toEqual([
      { e: 'skill', by: 0, on: true },
      { e: 'skill', by: 0, on: false },
    ]);
    // The cooldown starts again once the last volley shot is loosed; single arrows from now on.
    expect(sim.archers[0].skillAt).toBeCloseTo(sim.t + SKILL_COOLDOWN_S);
    expect(sim.skill(0)).toBe(false);
    run(sim, 1);
    const before = sim.archers[0].shots;
    sim.fire(0, 0, 1);
    run(sim, 0.3);
    expect(sim.archers[0].shots).toBe(before + 1);
  });

  it('keeps the charge on every arrow of a volley shot', () => {
    const sim = fighting();
    sim.archers[0].skillAt = 0;
    sim.skill(0);
    sim.fire(0, 0, 1, true);
    run(sim, VOLLEY_GAP_S * VOLLEY_ARROWS);
    expect(sim.arrows.every((a) => a.charged && a.dmg === 2)).toBe(true);
    expect(sim.arrows).toHaveLength(VOLLEY_ARROWS);
  });

  it('can’t be used by an archer who left, and drops their waiting arrows', () => {
    const sim = fighting(2);
    for (const a of sim.archers) a.skillAt = 0;
    sim.skill(0);
    sim.fire(0, 0, 1);
    sim.remove(0);
    run(sim, 0.5);
    expect(sim.archers[0].shots).toBe(1);
    expect(sim.skill(0)).toBe(false);
    expect(sim.skill(1)).toBe(true);
  });
});

describe('castle siege', () => {
  it('lets monsters that reach the wall wear it down, and the castle falls at zero', () => {
    const sim = fighting();
    for (let i = 0; i < 6; i++) sim.spawn({ kind: 'giant', x: 300 + i * 250, y: WALL_Y - 40 });
    run(sim, 2);
    expect(sim.monsters.every((m) => m.atWall)).toBe(true);
    expect(sim.wall).toBeLessThan(WALL_HP);
    const events: CEvent[] = [];
    run(sim, 30, () => events.push(...sim.drain()));
    expect(sim.phase).toBe('lost');
    expect(sim.wall).toBe(0);
    expect(sim.stars).toBe(0);
    expect(events.some((e) => e.e === 'lost')).toBe(true);
    // Nothing more happens once it's over.
    expect(sim.fire(0, 0, 1)).toBe(false);
  });

  it('plays all five waves, with Smok in the last, and gives stars for the wall left', () => {
    const sim = new CastleSim(4, 3, 2);
    const waves: number[] = [];
    let dragon = false;
    run(sim, 600, () => {
      bot(sim);
      if (sim.dragon) dragon = true;
      for (const e of sim.drain()) if (e.e === 'go') waves.push(e.wave);
      if (sim.over) return;
    });
    expect(waves).toEqual([1, 2, 3, 4, 5]);
    expect(dragon).toBe(true);
    expect(sim.phase).toBe('won');
    expect(sim.stars).toBeGreaterThanOrEqual(2);
    expect(sim.kills).toBeGreaterThan(50);
    expect(sim.score).toBe(sim.archers.reduce((a, r) => a + r.points, 0));
  });

  it('is too much for a crowd that never shoots', () => {
    const sim = new CastleSim(4, 3, 2);
    run(sim, 300);
    expect(sim.phase).toBe('lost');
  });

  it('mends the wall between waves (not in Nightmare)', () => {
    for (const mode of [2, 4]) {
      const sim = fighting(1, mode);
      sim.wall = 50;
      (sim as unknown as { queue: unknown[] }).queue = [];
      run(sim, 0.1);
      expect(sim.phase).toBe('break');
      expect(sim.wall).toBe(50 + SIEGE_MODES[mode - 1].repair);
    }
  });

  it('sends more and tougher monsters for bigger crews and harder modes', () => {
    for (let n = 1; n < 8; n++) expect(crowd(n + 1) / (n + 1)).toBeGreaterThan(crowd(n) / n);
    expect(groupCount('imp', 10, 8, 2)).toBeGreaterThan(groupCount('imp', 10, 2, 2));
    for (let m = 1; m < SIEGE_MODES.length; m++) {
      expect(groupCount('imp', 10, 4, m + 1)).toBeGreaterThan(groupCount('imp', 10, 4, m));
      expect(dragonHp(4, m + 1)).toBeGreaterThanOrEqual(dragonHp(4, m));
    }
    expect(groupCount('dragon', 1, 8, 4)).toBe(1);
    expect(dragonHp(8, 2)).toBeGreaterThan(dragonHp(1, 2));
    const easy = new CastleSim(1, 1, 1).spawn({ kind: 'knight', x: 0 });
    const hard = new CastleSim(1, 1, 4).spawn({ kind: 'knight', x: 0 });
    expect(hard.maxHp).toBeGreaterThan(easy.maxHp);
  });

  it('only counts stars for a castle still standing', () => {
    expect(starsFor(false, 1)).toBe(0);
    expect(starsFor(true, 0.1)).toBe(1);
    expect(starsFor(true, 0.5)).toBe(2);
    expect(starsFor(true, 0.9)).toBe(3);
  });

  it('makes the monsters 20 % bigger than they were', () => {
    expect(MONSTER_SCALE).toBe(1.2);
    expect(MONSTERS.imp.r).toBeCloseTo(36);
    expect(MONSTERS.giant.r).toBeCloseTo(69.6);
    expect(MONSTERS.fireball.r).toBe(26);
  });

  it('describes every wave with monsters that exist', () => {
    expect(WAVES).toHaveLength(5);
    for (const w of WAVES) for (const [k] of w.groups) expect(MONSTERS[k]).toBeDefined();
    expect(WAVES[4].groups.some(([k]) => k === 'dragon')).toBe(true);
  });

  it('keeps archers on the walkway and out of reach', () => {
    const sim = new CastleSim(8, 1, 2);
    for (const a of sim.archers) expect(a.y).toBe(ARCHER_Y);
    expect(ARCHER_Y).toBeGreaterThan(WALL_Y);
  });
});

describe('castle modes', () => {
  it('falls back to Normal for a mode it doesn’t know', () => {
    expect(new CastleSim(1, 1, Number.NaN).mode).toBe(2);
    expect(new CastleSim(1, 1, 9).mode).toBe(2);
    expect(new CastleSim(1, 1, 4).mode).toBe(4);
  });
});
