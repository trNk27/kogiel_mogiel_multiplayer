import { describe, expect, it } from 'vitest';
import {
  CALL_FIRST_S,
  CALL_MIN_S,
  DT,
  FALL_MARGIN,
  KNOCK,
  MAX_CALLS,
  MUSH_ROUNDS,
  MUSH_ROUNDS_SHORT,
  MushroomSim,
  PLAYER_R,
  SHOVE_COOL,
  SPECIES,
  WALK,
  WIN_BONUS,
  callTimeFor,
  capPos,
  capReachableFrom,
  capsFor,
  centreReachable,
  howTo,
  makeLayout,
  roundPoints,
  spinFor,
  supportAt,
  survivesSink,
  walkReach,
  type MEvent,
} from '../client/src/games/mushroom/logic';
import { mulberry32 } from '../client/src/games/rng';

/** Step the sim until `until` says stop (or a limit), collecting events. */
function run(sim: MushroomSim, until: (ev: MEvent[]) => boolean, maxSeconds = 120) {
  const all: MEvent[] = [];
  for (let k = 0; k < maxSeconds / DT; k++) {
    const ev = sim.step();
    all.push(...ev);
    if (until(ev)) break;
  }
  return all;
}

const untilCall = (ev: MEvent[]) => ev.some((e) => e.t === 'call');

/** Put player `i` at the centre of cap `cap` plus an offset. */
function placeOnCap(sim: MushroomSim, i: number, cap: number, dx = 0, dz = 0) {
  const c = capPos(sim.L, sim.ring, cap);
  sim.players[i].x = c.x + dx;
  sim.players[i].z = c.z + dz;
}

describe('call timing', () => {
  it('starts at 4.5 s and gets shorter down to 1.6 s', () => {
    expect(callTimeFor(1)).toBeCloseTo(CALL_FIRST_S);
    expect(CALL_FIRST_S).toBe(4.5);
    let prev = Infinity;
    for (let n = 1; n <= 40; n++) {
      const t = callTimeFor(n);
      expect(t).toBeLessThanOrEqual(prev);
      expect(t).toBeGreaterThanOrEqual(CALL_MIN_S);
      prev = t;
    }
    expect(callTimeFor(40)).toBe(CALL_MIN_S);
    expect(callTimeFor(2)).toBeLessThan(callTimeFor(1) - 0.3);
    expect(callTimeFor(10)).toBeLessThan(2);
  });

  it('turns the ring from the third call on, faster later', () => {
    expect(spinFor(1)).toBe(0);
    expect(spinFor(2)).toBe(0);
    expect(spinFor(3)).toBeGreaterThan(0);
    expect(spinFor(9)).toBeGreaterThan(spinFor(3));
  });

  it('uses the scheduled time for each call', () => {
    const sim = new MushroomSim(3, mulberry32(5));
    const calls: Extract<MEvent, { t: 'call' }>[] = [];
    for (let guard = 0; guard < 2000 && calls.length < 4 && !sim.ended; guard++) {
      // Everyone stands on the called cap so nobody falls and the calls keep coming.
      for (let i = 0; i < 3; i++) if (sim.targetCap >= 0 && sim.phase === 'call') placeOnCap(sim, i, sim.targetCap, (i - 1) * 0.7);
      for (const e of sim.step()) if (e.t === 'call') calls.push(e);
      // Keep players with the (moving) target cap during sinks too.
      if (sim.phase !== 'call' && sim.safe.length) for (let i = 0; i < 3; i++) placeOnCap(sim, i, sim.safe[0], (i - 1) * 0.7);
    }
    expect(calls.length).toBe(4);
    calls.forEach((c, k) => {
      const base = callTimeFor(k + 1);
      expect(c.time).toBeGreaterThanOrEqual(base - 1e-9);
      expect(c.time).toBeLessThanOrEqual(base + 0.5);
      expect(c.n).toBe(k + 1);
    });
  });
});

