/**
 * Przystań (the marina): pure simulation. No DOM, no three.js.
 *
 * Everyone starts on open water at the near side of the harbour and has to park their little
 * motorboat in their own berth (painted on the water in their colour) by the quay at the far side.
 * A boat counts as parked when its whole hull is inside its berth's lines and it has (nearly)
 * stopped, held for DOCK_HOLD seconds. First to park scores most, then one after another, with
 * small bonuses for parking straight and centred and for not bumping into anything.
 *
 * World units are metres, y is up; the sim is 2D in x/z. The camera looks from +z, so the quay is
 * at the top of the TV (−z) and the boats start at the bottom (+z).
 *
 * A boat's heading `a` is measured so that its bow points along f = (sin a, cos a) (like the
 * pierogi's `face` in the other arena games: three.js `rotation.y = a` turns a model that faces +z
 * the same way). Starboard (the boat's right) is r = (−cos a, sin a). Increasing `a` turns to port.
 */
import type { Rng } from '../rng';

export const DT = 1 / 60;
/** Physics substeps per tick (collisions are checked on each), so nothing can tunnel. */
export const SUBSTEPS = 2;

export const MARINA_ROUNDS = 3;
export const MARINA_ROUNDS_SHORT = 1;
/** The tournament's single round is played on this level (turn-in berths, no wind). */
export const SHORT_LEVEL = 1;

// ---- the harbour --------------------------------------------------------------------------------
/** Open water spans x ∈ [−HALF_W, HALF_W] and z ∈ [QUAY_Z, SHORE_Z]. */
export const HALF_W = 31;
export const QUAY_Z = -17;
export const SHORE_Z = 13.5;
/** Boats start in a row here, bows towards the quay. */
export const START_Z = 8.5;
/** Pontoon fingers between berths are this wide; the jetty this wide. */
export const FINGER_W = 0.5;
export const JETTY_W = 2.2;

// ---- the boat -----------------------------------------------------------------------------------
export const BOAT_LEN = 4.2;
export const BOAT_BEAM = 1.8;
export const BOAT_HL = BOAT_LEN / 2;
export const BOAT_HW = BOAT_BEAM / 2;
/** Mass is 1 (forces are accelerations); the hull's moment of inertia about its middle. */
export const BOAT_I = (BOAT_LEN * BOAT_LEN + BOAT_BEAM * BOAT_BEAM) / 12;

/** Handling. Accelerations in m/s², drags in 1/s (linear) and 1/m (quadratic), yaw in rad. */
export const TUNING = {
  /** Full throttle ahead / astern. Astern is weaker: it's the brake. */
  thrustAhead: 3.9,
  thrustAstern: 2.5,
  /** Drag along the keel (low: the boat glides when you let go) … */
  surgeDrag1: 0.4,
  surgeDrag2: 0.06,
  /** … more of it going backwards (the transom pushes water) … */
  asternDrag: 1.6,
  /**
   * … plus a "harbour" drag that only matters slowly (extra 1/s, fading out by about this speed): the
   * boat glides at speed, but once it's crawling it settles in a second instead of drifting on, so a
   * coarse phone stick can still creep it into the box and stop.
   */
  harbourDrag: 1.2,
  harbourV: 0.8,
  /** … and a lot sideways, so the hull carves. */
  swayDrag1: 2.4,
  swayDrag2: 1.4,
  /** How fast the keel turns sideways drift into forward motion (1/s, at full effect). */
  keelGrip: 2.2,
  /** Yaw acceleration per m/s of water over the rudder, at full rudder. */
  rudder: 0.6,
  /** Going astern the rudder works backwards and only this well. */
  rudderAstern: 0.45,
  /** Extra flow over the rudder from the propeller at full throttle ahead, from a standstill (m/s). */
  propWash: 3.2,
  /** The prop wash fades out by this speed (the rudder already gets the flow). */
  washFade: 4,
  /** The rudder's side force swings the stern out (sway accel per m/s of flow). */
  rudderKick: 0.12,
  /** Yaw damping: angular inertia carries a turn on a little after you centre the stick. */
  yawDrag1: 2.3,
  yawDrag2: 0.5,
  /** How fast the engine and the rudder follow the stick (per second). */
  throttleRate: 4,
  rudderRate: 6,
  maxSpeed: 8,
  maxYaw: 3,
  /** Bounces: soft, with a little friction along the contact. */
  restitution: 0.25,
  friction: 0.3,
};

// ---- docking & scoring ------------------------------------------------------------------------
/** Parked: all four corners inside the lines, slower than this, turning slower than this … */
export const DOCK_SPEED = 0.3;
export const DOCK_YAW = 0.3;
/** … for this long. Once the hold has started it carries on up to this much faster (no flicker at the threshold) … */
export const DOCK_HOLD = 0.9;
export const DOCK_SLACK = 1.4;
/** … and a slip (a corner over the line, a nudge) eats into it at this many times the rate rather than wiping it. */
export const HOLD_DECAY = 3;
/** An impact this fast (m/s along the contact) costs the clean bonus … */
export const TOUCH_V = 0.5;
/** … and this fast is a hard bump: a point off. */
export const BUMP_V = 1.5;
/** The same two things can't bump again within this many seconds. */
export const BUMP_COOLDOWN = 0.6;
/** When only one boat is still out, the clock is cut to this. */
export const LAST_BOAT_S = 20;
/** Horn cooldown (s). */
export const HORN_S = 0.8;

/** Points for parking 1st, 2nd, 3rd… (8th and beyond: 1). */
export const PLACE_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
/** Up to this many points each for parking centred and for parking straight. */
export const QUALITY_POINTS = 2;
/** For a clean round: no knocks into anything. */
export const CLEAN_POINTS = 2;
/** Each hard bump costs a point, at most this many. */
export const MAX_BUMP_PENALTY = 3;
/** Parked this far off straight (radians) earns nothing for straightness. */
export const STRAIGHT_TOLERANCE = (12 * Math.PI) / 180;

// ---- levels -------------------------------------------------------------------------------------
export interface Level {
  name: string;
  /** Berth spacing along the pier (finger to finger, centre to centre). */
  slotW: number;
  /** Berth length, out from the pier face. */
  berthLen: number;
  /** Pontoon fingers are this long (shorter than the berth: the last bit is paint only). */
  fingerLen: number;
  /** A jetty down the middle with turn-in berths on both sides. */
  jetty: boolean;
  /** Decorative moored boats and buoys. */
  decor: number;
  buoys: number;
  /** Steady wind, m/s² on a broadside hull (0: calm). */
  wind: number;
  /** Seconds on the clock. */
  roundS: number;
}

export const LEVELS: readonly Level[] = [
  { name: 'Calm harbour', slotW: 3.9, berthLen: 6.2, fingerLen: 4.4, jetty: false, decor: 3, buoys: 0, wind: 0, roundS: 60 },
  { name: 'Busy marina', slotW: 3.3, berthLen: 5.5, fingerLen: 4.0, jetty: true, decor: 5, buoys: 3, wind: 0, roundS: 70 },
  { name: 'Windy day', slotW: 3.2, berthLen: 5.2, fingerLen: 3.8, jetty: true, decor: 6, buoys: 4, wind: 0.24, roundS: 75 },
];

