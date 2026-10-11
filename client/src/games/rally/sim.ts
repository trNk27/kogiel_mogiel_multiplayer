import type { KartStats, RallyEffect, RallyItem } from '../../../../shared/protocol';
import type { Rng } from '../rng';
import { ROAD_HALF, pointAt, project, type Track } from './track';

export const DT = 1 / 60;

/** Driving feel. Distances are metres-ish, so 42 units/s ≈ 150 km/h. */
export const RTUNING = {
  maxSpeed: 42,
  /** Top speed on the grass verge. */
  grassSpeed: 20,
  reverseSpeed: 10,
  accel: 20,
  brake: 45,
  /** Speed lost per second when coasting, as a fraction of speed. */
  drag: 0.35,
  /** Turning rate (rad/s) at full lock. Lower at top speed so it doesn't spin out. */
  steer: 2.3,
  steerAtTop: 0.55,
  carRadius: 1.7,
};

/** How a car drives. Plain Maluch Rally cars all get DEFAULT_SPEC; Maluch Rallye Premium's karts differ. */
export interface CarSpec {
  maxSpeed: number;
  accel: number;
  /** Turning rate at full lock (rad/s). */
  steer: number;
  /** Top speed off the road. */
  grassSpeed: number;
  /** Heavier cars shove lighter ones in a bump. */
  weight: number;
}

export const DEFAULT_SPEC: CarSpec = { maxSpeed: RTUNING.maxSpeed, accel: RTUNING.accel, steer: RTUNING.steer, grassSpeed: RTUNING.grassSpeed, weight: 1 };

/** Turn 1–5 kart stats into driving numbers. A 3 in everything is about the plain Maluch. */
export function kartSpec(s: KartStats): CarSpec {
  return {
    maxSpeed: 37 + 2 * s.speed,
    accel: 13 + 2.6 * s.accel,
    steer: 1.85 + 0.16 * s.handling,
    grassSpeed: 12 + 3.6 * s.offroad,
    weight: 0.7 + 0.12 * (s.speed + s.offroad) - 0.06 * s.accel,
  };
}

/**
 * Drifting: hold the brake while turning at speed. The car slides with its nose into the corner,
 * turns much tighter than grip allows and scrubs a little speed. Hold it long enough and letting
 * go gives a mini-turbo (blue sparks) or a super turbo (orange sparks).
 */
export const DRIFT = {
  minSpeed: 14,
  /** How far the nose points into the corner (radians). */
  slip: 0.42,
  /** Turn rate while drifting, as a multiple of normal full lock: steering out of / into the drift. */
  turnOut: 0.35,
  turnIn: 1.3,
  /** Speed lost per second while drifting, as a fraction. */
  scrub: 0.16,
  /** Seconds of drifting (more when steering into it) for each spark level. */
  mini: 0.8,
  super: 1.9,
  miniBoost: 0.6,
  superBoost: 1.15,
};

/** How a car's drift is reported over the network: 0 not drifting, 1 drifting, 2 blue sparks, 3 orange sparks. */
export function driftCode(c: Car) {
  return c.drift ? 1 + driftLevel(c) : 0;
}

/** Show a remote car drifting the way it was reported (only the look matters). */
export function setDriftLook(c: Car, code: number) {
  c.drift = code > 0 ? 1 : 0;
  c.driftCharge = code >= 3 ? DRIFT.super : code === 2 ? DRIFT.mini : 0;
}

/** Spark level of a drift: 0 none yet, 1 blue (mini-turbo), 2 orange (super turbo). */
export function driftLevel(c: Car) {
  if (!c.drift) return 0;
  return c.driftCharge >= DRIFT.super ? 2 : c.driftCharge >= DRIFT.mini ? 1 : 0;
}

/** Item timings and strengths. */
export const ITUNING = {
  boostTime: 2.2,
  /** Boost top speed, on top of the car's own top speed. */
  boostSpeed: 56,
  rocketTime: 3.5,
  rocketSpeed: 62,
  shieldTime: 10,
  spinTime: 1.1,
  slowTime: 3,
  slowFactor: 0.55,
  pickleSpeed: 72,
  pickleLife: 7,
  slickLife: 30,
  /** Babcia's Kapeć: flies over everything to the leader, then whacks everyone this close. */
  slipperSpeed: 105,
  slipperLife: 14,
  slipperRadius: 7,
  slipperSpin: 1.7,
  /** Kiełbasa Lasso: how long you're towed, how far ahead it reaches, how much the towed car slows, the slingshot. */
  towTime: 2.6,
  towReach: 140,
  towDrag: 0.68,
  towBoost: 1.3,
  /** Cabbage bombs fly this long before they go off, and hit everything this close. */
  bombFuse: 0.8,
  bombRadius: 8,
  bombSpin: 1.4,
  inkTime: 4,
  ghostTime: 4.5,
  boxRespawn: 3,
  /** Box rows along the lap (fractions of its length) and their lateral offsets. */
  boxRows: [0.24, 0.56, 0.83],
  boxLanes: [-4.5, -1.5, 1.5, 4.5],
  hitRadius: 2.3,
  /** Two things only touch if they're on the same level (not one on the bridge, one under it). */
  sameLevel: 3,
};

