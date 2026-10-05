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

export interface Track {
  seed: number;
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
    for (let s = 0; s < per; s++) {
      const t = s / per;
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

function candidate(rng: Rng): { x: number[]; z: number[] } {
  const k = 9 + Math.floor(rng() * 6);
  const base = 200 + rng() * 70;
  let radii = Array.from({ length: k }, () => base * (0.5 + 0.5 * rng()));
  // Smooth neighbouring radii so corners stay drivable.
  radii = radii.map((r, i) => 0.5 * r + 0.25 * (radii[(i + k - 1) % k] + radii[(i + 1) % k]));
  const px: number[] = [];
  const pz: number[] = [];
  for (let i = 0; i < k; i++) {
    const a = ((i + (rng() - 0.5) * 0.5) / k) * Math.PI * 2;
    px.push(Math.cos(a) * radii[i]);
    pz.push(Math.sin(a) * radii[i] * (0.7 + 0.15 * rng()));
  }
  const s = spline(px, pz, 24);
  return resample(s.x, s.z, SPACING);
}

/** Is a sampled centre line a valid track (no tight corners, never close to itself)? */
export function validTrack(x: ArrayLike<number>, z: ArrayLike<number>): boolean {
  const n = x.length;
  // Corner radius from the turning angle between neighbouring segments.
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const c = (i + 1) % n;
    const h1 = Math.atan2(z[i] - z[a], x[i] - x[a]);
    const h2 = Math.atan2(z[c] - z[i], x[c] - x[i]);
    let turn = Math.abs(h2 - h1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 1e-6 && SPACING / turn < MIN_RADIUS) return false;
  }
  // Parts of the track that are far apart along the road must be far apart in space.
  const skip = Math.ceil((MIN_GAP * 2) / SPACING);
  for (let i = 0; i < n; i += 2) {
    for (let j = i + skip; j < n; j += 2) {
      if (n - (j - i) < skip) continue;
      if (Math.hypot(x[i] - x[j], z[i] - z[j]) < MIN_GAP) return false;
    }
  }
  return true;
}

/** Build a random, closed, drivable track. The same seed always gives the same track. */
export function generateTrack(seed: number): Track {
  const rng = mulberry32(seed);
  let pts = candidate(rng);
  for (let tries = 0; tries < 200 && !validTrack(pts.x, pts.z); tries++) pts = candidate(rng);
  const n0 = pts.x.length;

  // Start on the straightest stretch.
  const heading = (i: number) => Math.atan2(pts.z[(i + 1) % n0] - pts.z[i], pts.x[(i + 1) % n0] - pts.x[i]);
  let best = 0;
  let bestTurn = Infinity;
  for (let i = 0; i < n0; i++) {
    let turn = 0;
    for (let k = -12; k < 12; k++) {
      let d = heading((i + k + 1 + n0) % n0) - heading((i + k + n0) % n0);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turn += Math.abs(d);
    }
    if (turn < bestTurn) {
      bestTurn = turn;
      best = i;
    }
  }
  const n = n0;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts.x[(i + best) % n];
    zs[i] = pts.z[(i + best) % n];
  }
  // Drive anticlockwise or clockwise at random.
  if (rng() < 0.5) {
    xs.reverse();
    zs.reverse();
  }

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
  const waves = [
    { k: 2, a: 1 + rng() * 2, p: rng() * Math.PI * 2 },
    { k: 3, a: 1 + rng() * 2.5, p: rng() * Math.PI * 2 },
    { k: 5, a: rng() * 1.2, p: rng() * Math.PI * 2 },
  ];
  const at = (t: number) => waves.reduce((h, w) => h + w.a * Math.sin(Math.PI * 2 * w.k * t + w.p), 0);
  const h0 = at(0);
  for (let i = 0; i < n; i++) {
    const t = dist[i] / length;
    hs[i] = Math.max(-MAX_HILL, Math.min(MAX_HILL, at(t) - h0));
  }

  return { seed, n, xs, zs, hs, tx, tz, dist, length };
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
 * near it is fast and stays on the right part of the track. Without a hint every sample
 * is checked.
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
export function pointAt(t: Track, d: number, lateral = 0): { x: number; z: number; heading: number; i: number } {
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
  return {
    x: t.xs[i] + t.tx[i] * s + t.tz[i] * lateral,
    z: t.zs[i] + t.tz[i] * s - t.tx[i] * lateral,
    heading: Math.atan2(t.tz[i], t.tx[i]),
    i,
  };
}
