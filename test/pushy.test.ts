import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../client/src/games/rng';
import {
  BRACE_MASS,
  BRACE_S,
  CRACK_S,
  DASH_CAP,
  DT,
  FLOE_R,
  MAX_SPEED,
  PLAYER_R,
  PUSHY_ROUNDS,
  PUSHY_ROUNDS_SHORT,
  PushySim,
  RING_SECTORS,
  ROUND_S,
  SHOVE_COOL_MS,
  SHOVE_IMPULSE,
  SHRINK_SPAN,
  SHRINK_START,
  buildChunks,
  chunkAt,
  chunkSchedule,
  howTo,
  roundPoints,
} from '../client/src/games/pushy/logic';

function sim(n = 2, seed = 7, stones = false) {
  const s = new PushySim(n, mulberry32(seed));
  // Keep the curling stones out of tests that are not about them.
  if (!stones) (s as unknown as { nextStone: number }).nextStone = 1e9;
  s.start();
  return s;
}
/** Put players in a tidy line-up near the centre, at rest. */
function place(s: PushySim, spots: [number, number][]) {
  spots.forEach(([x, z], i) => {
    const p = s.players[i];
    p.x = x;
    p.z = z;
    p.vx = p.vz = 0;
  });
}
const run = (s: PushySim, secs: number) => {
  const ev = [];
  for (let i = 0; i < Math.round(secs / DT); i++) ev.push(...s.step());
  return ev;
};
const speed = (s: PushySim, i: number) => Math.hypot(s.players[i].vx, s.players[i].vz);

describe('gliding on ice', () => {
  it('accelerates gradually instead of jumping to speed', () => {
    const s = sim();
    place(s, [[0, 0], [5, 5]]);
    s.setStick(0, 1, 0);
    run(s, 0.1);
    expect(speed(s, 0)).toBeGreaterThan(0.5);
    expect(speed(s, 0)).toBeLessThan(MAX_SPEED / 2);
  });

  it('never exceeds the top speed under its own power', () => {
    const s = sim();
    place(s, [[-3, 0], [5, 5]]);
    s.setStick(0, 1, 0);
    run(s, 1.5);
    expect(speed(s, 0)).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
    expect(speed(s, 0)).toBeGreaterThan(MAX_SPEED - 0.5);
  });

  it('keeps gliding when you let go, and slowly loses speed', () => {
    const s = sim();
    place(s, [[-5, 0], [5, 5]]);
    s.players[0].vx = 6;
    run(s, 0.5);
    const v1 = speed(s, 0);
    expect(v1).toBeLessThan(6);
    expect(v1).toBeGreaterThan(3);
    const x1 = s.players[0].x;
    run(s, 0.5);
    expect(speed(s, 0)).toBeLessThan(v1);
    expect(s.players[0].x).toBeGreaterThan(x1 + 1);
    run(s, 4);
    expect(speed(s, 0)).toBe(0);
  });

  it('turning around takes a while (momentum)', () => {
    const s = sim();
    place(s, [[0, 0], [5, 5]]);
    s.players[0].vx = 6;
    s.setStick(0, -1, 0);
    run(s, 0.2);
    expect(s.players[0].vx).toBeGreaterThan(0);
  });

  it('faces the way it is steered', () => {
    const s = sim();
    place(s, [[0, 0], [5, 5]]);
    s.setStick(0, 0, 1);
    run(s, 0.5);
    expect(Math.abs(s.players[0].face)).toBeLessThan(0.1);
  });
});