describe('layout', () => {
  it('rings 6, 7 or 8 mushrooms by player count', () => {
    expect(capsFor(2)).toBe(6);
    expect(capsFor(4)).toBe(6);
    expect(capsFor(5)).toBe(7);
    expect(capsFor(6)).toBe(7);
    expect(capsFor(7)).toBe(8);
    expect(capsFor(8)).toBe(8);
    expect(SPECIES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SPECIES.map((s) => s.hex)).size).toBe(SPECIES.length);
  });

  it('has no holes between the platform and the caps, and neighbours touch', () => {
    for (const n of [6, 7, 8]) {
      const L = makeLayout(n);
      // Cap rims touch their neighbours.
      const a = capPos(L, 0, 0);
      const b = capPos(L, 0, 1);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThanOrEqual(2 * L.capR * 1.05);
      // Every point from the middle out to the ring's outer edge is on something.
      for (let ring = 0; ring < 1; ring += 0.37) {
        // Out to where two neighbouring caps stop overlapping (the scalloped rim starts there).
        const half = L.ringR * Math.sin(Math.PI / n);
        const solid = L.ringR * Math.cos(Math.PI / n) + Math.sqrt(L.capHit * L.capHit - half * half) - 0.05;
        for (let r = 0; r <= solid; r += 0.1) {
          for (let k = 0; k < 90; k++) {
            const ang = (k / 90) * Math.PI * 2;
            expect(supportAt(L, ring, Math.cos(ang) * r, Math.sin(ang) * r).kind).not.toBe('water');
          }
        }
      }
    }
  });
});

describe('who survives a sink', () => {
  const L = makeLayout(6);
  const ring = 0.3;
  const target = 2;
  const safe = [target];
  const c = capPos(L, ring, target);

  it('keeps someone standing on the called cap', () => {
    expect(survivesSink(L, ring, c.x, c.z, safe)).toBe(true);
    expect(survivesSink(L, ring, c.x + 0.8, c.z - 0.5, safe)).toBe(true);
  });

  it('drops someone on the platform', () => {
    expect(survivesSink(L, ring, 0, 0, safe)).toBe(false);
    expect(survivesSink(L, ring, 0.5, -0.5, safe)).toBe(false);
  });

  it('drops someone on a wrong cap', () => {
    const w = capPos(L, ring, 4);
    expect(survivesSink(L, ring, w.x, w.z, safe)).toBe(false);
  });

  it('drops someone whose centre is past the rim', () => {
    const a = Math.atan2(c.z, c.x);
    const rim = L.ringR + L.capHit;
    expect(survivesSink(L, ring, Math.cos(a) * (rim - 0.2), Math.sin(a) * (rim - 0.2), safe)).toBe(true);
    expect(supportAt(L, ring, Math.cos(a) * (rim + 0.2), Math.sin(a) * (rim + 0.2)).kind).toBe('water');
    expect(survivesSink(L, ring, Math.cos(a) * (rim + 0.2), Math.sin(a) * (rim + 0.2), safe)).toBe(false);
  });

  it('counts both caps when two share the called colour', () => {
    const two = [target, 5];
    const d = capPos(L, ring, 5);
    expect(survivesSink(L, ring, d.x, d.z, two)).toBe(true);
    expect(survivesSink(L, ring, c.x, c.z, two)).toBe(true);
    expect(survivesSink(L, ring, 0, 0, two)).toBe(false);
  });

  it('sinks the right people in a running sim', () => {
    const sim = new MushroomSim(4, mulberry32(11));
    run(sim, untilCall);
    expect(sim.phase).toBe('call');
    const t = sim.targetCap;
    const wrong = (t + 3) % sim.L.n;
    placeOnCap(sim, 0, t);
    placeOnCap(sim, 1, t, 0.5, 0.2);
    sim.players[2].x = 0;
    sim.players[2].z = 0;
    placeOnCap(sim, 3, wrong);
    const ev = run(sim, (e) => e.some((x) => x.t === 'sink'));
    const sink = ev.find((e) => e.t === 'sink') as Extract<MEvent, { t: 'sink' }>;
    expect(sink.fell.sort()).toEqual([2, 3]);
    expect(sim.players[0].alive).toBe(true);
    expect(sim.players[1].alive).toBe(true);
    expect(sim.players[2].alive).toBe(false);
    // Down they go: the platform and wrong caps sink, the called cap stays.
    for (let k = 0; k < 90; k++) sim.step();
    expect(sim.platDown).toBe(1);
    expect(sim.capDown[t]).toBe(0);
    expect(sim.capDown[wrong]).toBe(1);
  });
});

