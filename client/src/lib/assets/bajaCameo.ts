/**
 * Pure, Node-safe state machine for Baja's cosmetic cameos (her Pomchi patrol & quilted carrier bag).
 * Shared across 2D menu/win overlays, 16-bit pixel scenes, and low-poly 3D worlds without pulling
 * DOM or Three.js dependencies into shared tests.
 */

export type BajaCameoPhase =
  | 'hidden'
  | 'entering'
  | 'inBag'
  | 'hopOut'
  | 'roam'
  | 'sniff'
  | 'return'
  | 'hopIn'
  | 'leaving';

export interface BajaPatrolOptions {
  bagX: number;
  bagZ?: number;
  waypoints: readonly (readonly [number, number])[];
  speed: number;
  hopHeight: number;
  /** True for periodic TV/menu cameos where the bag comes and goes; false when parked in a game world. */
  hideBetweenVisits?: boolean;
  /** Seconds hidden before the very first appearance when `hideBetweenVisits` is true. */
  initialHidden?: number;
  /** Initial seconds resting inside the bag before hopping out when starting in the bag. */
  initialInBag?: number;
  /** Min/max seconds hidden between visits (menu overlays). */
  hiddenRange?: readonly [number, number];
  /** Min/max seconds peeking cozily inside the bag between runs. */
  inBagRange?: readonly [number, number];
  /** Min/max waypoints visited per outing. */
  stopsRange?: readonly [number, number];
  /** Optional distance from bag center where Baja lands on hop-out / launches on hop-in. */
  hopSpan?: number;
  /** Deterministic RNG seed. */
  seed?: number;
  /** Optional callback fired each time a cameo cycle finishes returning to `hidden`. */
  onCycleHidden?: () => void;
}

function makeRng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENTER_S = 0.45;
const LEAVE_S = 0.45;
const HOP_S = 0.36;
const SETTLE_AFTER_RETURN_S = 1.1;

export class BajaPatrol {
  phase: BajaCameoPhase;
  x: number;
  z: number;
  hopY = 0;
  facing: 1 | -1 = 1;
  yaw = 0;
  running = false;
  bagVisible: boolean;
  bagAlpha: number;
  showHeart = false;
  heartAge = 0;
  time = 0;

  private bagX: number;
  private bagZ: number;
  private waypoints: readonly (readonly [number, number])[];
  private readonly speed: number;
  private readonly hopHeight: number;
  private readonly hopSpan: number;
  private readonly hideBetweenVisits: boolean;
  private readonly hiddenRange: readonly [number, number];
  private readonly inBagRange: readonly [number, number];
  private readonly stopsRange: readonly [number, number];
  private readonly rnd: () => number;
  private readonly onCycleHidden?: () => void;

  private timer = 0;
  private stopsRemaining = 0;
  private lastWpIdx = -1;
  private targetX = 0;
  private targetZ = 0;
  private hopStartX = 0;
  private hopStartZ = 0;
  private hopEndX = 0;
  private hopEndZ = 0;
  private afterBag: 'outing' | 'leave' = 'outing';
  private pendingCelebrate = false;

  constructor(opts: BajaPatrolOptions) {
    this.bagX = opts.bagX;
    this.bagZ = opts.bagZ ?? 0;
    this.waypoints = opts.waypoints.length ? opts.waypoints : [[this.bagX + 1, this.bagZ]];
    this.speed = Math.max(0.1, opts.speed);
    this.hopHeight = Math.max(0, opts.hopHeight);
    this.hopSpan = opts.hopSpan ?? Math.max(0.5, this.hopHeight * 1.15);
    this.hideBetweenVisits = opts.hideBetweenVisits ?? false;
    this.hiddenRange = opts.hiddenRange ?? [11, 18];
    this.inBagRange = opts.inBagRange ?? [5, 9.5];
    this.stopsRange = opts.stopsRange ?? [1, 3];
    this.rnd = makeRng(opts.seed ?? 2026);
    this.onCycleHidden = opts.onCycleHidden;

    this.x = this.bagX;
    this.z = this.bagZ;
    this.orientToward(this.waypoints[0][0], this.waypoints[0][1]);

    if (this.hideBetweenVisits) {
      this.phase = 'hidden';
      this.bagVisible = false;
      this.bagAlpha = 0;
      this.timer = opts.initialHidden ?? 3.5;
    } else {
      this.phase = 'inBag';
      this.bagVisible = true;
      this.bagAlpha = 1;
      this.timer = opts.initialInBag ?? this.randRange(this.inBagRange);
      this.afterBag = 'outing';
    }
  }

  /** Reposition bag and patrol points cleanly between hidden cycles (e.g. alternating screen edges). */
  setSide(bagX: number, waypoints: readonly (readonly [number, number])[], bagZ = 0) {
    this.bagX = bagX;
    this.bagZ = bagZ;
    this.waypoints = waypoints.length ? waypoints : [[bagX + 1, bagZ]];
    this.lastWpIdx = -1;
    if (this.phase === 'hidden' || this.phase === 'inBag') {
      this.x = this.bagX;
      this.z = this.bagZ;
      this.orientToward(this.waypoints[0][0], this.waypoints[0][1]);
    }
  }

