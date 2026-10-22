/**
 * Bule: pure simulation. No DOM, no three.js. Boules (bocce, pétanque) on a village green.
 *
 * Each end, the jack – a little golden pierożek – lies somewhere down a long gravel pitch. Players take
 * turns (everybody's first ball, then everybody's second ball; the order rotates every end) to lob a
 * ball in their colour as close to it as they can. Balls roll with friction, bounce off the side boards,
 * knock each other (and the jack!) about, and a ball that reaches the far board is dead.
 *
 * World units are metres, seen from above: x is across the pitch (+x right, looking from the throwing
 * circle), z runs down it. The throwing circle is at the origin and the pitch runs towards -z.
 *
 * Scoring (decided for this game):
 *  - 2+ players, 2 balls each: the three balls closest to the jack score 3 / 2 / 1 for their owners (one
 *    player can score with more than one ball). Balls at the same distance (to the centimetre) share the
 *    better place: two balls tied for closest both score 3, and the next ball is third (1 point).
 *  - Solo, 3 balls an end: every ball scores by how close it is: under 30 cm 3, under 80 cm 2, under
 *    150 cm 1.
 *  Distances are measured edge to edge (the gap between the ball and the jack), in whole centimetres.
 */
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

export const DT = 1 / 60;
/** Physics substeps per DT, so fast balls can't pass through each other. */
export const SUB = 3;

/** Full game / tournament version. */
export const BOULES_ENDS = 3;
export const BOULES_ENDS_SHORT = 1;
export const BALLS_EACH = 2;
export const BALLS_SOLO = 3;

// ---- the pitch ------------------------------------------------------------------------------------
/** Half the width between the side boards. */
export const HALF_W = 2.2;
/** The far board (z = -PITCH_L): a ball that reaches it is dead. */
export const PITCH_L = 15;
/** The board behind the throwing circle. */
export const BACK_Z = 1.6;
/** Where the jack may lie: this far down the pitch… */
export const JACK_MIN = 7;
export const JACK_MAX = 11.5;
/** …and up to this far to either side. */
export const JACK_SIDE = 0.8;

// ---- bodies -----------------------------------------------------------------------------------------
export const BALL_R = 0.17;
export const JACK_R = 0.11;
export const BALL_M = 1;
export const JACK_M = 0.4;
/** Rolling friction: a steady deceleration (m/s²). The jack is a pierożek: it slides, so it stops sooner. */
export const BALL_FRICTION = 1.5;
export const JACK_FRICTION = 3.2;
/** Restitution between bodies, and off the boards. */
export const BALL_E = 0.8;
export const BOARD_E = 0.5;
/** Slower than this (m/s) and a body stops. */
export const STOP_V = 0.04;

// ---- throwing ---------------------------------------------------------------------------------------
/** The ball leaves the hand here (a little in front of the circle) at this height. */
export const RELEASE_Z = -0.35;
export const RELEASE_Y = 0.95;
/** A throw at power 0 travels DIST_MIN in all (flight and roll), at power 1 DIST_MAX – past the far board. */
export const DIST_MIN = 2;
export const DIST_MAX = 17;
/** The ball lands after this share of the distance, then rolls the rest. */
export const LOB = 0.4;
export const GRAVITY = 12;
/** The aim swings this fast (rad/s) with the stick pushed all the way, up to MAX_AIM either side. */
export const AIM_RATE = 0.3;
export const MAX_AIM = 0.2;
/** The power meter goes 0 → 1 → 0 in this many seconds while you hold THROW. */
export const METER_PERIOD = 2.2;
/** Time for a turn; when it runs out a weak throw (AUTO_POWER) goes by itself. */
export const TURN_TIME = 12;
export const AUTO_POWER = 0.28;
/** A thrower whose phone is offline throws by themselves after this long. */
export const OFFLINE_WAIT = 2.5;
/** After every ball comes to rest, this pause before the next turn. */
export const PAUSE_TIME = 1.5;
/** Nothing rolls for longer than this after a throw. */
export const MAX_FLIGHT = 14;

