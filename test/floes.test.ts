import { describe, expect, it } from 'vitest';
import {
  AIR_TIME,
  CRACK_S,
  DT,
  FloesSim,
  HEX,
  HEX_W,
  LAYERS,
  LAYER_Y,
  MAX_SPEED,
  ROUND_S,
  WATER_Y,
  hexCenter,
  hexDist,
  hexField,
  hexRound,
  howTo,
  ringsFor,
  type FloesEvent,
} from '../client/src/games/floes/logic';
import { mulberry32 } from '../client/src/games/rng';

/** Step the sim for `seconds`; `each(sim)` runs before every step (to steer or press). */
function run(sim: FloesSim, seconds: number, each: (sim: FloesSim) => void = () => {}) {
  const all: FloesEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    each(sim);
    all.push(...sim.step());
  }
  return all;
}

/** Step until `done(sim)` (or give up). */
function until(sim: FloesSim, done: (sim: FloesSim) => boolean, max = 30, each: (sim: FloesSim) => void = () => {}) {
  const all: FloesEvent[] = [];
  for (let k = 0; k < Math.round(max / DT) && !done(sim); k++) {
    each(sim);
    all.push(...sim.step());
  }
  return all;
}

/** Put player i at the middle of hex (q, r) on layer l, standing still. */
function place(sim: FloesSim, i: number, q: number, r: number, l = 0) {
  const p = sim.players[i];
  const c = hexCenter(q, r);
  Object.assign(p, { x: c.x, z: c.z, y: LAYER_Y[l], vx: 0, vy: 0, vz: 0, ground: l, layer: l });
}

/** A sensible runner: head for the nearest floe nobody has touched yet on the layer you're on. */
function seek(sim: FloesSim, i: number) {
  const p = sim.players[i];
  const l = p.ground >= 0 ? p.ground : p.layer;
  let best: { x: number; z: number } | null = null;
  let bd = Infinity;
  for (const f of sim.layers[l].floes) {
    if (f.state !== 0) continue;
    const d = Math.hypot(f.x - p.x, f.z - p.z);
    if (d > HEX_W * 0.5 && d < bd) {
      bd = d;
      best = f;
    }
  }
  if (best) sim.setStick(i, (best.x - p.x) / bd, (best.z - p.z) / bd);
}

const floe = (sim: FloesSim, l: number, q: number, r: number) => sim.layers[l].floes[sim.floeAt(l, hexCenter(q, r).x, hexCenter(q, r).z)];

describe('the hex grid', () => {
  it('rounds every point to the hex it is in', () => {
    for (const h of hexField(4)) {
      const c = hexCenter(h.q, h.r);
      expect(hexRound(c.x, c.z)).toEqual(h);
      // Just inside the flat side and towards a corner still count.
      expect(hexRound(c.x + HEX_W * 0.49, c.z)).toEqual(h);
      expect(hexRound(c.x, c.z + HEX * 0.9)).toEqual(h);
    }
  });
  it('neighbours across a flat side are HEX_W apart', () => {
    const a = hexCenter(0, 0);
    const b = hexCenter(1, 0);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(HEX_W);
    expect(hexDist(2, -1)).toBe(2);
  });
  it('builds a round field: 1 + 3n(n+1) floes, middle first', () => {
    expect(hexField(5)).toHaveLength(91);
    expect(hexField(6)).toHaveLength(127);
    expect(hexField(3)[0]).toEqual({ q: 0, r: 0 });
  });
  it('has three layers, the top one highest, all above the water', () => {
    const sim = new FloesSim(4, mulberry32(1));
    expect(sim.layers).toHaveLength(LAYERS);
    for (let l = 1; l < LAYERS; l++) expect(sim.layers[l].y).toBeLessThan(sim.layers[l - 1].y);
    expect(WATER_Y).toBeLessThan(LAYER_Y[LAYERS - 1]);
    expect(sim.layers[0].floes).toHaveLength(hexField(ringsFor(4)).length);
  });
  it('a bigger field for a bigger crowd', () => {
    expect(ringsFor(8)).toBeGreaterThan(ringsFor(2));
  });
});