describe('collisions', () => {
  it('passes momentum on: the runner stops, the other flies', () => {
    const s = sim();
    place(s, [[-3, 0], [-3 + PLAYER_R * 2 + 0.05, 0]]);
    s.players[0].vx = 6;
    run(s, 0.1);
    expect(s.players[1].vx).toBeGreaterThan(4.5);
    expect(s.players[0].vx).toBeLessThan(1.5);
    expect(s.players[1].vx).toBeGreaterThan(s.players[0].vx);
  });

  it('conserves momentum (equal masses, ignoring friction)', () => {
    const s = sim();
    place(s, [[-3, 0], [-3 + PLAYER_R * 2, 0.4]]);
    s.players[0].vx = 5;
    const ev = s.step();
    const p0 = s.players[0];
    const p1 = s.players[1];
    expect(ev.some((e) => e.k === 'bump')).toBe(true);
    expect(p0.vx + p1.vx).toBeCloseTo(5, 0);
  });

  it('separates overlapping players', () => {
    const s = sim();
    place(s, [[0, 0], [0.5, 0]]);
    s.step();
    const d = Math.hypot(s.players[1].x - s.players[0].x, s.players[1].z - s.players[0].z);
    expect(d).toBeGreaterThanOrEqual(PLAYER_R * 2 - 1e-6);
  });

  it('a hard bump is reported, a gentle touch is not', () => {
    const hard = sim();
    place(hard, [[0, 0], [PLAYER_R * 2 - 0.01, 0]]);
    hard.players[0].vx = 7;
    expect(hard.step().some((e) => e.k === 'bump')).toBe(true);
    const soft = sim();
    place(soft, [[0, 0], [PLAYER_R * 2 - 0.01, 0]]);
    soft.players[0].vx = 1;
    expect(soft.step().some((e) => e.k === 'bump')).toBe(false);
  });
});

describe('shove', () => {
  it('adds a big impulse in the stick direction', () => {
    const s = sim();
    place(s, [[0, 0], [5, 5]]);
    s.setStick(0, 0, 1);
    expect(s.shove(0)).toBe(true);
    expect(s.players[0].vz).toBeGreaterThan(SHOVE_IMPULSE - 0.5);
    expect(Math.abs(s.players[0].vx)).toBeLessThan(0.01);
    expect(speed(s, 0)).toBeLessThanOrEqual(DASH_CAP + 1e-6);
  });

  it('goes the way you face when the stick is idle', () => {
    const s = sim();
    place(s, [[0, 0], [5, 5]]);
    s.players[0].face = Math.PI / 2; // +x
    s.shove(0);
    expect(s.players[0].vx).toBeGreaterThan(SHOVE_IMPULSE - 0.5);
  });

  it('has a cooldown', () => {
    const s = sim();
    place(s, [[0, 0], [5, 5]]);
    expect(s.shove(0)).toBe(true);
    run(s, 0.5);
    expect(s.shove(0)).toBe(false);
    run(s, SHOVE_COOL_MS / 1000);
    expect(s.shove(0)).toBe(true);
  });

  it('does not work before the start', () => {
    const s = new PushySim(2, mulberry32(1));
    expect(s.shove(0)).toBe(false);
    expect(s.brace(0)).toBe(false);
  });

  it('a dash sends a bystander much further than a plain bump', () => {
    const a = sim();
    place(a, [[-2, 0], [-2 + PLAYER_R * 2 + 0.2, 0]]);
    a.setStick(0, 1, 0);
    a.shove(0);
    run(a, 0.2);
    const dashV = a.players[1].vx;
    const b = sim();
    place(b, [[-2, 0], [-2 + PLAYER_R * 2 + 0.2, 0]]);
    b.players[0].vx = MAX_SPEED;
    run(b, 0.2);
    expect(dashV).toBeGreaterThan(b.players[1].vx + 2);
    expect(dashV).toBeGreaterThan(8);
  });
});

describe('brace', () => {
  it('makes you very heavy for a moment, then lets go', () => {
    const s = sim();
    place(s, [[0, 0], [5, 5]]);
    expect(s.mass(0)).toBe(1);
    expect(s.brace(0)).toBe(true);
    expect(s.mass(0)).toBe(BRACE_MASS);
    run(s, BRACE_S + 0.1);
    expect(s.mass(0)).toBe(1);
    expect(s.brace(0)).toBe(false); // cooling down
    run(s, 3);
    expect(s.brace(0)).toBe(true);
  });

  it('stops you quickly', () => {
    const s = sim();
    place(s, [[-5, 0], [5, 5]]);
    s.players[0].vx = 6;
    s.brace(0);
    run(s, 0.6);
    expect(speed(s, 0)).toBeLessThan(0.3);
  });

  it('barely moves when hit, and the attacker bounces off', () => {
    const s = sim();
    place(s, [[-2, 0], [-2 + PLAYER_R * 2 + 0.05, 0]]);
    s.brace(1);
    s.players[0].vx = 7;
    run(s, 0.05);
    expect(Math.abs(s.players[1].vx)).toBeLessThan(2);
    expect(s.players[0].vx).toBeLessThan(-3);
  });

  it('beats a dash: the dasher bounces, the braced one holds', () => {
    const s = sim();
    place(s, [[-2, 0], [-2 + PLAYER_R * 2 + 0.3, 0]]);
    s.brace(1);
    s.setStick(0, 1, 0);
    s.shove(0);
    run(s, 0.1);
    expect(s.players[1].vx).toBeLessThan(2.5);
    expect(s.players[0].vx).toBeLessThan(0);
  });

  it('cannot shove while braced', () => {
    const s = sim();
    place(s, [[0, 0], [5, 5]]);
    s.brace(0);
    expect(s.shove(0)).toBe(false);
  });
});