/** The level played in round `round` (1-based) of a game with `rounds` rounds. */
export function levelFor(round: number, rounds: number): number {
  if (rounds <= 1) return SHORT_LEVEL;
  return Math.min(LEVELS.length - 1, Math.max(0, round - 1));
}

// ---- geometry -----------------------------------------------------------------------------------
export interface V2 {
  x: number;
  z: number;
}

/** An oriented rectangle: centre, heading (as for boats), half length along f, half width along r. */
export interface Rect {
  x: number;
  z: number;
  a: number;
  hl: number;
  hw: number;
}

export type SolidKind = 'quay' | 'jetty' | 'finger' | 'moored' | 'wall';

export interface Solid extends Rect {
  kind: SolidKind;
}

export interface Buoy {
  x: number;
  z: number;
  r: number;
}

export interface Berth extends Rect {
  /** The player it belongs to. */
  owner: number;
  row: Slot['row'];
  /** Where the mooring line goes (on the pier, at the bow end). */
  bollard: V2;
}

/** A decorative boat moored in a berth (also in `solids`, as kind 'moored'). */
export interface Moored extends Rect {
  sail: boolean;
  /** Hull colour. */
  hue: number;
}

export interface Slot extends Rect {
  /** Which pier it hangs off: the quay, or the jetty's left / right side. */
  row: 'quay' | 'left' | 'right';
}

export interface Layout {
  level: number;
  solids: Solid[];
  buoys: Buoy[];
  berths: Berth[];
  moored: Moored[];
  /** Every slot the piers have (with or without a boat), for drawing the pontoons. */
  slots: Slot[];
  jettyX: number | null;
  /** Wind as an acceleration (m/s²) on a broadside hull. */
  wind: V2;
  starts: { x: number; z: number; a: number }[];
}

const TAU = Math.PI * 2;
export const fwd = (a: number): V2 => ({ x: Math.sin(a), z: Math.cos(a) });
export const stbd = (a: number): V2 => ({ x: -Math.cos(a), z: Math.sin(a) });
/** Signed shortest turn from angle a to angle b (−π..π). */
export const angDiff = (a: number, b: number) => ((((b - a) % TAU) + 3 * Math.PI) % TAU) - Math.PI;
/** The heading that points along (dx, dz). */
export const headingOf = (dx: number, dz: number) => Math.atan2(dx, dz);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The four corners of a rectangle: bow-starboard, bow-port, stern-port, stern-starboard. */
export function corners(r: Rect): V2[] {
  const f = fwd(r.a);
  const s = stbd(r.a);
  return [
    { x: r.x + f.x * r.hl + s.x * r.hw, z: r.z + f.z * r.hl + s.z * r.hw },
    { x: r.x + f.x * r.hl - s.x * r.hw, z: r.z + f.z * r.hl - s.z * r.hw },
    { x: r.x - f.x * r.hl - s.x * r.hw, z: r.z - f.z * r.hl - s.z * r.hw },
    { x: r.x - f.x * r.hl + s.x * r.hw, z: r.z - f.z * r.hl + s.z * r.hw },
  ];
}

/** Is the point inside the rectangle (with `eps` of slack)? */
export function pointInRect(p: V2, r: Rect, eps = 1e-6): boolean {
  const f = fwd(r.a);
  const s = stbd(r.a);
  const dx = p.x - r.x;
  const dz = p.z - r.z;
  return Math.abs(dx * f.x + dz * f.z) <= r.hl + eps && Math.abs(dx * s.x + dz * s.z) <= r.hw + eps;
}

/** Is the whole of `inner` inside `outer` (all four corners)? */
export function rectInside(inner: Rect, outer: Rect): boolean {
  return corners(inner).every((c) => pointInRect(c, outer));
}

export interface Contact {
  /** Unit normal from A towards B. */
  nx: number;
  nz: number;
  depth: number;
  /** World contact point. */
  px: number;
  pz: number;
}

/** Separating-axis test of two rectangles. Null when they don't overlap. */
export function rectRect(A: Rect, B: Rect): Contact | null {
  const axes = [fwd(A.a), stbd(A.a), fwd(B.a), stbd(B.a)];
  const fA = axes[0];
  const sA = axes[1];
  const fB = axes[2];
  const sB = axes[3];
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  let best = Infinity;
  let bn: V2 = { x: 1, z: 0 };
  let ref = 0;
  for (let k = 0; k < 4; k++) {
    const n = axes[k];
    const ra = A.hl * Math.abs(fA.x * n.x + fA.z * n.z) + A.hw * Math.abs(sA.x * n.x + sA.z * n.z);
    const rb = B.hl * Math.abs(fB.x * n.x + fB.z * n.z) + B.hw * Math.abs(sB.x * n.x + sB.z * n.z);
    const d = dx * n.x + dz * n.z;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best - 1e-9) {
      best = o;
      bn = d >= 0 ? n : { x: -n.x, z: -n.z };
      ref = k < 2 ? 0 : 1;
    }
  }
  // Contact point: the incident box's corners that reach deepest across the reference face.
  let pts: V2[];
  if (ref === 1) {
    // Face of B: A's corners furthest along n (into B).
    const cs = corners(A);
    const proj = cs.map((c) => c.x * bn.x + c.z * bn.z);
    const m = Math.max(...proj);
    pts = cs.filter((_, k) => proj[k] >= m - 0.06);
  } else {
    const cs = corners(B);
    const proj = cs.map((c) => c.x * bn.x + c.z * bn.z);
    const m = Math.min(...proj);
    pts = cs.filter((_, k) => proj[k] <= m + 0.06);
  }
  const px = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const pz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  return { nx: bn.x, nz: bn.z, depth: best, px, pz };
}

/** A rectangle against a circle (normal from the rectangle towards the circle). */
export function rectCircle(A: Rect, c: Buoy): Contact | null {
  const f = fwd(A.a);
  const s = stbd(A.a);
  const dx = c.x - A.x;
  const dz = c.z - A.z;
  const lf = dx * f.x + dz * f.z;
  const ls = dx * s.x + dz * s.z;
  const cf = clamp(lf, -A.hl, A.hl);
  const cs = clamp(ls, -A.hw, A.hw);
  const qx = A.x + f.x * cf + s.x * cs;
  const qz = A.z + f.z * cf + s.z * cs;
  const ex = c.x - qx;
  const ez = c.z - qz;
  const d = Math.hypot(ex, ez);
  if (d >= c.r) return null;
  if (d > 1e-6) return { nx: ex / d, nz: ez / d, depth: c.r - d, px: qx, pz: qz };
  // Centre inside the rectangle: push out through the nearest side.
  const gf = A.hl - Math.abs(lf);
  const gs = A.hw - Math.abs(ls);
  const n = gf < gs ? { x: f.x * Math.sign(lf || 1), z: f.z * Math.sign(lf || 1) } : { x: s.x * Math.sign(ls || 1), z: s.z * Math.sign(ls || 1) };
  return { nx: n.x, nz: n.z, depth: Math.min(gf, gs) + c.r, px: c.x, pz: c.z };
}