describe('spawning', () => {
  it('spreads everybody round the top layer, apart, on solid ice', () => {
    for (const n of [2, 3, 5, 8]) {
      const sim = new FloesSim(n, mulberry32(n));
      sim.players.forEach((p, i) => {
        expect(p.y).toBe(LAYER_Y[0]);
        expect(p.ground).toBe(0);
        expect(sim.solid(0, p.x, p.z)).toBe(true);
        sim.players.forEach((q, j) => j > i && expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(2));
      });
    }
  });
  it('nothing cracks and nobody moves before GO', () => {
    const sim = new FloesSim(2, mulberry32(2));
    sim.setStick(0, 1, 0);
    const x = sim.players[0].x;
    const ev = run(sim, 1);
    expect(ev).toEqual([]);
    expect(sim.players[0].x).toBe(x);
    expect(sim.floesLeft(0)).toBe(sim.layers[0].floes.length);
  });
});

describe('cracking', () => {
  it('a floe cracks when you stand on it and drops CRACK_S later', () => {
    const sim = new FloesSim(2, mulberry32(3));
    place(sim, 0, 0, 0);
    place(sim, 1, 3, 0);
    sim.begin();
    const first = sim.step();
    expect(first.filter((e) => e.t === 'crack')).toHaveLength(2);
    const f = floe(sim, 0, 0, 0);
    expect(f.state).toBe(1);
    expect(f.dropAt - f.crackAt).toBeCloseTo(CRACK_S);
    // Still holding just before the time is up…
    run(sim, CRACK_S - 2 * DT);
    expect(f.state).toBe(1);
    expect(sim.players[0].ground).toBe(0);
    // …gone right after.
    const ev = run(sim, 3 * DT);
    expect(f.state).toBe(2);
    expect(ev.some((e) => e.t === 'drop' && e.l === 0)).toBe(true);
    expect(ev.some((e) => e.t === 'fall' && e.i === 0)).toBe(true);
  });
  it('the timer starts at the first touch: walking back on does not reset it', () => {
    const sim = new FloesSim(2, mulberry32(3));
    place(sim, 0, 0, 0);
    place(sim, 1, -4, 0);
    sim.begin();
    sim.step();
    const f = floe(sim, 0, 0, 0);
    const at = f.dropAt;
    run(sim, 0.2);
    expect(f.dropAt).toBe(at);
  });
  it('a floe nobody stood on never drops', () => {
    const sim = new FloesSim(2, mulberry32(4));
    place(sim, 0, 0, 0);
    place(sim, 1, 4, 0);
    sim.begin();
    run(sim, 3);
    expect(floe(sim, 0, 2, -1).state).toBe(0);
    expect(floe(sim, 1, 2, -1).state).toBe(0);
  });
  it('running keeps you dry: every floe you cross cracks behind you', () => {
    const sim = new FloesSim(2, mulberry32(5));
    place(sim, 0, -4, 0);
    place(sim, 1, 0, 4);
    sim.begin();
    // Run right along the middle row for a second and a bit.
    run(sim, 1.2, (s) => s.setStick(0, 1, 0));
    const p = sim.players[0];
    expect(p.ground).toBe(0);
    expect(p.x).toBeGreaterThan(hexCenter(-4, 0).x + MAX_SPEED * 0.9);
    expect(floe(sim, 0, -4, 0).state).toBe(2);
    expect(floe(sim, 0, -2, 0).state).toBeGreaterThanOrEqual(1);
  });
});

