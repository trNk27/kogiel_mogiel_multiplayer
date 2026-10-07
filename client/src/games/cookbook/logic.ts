/**
 * Babcia’s Cookbook: pure simulation. No DOM, no three.js.
 *
 * World units are metres, y is up. The spine of the book is the line x = 0; the right-hand page is
 * the rectangle x 0..16, z -5.5..5.5 (the camera looks from +z, so +z is towards the viewer) and is
 * where everybody stands. The left-hand page lifts, swings over the spine and lands on it. It has
 * holes: a pierogi whose centre is inside a hole when the page lands lives, the rest are squashed.
 */
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

export const DT = 1 / 60;

/** Full game / tournament version. */
export const COOKBOOK_ROUNDS = 3;
export const COOKBOOK_ROUNDS_SHORT = 1;

// ---- the page ---------------------------------------------------------------------------------
export const PAGE_W = 16;
export const PAGE_D = 11;
export const PAGE_HALF_D = PAGE_D / 2;
/** Where a pierogi’s centre may be (a little in from the edge of the page). */
export const EDGE_MARGIN = 0.45;
export const PAGE_CORNERS: readonly { x: number; z: number }[] = [
  { x: 0, z: -PAGE_HALF_D },
  { x: 0, z: PAGE_HALF_D },
  { x: PAGE_W, z: -PAGE_HALF_D },
  { x: PAGE_W, z: PAGE_HALF_D },
];

// ---- timing -----------------------------------------------------------------------------------
/** Nobody is squashed for this long after the countdown. */
export const WAIT_TIME = 1.0;
/** How long a landed page lies on the right-hand page (players are frozen in their holes). */
export const HOLD_TIME = 0.6;
/** The round ends after this page lands, whoever is still standing (they share the win). */
export const MAX_PAGES = 24;
/** How long the page takes to flip back up to the left. */
export const RETURN_TIME = 0.75;
/** Page 1 swings for this long; each page after is a little quicker, down to SWING_MIN. */
export const SWING_START = 2.8;
export const SWING_MIN = 1.7;
export const SWING_STEP = 0.085;

// ---- players ----------------------------------------------------------------------------------
export const PLAYER_R = 0.65;
export const WALK_SPEED = 6;
export const ACCEL = 48;
export const DASH_SPEED = 14.5;
export const DASH_TIME = 0.2;
export const DASH_COOL = 1.5;
/** A dash that bumps someone gives them this much of a shove (m/s, fading fast). */
export const DASH_BUMP = 9;
/** How much time a walker needs before they are up to speed and have seen the page. */
export const REACTION = 0.3;
/** Extra distance a dash is worth over walking for the same time. */
export const DASH_BONUS = 2;

// ---- shapes -----------------------------------------------------------------------------------
export type HoleKind = 'rect' | 'circle' | 'pierogi' | 'star' | 'heart';
export const HOLE_KINDS: readonly HoleKind[] = ['circle', 'rect', 'pierogi', 'star', 'heart'];

interface P {
  x: number;
  z: number;
}

/**
 * A hole in the page. `x`, `z` is where its centre is when the page lands; `size` is the radius of
 * a circle with the same area (so a star and a circle of the same size are equally big); `rot` turns
 * it about its centre; `aspect` is the length : width ratio of a rectangle. A sliding hole starts
 * `slide` away from its final place and glides there while the page swings.
 */
export interface Hole {
  kind: HoleKind;
  x: number;
  z: number;
  size: number;
  rot: number;
  aspect: number;
  slide: { dx: number; dz: number } | null;
}