// ---- layout -------------------------------------------------------------------------------------
function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let k = arr.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [arr[k], arr[j]] = [arr[j], arr[k]];
  }
  return arr;
}

/** How many start→berth routes cross (pairs whose left-to-right order swaps). */
export function crossings(starts: number[], ends: number[]): number {
  let n = 0;
  for (let a = 0; a < starts.length; a++) for (let b = a + 1; b < starts.length; b++) if (Math.sign(starts[a] - starts[b]) !== Math.sign(ends[a] - ends[b])) n++;
  return n;
}

/** Where the boats line up: an even row across the bottom of the harbour, bows to the quay. */
export function startRow(count: number): { x: number; z: number; a: number }[] {
  const span = Math.min(46, Math.max(0, count - 1) * 6.6);
  return Array.from({ length: count }, (_, k) => ({ x: count <= 1 ? 0 : -span / 2 + (k * span) / (count - 1), z: START_Z, a: Math.PI }));
}

/**
 * A seeded marina for `count` players (indices in `gone` get no berth). The berths are shuffled
 * so that routes cross, and every one of them is reachable (see the bot test).
 */
export function makeLayout(count: number, level: number, rng: Rng, gone: boolean[] = []): Layout {
  const L = LEVELS[level];
  const solids: Solid[] = [];
  const quayDepth = 6;
  // The quay along the top, the shore walls round the rest.
  solids.push({ kind: 'quay', x: 0, z: QUAY_Z - quayDepth / 2, a: 0, hl: quayDepth / 2, hw: HALF_W + 8 });
  solids.push({ kind: 'wall', x: -HALF_W - 4, z: 0, a: 0, hl: 30, hw: 4 });
  solids.push({ kind: 'wall', x: HALF_W + 4, z: 0, a: 0, hl: 30, hw: 4 });
  solids.push({ kind: 'wall', x: 0, z: SHORE_Z + 4, a: 0, hl: 4, hw: HALF_W + 8 });

  const live = Array.from({ length: count }, (_, i) => i).filter((i) => !gone[i]);
  const slots: Slot[] = [];
  const hlB = L.berthLen / 2;
  const hwB = (L.slotW - FINGER_W) / 2;
  let jettyX: number | null = null;
  let jettyLen = 0;
  if (L.jetty) {
    jettyX = (rng() < 0.5 ? -1 : 1) * Math.round(rng() * 4);
    // Three berths a side, leaving the corner by the quay as open water to turn in.
    const perSide = 3;
    jettyLen = (perSide + 1) * L.slotW + 0.6;
    solids.push({ kind: 'jetty', x: jettyX, z: QUAY_Z + jettyLen / 2, a: 0, hl: jettyLen / 2, hw: JETTY_W / 2 });
    for (const side of [-1, 1] as const) {
      for (let k = 0; k < perSide; k++) {
        const zc = QUAY_Z + 0.1 + (k + 1.5) * L.slotW;
        const x = jettyX + side * (JETTY_W / 2 + hlB);
        // Bow towards the jetty: right side points −x, left side +x.
        slots.push({ row: side < 0 ? 'left' : 'right', x, z: zc, a: side < 0 ? Math.PI / 2 : -Math.PI / 2, hl: hlB, hw: hwB });
      }
    }
  }
  // Quay slots, on both sides of the jetty's berths (or across the middle).
  const clear = jettyX === null ? null : JETTY_W / 2 + L.berthLen + 7.5;
  const quaySlots: Slot[] = [];
  const zq = QUAY_Z + hlB;
  const maxK = Math.floor((HALF_W - 1.5) / L.slotW);
  for (let k = -maxK; k < maxK; k++) {
    const x = (k + 0.5) * L.slotW + (jettyX ?? 0);
    if (Math.abs(x) + L.slotW / 2 > HALF_W - 1) continue;
    if (clear !== null && Math.abs(x - jettyX!) - L.slotW / 2 < clear) continue;
    quaySlots.push({ row: 'quay', x, z: zq, a: Math.PI, hl: hlB, hw: hwB });
  }
  // Take the slots nearest the middle of the harbour, as many as needed (a few spare).
  const decor = Math.max(0, Math.min(L.decor, slots.length + quaySlots.length - live.length - 2));
  const need = live.length + decor;
  const all = [...slots, ...quaySlots].sort((p, q) => Math.hypot(p.x * 0.8, p.z - QUAY_Z) - Math.hypot(q.x * 0.8, q.z - QUAY_Z));
  const used = all.slice(0, Math.min(all.length, need + 2));
  used.sort((p, q) => p.x - q.x || p.z - q.z);

  // Fingers: between neighbouring used slots of the same row, and at the row ends.
  const fingers = new Map<string, Solid>();
  const addFinger = (s: Slot, side: -1 | 1) => {
    const f = fwd(s.a);
    const r = stbd(s.a);
    // From the pier face (bow end) outwards, on the slot's side edge.
    const bx = s.x + f.x * s.hl;
    const bz = s.z + f.z * s.hl;
    const ox = r.x * side * (s.hw + FINGER_W / 2);
    const oz = r.z * side * (s.hw + FINGER_W / 2);
    const cx = bx + ox - f.x * (L.fingerLen / 2);
    const cz = bz + oz - f.z * (L.fingerLen / 2);
    // Don't put a finger into the quay (the jetty's first slots sit against it).
    if (s.row !== 'quay' && cz - FINGER_W < QUAY_Z + 0.05) return;
    const key = `${Math.round(cx * 10)},${Math.round(cz * 10)}`;
    if (!fingers.has(key)) fingers.set(key, { kind: 'finger', x: cx, z: cz, a: s.a, hl: L.fingerLen / 2, hw: FINGER_W / 2 });
  };
  for (const s of used) {
    addFinger(s, -1);
    addFinger(s, 1);
  }
  solids.push(...fingers.values());

  // Players' berths: shuffled over the used slots, at least two on the jetty when there is one.
  // Routes should cross, but be about as long as each other (it's a race to park).
  const starts = startRow(count);
  const liveStarts = live.map((i) => starts[i].x);
  const tipZ = QUAY_Z + jettyLen;
  const route = (from: { x: number; z: number }, s: Slot) => {
    const f = fwd(s.a);
    const ex = s.x - f.x * (s.hl + 3);
    const ez = s.z - f.z * (s.hl + 3);
    if (jettyX !== null && s.row !== 'quay' && Math.sign(from.x - jettyX) !== Math.sign(s.x - jettyX)) {
      // Round the jetty's tip first.
      const tx = jettyX + Math.sign(s.x - jettyX) * 4;
      const tz = tipZ + 4;
      return Math.hypot(tx - from.x, tz - from.z) + Math.hypot(ex - tx, ez - tz) + s.hl + 3;
    }
    return Math.hypot(ex - from.x, ez - from.z) + s.hl + 3;
  };
  let pick: Slot[] = [];
  let bestScore = -Infinity;
  for (let tries = 0; tries < 160; tries++) {
    const cand = shuffle([...used], rng).slice(0, live.length);
    const onJetty = cand.filter((s) => s.row !== 'quay').length;
    const ends = cand.map((s) => s.x);
    const cr = live.length > 1 ? crossings(liveStarts, ends) / ((live.length * (live.length - 1)) / 2) : 0;
    const lens = cand.map((s, k) => route(starts[live[k]], s));
    const spread = Math.max(...lens) - Math.min(...lens);
    // Crossing routes, but not simply mirrored; fair lengths; and some turn-in berths on the jetty.
    let score = -Math.abs(cr - 0.55) - spread / 8 + rng() * 0.15;
    if (jettyX !== null && onJetty < Math.min(2, live.length)) score -= 1;
    if (score > bestScore) {
      bestScore = score;
      pick = cand;
    }
  }
  const berths: Berth[] = [];
  live.forEach((i, k) => {
    const s = pick[k];
    const f = fwd(s.a);
    berths[i] = { owner: i, row: s.row, x: s.x, z: s.z, a: s.a, hl: s.hl, hw: s.hw, bollard: { x: s.x + f.x * (s.hl + 0.5), z: s.z + f.z * (s.hl + 0.5) } };
  });
  // Placeholder berths for players who aren't here (never drawn, never reached).
  for (let i = 0; i < count; i++)
    if (!berths[i]) berths[i] = { owner: i, row: 'quay', x: 0, z: QUAY_Z - 50, a: Math.PI, hl: hlB, hw: hwB, bollard: { x: 0, z: QUAY_Z - 50 } };

  // Decorative boats in the remaining slots.
  const free = shuffle(used.filter((s) => !pick.includes(s)), rng);
  const moored: Moored[] = [];
  for (const s of free.slice(0, decor)) {
    const f = fwd(s.a);
    const hl = 2.05 + rng() * 0.35;
    const hw = Math.min(s.hw - 0.08, 0.85 + rng() * 0.15);
    const back = s.hl - hl - 0.15;
    const m: Moored = { x: s.x + f.x * back, z: s.z + f.z * back, a: s.a + (rng() - 0.5) * 0.04, hl, hw, sail: rng() < 0.45, hue: Math.floor(rng() * 4) };
    moored.push(m);
    solids.push({ kind: 'moored', x: m.x, z: m.z, a: m.a, hl: m.hl, hw: m.hw });
  }

  // Buoys in open water, away from the starts, the berth entrances and each other.
  const buoys: Buoy[] = [];
  // Not in any berth's lane (straight out from it, 14 m), so no berth is blocked.
  const entryClear = (x: number, z: number) =>
    used.every((s) => {
      const f = fwd(s.a);
      const lf = (x - s.x) * f.x + (z - s.z) * f.z;
      const r = stbd(s.a);
      const lr = (x - s.x) * r.x + (z - s.z) * r.z;
      return !(lf < s.hl + 1 && lf > -s.hl - 14 && Math.abs(lr) < s.hw + 3);
    });
  for (let tries = 0; buoys.length < L.buoys && tries < 400; tries++) {
    const x = (rng() * 2 - 1) * (HALF_W - 5);
    const z = QUAY_Z + L.berthLen + 6 + rng() * (START_Z - 6.5 - (QUAY_Z + L.berthLen + 6));
    if (jettyX !== null && Math.abs(x - jettyX) < JETTY_W / 2 + L.berthLen + 6 && z < QUAY_Z + jettyLen + 7) continue;
    if (!entryClear(x, z)) continue;
    if (buoys.some((b) => Math.hypot(b.x - x, b.z - z) < 7)) continue;
    if (starts.some((s) => Math.hypot(s.x - x, s.z - z) < 5)) continue;
    buoys.push({ x, z, r: 0.55 });
  }

  // Wind: across the harbour (the hardest way for the quay berths), either way.
  const wind = L.wind > 0 ? { x: (rng() < 0.5 ? -1 : 1) * L.wind, z: 0 } : { x: 0, z: 0 };
  return { level, solids, buoys, berths, moored, slots: used, jettyX, wind, starts };
}

