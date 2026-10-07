/**
 * Strzelnica: a fairground shooting gallery. Pure rules and simulation (no DOM, no three.js):
 * crosshair motion, corks and reloading, the target schedule, hit testing in stage pixels and scoring.
 *
 * Target positions live in booth metres (x right, y up, each target on its own depth layer z);
 * the TV projects their bounds to 1920×1080 stage pixels and the hit test runs there.
 */
import { mulberry32 } from '../rng';

export const DT = 1 / 60;

export const GALLERY_ROUNDS = 3;
/** Tournament version: a single, longer round that mixes everything. */
export const GALLERY_ROUNDS_SHORT = 1;
export const ROUND_SECONDS = 30;
export const ROUND_SECONDS_SHORT = 40;
export const READY_MS = 3500;
export const OVER_MS = 6000;

// ---- crosshairs, corks, reloading -------------------------------------------------

export const STAGE_W = 1920;
export const STAGE_H = 1080;
/** Crosshairs stay inside this box (stage px): clear of the top bar and the counter. */
export const PLAY = { x0: 84, y0: 150, x1: 1836, y1: 905 } as const;
/** Full stick deflection crosses the stage in about this many seconds. */
export const CROSS_SECONDS = 1.1;
export const MAX_SPEED = STAGE_W / CROSS_SECONDS;
/** Speed curve: gentle deflections are much slower than full (precision), full is MAX_SPEED. */
export const SPEED_CURVE = 1.5;
/** How quickly the crosshair's velocity follows the stick (1/s): light acceleration. */
export const ACCEL = 11;

export const AMMO = 6;
export const RELOAD_S = 0.9;
/** Minimum time between two shots by one player. */
export const FIRE_GAP = 0.14;
/** Hit tolerance around a target's bounds, in stage px. */
export const HIT_PAD = 10;

export interface Shooter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ammo: number;
  /** Sim time when the reload finishes (0: not reloading). */
  reloadEnd: number;
  lastShot: number;
}

