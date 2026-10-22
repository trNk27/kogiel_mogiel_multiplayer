import { describe, expect, it } from 'vitest';
import {
  ChairsSim,
  DT,
  FAKE_FROM,
  FAKE_S,
  MUSIC_MAX,
  MUSIC_MIN,
  OUT_S,
  SCRAMBLE_S,
  SETUP_S,
  SIT_R,
  SOLO_STOPS,
  STUN_S,
  WAIT_S,
  chairsFor,
  howTo,
  keepRadius,
  musicPlan,
  ringLayout,
  ringRadius,
  type ChairsEvent,
  type ChairsInput,
  type MusicPlan,
} from '../client/src/games/chairs/logic';
import { mulberry32 } from '../client/src/games/rng';

type Ctl = (i: number, sim: ChairsSim) => Partial<ChairsInput>;

function run(sim: ChairsSim, seconds: number, ctl: Ctl = () => ({})) {
  const all: ChairsEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const inputs = sim.players.map((_, i) => ({ x: 0, z: 0, sit: 0, ...ctl(i, sim) }));
    all.push(...sim.step(inputs));
  }
  return all;
}

/** Run until an event of type `t` (or give up after `max` seconds). */
function until(sim: ChairsSim, t: ChairsEvent['t'], ctl: Ctl = () => ({}), max = 60) {
  const all: ChairsEvent[] = [];
  for (let k = 0; k < Math.round(max / DT); k++) {
    const inputs = sim.players.map((_, i) => ({ x: 0, z: 0, sit: 0, ...ctl(i, sim) }));
    const ev = sim.step(inputs);
    all.push(...ev);
    if (ev.some((e) => e.t === t)) break;
  }
  return all;
}

const fixed =
  (dur: number, fakes: number[] = []) =>
  (): MusicPlan => ({ dur, fakes });

/** A player who walks straight to the nearest free chair and sits as soon as the music stops. */
function seeker(who: (i: number) => boolean = () => true): Ctl {
  return (i, sim) => {
    if (!who(i) || sim.phase !== 'scramble') return {};
    const p = sim.players[i];
    if (!p.alive || p.seat >= 0) return {};
    let best = sim.chairs[0];
    let bd = Infinity;
    for (const c of sim.chairs) {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (c.by < 0 && d < bd) {
        bd = d;
        best = c;
      }
    }
    if (!best) return {};
    const dx = best.x - p.x;
    const dz = best.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l, sit: 1 };
  };
}

describe('the ring', () => {
  it('has one chair fewer than the players still in (one when playing alone)', () => {
    expect(chairsFor(8)).toBe(7);
    expect(chairsFor(2)).toBe(1);
    expect(chairsFor(1)).toBe(1);
    expect(chairsFor(1, true)).toBe(1);
    expect(chairsFor(5, true)).toBe(1);
  });
  it('lays the chairs out in a ring facing outwards, apart from each other', () => {
    for (let n = 1; n <= 7; n++) {
      const spots = ringLayout(n);
      expect(spots).toHaveLength(n);
      for (const s of spots) {
        expect(Math.hypot(s.x, s.z)).toBeCloseTo(ringRadius(n), 5);
        if (n > 1) expect(Math.cos(s.a) * s.x + Math.sin(s.a) * s.z).toBeGreaterThan(0);
      }
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) expect(Math.hypot(spots[a].x - spots[b].x, spots[a].z - spots[b].z)).toBeGreaterThan(1.2);
    }
    expect(ringLayout(1)[0]).toMatchObject({ x: 0, z: 0 });
  });
  it('starts each stop with one chair fewer', () => {
    const sim = new ChairsSim(5, { rng: mulberry32(1), plan: fixed(3) });
    expect(sim.chairs).toHaveLength(4);
    sim.begin();
    const counts: number[] = [];
    for (let s = 0; s < 4; s++) {
      const ev = until(sim, 'music', seeker());
      const m = ev.find((e) => e.t === 'music');
      if (m && m.t === 'music') counts.push(m.chairs);
      until(sim, 'out', seeker());
    }
    expect(counts).toEqual([4, 3, 2, 1]);
    run(sim, OUT_S + 0.1);
    expect(sim.phase).toBe('done');
    expect(sim.aliveCount).toBe(1);
  });
});