/** How much of the wind reaches a boat at `z`: the quay and its buildings shelter the berths. */
export function windShelter(z: number) {
  return 0.3 + 0.7 * clamp((z - (QUAY_Z + 4)) / 12, 0, 1);
}

// ---- boats --------------------------------------------------------------------------------------
export interface Boat extends Rect {
  vx: number;
  vz: number;
  /** Yaw rate, da/dt (positive turns to port). */
  w: number;
  /** Commanded stick: rudder −1..1 (+ starboard), throttle −1..1 (+ ahead). */
  cmdRudder: number;
  cmdThrottle: number;
  /** What the engine and rudder are actually doing (they follow the stick quickly). */
  rudder: number;
  throttle: number;
  /** Seconds the boat has been held still inside its lines (resets on any break). */
  hold: number;
  /** All four corners inside the berth right now. */
  inLines: boolean;
  docked: boolean;
  /** 1st, 2nd… to park (0: not yet). */
  place: number;
  dockTime: number;
  /** 0..1 at the moment of docking. */
  centre: number;
  straight: number;
  /** Knocks (≥ TOUCH_V) and hard bumps (≥ BUMP_V) this boat caused. */
  touches: number;
  bumps: number;
  gone: boolean;
  /** The phone has dropped out (it may come back): the boat idles and doesn't hold up the round. */
  away: boolean;
  /** Passes through other boats (while away, and after coming back until it's clear of them). */
  ghost: boolean;
  /** Sim time of the last horn. */
  hornAt: number;
}

export type MarinaEvent =
  | { t: 'bump'; i: number; j: number; x: number; z: number; v: number; hard: boolean; kind: SolidKind | 'boat' | 'buoy' }
  | { t: 'dock'; i: number; place: number }
  | { t: 'horn'; i: number }
  | { t: 'last'; i: number }
  | { t: 'over' };

export type MarinaPhase = 'idle' | 'play' | 'done';

export class MarinaSim {
  readonly layout: Layout;
  readonly boats: Boat[];
  readonly level: number;
  readonly solo: boolean;
  phase: MarinaPhase = 'idle';
  time = 0;
  tick = 0;
  over = false;
  /** Ended by the clock (not everybody parked). */
  timeout = false;
  /** Seconds on the clock (cut short when only one boat is left out). */
  limit: number;
  lastCalled = false;
  private docks = 0;
  /** "a|b" → sim time of the last knock between those two things. */
  private knocks = new Map<string, number>();

  constructor(count: number, level: number, rng: Rng = Math.random, gone: boolean[] = []) {
    this.level = level;
    this.layout = makeLayout(count, level, rng, gone);
    this.limit = LEVELS[level].roundS;
    this.boats = this.layout.starts.map((s, i) => ({
      x: s.x,
      z: s.z,
      a: s.a,
      hl: BOAT_HL,
      hw: BOAT_HW,
      vx: 0,
      vz: 0,
      w: 0,
      cmdRudder: 0,
      cmdThrottle: 0,
      rudder: 0,
      throttle: 0,
      hold: 0,
      inLines: false,
      docked: false,
      place: 0,
      dockTime: 0,
      centre: 0,
      straight: 0,
      touches: 0,
      bumps: 0,
      gone: !!gone[i],
      away: false,
      ghost: false,
      hornAt: -1e9,
    }));
    this.solo = this.boats.filter((b) => !b.gone).length <= 1;
  }

  begin() {
    if (this.phase === 'idle') this.phase = 'play';
  }

