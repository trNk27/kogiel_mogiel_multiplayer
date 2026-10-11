/**
 * Pushy Pierogi without a TV: the snapshot the host phone sends ~15 times a second, and how a phone
 * puts it back into a PushySim for the scene to draw. No three.js here (the host needs it too).
 *
 * Every phone builds the same floe from the round's seed, and the floe cracks on a fixed schedule,
 * so the ice itself is never sent: phones crack and sink chunks as the sim clock passes their time.
 *
 * Layout of `s`: [t, flags (live 1, over 2), players, then per player (PUSHY_STRIDE): x, z, vx, vz,
 * face, flags (FF), then per stone on the ice (STONE_STRIDE): id, x, z, dx, dz, sx, sz, running, spin].
 */
import { lerpAngle, rnd } from '../arena/net';
import type { PushyEvent, PushySim, Stone } from './logic';

export const PUSHY_STRIDE = 6;
export const STONE_STRIDE = 9;
const FF = { alive: 1, removed: 2, braced: 4, dashing: 8, fell: 16 } as const;

/** The events a phone needs (cracks and breaks it works out itself; the rest is the host's business). */
export function forwardEvent(e: PushyEvent): boolean {
  return e.k !== 'crack' && e.k !== 'break';
}

export function encode(sim: PushySim): number[] {
  const s = [rnd(sim.t), (sim.live ? 1 : 0) | (sim.over ? 2 : 0), sim.players.length];
  sim.players.forEach((p, i) => {
    const flags =
      (p.alive ? FF.alive : 0) |
      (p.removed ? FF.removed : 0) |
      (sim.isBraced(i) ? FF.braced : 0) |
      (sim.isDashing(i) ? FF.dashing : 0) |
      (p.fellTick !== null ? FF.fell : 0);
    s.push(rnd(p.x), rnd(p.z), rnd(p.vx, 10), rnd(p.vz, 10), rnd(p.face), flags);
  });
  for (const st of sim.stones) {
    if (st.done) continue;
    s.push(st.id, rnd(st.x), rnd(st.z), rnd(st.dx, 1000), rnd(st.dz, 1000), rnd(st.sx), rnd(st.sz), st.running ? 1 : 0, rnd(st.spin));
  }
  return s;
}

/** Stones in a snapshot, by id: where `at` their numbers start. */
function stonesIn(s: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let o = 3 + s[2] * PUSHY_STRIDE; o + STONE_STRIDE <= s.length; o += STONE_STRIDE) m.set(s[o], o);
  return m;
}

/**
 * Put the arena `k` of the way from snapshot `a` to snapshot `b` into `sim`. Returns the scene
 * events this implies (chunks cracking and breaking as the clock passes them).
 */
export function apply(sim: PushySim, a: number[], b: number[], k: number): PushyEvent[] {
  const ev: PushyEvent[] = [];
  const n = sim.players.length;
  if (a[2] !== n || b[2] !== n) return ev;
  const d = k < 0.5 ? a : b;
  sim.t = b[0] >= a[0] ? a[0] + (b[0] - a[0]) * k : d[0];
  sim.live = !!(d[1] & 1);
  sim.over = !!(d[1] & 2);
  for (let i = 0; i < n; i++) {
    const o = 3 + i * PUSHY_STRIDE;
    const p = sim.players[i];
    const flags = d[o + 5];
    p.alive = !!(flags & FF.alive);
    p.removed = !!(flags & FF.removed);
    p.fellTick = flags & FF.fell ? 0 : null;
    // isBraced / isDashing compare these with the clock.
    p.braceUntil = flags & FF.braced ? Infinity : -1;
    p.dashUntil = flags & FF.dashing ? Infinity : -1;
    const jump = Math.hypot(b[o] - a[o], b[o + 1] - a[o + 1]) > 3;
    const kk = jump ? (k < 0.5 ? 0 : 1) : k;
    p.x = a[o] + (b[o] - a[o]) * kk;
    p.z = a[o + 1] + (b[o + 1] - a[o + 1]) * kk;
    p.vx = a[o + 2] + (b[o + 2] - a[o + 2]) * k;
    p.vz = a[o + 3] + (b[o + 3] - a[o + 3]) * k;
    p.face = lerpAngle(a[o + 4], b[o + 4], k);
  }

  // Stones: the ones in the snapshot are on the ice, any others are done.
  const sa = stonesIn(a);
  const sb = stonesIn(b);
  const seen = new Set<number>();
  for (const [id, ob] of sb) {
    const oa = sa.get(id);
    const src = d === a && oa !== undefined ? a : b;
    const o = src === a ? oa! : ob;
    let st: Stone | undefined = sim.stones.find((x) => x.id === id);
    if (!st) {
      st = { id, x: 0, z: 0, dx: 0, dz: 0, sx: 0, sz: 0, launchAt: 0, running: false, done: false, spin: 0 };
      sim.stones.push(st);
    }
    seen.add(id);
    st.dx = src[o + 3];
    st.dz = src[o + 4];
    st.sx = src[o + 5];
    st.sz = src[o + 6];
    st.running = !!src[o + 7];
    st.done = false;
    if (oa !== undefined && a[oa + 7] && b[ob + 7]) {
      st.x = a[oa + 1] + (b[ob + 1] - a[oa + 1]) * k;
      st.z = a[oa + 2] + (b[ob + 2] - a[oa + 2]) * k;
      st.spin = a[oa + 8] + (b[ob + 8] - a[oa + 8]) * k;
    } else {
      st.x = src[o + 1];
      st.z = src[o + 2];
      st.spin = src[o + 8];
    }
  }
  for (const st of sim.stones) if (!seen.has(st.id) && !(k < 0.5 && sa.has(st.id))) st.done = true;

  // The ice cracks on the round's schedule, the same on every phone.
  for (const c of sim.chunks) {
    if (c.state === 0 && sim.t >= c.crackAt) {
      c.state = 1;
      ev.push({ k: 'crack', c: c.id });
    }
    if (c.state === 1 && sim.t >= c.breakAt) {
      c.state = 2;
      ev.push({ k: 'break', c: c.id });
    }
  }
  return ev;
}