export const LAPS = 3;

export interface Car {
  idx: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Joystick: x steers (-100 left … 100 right), y is screen-down (-100 = full gas, 100 = brake). Brake while turning at speed drifts. */
  input: { x: number; y: number };
  /** Total distance driven along the track since the start line (negative on the grid). */
  progress: number;
  along: number;
  hint: number;
  lateral: number;
  h: number;
  onRoad: boolean;
  finished: boolean;
  finishTime: number | null;
  /** Highest lap boundary crossed, so driving back and forth over the line doesn't repeat events. */
  maxLap: number;
  /** Disconnected or removed players stop. */
  parked: boolean;
  /**
   * Driven somewhere else: the car's position comes from the network instead of its input.
   * (No-TV races: every phone drives its own car and the host only hears where it is.)
   */
  remote: boolean;
  /** Sim time of the last position report (remote cars). */
  seen: number;
  item: RallyItem | null;
  /** Seconds left of each effect. */
  boost: number;
  rocket: number;
  shield: number;
  spin: number;
  slow: number;
  /** Beet juice on the windscreen (only the driver's view cares). */
  ink: number;
  /** See-through and untouchable. */
  ghost: number;
  /** Kiełbasa Lasso: seconds left of being towed towards `towTarget` (yours), or of being dragged back (theirs). */
  tow: number;
  towTarget: number;
  towed: number;
  /** How this car drives. */
  spec: CarSpec;
  /** Extra yaw while spinning out (just for show). */
  spinAngle: number;
  /** Drifting: -1 to the left, 1 to the right, 0 not drifting. */
  drift: number;
  /** Seconds of drift built up (see DRIFT.mini / DRIFT.super). */
  driftCharge: number;
  /** Angle between where the car points and where it's going (drifting). */
  slip: number;
}

export interface ItemBox {
  x: number;
  z: number;
  h: number;
  /** Sim time when the box comes back (0 = there now). */
  back: number;
}

export type HazardKind = 'butter';
/** Hazard kinds by their number in a no-TV snapshot. */
export const HAZARDS: readonly HazardKind[] = ['butter'];

/** Something left on the road: a butter slick. */
export interface Slick {
  kind: HazardKind;
  x: number;
  z: number;
  h: number;
  heading: number;
  until: number;
  owner: number;
  safeUntil: number;
}

/** A cabbage lobbed down the road; it goes off when its fuse runs out. */
export interface Bomb {
  d: number;
  lateral: number;
  speed: number;
  x: number;
  z: number;
  h: number;
  age: number;
  owner: number;
}

/** A cabbage (or a slipper) going off (for show). */
export interface Blast {
  x: number;
  z: number;
  h: number;
  at: number;
  /** How far it reaches. */
  r: number;
}

/** Things that fly along the road after a car: pickle missiles and Babcia's slipper. */
export type MissileKind = 'pickle' | 'slipper';
export const MISSILES: readonly MissileKind[] = ['pickle', 'slipper'];

export interface Pickle {
  kind: MissileKind;
  /** Distance along the track. */
  d: number;
  lateral: number;
  x: number;
  z: number;
  h: number;
  heading: number;
  owner: number;
  target: number | null;
  until: number;
}

export interface Hit {
  idx: number;
  by: number;
  kind: RallyItem;
  blocked: boolean;
}

export interface StepEvents {
  laps: { idx: number; lap: number }[];
  finished: number[];
  bumps: number[];
  pickups: { idx: number; item: RallyItem }[];
  /** Items fired. A lasso says which car it caught (`tow`, -1 for none). */
  used: { idx: number; item: RallyItem; tow?: number }[];
  hits: Hit[];
  /** A ghost took someone's item. */
  steals: { idx: number; from: number; item: RallyItem }[];
  /** Somebody let go of a drift with sparks: 1 mini-turbo, 2 super turbo. */
  turbos: { idx: number; level: number }[];
}

