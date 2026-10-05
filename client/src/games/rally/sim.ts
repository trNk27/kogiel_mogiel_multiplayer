import type { RallyEffect, RallyItem } from '../../../../shared/protocol';
import type { Rng } from '../rng';
import { ROAD_HALF, WALL, pointAt, project, type Track } from './track';

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

/** Item timings and strengths. */
export const ITUNING = {
  boostTime: 2.2,
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
  /** Joystick: x steers (-100 left … 100 right), y is screen-down (-100 = full gas, 100 = brake). */
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
  item: RallyItem | null;
  /** Seconds left of each effect. */
  boost: number;
  rocket: number;
  shield: number;
  spin: number;
  slow: number;
  /** Extra yaw while spinning out (just for show). */
  spinAngle: number;
}

export interface ItemBox {
  x: number;
  z: number;
  h: number;
  /** Sim time when the box comes back (0 = there now). */
  back: number;
}

export interface Slick {
  x: number;
  z: number;
  h: number;
  until: number;
  owner: number;
  safeUntil: number;
}

export interface Pickle {
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
  used: { idx: number; item: RallyItem }[];
  hits: Hit[];
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
  if (cars <= 1) return { boost: 3, butter: 0, pickle: 0, lid: 0, storm: 0, rocket: 1 };
  return {
    boost: 2 + 2 * f,
    butter: 3 - 2 * f,
    pickle: 1.5 + 1.5 * f,
    lid: 2.2 - 1.6 * f,
    storm: f < 0.3 ? 0 : 2 * f,
    rocket: f < 0.6 ? 0 : 3 * f,
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

export class RallySim {
  cars: Car[];
  time = 0;
  boxes: ItemBox[] = [];
  slicks: Slick[] = [];
  pickles: Pickle[] = [];
  private pending: StepEvents['used'] = [];
  private pendingHits: Hit[] = [];

  constructor(
    public track: Track,
    count: number,
    public laps = LAPS,
    items = true,
    private rng: Rng = Math.random,
  ) {
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
        item: null,
        boost: 0,
        rocket: 0,
        shield: 0,
        spin: 0,
        slow: 0,
        spinAngle: 0,
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
    if (c.boost > 0) return 'boost';
    if (c.slow > 0) return 'slow';
    if (c.shield > 0) return 'shield';
    return null;
  }

  /** Steering and gas that drive along the middle of the road. */
  private autopilot(c: Car, cruise: number): { x: number; y: number } {
    const ahead = pointAt(this.track, c.along + 10 + Math.max(0, c.speed) * 0.25, 0);
    let d = Math.atan2(ahead.z - c.z, ahead.x - c.x) - c.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return { x: Math.max(-100, Math.min(100, d * 160)), y: c.speed > cruise ? 0 : -100 };
  }

  private sameLevel(a: { h: number }, b: { h: number }) {
    return Math.abs(a.h - b.h) < ITUNING.sameLevel;
  }

  /** Something hit car `c`. Shields and rockets protect. */
  private hit(c: Car, by: number, kind: RallyItem) {
    if (c.rocket > 0 || c.finished) return;
    if (c.shield > 0) {
      c.shield = 0;
      this.pendingHits.push({ idx: c.idx, by, kind, blocked: true });
      return;
    }
    if (kind === 'storm') {
      c.slow = ITUNING.slowTime;
      c.spin = Math.max(c.spin, 0.5);
    } else c.spin = ITUNING.spinTime;
    c.boost = 0;
    this.pendingHits.push({ idx: c.idx, by, kind, blocked: false });
  }

  /** Fire the item a car is holding. Returns false if it had none. */
  useItem(idx: number): boolean {
    const c = this.cars[idx];
    if (!c || !c.item || c.finished || c.parked) return false;
    const item = c.item;
    c.item = null;
    const I = ITUNING;
    switch (item) {
      case 'boost':
        c.boost = I.boostTime;
        c.speed = Math.max(c.speed, 46);
        break;
      case 'rocket':
        c.rocket = I.rocketTime;
        c.spin = 0;
        c.slow = 0;
        break;
      case 'lid':
        c.shield = I.shieldTime;
        break;
      case 'butter': {
        const back = 3.6;
        this.slicks.push({
          x: c.x - Math.cos(c.heading) * back,
          z: c.z - Math.sin(c.heading) * back,
          h: c.h,
          until: this.time + I.slickLife,
          owner: idx,
          safeUntil: this.time + 1,
        });
        break;
      }
      case 'pickle': {
        // Aim at the nearest car ahead (by distance driven).
        let target: number | null = null;
        let gap = Infinity;
        for (const o of this.cars) {
          if (o.idx === idx || o.finished || o.parked) continue;
          const g = o.progress - c.progress;
          if (g > 0 && g < gap) {
            gap = g;
            target = o.idx;
          }
        }
        const p = pointAt(this.track, c.along + 3, c.lateral);
        this.pickles.push({ d: c.along + 3, lateral: c.lateral, x: p.x, z: p.z, h: p.h, heading: p.heading, owner: idx, target, until: this.time + I.pickleLife });
        break;
      }
      case 'storm':
        for (const o of this.cars) if (o.idx !== idx && !o.parked && o.progress > c.progress) this.hit(o, idx, 'storm');
        break;
    }
    this.pending.push({ idx, item });
    return true;
  }

  step(): StepEvents {
    const T = RTUNING;
    const I = ITUNING;
    const ev: StepEvents = { laps: [], finished: [], bumps: [], pickups: [], used: this.pending, hits: this.pendingHits };
    this.pending = [];
    this.pendingHits = [];
    this.time += DT;
    const L = this.track.length;

    for (const c of this.cars) {
      c.boost = Math.max(0, c.boost - DT);
      c.rocket = Math.max(0, c.rocket - DT);
      c.shield = Math.max(0, c.shield - DT);
      c.slow = Math.max(0, c.slow - DT);
      // The player's own input stays in c.input; finished cars and rockets drive themselves.
      const input = c.finished ? this.autopilot(c, 18) : c.rocket > 0 ? this.autopilot(c, I.rocketSpeed) : c.input;
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
      if (c.boost > 0 || c.rocket > 0) gas = 1;

      // Speed.
      let top = c.onRoad || c.rocket > 0 ? T.maxSpeed : T.grassSpeed;
      if (c.rocket > 0) top = I.rocketSpeed;
      else if (c.boost > 0) top = I.boostSpeed;
      if (c.slow > 0) top *= I.slowFactor;
      const accel = c.rocket > 0 || c.boost > 0 ? T.accel * 3 : T.accel;
      if (gas > 0) c.speed += accel * gas * (1 - Math.max(0, c.speed) / (top * 1.08)) * DT * 1.6;
      else if (gas < 0) c.speed += (c.speed > 0.5 ? T.brake : T.accel * 0.6) * gas * DT;
      c.speed -= c.speed * T.drag * DT * (gas === 0 ? 1 : 0.35);
      if (gas === 0 && c.spin === 0 && Math.abs(c.speed) < 0.4) c.speed = 0;
      if (c.speed > top) c.speed -= Math.min(c.speed - top, (c.speed - top) * 2.5 * DT + 8 * DT);
      if (c.speed < -T.reverseSpeed) c.speed = -T.reverseSpeed;

      // Steering: needs some speed, and gets calmer near top speed.
      const v = Math.abs(c.speed);
      const k = Math.min(1, v / 6) * (1 - (1 - T.steerAtTop) * Math.min(1, v / T.maxSpeed));
      c.heading += steer * T.steer * k * Math.sign(c.speed) * DT;

      c.x += Math.cos(c.heading) * c.speed * DT;
      c.z += Math.sin(c.heading) * c.speed * DT;
    }

    // Cars bump into each other (not across the bridge).
    const r2 = (T.carRadius * 2) ** 2;
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        if (!this.sameLevel(a, b)) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (T.carRadius * 2 - d) / 2;
        // A rocket shoves the other car out of the way.
        const wa = a.rocket > 0 ? 0.2 : b.rocket > 0 ? 1.8 : 1;
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
      if (Math.abs(p.lateral) > WALL) {
        const back = Math.abs(p.lateral) - WALL;
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

    this.stepItems(ev);
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
        if (c.parked || (c.idx === s.owner && this.time < s.safeUntil) || !this.sameLevel(c, s)) continue;
        if ((c.x - s.x) ** 2 + (c.z - s.z) ** 2 < r2) {
          this.hit(c, s.owner, 'butter');
          return false;
        }
      }
      return true;
    });

    // Pickle missiles follow the road and home in on their target's lane.
    this.pickles = this.pickles.filter((m) => {
      if (m.until < this.time) return false;
      m.d += I.pickleSpeed * DT;
      const t = m.target !== null ? this.cars[m.target] : null;
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
