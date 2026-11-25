/**
 * Pure, Node-safe simulation for the phone "Feed Baja" minigame.
 * Choreography: her empty carrier bag appears -> Baja drops in from the top of the phone screen and
 * lands in it with a thump -> hops out -> runs to the back (shrinking) -> stops and yells "FEED ME!" ->
 * runs across the top while the player flings 5 treats upward -> comes forward and spits out one
 * bone per treat she caught -> "+X 🦴".
 */
import { BAJA_FEED_ITEMS } from '../../../shared/cosmetics';

export const FEED_W = 180;
export const FEED_H = 280;

export const BAG_START_X = 90;
export const BAG_START_Y = 214;
export const LAUNCH_Y = 244;

export const BAJA_TOP_Y_MIN = 50;
export const BAJA_TOP_Y_MAX = 94;
export const BAJA_TOP_X_MIN = 26;
export const BAJA_TOP_X_MAX = 154;

/** The empty bag pops up on its own first. */
export const BAG_INTRO_S = 0.6;
/** Baja falls from the top of the phone screen into the bag (drawn above the whole page). */
export const DROP_S = 0.55;
/** The thump: the bag squashes, dust flies. */
export const LAND_S = 0.55;
export const HOP_OUT_S = 0.42;
export const RUN_BACK_S = 0.95;
/** Baja stands still and yells "FEED ME!". */
export const PROMPT_S = 1.25;
/** After the last treat: Baja trots forward before spitting out her bones. */
export const SPIT_WALK_S = 0.55;
/** Time between two spat-out bones, and how long each one flies. */
export const SPIT_GAP_S = 0.3;
export const BONE_FLIGHT_S = 0.55;

/** Where Baja stands to spit, and the floor line where the bones land. */
export const SPIT_X = 90;
export const SPIT_Y = 132;
export const BONE_FLOOR_Y = 236;
/** Where Baja stops to yell "FEED ME!" (far enough forward for the speech bubble to fit above her). */
export const PROMPT_Y = 96;
/** The bag's opening (top of the empty bag at scale 3, a little inside it). */
export const BAG_MOUTH_Y = BAG_START_Y - 16 * 3 + 10;

export type TreatKind = 'kielbasa' | 'cheese' | 'chicken' | 'pierogi' | 'biscuit';
export const TREAT_ORDER: readonly TreatKind[] = ['kielbasa', 'cheese', 'chicken', 'pierogi', 'biscuit'];

export type BajaFeedPhase = 'bagIntro' | 'drop' | 'land' | 'hopOut' | 'runBack' | 'prompt' | 'play' | 'spit' | 'done';

/** A bone Baja spat out: flies in an arc from her mouth to its spot on the floor. */
export interface SpatBone {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Seconds since it left her mouth. */
  age: number;
}

export interface TreatProjectile {
  id: number;
  kind: TreatKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  scale: number;
}

export interface FeedCue {
  id: number;
  text: string;
  good: boolean;
  x: number;
  y: number;
  age: number;
  ttl: number;
}

/** 0 → 1 with a small overshoot past 1 (for things popping into view). */
function popIn(u: number): number {
  const c = 1.7;
  const x = u - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
}