  get timeLeft() {
    return Math.max(0, this.limit - this.time);
  }

  get dockedCount() {
    return this.boats.filter((b) => b.docked && !b.gone).length;
  }

  get liveCount() {
    return this.boats.filter((b) => !b.gone).length;
  }

  berth(i: number) {
    return this.layout.berths[i];
  }

  /** Stick from the phone: x is the rudder (+ starboard), y is +down the phone (so −y is ahead). */
  setStick(i: number, x: number, y: number) {
    const b = this.boats[i];
    if (!b) return;
    b.cmdRudder = clamp(Number.isFinite(x) ? x : 0, -1, 1);
    b.cmdThrottle = clamp(Number.isFinite(y) ? -y : 0, -1, 1);
  }

  horn(i: number): boolean {
    const b = this.boats[i];
    if (!b || b.gone || this.time - b.hornAt < HORN_S) return false;
    b.hornAt = this.time;
    return true;
  }

  remove(i: number) {
    const b = this.boats[i];
    if (!b) return;
    b.gone = true;
    b.vx = b.vz = b.w = 0;
    b.cmdRudder = b.cmdThrottle = b.rudder = b.throttle = 0;
    b.hold = 0;
  }

  /** The player's phone dropped out (true) or came back (false). */
  setAway(i: number, away: boolean) {
    const b = this.boats[i];
    if (!b || b.away === away) return;
    b.away = away;
    if (away) {
      b.ghost = true;
      b.cmdRudder = b.cmdThrottle = 0;
      b.hold = 0;
    }
  }

  speed(i: number) {
    const b = this.boats[i];
    return b ? Math.hypot(b.vx, b.vz) : 0;
  }