describe('the music', () => {
  it('plays for 6–14 s, with fake-outs only from the third stop, well inside the tune', () => {
    const rng = mulberry32(7);
    let fakes = 0;
    for (let k = 0; k < 500; k++) {
      const n = 1 + (k % 8);
      const p = musicPlan(n, rng);
      expect(p.dur).toBeGreaterThanOrEqual(MUSIC_MIN);
      expect(p.dur).toBeLessThanOrEqual(MUSIC_MAX);
      if (n < FAKE_FROM) expect(p.fakes).toEqual([]);
      for (const f of p.fakes) {
        expect(f).toBeGreaterThanOrEqual(2);
        expect(f + FAKE_S).toBeLessThanOrEqual(p.dur - 2 + 1e-9);
      }
      fakes += p.fakes.length;
    }
    expect(fakes).toBeGreaterThan(50);
  });
  it('a fake-out pauses the music for a moment, then it carries on', () => {
    const sim = new ChairsSim(3, { rng: mulberry32(1), plan: fixed(6, [2]) });
    sim.begin();
    run(sim, WAIT_S + 2 + DT * 3);
    expect(sim.phase).toBe('music');
    expect(sim.musicOn).toBe(false);
    const ev = run(sim, FAKE_S);
    expect(ev).toContainEqual({ t: 'fake', on: false });
    expect(sim.musicOn).toBe(true);
    expect(sim.phase).toBe('music');
    const ev2 = until(sim, 'stop');
    expect(ev2.find((e) => e.t === 'stop')).toEqual({ t: 'stop', n: 1 });
    expect(sim.phaseT).toBeLessThan(DT * 2);
  });
});