function polyArea(poly: P[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

/** Scale so the area is π (a unit circle's). */
function unitArea(poly: P[]): P[] {
  const k = Math.sqrt(Math.PI / polyArea(poly));
  return poly.map((p) => ({ x: p.x * k, z: p.z * k }));
}

const CIRCLE_SEGMENTS = 28;

function baseOutline(kind: HoleKind, aspect: number): P[] {
  switch (kind) {
    case 'circle': {
      const out: P[] = [];
      for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        out.push({ x: Math.cos(a), z: Math.sin(a) });
      }
      return out;
    }
    case 'rect': {
      const hd = Math.sqrt(Math.PI / (4 * aspect));
      const hw = hd * aspect;
      return [
        { x: -hw, z: -hd },
        { x: hw, z: -hd },
        { x: hw, z: hd },
        { x: -hw, z: hd },
      ];
    }
    case 'star': {
      const out: P[] = [];
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 1 : 0.5;
        out.push({ x: r * Math.sin(a), z: -r * Math.cos(a) });
      }
      return unitArea(out);
    }
    case 'heart': {
      const out: P[] = [];
      const N = 36;
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        out.push({ x, z: -y });
      }
      // Move the origin to the middle of the shape so "inside radius" is about the centre.
      let cx = 0;
      let cz = 0;
      for (const p of out) {
        cx += p.x;
        cz += p.z;
      }
      cx /= out.length;
      cz /= out.length;
      return unitArea(out.map((p) => ({ x: p.x - cx, z: p.z - cz })));
    }
    case 'pierogi': {
      // A half-moon with a crimped edge; the flat side faces +z (towards the viewer).
      const out: P[] = [];
      const N = 20;
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI;
        const r = 1 + (k % 2 === 1 ? 0.06 : 0);
        out.push({ x: Math.cos(a) * r, z: -Math.sin(a) * r });
      }
      // Origin at the middle of the biggest circle that fits (radius 1/2, half-way up).
      const shifted = out.map((p) => ({ x: p.x, z: p.z + 0.5 }));
      return unitArea(shifted);
    }
  }
}

const outlineCache = new Map<string, P[]>();

/** The outline of a hole of the given kind at size 1 (area π), centred on its origin, not rotated. */
export function unitOutline(kind: HoleKind, aspect = 1): P[] {
  const key = `${kind}:${kind === 'rect' ? aspect.toFixed(3) : ''}`;
  let o = outlineCache.get(key);
  if (!o) {
    o = baseOutline(kind, aspect);
    outlineCache.set(key, o);
  }
  return o;
}

function distToSegment(px: number, pz: number, a: P, b: P) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}

/** The radius of the biggest circle around the origin that fits in the polygon. */
export function inscribedRadius(poly: P[]) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, distToSegment(0, 0, poly[i], poly[(i + 1) % poly.length]));
  return m;
}

const radiiCache = new Map<string, { inner: number; outer: number }>();
function unitRadii(kind: HoleKind, aspect: number) {
  const key = `${kind}:${kind === 'rect' ? aspect.toFixed(3) : ''}`;
  let r = radiiCache.get(key);
  if (!r) {
    const o = unitOutline(kind, aspect);
    r = { inner: kind === 'circle' ? 1 : inscribedRadius(o), outer: Math.max(...o.map((p) => Math.hypot(p.x, p.z))) };
    if (kind === 'circle') r.outer = 1;
    radiiCache.set(key, r);
  }
  return r;
}

/** Radius of the circle around the centre that is certainly inside the hole. */
export const holeInRadius = (h: Hole) => unitRadii(h.kind, h.aspect).inner * h.size;
/** Radius of the circle around the centre that certainly contains the hole. */
export const holeOutRadius = (h: Hole) => unitRadii(h.kind, h.aspect).outer * h.size;

/** The corners of the hole in world coordinates, with the hole's centre at (cx, cz). */
export function holePolygon(h: Hole, cx = h.x, cz = h.z): P[] {
  const c = Math.cos(h.rot);
  const s = Math.sin(h.rot);
  return unitOutline(h.kind, h.aspect).map((p) => {
    const lx = p.x * h.size;
    const lz = p.z * h.size;
    // Same turn as three.js's rotation.y, so the 3D mesh and the maths agree.
    return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
  });
}