  step(): MarinaEvent[] {
    const ev: MarinaEvent[] = [];
    if (this.phase === 'idle') return ev;
    const live = !this.over;
    if (live) {
      this.time += DT;
      this.tick++;
    }
    const h = DT / SUBSTEPS;
    this.updateGhosts();
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const b of this.boats) if (!b.gone && !b.docked) this.drive(b, h, live);
      this.collide(ev, live);
    }
    if (live) {
      this.checkDocking(ev);
      if (this.checkOver(ev)) {
        this.over = true;
        this.phase = 'done';
        ev.push({ t: 'over' });
      }
    }
    return ev;
  }

  /** A boat that came back stays a ghost until it no longer overlaps any other boat. */
  private updateGhosts() {
    for (const b of this.boats) {
      if (!b.ghost || b.away || b.gone) continue;
      b.ghost = this.boats.some((o) => o !== b && !o.gone && Math.hypot(o.x - b.x, o.z - b.z) < 2 * Math.hypot(BOAT_HL, BOAT_HW) && rectRect(b, o) !== null);
    }
  }

  /** One substep of a boat's own motion: engine, rudder, drag, keel, wind. */
  private drive(b: Boat, h: number, live: boolean) {
    const T = TUNING;
    const on = live && this.phase === 'play' && !b.away;
    const wantT = on ? b.cmdThrottle : 0;
    const wantR = on ? b.cmdRudder : 0;
    b.throttle += clamp(wantT - b.throttle, -T.throttleRate * h, T.throttleRate * h);
    b.rudder += clamp(wantR - b.rudder, -T.rudderRate * h, T.rudderRate * h);
    const f = fwd(b.a);
    const s = stbd(b.a);
    let u = b.vx * f.x + b.vz * f.z;
    let v = b.vx * s.x + b.vz * s.z;

    // The keel turns sideways drift into motion along the hull (not when going broadside).
    const sp = Math.hypot(u, v);
    if (sp > 0.05) {
      const beta = Math.atan2(v, Math.abs(u));
      const eff = Math.max(0, Math.cos(beta) * 2 - 1) * Math.min(1, sp / 1.5);
      const nb = beta * Math.exp(-T.keelGrip * eff * h);
      const k = 1 - (1 - Math.cos(beta - nb)) * 0.5;
      u = Math.sign(u || 1) * sp * Math.cos(nb) * k;
      v = sp * Math.sin(nb) * k;
    }

    const thr = b.throttle;
    let au = thr >= 0 ? thr * T.thrustAhead : thr * T.thrustAstern;
    au -= (u < 0 ? T.surgeDrag1 * T.asternDrag : T.surgeDrag1) * u + T.surgeDrag2 * u * Math.abs(u) + T.harbourDrag * Math.exp(-Math.abs(u) / T.harbourV) * u;
    let av = -(T.swayDrag1 * v + T.swayDrag2 * v * Math.abs(v));

    // Water over the rudder: the boat's own way, plus the propeller's wash when going ahead.
    const wash = T.propWash * Math.max(0, thr) * clamp(1 - Math.abs(u) / T.washFade, 0, 1);
    const flow = (u >= 0 ? u : u * T.rudderAstern) + wash;
    let aw = -b.rudder * T.rudder * flow;
    av += -b.rudder * T.rudderKick * flow;
    aw -= T.yawDrag1 * b.w + T.yawDrag2 * b.w * Math.abs(b.w);

    // Wind pushes the hull, harder broadside on, less in the lee of the quay.
    const wind = this.layout.wind;
    if (wind.x !== 0 || wind.z !== 0) {
      const wl = Math.hypot(wind.x, wind.z);
      const side = Math.abs((wind.x * s.x + wind.z * s.z) / wl);
      const k = (0.4 + 0.6 * side) * windShelter(b.z);
      au += (wind.x * f.x + wind.z * f.z) * k;
      av += (wind.x * s.x + wind.z * s.z) * k;
    }

    u += au * h;
    v += av * h;
    b.w = clamp(b.w + aw * h, -T.maxYaw, T.maxYaw);
    b.vx = f.x * u + s.x * v;
    b.vz = f.z * u + s.z * v;
    const vv = Math.hypot(b.vx, b.vz);
    if (vv > T.maxSpeed) {
      b.vx *= T.maxSpeed / vv;
      b.vz *= T.maxSpeed / vv;
    }
    b.x += b.vx * h;
    b.z += b.vz * h;
    b.a += b.w * h;
    if (b.a > Math.PI) b.a -= TAU;
    else if (b.a < -Math.PI) b.a += TAU;
  }

  /** Push boats out of everything they overlap, with a soft bounce. */
  private collide(ev: MarinaEvent[], live: boolean) {
    const boats = this.boats;
    const R = Math.hypot(BOAT_HL, BOAT_HW);
    for (const [i, b] of boats.entries()) {
      if (b.gone || b.docked) continue;
      // A few passes, so a boat squeezed between two things ends up clear of both.
      for (let pass = 0; pass < 3; pass++) this.collideStatic(ev, live, i, b, R, pass > 0);
    }
    for (let i = 0; i < boats.length; i++)
      for (let j = i + 1; j < boats.length; j++) {
        const A = boats[i];
        const B = boats[j];
        if (A.gone || B.gone || A.ghost || B.ghost || (A.docked && B.docked)) continue;
        if (Math.hypot(A.x - B.x, A.z - B.z) > 2 * R) continue;
        const c = rectRect(A, B);
        if (!c) continue;
        if (A.docked) {
          // B hits a moored boat: treat it as a solid (normal from B towards A).
          this.resolve(ev, live, j, i, { ...c, nx: -c.nx, nz: -c.nz }, `${j}|${i}`, 'boat');
        } else if (B.docked) this.resolve(ev, live, i, j, c, `${i}|${j}`, 'boat');
        else this.resolve(ev, live, i, j, c, `${i}|${j}`, 'boat');
      }
  }

  /** Boat i against the piers, walls, moored boats and buoys. */
  private collideStatic(ev: MarinaEvent[], live: boolean, i: number, b: Boat, R: number, quiet: boolean) {
    for (const s of this.layout.solids) {
      if (Math.hypot(s.x - b.x, s.z - b.z) > R + Math.hypot(s.hl, s.hw)) continue;
      const c = rectRect(b, s);
      if (c) this.resolve(ev, live && !quiet, i, -1, c, `${i}|${s.kind}${Math.round(s.x)},${Math.round(s.z)}`, s.kind);
    }
    for (const [k, buoy] of this.layout.buoys.entries()) {
      if (Math.hypot(buoy.x - b.x, buoy.z - b.z) > R + buoy.r) continue;
      const c = rectCircle(b, buoy);
      if (c) this.resolve(ev, live && !quiet, i, -1, c, `${i}|b${k}`, 'buoy');
    }
  }

  /**
   * Boat `i` against a solid (j < 0) or a moored boat (j docked), or two moving boats. The normal
   * points from boat i towards the other thing.
   */
  private resolve(ev: MarinaEvent[], live: boolean, i: number, j: number, c: Contact, key: string, kind: SolidKind | 'boat' | 'buoy') {
    const A = this.boats[i];
    const B = j >= 0 && !this.boats[j].docked ? this.boats[j] : null;
    const imA = 1;
    const imB = B ? 1 : 0;
    const iiA = 1 / BOAT_I;
    const iiB = B ? 1 / BOAT_I : 0;
    // Positional fix: all of it (no sinking in), split between movers.
    const tot = imA + imB;
    A.x -= c.nx * c.depth * (imA / tot);
    A.z -= c.nz * c.depth * (imA / tot);
    if (B) {
      B.x += c.nx * c.depth * (imB / tot);
      B.z += c.nz * c.depth * (imB / tot);
    }
    // Velocity of the contact point on each body.
    const rax = c.px - A.x;
    const raz = c.pz - A.z;
    const vax = A.vx + A.w * raz;
    const vaz = A.vz - A.w * rax;
    let vbx = 0;
    let vbz = 0;
    let rbx = 0;
    let rbz = 0;
    if (B) {
      rbx = c.px - B.x;
      rbz = c.pz - B.z;
      vbx = B.vx + B.w * rbz;
      vbz = B.vz - B.w * rbx;
    }
    const rvx = vbx - vax;
    const rvz = vbz - vaz;
    const vn = rvx * c.nx + rvz * c.nz;
    if (vn >= 0) return;
    // perp(r)·n, the lever arm for the yaw (see the point-velocity formula above).
    const ka = raz * c.nx - rax * c.nz;
    const kb = rbz * c.nx - rbx * c.nz;
    const denom = imA + imB + ka * ka * iiA + kb * kb * iiB;
    const T = TUNING;
    const jn = (-(1 + T.restitution) * vn) / denom;
    // Friction along the contact.
    const tx = -c.nz;
    const tz = c.nx;
    const vt = rvx * tx + rvz * tz;
    const kta = raz * tx - rax * tz;
    const ktb = rbz * tx - rbx * tz;
    const dent = imA + imB + kta * kta * iiA + ktb * ktb * iiB;
    const jt = clamp(-vt / dent, -T.friction * jn, T.friction * jn);
    const jx = c.nx * jn + tx * jt;
    const jz = c.nz * jn + tz * jt;
    A.vx -= jx * imA;
    A.vz -= jz * imA;
    A.w -= (raz * jx - rax * jz) * iiA;
    if (B) {
      B.vx += jx * imB;
      B.vz += jz * imB;
      B.w += (rbz * jx - rbx * jz) * iiB;
    }
    if (!live || this.phase !== 'play') return;
    const impact = -vn;
    if (impact < TOUCH_V) return;
    const last = this.knocks.get(key);
    if (last !== undefined && this.time - last < BUMP_COOLDOWN) return;
    this.knocks.set(key, this.time);
    // Whose fault: the one driving into the contact harder.
    const intoA = vax * c.nx + vaz * c.nz;
    const intoB = B ? -(vbx * c.nx + vbz * c.nz) : 0;
    const culprit = !B || intoA >= intoB ? i : j;
    const hard = impact >= BUMP_V;
    const cb = this.boats[culprit];
    if (!cb.docked) {
      cb.touches++;
      if (hard) cb.bumps++;
    }
    ev.push({ t: 'bump', i: culprit, j: culprit === i ? j : i, x: c.px, z: c.pz, v: impact, hard, kind });
  }

  private checkDocking(ev: MarinaEvent[]) {
    if (this.phase !== 'play') return;
    for (const [i, b] of this.boats.entries()) {
      if (b.gone || b.docked) continue;
      const berth = this.layout.berths[i];
      b.inLines = rectInside(b, berth);
      const slack = b.hold > 0 ? DOCK_SLACK : 1;
      const still = Math.hypot(b.vx, b.vz) < DOCK_SPEED * slack && Math.abs(b.w) < DOCK_YAW * slack;
      if (b.inLines && still && !b.away) {
        b.hold += DT;
        if (b.hold >= DOCK_HOLD - 1e-9) {
          b.docked = true;
          b.place = ++this.docks;
          b.dockTime = this.time;
          const q = parkQuality(b, berth);
          b.centre = q.centre;
          b.straight = q.straight;
          b.vx = b.vz = b.w = 0;
          b.throttle = b.rudder = 0;
          ev.push({ t: 'dock', i, place: b.place });
        }
      } else b.hold = Math.max(0, b.hold - DT * HOLD_DECAY);
    }
  }

  private checkOver(ev: MarinaEvent[]) {
    // Boats whose phone dropped out don't hold the round up (once somebody has parked).
    const left = this.boats.map((b, i) => (!b.gone && !b.docked && !b.away ? i : -1)).filter((i) => i >= 0);
    if (this.liveCount === 0) return true;
    if (left.length === 0 && this.dockedCount > 0) return true;
    if (!this.lastCalled && left.length === 1 && this.liveCount >= 2) {
      this.lastCalled = true;
      this.limit = Math.min(this.limit, this.time + LAST_BOAT_S);
      ev.push({ t: 'last', i: left[0] });
    }
    if (this.time >= this.limit - 1e-9) {
      this.timeout = true;
      return true;
    }
    return false;
  }

  /** Each player's points for the round, with the breakdown. */
  results(): RoundScore[] {
    return this.boats.map((b, i) => {
      if (b.gone) return emptyScore();
      const berth = this.layout.berths[i];
      return roundScore({
        docked: b.docked,
        place: b.place,
        solo: this.solo,
        dockTime: b.dockTime,
        centre: b.centre,
        straight: b.straight,
        touches: b.touches,
        bumps: b.bumps,
        dist: Math.hypot(b.x - berth.x, b.z - berth.z),
      });
    });
  }
}