describe('falling', () => {
  it('through a hole you land on the layer below', () => {
    const sim = new FloesSim(2, mulberry32(6));
    place(sim, 0, 0, 0);
    place(sim, 1, 4, -2);
    sim.begin();
    const ev = until(sim, (s) => s.players[0].ground === 1, 3);
    expect(ev.some((e) => e.t === 'land' && e.i === 0 && e.l === 1)).toBe(true);
    const p = sim.players[0];
    expect(p.y).toBe(LAYER_Y[1]);
    expect(p.alive).toBe(true);
    // …and that floe starts cracking too.
    expect(floe(sim, 1, 0, 0).state).toBe(1);
  });
  it('down through every layer if you just stand there, then into the water: out', () => {
    const sim = new FloesSim(3, mulberry32(7));
    place(sim, 0, 0, 0);
    place(sim, 1, 4, 0);
    place(sim, 2, -4, 0);
    sim.begin();
    const ev = until(sim, (s) => !s.players[0].alive, 10, (s) => {
      // The others keep running so they stay dry.
      seek(s, 1);
      seek(s, 2);
    });
    const lands = ev.filter((e) => e.t === 'land' && e.i === 0).map((e) => (e as { l: number }).l);
    expect(lands).toEqual([1, 2]);
    const splash = ev.find((e) => e.t === 'splash');
    expect(splash).toMatchObject({ i: 0 });
    const p = sim.players[0];
    expect(p.outTick).toBe(sim.tick);
    expect(p.y).toBe(WATER_Y);
    // Out in the river: the current carries you away.
    const z = p.z;
    run(sim, 1);
    expect(p.z).toBeLessThan(z - 0.5);
    expect(p.alive).toBe(false);
  });
  it('walking off the edge of the field drops you straight past every layer', () => {
    const sim = new FloesSim(2, mulberry32(8));
    const edge = sim.rings;
    place(sim, 0, edge, 0);
    place(sim, 1, -2, 0);
    sim.begin();
    const ev = until(sim, (s) => !s.players[0].alive, 6, (s) => s.setStick(0, 1, 0));
    expect(ev.some((e) => e.t === 'land' && e.i === 0)).toBe(false);
    expect(ev.some((e) => e.t === 'splash' && e.i === 0)).toBe(true);
  });
});