// ---- scoring ----------------------------------------------------------------------------------------
export const PLACE_POINTS = [3, 2, 1];
/** Solo: [under this many cm, points]. */
export const SOLO_BANDS: [number, number][] = [
  [30, 3],
  [80, 2],
  [150, 1],
];

/** How far a throw at `power` (0..1) travels in all, without hitting anything. */
export const throwDistance = (power: number) => DIST_MIN + Math.max(0, Math.min(1, power)) * (DIST_MAX - DIST_MIN);
/** The power that sends a ball `dist` metres. */
export const powerFor = (dist: number) => Math.max(0, Math.min(1, (dist - DIST_MIN) / (DIST_MAX - DIST_MIN)));
/** The power meter after holding THROW for `t` seconds: up and down, starting at 0. */
export function meterPower(t: number) {
  const f = (((t / METER_PERIOD) % 1) + 1) % 1;
  return 1 - Math.abs(1 - 2 * f);
}
/** Swing the aim with the stick's x (-1..1) for `dt` seconds. */
export const aimStep = (aim: number, x: number, dt: number) => Math.max(-MAX_AIM, Math.min(MAX_AIM, aim + x * AIM_RATE * dt));
/** Unit direction of an aim angle (0 = straight down the pitch, positive = to the right). */
export const aimDir = (aim: number) => ({ x: Math.sin(aim), z: -Math.cos(aim) });
/** Where a throw lands (before it rolls). */
export function landingPoint(aim: number, power: number) {
  const d = aimDir(aim);
  const l = LOB * throwDistance(power);
  return { x: d.x * l, z: RELEASE_Z + d.z * l };
}
/** Seconds in the air for a throw at `power`. */
export const airTime = (power: number) => 0.45 + 0.035 * LOB * throwDistance(power);
/** Where a rolling body comes to rest: `v` m/s with friction `fr` (no collisions). */
export const rollDistance = (v: number, fr = BALL_FRICTION) => (v * v) / (2 * fr);

/** The aim that points straight at (x, z) from the circle, within MAX_AIM. */
export const aimAt = (x: number, z: number) => Math.max(-MAX_AIM, Math.min(MAX_AIM, Math.atan2(x, RELEASE_Z - z)));

export interface Body {
  /** -1 for the jack. */
  owner: number;
  /** Which of its owner's balls (0-based). */
  k: number;
  x: number;
  z: number;
  /** Height of the centre. */
  y: number;
  vx: number;
  vz: number;
  vy: number;
  /** Seconds left in the air (0: on the ground). */
  air: number;
  /** Speed to roll on with once it lands. */
  rollV: number;
  r: number;
  m: number;
  fr: number;
  /** Still on the pitch. */
  alive: boolean;
  /** Why it left: reached the far board, or its owner left the game. */
  out?: 'dead' | 'gone';
  /** Metres rolled (for drawing the spin). */
  rolled: number;
}

export interface BoulesInput {
  /** Stick x, -1..1. */
  x: number;
  /** THROW is held now. */
  held: boolean;
  /** Presses since the last step. */
  presses: number;
  /** Connected and still in the game. */
  live: boolean;
}

export type BoulesPhase = 'idle' | 'aim' | 'flight' | 'pause' | 'done';

export type BoulesEvent =
  | { t: 'turn'; i: number; k: number }
  | { t: 'charge'; i: number }
  | { t: 'throw'; i: number; power: number; aim: number; auto: boolean }
  | { t: 'land'; b: number; x: number; z: number }
  | { t: 'hit'; a: number; b: number; j: number; x: number; z: number; jack: boolean }
  | { t: 'board'; b: number; v: number; x: number; z: number }
  | { t: 'dead'; b: number; x: number; z: number }
  | { t: 'settled'; jackMoved: number }
  | { t: 'over' };

export interface Measured {
  /** Index into `sim.balls`. */
  b: number;
  owner: number;
  /** Gap to the jack, in whole centimetres. */
  cm: number;
  /** 1-based place among all live balls (ties share the better place). */
  place: number;
  pts: number;
}