describe('sitting', () => {
  it('pressing SIT while the music plays trips you for a while', () => {
    const sim = new ChairsSim(3, { rng: mulberry32(1), plan: fixed(8) });
    sim.begin();
    run(sim, WAIT_S + 1);
    const ev = run(sim, DT, (i) => (i === 0 ? { sit: 1 } : {}));
    expect(ev).toContainEqual({ t: 'trip', i: 0, fake: false });
    const p = sim.players[0];
    expect(p.stun).toBeGreaterThan(STUN_S - 0.05);
    // Lying on the floor: the stick does nothing and more presses don't trip you again.
    const x = p.x;
    const z = p.z;
    const ev2 = run(sim, 0.5, (i) => (i === 0 ? { x: 1, sit: 1 } : {}));
    expect(ev2.filter((e) => e.t === 'trip')).toHaveLength(0);
    expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(0.3);
    run(sim, STUN_S);
    expect(p.stun).toBe(0);
    expect(p.trips).toBe(1);
  });
  it('sitting during a fake-out trips you too', () => {
    const sim = new ChairsSim(3, { rng: mulberry32(1), plan: fixed(8, [3]) });
    sim.begin();
    run(sim, WAIT_S + 3 + 0.2);
    expect(sim.fakeT).toBeGreaterThan(0);
    const ev = run(sim, DT, (i) => (i === 1 ? { sit: 1 } : {}));
    expect(ev).toContainEqual({ t: 'trip', i: 1, fake: true });
  });
  it('a trip just before the stop costs you the race', () => {
    const sim = new ChairsSim(2, { rng: mulberry32(1), plan: fixed(4) });
    sim.begin();
    run(sim, WAIT_S + 4 - 0.3, (i, s) => (i === 0 && s.phaseT > 3.5 && s.phase === 'music' ? { sit: 1 } : {}));
    expect(sim.players[0].stun).toBeGreaterThan(0);
    const ev = until(sim, 'out', seeker());
    expect(ev.find((e) => e.t === 'sit')).toMatchObject({ i: 1 });
    expect(sim.players[0].outAt).toBe(1);
  });
  it('only works within reach of a free chair, once the music has stopped', () => {
    const sim = new ChairsSim(3, { rng: mulberry32(2), plan: fixed(2) });
    sim.begin();
    until(sim, 'stop');
    // Everybody starts on the track, out of reach.
    for (const p of sim.players) expect(sim.nearestFree(p)).toBeNull();
    const ev = run(sim, DT, () => ({ sit: 1 }));
    expect(ev.filter((e) => e.t === 'sit' || e.t === 'trip')).toHaveLength(0);
    // Put player 0 next to a chair.
    const c = sim.chairs[0];
    sim.players[0].x = c.x + Math.cos(c.a) * (SIT_R - 0.1);
    sim.players[0].z = c.z + Math.sin(c.a) * (SIT_R - 0.1);
    const ev2 = run(sim, DT, (i) => (i === 0 ? { sit: 1 } : {}));
    expect(ev2).toContainEqual({ t: 'sit', i: 0, chair: c.id });
    expect(c.by).toBe(0);
    expect(sim.players[0].seat).toBe(c.id);
  });
  it('first come, first seated: in a dead heat the closer one wins, the other takes nothing', () => {
    const sim = new ChairsSim(3, { rng: mulberry32(2), plan: fixed(2) });
    sim.begin();
    until(sim, 'stop');
    const c = sim.chairs[0];
    const ox = Math.cos(c.a);
    const oz = Math.sin(c.a);
    // Player 2 is a little closer than player 1; both press on the same frame.
    sim.players[1].x = c.x + ox * 0.9 - oz * 0.2;
    sim.players[1].z = c.z + oz * 0.9 + ox * 0.2;
    sim.players[2].x = c.x + ox * 0.8 + oz * 0.2;
    sim.players[2].z = c.z + oz * 0.8 - ox * 0.2;
    const ev = run(sim, DT, (i) => (i > 0 ? { sit: 1 } : {}));
    expect(ev.filter((e) => e.t === 'sit')).toEqual([{ t: 'sit', i: 2, chair: c.id }]);
    expect(sim.players[1].seat).toBe(-1);
    // Later presses can't take a taken chair either.
    const ev2 = run(sim, DT, (i) => (i === 1 ? { sit: 1 } : {}));
    expect(ev2.filter((e) => e.t === 'sit')).toHaveLength(0);
    expect(c.by).toBe(2);
  });
  it('keeps walkers outside the ring while the music plays, and lets them in when it stops', () => {
    const sim = new ChairsSim(4, { rng: mulberry32(3), plan: fixed(9) });
    sim.begin();
    // Everybody pushes towards the middle.
    const inward: Ctl = (i, s) => {
      const p = s.players[i];
      const r = Math.hypot(p.x, p.z) || 1;
      return { x: -p.x / r, z: -p.z / r };
    };
    run(sim, WAIT_S + 4, inward);
    const keep = keepRadius(sim.chairs.length);
    for (const p of sim.players) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(keep - 0.6);
    until(sim, 'stop', inward);
    run(sim, 1, inward);
    expect(Math.min(...sim.players.map((p) => Math.hypot(p.x, p.z)))).toBeLessThan(keep - 0.6);
  });
  it('the crowd flows round the ring while the music plays', () => {
    const sim = new ChairsSim(2, { rng: mulberry32(3), plan: fixed(10) });
    sim.begin();
    const a0 = Math.atan2(sim.players[0].z, sim.players[0].x);
    run(sim, WAIT_S + 2);
    const a1 = Math.atan2(sim.players[0].z, sim.players[0].x);
    expect(Math.abs(a1 - a0)).toBeGreaterThan(0.3);
  });
});

