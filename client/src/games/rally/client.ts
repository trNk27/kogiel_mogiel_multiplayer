/**
 * Maluch Rally without a TV: the race as one phone sees it.
 *
 * The phone drives its own car with the same physics as the TV version (so steering has no
 * network lag) and reports where it is ~15 times a second. The host referees: it hands out
 * items, moves missiles and decides who got hit, and sends everybody a snapshot of all the
 * cars and items. Other cars are drawn a little in the past, smoothly interpolated between
 * snapshots.
 */
import { RALLY_CAR_STRIDE, RALLY_FX_BITS, colorHex, type HostToPhone, type PhoneMsg, type RallyNet } from '../../../../shared/protocol';
import { DT, HAZARDS, ITUNING, LAPS, RallySim, driftCode, setDriftLook, hitEffect, selfEffect, type Blast, type Bomb, type Pickle, type Slick } from './sim';
import { generateTrack, pointAt, project, type Shape, type Track } from './track';
import { RallyScene, type RaceState } from './render3d';
import { Minimap } from './minimap';

type Snapshot = Extract<HostToPhone, { t: 'rs' }>;
export type RallyEvent = Extract<HostToPhone, { t: 'rfx' }>;

/** How far in the past other cars are drawn, so there are snapshots either side. */
const INTERP_MS = 120;
/** Keep moving a car this long past its latest snapshot before freezing it. */
const EXTRAPOLATE_MS = 250;
const REPORT_MS = 66;
/** Internal resolution as a fraction of CSS pixels: chunky pixels are the look. */
const PIXEL_SCALE = 0.62;
const MAX_SIDE = 720;

/** What the driver is doing with the controls. */
export interface DriveInput {
  /** -1 (full left) … 1 (full right). */
  steer: number;
  /** Brakes – or, while turning at speed, drifts. */
  brake: boolean;
}

/** Numbers the HUD shows, updated ~10 times a second. */
export interface DriveHud {
  speed: number;
  ink: number;
  lap: number;
  finished: boolean;
  /** 0 not drifting, 1 drifting, 2 blue sparks, 3 orange sparks. */
  drift: number;
  /** Counts mini-turbos (and their level), so the HUD can flash one. */
  turbos: number;
  turboLevel: number;
}

export class RallyClient {
  readonly track: Track;
  readonly sim: RallySim;
  readonly idx: number;
  input: DriveInput = { steer: 0, brake: false };
  private turbos = 0;
  private turboLevel = 0;
  /** Automated tests (/join?debug): drive along the middle of the road. */
  autodrive = false;
  private scene: RallyScene;
  private map: Minimap;
  private mapCtx: CanvasRenderingContext2D | null;
  private colors: string[];
  private driving = false;
  private snaps: { at: number; c: number[] }[] = [];
  private latest: { at: number; m: Snapshot } | null = null;
  private raf = 0;
  private last = performance.now();
  private acc = 0;
  private lastReport = 0;
  private lastHud = 0;
  private remoteSpin: number[];
  private state: RaceState;
  private disposed = false;
  private vp: { width: number; height: number; scale: number };

  constructor(
    canvas: HTMLCanvasElement,
    mapCanvas: HTMLCanvasElement,
    readonly race: number,
    net: RallyNet,
    private send: (m: PhoneMsg) => void,
    private onHud: (h: DriveHud) => void,
  ) {
    this.idx = net.idx;
    this.track = generateTrack(net.seed, net.shape as Shape);
    this.sim = new RallySim(this.track, net.cars.length, LAPS, net.items, Math.random, {
      authority: false,
      remote: (i) => i !== net.idx,
    });
    this.colors = net.cars.map((c) => colorHex(c.color));
    this.remoteSpin = net.cars.map(() => 0);
    this.vp = this.viewport(canvas);
    this.scene = new RallyScene(
      canvas,
      net.cars.map((c, i) => ({ name: c.name, color: this.colors[i] })),
      this.vp,
    );
    this.scene.setTrack(this.track);
    this.scene.resetCameras(this.sim.cars);
    this.map = new Minimap(this.track, mapCanvas.width);
    this.mapCtx = mapCanvas.getContext('2d');
    this.state = { cars: this.sim.cars, boxes: this.sim.boxes, slicks: [], pickles: [], bombs: [], blasts: [], time: 0 };
    this.raf = requestAnimationFrame(this.frame);
  }