/** Gap between a ball and the jack (edge to edge), in whole cm. */
export function gapCm(ball: { x: number; z: number; r: number }, jack: { x: number; z: number; r: number }) {
  const d = Math.hypot(ball.x - jack.x, ball.z - jack.z) - ball.r - jack.r;
  return Math.round(Math.max(0, d) * 100);
}

/**
 * Score an end. `balls`: each live ball's owner and gap in cm (in any order). Returns the balls sorted
 * closest first with their places and points, and the points per player.
 */
export function scoreEnd(balls: { b: number; owner: number; cm: number }[], players: number, solo: boolean): { ranked: Measured[]; points: number[] } {
  const sorted = [...balls].sort((a, b) => a.cm - b.cm || a.b - b.b);
  const points = Array.from({ length: players }, () => 0);
  const ranked = sorted.map((x) => {
    const place = 1 + sorted.filter((y) => y.cm < x.cm).length;
    const pts = solo ? (SOLO_BANDS.find(([cm]) => x.cm < cm)?.[1] ?? 0) : (PLACE_POINTS[place - 1] ?? 0);
    if (x.owner >= 0 && x.owner < players) points[x.owner] += pts;
    return { ...x, place, pts };
  });
  return { ranked, points };
}

/** Who throws when in end `end` (0-based): everybody's first ball, then everybody's second… The order rotates every end. */
export function throwOrder(live: number[], end: number, balls: number): { i: number; k: number }[] {
  const n = live.length;
  if (!n) return [];
  const s = ((end % n) + n) % n;
  const order = [...live.slice(s), ...live.slice(0, s)];
  const out: { i: number; k: number }[] = [];
  for (let k = 0; k < balls; k++) for (const i of order) out.push({ i, k });
  return out;
}

export function makeBody(owner: number, k: number, x: number, z: number): Body {
  const jack = owner < 0;
  return {
    owner,
    k,
    x,
    z,
    y: jack ? JACK_R : BALL_R,
    vx: 0,
    vz: 0,
    vy: 0,
    air: 0,
    rollV: 0,
    r: jack ? JACK_R : BALL_R,
    m: jack ? JACK_M : BALL_M,
    fr: jack ? JACK_FRICTION : BALL_FRICTION,
    alive: true,
    rolled: 0,
  };
}

/**
 * Move bodies on the pitch for `dt`: friction, boards, collisions. Bodies in the air fly on and land.
 * Pure physics, shared by the sim and the tests.
 */