describe('falling in', () => {
  it('chunk lookup follows rings and sectors', () => {
    const chunks = buildChunks(mulberry32(3));
    expect(chunkAt(chunks, 0, 0)).toBe(0);
    expect(chunkAt(chunks, FLOE_R + 0.1, 0)).toBe(-1);
    const c = chunks[chunkAt(chunks, 9, 0.5)];
    expect(c.ring).toBe(RING_SECTORS.length - 1);
    expect(Math.hypot(9, 0.5)).toBeGreaterThanOrEqual(c.r0);
    expect(Math.hypot(9, 0.5)).toBeLessThan(c.r1);
    expect(chunks.length).toBe(RING_SECTORS.reduce((a, b) => a + b, 0));
  });

  it('slipping past the edge puts you in the pond, out of the round', () => {
    const s = sim(3);
    place(s, [[FLOE_R - 0.5, 0], [-4, 0], [0, 4]]);
    s.players[0].vx = 5;
    const ev = run(s, 0.5);
    expect(s.players[0].alive).toBe(false);
    expect(s.players[0].cause).toBe('edge');
    expect(ev.some((e) => e.k === 'fall' && e.i === 0)).toBe(true);
    expect(ev.some((e) => e.k === 'splash' && e.i === 0)).toBe(true);
    expect(s.players[1].alive).toBe(true);
  });

  it('being on a sunk chunk counts as the edge, too', () => {
    const s = sim(3);
    place(s, [[8.8, 0], [-2, 0], [0, 3]]);
    const id = chunkAt(s.chunks, 8.8, 0);
    expect(s.onFloe(8.8, 0)).toBe(true);
    s.chunks[id].state = 2;
    expect(s.onFloe(8.8, 0)).toBe(false);
    expect(s.onFloe(0, 0)).toBe(true);
    s.step();
    expect(s.players[0].alive).toBe(false);
    expect(s.players[1].alive).toBe(true);
  });

  it('the remaining chunks, not just a radius, decide: a hole in the middle ring', () => {
    const s = sim(3);
    place(s, [[6.5, 0], [-2, 0], [0, 3]]);
    s.chunks[chunkAt(s.chunks, 6.5, 0)].state = 2;
    s.step();
    expect(s.players[0].alive).toBe(false);
    // The chunk beyond it is still ice.
    expect(s.onFloe(9.6, 0)).toBe(true);
  });

  it('sinking chunks drop whoever stands on them', () => {
    const s = sim(3);
    place(s, [[9.2, 0], [-1, 0], [0, 1.5]]);
    const id = chunkAt(s.chunks, 9.2, 0);
    s.chunks[id].state = 1;
    s.chunks[id].breakAt = 0.05;
    const ev = run(s, 0.2);
    expect(ev.some((e) => e.k === 'break' && e.c === id)).toBe(true);
    expect(s.players[0].alive).toBe(false);
    expect(s.players[0].cause).toBe('sink');
  });

  it('players cannot wander off before the start', () => {
    const s = new PushySim(2, mulberry32(1));
    place(s, [[7, 0], [-2, 0]]);
    s.setStick(0, 1, 0);
    for (let i = 0; i < 300; i++) s.step();
    expect(Math.hypot(s.players[0].x, s.players[0].z)).toBeLessThan(9);
    expect(s.players[0].alive).toBe(true);
  });
});