describe('jumping', () => {
  it('lasts long enough to cross a one-floe gap at full speed', () => {
    // From the middle of one floe to the far side of the next one along.
    expect(AIR_TIME * MAX_SPEED).toBeGreaterThan(HEX_W * 1.5);
  });
  it('clears a hole one floe wide', () => {
    const sim = new FloesSim(2, mulberry32(9));
    place(sim, 0, -1, 0);
    place(sim, 1, 0, 4);
    // The floe in between is already gone.
    const hole = floe(sim, 0, 0, 0);
    hole.state = 2;
    sim.begin();
    let pressed = false;
    const ev = until(
      sim,
      (s) => s.players[0].ground === 0 && s.floeAt(0, s.players[0].x, s.players[0].z) === s.floeAt(0, hexCenter(1, 0).x, 0),
      2,
      (s) => {
        s.setStick(0, 1, 0);
        // Jump on reaching the edge.
        if (!pressed && s.players[0].x > hexCenter(-1, 0).x + HEX_W * 0.4) {
          s.press(0);
          pressed = true;
        }
      },
    );
    expect(ev.some((e) => e.t === 'jump' && e.i === 0)).toBe(true);
    expect(ev.some((e) => e.t === 'land' && e.i === 0 && e.l === 0)).toBe(true);
    expect(sim.players[0].y).toBe(LAYER_Y[0]);
  });
  it('without a jump you fall into that hole', () => {
    const sim = new FloesSim(2, mulberry32(9));
    place(sim, 0, -1, 0);
    place(sim, 1, 0, 4);
    floe(sim, 0, 0, 0).state = 2;
    sim.begin();
    const ev = run(sim, 0.6, (s) => s.setStick(0, 1, 0));
    expect(ev.some((e) => e.t === 'fall' && e.i === 0 && e.l === 0)).toBe(true);
  });
  it('only from the ground: no double jumps', () => {
    const sim = new FloesSim(2, mulberry32(10));
    place(sim, 0, 0, 0);
    place(sim, 1, 3, 0);
    sim.begin();
    sim.press(0);
    sim.step();
    run(sim, 0.15, (s) => s.press(0));
    expect(sim.players[0].jumps).toBe(1);
  });
  it('a press just before landing jumps as soon as you touch down', () => {
    const sim = new FloesSim(2, mulberry32(11));
    place(sim, 0, 0, 0);
    place(sim, 1, 3, 0);
    sim.begin();
    sim.press(0);
    sim.step();
    until(sim, (s) => s.players[0].vy < 0 && s.players[0].y - LAYER_Y[0] < 0.15, 2);
    sim.press(0);
    const ev = until(sim, (s) => s.players[0].jumps === 2, 0.5);
    expect(ev.some((e) => e.t === 'land' && e.i === 0)).toBe(true);
    expect(sim.players[0].jumps).toBe(2);
  });
  it('can still jump a moment after walking off an edge', () => {
    const sim = new FloesSim(2, mulberry32(12));
    place(sim, 0, -1, 0);
    place(sim, 1, 0, 4);
    floe(sim, 0, 0, 0).state = 2;
    sim.begin();
    until(sim, (s) => s.players[0].ground < 0, 1, (s) => s.setStick(0, 1, 0));
    sim.step();
    sim.press(0);
    const ev = run(sim, 0.1, (s) => s.setStick(0, 1, 0));
    expect(ev.some((e) => e.t === 'jump' && e.i === 0)).toBe(true);
  });
  it('the buttons do nothing before GO or for pierogi in the water', () => {
    const sim = new FloesSim(2, mulberry32(13));
    sim.press(0);
    sim.begin();
    run(sim, 0.2);
    expect(sim.players[0].jumps).toBe(0);
  });
});

describe('pierogi bump', () => {
  it('do not overlap on the same layer', () => {
    const sim = new FloesSim(2, mulberry32(14));
    place(sim, 0, 0, 0);
    place(sim, 1, 0, 0);
    sim.players[1].x += 0.1;
    sim.begin();
    sim.step();
    const [a, b] = sim.players;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
  });
});

describe('a round', () => {
  it('last one dry wins and scores the most', () => {
    const sim = new FloesSim(3, mulberry32(15));
    place(sim, 0, 0, 0);
    place(sim, 1, 4, 0);
    place(sim, 2, -4, 0);
    sim.begin();
    // 0 stands still, 1 later, 2 runs round and round.
    const ev = until(sim, (s) => s.over, 20, (s) => {
      if (s.time > 0.6) s.setStick(1, 0, 0);
      else s.setStick(1, 0, 1);
      seek(s, 2);
    });
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.players[2].alive).toBe(true);
    const r = sim.results();
    expect(r.winners).toEqual([2]);
    expect(r.points[2]).toBe(4);
    expect(r.points[1]).toBe(1);
    expect(r.points[0]).toBe(0);
    expect(sim.players[0].outTick!).toBeLessThan(sim.players[1].outTick!);
  });
  it('falling in on the same tick is a tie', () => {
    const sim = new FloesSim(2, mulberry32(16));
    place(sim, 0, 0, 0);
    place(sim, 1, 3, 0);
    sim.begin();
    until(sim, (s) => s.over, 10);
    expect(sim.players[0].outTick).toBe(sim.players[1].outTick);
    const r = sim.results();
    expect(r.winners).toEqual([0, 1]);
    expect(r.points).toEqual([2, 2]);
  });
  it('after the clock runs out everybody still dry shares the win', () => {
    const sim = new FloesSim(3, mulberry32(17));
    sim.begin();
    // Freeze the ice (nobody cracks anything) by keeping everybody in the air… simpler: cheat the floes.
    const ev = run(sim, ROUND_S + 1, (s) => s.layers.forEach((l) => l.floes.forEach((f) => (f.state = 0))));
    expect(sim.over).toBe(true);
    expect(sim.timeout).toBe(true);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.time).toBeCloseTo(ROUND_S, 1);
    const r = sim.results();
    expect(r.winners).toEqual([0, 1, 2]);
    expect(r.points).toEqual([2, 2, 2]);
  });
  it('nothing more cracks or splashes once it is over', () => {
    const sim = new FloesSim(2, mulberry32(18));
    place(sim, 0, 0, 0);
    place(sim, 1, 4, 0);
    sim.begin();
    until(sim, (s) => s.over, 10, (s) => seek(s, 1));
    const t = sim.time;
    const ev = run(sim, 5);
    expect(ev.filter((e) => e.t === 'crack' || e.t === 'drop' || e.t === 'splash' || e.t === 'over')).toEqual([]);
    expect(sim.time).toBe(t);
    expect(sim.players[1].alive).toBe(true);
  });
});