/** Grid slot `k`: two columns, rows going back from the start line. */
export function gridSlot(track: Track, k: number) {
  const row = Math.floor(k / 2);
  const back = 6 + row * 7 + (k % 2) * 2.5;
  return pointAt(track, -back, k % 2 === 0 ? 3.2 : -3.2);
}

/**
 * Item odds by race position: `f` is 0 for the leader and 1 for last place.
 * Leaders mostly get defence; the back of the field gets the catch-up items.
 */
export function itemWeights(f: number, cars: number): Record<RallyItem, number> {
  if (cars <= 1) return { boost: 3, butter: 0, pickle: 0, lid: 0, storm: 0, rocket: 1, bomb: 0, beet: 0, ghost: 0.5, lasso: 0, slipper: 0 };
  return {
    boost: 2 + 2 * f,
    butter: 2.6 - 1.6 * f,
    pickle: 1.5 + 1.5 * f,
    lid: 2.2 - 1.4 * f,
    storm: f < 0.3 ? 0 : 1.6 * f,
    rocket: f < 0.6 ? 0 : 3 * f,
    bomb: 1.2 + 0.6 * f,
    beet: f < 0.2 ? 0 : 1.8 * f,
    ghost: 0.5 + 1.2 * f,
    lasso: f < 0.15 ? 0 : 0.6 + 1.6 * f,
    slipper: f < 0.4 ? 0 : 1.4 * f,
  };
}

export function rollItem(f: number, cars: number, rng: Rng): RallyItem {
  const w = itemWeights(f, cars);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (const [k, v] of Object.entries(w) as [RallyItem, number][]) {
    r -= v;
    if (r < 0) return k;
  }
  return 'boost';
}

/**
 * What using an item does to your own car (the rest happens out on the track).
 * `tow` is the car a Kiełbasa Lasso caught (-1 or missing: it caught nobody, and works like a boost).
 */
export function selfEffect(c: Car, item: RallyItem, tow = -1) {
  const I = ITUNING;
  switch (item) {
    case 'boost':
      // Kompot washes the barszcz off and shakes off the storm.
      c.boost = I.boostTime;
      c.speed = Math.max(c.speed, 46);
      c.ink = 0;
      c.slow = 0;
      break;
    case 'rocket':
      c.rocket = I.rocketTime;
      c.spin = 0;
      c.slow = 0;
      c.tow = 0;
      break;
    case 'lid':
      c.shield = I.shieldTime;
      break;
    case 'ghost':
      c.ghost = I.ghostTime;
      c.spin = 0;
      break;
    case 'lasso':
      if (tow >= 0) {
        c.tow = I.towTime;
        c.towTarget = tow;
        c.spin = 0;
      } else {
        // Nobody to catch: just a quick tug forward.
        c.boost = Math.max(c.boost, I.towBoost);
        c.speed = Math.max(c.speed, 42);
      }
      break;
  }
}

/** A lasso tow ends (caught up, or out of time): let go and slingshot. */
export function endTow(c: Car) {
  if (c.tow <= 0) return;
  c.tow = 0;
  c.boost = Math.max(c.boost, ITUNING.towBoost);
  c.speed = Math.max(c.speed, 46);
}

/** What being hit does to a car (shields, rockets and ghosts are dealt with by the caller). */
export function hitEffect(c: Car, kind: RallyItem) {
  const I = ITUNING;
  if (kind === 'beet') {
    c.ink = Math.max(c.ink, I.inkTime);
    return;
  }
  if (kind === 'lasso') {
    c.towed = I.towTime;
    return;
  }
  if (kind === 'storm') {
    // Struck by lightning: slowed, a wobble, and whatever you were holding is gone.
    c.slow = I.slowTime;
    c.spin = Math.max(c.spin, 0.5);
    c.item = null;
  } else if (kind === 'pickle') {
    // A pickle knocks the item out of your hands.
    c.spin = I.spinTime;
    c.item = null;
  } else if (kind === 'slipper') {
    c.spin = I.slipperSpin;
    c.speed = Math.min(c.speed, 12);
  } else c.spin = kind === 'bomb' ? I.bombSpin : I.spinTime;
  c.boost = 0;
  c.tow = 0;
}

/** Are a car's item effects protecting it from hits? */
export function immune(c: Car) {
  return c.rocket > 0 || c.ghost > 0 || c.finished;
}

export interface SimOptions {
  /**
   * Does this sim run the items (boxes, hits, missiles)? The host's does; a phone's copy in a
   * no-TV race only drives its own car and shows what the host says is on the track.
   */
  authority?: boolean;
  /** Indices of the cars driven elsewhere (see Car.remote). */
  remote?: (idx: number) => boolean;
  /** How each car drives (default: all the same). */
  specs?: CarSpec[];
}

