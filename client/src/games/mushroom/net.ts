/**
 * Grzybki without a TV: the snapshot the host phone sends ~15 times a second, and how a phone
 * puts it back into a MushroomSim for the scene to draw. No three.js here (the host needs it too).
 *
 * Layout of `s`: [phase, ring, callLeft, targetColour, platDown, callNo, safe (bitmask), caps,
 * cur × caps, capDown × caps, then per player (MUSH_STRIDE): x, z, vx, vz, face, flags, fallT].
 * vx/vz are the walking and knock-back velocities added up (the scene only needs the speed).
 */
import { lerpAngle, rnd } from '../arena/net';
import type { MushroomSim, Phase } from './logic';

const PHASES: readonly Phase[] = ['ready', 'gap', 'call', 'sink', 'rise', 'over'];
const HEAD = 8;
export const MUSH_STRIDE = 7;
const F = { present: 1, alive: 2, swimming: 4, onBank: 8, fell: 16 } as const;

export function encode(sim: MushroomSim): number[] {
  const n = sim.L.n;
  const s = [
    PHASES.indexOf(sim.phase),
    rnd(sim.ring, 1000),
    rnd(sim.callLeft),
    sim.targetColour,
    rnd(sim.platDown),
    sim.callNo,
    sim.safe.reduce((m, i) => m | (1 << i), 0),
    n,
  ];
  for (let i = 0; i < n; i++) s.push(sim.cur[i]);
  for (let i = 0; i < n; i++) s.push(rnd(sim.capDown[i]));
  for (const p of sim.players) {
    const flags =
      (p.present ? F.present : 0) | (p.alive ? F.alive : 0) | (p.swimming ? F.swimming : 0) | (p.onBank ? F.onBank : 0) | (p.fellAt !== null ? F.fell : 0);
    s.push(rnd(p.x), rnd(p.z), rnd(p.vx + p.kx, 10), rnd(p.vz + p.kz, 10), rnd(p.face, 100), flags, rnd(p.fallT));
  }
  return s;
}

/** Put the arena `k` of the way from snapshot `a` to snapshot `b` into `sim`. */
export function apply(sim: MushroomSim, a: number[], b: number[], k: number) {
  const n = a[7];
  if (n !== sim.L.n || b[7] !== n) return;
  const lerp = (o: number) => a[o] + (b[o] - a[o]) * k;
  // Discrete things switch at the halfway point, so they line up with the movement.
  const d = k < 0.5 ? a : b;
  sim.phase = PHASES[d[0]] ?? 'gap';
  sim.ring = lerp(1);
  sim.callLeft = lerp(2);
  sim.targetColour = d[3];
  sim.platDown = lerp(4);
  sim.callNo = d[5];
  sim.safe = [];
  for (let i = 0; i < n; i++) if (d[6] & (1 << i)) sim.safe.push(i);
  for (let i = 0; i < n; i++) {
    sim.cur[i] = d[HEAD + i];
    sim.capDown[i] = lerp(HEAD + n + i);
  }
  const base = HEAD + 2 * n;
  sim.players.forEach((p, i) => {
    const o = base + i * MUSH_STRIDE;
    if (a.length < o + MUSH_STRIDE || b.length < o + MUSH_STRIDE) return;
    const flags = d[o + 5];
    p.present = !!(flags & F.present);
    p.alive = !!(flags & F.alive);
    p.swimming = !!(flags & F.swimming);
    p.onBank = !!(flags & F.onBank);
    // The scene only asks whether they fell, not when.
    p.fellAt = flags & F.fell ? 0 : null;
    // A big jump (a swimmer set down on the bank, a new round) shouldn't be smeared across it.
    const jump = Math.hypot(b[o] - a[o], b[o + 1] - a[o + 1]) > 3;
    const kk = jump ? (k < 0.5 ? 0 : 1) : k;
    p.x = a[o] + (b[o] - a[o]) * kk;
    p.z = a[o + 1] + (b[o + 1] - a[o + 1]) * kk;
    p.vx = lerp(o + 2);
    p.vz = lerp(o + 3);
    p.kx = p.kz = 0;
    p.face = lerpAngle(a[o + 4], b[o + 4], k);
    p.fallT = b[o + 6] >= a[o + 6] ? lerp(o + 6) : d[o + 6];
  });
}