export function physicsStep(bodies: Body[], dt: number, ev: BoulesEvent[] = []) {
  // Flight and rolling.
  bodies.forEach((p, idx) => {
    if (!p.alive) return;
    if (p.air > 0) {
      const t = Math.min(dt, p.air);
      p.x += p.vx * t;
      p.z += p.vz * t;
      p.y += p.vy * t - 0.5 * GRAVITY * t * t;
      p.vy -= GRAVITY * t;
      p.air -= t;
      if (p.air <= 1e-9) {
        p.air = 0;
        p.y = p.r;
        p.vy = 0;
        const s = Math.hypot(p.vx, p.vz) || 1;
        p.vx = (p.vx / s) * p.rollV;
        p.vz = (p.vz / s) * p.rollV;
        ev.push({ t: 'land', b: idx, x: p.x, z: p.z });
      }
      return;
    }
    const s = Math.hypot(p.vx, p.vz);
    if (s <= 0) return;
    const ns = s - p.fr * dt;
    if (ns <= STOP_V * 0.5) {
      const d = (s * s) / (2 * p.fr);
      p.x += (p.vx / s) * Math.min(d, s * dt);
      p.z += (p.vz / s) * Math.min(d, s * dt);
      p.rolled += Math.min(d, s * dt);
      p.vx = p.vz = 0;
      return;
    }
    const avg = (s + ns) / 2;
    p.x += (p.vx / s) * avg * dt;
    p.z += (p.vz / s) * avg * dt;
    p.rolled += avg * dt;
    p.vx *= ns / s;
    p.vz *= ns / s;
  });
  // Boards.
  bodies.forEach((p, idx) => {
    if (!p.alive || p.air > 0) return;
    const sp = Math.hypot(p.vx, p.vz);
    if (p.x + p.r > HALF_W) {
      p.x = HALF_W - p.r;
      if (p.vx > 0) p.vx = -p.vx * BOARD_E;
      if (sp > 0.3) ev.push({ t: 'board', b: idx, v: sp, x: p.x, z: p.z });
    } else if (p.x - p.r < -HALF_W) {
      p.x = -HALF_W + p.r;
      if (p.vx < 0) p.vx = -p.vx * BOARD_E;
      if (sp > 0.3) ev.push({ t: 'board', b: idx, v: sp, x: p.x, z: p.z });
    }
    if (p.z + p.r > BACK_Z) {
      p.z = BACK_Z - p.r;
      if (p.vz > 0) p.vz = -p.vz * BOARD_E;
      if (sp > 0.3) ev.push({ t: 'board', b: idx, v: sp, x: p.x, z: p.z });
    } else if (p.z - p.r < -PITCH_L) {
      if (p.owner >= 0) {
        // A ball that reaches the far board is dead.
        p.alive = false;
        p.out = 'dead';
        p.vx = p.vz = 0;
        ev.push({ t: 'dead', b: idx, x: p.x, z: p.z });
      } else {
        // The jack bounces back: it never leaves the pitch.
        p.z = -PITCH_L + p.r;
        if (p.vz < 0) p.vz = -p.vz * BOARD_E;
        if (sp > 0.3) ev.push({ t: 'board', b: idx, v: sp, x: p.x, z: p.z });
      }
    }
  });
  // Collisions between bodies on the ground.
  for (let a = 0; a < bodies.length; a++) {
    const A = bodies[a];
    if (!A.alive || A.air > 0) continue;
    for (let b = a + 1; b < bodies.length; b++) {
      const B = bodies[b];
      if (!B.alive || B.air > 0) continue;
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const min = A.r + B.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const nx = d2 > 0 ? dx / d : 1;
      const nz = d2 > 0 ? dz / d : 0;
      // Push apart, the lighter one further.
      const overlap = min - d;
      const ia = 1 / A.m;
      const ib = 1 / B.m;
      A.x -= nx * overlap * (ia / (ia + ib));
      A.z -= nz * overlap * (ia / (ia + ib));
      B.x += nx * overlap * (ib / (ia + ib));
      B.z += nz * overlap * (ib / (ia + ib));
      const vrel = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
      if (vrel >= 0) continue;
      const j = (-(1 + BALL_E) * vrel) / (ia + ib);
      A.vx -= j * ia * nx;
      A.vz -= j * ia * nz;
      B.vx += j * ib * nx;
      B.vz += j * ib * nz;
      ev.push({ t: 'hit', a, b, j, x: A.x + nx * A.r, z: A.z + nz * A.r, jack: A.owner < 0 || B.owner < 0 });
    }
  }
  return ev;
}

export const moving = (p: Body) => p.alive && (p.air > 0 || p.vx !== 0 || p.vz !== 0);

export class BoulesSim {
  readonly jack: Body;
  /** Every ball thrown this end (dead ones too), in throw order. */
  readonly balls: Body[] = [];
  readonly gone: boolean[];
  readonly solo: boolean;
  readonly ballsEach: number;
  /** The whole end's throws, in order. */
  readonly order: { i: number; k: number }[];
  /** Index into `order` of the current (or last) throw. */
  cursor = -1;
  phase: BoulesPhase = 'idle';
  phaseT = 0;
  time = 0;
  aim = 0;
  charging = false;
  chargeT = 0;
  /** Where the jack lay when the end started. */
  readonly jackStart: { x: number; z: number };
  /** The ball in flight from the last throw (index into `balls`), or -1. */
  current = -1;
  /** Seconds since the last throw. */
  flightT = 0;