describe('movement and shoving', () => {
  const lone = (n = 2) => {
    const sim = new MushroomSim(n, mulberry32(3));
    for (let i = 0; i < n; i++) {
      sim.players[i].x = i * 1.5 - 0.7;
      sim.players[i].z = 0;
    }
    return sim;
  };

  it('walks at about 5.5 m/s with a little inertia', () => {
    const sim = new MushroomSim(2, mulberry32(3));
    sim.players[0].x = -1.5;
    sim.players[0].z = 0;
    sim.players[1].x = 1.5;
    sim.players[1].z = 1.2;
    sim.setInput(0, 1, 0);
    for (let k = 0; k < 6; k++) sim.step();
    // Not at full speed straight away…
    expect(sim.players[0].vx).toBeGreaterThan(1);
    expect(sim.players[0].vx).toBeLessThan(WALK * 0.85);
    // …but there after a moment (the wall at the end of the platform stops us moving, so check speed early).
    for (let k = 0; k < 6; k++) sim.step();
    expect(sim.players[0].vx).toBeGreaterThan(WALK * 0.7);
    expect(sim.players[0].vx).toBeLessThanOrEqual(WALK);
  });

  it('pushes overlapping players apart (soft circles)', () => {
    const sim = lone();
    sim.players[0].x = 0;
    sim.players[1].x = 0.3;
    for (let k = 0; k < 30; k++) sim.step();
    const d = Math.hypot(sim.players[0].x - sim.players[1].x, sim.players[0].z - sim.players[1].z);
    expect(d).toBeGreaterThan(PLAYER_R * 2 * 0.95);
  });

  it('a shove knocks the bumped player back, with a cooldown', () => {
    const sim = lone();
    run(sim, untilCall);
    const a = sim.players[0];
    const b = sim.players[1];
    a.x = -0.6;
    a.z = 0;
    b.x = 0.4;
    b.z = 0;
    sim.setInput(0, 1, 0);
    sim.queueShove(0);
    const ev = sim.step();
    expect(ev.some((e) => e.t === 'shove')).toBe(true);
    let hit = ev.some((e) => e.t === 'hit');
    for (let k = 0; k < 20 && !hit; k++) hit = sim.step().some((e) => e.t === 'hit') || hit;
    expect(hit).toBe(true);
    expect(b.kx).toBeGreaterThan(KNOCK * 0.5);
    const bx = b.x;
    for (let k = 0; k < 30; k++) sim.step();
    expect(b.x).toBeGreaterThan(bx + 0.4);
    // Cooling down: a second press straight away does nothing.
    expect(a.cool).toBeGreaterThan(0);
    expect(a.cool).toBeLessThanOrEqual(SHOVE_COOL);
    sim.queueShove(0);
    expect(sim.step().some((e) => e.t === 'shove')).toBe(false);
  });

  it('a shove from the rim throws a player into the pond and ends a two-player round', () => {
    const sim = new MushroomSim(2, mulberry32(3));
    run(sim, untilCall);
    const t = sim.targetCap;
    const c = capPos(sim.L, sim.ring, t);
    const out = Math.atan2(c.z, c.x);
    const rim = sim.L.ringR + sim.L.capHit;
    sim.omega = sim.omegaTo = 0;
    // b stands near the outer rim of the target cap, a just inside of it, and a dashes outwards.
    sim.players[1].x = Math.cos(out) * (rim - 0.45);
    sim.players[1].z = Math.sin(out) * (rim - 0.45);
    sim.players[0].x = Math.cos(out) * (rim - 1.5);
    sim.players[0].z = Math.sin(out) * (rim - 1.5);
    sim.setInput(0, Math.cos(out), Math.sin(out));
    sim.queueShove(0);
    const ev = run(sim, (e) => e.some((x) => x.t === 'fall'), 3);
    const fall = ev.find((e) => e.t === 'fall') as Extract<MEvent, { t: 'fall' }>;
    expect(fall).toBeTruthy();
    expect(fall.p).toBe(1);
    expect(fall.why).toBe('edge');
    expect(sim.players[1].alive).toBe(false);
    expect(sim.ended).toBe(true);
    expect(sim.winner).toBe(0);
    expect(sim.phase).toBe('over');
  });

  it('walking alone never takes you off the edge', () => {
    const sim = new MushroomSim(2, mulberry32(8));
    run(sim, untilCall);
    sim.omega = sim.omegaTo = 0;
    const t = sim.targetCap;
    const c = capPos(sim.L, sim.ring, t);
    const a = Math.atan2(c.z, c.x);
    sim.players[0].x = c.x;
    sim.players[0].z = c.z;
    sim.players[1].x = -c.x * 0.2;
    sim.players[1].z = -c.z * 0.2;
    sim.setInput(0, Math.cos(a), Math.sin(a));
    for (let k = 0; k < 90; k++) sim.step();
    expect(sim.players[0].alive).toBe(true);
    const rim = sim.L.ringR + sim.L.capHit + 0.31;
    expect(Math.hypot(sim.players[0].x, sim.players[0].z)).toBeLessThanOrEqual(rim);
    expect(FALL_MARGIN).toBeGreaterThan(0);
  });

  it('carries players standing on a cap when the ring turns', () => {
    const sim = new MushroomSim(2, mulberry32(4));
    run(sim, untilCall);
    sim.omega = sim.omegaTo = 0.3;
    const t = 1;
    placeOnCap(sim, 0, t, 0.3, 0);
    for (let k = 0; k < 120; k++) {
      sim.players[1].x = 0;
      sim.players[1].z = 0;
      sim.step();
      if (sim.phase !== 'call') break;
    }
    const c = capPos(sim.L, sim.ring, t);
    expect(Math.hypot(sim.players[0].x - c.x, sim.players[0].z - c.z)).toBeLessThan(0.7);
  });
});