export class RallySim {
  cars: Car[];
  time = 0;
  boxes: ItemBox[] = [];
  slicks: Slick[] = [];
  pickles: Pickle[] = [];
  bombs: Bomb[] = [];
  blasts: Blast[] = [];
  readonly authority: boolean;
  private pending: StepEvents['used'] = [];
  private pendingHits: Hit[] = [];
  private pendingSteals: StepEvents['steals'] = [];

  constructor(
    public track: Track,
    count: number,
    public laps = LAPS,
    items = true,
    private rng: Rng = Math.random,
    opts: SimOptions = {},
  ) {
    this.authority = opts.authority ?? true;
    this.cars = Array.from({ length: count }, (_, idx) => {
      const p = gridSlot(track, idx);
      const pr = project(track, p.x, p.z);
      const progress = pr.along > track.length / 2 ? pr.along - track.length : pr.along;
      return {
        idx,
        x: p.x,
        z: p.z,
        heading: p.heading,
        speed: 0,
        input: { x: 0, y: 0 },
        progress,
        along: pr.along,
        hint: pr.i,
        lateral: pr.lateral,
        h: pr.h,
        onRoad: true,
        finished: false,
        finishTime: null,
        maxLap: 0,
        parked: false,
        remote: opts.remote?.(idx) ?? false,
        seen: 0,
        item: null,
        boost: 0,
        rocket: 0,
        shield: 0,
        spin: 0,
        slow: 0,
        ink: 0,
        ghost: 0,
        tow: 0,
        towTarget: -1,
        towed: 0,
        spec: opts.specs?.[idx] ?? DEFAULT_SPEC,
        spinAngle: 0,
        drift: 0,
        driftCharge: 0,
        slip: 0,
      };
    });
    if (items) {
      for (const f of ITUNING.boxRows)
        for (const lane of ITUNING.boxLanes) {
          const p = pointAt(track, track.length * f, lane);
          this.boxes.push({ x: p.x, z: p.z, h: p.h + 1.2, back: 0 });
        }
    }
  }

  /** 1-based lap a car is on (capped at the number of laps). */
  lap(c: Car) {
    return Math.max(1, Math.min(this.laps, Math.floor(c.progress / this.track.length) + 1));
  }

