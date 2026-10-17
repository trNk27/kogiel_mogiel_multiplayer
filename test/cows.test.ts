import { describe, expect, it } from 'vitest';
import {
  COWS_EACH,
  COW_R,
  CowsSim,
  DT,
  FINISH_BONUS,
  LASSO_RANGE,
  MISS_CD,
  PEN,
  ROPE_MAX,
  ROUND_S,
  ROUND_S_SHORT,
  THROW_TIME,
  fieldFor,
  howTo,
  pensFor,
  type CowsEvent,
  type CowsInput,
} from '../client/src/games/cows/logic';
import { mulberry32 } from '../client/src/games/rng';

/** A long round where only the cows we ask for are on the field (the rest are taken away). */
function calm(n = 2, keep: number[] = []) {
  const sim = new CowsSim(n, { rng: mulberry32(5), length: 1e6 });
  sim.cows.forEach((c, k) => {
    if (!keep.includes(k)) c.alive = false;
  });
  return sim;
}

/** The first cow of player i's colour. */
const cowOf = (sim: CowsSim, i: number, nth = 0) => sim.cows.map((c, k) => (c.owner === i ? k : -1)).filter((k) => k >= 0)[nth];

function put(o: { x: number; z: number; vx?: number; vz?: number }, x: number, z: number) {
  o.x = x;
  o.z = z;
  if ('vx' in o) o.vx = o.vz = 0;
}

/** Keep a cow from wandering off on its own during a test. */
function still(sim: CowsSim, k: number) {
  const c = sim.cows[k];
  c.walking = false;
  c.wander = 1e9;
}

function run(sim: CowsSim, seconds: number, input: (i: number, t: number) => CowsInput | undefined = () => undefined) {
  const all: CowsEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let s = 0; s < steps; s++) all.push(...sim.step(sim.players.map((_, i) => input(i, s * DT))));
  return all;
}

const press = (sim: CowsSim, i: number) => sim.step(sim.players.map((_, j) => (j === i ? { x: 0, z: 0, lasso: true } : undefined)));

describe('layout', () => {
  it('widens the meadow with more players', () => {
    expect(fieldFor(1)).toEqual({ w: 30, h: 22 });
    expect(fieldFor(4).w).toBe(30);
    expect(fieldFor(8).w).toBe(44);
  });

  it('gives every player a pen inside the meadow, none overlapping, gates facing the middle', () => {
    for (let n = 1; n <= 8; n++) {
      const { w, h } = fieldFor(n);
      const pens = pensFor(n, w, h);
      expect(pens).toHaveLength(n);
      for (const p of pens) {
        expect(Math.abs(p.x) + PEN / 2).toBeLessThanOrEqual(w / 2 + 1e-9);
        expect(Math.abs(p.z) + PEN / 2).toBeLessThanOrEqual(h / 2 + 1e-9);
        expect(Math.sign(-p.z)).toBe(p.dir);
      }
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) {
          const apart = Math.abs(pens[a].x - pens[b].x) >= PEN + 1 || Math.abs(pens[a].z - pens[b].z) >= PEN + 1;
          expect(apart).toBe(true);
        }
    }
  });

  it('mixes six cows of each colour in the middle, and starts everyone at their gate', () => {
    for (const n of [1, 3, 8]) {
      const sim = new CowsSim(n, { rng: mulberry32(n) });
      expect(sim.cows).toHaveLength(n * COWS_EACH);
      for (let i = 0; i < n; i++) expect(sim.cows.filter((c) => c.owner === i)).toHaveLength(COWS_EACH);
      for (const c of sim.cows) expect(Math.abs(c.z)).toBeLessThan(sim.h / 2 - PEN);
      sim.players.forEach((p, i) => {
        expect(p.x).toBeCloseTo(sim.pens[i].x);
        expect(p.fz).toBe(sim.pens[i].dir);
      });
    }
  });

  it('plays 90 s rounds, 75 s in the short version', () => {
    expect(new CowsSim(2).length).toBe(ROUND_S);
    expect(new CowsSim(2, { short: true }).length).toBe(ROUND_S_SHORT);
    expect(howTo(true).join(' ')).toContain('75');
  });
});