describe('the floe shrinks', () => {
  const chunks = buildChunks(mulberry32(5));
  const sched = chunkSchedule(chunks, mulberry32(9));

  it('schedules every chunk but the centre', () => {
    expect(sched.length).toBe(chunks.length - 1);
    expect(new Set(sched.map((s) => s.c)).size).toBe(sched.length);
    expect(sched.some((s) => s.c === 0)).toBe(false);
  });

  it('goes outside in', () => {
    const rings = sched.map((s) => chunks[s.c].ring);
    for (let i = 1; i < rings.length; i++) expect(rings[i]).toBeLessThanOrEqual(rings[i - 1]);
    expect(rings[0]).toBe(RING_SECTORS.length - 1);
  });

  it('starts after a while, ends well before the round does, and warns first', () => {
    expect(sched[0].crackAt).toBe(SHRINK_START);
    expect(sched[sched.length - 1].crackAt).toBeCloseTo(SHRINK_START + SHRINK_SPAN, 5);
    for (const s of sched) expect(s.breakAt - s.crackAt).toBeCloseTo(CRACK_S, 6);
    expect(sched[sched.length - 1].breakAt).toBeLessThan(ROUND_S - 10);
    for (let i = 1; i < sched.length; i++) expect(sched[i].crackAt).toBeGreaterThan(sched[i - 1].crackAt);
  });

  it('shuffles the sectors', () => {
    const other = chunkSchedule(chunks, mulberry32(10));
    expect(other.map((s) => s.c)).not.toEqual(sched.map((s) => s.c));
  });

  it('leaves only the centre in the end', () => {
    const s = sim(2);
    place(s, [[0.5, 0], [-0.5, 0.2]]);
    s.players[0].alive = s.players[1].alive = true;
    // Run the clock without letting the fight end.
    for (let i = 0; i < Math.ceil((SHRINK_START + SHRINK_SPAN + CRACK_S + 1) / DT); i++) {
      s.players.forEach((p, k) => {
        p.vx = p.vz = 0;
        p.x = k ? -0.4 : 0.4;
        p.z = 0;
      });
      s.step();
    }
    expect(s.chunks.filter((c) => c.state !== 2).map((c) => c.id)).toEqual([0]);
    expect(s.onFloe(2.3, 0)).toBe(true);
    expect(s.onFloe(3.3, 0)).toBe(false);
  });

  it('shows cracks (state 1) two seconds before a chunk sinks', () => {
    const s = sim(2);
    const first = sched[0];
    const firstId = s.schedule[0].c;
    s.players.forEach((p, k) => {
      p.x = k ? -0.4 : 0.4;
      p.z = 0;
    });
    const ev: string[] = [];
    for (let i = 0; i < (SHRINK_START + CRACK_S + 0.5) / DT; i++) {
      s.players.forEach((p) => (p.vx = p.vz = 0));
      for (const e of s.step()) if (e.k === 'crack' && e.c === firstId) ev.push(`crack@${s.t.toFixed(1)}`);
      if (Math.abs(s.t - (SHRINK_START + 1)) < DT / 2) expect(s.chunks[firstId].state).toBe(1);
    }
    expect(ev.length).toBe(1);
    expect(s.chunks[firstId].state).toBe(2);
    expect(first.crackAt).toBe(SHRINK_START);
  });
});

describe('curling stones', () => {
  it('announces a stone shortly before it runs, and it sends a player flying', () => {
    const s = sim(2, 11, true);
    s.players.forEach((p, k) => {
      p.x = k ? -50 : 50; // far away: not our business
      p.alive = true;
    });
    // keep them alive and still, wait for the first warning
    let warned = -1;
    let launched = -1;
    for (let i = 0; i < 20 / DT && launched < 0; i++) {
      s.players.forEach((p, k) => {
        p.x = k ? 0.4 : -0.4;
        p.z = 0;
        p.vx = p.vz = 0;
      });
      for (const e of s.step()) {
        if (e.k === 'warn') warned = s.t;
        if (e.k === 'launch') launched = s.t;
      }
    }
    expect(warned).toBeGreaterThan(0);
    expect(launched - warned).toBeCloseTo(1.2, 1);
    const st = s.stones[0];
    expect(st.running).toBe(true);
  });

  it('hits knock a player along the stone path', () => {
    const s = sim(2, 3, true);
    place(s, [[0, 0], [-4, 6]]);
    s.stones.push({ id: 0, x: -3, z: 0, dx: 1, dz: 0, sx: -20, sz: 0, launchAt: 0, running: true, done: false, spin: 0 });
    const ev = s.step();
    expect(ev.some((e) => e.k === 'stoneHit' && e.i === 0)).toBe(false);
    s.stones[0].x = -1;
    const ev2 = s.step();
    expect(ev2.some((e) => e.k === 'stoneHit' && e.i === 0)).toBe(true);
    expect(s.players[0].vx).toBeGreaterThan(8);
  });
});