// ---- containment ------------------------------------------------------------------------------
export function pointInRect(px: number, pz: number, cx: number, cz: number, hw: number, hd: number, rot = 0) {
  const dx = px - cx;
  const dz = pz - cz;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // Undo the rotation used by `holePolygon`.
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= hw && Math.abs(lz) <= hd;
}

export function pointInCircle(px: number, pz: number, cx: number, cz: number, r: number) {
  return (px - cx) ** 2 + (pz - cz) ** 2 <= r * r;
}

/** Even-odd test; works for concave polygons such as the star and the heart. */
export function pointInPolygon(px: number, pz: number, poly: P[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Is the point inside the hole's footprint? Defaults to the place the hole ends up. */
export function holeContains(h: Hole, px: number, pz: number, cx = h.x, cz = h.z) {
  switch (h.kind) {
    case 'circle':
      return pointInCircle(px, pz, cx, cz, h.size);
    case 'rect': {
      const hd = Math.sqrt(Math.PI / (4 * h.aspect)) * h.size;
      return pointInRect(px, pz, cx, cz, hd * h.aspect, hd, h.rot);
    }
    default:
      return pointInPolygon(px, pz, holePolygon(h, cx, cz));
  }
}

/** Where a sliding hole is when the page's swing is `p` (0..1) of the way: it eases into its place. */
export function holeAt(h: Hole, p: number): P {
  if (!h.slide) return { x: h.x, z: h.z };
  const q = Math.max(0, Math.min(1, p));
  const k = (1 - q) * (1 - q);
  return { x: h.x + h.slide.dx * k, z: h.z + h.slide.dz * k };
}

// ---- the page schedule ------------------------------------------------------------------------
export interface PageSpec {
  /** 1 for the first page. */
  n: number;
  /** Seconds from the page lifting to it landing. */
  swing: number;
  hold: number;
  holes: Hole[];
}

/** How long page `n` takes from lifting to landing. */
export const swingTime = (n: number) => Math.max(SWING_MIN, SWING_START - SWING_STEP * (n - 1));

/** How many holes page `n` has: four, then three, then two, then mostly one. */
export function holeCount(n: number) {
  if (n <= 2) return 4;
  if (n <= 5) return 3;
  if (n <= 9) return 2;
  if (n >= 16) return 1;
  return n % 3 === 0 ? 1 : 2;
}

/** The "radius" (of a circle of the same area) of holes on page `n`. */
export const holeSize = (n: number) => Math.max(0.55, 2.2 * Math.pow(0.92, n - 1));

/** The furthest a pierogi can get from a standing start in `swing` seconds (walking, with one dash). */
export const reachDistance = (swing: number) => WALK_SPEED * Math.max(0, swing - REACTION) + DASH_BONUS;

/** Can a pierogi starting in any corner of the page get into this hole in time? */
export function holeReachable(h: Hole, swing: number, margin = 0.2) {
  const need = Math.max(...PAGE_CORNERS.map((c) => Math.hypot(c.x - h.x, c.z - h.z))) - holeInRadius(h);
  return need <= reachDistance(swing) - margin;
}

function kindsFor(n: number): HoleKind[] {
  const s = holeSize(n);
  if (s > 1.45) return ['circle', 'rect', 'pierogi', 'star', 'heart', 'circle', 'rect'];
  if (s > 0.95) return ['circle', 'rect', 'pierogi', 'heart', 'circle', 'rect'];
  return ['circle', 'rect', 'pierogi'];
}

/** The chance that a hole on page `n` slides while the page swings (late pages only). */
export const slideChance = (n: number) => (n < 6 ? 0 : Math.min(0.7, 0.2 + 0.05 * (n - 6)));

const GAP = 0.7;

function inBounds(x: number, z: number, r: number) {
  return x - r >= 0.3 && x + r <= PAGE_W - 0.3 && Math.abs(z) + r <= PAGE_HALF_D - 0.3;
}

/** Build page `n`. Deterministic for a given rng. Every hole is reachable from every corner in time. */
export function pageSpec(n: number, rng: Rng): PageSpec {
  const swing = swingTime(n);
  const count = holeCount(n);
  let scale = 1;
  const holes: Hole[] = [];
  let attempts = 0;
  let slider = false;
  while (holes.length < count && attempts < 600) {
    attempts++;
    // Squeezing in four big holes is hard: if we cannot, shrink a little, then give up on the last.
    if (attempts % 150 === 0) scale *= 0.92;
    const kinds = kindsFor(n);
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const aspect = kind === 'rect' ? 1 + rng() * 0.6 : 1;
    const size = Math.max(0.5, holeSize(n) * (0.94 + rng() * 0.12) * scale);
    const rot = kind === 'rect' ? Math.floor(rng() * 4) * (Math.PI / 4) * (rng() < 0.5 ? 1 : 0.5) : (rng() - 0.5) * 1.2;
    const h: Hole = { kind, x: 0, z: 0, size, rot, aspect, slide: null };
    if (holeInRadius(h) < 0.5) continue;
    const r = holeOutRadius(h);
    h.x = r + 0.3 + rng() * (PAGE_W - 2 * r - 0.6);
    h.z = -PAGE_HALF_D + r + 0.3 + rng() * (PAGE_D - 2 * r - 0.6);
    if (!inBounds(h.x, h.z, r) || !holeReachable(h, swing)) continue;
    if (!slider && rng() < slideChance(n)) {
      const a = rng() * Math.PI * 2;
      const len = 2.5 + rng() * 2;
      const dx = Math.cos(a) * len;
      const dz = Math.sin(a) * len * 0.6;
      if (inBounds(h.x + dx, h.z + dz, r)) {
        h.slide = { dx, dz };
        slider = true;
      }
    }
    const ok = holes.every((o) => {
      const need = holeOutRadius(o) + r + GAP;
      const samples = h.slide || o.slide ? [0, 0.25, 0.5, 0.75, 1] : [1];
      return samples.every((s) => {
        const a = holeAt(h, s);
        const b = holeAt(o, s);
        return Math.hypot(a.x - b.x, a.z - b.z) >= need;
      });
    });
    if (!ok) {
      if (h.slide) slider = false;
      continue;
    }
    holes.push(h);
  }
  if (holes.length === 0) {
    // Cannot happen with sane numbers, but a page must always have a way out.
    holes.push({ kind: 'circle', x: PAGE_W / 2, z: 0, size: holeSize(n), rot: 0, aspect: 1, slide: null });
  }
  return { n, swing, hold: HOLD_TIME, holes };
}

// ---- landing ----------------------------------------------------------------------------------
/** Is a pierogi at (x, z) inside any of the page's holes when it lands? */
export function safeOnLanding(holes: readonly Hole[], x: number, z: number) {
  return holes.some((h) => holeContains(h, x, z));
}

/** Split the players still standing into those who live and those who get squashed. */
export function resolveLanding(holes: readonly Hole[], players: readonly { x: number; z: number; alive: boolean }[]) {
  const squashed: number[] = [];
  const survivors: number[] = [];
  players.forEach((p, i) => {
    if (!p.alive) return;
    (safeOnLanding(holes, p.x, p.z) ? survivors : squashed).push(i);
  });
  return { squashed, survivors };
}

// ---- scoring ----------------------------------------------------------------------------------
/**
 * Round points. `outPage[i]` is the page player i was squashed on (null = still standing at the end);
 * `gone[i]` marks players who left the game. With 2+ players you score the number of players who were
 * squashed before you (on an earlier page), and the last ones standing – a lone survivor, or everyone
 * who was squashed together on the final page – get +2. On your own, you score the pages you survived.
 */
export function roundPoints(outPage: (number | null)[], gone: boolean[], solo: boolean, landed: number): number[] {
  if (solo) return outPage.map((o, i) => (gone[i] ? 0 : (o === null ? landed : o - 1)));
  const key = outPage.map((o) => (o === null ? Infinity : o));
  const live = key.map((_, i) => i).filter((i) => !gone[i]);
  const best = Math.max(...live.map((i) => key[i]), -Infinity);
  return key.map((k, i) => {
    if (gone[i]) return 0;
    const before = live.filter((j) => j !== i && key[j] < k).length;
    return before + (k === best ? 2 : 0);
  });
}

/** Who won the round (more than one on a tie); nobody when playing on your own. */
export function roundWinners(outPage: (number | null)[], gone: boolean[], solo: boolean): number[] {
  if (solo) return [];
  const key = outPage.map((o) => (o === null ? Infinity : o));
  const live = key.map((_, i) => i).filter((i) => !gone[i]);
  if (!live.length) return [];
  const best = Math.max(...live.map((i) => key[i]));
  return live.filter((i) => key[i] === best);
}

// ---- the simulation ---------------------------------------------------------------------------
export interface PadIn {
  /** Joystick, -1..1; +z is towards the viewer. */
  x: number;
  z: number;
  /** Dash presses since the last step. */
  dash: number;
}

export interface SimPlayer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Shoves from bumps and from crowding; fade away quickly. */
  kx: number;
  kz: number;
  alive: boolean;
  gone: boolean;
  /** The page this player was squashed on. */
  outPage: number | null;
  /** Seconds of dash left; the direction is fx, fz. */
  dashT: number;
  /** Sim time when the dash is ready again. */
  dashReady: number;
  fx: number;
  fz: number;
  bumped: Set<number>;
}

export type Phase = 'idle' | 'wait' | 'swing' | 'hold' | 'return' | 'done';

export type SimEvent =
  | { t: 'page'; n: number }
  | { t: 'land'; n: number; squashed: number[]; survivors: number[] }
  | { t: 'dash'; i: number }
  | { t: 'bump'; i: number; by: number }
  | { t: 'over' };

/** Where player `i` of `n` starts. */
export function spawnPoint(i: number, n: number): P {
  if (n <= 1) return { x: PAGE_W / 2, z: 1.5 };
  const top = Math.ceil(n / 2);
  const row = i < top ? 0 : 1;
  const cnt = row === 0 ? top : n - top;
  const k = row === 0 ? i : i - top;
  return { x: PAGE_W / 2 + (k - (cnt - 1) / 2) * 2.3, z: row === 0 ? -1.9 : 1.9 };
}

export class CookbookSim {
  readonly players: SimPlayer[];
  /** The page that is lifting, in the air or lying on the right. */
  page: PageSpec;
  /** The page that comes after it (known once this one has landed; before that it is just a preview). */
  next: PageSpec | null = null;
  phase: Phase = 'idle';
  phaseT = 0;
  time = 0;
  /** Pages that have landed. */
  landed = 0;
  over = false;
  readonly solo: boolean;

  constructor(
    count: number,
    private rng: Rng = Math.random,
    /** Players who are not in this round (they left the game). */
    gone: boolean[] = [],
  ) {
    this.players = Array.from({ length: count }, (_, i) => {
      const s = spawnPoint(i, count);
      return {
        x: s.x,
        z: s.z,
        vx: 0,
        vz: 0,
        kx: 0,
        kz: 0,
        alive: !gone[i],
        gone: !!gone[i],
        outPage: null,
        dashT: 0,
        dashReady: 0,
        fx: 0,
        fz: 1,
        bumped: new Set<number>(),
      };
    });
    this.solo = this.players.filter((p) => !p.gone).length <= 1;
    this.page = pageSpec(1, this.rng);
  }

  /** Start the clock: after WAIT_TIME the first page lifts. */
  begin() {
    if (this.phase === 'idle') {
      this.phase = 'wait';
      this.phaseT = 0;
    }
  }

  get aliveCount() {
    return this.players.filter((p) => p.alive && !p.gone).length;
  }

  /** A player left the game for good. */
  remove(i: number) {
    const p = this.players[i];
    if (!p) return;
    p.gone = true;
    p.alive = false;
  }

  /** Swing progress 0..1 of the page in the air (1 once landed). */
  get swingProgress() {
    if (this.phase === 'swing') return Math.min(1, this.phaseT / this.page.swing);
    if (this.phase === 'hold' || this.phase === 'return' || this.phase === 'done') return 1;
    return 0;
  }

  private checkOver() {
    const alive = this.aliveCount;
    return this.solo ? alive === 0 : alive <= 1;
  }

  step(inputs: readonly PadIn[]): SimEvent[] {
    const ev: SimEvent[] = [];
    this.time += DT;
    this.phaseT += DT;
    this.movePlayers(inputs, ev);
    this.collide(ev);

    switch (this.phase) {
      case 'wait':
        if (this.phaseT >= WAIT_TIME) this.startSwing(ev);
        break;
      case 'swing':
        if (this.phaseT >= this.page.swing) this.land(ev);
        break;
      case 'hold':
        if (this.phaseT >= this.page.hold) {
          this.phase = 'return';
          this.phaseT = 0;
          if (!this.over) this.next = pageSpec(this.page.n + 1, this.rng);
        }
        break;
      case 'return':
        if (this.phaseT >= RETURN_TIME) {
          if (this.over || !this.next) {
            this.phase = 'done';
          } else {
            this.page = this.next;
            this.next = null;
            this.startSwing(ev);
          }
          this.phaseT = 0;
        }
        break;
    }
    if (!this.over && this.phase !== 'idle' && this.checkOver()) {
      this.over = true;
      ev.push({ t: 'over' });
    }
    return ev;
  }

  private startSwing(ev: SimEvent[]) {
    this.phase = 'swing';
    this.phaseT = 0;
    ev.push({ t: 'page', n: this.page.n });
  }

  private land(ev: SimEvent[]) {
    this.phase = 'hold';
    this.phaseT = 0;
    this.landed++;
    let squashed: number[] = [];
    let survivors: number[] = [];
    if (!this.over) {
      const r = resolveLanding(this.page.holes, this.players);
      squashed = r.squashed;
      survivors = r.survivors;
      for (const i of squashed) {
        const p = this.players[i];
        p.alive = false;
        p.outPage = this.page.n;
        p.vx = p.vz = p.kx = p.kz = 0;
      }
    }
    ev.push({ t: 'land', n: this.page.n, squashed, survivors });
    if (!this.over && this.page.n >= MAX_PAGES) {
      this.over = true;
      ev.push({ t: 'over' });
    }
  }

  private movePlayers(inputs: readonly PadIn[], ev: SimEvent[]) {
    const frozen = this.phase === 'hold';
    this.players.forEach((p, i) => {
      if (!p.alive || p.gone) return;
      if (frozen) {
        p.vx = p.vz = p.kx = p.kz = 0;
        p.dashT = 0;
        return;
      }
      const inp = inputs[i] ?? { x: 0, z: 0, dash: 0 };
      let ix = Number.isFinite(inp.x) ? inp.x : 0;
      let iz = Number.isFinite(inp.z) ? inp.z : 0;
      const mag = Math.hypot(ix, iz);
      if (mag < 0.1) ix = iz = 0;
      else if (mag > 1) {
        ix /= mag;
        iz /= mag;
      }
      const m2 = Math.hypot(ix, iz);
      if (m2 >= 0.2) {
        p.fx = ix / m2;
        p.fz = iz / m2;
      }
      if (inp.dash > 0 && this.time >= p.dashReady && p.dashT <= 0) {
        const fl = Math.hypot(p.fx, p.fz) || 1;
        p.fx /= fl;
        p.fz /= fl;
        p.dashT = DASH_TIME;
        p.dashReady = this.time + DASH_COOL;
        p.bumped.clear();
        ev.push({ t: 'dash', i });
      }
      if (p.dashT > 0) {
        p.dashT -= DT;
        p.vx = p.fx * DASH_SPEED;
        p.vz = p.fz * DASH_SPEED;
      } else {
        const tx = ix * WALK_SPEED;
        const tz = iz * WALK_SPEED;
        const dx = tx - p.vx;
        const dz = tz - p.vz;
        const d = Math.hypot(dx, dz);
        const step = ACCEL * DT;
        if (d <= step) {
          p.vx = tx;
          p.vz = tz;
        } else {
          p.vx += (dx / d) * step;
          p.vz += (dz / d) * step;
        }
      }
      p.x += (p.vx + p.kx) * DT;
      p.z += (p.vz + p.kz) * DT;
      const decay = Math.exp(-7 * DT);
      p.kx *= decay;
      p.kz *= decay;
    });
    this.clamp();
  }

  private clamp() {
    for (const p of this.players) {
      if (!p.alive || p.gone) continue;
      p.x = Math.max(EDGE_MARGIN, Math.min(PAGE_W - EDGE_MARGIN, p.x));
      p.z = Math.max(-PAGE_HALF_D + EDGE_MARGIN, Math.min(PAGE_HALF_D - EDGE_MARGIN, p.z));
    }
  }

  /** Soft circles: overlapping pierogi are pushed apart (a bit springy), and a dash gives a real shove. */
  private collide(ev: SimEvent[]) {
    const ps = this.players;
    const min = PLAYER_R * 2;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        if (!a.alive || a.gone) continue;
        for (let j = i + 1; j < ps.length; j++) {
          const b = ps[j];
          if (!b.alive || b.gone) continue;
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let d = Math.hypot(dx, dz);
          if (d >= min) continue;
          if (d < 1e-6) {
            dx = Math.cos(i * 2.4 + j);
            dz = Math.sin(i * 2.4 + j);
            d = 1;
          }
          const nx = dx / d;
          const nz = dz / d;
          const ov = min - Math.hypot(b.x - a.x, b.z - a.z);
          if (pass === 0) {
            // A dash that touches someone shoves them (once per dash).
            for (const [x, y, ix, iy] of [
              [a, b, i, j],
              [b, a, j, i],
            ] as const) {
              if (x.dashT > 0 && !x.bumped.has(iy)) {
                x.bumped.add(iy);
                const s = x === a ? 1 : -1;
                y.kx += nx * s * DASH_BUMP;
                y.kz += nz * s * DASH_BUMP;
                x.dashT *= 0.5;
                ev.push({ t: 'bump', i: iy, by: ix });
              }
            }
            a.kx -= nx * ov * 0.6;
            a.kz -= nz * ov * 0.6;
            b.kx += nx * ov * 0.6;
            b.kz += nz * ov * 0.6;
          }
          const push = ov * 0.5 * 0.55;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }
    this.clamp();
  }

  /** Results so far (call once `over`). */
  results() {
    const outPage = this.players.map((p) => p.outPage);
    const gone = this.players.map((p) => p.gone);
    return {
      points: roundPoints(outPage, gone, this.solo, this.landed),
      winners: roundWinners(outPage, gone, this.solo),
      pages: this.landed,
    };
  }
}

// ---- page motion (shared by the 3D scene and the tests) --------------------------------------
/** Angle of the left-hand page in radians: 0 lying on the left, π lying on the right. */
export function pageAngle(phase: Phase, phaseT: number, swing: number): number {
  switch (phase) {
    case 'swing': {
      const p = Math.min(1, phaseT / swing);
      return Math.PI * (0.3 * p + 0.7 * p * p);
    }
    case 'hold':
      return Math.PI;
    case 'return': {
      const q = Math.min(1, phaseT / RETURN_TIME);
      return Math.PI * (1 - q * q * (3 - 2 * q));
    }
    default:
      return 0;
  }
}

export function howTo(short: boolean): string[] {
  return [
    'A giant page swings over and slams down. Every page has holes cut in it, shown by lit patches on the page below.',
    'Walk into a hole before it lands, or get squashed flat. Dash (the button) to hurry and to shove others out of the way.',
    short ? 'One round: last pierogi standing wins!' : 'Three rounds. Points for every pierogi squashed before you, and a bonus for the last one standing.',
  ];
}
