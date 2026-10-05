import { mulberry32, type Rng } from '../rng';

/** Half the width of the tarmac. */
export const ROAD_HALF = 7;
/** Cars are kept this far from the centre line by the barriers (tarmac + grass verge). */
export const WALL = 13;
/** The centre line is resampled to points this far apart. */
export const SPACING = 2;
/** Tracks closer than this to themselves would let cars jump between two parts. */
const MIN_GAP = 2 * WALL + 10;
/** Tightest allowed corner radius: the inner barrier must not fold over itself. */
const MIN_RADIUS = WALL + 5;
const MAX_HILL = 6;
/** How high a figure-eight's bridge lifts one road over the other. */
export const BRIDGE_HEIGHT = 8;
/** Samples either side of a crossing that may come close to the other road. */
const CROSS_ZONE = 45;

export const SHAPES = ['ring', 'kidney', 'clover', 'figure8', 'town', 'speedway'] as const;
export type Shape = (typeof SHAPES)[number];

export const SHAPE_NAMES: Record<Shape, string> = {
  ring: 'Forest Ring',
  kidney: 'Kidney Bend',
  clover: 'Clover Hills',
  figure8: 'Figure Eight',
  town: 'Town Circuit',
  speedway: 'Speedway',
};

export interface Track {
  seed: number;
  shape: Shape;
  name: string;
  n: number;
  /** Centre line samples, evenly spaced by SPACING (the last one connects back to the first). */
  xs: Float64Array;
  zs: Float64Array;
  /** Road height at each sample. */
  hs: Float64Array;
  /** Unit tangent (driving direction). The left-hand normal is (tz, -tx). */
  tx: Float64Array;
  tz: Float64Array;
  /** Distance from the start line to each sample. */
  dist: Float64Array;
  length: number;
  /** 1 where the road is on the bridge (raised above the ground). */
  bridge: Uint8Array;
  /** Figure eight: sample indices where the road goes over and under itself. */
  crossing: { over: number; under: number } | null;
  /** Sample range [from, to) lined with houses (may wrap past the start), or the whole lap. */
  town: { from: number; to: number } | null;
}

/** Closed Catmull-Rom spline through control points, sampled `per` times per segment. */
function spline(px: number[], pz: number[], per: number): { x: number[]; z: number[] } {
  const k = px.length;
  const x: number[] = [];
  const z: number[] = [];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let i = 0; i < k; i++) {
    const a = (i - 1 + k) % k;
    const b = i;
    const c = (i + 1) % k;
    const d = (i + 2) % k;
    const segLen = Math.hypot(px[c] - px[b], pz[c] - pz[b]);
    const steps = Math.max(2, Math.ceil(segLen / (SPACING / 2)) || per);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      x.push(cr(px[a], px[b], px[c], px[d], t));
      z.push(cr(pz[a], pz[b], pz[c], pz[d], t));
    }
  }
  return { x, z };
}

/** Resample a closed polyline to evenly spaced points. */
function resample(x: number[], z: number[], step: number): { x: number[]; z: number[] } {
  const m = x.length;
  let total = 0;
  for (let i = 0; i < m; i++) total += Math.hypot(x[(i + 1) % m] - x[i], z[(i + 1) % m] - z[i]);
  const n = Math.max(16, Math.round(total / step));
  const want = total / n;
  const ox: number[] = [];
  const oz: number[] = [];
  let seg = 0;
  let segStart = 0;
  let segLen = Math.hypot(x[1] - x[0], z[1] - z[0]);
  for (let j = 0; j < n; j++) {
    const d = j * want;
    while (d > segStart + segLen && seg < m - 1) {
      segStart += segLen;
      seg++;
      segLen = Math.hypot(x[(seg + 1) % m] - x[seg], z[(seg + 1) % m] - z[seg]);
    }
    const t = segLen > 0 ? (d - segStart) / segLen : 0;
    ox.push(x[seg] + (x[(seg + 1) % m] - x[seg]) * t);
    oz.push(z[seg] + (z[(seg + 1) % m] - z[seg]) * t);
  }
  return { x: ox, z: oz };
}

// ---------------------------------------------------------------------------
// Shapes: each returns closed control points for the spline.
// ---------------------------------------------------------------------------

type Pts = { x: number[]; z: number[] };