// ---- scoring (pure) -----------------------------------------------------------------------------
/** How centred (sideways) and how straight a boat sits in its berth, each 0..1. */
export function parkQuality(boat: Rect, berth: Rect): { centre: number; straight: number } {
  const s = stbd(berth.a);
  const lat = Math.abs((boat.x - berth.x) * s.x + (boat.z - berth.z) * s.z);
  const slack = Math.max(0.05, berth.hw - boat.hw);
  const centre = clamp(1 - lat / slack, 0, 1);
  // Either way round counts (stern-to mooring is fine): compare the hull's axis, not its bow.
  let err = Math.abs(angDiff(boat.a, berth.a));
  if (err > Math.PI / 2) err = Math.PI - err;
  const straight = clamp(1 - err / STRAIGHT_TOLERANCE, 0, 1);
  return { centre, straight };
}

export const placePoints = (place: number) => (place >= 1 ? (PLACE_POINTS[place - 1] ?? 1) : 0);

/** On your own there's no order: the time it took (10 for under 14 s, down to 2). */
export const soloTimePoints = (t: number) => clamp(Math.round(10 - Math.max(0, t - 14) / 4), 2, 10);

/** Not parked when the time ran out: something for getting close. */
export function nearPoints(dist: number) {
  if (dist <= 4) return 3;
  if (dist <= 9) return 2;
  if (dist <= 16) return 1;
  return 0;
}

export interface RoundScore {
  docked: boolean;
  place: number;
  /** Order (or, solo, time) points; 0 when not parked. */
  order: number;
  centre: number;
  straight: number;
  clean: number;
  /** Points lost to hard bumps (as a positive number). */
  bumps: number;
  /** Consolation when not parked. */
  near: number;
  total: number;
}

export function emptyScore(): RoundScore {
  return { docked: false, place: 0, order: 0, centre: 0, straight: 0, clean: 0, bumps: 0, near: 0, total: 0 };
}

export function roundScore(p: {
  docked: boolean;
  place: number;
  solo: boolean;
  dockTime: number;
  centre: number;
  straight: number;
  touches: number;
  bumps: number;
  dist: number;
}): RoundScore {
  const bumps = Math.min(MAX_BUMP_PENALTY, p.bumps);
  if (!p.docked) {
    const near = nearPoints(p.dist);
    return { ...emptyScore(), near, bumps: Math.min(bumps, near), total: Math.max(0, near - bumps) };
  }
  const order = p.solo ? soloTimePoints(p.dockTime) : placePoints(p.place);
  const centre = Math.round(QUALITY_POINTS * p.centre);
  const straight = Math.round(QUALITY_POINTS * p.straight);
  const clean = p.touches === 0 ? CLEAN_POINTS : 0;
  const total = Math.max(1, order + centre + straight + clean - bumps);
  return { docked: true, place: p.place, order, centre, straight, clean, bumps, near: 0, total };
}

export function ordinal(n: number) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

// ---- autopilot (for tests and the /?debug handle) ----------------------------------------------
/**
 * A simple skipper that parks boat `i` in its berth. It follows a path (from where it started, to a
 * point well out from the berth, to the start of a straight lead-in, to the middle of the berth)
 * by pure pursuit, slows down along it, corrects for drift on the lead-in and stops in the box.
 * If it gets wedged it backs off and tries again. It proves every berth can be reached, and drives
 * boats on the TV for screenshots.
 */
export class Autopilot {
  readonly path: V2[];
  private integ = 0;
  private stuck = 0;
  private backing = 0;
  private retreat = false;
  /** Backing well out (after being stuck crooked in the box), not just a little. */
  private deep = false;
  /** Seconds sitting still outside the lines. */
  private stall = 0;
  private seg = 0;

  constructor(
    private sim: MarinaSim,
    readonly i: number,
    /** How hurried it is (1: careful; more is faster on the way and into the box). */
    private pace = 1,
  ) {
    const b = sim.boats[i];
    const berth = sim.layout.berths[i];
    const f = fwd(berth.a);
    const at = (d: number): V2 => ({ x: berth.x - f.x * d, z: berth.z - f.z * d });
    if (berth.row === 'quay') this.path = [{ x: b.x, z: b.z }, at(berth.hl + 9), at(berth.hl + 7), at(0)];
    else {
      // Beside the jetty: come up from the open water below the lead-in, then turn in.
      const e = at(berth.hl + 5.5);
      const o = at(berth.hl + 9);
      this.path = [{ x: b.x, z: b.z }, { x: o.x, z: o.z + 5 }, e, at(0)];
      // From the other side of the jetty: round its tip first.
      const jx = sim.layout.jettyX ?? 0;
      const side = Math.sign(berth.x - jx);
      if (Math.sign(b.x - jx) !== side) {
        const tip = Math.max(...sim.layout.solids.filter((s) => s.kind === 'jetty').map((s) => s.z + s.hl));
        this.path.splice(1, 0, { x: jx + side * 5, z: tip + 5 });
      }
    }
    // Steer round buoys on the way (not on the lead-in).
    for (let pass = 0; pass < 8; pass++) {
      let added = false;
      for (const buoy of sim.layout.buoys) {
        for (let k = 0; k < this.path.length - 2 && !added; k++) {
          const A = this.path[k];
          const B = this.path[k + 1];
          const sx = B.x - A.x;
          const sz = B.z - A.z;
          const len = Math.hypot(sx, sz) || 1;
          const t = clamp(((buoy.x - A.x) * sx + (buoy.z - A.z) * sz) / (len * len), 0, 1);
          const cx = A.x + sx * t;
          const cz = A.z + sz * t;
          if (Math.hypot(buoy.x - cx, buoy.z - cz) > 3.4 || t <= 0.02 || t >= 0.98) continue;
          // Pass on the side the line already leans to, well clear.
          let nx = -sz / len;
          let nz = sx / len;
          if ((cx - buoy.x) * nx + (cz - buoy.z) * nz < 0) {
            nx = -nx;
            nz = -nz;
          }
          this.path.splice(k + 1, 0, { x: buoy.x + nx * 4, z: buoy.z + nz * 4 });
          added = true;
        }
        if (added) break;
      }
      if (!added) break;
    }
  }

  /** Closest point on the path: segment index, its fraction, and the distance left to the end. */
  private onPath(x: number, z: number) {
    const P = this.path;
    let best = { k: this.seg, t: 0, d: Infinity };
    // Waypoints passed close by count as reached (so the boat never circles one it can't hit).
    while (this.seg < P.length - 2 && Math.hypot(P[this.seg + 1].x - x, P[this.seg + 1].z - z) < 3.5) this.seg++;
    for (let k = this.seg; k < P.length - 1; k++) {
      const ax = P[k].x;
      const az = P[k].z;
      const sx = P[k + 1].x - ax;
      const sz = P[k + 1].z - az;
      const len2 = sx * sx + sz * sz || 1;
      const t = clamp(((x - ax) * sx + (z - az) * sz) / len2, 0, 1);
      // Prefer later segments on ties (so the lead-in wins near the corners).
      const d = Math.hypot(ax + sx * t - x, az + sz * t - z) - k * 0.01;
      if (d <= best.d) best = { k, t, d };
    }
    this.seg = best.k;
    let left = Math.hypot(P[best.k + 1].x - P[best.k].x, P[best.k + 1].z - P[best.k].z) * (1 - best.t);
    for (let k = best.k + 1; k < P.length - 1; k++) left += Math.hypot(P[k + 1].x - P[k].x, P[k + 1].z - P[k].z);
    return { ...best, left };
  }

