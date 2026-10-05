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
}

export interface StepEvents {
  laps: { idx: number; lap: number }[];
  finished: number[];
  bumps: number[];
}

/** Grid slot `k`: two columns, rows going back from the start line. */
export function gridSlot(track: Track, k: number) {
  const row = Math.floor(k / 2);
  const back = 6 + row * 7 + (k % 2) * 2.5;
  return pointAt(track, -back, k % 2 === 0 ? 3.2 : -3.2);
}

export class RallySim {
  cars: Car[];
  time = 0;

  constructor(
    public track: Track,
    count: number,
    public laps = LAPS,
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
      };
    });
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

  /** Simple autopilot for cars that have finished: cruise along the middle of the road. */
  private autopilot(c: Car) {
    const ahead = pointAt(this.track, c.along + 14, 0);
    let d = Math.atan2(ahead.z - c.z, ahead.x - c.x) - c.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    c.input = { x: Math.max(-100, Math.min(100, d * 160)), y: c.speed > 18 ? 0 : -50 };
  }

  step(): StepEvents {
    const T = RTUNING;
    const ev: StepEvents = { laps: [], finished: [], bumps: [] };
    this.time += DT;
    const L = this.track.length;

    for (const c of this.cars) {
      if (c.finished) this.autopilot(c);
      const steer = c.parked ? 0 : Math.max(-1, Math.min(1, c.input.x / 100));
      const gas = c.parked ? 0 : Math.max(-1, Math.min(1, -c.input.y / 100));

      // Speed.
      if (gas > 0) c.speed += T.accel * gas * (1 - Math.max(0, c.speed) / (T.maxSpeed * 1.08)) * DT * 1.6;
      else if (gas < 0) c.speed += (c.speed > 0.5 ? T.brake : T.accel * 0.6) * gas * DT;
      c.speed -= c.speed * T.drag * DT * (gas === 0 ? 1 : 0.35);
      if (gas === 0 && Math.abs(c.speed) < 0.4) c.speed = 0;
      const top = c.onRoad ? T.maxSpeed : T.grassSpeed;
      if (c.speed > top) c.speed -= Math.min(c.speed - top, (c.speed - top) * 2.5 * DT + 8 * DT);
      if (c.speed < -T.reverseSpeed) c.speed = -T.reverseSpeed;

      // Steering: needs some speed, and gets calmer near top speed.
      const v = Math.abs(c.speed);
      const k = Math.min(1, v / 6) * (1 - (1 - T.steerAtTop) * Math.min(1, v / T.maxSpeed));
      c.heading += steer * T.steer * k * Math.sign(c.speed) * DT;

      c.x += Math.cos(c.heading) * c.speed * DT;
      c.z += Math.sin(c.heading) * c.speed * DT;
    }

    // Cars bump into each other.
    const r2 = (RTUNING.carRadius * 2) ** 2;
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (RTUNING.carRadius * 2 - d) / 2;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
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
          ev.finished.push(c.idx);
        } else ev.laps.push({ idx: c.idx, lap: lapAfter + 1 });
      }
    }
    return ev;
  }
}

/** Points per finishing place in each race of the cup. */
export const RACE_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export function racePoints(place: number): number {
  return RACE_POINTS[place - 1] ?? 0;
}