function polar(k: number, r: (a: number) => number, rng: Rng, jitter = 0.25, squash = 0.75 + rng() * 0.2): Pts {
  const x: number[] = [];
  const z: number[] = [];
  for (let i = 0; i < k; i++) {
    const a = ((i + (rng() - 0.5) * jitter) / k) * Math.PI * 2;
    x.push(Math.cos(a) * r(a));
    z.push(Math.sin(a) * r(a) * squash);
  }
  return { x, z };
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function ringPoints(rng: Rng): Pts {
  const k = 9 + Math.floor(rng() * 6);
  const base = 200 + rng() * 70;
  let radii = Array.from({ length: k }, () => base * (0.45 + 0.55 * rng()));
  radii = radii.map((r, i) => 0.5 * r + 0.25 * (radii[(i + k - 1) % k] + radii[(i + 1) % k]));
  let i = 0;
  return polar(k, () => radii[i++ % k], rng, 0.5);
}

function kidneyPoints(rng: Rng): Pts {
  const R = 230 + rng() * 60;
  const dent = rng() * Math.PI * 2;
  const depth = 0.52 + rng() * 0.12;
  const width = 0.55 + rng() * 0.25;
  return polar(16, (a) => R * (1 - depth * Math.exp(-((angDiff(a, dent) / width) ** 2))) * (0.92 + rng() * 0.16), rng, 0.15);
}

function cloverPoints(rng: Rng): Pts {
  const lobes = 3 + (rng() < 0.35 ? 1 : 0);
  const R = 260 + rng() * 40;
  const spin = rng() * Math.PI * 2;
  return polar(lobes * 7, (a) => R * (0.7 + 0.3 * Math.cos(lobes * a + spin)), rng, 0.1, 0.85 + rng() * 0.15);
}

function figure8Points(rng: Rng): Pts {
  const A = 210 + rng() * 60;
  const B = 230 + rng() * 60;
  const k = 20;
  const x: number[] = [];
  const z: number[] = [];
  const turn = rng() * Math.PI * 2;
  for (let i = 0; i < k; i++) {
    const t = (i / k) * Math.PI * 2;
    // Lemniscate of Gerono: crosses itself at the origin.
    const px = A * Math.cos(t) + (rng() - 0.5) * 16;
    const pz = B * Math.sin(t) * Math.cos(t) + (rng() - 0.5) * 16;
    x.push(px * Math.cos(turn) - pz * Math.sin(turn));
    z.push(px * Math.sin(turn) + pz * Math.cos(turn));
  }
  return { x, z };
}

/** Town templates: block outlines on a grid (cells), driven around with chamfered corners. */
const TOWN_TEMPLATES: [number, number][][] = [
  [
    [0, 0],
    [5, 0],
    [5, 3],
    [0, 3],
  ],
  [
    [0, 0],
    [5, 0],
    [5, 2],
    [2.5, 2],
    [2.5, 4],
    [0, 4],
  ],
  [
    [0, 0],
    [6, 0],
    [6, 4],
    [4, 4],
    [4, 2],
    [2, 2],
    [2, 4],
    [0, 4],
  ],
  [
    [0, 0],
    [2, 0],
    [2, -1.5],
    [4, -1.5],
    [4, 0],
    [6, 0],
    [6, 3],
    [0, 3],
  ],
];

function townPoints(rng: Rng): Pts {
  const tpl = TOWN_TEMPLATES[Math.floor(rng() * TOWN_TEMPLATES.length)];
  const cell = 70 + rng() * 14;
  const flip = rng() < 0.5 ? -1 : 1;
  const turn = rng() * Math.PI * 2;
  const corners = tpl.map(([cx, cz]) => [cx * cell, cz * cell * flip]);
  const x: number[] = [];
  const z: number[] = [];
  const m = corners.length;
  const cut = 55;
  for (let i = 0; i < m; i++) {
    const [ax, az] = corners[(i - 1 + m) % m];
    const [bx, bz] = corners[i];
    const [cx, cz] = corners[(i + 1) % m];
    const l1 = Math.hypot(bx - ax, bz - az);
    const l2 = Math.hypot(cx - bx, cz - bz);
    // Point before the corner, the middle of a circular arc through the corner, point after.
    const ux = (ax - bx) / l1 + (cx - bx) / l2;
    const uz = (az - bz) / l1 + (cz - bz) / l2;
    const ul = Math.hypot(ux, uz) || 1;
    const half = Math.acos(Math.max(-1, Math.min(1, ((ax - bx) * (cx - bx) + (az - bz) * (cz - bz)) / (l1 * l2)))) / 2;
    const r = cut * Math.tan(half);
    const mid = r / Math.sin(half) - r;
    x.push(bx - ((bx - ax) / l1) * cut, bx + (ux / ul) * mid, bx + ((cx - bx) / l2) * cut);
    z.push(bz - ((bz - az) / l1) * cut, bz + (uz / ul) * mid, bz + ((cz - bz) / l2) * cut);
    // Fill long straights so the spline stays straight.
    const fill = Math.floor((l2 - 2 * cut) / 60);
    for (let f = 1; f <= fill; f++) {
      const t = (cut + ((l2 - 2 * cut) * f) / (fill + 1)) / l2;
      x.push(bx + (cx - bx) * t);
      z.push(bz + (cz - bz) * t);
    }
  }
  return {
    x: x.map((px, i) => px * Math.cos(turn) - z[i] * Math.sin(turn)),
    z: x.map((px, i) => px * Math.sin(turn) + z[i] * Math.cos(turn)),
  };
}

function speedwayPoints(rng: Rng): Pts {
  const a = 300 + rng() * 60;
  const b = 110 + rng() * 30;
  const k = 22;
  const chicane = Math.floor(rng() * k);
  const x: number[] = [];
  const z: number[] = [];
  for (let i = 0; i < k; i++) {
    const t = (i / k) * Math.PI * 2;
    // A stadium: squarer than an ellipse.
    const c = Math.cos(t);
    const s = Math.sin(t);
    let px = a * Math.sign(c) * Math.abs(c) ** 0.55;
    let pz = b * Math.sign(s) * Math.abs(s) ** 0.55;
    // An S-bend on one straight.
    const d = (i - chicane + k) % k;
    if (d === 0 || d === 3) pz *= 0.82;
    if (d === 1 || d === 2) pz *= 0.4;
    px += (rng() - 0.5) * 10;
    x.push(px);
    z.push(pz);
  }
  return { x, z };
}

const GENERATORS: Record<Shape, (rng: Rng) => Pts> = {
  ring: ringPoints,
  kidney: kidneyPoints,
  clover: cloverPoints,
  figure8: figure8Points,
  town: townPoints,
  speedway: speedwayPoints,
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Pairs of samples where the centre line crosses itself, with the angle between the roads. */
export function crossings(x: ArrayLike<number>, z: ArrayLike<number>): { i: number; j: number; angle: number }[] {
  const n = x.length;
  const out: { i: number; j: number; angle: number }[] = [];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      const j2 = (j + 1) % n;
      if (j2 === i) continue;
      const d1x = x[i2] - x[i];
      const d1z = z[i2] - z[i];
      const d2x = x[j2] - x[j];
      const d2z = z[j2] - z[j];
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const ex = x[j] - x[i];
      const ez = z[j] - z[i];
      const s = (ex * d2z - ez * d2x) / den;
      const u = (ex * d1z - ez * d1x) / den;
      if (s >= 0 && s < 1 && u >= 0 && u < 1) {
        const cos = Math.abs(d1x * d2x + d1z * d2z) / (Math.hypot(d1x, d1z) * Math.hypot(d2x, d2z));
        out.push({ i, j, angle: Math.acos(Math.min(1, cos)) });
      }
    }
  }
  return out;
}