describe('fairness', () => {
  it('every target cap can be reached from the platform centre within the call time', () => {
    for (const n of [6, 7, 8]) {
      const L = makeLayout(n);
      expect(centreReachable(L, CALL_MIN_S)).toBe(true);
      // And with a good margin: at least a metre to spare at the shortest call.
      expect(walkReach(CALL_MIN_S) - L.ringR).toBeGreaterThan(1);
    }
  });

  it('holds in many seeded rounds, calls and twists, including for survivors', () => {
    let calls = 0;
    let swaps = 0;
    let twins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const players = 2 + (seed % 7);
      const sim = new MushroomSim(players, mulberry32(seed * 7919));
      const L = sim.L;
      // Survivors move to the called cap, others dawdle in the middle: the field thins out over the round.
      for (let guard = 0; guard < 120 / DT && !sim.ended && sim.phase !== 'over'; guard++) {
        for (const e of sim.step()) {
          if (e.t !== 'call') continue;
          calls++;
          if (e.swap) swaps++;
          if (e.twin !== null) twins++;
          // Time: the schedule (plus a swap bonus), reachable from the centre.
          expect(e.time).toBeGreaterThanOrEqual(callTimeFor(e.n) - 1e-9);
          expect(centreReachable(L, e.time)).toBe(true);
          const c = capPos(L, sim.ring, e.target);
          expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(walkReach(e.time));
          // The called colour is on the target cap, and the sign colour is a real mushroom.
          expect(sim.cur[e.target]).toBe(e.colour);
          expect(e.colour).toBeLessThan(L.n);
          // Everyone still in can get there (or some cap), counting the ring's turn.
          expect(sim.alive().every((i) => capReachableFrom(L, sim.ring, sim.omegaTo, e.target, sim.players[i].x, sim.players[i].z, e.time) || e.time > callTimeFor(e.n))).toBe(true);
        }
        // Everyone alive with a 70 % chance of walking to the target, the rest stay put.
        if (sim.phase === 'call') {
          for (const i of sim.alive()) {
            const c = capPos(L, sim.ring, sim.targetCap);
            const p = sim.players[i];
            const d = Math.hypot(c.x - p.x, c.z - p.z) || 1;
            sim.setInput(i, i % 3 === 0 ? 0 : (c.x - p.x) / d, i % 3 === 0 ? 0 : (c.z - p.z) / d);
          }
        } else for (const i of sim.alive()) sim.setInput(i, 0, 0);
      }
    }
    expect(calls).toBeGreaterThan(150);
    expect(swaps).toBeGreaterThan(0);
    expect(twins).toBeGreaterThan(0);
  }, 60_000);

  it('a bot that heads for the target straight away survives every call', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = new MushroomSim(4, mulberry32(seed));
      let calls = 0;
      for (let guard = 0; guard < 90 / DT && calls < 14 && !sim.ended; guard++) {
        for (const e of sim.step()) e.t === 'call' && calls++;
        const p = sim.players[0];
        if (sim.phase === 'call') {
          const c = capPos(sim.L, sim.ring, sim.targetCap);
          const d = Math.hypot(c.x - p.x, c.z - p.z);
          sim.setInput(0, d > 0.6 ? (c.x - p.x) / d : 0, d > 0.6 ? (c.z - p.z) / d : 0);
        } else sim.setInput(0, 0, 0);
        // The others stay on the platform, out of the way.
        for (const i of [1, 2, 3]) if (sim.players[i].alive) sim.players[i].x = sim.players[i].z = 0.3 * i;
      }
      expect(sim.players[0].alive).toBe(true);
    }
  }, 30_000);
});