export function newShooter(i: number, n: number): Shooter {
  const span = PLAY.x1 - PLAY.x0;
  const x = PLAY.x0 + span * ((i + 0.5) / Math.max(1, n));
  return { x, y: 560, vx: 0, vy: 0, ammo: AMMO, reloadEnd: 0, lastShot: -9 };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Stick (−1..1 each, length ≤ 1) → target velocity in px/s. */
export function stickVelocity(sx: number, sy: number): [number, number] {
  const m = Math.min(1, Math.hypot(sx, sy));
  if (m < 1e-6) return [0, 0];
  const speed = MAX_SPEED * Math.pow(m, SPEED_CURVE);
  return [(sx / m) * speed, (sy / m) * speed];
}

/** Move a crosshair for one step. Returns true when a reload finished during it. */
export function stepShooter(s: Shooter, sx: number, sy: number, dt: number, t: number): boolean {
  const [tx, ty] = stickVelocity(sx, sy);
  const k = 1 - Math.exp(-ACCEL * dt);
  s.vx += (tx - s.vx) * k;
  s.vy += (ty - s.vy) * k;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  if (s.x < PLAY.x0) (s.x = PLAY.x0), (s.vx = Math.max(0, s.vx));
  if (s.x > PLAY.x1) (s.x = PLAY.x1), (s.vx = Math.min(0, s.vx));
  if (s.y < PLAY.y0) (s.y = PLAY.y0), (s.vy = Math.max(0, s.vy));
  if (s.y > PLAY.y1) (s.y = PLAY.y1), (s.vy = Math.min(0, s.vy));
  if (s.reloadEnd > 0 && t >= s.reloadEnd) {
    s.reloadEnd = 0;
    s.ammo = AMMO;
    return true;
  }
  return false;
}

export type FireResult = 'shot' | 'dry' | 'reloading' | 'wait';

/** Try to fire one cork at time `t`. Uses up a cork on 'shot'. */
export function tryFire(s: Shooter, t: number): FireResult {
  if (s.reloadEnd > 0) return 'reloading';
  if (t - s.lastShot < FIRE_GAP) return 'wait';
  if (s.ammo <= 0) {
    s.lastShot = t;
    return 'dry';
  }
  s.ammo--;
  s.lastShot = t;
  return 'shot';
}

/** Start a reload (also with corks left, which are thrown away). False if already reloading or full. */
export function tryReload(s: Shooter, t: number): boolean {
  if (s.reloadEnd > 0 || s.ammo >= AMMO) return false;
  s.reloadEnd = t + RELOAD_S;
  return true;
}

export const corks = (ammo: number) => '●'.repeat(Math.max(0, ammo)) + '○'.repeat(Math.max(0, AMMO - ammo));

// ---- targets -----------------------------------------------------------------------

export type Kind = 'ghost' | 'bat' | 'gold' | 'babcia';
export type Mode = 'glide' | 'fly' | 'popup' | 'window';

export const POINTS: Record<Kind, number> = { ghost: 1, bat: 2, gold: 5, babcia: -3 };

/** Half width / half height of each kind, in metres. */
export const SIZE: Record<Kind, { hw: number; hh: number }> = {
  ghost: { hw: 0.74, hh: 0.92 },
  bat: { hw: 0.74, hh: 0.48 },
  gold: { hw: 0.74, hh: 0.92 },
  babcia: { hw: 0.74, hh: 1.2 },
};

/** Visible half width of the booth at the targets' depth; targets glide in from just outside it. */
export const EDGE = 11.5;

/** Rails the cut-outs glide along (front to back). */
export const LANES = [
  { z: 1.5, y: 2.35 },
  { z: -1.8, y: 3.3 },
] as const;

/** Where bats and the golden ghost flit. */
export const AIR = { z: -2.6, y: 5.55 } as const;

/** Cut-out pieces in front of the pop-up targets (hedges, gravestones, waves). Targets rise from behind `top`. */
export const SPOTS = [
  { x: -7.5, top: 1.4, z: -0.7 },
  { x: -5.0, top: 1.6, z: -0.7 },
  { x: -2.5, top: 1.3, z: -0.7 },
  { x: 0, top: 1.4, z: -0.7 },
  { x: 2.5, top: 1.6, z: -0.7 },
  { x: 5.0, top: 1.3, z: -0.7 },
  { x: 7.5, top: 1.4, z: -0.7 },
] as const;

export interface Opening {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'window' | 'door' | 'attic';
  /** Lowest visible y (the hedge row hides the bottom of the door). */
  minY?: number;
}

/** Windows and doors of the haunted cottage (centred on x = 0, front wall at z = COTTAGE_Z). */
export const OPENINGS: readonly Opening[] = [
  { x: -2.1, y: 4.1, w: 1.35, h: 1.4, kind: 'window' },
  { x: 2.1, y: 4.1, w: 1.35, h: 1.4, kind: 'window' },
  { x: -2.1, y: 2.5, w: 1.35, h: 1.4, kind: 'window' },
  { x: 2.1, y: 2.5, w: 1.35, h: 1.4, kind: 'window' },
  { x: 0, y: 2.3, w: 1.5, h: 3.0, kind: 'door', minY: 1.9 },
  { x: 0, y: 5.75, w: 1.1, h: 1.1, kind: 'attic' },
];
export const COTTAGE_Z = -3.0;
/** The depth where a target sits inside an opening. */
export const WINDOW_Z = -3.65;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SpawnEvent {
  /** Seconds after the round starts. */
  t: number;
  kind: Kind;
  mode: Mode;
  /** Lane (glide), spot (popup) or opening (window) index. */
  slot: number;
  dir: 1 | -1;
  /** m/s for gliders and flyers. */
  speed: number;
  /** Seconds a pop-up stays up. */
  hold: number;
  /** Random phase for bobbing. */
  phase: number;
}

const RISE = 0.3;
const SINK = 0.3;
const HIT_LINGER = 0.75;

export function eventLife(e: SpawnEvent): number {
  switch (e.mode) {
    case 'glide':
    case 'fly':
      return (2 * EDGE) / e.speed;
    default:
      return RISE + e.hold + SINK;
  }
}

/** Scale of a target (cottage ones are a bit smaller to fit the openings). */
export const scaleOf = (e: Pick<SpawnEvent, 'mode' | 'kind'>) => (e.mode === 'window' ? (e.kind === 'babcia' ? 0.58 : 0.74) : 1);

export interface Target {
  id: number;
  ev: SpawnEvent;
  kind: Kind;
  mode: Mode;
  x: number;
  y: number;
  z: number;
  hw: number;
  hh: number;
  age: number;
  life: number;
  /** 0 hidden … 1 fully up (pop-ups and windows; always 1 for the others). */
  open: number;
  state: 'alive' | 'hit';
  /** Players that hit it (all of them scored). */
  by: number[];
  hitAge: number;
}

const ease = (k: number) => k * k * (3 - 2 * k);

function placeTarget(tg: Target) {
  const e = tg.ev;
  const a = tg.age;
  switch (e.mode) {
    case 'glide': {
      const lane = LANES[e.slot];
      tg.x = (e.dir > 0 ? -EDGE : EDGE) + e.dir * a * e.speed;
      tg.y = lane.y + Math.sin(a * 2.3 + e.phase) * 0.2;
      tg.z = lane.z;
      tg.open = 1;
      break;
    }
    case 'fly': {
      tg.x = (e.dir > 0 ? -EDGE : EDGE) + e.dir * a * e.speed;
      const amp = e.kind === 'gold' ? 0.55 : 0.95;
      tg.y = AIR.y + Math.sin(a * (e.kind === 'gold' ? 3.2 : 4.4) + e.phase) * amp + (e.kind === 'bat' ? Math.sin(a * 1.3 + e.phase) * 0.5 : 0);
      tg.z = AIR.z + (e.kind === 'gold' ? 0.3 : 0);
      tg.open = 1;
      break;
    }
    case 'popup': {
      const s = SPOTS[e.slot];
      const up = a < RISE ? ease(a / RISE) : a < RISE + e.hold ? 1 : 1 - ease((a - RISE - e.hold) / SINK);
      tg.open = clamp(up, 0, 1);
      const shown = s.top - 0.2 + tg.hh;
      const hidden = s.top - tg.hh * 2 - 0.1;
      tg.x = s.x;
      tg.z = s.z - 0.25;
      tg.y = hidden + (shown - hidden) * tg.open;
      break;
    }
    case 'window': {
      const o = OPENINGS[e.slot];
      const up = a < RISE ? ease(a / RISE) : a < RISE + e.hold ? 1 : 1 - ease((a - RISE - e.hold) / SINK);
      tg.open = clamp(up, 0, 1);
      const bottom = Math.max(o.y - o.h / 2, o.minY ?? -99);
      const shown = bottom + tg.hh + 0.04 + Math.sin(a * 5 + e.phase) * 0.03;
      const hidden = bottom - tg.hh - 0.3;
      tg.x = o.x;
      tg.z = WINDOW_Z;
      tg.y = hidden + (shown - hidden) * tg.open;
      break;
    }
  }
}

/** The part of a target that can be hit, in booth metres; null while it is hidden or nearly hidden. */
export function targetBounds(tg: Pick<Target, 'x' | 'y' | 'hw' | 'hh' | 'mode' | 'ev' | 'state'>): Rect | null {
  if (tg.state !== 'alive') return null;
  const r: Rect = { x0: tg.x - tg.hw, x1: tg.x + tg.hw, y0: tg.y - tg.hh, y1: tg.y + tg.hh };
  const full = r.y1 - r.y0;
  if (tg.mode === 'popup') r.y0 = Math.max(r.y0, SPOTS[tg.ev.slot].top);
  else if (tg.mode === 'window') {
    const o = OPENINGS[tg.ev.slot];
    r.x0 = Math.max(r.x0, o.x - o.w / 2);
    r.x1 = Math.min(r.x1, o.x + o.w / 2);
    r.y0 = Math.max(r.y0, o.y - o.h / 2, o.minY ?? -99);
    r.y1 = Math.min(r.y1, o.y + o.h / 2);
  }
  if (r.x1 - r.x0 < 0.2 || r.y1 - r.y0 < full * 0.38) return null;
  return r;
}

// ---- the schedule ---------------------------------------------------------------------

export interface Profile {
  /** Seconds between spawns at the start and at the end of the round (before player scaling). */
  gap: [number, number];
  /** Chance that a spawn is a given mode (the rest is 'glide'). */
  popup: number;
  window: number;
  bat: number;
  /** Chance a ghost-shaped spawn is a babcia decoy. */
  babcia: number;
  /** Golden ghosts in the round. */
  gold: number;
  /** Speed and hold-time scale. */
  speed: number;
  hold: [number, number];
}

/** Round 1: gliding ghosts. Round 2: pop-ups and bats. Round 3: everything, faster, more babcias. */
export const PROFILES: Profile[] = [
  { gap: [1.15, 0.8], popup: 0, window: 0, bat: 0, babcia: 0.14, gold: 1, speed: 1, hold: [1.7, 1.35] },
  { gap: [1.0, 0.7], popup: 0.34, window: 0.3, bat: 0.28, babcia: 0.18, gold: 2, speed: 1.15, hold: [1.5, 1.1] },
  { gap: [0.85, 0.5], popup: 0.24, window: 0.22, bat: 0.22, babcia: 0.27, gold: 3, speed: 1.4, hold: [1.25, 0.85] },
];
/** The tournament round mixes it all and ramps up over 40 s. */
export const PROFILE_SHORT: Profile = { gap: [1.05, 0.55], popup: 0.25, window: 0.22, bat: 0.2, babcia: 0.2, gold: 2, speed: 1.2, hold: [1.45, 0.95] };

export function profileFor(round: number, short: boolean): Profile {
  return short ? PROFILE_SHORT : PROFILES[clamp(round - 1, 0, PROFILES.length - 1)];
}

export const roundsFor = (short: boolean) => (short ? GALLERY_ROUNDS_SHORT : GALLERY_ROUNDS);
export const secondsFor = (short: boolean) => (short ? ROUND_SECONDS_SHORT : ROUND_SECONDS);

/** More players need more targets. */
export const densityFor = (players: number) => clamp(1 + 0.28 * (Math.max(1, players) - 1), 1, 2.4);

/** The whole round's targets, from a seed: the same seed, round and player count always give the same list. */
export function makeSchedule(seed: number, round: number, short: boolean, players = 1): SpawnEvent[] {
  const rnd = mulberry32((seed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0);
  const prof = profileFor(round, short);
  const dur = secondsFor(short);
  const dens = densityFor(players);
  const evs: SpawnEvent[] = [];
  const busy = {
    popup: SPOTS.map(() => 0),
    window: OPENINGS.map(() => 0),
    glide: LANES.map(() => 0),
    fly: [0],
  };
  const free = (mode: 'popup' | 'window', t: number) => {
    const n = mode === 'popup' ? SPOTS.length : OPENINGS.length;
    const start = Math.floor(rnd() * n);
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (busy[mode][i] <= t) return i;
    }
    return -1;
  };
  const end = dur - 2.4;
  let t = 1.0;
  while (t < end) {
    const f = (t - 1) / (end - 1);
    const hold = prof.hold[0] + (prof.hold[1] - prof.hold[0]) * f;
    const r = rnd();
    const decoy = rnd() < prof.babcia;
    const phase = rnd() * 6.28;
    const dir = (rnd() < 0.5 ? 1 : -1) as 1 | -1;
    if (r < prof.popup) {
      const slot = free('popup', t);
      if (slot >= 0) {
        const h = hold * (0.85 + rnd() * 0.3);
        evs.push({ t, kind: decoy ? 'babcia' : 'ghost', mode: 'popup', slot, dir, speed: 0, hold: h, phase });
        busy.popup[slot] = t + RISE + h + SINK + 0.3;
      }
    } else if (r < prof.popup + prof.window) {
      const slot = free('window', t);
      if (slot >= 0) {
        const h = hold * (0.85 + rnd() * 0.3);
        evs.push({ t, kind: decoy ? 'babcia' : 'ghost', mode: 'window', slot, dir, speed: 0, hold: h, phase });
        busy.window[slot] = t + RISE + h + SINK + 0.3;
      }
    } else if (r < prof.popup + prof.window + prof.bat) {
      if (busy.fly[0] <= t) {
        const speed = (6.2 + rnd() * 2.2) * prof.speed;
        evs.push({ t, kind: 'bat', mode: 'fly', slot: 0, dir, speed, hold: 0, phase });
        busy.fly[0] = t + 0.7;
      }
    } else {
      const slot = rnd() < 0.55 ? 0 : 1;
      const speed = (2.5 + rnd() * 1.2) * prof.speed;
      if (busy.glide[slot] <= t) {
        evs.push({ t, kind: decoy ? 'babcia' : 'ghost', mode: 'glide', slot, dir: slot === 0 ? dir : ((dir * -1) as 1 | -1), speed, hold: 0, phase });
        busy.glide[slot] = t + 1.9 / speed;
      }
    }
    t += (prof.gap[0] + (prof.gap[1] - prof.gap[0]) * f) * (0.75 + rnd() * 0.5) / dens;
  }
  // Golden ghosts: fast, brief, spread over the round.
  for (let g = 0; g < prof.gold; g++) {
    const lo = 4 + ((dur - 11) * g) / prof.gold;
    const gt = lo + rnd() * ((dur - 11) / prof.gold - 1);
    evs.push({ t: gt, kind: 'gold', mode: 'fly', slot: 0, dir: rnd() < 0.5 ? 1 : -1, speed: (9 + rnd() * 2) * Math.min(1.25, prof.speed), hold: 0, phase: rnd() * 6.28 });
  }
  evs.sort((a, b) => a.t - b.t);
  return evs;
}

// ---- the running round ------------------------------------------------------------------

export interface Shot {
  player: number;
  x: number;
  y: number;
}

/** A target as the hit test sees it: its bounds in stage px and how near it is to the viewer. */
export interface Cand {
  id: number;
  kind: Kind;
  rect: Rect;
  /** Bigger = nearer to the viewer (its z). */
  depth: number;
}

export interface HitResult {
  player: number;
  id: number;
  kind: Kind;
  points: number;
}

export function inRect(x: number, y: number, r: Rect, pad = 0) {
  return x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;
}

/** The target a shot at (x, y) hits: the nearest one under the crosshair, ties broken by distance to centre. */
export function pickTarget(x: number, y: number, cands: readonly Cand[], pad = HIT_PAD): Cand | null {
  let best: Cand | null = null;
  let bestD = Infinity;
  for (const c of cands) {
    if (!inRect(x, y, c.rect, pad)) continue;
    const d = Math.hypot(x - (c.rect.x0 + c.rect.x1) / 2, y - (c.rect.y0 + c.rect.y1) / 2);
    if (!best || c.depth > best.depth + 1e-6 || (Math.abs(c.depth - best.depth) <= 1e-6 && d < bestD)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/**
 * Resolve all shots fired in one frame against the targets as they stood at the start of the frame, so two
 * shooters who hit the same target in the same frame both score.
 */
export function resolveShots(shots: readonly Shot[], cands: readonly Cand[]): { hits: HitResult[]; misses: number[] } {
  const hits: HitResult[] = [];
  const misses: number[] = [];
  for (const s of shots) {
    const c = pickTarget(s.x, s.y, cands);
    if (c) hits.push({ player: s.player, id: c.id, kind: c.kind, points: POINTS[c.kind] });
    else misses.push(s.player);
  }
  return { hits, misses };
}

export interface Tally {
  hits: number;
  /** Hits on each kind. */
  kinds: Record<Kind, number>;
  shots: number;
  points: number;
}

export const newTally = (): Tally => ({ hits: 0, kinds: { ghost: 0, bat: 0, gold: 0, babcia: 0 }, shots: 0, points: 0 });

/** Add a hit to a player's tally. Babcia hits count as shots fired but cost points; `hits` counts only good hits. */
export function scoreHit(t: Tally, kind: Kind) {
  t.kinds[kind]++;
  t.points += POINTS[kind];
  if (kind !== 'babcia') t.hits++;
}

export class GallerySim {
  t = 0;
  readonly events: SpawnEvent[];
  readonly duration: number;
  targets: Target[] = [];
  private next = 0;
  private nextId = 1;

  constructor(
    readonly seed: number,
    readonly round: number,
    readonly short: boolean,
    readonly players = 1,
  ) {
    this.events = makeSchedule(seed, round, short, players);
    this.duration = secondsFor(short);
  }

  get done() {
    return this.t >= this.duration;
  }

  step(dt: number) {
    this.t += dt;
    while (this.next < this.events.length && this.events[this.next].t <= this.t) {
      const ev = this.events[this.next++];
      const size = SIZE[ev.kind];
      const sc = scaleOf(ev);
      const tg: Target = {
        id: this.nextId++,
        ev,
        kind: ev.kind,
        mode: ev.mode,
        x: 0,
        y: 0,
        z: 0,
        hw: size.hw * sc,
        hh: size.hh * sc,
        age: this.t - ev.t,
        life: eventLife(ev),
        open: 0,
        state: 'alive',
        by: [],
        hitAge: 0,
      };
      placeTarget(tg);
      this.targets.push(tg);
    }
    for (const tg of this.targets) {
      tg.age += dt;
      if (tg.state === 'hit') tg.hitAge += dt;
      else placeTarget(tg);
    }
    this.targets = this.targets.filter((tg) => (tg.state === 'hit' ? tg.hitAge < HIT_LINGER : tg.age < tg.life));
  }

  /** Targets that can be hit right now, with their world bounds. */
  hittable(): { target: Target; bounds: Rect }[] {
    const out: { target: Target; bounds: Rect }[] = [];
    for (const target of this.targets) {
      const bounds = targetBounds(target);
      if (bounds) out.push({ target, bounds });
    }
    return out;
  }

  /** Mark the targets in `hits` as hit (a target hit by two players stays one target). */
  applyHits(hits: readonly HitResult[]) {
    for (const h of hits) {
      const tg = this.targets.find((x) => x.id === h.id);
      if (!tg) continue;
      tg.state = 'hit';
      if (!tg.by.includes(h.player)) tg.by.push(h.player);
    }
  }
}

export function howTo(short: boolean): string[] {
  return [
    'Move your crosshair with the stick and press Fire to shoot a cork – you have six, then Reload.',
    'Ghosts score 1, bats 2 and the golden ghost 5, but shoot a babcia cut-out and you lose 3 points!',
    short ? 'One 40-second round with everything at once – most points wins.' : 'Three 30-second rounds, each faster and trickier – most points wins.',
  ];
}