/**
 * Is a sampled centre line a valid track: no tight corners, and never close to itself
 * except, when `allowCrossing`, at one clean crossing (which becomes a bridge)?
 */
export function validTrack(x: ArrayLike<number>, z: ArrayLike<number>, allowCrossing = false): boolean {
  return trackProblem(x, z, allowCrossing) === null;
}

/** Why a centre line isn't a valid track, or null if it is. */
export function trackProblem(x: ArrayLike<number>, z: ArrayLike<number>, allowCrossing = false): string | null {
  const n = x.length;
  // Corner radius from the turn over a 12 m window (single samples are too noisy).
  const W = 3;
  for (let i = 0; i < n; i++) {
    const a = (i - W + n) % n;
    const a2 = (a + 1) % n;
    const c = (i + W) % n;
    const c2 = (c - 1 + n) % n;
    const h1 = Math.atan2(z[a2] - z[a], x[a2] - x[a]);
    const h2 = Math.atan2(z[c] - z[c2], x[c] - x[c2]);
    let turn = Math.abs(h2 - h1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const r = ((2 * W - 1) * SPACING) / turn;
    if (turn > 1e-6 && r < MIN_RADIUS) return `corner radius ${r.toFixed(1)} at ${i}`;
  }
  const cross = crossings(x, z);
  if (cross.length > (allowCrossing ? 1 : 0)) return `${cross.length} crossings`;
  const cr = cross[0];
  if (cr && cr.angle < (50 * Math.PI) / 180) return 'shallow crossing';
  const near = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, n - d) <= CROSS_ZONE;
  };
  const skip = Math.ceil((MIN_GAP * 2) / SPACING);
  for (let i = 0; i < n; i += 2) {
    for (let j = i + skip; j < n; j += 2) {
      if (n - (j - i) < skip) continue;
      if (cr && ((near(i, cr.i) && near(j, cr.j)) || (near(i, cr.j) && near(j, cr.i)))) continue;
      if (Math.hypot(x[i] - x[j], z[i] - z[j]) < MIN_GAP) return `gap ${Math.hypot(x[i] - x[j], z[i] - z[j]).toFixed(0)} between ${i} and ${j}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** Laps come out roughly this long (metres), so races last about the same whatever the shape. */
const TARGET_MIN = 1000;
const TARGET_MAX = 1350;

export function candidate(shape: Shape, rng: Rng): Pts {
  const p = GENERATORS[shape](rng);
  let s = spline(p.x, p.z, 24);
  let len = 0;
  for (let i = 0; i < s.x.length; i++) len += Math.hypot(s.x[(i + 1) % s.x.length] - s.x[i], s.z[(i + 1) % s.z.length] - s.z[i]);
  const want = TARGET_MIN + rng() * (TARGET_MAX - TARGET_MIN);
  const k = want / len;
  if (Math.abs(k - 1) > 0.05) s = spline(p.x.map((v) => v * k), p.z.map((v) => v * k), 24);
  return resample(s.x, s.z, SPACING);
}

/** Pick a shape for a seed. */
export function shapeFor(seed: number): Shape {
  return SHAPES[Math.floor(mulberry32(seed ^ 0x5bd1e995)() * SHAPES.length)];
}

/** Build a random, closed, drivable track. The same seed (and shape) always gives the same track. */
export function generateTrack(seed: number, shape: Shape = shapeFor(seed)): Track {
  const rng = mulberry32(seed);
  const cross = shape === 'figure8';
  let pts = candidate(shape, rng);
  let tries = 0;
  for (; tries < 300 && !validTrack(pts.x, pts.z, cross); tries++) pts = candidate(shape, rng);
  if (tries >= 300) {
    // Extremely unlikely; a ring always works eventually.
    shape = 'ring';
    while (!validTrack(pts.x, pts.z)) pts = candidate('ring', rng);
  }
  const n = pts.x.length;
  const cr = shape === 'figure8' ? crossings(pts.x, pts.z)[0] ?? null : null;

  // Start on the straightest stretch, away from any crossing.
  const heading = (i: number) => Math.atan2(pts.z[(i + 1) % n] - pts.z[i], pts.x[(i + 1) % n] - pts.x[i]);
  const ringDist = (a: number, b: number) => Math.min(Math.abs(a - b), n - Math.abs(a - b));
  let best = 0;
  let bestTurn = Infinity;
  for (let i = 0; i < n; i++) {
    if (cr && (ringDist(i, cr.i) < CROSS_ZONE * 1.5 || ringDist(i, cr.j) < CROSS_ZONE * 1.5)) continue;
    let turn = 0;
    for (let k = -12; k < 12; k++) {
      const d = heading((i + k + 1 + n) % n) - heading((i + k + n) % n);
      turn += Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    }
    if (turn < bestTurn) {
      bestTurn = turn;
      best = i;
    }
  }
  const order = Array.from({ length: n }, (_, i) => (i + best) % n);
  if (rng() < 0.5) order.reverse();
  const xs = Float64Array.from(order, (i) => pts.x[i]);
  const zs = Float64Array.from(order, (i) => pts.z[i]);
  const remap = (orig: number) => order.indexOf(orig);

  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  const dist = new Float64Array(n);
  let length = 0;
  for (let i = 0; i < n; i++) {
    const c = (i + 1) % n;
    const dx = xs[c] - xs[i];
    const dz = zs[c] - zs[i];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
    dist[i] = length;
    length += l;
  }

  // Gentle hills: a couple of sine waves around the lap, flat at the start line.
  const hs = new Float64Array(n);
  const flatTown = shape === 'town' ? 0.35 : 1;
  const waves = [
    { k: 2, a: (1 + rng() * 2) * flatTown, p: rng() * Math.PI * 2 },
    { k: 3, a: (1 + rng() * 2.5) * flatTown, p: rng() * Math.PI * 2 },
    { k: 5, a: rng() * 1.2 * flatTown, p: rng() * Math.PI * 2 },
  ];
  const at = (t: number) => waves.reduce((h, w) => h + w.a * Math.sin(Math.PI * 2 * w.k * t + w.p), 0);
  const h0 = at(0);
  for (let i = 0; i < n; i++) hs[i] = Math.max(-MAX_HILL, Math.min(MAX_HILL, at(dist[i] / length) - h0));

  // Figure eight: the road after the start goes over, the other one under.
  const bridge = new Uint8Array(n);
  let crossing: Track['crossing'] = null;
  if (cr) {
    let a = remap(cr.i);
    let b = remap(cr.j);
    if (b < a) [a, b] = [b, a];
    crossing = { over: a, under: b };
    const hu = hs[b];
    const ramp = (k: number, centre: number, inner: number, outer: number) => {
      const d = ringDist(k, centre);
      if (d <= inner) return 1;
      if (d >= outer) return 0;
      const t = 1 - (d - inner) / (outer - inner);
      return t * t * (3 - 2 * t);
    };
    for (let k = 0; k < n; k++) {
      const wu = ramp(k, b, 10, 40);
      if (wu > 0) hs[k] = hs[k] + (hu - hs[k]) * wu;
    }
    for (let k = 0; k < n; k++) {
      const wo = ramp(k, a, 12, 40);
      if (wo > 0) hs[k] = hs[k] + (hu + BRIDGE_HEIGHT - hs[k]) * wo;
      if (wo > 0.25) bridge[k] = 1;
    }
  }

  // A town: the whole lap on the town circuit, otherwise a stretch away from the start and bridge.
  let town: Track['town'] = null;
  if (shape === 'town') town = { from: 0, to: n };
  else {
    const span = Math.min(150, Math.floor(n * 0.3));
    for (let tryT = 0; tryT < 20 && !town; tryT++) {
      const from = Math.floor(n * (0.2 + rng() * 0.5));
      const clear = (k: number) => !bridge[k % n] && (!crossing || ringDist(k % n, crossing.under) > CROSS_ZONE);
      let ok = true;
      for (let k = from; k < from + span; k++) if (!clear(k)) ok = false;
      if (ok) town = { from, to: from + span };
    }
  }

  return { seed, shape, name: SHAPE_NAMES[shape], n, xs, zs, hs, tx, tz, dist, length, bridge, crossing, town };
}

export interface Projection {
  /** Nearest sample index. */
  i: number;
  /** Signed distance from the centre line, positive to the left. */
  lateral: number;
  /** Distance along the track from the start line, 0..length. */
  along: number;
  /** Road height at this point. */
  h: number;
}

/**
 * Project a point onto the track. `hint` is the sample index from last time: searching
 * near it is fast and stays on the right part of the track (which matters where a figure
 * eight crosses itself). Without a hint every sample is checked.
 */
export function project(t: Track, x: number, z: number, hint = -1): Projection {
  const n = t.n;
  let best = 0;
  let bestD = Infinity;
  const check = (j: number) => {
    const d = (t.xs[j] - x) ** 2 + (t.zs[j] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  };
  if (hint < 0) for (let j = 0; j < n; j++) check(j);
  else for (let k = -24; k <= 24; k++) check((hint + k + n) % n);
  // Use the segment the point lies on (the one starting at best, or the one before).
  let i = best;
  let s = (x - t.xs[i]) * t.tx[i] + (z - t.zs[i]) * t.tz[i];
  if (s < 0) {
    i = (best - 1 + n) % n;
    s = (x - t.xs[i]) * t.tx[i] + (z - t.zs[i]) * t.tz[i];
  }
  const segLen = (i === n - 1 ? t.length : t.dist[i + 1]) - t.dist[i];
  s = Math.max(0, Math.min(segLen, s));
  const lateral = (x - t.xs[i]) * t.tz[i] - (z - t.zs[i]) * t.tx[i];
  const f = segLen > 0 ? s / segLen : 0;
  const h = t.hs[i] + (t.hs[(i + 1) % n] - t.hs[i]) * f;
  let along = t.dist[i] + s;
  if (along >= t.length) along -= t.length;
  return { i, lateral, along, h };
}

/** A point on the track at distance `d` along it (wraps) and `lateral` to the left. */
export function pointAt(t: Track, d: number, lateral = 0): { x: number; z: number; h: number; heading: number; i: number } {
  const L = t.length;
  d = ((d % L) + L) % L;
  let lo = 0;
  let hi = t.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.dist[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const s = d - t.dist[i];
  const segLen = (i === t.n - 1 ? t.length : t.dist[i + 1]) - t.dist[i];
  return {
    x: t.xs[i] + t.tx[i] * s + t.tz[i] * lateral,
    z: t.zs[i] + t.tz[i] * s - t.tx[i] * lateral,
    h: t.hs[i] + (t.hs[(i + 1) % t.n] - t.hs[i]) * (segLen > 0 ? s / segLen : 0),
    heading: Math.atan2(t.tz[i], t.tx[i]),
    i,
  };
}