describe('going out', () => {
  it('the one left standing is out; the order of stops sets the score', () => {
    const sim = new ChairsSim(4, { rng: mulberry32(4), plan: fixed(2.5) });
    sim.begin();
    // Player 3 never sits, then player 0 stops trying, then player 1.
    const order: number[][] = [];
    const ctl: Ctl = (i, s) => {
      const lazy = i === 3 || (i === 0 && s.n >= 2) || (i === 1 && s.n >= 3);
      return lazy ? {} : seeker()(i, s);
    };
    for (let k = 0; k < 3; k++) {
      const ev = until(sim, 'out', ctl);
      const o = ev.find((e) => e.t === 'out');
      if (o && o.t === 'out') {
        order.push(o.idx);
        expect(o.timeout).toBe(false);
      }
    }
    expect(order).toEqual([[3], [0], [1]]);
    expect(sim.players.map((p) => p.outAt)).toEqual([2, 3, null, 1]);
    const ev = run(sim, OUT_S + DT);
    expect(ev).toContainEqual({ t: 'over' });
    const r = sim.results();
    expect(r.winners).toEqual([2]);
    expect(r.points).toEqual([1, 2, 5, 0]);
  });
  it('if nobody takes the last chair in time, everybody standing is out together', () => {
    const sim = new ChairsSim(3, { rng: mulberry32(4), plan: fixed(2) });
    sim.begin();
    // Stop 1: one sits, the other... nobody else bothers: the second chair stays free.
    const ev = until(sim, 'out', seeker((i) => i === 0));
    const o = ev.find((e) => e.t === 'out');
    expect(o).toMatchObject({ t: 'out', n: 1, idx: [1, 2], timeout: true });
    expect(sim.phaseT).toBeLessThan(DT * 2);
    const stop = ev.findIndex((e) => e.t === 'stop');
    expect(stop).toBeGreaterThanOrEqual(0);
    run(sim, OUT_S + DT);
    expect(sim.phase).toBe('done');
    expect(sim.results().winners).toEqual([0]);
    expect(sim.results().points).toEqual([4, 0, 0]);
  });
  it('the scramble lasts SCRAMBLE_S at most, and a tie of everybody shares the win', () => {
    const sim = new ChairsSim(2, { rng: mulberry32(4), plan: fixed(2) });
    sim.begin();
    until(sim, 'stop');
    const t = sim.time;
    until(sim, 'out');
    expect(sim.time - t).toBeCloseTo(SCRAMBLE_S, 1);
    expect(sim.players.map((p) => p.outAt)).toEqual([1, 1]);
    run(sim, OUT_S + DT);
    expect(sim.results().winners).toEqual([0, 1]);
    expect(sim.results().points).toEqual([2, 2]);
  });
  it('gets everybody up and takes a chair away between stops', () => {
    const sim = new ChairsSim(4, { rng: mulberry32(5), plan: fixed(2) });
    sim.begin();
    until(sim, 'out', seeker());
    const ev = until(sim, 'setup');
    const s = ev.find((e) => e.t === 'setup');
    expect(s && s.t === 'setup' && s.removed).toHaveLength(1);
    expect(sim.chairs).toHaveLength(2);
    expect(sim.chairs.every((c) => c.by < 0)).toBe(true);
    expect(sim.players.every((p) => p.seat < 0)).toBe(true);
    run(sim, SETUP_S + DT);
    expect(sim.phase).toBe('music');
    expect(sim.n).toBe(2);
  });
});