describe('stone directions', () => {
  it('always start on the far side or the sides, never the near bank', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = sim(3, seed, true);
      (s as unknown as { spawnStone(): void }).spawnStone();
      const st = s.stones[0];
      expect(Math.abs(Math.hypot(st.dx, st.dz) - 1)).toBeLessThan(1e-9);
      // the arrow sits ~17 m out on the start side: its z must not be on the camera side
      expect(st.sz + st.dz * 3).toBeLessThan(10);
    }
  });
});

describe('round end and points', () => {
  it('ends when one player is left, who wins; points count those who fell before', () => {
    const s = sim(4);
    place(s, [[0, 3], [3, 0], [-3, 0], [0, -3]]);
    s.players[1].x = 12;
    run(s, 0.1);
    s.players[2].x = -12;
    run(s, 0.1);
    expect(s.over).toBe(false);
    s.players[3].z = -12;
    const ev = run(s, 0.1);
    expect(s.over).toBe(true);
    expect(ev.some((e) => e.k === 'end')).toBe(true);
    expect(s.winners).toEqual([0]);
    expect(s.points()).toEqual([3 + 2, 0, 1, 2]);
  });

  it('players that go in together share the place', () => {
    expect(roundPoints([10, 10, 5, null], [false, false, false, false], [3])).toEqual([1, 1, 0, 3 + 2]);
  });

  it('if the last two go in together they share the win', () => {
    const s = sim(3);
    place(s, [[0, 3], [3, 0], [-3, 0]]);
    s.players[0].x = 12;
    run(s, 0.1);
    s.players[1].x = 12;
    s.players[2].x = -12;
    run(s, 0.1);
    expect(s.over).toBe(true);
    expect(s.winners.sort()).toEqual([1, 2]);
    expect(s.points()).toEqual([0, 1 + 2, 1 + 2]);
  });

  it('ends at the time limit with everybody left sharing the win', () => {
    const s = sim(3);
    place(s, [[0, 0], [1.9, 0], [-1.9, 0]]);
    s.players[0].alive = true;
    for (let i = 0; i < ROUND_S / DT + 5 && !s.over; i++) {
      s.players.forEach((p, k) => {
        p.vx = p.vz = 0;
        p.x = [0, 1.9, -1.9][k];
        p.z = 0;
      });
      s.step();
    }
    expect(s.over).toBe(true);
    expect(s.timeout).toBe(true);
    expect(s.winners).toEqual([0, 1, 2]);
    expect(s.points()).toEqual([2, 2, 2]);
  });

  it('removed players take no part and score nothing', () => {
    const s = new PushySim(3, mulberry32(2), [false, false, true]);
    s.start();
    expect(s.players[2].alive).toBe(false);
    s.players[1].x = 13;
    run(s, 0.1);
    expect(s.over).toBe(true);
    expect(s.winners).toEqual([0]);
    expect(s.points()).toEqual([1 + 2, 0, 0]);
  });

  it('after the end nobody else falls', () => {
    const s = sim(2);
    place(s, [[0, 0], [13, 0]]);
    run(s, 0.1);
    expect(s.over).toBe(true);
    s.players[0].vx = 20;
    run(s, 1);
    expect(s.players[0].alive).toBe(true);
  });
});

describe('rounds', () => {
  it('full game is three rounds, the tournament one', () => {
    expect(PUSHY_ROUNDS).toBe(3);
    expect(PUSHY_ROUNDS_SHORT).toBe(1);
  });
  it('how-to has three lines, the short one without the round count', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);
    expect(howTo(false).join(' ')).toContain(String(PUSHY_ROUNDS));
    expect(howTo(true).join(' ')).not.toContain(String(PUSHY_ROUNDS));
  });
});