describe('twists', () => {
  it('swap calls change the colour of the target cap, and keep the colours distinct', () => {
    let swaps = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new MushroomSim(3, mulberry32(seed + 500));
      let before = sim.cur.slice();
      for (let guard = 0; guard < 80 / DT && !sim.ended && sim.phase !== 'over'; guard++) {
        // Everyone stays on the called cap so the round goes on.
        if (sim.targetCap >= 0) for (let i = 0; i < 3; i++) placeOnCap(sim, i, sim.safe[0], (i - 1) * 0.6);
        if (sim.phase === 'gap') before = sim.base.slice();
        for (const e of sim.step()) {
          if (e.t !== 'call') continue;
          expect(e.n).toBeGreaterThan(2 * (e.swap ? 1 : 0));
          if (e.swap) {
            swaps++;
            expect(sim.cur[e.target]).not.toBe(before[e.target]);
            expect(new Set(sim.cur).size).toBe(sim.L.n);
          }
          if (e.twin !== null) {
            expect(e.twin).not.toBe(e.target);
            expect(sim.safe.sort()).toEqual([e.target, e.twin].sort());
            expect(sim.cur[e.twin]).toBe(sim.cur[e.target]);
          } else expect(sim.safe).toEqual([e.target]);
        }
      }
    }
    expect(swaps).toBeGreaterThan(0);
  }, 60_000);

  it('never swaps or doubles up in the first calls', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = new MushroomSim(2, mulberry32(seed));
      const calls = run(sim, (ev) => ev.some((e) => e.t === 'call' && e.n === 1)).filter((e) => e.t === 'call');
      expect(calls[0]).toMatchObject({ swap: false, twin: null });
    }
  });
});