  /** The point `ahead` metres further along the path from segment k, fraction t. */
  private along(k: number, t: number, ahead: number): V2 {
    const P = this.path;
    let seg = k;
    let x = P[k].x + (P[k + 1].x - P[k].x) * t;
    let z = P[k].z + (P[k + 1].z - P[k].z) * t;
    let rest = ahead;
    while (seg < P.length - 1) {
      const ex = P[seg + 1].x;
      const ez = P[seg + 1].z;
      const d = Math.hypot(ex - x, ez - z);
      if (d >= rest) return { x: x + ((ex - x) * rest) / d, z: z + ((ez - z) * rest) / d };
      rest -= d;
      x = ex;
      z = ez;
      seg++;
    }
    return { x, z };
  }

  /** The stick to send this tick: x rudder (+ starboard), y +astern (phone convention). */
  stick(): { x: number; y: number } {
    const sim = this.sim;
    const b = sim.boats[this.i];
    const berth = sim.layout.berths[this.i];
    if (!b || b.gone || b.docked) return { x: 0, y: 0 };
    const f = fwd(b.a);
    const u = b.vx * f.x + b.vz * f.z;
    const sp = Math.hypot(b.vx, b.vz);
    const fB = fwd(berth.a);
    const sB = stbd(berth.a);
    const along = (b.x - berth.x) * fB.x + (b.z - berth.z) * fB.z;
    const lat = (b.x - berth.x) * sB.x + (b.z - berth.z) * sB.z;
    const latV = b.vx * sB.x + b.vz * sB.z;

    // Wedged against something: back off for a moment.
    if (this.backing > 0) {
      this.backing -= DT;
      return { x: 0, y: 0.8 };
    }

    const on = this.onPath(b.x, b.z);
    const lastSeg = on.k === this.path.length - 2;
    let want: number;
    let vWant = clamp(on.left * 0.42 * this.pace, 0.25, 4.5 * this.pace);
    const leadIn = lastSeg && along > -(berth.hl + 6);
    if (leadIn) {
      // On the lead-in: aim along the berth's centre line, damping sideways drift (and wind).
      if (sp > 0.5) this.integ = clamp(this.integ + lat * DT * 0.3, -0.7, 0.7);
      const togo = -along;
      const cap = togo > berth.hl + 2 ? 2.5 : 1.1;
      const off = clamp(lat + latV * 1.4 + this.integ, -cap, cap);
      want = headingOf(fB.x * 3 - sB.x * off, fB.z * 3 - sB.z * off);
      vWant = togo > 0.12 ? clamp(togo * 0.33 * this.pace, 0.3, 2 * this.pace) : 0;
    } else {
      // Slow down for a sharp corner coming up.
      const P = this.path;
      if (on.k < P.length - 2) {
        const c = P[on.k + 1];
        const a1 = headingOf(c.x - P[on.k].x, c.z - P[on.k].z);
        const a2 = headingOf(P[on.k + 2].x - c.x, P[on.k + 2].z - c.z);
        if (Math.abs(angDiff(a1, a2)) > 0.6) vWant = Math.min(vWant, 1.6 + Math.hypot(c.x - b.x, c.z - b.z) * 0.3);
      }
      const t = this.along(on.k, on.t, clamp(2.5 + sp * 0.6, 2.5, 5));
      want = headingOf(t.x - b.x, t.z - b.z);
    }
    // Give way: another boat close ahead means slow down and keep to starboard (not in the box).
    if (!leadIn || along < -berth.hl - 1)
      for (const [k, o] of sim.boats.entries()) {
        if (k === this.i || o.gone || o.docked) continue;
        const ox = o.x - b.x;
        const oz = o.z - b.z;
        const d = Math.hypot(ox, oz);
        if (d > 8 || d < 1e-6) continue;
        const ahead = (ox * f.x + oz * f.z) / d;
        if (ahead < 0.6) continue;
        want -= 0.6 * (1 - d / 8) + 0.15;
        vWant = Math.min(vWant, 0.8 + d * 0.25);
      }
    const err = angDiff(b.a, want);
    if (Math.abs(err) > 0.5) vWant = Math.min(vWant, 2);
    // Rudder: positive turns to starboard (decreasing a), so steer against the error and damp the yaw.
    let rud = clamp(-2.4 * err + 0.9 * b.w, -1, 1);
    if (u < -0.2) rud = -rud;
    let thr = clamp((vWant - u) * 0.9, -1, 1);
    // Off course at low speed: a burst of throttle with the rudder over swings the stern round.
    if (Math.abs(err) > 0.7 && u < 1.2 && on.left > 3) thr = Math.max(thr, 0.55);
    if (b.inLines) {
      // In the box: just stop dead and hold it.
      thr = clamp(-u * 2, -1, 1);
      rud = clamp(-2 * err, -1, 1);
      this.retreat = false;
    } else if (leadIn && Math.abs(err) > 0.07 && sp < 0.2) {
      // Crooked in the box: nudge straight with prop wash, backing out first if the bow is at the pier.
      if (along >= berth.hl - b.hl - 0.3) this.retreat = true;
      if (!this.retreat) {
        thr = Math.max(thr, 0.45);
        rud = clamp(-4 * err, -1, 1);
      }
    }
    // Coming in too far off the line to fit: back out and try again.
    if (leadIn && !b.inLines && along > -berth.hl - 0.5 && Math.abs(lat) > berth.hw - b.hw + 0.35) this.retreat = true;
    // Sitting still outside the lines for a while (wedged crooked between the fingers): back right out.
    if (!b.inLines && sp < 0.15) this.stall += DT;
    else this.stall = 0;
    if (this.stall > 2.5 && leadIn) {
      this.stall = 0;
      this.retreat = this.deep = true;
    }
    if (this.retreat && !b.inLines) {
      if (along < -(this.deep || Math.abs(lat) > berth.hw - b.hw ? berth.hl + 4 : 0.8) || !leadIn) this.retreat = this.deep = false;
      else {
        thr = -0.5;
        rud = clamp(4 * err, -1, 1);
      }
    }

    if (thr > 0.4 && sp < 0.25 && !b.inLines) this.stuck += DT;
    else this.stuck = Math.max(0, this.stuck - DT * 2);
    if (this.stuck > 1.2) {
      this.stuck = 0;
      this.backing = 1.3;
      this.integ = 0;
    }
    return { x: rud, y: -thr };
  }
}

export function howTo(short: boolean): string[] {
  return [
    'Park in the berth in your colour: the whole hull inside the lines, then stop',
    'Stick up: ahead · down: astern (your brake) · left / right: rudder',
    short ? 'One marina · first to park scores most' : 'Three marinas, windier each time · first to park scores most',
  ];
}