  private viewport(canvas: HTMLCanvasElement) {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const scale = Math.min(PIXEL_SCALE, MAX_SIDE / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    return { width: w, height: h, scale };
  }

  /** The phone turned or the window changed size. */
  resize(canvas: HTMLCanvasElement) {
    this.vp = this.viewport(canvas);
    this.scene.resize(this.vp);
  }

  setDriving(on: boolean) {
    this.driving = on;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.dispose();
  }

  // ---- from the host ----------------------------------------------------------

  onSnapshot(m: Snapshot) {
    if (m.r !== this.race) return;
    const at = performance.now();
    this.snaps.push({ at, c: m.c });
    if (this.snaps.length > 12) this.snaps.shift();
    this.latest = { at, m };
    const gone = new Set(m.b);
    this.sim.boxes.forEach((b, i) => (b.back = gone.has(i) ? Infinity : 0));
  }

  /** Something happened to my car. */
  onEvent(e: RallyEvent) {
    if (e.r !== this.race) return;
    const me = this.sim.cars[this.idx];
    if (e.use) selfEffect(me, e.use);
    if (e.hit) {
      if (e.blocked) me.shield = 0;
      else hitEffect(me, e.hit);
    }
  }

  // ---- loop -------------------------------------------------------------------

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const me = this.sim.cars[this.idx];

    this.placeOthers(now);
    this.acc += elapsed;
    while (this.acc >= DT) {
      this.acc -= DT;
      me.input = !this.driving
        ? { x: 0, y: 0 }
        : this.autodrive
          ? this.sim.autopilot(me, 40)
          : { x: Math.round(this.input.steer * 100), y: this.input.brake ? 100 : -100 };
      if (!this.driving && !me.finished) me.speed = 0;
      for (const t of this.sim.step().turbos)
        if (t.idx === this.idx) {
          this.turbos++;
          this.turboLevel = t.level;
        }
    }
    this.placeItems(now);
    this.state.time = this.sim.time;
    this.scene.render(this.state, [{ x: 0, y: 0, w: this.vp.width, h: this.vp.height }], elapsed, [this.idx]);
    if (this.mapCtx) this.map.draw(this.mapCtx, this.sim.cars.map((c, i) => ({ x: c.x, z: c.z, color: this.colors[i], me: i === this.idx })).filter((_, i) => i === this.idx || !this.sim.cars[i].parked));

    if (this.driving && now - this.lastReport >= REPORT_MS) {
      this.lastReport = now;
      const r = (v: number, k = 100) => Math.round(v * k) / k;
      this.send({ t: 'car', r: this.race, x: r(me.x), z: r(me.z), a: r(me.heading, 1000), v: r(me.speed, 10), d: driftCode(me) });
    }
    if (now - this.lastHud > 100) {
      this.lastHud = now;
      this.onHud({ speed: Math.abs(me.speed), ink: me.ink, lap: this.sim.lap(me), finished: me.finished, drift: driftCode(me), turbos: this.turbos, turboLevel: this.turboLevel });
    }
  };