/** Position of a spat bone `age` seconds into its flight: an arc that lands on its spot. */
export function bonePosition(b: SpatBone): { x: number; y: number; landed: boolean } {
  const u = Math.min(1, b.age / BONE_FLIGHT_S);
  const x = b.fromX + (b.toX - b.fromX) * u;
  const arc = Math.sin(u * Math.PI) * 46;
  const y = b.fromY + (b.toY - b.fromY) * u * u - arc;
  return { x, y, landed: u >= 1 };
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

export class BajaFeedSim {
  phase: BajaFeedPhase = 'bagIntro';
  time = 0;
  phaseTime = 0;

  bagX = BAG_START_X;
  bagY = BAG_START_Y;
  bagScale = 3.0;
  bagVisible = true;
  bagEmpty = true;
  /** 1 right at the thump, easing back to 0: the bag squashes flat and wide. */
  bagSquash = 0;

  bajaVisible = false;
  bajaX = BAG_START_X;
  bajaY = 210;
  bajaHopY = 0;
  bajaScale = 3.0;
  bajaFacing: 1 | -1 = 1;
  bajaRunning = false;
  bajaHappyTimer = 0;

  remaining = BAJA_FEED_ITEMS;
  fed = 0;
  projectiles: TreatProjectile[] = [];
  cues: FeedCue[] = [];
  bones: SpatBone[] = [];

  private nextId = 1;
  private rnd: () => number;
  private targetX = BAG_START_X;
  private targetY = 70;
  private speed = 70;
  private pauseTimer = 0;
  private walkFromX = SPIT_X;
  private walkFromY = SPIT_Y;
  private walkFromScale = 1.5;

  constructor(seed = 77) {
    this.rnd = makeRng(seed);
    this.pickTarget();
  }

  currentTreat(): TreatKind | null {
    if (this.remaining <= 0) return null;
    const used = BAJA_FEED_ITEMS - this.remaining;
    return TREAT_ORDER[used % TREAT_ORDER.length];
  }

  /**
   * Fling the current treat upward toward Baja's zone.
   * Returns `false` if not ready or if the swipe wasn't an upward fling (does not waste an item).
   */
  fling(dx: number, dy: number, durationMs: number, startX = BAG_START_X): boolean {
    if (this.phase !== 'play' || this.remaining <= 0) return false;
    const len = Math.hypot(dx, dy);
    if (dy > -14 || len < 16) return false;

    const kind = this.currentTreat()!;
    this.remaining--;

    const secs = Math.max(0.05, Math.min(0.45, durationMs / 1000));
    const rawSpeed = len / secs;
    const speed = Math.max(270, Math.min(420, rawSpeed));

    let ux = dx / len;
    let uy = dy / len;
    const minUpRatio = -220 / speed;
    if (uy > minUpRatio) {
      uy = minUpRatio;
      ux = Math.sign(dx || 1) * Math.sqrt(Math.max(0, 1 - uy * uy));
    }

    const clampedStartX = Math.max(28, Math.min(FEED_W - 28, startX));
    this.projectiles.push({
      id: this.nextId++,
      kind,
      x: clampedStartX,
      y: LAUNCH_Y,
      vx: ux * speed,
      vy: uy * speed,
      angle: 0,
      spin: (ux >= 0 ? 1 : -1) * (8 + Math.abs(ux) * 6),
      scale: 1,
    });
    return true;
  }

  /** Hitbox center & radius of Baja during play/prompt. */
  bajaHitbox() {
    return {
      cx: this.bajaX,
      cy: this.bajaY - 7 * this.bajaScale,
      r: 13 * this.bajaScale + 6,
    };
  }

  update(rawDt: number) {
    const dt = Math.min(0.1, Math.max(0, rawDt));
    if (dt <= 0) return;

    this.time += dt;
    this.phaseTime += dt;
    if (this.bajaHappyTimer > 0) this.bajaHappyTimer = Math.max(0, this.bajaHappyTimer - dt);

    // Update floating text cues
    for (let i = this.cues.length - 1; i >= 0; i--) {
      const c = this.cues[i];
      c.age += dt;
      c.y -= 18 * dt;
      if (c.age >= c.ttl) this.cues.splice(i, 1);
    }

    switch (this.phase) {
      case 'bagIntro': {
        // The empty bag pops up with a little overshoot.
        const u = Math.min(1, this.phaseTime / BAG_INTRO_S);
        this.bagVisible = true;
        this.bagEmpty = true;
        this.bagScale = 3.0 * popIn(Math.min(1, u / 0.6));
        this.bagY = BAG_START_Y;
        this.bajaVisible = false;
        if (u >= 1) {
          this.bagScale = 3.0;
          this.phase = 'drop';
          this.phaseTime = 0;
        }
        break;
      }
      case 'drop': {
        // Baja is drawn by the page above everything while she falls (dropProgress()).
        if (this.phaseTime >= DROP_S) {
          this.phase = 'land';
          this.phaseTime = 0;
          this.bagEmpty = false;
          this.bagSquash = 1;
        }
        break;
      }
      case 'land': {
        const u = Math.min(1, this.phaseTime / LAND_S);
        // A springy wobble that dies down.
        this.bagSquash = Math.cos(u * Math.PI * 2.5) * Math.pow(1 - u, 2);
        if (u >= 1) {
          this.bagSquash = 0;
          this.phase = 'hopOut';
          this.phaseTime = 0;
          this.bagEmpty = true;
          this.bajaVisible = true;
          this.bajaRunning = true;
          this.bajaX = BAG_START_X;
          this.bajaY = 210;
          this.bajaScale = 3.0;
        }
        break;
      }
      case 'hopOut': {
        const u = Math.min(1, this.phaseTime / HOP_OUT_S);
        this.bagVisible = true;
        this.bagEmpty = true;
        this.bajaVisible = true;
        this.bajaRunning = true;
        this.bajaY = 210 - 18 * u;
        this.bajaHopY = Math.sin(u * Math.PI) * 26;
        this.bajaScale = 3.0 - 0.35 * u;
        if (u >= 1) {
          this.phase = 'runBack';
          this.phaseTime = 0;
          this.bajaHopY = 0;
          this.bajaFacing = -1;
        }
        break;
      }
      case 'runBack': {
        const u = Math.min(1, this.phaseTime / RUN_BACK_S);
        const ease = 1 - Math.pow(1 - u, 2);
        this.bajaVisible = true;
        this.bajaRunning = true;
        this.bajaY = 192 + (PROMPT_Y - 192) * ease;
        this.bajaX = BAG_START_X + Math.sin(u * Math.PI * 2) * 16;
        this.bajaFacing = Math.cos(u * Math.PI * 2) >= 0 ? 1 : -1;
        this.bajaScale = 2.65 + (this.scaleForY(PROMPT_Y) - 2.65) * ease;
        this.bajaHopY = Math.abs(Math.sin(u * Math.PI * 6)) * 4;
        this.bagY = BAG_START_Y + ease * 115;
        if (this.bagY > FEED_H + 30) this.bagVisible = false;
        if (u >= 1) {
          this.phase = 'prompt';
          this.phaseTime = 0;
          this.bagVisible = false;
          this.bajaHopY = 0;
          this.bajaX = BAG_START_X;
          this.bajaY = PROMPT_Y;
          this.bajaScale = this.scaleForY(this.bajaY);
        }
        break;
      }
      case 'prompt': {
        // Standing still, facing the player, barking: tiny quick hops.
        this.bajaRunning = false;
        this.bajaFacing = 1;
        this.bajaHopY = Math.abs(Math.sin(this.phaseTime * 16)) * 2.5;
        if (this.phaseTime >= PROMPT_S) {
          this.phase = 'play';
          this.phaseTime = 0;
          this.bajaHopY = 0;
          this.pickTarget();
        }
        break;
      }
      case 'play': {
        this.updatePatrol(dt);
        this.updateProjectiles(dt);
        if (this.remaining === 0 && this.projectiles.length === 0) {
          this.phaseTime = 0;
          this.bajaHopY = 0;
          if (this.fed > 0) {
            this.phase = 'spit';
            this.walkFromX = this.bajaX;
            this.walkFromY = this.bajaY;
            this.walkFromScale = this.bajaScale;
          } else {
            this.phase = 'done';
            this.bajaRunning = false;
          }
        }
        break;
      }
      case 'spit': {
        this.updateSpit(dt);
        break;
      }
      case 'done': {
        this.bajaRunning = false;
        this.bajaHopY = this.fed > 0 ? Math.abs(Math.sin(this.time * 5)) * 3 : 0;
        for (const b of this.bones) b.age += dt;
        break;
      }
    }
  }

  /** 0 → 1 while Baja falls into her bag (only meaningful in the 'drop' phase). */
  dropProgress(): number {
    return this.phase === 'drop' ? Math.min(1, this.phaseTime / DROP_S) : this.phase === 'bagIntro' ? 0 : 1;
  }

  /** Where Baja's mouth is, for spitting bones from. */
  mouth() {
    return { x: this.bajaX + 8 * this.bajaScale * this.bajaFacing, y: this.bajaY - 8 * this.bajaScale };
  }

  /** Spot on the floor for the i-th of n bones: a neat row, centred. */
  static boneSpot(i: number, n: number) {
    // Bones are 28 px wide: leave a little air between them.
    const gap = Math.min(34, 140 / Math.max(1, n - 1));
    return { x: SPIT_X + (i - (n - 1) / 2) * gap, y: BONE_FLOOR_Y };
  }

  private updateSpit(dt: number) {
    for (const b of this.bones) b.age += dt;
    const t = this.phaseTime;
    if (t < SPIT_WALK_S) {
      // Trot forward to the middle, growing as she comes closer.
      const u = t / SPIT_WALK_S;
      const e = 1 - Math.pow(1 - u, 2);
      this.bajaRunning = true;
      this.bajaX = this.walkFromX + (SPIT_X - this.walkFromX) * e;
      this.bajaY = this.walkFromY + (SPIT_Y - this.walkFromY) * e;
      this.bajaScale = this.walkFromScale + (2.2 - this.walkFromScale) * e;
      this.bajaFacing = 1;
      this.bajaHopY = Math.abs(Math.sin(u * Math.PI * 4)) * 3;
      return;
    }
    this.bajaRunning = false;
    this.bajaX = SPIT_X;
    this.bajaY = SPIT_Y;
    this.bajaScale = 2.2;
    this.bajaFacing = 1;
    const st = t - SPIT_WALK_S;
    // One bone per treat she caught, each with a little "ptoo" hop.
    const due = Math.min(this.fed, Math.floor(st / SPIT_GAP_S) + 1);
    while (this.bones.length < due) {
      const m = this.mouth();
      const spot = BajaFeedSim.boneSpot(this.bones.length, this.fed);
      this.bones.push({ id: this.nextId++, fromX: m.x, fromY: m.y, toX: spot.x, toY: spot.y, age: 0 });
    }
    const sinceSpit = st - (due - 1) * SPIT_GAP_S;
    this.bajaHopY = sinceSpit < 0.15 ? Math.sin((sinceSpit / 0.15) * Math.PI) * 5 : 0;
    const allLanded = this.bones.length === this.fed && this.bones.every((b) => b.age >= BONE_FLIGHT_S);
    if (allLanded) {
      this.phase = 'done';
      this.phaseTime = 0;
      this.bajaHopY = 0;
    }
  }

  private scaleForY(y: number): number {
    const t = Math.max(0, Math.min(1, (y - BAJA_TOP_Y_MIN) / (BAJA_TOP_Y_MAX - BAJA_TOP_Y_MIN)));
    return 1.35 + t * 0.35;
  }

  private pickTarget() {
    this.targetX = BAJA_TOP_X_MIN + this.rnd() * (BAJA_TOP_X_MAX - BAJA_TOP_X_MIN);
    if (Math.abs(this.targetX - this.bajaX) < 36) {
      this.targetX = this.bajaX < FEED_W / 2 ? BAJA_TOP_X_MAX - 10 : BAJA_TOP_X_MIN + 10;
    }
    this.targetY = BAJA_TOP_Y_MIN + this.rnd() * (BAJA_TOP_Y_MAX - BAJA_TOP_Y_MIN);
    this.speed = 62 + this.rnd() * 22;
  }

  private updatePatrol(dt: number) {
    if (this.pauseTimer > 0) {
      this.pauseTimer = Math.max(0, this.pauseTimer - dt);
      this.bajaRunning = false;
      this.bajaHopY = 0;
      if (this.pauseTimer === 0) this.pickTarget();
      return;
    }
    const dx = this.targetX - this.bajaX;
    const dy = this.targetY - this.bajaY;
    const dist = Math.hypot(dx, dy);
    const step = this.speed * dt;
    this.bajaRunning = true;
    this.bajaHopY = Math.abs(Math.sin(this.time * 14)) * 2.5;
    if (Math.abs(dx) > 0.5) this.bajaFacing = dx >= 0 ? 1 : -1;
    if (dist <= step || dist < 1) {
      this.bajaX = this.targetX;
      this.bajaY = this.targetY;
      this.bajaScale = this.scaleForY(this.bajaY);
      this.pauseTimer = 0.16 + this.rnd() * 0.22;
      this.bajaRunning = false;
      this.bajaHopY = 0;
    } else {
      this.bajaX += (dx / dist) * step;
      this.bajaY += (dy / dist) * step;
      this.bajaScale = this.scaleForY(this.bajaY);
    }
  }

  private updateProjectiles(dt: number) {
    const hit = this.bajaHitbox();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      const depth = Math.max(0.55, Math.min(1, 0.55 + (p.y / LAUNCH_Y) * 0.45));
      p.scale = depth;

      if (Math.hypot(p.x - hit.cx, p.y - hit.cy) <= hit.r) {
        this.projectiles.splice(i, 1);
        this.fed++;
        this.bajaHappyTimer = 0.75;
        this.cues.push({
          id: this.nextId++,
          text: 'NOM!',
          good: true,
          x: hit.cx,
          y: hit.cy - 14,
          age: 0,
          ttl: 0.9,
        });
        continue;
      }

      if (p.y < -18 || p.x < -20 || p.x > FEED_W + 20) {
        this.projectiles.splice(i, 1);
        this.cues.push({
          id: this.nextId++,
          text: 'Missed!',
          good: false,
          x: Math.max(28, Math.min(FEED_W - 28, p.x)),
          y: Math.max(24, p.y + 24),
          age: 0,
          ttl: 0.65,
        });
      }
    }
  }
}