  constructor(
    readonly players: number,
    readonly end = 0,
    rng: Rng = Math.random,
    gone: boolean[] = [],
  ) {
    this.gone = Array.from({ length: players }, (_, i) => !!gone[i]);
    const live = this.gone.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
    this.solo = live.length <= 1;
    this.ballsEach = this.solo ? BALLS_SOLO : BALLS_EACH;
    this.order = throwOrder(live, end, this.ballsEach);
    const jz = -(JACK_MIN + rng() * (JACK_MAX - JACK_MIN));
    const jx = (rng() * 2 - 1) * JACK_SIDE;
    this.jack = makeBody(-1, 0, jx, jz);
    this.jackStart = { x: jx, z: jz };
  }

  /** Bodies for the physics: the jack first, then the balls. */
  get bodies(): Body[] {
    return [this.jack, ...this.balls];
  }

  /** Who is throwing now (-1: nobody). */
  get thrower() {
    return this.phase === 'aim' || this.phase === 'flight' ? (this.order[this.cursor]?.i ?? -1) : -1;
  }

  /** The current throw's ball number for its player (0-based). */
  get ballNo() {
    return this.order[this.cursor]?.k ?? 0;
  }

  /** Power on the meter right now. */
  get power() {
    return this.charging ? meterPower(this.chargeT) : 0;
  }

  /** Time left in the current turn. */
  get turnLeft() {
    return this.phase === 'aim' ? Math.max(0, TURN_TIME - this.phaseT) : 0;
  }

  /** Balls player i still has to throw this end. */
  ballsLeft(i: number) {
    if (this.gone[i]) return 0;
    const from = this.phase === 'aim' ? this.cursor : this.cursor + 1;
    return this.order.slice(Math.max(0, from)).filter((t) => t.i === i).length;
  }

  /** Throws still to come after the current one (for "you're next"). */
  turnsUntil(i: number) {
    for (let c = this.cursor + 1, n = 1; c < this.order.length; c++) {
      const t = this.order[c];
      if (this.gone[t.i]) continue;
      if (t.i === i) return n;
      n++;
    }
    return -1;
  }

  begin() {
    if (this.phase !== 'idle') return [];
    const ev: BoulesEvent[] = [];
    this.nextTurn(ev);
    return ev;
  }

  /** A player left: their balls come off the pitch and their throws are skipped. */
  remove(i: number): BoulesEvent[] {
    const ev: BoulesEvent[] = [];
    if (i < 0 || i >= this.players || this.gone[i]) return ev;
    this.gone[i] = true;
    this.balls.forEach((b) => {
      if (b.owner === i && b.alive) {
        b.alive = false;
        b.out = 'gone';
      }
    });
    if (this.phase === 'aim' && this.order[this.cursor]?.i === i) this.nextTurn(ev);
    return ev;
  }

  step(ins: readonly BoulesInput[]): BoulesEvent[] {
    const ev: BoulesEvent[] = [];
    this.time += DT;
    this.phaseT += DT;
    switch (this.phase) {
      case 'aim':
        this.stepAim(ins, ev);
        break;
      case 'flight':
        this.stepFlight(ev);
        break;
      case 'pause':
        if (this.phaseT >= PAUSE_TIME) this.nextTurn(ev);
        break;
    }
    return ev;
  }

  private stepAim(ins: readonly BoulesInput[], ev: BoulesEvent[]) {
    const i = this.order[this.cursor]?.i ?? -1;
    const inp = ins[i] ?? { x: 0, held: false, presses: 0, live: false };
    if (!inp.live) {
      if (this.phaseT >= OFFLINE_WAIT) this.throwBall(i, this.charging ? this.power : AUTO_POWER, true, ev);
      return;
    }
    if (!this.charging) this.aim = aimStep(this.aim, inp.x, DT);
    if (!this.charging && inp.presses > 0) {
      this.charging = true;
      this.chargeT = 0;
      ev.push({ t: 'charge', i });
    } else if (this.charging) this.chargeT += DT;
    if (this.charging && !inp.held) {
      this.throwBall(i, this.power, false, ev);
      return;
    }
    if (this.phaseT >= TURN_TIME) this.throwBall(i, this.charging ? this.power : AUTO_POWER, !this.charging, ev);
  }