  /** Put the other cars where the snapshots say they were INTERP_MS ago. */
  private placeOthers(now: number) {
    const t = now - INTERP_MS;
    const S = RALLY_CAR_STRIDE;
    const B = RALLY_FX_BITS;
    let a = this.snaps[0];
    let b: (typeof this.snaps)[number] | undefined;
    for (let k = 0; k < this.snaps.length; k++) {
      if (this.snaps[k].at <= t) a = this.snaps[k];
      else {
        b = this.snaps[k];
        break;
      }
    }
    if (!a) return;
    const u = b && b.at > a.at ? Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at))) : 0;
    const ahead = b ? 0 : Math.min(EXTRAPOLATE_MS, Math.max(0, t - a.at)) / 1000;
    for (const c of this.sim.cars) {
      if (c.idx === this.idx) continue;
      const o = c.idx * S;
      if (a.c.length < o + S) continue;
      const bits = (b ?? a).c[o + 4];
      let x = a.c[o];
      let z = a.c[o + 1];
      let h = a.c[o + 2];
      let v = a.c[o + 3];
      if (b) {
        x += (b.c[o] - x) * u;
        z += (b.c[o + 1] - z) * u;
        let dh = b.c[o + 2] - h;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        h += dh * u;
        v += (b.c[o + 3] - v) * u;
      } else if (!(bits & B.parked)) {
        x += Math.cos(h) * v * ahead;
        z += Math.sin(h) * v * ahead;
      }
      const jumped = Math.hypot(x - c.x, z - c.z) > 30;
      c.x = x;
      c.z = z;
      c.heading = h;
      c.speed = v;
      // Big jumps (first snapshot, respawn) need a fresh search along the track.
      if (jumped) c.hint = project(this.track, x, z).i;
      c.parked = !!(bits & B.parked);
      c.spin = bits & B.spin ? 1 : 0;
      c.rocket = bits & B.rocket ? 1 : 0;
      c.boost = bits & B.boost ? 1 : 0;
      c.shield = bits & B.shield ? 3 : 0;
      c.slow = bits & B.slow ? 1 : 0;
      c.ghost = bits & B.ghost ? 1 : 0;
      this.remoteSpin[c.idx] = c.spin ? this.remoteSpin[c.idx] + 0.25 : 0;
      c.spinAngle = this.remoteSpin[c.idx];
      setDriftLook(c, bits & B.superSparks ? 3 : bits & B.sparks ? 2 : bits & B.drift ? 1 : 0);
    }
  }

  /** Items on the track, moved on from the latest snapshot. */
  private placeItems(now: number) {
    const L = this.latest;
    if (!L) return;
    const m = L.m;
    const since = (now - L.at) / 1000;
    const slicks: Slick[] = [];
    for (let k = 0; k + 4 < m.s.length; k += 5)
      slicks.push({ x: m.s[k], z: m.s[k + 1], h: m.s[k + 2], heading: m.s[k + 3], kind: HAZARDS[m.s[k + 4]] ?? 'butter', until: Infinity, owner: -1, safeUntil: 0 });
    const pickles: Pickle[] = [];
    for (let k = 0; k + 1 < m.p.length; k += 2) {
      const d = m.p[k] + ITUNING.pickleSpeed * Math.min(0.3, since);
      const p = pointAt(this.track, d, m.p[k + 1]);
      pickles.push({ d, lateral: m.p[k + 1], x: p.x, z: p.z, h: p.h, heading: p.heading, owner: -1, target: null, until: Infinity });
    }
    const bombs: Bomb[] = [];
    for (let k = 0; k + 3 < m.k.length; k += 4) {
      const age = Math.min(ITUNING.bombFuse, m.k[k + 3] + since);
      const d = m.k[k] + m.k[k + 2] * (age - m.k[k + 3]);
      const p = pointAt(this.track, d, m.k[k + 1]);
      bombs.push({ d, lateral: m.k[k + 1], speed: m.k[k + 2], x: p.x, z: p.z, h: p.h, age, owner: -1 });
    }
    const blasts: Blast[] = [];
    for (let k = 0; k + 3 < m.x.length; k += 4) blasts.push({ x: m.x[k], z: m.x[k + 1], h: m.x[k + 2], at: this.sim.time - m.x[k + 3] - since });
    this.state.slicks = slicks;
    this.state.pickles = pickles;
    this.state.bombs = bombs;
    this.state.blasts = blasts.filter((b) => this.sim.time - b.at < 0.6);
  }
}