describe('the lasso', () => {
  it('catches your own cow when you face it', () => {
    const sim = new CowsSim(2, { rng: mulberry32(1), length: 1e6 });
    const k = cowOf(sim, 0);
    sim.cows.forEach((c, j) => j !== k && (c.alive = false));
    still(sim, k);
    put(sim.players[0], 0, 0);
    sim.players[0].fx = 1;
    sim.players[0].fz = 0;
    put(sim.cows[k], 3.5, 0);
    expect(sim.target(0)).toBe(k);
    const ev = [...press(sim, 0), ...run(sim, THROW_TIME + 0.05)];
    expect(ev.some((e) => e.t === 'throw')).toBe(true);
    expect(ev).toContainEqual({ t: 'catch', p: 0, cow: k });
    expect(sim.players[0].hold).toBe(k);
    expect(sim.cows[k].heldBy).toBe(0);
  });

  it('won’t take someone else’s cow, or one behind you, or one out of reach', () => {
    const sim = new CowsSim(2, { rng: mulberry32(2), length: 1e6 });
    const mine = cowOf(sim, 0);
    const theirs = cowOf(sim, 1);
    sim.cows.forEach((c, j) => j !== mine && j !== theirs && (c.alive = false));
    still(sim, mine);
    still(sim, theirs);
    put(sim.players[0], 0, 0);
    sim.players[0].fx = 1;
    sim.players[0].fz = 0;
    put(sim.cows[theirs], 3, 0);
    put(sim.cows[mine], -3, 0);
    expect(sim.target(0)).toBe(-1);
    put(sim.cows[mine], LASSO_RANGE + 0.5, 4);
    expect(sim.target(0)).toBe(-1);
    const ev = [...press(sim, 0), ...run(sim, THROW_TIME + 0.05)];
    expect(ev.some((e) => e.t === 'miss')).toBe(true);
    expect(sim.players[0].hold).toBe(-1);
    expect(sim.players[0].cd).toBeGreaterThan(MISS_CD - THROW_TIME);
  });

  it('catches a cow right next to you whichever way you face', () => {
    const sim = new CowsSim(1, { rng: mulberry32(3), length: 1e6 });
    const k = 0;
    sim.cows.forEach((c, j) => j !== k && (c.alive = false));
    put(sim.players[0], 0, 0);
    sim.players[0].fx = 1;
    sim.players[0].fz = 0;
    put(sim.cows[k], -1.6, 0);
    expect(sim.target(0)).toBe(k);
  });

  it('lets go on a second press', () => {
    const sim = new CowsSim(1, { rng: mulberry32(4), length: 1e6 });
    sim.cows.forEach((c, j) => j !== 0 && (c.alive = false));
    still(sim, 0);
    put(sim.players[0], 0, 0);
    put(sim.cows[0], 0, 3);
    sim.players[0].fx = 0;
    sim.players[0].fz = 1;
    press(sim, 0);
    run(sim, THROW_TIME + 0.05);
    expect(sim.players[0].hold).toBe(0);
    const ev = press(sim, 0);
    expect(ev).toContainEqual({ t: 'release', p: 0, cow: 0 });
    expect(sim.cows[0].heldBy).toBe(-1);
  });
});

describe('dragging', () => {
  function caught() {
    const sim = new CowsSim(2, { rng: mulberry32(6), length: 1e6 });
    const k = cowOf(sim, 0);
    sim.cows.forEach((c, j) => j !== k && (c.alive = false));
    put(sim.players[0], 0, 0);
    put(sim.cows[k], 2.5, 0);
    sim.players[0].fx = 1;
    sim.players[0].fz = 0;
    press(sim, 0);
    run(sim, THROW_TIME + 0.05);
    expect(sim.players[0].hold).toBe(k);
    return { sim, k };
  }

  it('the cow follows, and the rope never stretches past its limit', () => {
    const { sim, k } = caught();
    let worst = 0;
    run(sim, 2, (i) => {
      if (i === 0) {
        const d = Math.hypot(sim.players[0].x - sim.cows[k].x, sim.players[0].z - sim.cows[k].z);
        worst = Math.max(worst, d);
        return { x: -1, z: 0 };
      }
    });
    expect(worst).toBeLessThanOrEqual(ROPE_MAX + 0.01);
    expect(worst).toBeGreaterThan(ROPE_MAX - 0.6);
    expect(sim.cows[k].x).toBeLessThan(-4);
  });

  it('pens a cow led through its own gate, and it stays there', () => {
    const { sim, k } = caught();
    const pen = sim.pens[0];
    // Walk to the gate, then in.
    run(sim, 8, (i) => {
      if (i !== 0) return;
      const p = sim.players[0];
      const gz = pen.z + pen.dir * (PEN / 2 + 2);
      if (Math.abs(p.x - pen.x) > 0.3 && sim.players[0].hold >= 0 && Math.abs(p.z - pen.z) > PEN / 2) {
        const dx = pen.x - p.x;
        const dz = gz - p.z;
        const l = Math.hypot(dx, dz) || 1;
        return { x: dx / l, z: dz / l };
      }
      return { x: 0, z: -pen.dir };
    });
    expect(sim.cows[k].penned).toBe(true);
    expect(sim.players[0].penned).toBe(1);
    expect(sim.players[0].hold).toBe(-1);
    // It can't be lassoed again, and it doesn't wander out.
    sim.cows[k].wander = 0;
    run(sim, 30);
    expect(Math.abs(sim.cows[k].x - pen.x)).toBeLessThan(PEN / 2);
    expect(Math.abs(sim.cows[k].z - pen.z)).toBeLessThan(PEN / 2);
    expect(sim.target(0)).toBe(-1);
  });

  it('another player’s gate stays shut to your cow', () => {
    const { sim, k } = caught();
    const pen = sim.pens[1];
    const front = pen.z + pen.dir * (PEN / 2);
    put(sim.players[0], pen.x, front + pen.dir * 1);
    put(sim.cows[k], pen.x, front + pen.dir * 3);
    run(sim, 4, (i) => (i === 0 ? { x: 0, z: -pen.dir } : undefined));
    // The holder walks in; the cow stays outside the gate.
    expect((front - sim.cows[k].z) * pen.dir).toBeLessThan(0.2);
    expect(sim.cows[k].penned).toBe(false);
  });
});