describe('round end and points', () => {
  it('scores the number of players who fell in earlier, and +2 for the winner', () => {
    // 4 players: d falls first, then c, then a and b are left... a falls last of the fallen, b stays.
    const r = roundPoints([5000, null, 3000, 1000], [true, true, true, true]);
    expect(r.winner).toBe(1);
    expect(r.points).toEqual([2, 3 + WIN_BONUS, 1, 0]);
  });

  it('ties players who fall in together', () => {
    const r = roundPoints([2000, 2000, 1000, 1000], [true, true, true, true]);
    expect(r.winner).toBeNull();
    expect(r.points).toEqual([2, 2, 0, 0]);
  });

  it('everyone left falling in the same call is a tie without a bonus', () => {
    const r = roundPoints([4000, 4000, 4000], [true, true, true]);
    expect(r.winner).toBeNull();
    expect(r.points).toEqual([0, 0, 0]);
  });

  it('ignores players who left the game', () => {
    const r = roundPoints([1000, 2000, null], [true, false, true]);
    expect(r.points).toEqual([0, 0, 1 + WIN_BONUS]);
    expect(r.winner).toBe(2);
  });

  it('ends the round when one player is left and names the winner', () => {
    const sim = new MushroomSim(3, mulberry32(21));
    run(sim, untilCall);
    placeOnCap(sim, 0, sim.targetCap);
    sim.players[1].x = sim.players[1].z = 0;
    sim.players[2].x = 0.5;
    sim.players[2].z = 0;
    const ev = run(sim, (e) => e.some((x) => x.t === 'over'));
    expect(ev.some((e) => e.t === 'sink')).toBe(true);
    expect(sim.ended).toBe(true);
    expect(sim.winner).toBe(0);
    const res = sim.result();
    expect(res.winner).toBe(0);
    expect(res.points).toEqual([2 + WIN_BONUS, 0, 0]);
    expect(sim.phase).toBe('over');
  });

  it('ties when everyone left falls in the same call', () => {
    const sim = new MushroomSim(3, mulberry32(22));
    run(sim, untilCall);
    for (let i = 0; i < 3; i++) {
      sim.players[i].x = (i - 1) * 0.9;
      sim.players[i].z = 0;
    }
    run(sim, (e) => e.some((x) => x.t === 'over'));
    expect(sim.winner).toBeNull();
    expect(sim.alive()).toHaveLength(0);
    expect(sim.result().points).toEqual([0, 0, 0]);
  });

  it('keeps going while two or more are left, and the field thins', () => {
    const sim = new MushroomSim(4, mulberry32(23));
    run(sim, untilCall);
    placeOnCap(sim, 0, sim.targetCap, 0.4);
    placeOnCap(sim, 1, sim.targetCap, -0.4);
    sim.players[2].x = sim.players[3].x = 0;
    sim.players[2].z = sim.players[3].z = 0.2;
    run(sim, (e) => e.some((x) => x.t === 'rise'));
    expect(sim.ended).toBe(false);
    expect(sim.alive()).toEqual([0, 1]);
    const next = run(sim, untilCall);
    expect(next.some((e) => e.t === 'call' && e.n === 2)).toBe(true);
    // Fallen players score the number who fell before them: both fell together, so 0.
    expect(sim.result().points).toEqual([2, 2, 0, 0]);
  });

  it('ends a round by a shove that sends the second to last player in, scoring them in order', () => {
    const sim = new MushroomSim(3, mulberry32(24));
    run(sim, untilCall);
    // Player 2 falls in the first sink; then 1 is shoved off; 0 wins.
    placeOnCap(sim, 0, sim.targetCap, 0.3);
    placeOnCap(sim, 1, sim.targetCap, -0.3);
    sim.players[2].x = sim.players[2].z = 0;
    run(sim, (e) => e.some((x) => x.t === 'rise'));
    expect(sim.alive()).toEqual([0, 1]);
    // Take the next call and shove 1 off the outer rim.
    run(sim, untilCall);
    sim.omega = sim.omegaTo = 0;
    const c = capPos(sim.L, sim.ring, sim.targetCap);
    const out = Math.atan2(c.z, c.x);
    const rim = sim.L.ringR + sim.L.capHit;
    sim.players[1].x = Math.cos(out) * (rim - 0.45);
    sim.players[1].z = Math.sin(out) * (rim - 0.45);
    sim.players[0].x = Math.cos(out) * (rim - 1.5);
    sim.players[0].z = Math.sin(out) * (rim - 1.5);
    sim.setInput(0, Math.cos(out), Math.sin(out));
    sim.queueShove(0);
    run(sim, (e) => e.some((x) => x.t === 'over'), 3);
    expect(sim.winner).toBe(0);
    expect(sim.result().points).toEqual([2 + WIN_BONUS, 1, 0]);
  });

  it('stops a round that goes on too long', () => {
    expect(MAX_CALLS).toBeGreaterThan(10);
  });

  it('lets the fallen swim to the bank', () => {
    const sim = new MushroomSim(2, mulberry32(30));
    run(sim, untilCall);
    sim.players[0].x = sim.players[0].z = 0;
    run(sim, (e) => e.some((x) => x.t === 'over'));
    for (let k = 0; k < 20 / DT; k++) sim.step();
    expect(sim.players.every((p) => p.alive || p.onBank)).toBe(true);
    const out = sim.players.find((p) => !p.alive)!;
    expect(Math.abs(out.x)).toBeGreaterThan(12);
  });

  it('removing a player can end the round', () => {
    const sim = new MushroomSim(2, mulberry32(31));
    run(sim, untilCall);
    const ev = sim.remove(1);
    expect(ev.some((e) => e.t === 'over')).toBe(true);
    expect(sim.winner).toBe(0);
  });
});

describe('short version', () => {
  it('plays one round instead of three', () => {
    expect(MUSH_ROUNDS).toBe(3);
    expect(MUSH_ROUNDS_SHORT).toBe(1);
  });

  it('has three short how-to-play sentences either way', () => {
    for (const short of [true, false]) {
      const steps = howTo(short);
      expect(steps).toHaveLength(3);
      steps.forEach((s) => expect(s.length).toBeLessThan(140));
    }
    expect(howTo(true)).not.toEqual(howTo(false));
  });
});