  /** Throw the current player's ball now (also used by the tests). */
  throwBall(i: number, power: number, auto: boolean, ev: BoulesEvent[] = []) {
    const k = this.order[this.cursor]?.k ?? 0;
    const p = Math.max(0, Math.min(1, power));
    const dir = aimDir(this.aim);
    const total = throwDistance(p);
    const flyD = LOB * total;
    const T = airTime(p);
    const b = makeBody(i, k, 0, RELEASE_Z);
    b.y = RELEASE_Y;
    b.air = T;
    b.vx = (dir.x * flyD) / T;
    b.vz = (dir.z * flyD) / T;
    b.vy = (BALL_R - RELEASE_Y + 0.5 * GRAVITY * T * T) / T;
    b.rollV = Math.sqrt(2 * BALL_FRICTION * (1 - LOB) * total);
    this.balls.push(b);
    this.current = this.balls.length - 1;
    this.charging = false;
    this.chargeT = 0;
    this.phase = 'flight';
    this.phaseT = 0;
    this.flightT = 0;
    ev.push({ t: 'throw', i, power: p, aim: this.aim, auto });
    return ev;
  }

  private stepFlight(ev: BoulesEvent[]) {
    this.flightT += DT;
    const bodies = this.bodies;
    const raw: BoulesEvent[] = [];
    for (let s = 0; s < SUB; s++) physicsStep(bodies, DT / SUB, raw);
    // Physics indexes bodies with the jack at 0: turn those into ball indexes (-1 = the jack).
    for (const e of raw) {
      if (e.t === 'land' || e.t === 'board' || e.t === 'dead') ev.push({ ...e, b: e.b - 1 });
      else if (e.t === 'hit') ev.push({ ...e, a: e.a - 1, b: e.b - 1 });
      else ev.push(e);
    }
    if (!bodies.some(moving) || this.flightT >= MAX_FLIGHT) {
      bodies.forEach((p) => {
        if (!p.alive) return;
        p.vx = p.vz = 0;
        if (p.air > 0) {
          p.air = 0;
          p.y = p.r;
        }
      });
      this.phase = 'pause';
      this.phaseT = 0;
      ev.push({ t: 'settled', jackMoved: Math.hypot(this.jack.x - this.jackStart.x, this.jack.z - this.jackStart.z) });
    }
  }

  private nextTurn(ev: BoulesEvent[]) {
    this.charging = false;
    this.chargeT = 0;
    this.current = -1;
    do this.cursor++;
    while (this.cursor < this.order.length && this.gone[this.order[this.cursor].i]);
    if (this.cursor >= this.order.length) {
      this.cursor = this.order.length;
      if (this.phase !== 'done') {
        this.phase = 'done';
        this.phaseT = 0;
        ev.push({ t: 'over' });
      }
      return;
    }
    const t = this.order[this.cursor];
    this.phase = 'aim';
    this.phaseT = 0;
    this.aim = aimAt(this.jack.x, this.jack.z);
    ev.push({ t: 'turn', i: t.i, k: t.k });
  }

  /** Live balls with their gaps to the jack, closest first, with places and points. */
  results() {
    const balls = this.balls.map((b, idx) => ({ b: idx, owner: b.owner, cm: gapCm(b, this.jack), alive: b.alive && !this.gone[b.owner] })).filter((x) => x.alive);
    return scoreEnd(balls, this.players, this.solo);
  }
}

export function howTo(short: boolean): string[] {
  return ['Swing the aim with the stick, hold THROW', 'Let go when the meter is right – it rolls on', short ? 'One end · closest balls to the pierożek score' : 'Three ends · closest balls to the pierożek score'];
}