describe('ropes are fences', () => {
  it('another player can’t walk through your rope', () => {
    const sim = new CowsSim(2, { rng: mulberry32(8), length: 1e6 });
    const k = cowOf(sim, 0);
    sim.cows.forEach((c, j) => j !== k && (c.alive = false));
    still(sim, k);
    put(sim.players[0], -1.5, 0);
    put(sim.cows[k], 1.5, 0);
    sim.players[0].fx = 1;
    sim.players[0].fz = 0;
    press(sim, 0);
    run(sim, THROW_TIME + 0.05);
    expect(sim.players[0].hold).toBe(k);
    // Player 1 runs straight down at the middle of the rope.
    put(sim.players[1], 0, -3);
    // Which side of the rope player 1 is on (negative: the side they started).
    const side = () => {
      const h = sim.players[0];
      const c = sim.cows[k];
      const o = sim.players[1];
      return (c.x - h.x) * (o.z - h.z) - (c.z - h.z) * (o.x - h.x);
    };
    let worst = -Infinity;
    run(sim, 1.5, (i) => {
      if (i !== 1) return;
      worst = Math.max(worst, side());
      return { x: 0, z: 1 };
    });
    // They can lean on the cow at the rope's end, but never get across.
    expect(worst).toBeLessThan(0);
    expect(sim.players[1].z).toBeLessThan(0);
    // Without the rope they'd have gone straight through.
    press(sim, 0);
    run(sim, 1.5, (i) => (i === 1 ? { x: 0, z: 1 } : undefined));
    expect(sim.players[1].z).toBeGreaterThan(2);
  });

  it('loose cows are stopped by a rope too', () => {
    const sim = new CowsSim(2, { rng: mulberry32(9), length: 1e6 });
    const k = cowOf(sim, 0);
    const other = cowOf(sim, 1);
    sim.cows.forEach((c, j) => j !== k && j !== other && (c.alive = false));
    still(sim, k);
    put(sim.players[0], -1.5, 0);
    put(sim.cows[k], 1.5, 0);
    sim.players[0].fx = 1;
    sim.players[0].fz = 0;
    press(sim, 0);
    run(sim, THROW_TIME + 0.05);
    const c = sim.cows[other];
    put(c, 0, -2);
    c.walking = true;
    c.wander = 1e9;
    c.wx = 0;
    c.wz = 1;
    run(sim, 3);
    expect(c.z).toBeLessThan(-COW_R + 0.05);
  });
});

describe('the round', () => {
  it('ends when someone pens all their cows, with a bonus', () => {
    const sim = calm(2);
    sim.players[0].penned = COWS_EACH - 1;
    const k = cowOf(sim, 0);
    const c = sim.cows[k];
    c.alive = true;
    const pen = sim.pens[0];
    const front = pen.z + pen.dir * (PEN / 2);
    put(c, pen.x, front - pen.dir * 1.5);
    put(sim.players[0], pen.x, front - pen.dir * 0.5);
    c.heldBy = 0;
    sim.players[0].hold = k;
    const ev = run(sim, 0.1);
    expect(ev).toContainEqual({ t: 'pen', p: 0, cow: k, count: COWS_EACH });
    expect(ev).toContainEqual({ t: 'done', p: 0 });
    expect(sim.done).toBe(true);
    expect(sim.scores()).toEqual([COWS_EACH + FINISH_BONUS, 0]);
    expect(sim.ranking()[0]).toBe(0);
  });

  it('ends on time otherwise, and loose cows never wander into a pen', () => {
    const sim = new CowsSim(4, { rng: mulberry32(11), length: 60 });
    run(sim, 61);
    expect(sim.done).toBe(true);
    expect(sim.winner).toBe(-1);
    for (const c of sim.cows) {
      expect(c.penned).toBe(false);
      for (const pen of sim.pens) {
        const inside = Math.abs(c.x - pen.x) < PEN / 2 - 0.2 && Math.abs(c.z - pen.z) < PEN / 2 - 0.2;
        expect(inside).toBe(false);
      }
    }
  });

  it('a player who leaves drops their rope and their cows go', () => {
    const sim = new CowsSim(2, { rng: mulberry32(12), length: 1e6 });
    const k = cowOf(sim, 1);
    sim.players[1].hold = k;
    sim.cows[k].heldBy = 1;
    sim.remove(1);
    expect(sim.players[1].alive).toBe(false);
    expect(sim.cows[k].heldBy).toBe(-1);
    expect(sim.cows.filter((c) => c.owner === 1 && c.alive)).toHaveLength(0);
    expect(sim.ranking()).toEqual([0]);
  });
});