describe('leaving', () => {
  it('mid-scramble: a free chair goes too, so somebody is still left standing', () => {
    const sim = new ChairsSim(4, { rng: mulberry32(6), plan: fixed(2) });
    sim.begin();
    until(sim, 'stop');
    expect(sim.chairs).toHaveLength(3);
    sim.remove(3);
    expect(sim.chairs).toHaveLength(2);
    const ev = until(sim, 'out', seeker());
    const o = ev.find((e) => e.t === 'out');
    expect(o && o.t === 'out' && o.idx).toHaveLength(1);
    expect(sim.players[3].outAt).toBeNull();
    expect(sim.results().points[3]).toBe(0);
  });
  it('a seated player leaving takes their chair with them', () => {
    const sim = new ChairsSim(4, { rng: mulberry32(6), plan: fixed(2) });
    sim.begin();
    until(sim, 'stop');
    const c = sim.chairs[0];
    sim.players[0].x = c.x + Math.cos(c.a) * 0.5;
    sim.players[0].z = c.z + Math.sin(c.a) * 0.5;
    run(sim, DT, (i) => (i === 0 ? { sit: 1 } : {}));
    expect(sim.players[0].seat).toBe(c.id);
    sim.remove(0);
    expect(sim.chairs.find((q) => q.id === c.id)).toBeUndefined();
    expect(sim.chairs).toHaveLength(2);
  });
  it('when the last standing rival leaves during the scramble, the stop ends with nobody out', () => {
    const sim = new ChairsSim(3, { rng: mulberry32(6), plan: fixed(2) });
    sim.begin();
    until(sim, 'stop');
    // 0 sits; 1 leaves; 2 is alone with... chairs trimmed to 1 and 0 has it: the round is over.
    const c = sim.chairs[0];
    sim.players[0].x = c.x + Math.cos(c.a) * 0.5;
    sim.players[0].z = c.z + Math.sin(c.a) * 0.5;
    run(sim, DT, (i) => (i === 0 ? { sit: 1 } : {}));
    sim.remove(1);
    const ev = run(sim, DT);
    expect(ev.find((e) => e.t === 'out')).toMatchObject({ idx: [2], timeout: false });
  });
  it('ends the round when only one is left', () => {
    const sim = new ChairsSim(2, { rng: mulberry32(6), plan: fixed(5) });
    sim.begin();
    run(sim, 1);
    sim.remove(1);
    const ev = run(sim, DT);
    expect(ev).toContainEqual({ t: 'over' });
    expect(sim.results().winners).toEqual([0]);
    expect(sim.results().points).toEqual([2, 0]);
  });
  it('during the music, the ring closes up to one chair fewer', () => {
    const sim = new ChairsSim(5, { rng: mulberry32(6), plan: fixed(5) });
    sim.begin();
    run(sim, 1);
    sim.remove(4);
    expect(sim.chairs).toHaveLength(3);
  });
  it('starts without the players who already left', () => {
    const sim = new ChairsSim(4, { rng: mulberry32(6), gone: [false, true, false, false] });
    expect(sim.chairs).toHaveLength(2);
    expect(sim.aliveCount).toBe(3);
  });
});

describe('on your own', () => {
  it('one chair, five stops, scoring how far you got', () => {
    const sim = new ChairsSim(1, { rng: mulberry32(8), plan: fixed(2) });
    expect(sim.solo).toBe(true);
    expect(sim.chairs).toHaveLength(1);
    sim.begin();
    for (let k = 0; k < SOLO_STOPS; k++) until(sim, 'out', seeker());
    run(sim, OUT_S + DT);
    expect(sim.phase).toBe('done');
    expect(sim.results().points).toEqual([SOLO_STOPS]);
  });
  it('missing the chair ends it', () => {
    const sim = new ChairsSim(1, { rng: mulberry32(8), plan: fixed(2) });
    sim.begin();
    until(sim, 'out', seeker());
    until(sim, 'out');
    run(sim, OUT_S + DT);
    expect(sim.phase).toBe('done');
    expect(sim.results().points).toEqual([1]);
  });
});

it('has a three-line how-to', () => {
  expect(howTo(false)).toHaveLength(3);
  expect(howTo(true)).toHaveLength(3);
  expect(howTo(true)[2]).toMatch(/One round/);
  expect(howTo(false)[2]).toMatch(/Two rounds/);
});