describe('solo', () => {
  it('scores the whole seconds you stayed dry', () => {
    const sim = new FloesSim(1, mulberry32(19));
    expect(sim.solo).toBe(true);
    sim.begin();
    // Run for a bit, then stop and drop through.
    const ev = until(sim, (s) => s.over, 30, (s) => s.setStick(0, s.time < 2 ? 1 : 0, 0));
    expect(ev.some((e) => e.t === 'splash')).toBe(true);
    const secs = sim.survived(0);
    expect(secs).toBeGreaterThan(2);
    const r = sim.results();
    expect(r.winners).toEqual([]);
    expect(r.points[0]).toBe(Math.floor(secs));
  });
  it('a full 90 s scores 90', () => {
    const sim = new FloesSim(1, mulberry32(20));
    sim.begin();
    run(sim, ROUND_S + 1, (s) => s.layers.forEach((l) => l.floes.forEach((f) => (f.state = 0))));
    expect(sim.results().points).toEqual([ROUND_S]);
  });
  it('starts in the middle', () => {
    const sim = new FloesSim(1, mulberry32(21));
    expect(sim.players[0].x).toBe(0);
    expect(sim.players[0].z).toBe(0);
  });
});

describe('removal', () => {
  it('a player who left scores nothing and the last one dry wins', () => {
    const sim = new FloesSim(3, mulberry32(22));
    sim.begin();
    run(sim, 0.1);
    sim.remove(2);
    sim.remove(1);
    const ev = sim.step();
    expect(ev.some((e) => e.t === 'over')).toBe(true);
    const r = sim.results();
    expect(r.winners).toEqual([0]);
    expect(r.points[1]).toBe(0);
    expect(r.points[2]).toBe(0);
    expect(r.points[0]).toBe(2);
  });
  it('a player who left before the round is not in it', () => {
    const sim = new FloesSim(3, mulberry32(23), [false, true, false]);
    expect(sim.solo).toBe(false);
    expect(sim.players[1].alive).toBe(false);
    expect(sim.aliveCount).toBe(2);
    const solo = new FloesSim(2, mulberry32(23), [true, false]);
    expect(solo.solo).toBe(true);
  });
  it('removed pierogi do not move or crack anything', () => {
    const sim = new FloesSim(2, mulberry32(24));
    place(sim, 0, 0, 0);
    place(sim, 1, 4, 0);
    sim.remove(1);
    sim.begin();
    sim.step();
    expect(floe(sim, 0, 4, 0).state).toBe(0);
  });
});

describe('howTo', () => {
  it('has three short lines', () => {
    for (const s of [true, false]) {
      const h = howTo(s);
      expect(h).toHaveLength(3);
      h.forEach((l) => expect(l.length).toBeLessThan(60));
    }
    expect(howTo(true)[2]).toMatch(/One round/);
  });
});