  /** Car indices in race order: finishers by time, then by distance driven. */
  order(): number[] {
    return [...this.cars]
      .sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime! - b.finishTime!;
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        return b.progress - a.progress;
      })
      .map((c) => c.idx);
  }

  effect(c: Car): RallyEffect | null {
    if (c.spin > 0) return 'spin';
    if (c.rocket > 0) return 'rocket';
    if (c.tow > 0) return 'tow';
    if (c.ghost > 0) return 'ghost';
    if (c.boost > 0) return 'boost';
    if (c.slow > 0) return 'slow';
    if (c.towed > 0) return 'towed';
    if (c.ink > 0) return 'ink';
    if (c.shield > 0) return 'shield';
    return null;
  }

  /** Steering and gas that drive along the middle of the road. */
  autopilot(c: Car, cruise: number): { x: number; y: number } {
    const ahead = pointAt(this.track, c.along + 10 + Math.max(0, c.speed) * 0.25, 0);
    let d = Math.atan2(ahead.z - c.z, ahead.x - c.x) - c.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return { x: Math.max(-100, Math.min(100, d * 160)), y: c.speed > cruise ? 0 : -100 };
  }

  /** Towed on a lasso: follow the road, drifting over to the lane of the car pulling you. */
  private towPilot(c: Car, t: Car): { x: number; y: number } {
    const gap = Math.max(4, Math.min(30, t.progress - c.progress));
    const ahead = pointAt(this.track, c.along + gap, t.lateral);
    let d = Math.atan2(ahead.z - c.z, ahead.x - c.x) - c.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return { x: Math.max(-100, Math.min(100, d * 160)), y: -100 };
  }

  private sameLevel(a: { h: number }, b: { h: number }) {
    return Math.abs(a.h - b.h) < ITUNING.sameLevel;
  }

  /** Something hit car `c`. Shields, rockets and ghosts protect. Returns whether it got through. */
  private hit(c: Car, by: number, kind: RallyItem): boolean {
    if (immune(c)) return false;
    if (c.shield > 0) {
      c.shield = 0;
      this.pendingHits.push({ idx: c.idx, by, kind, blocked: true });
      return false;
    }
    hitEffect(c, kind);
    this.pendingHits.push({ idx: c.idx, by, kind, blocked: false });
    return true;
  }

  /** The nearest car ahead of `c` (by distance driven) that `ok` accepts. */
  private ahead(c: Car, ok: (o: Car) => boolean = () => true): Car | null {
    let best: Car | null = null;
    let gap = Infinity;
    for (const o of this.cars) {
      if (o.idx === c.idx || o.finished || o.parked || !ok(o)) continue;
      const g = o.progress - c.progress;
      if (g > 0 && g < gap) {
        gap = g;
        best = o;
      }
    }
    return best;
  }

  /** A remote car reported where it is, and how it's drifting (0 not, 1 drifting, 2 blue sparks, 3 orange sparks). */
  report(idx: number, x: number, z: number, heading: number, speed: number, drift = 0) {
    const c = this.cars[idx];
    if (!c) return;
    c.x = x;
    c.z = z;
    c.heading = heading;
    c.speed = speed;
    c.seen = this.time;
    setDriftLook(c, drift);
  }

  /** Fire the item a car is holding. Returns false if it had none. */
  useItem(idx: number): boolean {
    const c = this.cars[idx];
    if (!c || !c.item || c.finished || c.parked) return false;
    const item = c.item;
    c.item = null;
    const I = ITUNING;
    let tow = -1;
    if (item === 'lasso') {
      // Rope the nearest car ahead, if it's close enough and can be caught.
      const t = this.ahead(c, (o) => o.progress - c.progress < I.towReach && this.sameLevel(o, c));
      if (t && this.hit(t, idx, 'lasso')) tow = t.idx;
    }
    selfEffect(c, item, tow);
    switch (item) {
      case 'butter':
        this.slicks.push({
          kind: 'butter',
          x: c.x - Math.cos(c.heading) * 3.6,
          z: c.z - Math.sin(c.heading) * 3.6,
          h: c.h,
          heading: c.heading,
          until: this.time + I.slickLife,
          owner: idx,
          safeUntil: this.time + 1,
        });
        break;
      case 'pickle': {
        // Aim at the nearest car ahead (by distance driven).
        const target = this.ahead(c)?.idx ?? null;
        const p = pointAt(this.track, c.along + 3, c.lateral);
        this.pickles.push({ kind: 'pickle', d: c.along + 3, lateral: c.lateral, x: p.x, z: p.z, h: p.h, heading: p.heading, owner: idx, target, until: this.time + I.pickleLife });
        break;
      }
      case 'slipper': {
        // Straight for whoever is leading (if that's you, for the car ahead of you on the road – a backmarker).
        const lead = this.order().map((k) => this.cars[k]).find((o) => o.idx !== idx && !o.finished && !o.parked && o.progress > c.progress);
        const target = lead?.idx ?? this.ahead(c)?.idx ?? null;
        const p = pointAt(this.track, c.along + 2, 0);
        this.pickles.push({ kind: 'slipper', d: c.along + 2, lateral: 0, x: p.x, z: p.z, h: p.h, heading: p.heading, owner: idx, target, until: this.time + I.slipperLife });
        break;
      }
      case 'bomb': {
        const p = pointAt(this.track, c.along + 4, c.lateral * 0.5);
        this.bombs.push({ d: c.along + 4, lateral: c.lateral * 0.5, speed: Math.max(0, c.speed) + 30, x: p.x, z: p.z, h: p.h, age: 0, owner: idx });
        break;
      }
      case 'storm':
      case 'beet':
        for (const o of this.cars) if (o.idx !== idx && !o.parked && o.progress > c.progress) this.hit(o, idx, item);
        break;
      case 'ghost': {
        // Steal the item of the nearest car ahead that has one (or anybody's, if you lead).
        const victim = this.ahead(c, (o) => !!o.item) ?? this.cars.find((o) => o.idx !== idx && !o.parked && !o.finished && o.item) ?? null;
        if (victim?.item) {
          c.item = victim.item;
          victim.item = null;
          this.pendingSteals.push({ idx, from: victim.idx, item: c.item });
        }
        break;
      }
    }
    this.pending.push({ idx, item, ...(item === 'lasso' ? { tow } : {}) });
    return true;
  }

  step(): StepEvents {
    const T = RTUNING;
    const I = ITUNING;
    const ev: StepEvents = { laps: [], finished: [], bumps: [], pickups: [], used: this.pending, hits: this.pendingHits, steals: this.pendingSteals, turbos: [] };
    this.pending = [];
    this.pendingHits = [];
    this.pendingSteals = [];
    this.time += DT;
    const L = this.track.length;

    for (const c of this.cars) {
      c.boost = Math.max(0, c.boost - DT);
      c.rocket = Math.max(0, c.rocket - DT);
      c.shield = Math.max(0, c.shield - DT);
      c.slow = Math.max(0, c.slow - DT);
      c.ink = Math.max(0, c.ink - DT);
      c.ghost = Math.max(0, c.ghost - DT);
      c.towed = Math.max(0, c.towed - DT);
      if (c.tow > 0) {
        const t = this.cars[c.towTarget];
        // Reeled in, out of time or the rope broke: let go and slingshot past.
        if (!c.remote && (c.tow <= DT || !t || t.parked || t.finished || t.progress - c.progress < 5 || c.spin > 0)) endTow(c);
        else c.tow = Math.max(0, c.tow - DT);
      }
      if (c.remote) {
        // Keep moving between reports (briefly), but the driving happens elsewhere.
        c.spin = Math.max(0, c.spin - DT);
        if (this.time - c.seen < 0.25 && !c.parked) {
          c.x += Math.cos(c.heading) * c.speed * DT;
          c.z += Math.sin(c.heading) * c.speed * DT;
        }
        continue;
      }
      // The player's own input stays in c.input; finished cars and rockets drive themselves.
      const towing = c.tow > 0 ? this.cars[c.towTarget] : undefined;
      const input: Car['input'] = c.finished
        ? this.autopilot(c, 18)
        : c.rocket > 0
          ? this.autopilot(c, I.rocketSpeed)
          : towing
            ? this.towPilot(c, towing)
            : c.input;
      const parked = c.parked && !c.finished;
      let steer = parked ? 0 : Math.max(-1, Math.min(1, input.x / 100));
      let gas = parked ? 0 : Math.max(-1, Math.min(1, -input.y / 100));
      if (c.spin > 0) {
        c.spin = Math.max(0, c.spin - DT);
        c.spinAngle += DT * 14 * Math.min(1, c.spin * 2 + 0.2);
        steer = 0;
        gas = 0;
        c.speed *= 1 - 2.2 * DT;
      } else c.spinAngle = 0;
      if (c.boost > 0 || c.rocket > 0 || towing) gas = 1;

      // Drifting: the brake button doubles as drift. Hold it while turning at speed and the car
      // slides instead of slowing down; let go to end the drift (and maybe get a turbo).
      const brakeHeld = input.y >= 50;
      const D = DRIFT;
      const canDrift = !parked && c.spin === 0 && c.rocket === 0 && !towing && !c.finished && c.speed > D.minSpeed * (c.drift ? 0.6 : 1);
      if (!c.drift && brakeHeld && canDrift && Math.abs(steer) > 0.25) {
        c.drift = Math.sign(steer);
        c.driftCharge = 0;
      } else if (c.drift && (!brakeHeld || !canDrift)) {
        const level = driftLevel(c);
        if (level > 0 && canDrift) {
          c.boost = Math.max(c.boost, level === 2 ? D.superBoost : D.miniBoost);
          c.speed = Math.max(c.speed, level === 2 ? 46 : 42);
          ev.turbos.push({ idx: c.idx, level });
        }
        c.drift = 0;
        c.driftCharge = 0;
      }

      // Drifting keeps the power on, whatever the pedals say.
      if (c.drift) gas = 1;

      // Speed. A boost (Kompot, a turbo) keeps full speed on the grass.
      const S = c.spec;
      let top = c.onRoad || c.rocket > 0 || c.boost > 0 ? S.maxSpeed : S.grassSpeed;
      if (c.rocket > 0) top = I.rocketSpeed;
      else if (towing) top = Math.max(S.maxSpeed, Math.min(I.boostSpeed + 6, towing.speed + 16));
      else if (c.boost > 0) top = I.boostSpeed + (S.maxSpeed - T.maxSpeed);
      if (c.slow > 0) top *= I.slowFactor;
      if (c.towed > 0) top *= I.towDrag;
      const accel = c.rocket > 0 || c.boost > 0 || towing ? S.accel * 3 : S.accel;
      if (gas > 0) c.speed += accel * gas * (1 - Math.max(0, c.speed) / (top * 1.08)) * DT * 1.6;
      else if (gas < 0) c.speed += (c.speed > 0.5 ? T.brake : T.accel * 0.6) * gas * DT;
      c.speed -= c.speed * T.drag * DT * (gas === 0 ? 1 : 0.35);
      if (gas === 0 && c.spin === 0 && Math.abs(c.speed) < 0.4) c.speed = 0;
      if (c.speed > top) c.speed -= Math.min(c.speed - top, (c.speed - top) * 2.5 * DT + 8 * DT);
      if (c.speed < -T.reverseSpeed) c.speed = -T.reverseSpeed;

      // Steering: needs some speed, and gets calmer near top speed.
      const v = Math.abs(c.speed);
      if (c.drift) {
        // Always turning into the drift; the stick only says how hard.
        const into = steer * c.drift;
        const turn = D.turnOut + ((D.turnIn - D.turnOut) * (into + 1)) / 2;
        c.heading += c.drift * turn * S.steer * DT;
        c.driftCharge += DT * (0.6 + 0.6 * Math.max(0, into));
        c.speed *= 1 - D.scrub * DT;
      } else {
        const k = Math.min(1, v / 6) * (1 - (1 - T.steerAtTop) * Math.min(1, v / S.maxSpeed));
        c.heading += steer * S.steer * k * Math.sign(c.speed) * DT;
      }
      // The car goes where it pointed a moment ago: the slip angle is the drift.
      c.slip += ((c.drift ? c.drift * D.slip : 0) - c.slip) * Math.min(1, DT * (c.drift ? 5 : 8));
      const travel = c.heading - c.slip;

      c.x += Math.cos(travel) * c.speed * DT;
      c.z += Math.sin(travel) * c.speed * DT;
    }

    // Cars bump into each other (not across the bridge).
    const r2 = (T.carRadius * 2) ** 2;
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        if ((a.remote && b.remote) || a.ghost > 0 || b.ghost > 0 || !this.sameLevel(a, b)) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (T.carRadius * 2 - d) / 2;
        // A rocket shoves the other car out of the way; a car driven elsewhere doesn't budge here;
        // otherwise the heavier car moves less.
        const wa = b.remote ? 2 : a.remote ? 0 : a.rocket > 0 ? 0.2 : b.rocket > 0 ? 1.8 : (2 * b.spec.weight) / (a.spec.weight + b.spec.weight);
        a.x -= (dx / d) * push * wa;
        a.z -= (dz / d) * push * wa;
        b.x += (dx / d) * push * (2 - wa);
        b.z += (dz / d) * push * (2 - wa);
        const avg = (a.speed + b.speed) / 2;
        a.speed = a.speed * 0.8 + avg * 0.2;
        b.speed = b.speed * 0.8 + avg * 0.2;
      }
    }

    for (const c of this.cars) {
      let p = project(this.track, c.x, c.z, c.hint);
      // Barriers: slide along them and lose speed.
      const wall = this.track.wall[p.i];
      if (!c.remote && Math.abs(p.lateral) > wall) {
        const back = Math.abs(p.lateral) - wall;
        const nx = this.track.tz[p.i] * Math.sign(p.lateral);
        const nz = -this.track.tx[p.i] * Math.sign(p.lateral);
        c.x -= nx * back;
        c.z -= nz * back;
        const into = Math.cos(c.heading) * nx + Math.sin(c.heading) * nz;
        if (Math.abs(c.speed) > 6 && into * Math.sign(c.speed) > 0.25) ev.bumps.push(c.idx);
        c.speed *= 1 - Math.min(0.9, Math.abs(into) * 3 * DT * 10);
        p = project(this.track, c.x, c.z, p.i);
      }
      c.hint = p.i;
      c.lateral = p.lateral;
      c.h = p.h;
      c.onRoad = Math.abs(p.lateral) <= ROAD_HALF + 0.6;

      let delta = p.along - c.along;
      if (delta < -L / 2) delta += L;
      else if (delta > L / 2) delta -= L;
      c.along = p.along;
      c.progress += delta;
      const lapAfter = Math.floor(c.progress / L);
      if (!c.finished && lapAfter > c.maxLap) {
        c.maxLap = lapAfter;
        if (lapAfter >= this.laps) {
          c.finished = true;
          c.finishTime = this.time;
          c.item = null;
          ev.finished.push(c.idx);
        } else ev.laps.push({ idx: c.idx, lap: lapAfter + 1 });
      }
    }

    if (this.authority) this.stepItems(ev);
    ev.hits.push(...this.pendingHits);
    this.pendingHits = [];
    return ev;
  }

  private stepItems(ev: StepEvents) {
    const I = ITUNING;
    const r2 = I.hitRadius ** 2;
    const touching = (c: Car, o: { x: number; z: number; h: number }, r = r2) =>
      (c.x - o.x) ** 2 + (c.z - o.z) ** 2 < r && Math.abs(c.h + 1 - o.h) < I.sameLevel + 1;

    // Item boxes.
    const order = this.order();
    for (const b of this.boxes) {
      if (b.back > this.time) continue;
      for (const c of this.cars) {
        if (c.item || c.finished || c.parked || c.rocket > 0 || !touching(c, b, (I.hitRadius + 0.6) ** 2)) continue;
        const f = this.cars.length > 1 ? order.indexOf(c.idx) / (this.cars.length - 1) : 0.5;
        c.item = rollItem(f, this.cars.length, this.rng);
        b.back = this.time + I.boxRespawn;
        ev.pickups.push({ idx: c.idx, item: c.item });
        break;
      }
    }

    // Butter slicks.
    this.slicks = this.slicks.filter((s) => {
      if (s.until < this.time) return false;
      for (const c of this.cars) {
        if (c.parked || immune(c) || (c.idx === s.owner && this.time < s.safeUntil) || !this.sameLevel(c, s)) continue;
        if ((c.x - s.x) ** 2 + (c.z - s.z) ** 2 < r2) {
          this.hit(c, s.owner, s.kind);
          return false;
        }
      }
      return true;
    });

    // A car with its pot lid up that rams another spins it (and the lid is spent).
    const bash = (RTUNING.carRadius * 2 + 0.5) ** 2;
    for (const a of this.cars) {
      if (a.shield <= 0 || a.parked || a.finished) continue;
      for (const b of this.cars) {
        if (b === a || b.parked || immune(b) || b.spin > 0 || !this.sameLevel(a, b)) continue;
        if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > bash) continue;
        a.shield = 0;
        this.hit(b, a.idx, 'lid');
        break;
      }
    }

    // Cabbage bombs roll down the road and go off.
    this.blasts = this.blasts.filter((b) => this.time - b.at < 0.6);
    this.bombs = this.bombs.filter((b) => {
      b.age += DT;
      b.d += b.speed * DT;
      const p = pointAt(this.track, b.d, b.lateral);
      b.x = p.x;
      b.z = p.z;
      b.h = p.h;
      if (b.age < I.bombFuse) return true;
      this.blasts.push({ x: b.x, z: b.z, h: b.h, at: this.time, r: I.bombRadius });
      for (const c of this.cars) {
        if (c.parked || !this.sameLevel(c, b)) continue;
        if ((c.x - b.x) ** 2 + (c.z - b.z) ** 2 < I.bombRadius ** 2) this.hit(c, b.owner, 'bomb');
      }
      return false;
    });

    // Pickle missiles follow the road and home in on their target's lane. Babcia's slipper flies
    // high over everything until it reaches its target, then comes down hard.
    this.pickles = this.pickles.filter((m) => {
      if (m.until < this.time) return false;
      const t = m.target !== null ? this.cars[m.target] : null;
      if (m.kind === 'slipper') {
        if (!t || t.parked || t.finished) return false;
        m.d += I.slipperSpeed * DT;
        m.lateral += (t.lateral - m.lateral) * Math.min(1, 3 * DT);
        const p = pointAt(this.track, m.d, m.lateral);
        Object.assign(m, { x: p.x, z: p.z, h: p.h, heading: p.heading });
        if ((t.x - m.x) ** 2 + (t.z - m.z) ** 2 > 5 ** 2 || !this.sameLevel(t, m)) return true;
        this.blasts.push({ x: t.x, z: t.z, h: t.h, at: this.time, r: I.slipperRadius });
        this.hit(t, m.owner, 'slipper');
        for (const c of this.cars) {
          if (c === t || c.idx === m.owner || c.parked || !this.sameLevel(c, t)) continue;
          if ((c.x - t.x) ** 2 + (c.z - t.z) ** 2 < I.slipperRadius ** 2) this.hit(c, m.owner, 'slipper');
        }
        return false;
      }
      m.d += I.pickleSpeed * DT;
      if (t) m.lateral += (t.lateral - m.lateral) * Math.min(1, 5 * DT);
      const p = pointAt(this.track, m.d, m.lateral);
      m.x = p.x;
      m.z = p.z;
      m.h = p.h;
      m.heading = p.heading;
      for (const c of this.cars) {
        if (c.idx === m.owner || c.parked || !this.sameLevel(c, m)) continue;
        if ((c.x - m.x) ** 2 + (c.z - m.z) ** 2 < r2 * 1.4) {
          this.hit(c, m.owner, 'pickle');
          return false;
        }
      }
      return true;
    });
  }
}

/** Points per finishing place in each race of the cup. */
export const RACE_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export function racePoints(place: number): number {
  return RACE_POINTS[place - 1] ?? 0;
}