  /** Trigger an immediate joyful outing with floating heart accents (e.g. crown win or celebration). */
  celebrate() {
    this.pendingCelebrate = true;
    this.showHeart = true;
    this.heartAge = 0;
    if (this.phase === 'hidden') {
      this.phase = 'entering';
      this.bagVisible = true;
      this.bagAlpha = 0;
      this.x = this.bagX;
      this.z = this.bagZ;
      this.timer = ENTER_S;
      this.afterBag = 'outing';
    } else if (this.phase === 'leaving') {
      this.phase = 'entering';
      this.bagVisible = true;
      this.timer = ENTER_S * (1 - this.bagAlpha);
      this.afterBag = 'outing';
    } else if (this.phase === 'inBag') {
      this.afterBag = 'outing';
      this.timer = Math.min(this.timer, 0.35);
    } else if (this.phase === 'sniff') {
      this.stopsRemaining = Math.max(this.stopsRemaining, 1);
    }
  }

  update(rawDt: number) {
    const dt = Math.min(0.1, Math.max(0, rawDt));
    this.time += dt;
    if (this.showHeart) {
      this.heartAge += dt;
      if (this.heartAge > 2.2 && !this.pendingCelebrate) {
        this.showHeart = false;
      }
    }

    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-6 && guard++ < 6) {
      remaining = this.stepPhase(remaining);
    }
  }

  private stepPhase(dt: number): number {
    switch (this.phase) {
      case 'hidden': {
        this.bagVisible = false;
        this.bagAlpha = 0;
        this.running = false;
        this.hopY = 0;
        this.timer -= dt;
        if (this.timer <= 0) {
          const carry = -this.timer;
          this.phase = 'entering';
          this.bagVisible = true;
          this.x = this.bagX;
          this.z = this.bagZ;
          this.orientToward(this.waypoints[0][0], this.waypoints[0][1]);
          this.timer = ENTER_S;
          this.afterBag = 'outing';
          return carry;
        }
        return 0;
      }

      case 'entering': {
        this.bagVisible = true;
        this.running = false;
        this.hopY = 0;
        this.timer -= dt;
        const done = this.timer <= 0;
        this.bagAlpha = done ? 1 : Math.min(1, 1 - this.timer / ENTER_S);
        if (done) {
          const carry = -this.timer;
          this.phase = 'inBag';
          this.afterBag = 'outing';
          this.timer = this.pendingCelebrate ? 0.45 : this.randRange([1.6, 2.8]);
          return carry;
        }
        return 0;
      }

      case 'inBag': {
        this.bagVisible = true;
        this.bagAlpha = 1;
        this.running = false;
        this.hopY = 0;
        this.x = this.bagX;
        this.z = this.bagZ;
        this.timer -= dt;
        if (this.timer <= 0) {
          const carry = -this.timer;
          if (this.afterBag === 'leave' && this.hideBetweenVisits && !this.pendingCelebrate) {
            this.phase = 'leaving';
            this.timer = LEAVE_S;
            this.showHeart = false;
            return carry;
          }
          this.startOuting();
          return carry;
        }
        return 0;
      }

      case 'hopOut': {
        this.running = true;
        this.timer -= dt;
        const u = Math.min(1, Math.max(0, 1 - this.timer / HOP_S));
        this.x = this.hopStartX + (this.hopEndX - this.hopStartX) * u;
        this.z = this.hopStartZ + (this.hopEndZ - this.hopStartZ) * u;
        this.hopY = Math.sin(u * Math.PI) * this.hopHeight;
        if (this.timer <= 0) {
          const carry = -this.timer;
          this.x = this.hopEndX;
          this.z = this.hopEndZ;
          this.hopY = 0;
          this.phase = 'roam';
          return carry;
        }
        return 0;
      }

      case 'roam': {
        this.running = true;
        this.hopY = 0;
        const move = this.moveToward(this.targetX, this.targetZ, dt);
        if (move.arrived) {
          this.phase = 'sniff';
          this.running = false;
          this.timer = this.pendingCelebrate ? this.randRange([0.6, 1.0]) : this.randRange([0.85, 1.9]);
          if (this.pendingCelebrate || this.rnd() < 0.55) {
            this.showHeart = true;
            this.heartAge = 0;
          }
          return move.leftoverDt;
        }
        return 0;
      }

      case 'sniff': {
        this.running = false;
        this.hopY = 0;
        this.timer -= dt;
        if (this.timer <= 0) {
          const carry = -this.timer;
          if (this.stopsRemaining > 0) {
            this.stopsRemaining--;
            this.pickNextWaypoint();
            this.phase = 'roam';
          } else {
            this.targetX = this.bagX;
            this.targetZ = this.bagZ;
            this.phase = 'return';
          }
          return carry;
        }
        return 0;
      }

      case 'return': {
        this.running = true;
        this.hopY = 0;
        const dx = this.bagX - this.x;
        const dz = this.bagZ - this.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= this.hopSpan) {
          this.beginHopIn();
          return dt;
        }
        const maxMove = this.speed * dt;
        const reachDist = dist - this.hopSpan;
        if (maxMove >= reachDist && reachDist > 0) {
          const usedDt = reachDist / this.speed;
          this.x += (dx / dist) * reachDist;
          this.z += (dz / dist) * reachDist;
          this.orientToward(this.bagX, this.bagZ);
          this.beginHopIn();
          return Math.max(0, dt - usedDt);
        }
        this.x += (dx / dist) * maxMove;
        this.z += (dz / dist) * maxMove;
        this.orientToward(this.bagX, this.bagZ);
        return 0;
      }

      case 'hopIn': {
        this.running = true;
        this.timer -= dt;
        const u = Math.min(1, Math.max(0, 1 - this.timer / HOP_S));
        this.x = this.hopStartX + (this.bagX - this.hopStartX) * u;
        this.z = this.hopStartZ + (this.bagZ - this.hopStartZ) * u;
        this.hopY = Math.sin(u * Math.PI) * this.hopHeight;
        if (this.timer <= 0) {
          const carry = -this.timer;
          this.x = this.bagX;
          this.z = this.bagZ;
          this.hopY = 0;
          this.running = false;
          this.pendingCelebrate = false;
          this.phase = 'inBag';
          this.afterBag = this.hideBetweenVisits ? 'leave' : 'outing';
          this.timer = this.hideBetweenVisits ? SETTLE_AFTER_RETURN_S : this.randRange(this.inBagRange);
          this.orientToward(this.waypoints[0][0], this.waypoints[0][1]);
          return carry;
        }
        return 0;
      }

      case 'leaving': {
        this.bagVisible = true;
        this.running = false;
        this.hopY = 0;
        this.showHeart = false;
        this.timer -= dt;
        const done = this.timer <= 0;
        this.bagAlpha = done ? 0 : Math.max(0, this.timer / LEAVE_S);
        if (done) {
          const carry = -this.timer;
          this.phase = 'hidden';
          this.bagVisible = false;
          this.timer = this.randRange(this.hiddenRange);
          this.onCycleHidden?.();
          return carry;
        }
        return 0;
      }
    }
  }

  private startOuting() {
    this.pickNextWaypoint();
    const minStops = this.stopsRange[0];
    const maxStops = this.stopsRange[1];
    const totalStops = this.pendingCelebrate ? Math.max(2, maxStops) : this.randInt(minStops, maxStops);
    this.stopsRemaining = Math.max(0, totalStops - 1);

    const dx = this.targetX - this.bagX;
    const dz = this.targetZ - this.bagZ;
    const dist = Math.hypot(dx, dz) || 1;
    const hopDist = Math.min(dist * 0.55, this.hopSpan);
    this.hopStartX = this.bagX;
    this.hopStartZ = this.bagZ;
    this.hopEndX = this.bagX + (dx / dist) * hopDist;
    this.hopEndZ = this.bagZ + (dz / dist) * hopDist;
    this.orientToward(this.targetX, this.targetZ);
    this.phase = 'hopOut';
    this.timer = HOP_S;
    if (this.pendingCelebrate) {
      this.showHeart = true;
      this.heartAge = 0;
    } else {
      this.showHeart = false;
    }
  }

  private beginHopIn() {
    this.hopStartX = this.x;
    this.hopStartZ = this.z;
    this.hopEndX = this.bagX;
    this.hopEndZ = this.bagZ;
    this.orientToward(this.bagX, this.bagZ);
    this.phase = 'hopIn';
    this.timer = HOP_S;
  }

  private pickNextWaypoint() {
    let idx = Math.floor(this.rnd() * this.waypoints.length);
    if (this.waypoints.length > 1 && idx === this.lastWpIdx) {
      idx = (idx + 1) % this.waypoints.length;
    }
    this.lastWpIdx = idx;
    const [wx, wz] = this.waypoints[idx];
    this.targetX = wx;
    this.targetZ = wz;
  }

  private moveToward(tx: number, tz: number, dt: number): { arrived: boolean; leftoverDt: number } {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    const step = this.speed * dt;
    if (dist <= step || dist < 1e-4) {
      this.x = tx;
      this.z = tz;
      const used = dist / this.speed;
      return { arrived: true, leftoverDt: Math.max(0, dt - used) };
    }
    this.x += (dx / dist) * step;
    this.z += (dz / dist) * step;
    this.orientToward(tx, tz);
    return { arrived: false, leftoverDt: 0 };
  }

  private orientToward(tx: number, tz: number) {
    const dx = tx - this.x;
    const dz = tz - this.z;
    if (Math.abs(dx) > 1e-3) this.facing = dx >= 0 ? 1 : -1;
    if (Math.hypot(dx, dz) > 1e-4) this.yaw = Math.atan2(dx, dz);
  }

  private randRange([min, max]: readonly [number, number]): number {
    return min + this.rnd() * Math.max(0, max - min);
  }

  private randInt(min: number, max: number): number {
    return min + Math.floor(this.rnd() * (Math.max(min, max) - min + 1));
  }
}
