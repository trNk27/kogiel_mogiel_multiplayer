/**
 * Pure, Node-safe simulation for the phone "Feed Baja" minigame.
 * Choreography: Baja appears big in her carrier bag -> hops out -> runs to the back (shrinking) ->
 * "FEED ME!" prompt -> runs across the top while the player flings 5 treats upward.
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

export const BAG_INTRO_S = 0.85;
export const HOP_OUT_S = 0.42;
export const RUN_BACK_S = 0.95;
export const PROMPT_S = 0.65;

export type TreatKind = 'kielbasa' | 'cheese' | 'chicken' | 'pierogi' | 'biscuit';
export const TREAT_ORDER: readonly TreatKind[] = ['kielbasa', 'cheese', 'chicken', 'pierogi', 'biscuit'];

export type BajaFeedPhase = 'bagIntro' | 'hopOut' | 'runBack' | 'prompt' | 'play' | 'done';

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
  bagEmpty = false;

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

  private nextId = 1;
  private rnd: () => number;
  private targetX = BAG_START_X;
  private targetY = 70;
  private speed = 70;
  private pauseTimer = 0;

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
        this.bagVisible = true;
        this.bagEmpty = false;
        this.bagScale = 3.0;
        this.bagY = BAG_START_Y;
        this.bajaVisible = false;
        if (this.phaseTime >= BAG_INTRO_S) {
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
        this.bajaY = 192 + (70 - 192) * ease;
        this.bajaX = BAG_START_X + Math.sin(u * Math.PI * 2) * 16;
        this.bajaFacing = Math.cos(u * Math.PI * 2) >= 0 ? 1 : -1;
        this.bajaScale = 2.65 + (1.45 - 2.65) * ease;
        this.bajaHopY = Math.abs(Math.sin(u * Math.PI * 6)) * 4;
        this.bagY = BAG_START_Y + ease * 115;
        if (this.bagY > FEED_H + 30) this.bagVisible = false;
        if (u >= 1) {
          this.phase = 'prompt';
          this.phaseTime = 0;
          this.bagVisible = false;
          this.bajaHopY = 0;
          this.bajaY = 70;
          this.bajaScale = this.scaleForY(this.bajaY);
          this.pickTarget();
        }
        break;
      }
      case 'prompt': {
        this.updatePatrol(dt);
        if (this.phaseTime >= PROMPT_S) {
          this.phase = 'play';
          this.phaseTime = 0;
        }
        break;
      }
      case 'play': {
        this.updatePatrol(dt);
        this.updateProjectiles(dt);
        if (this.remaining === 0 && this.projectiles.length === 0) {
          this.phase = 'done';
          this.phaseTime = 0;
          this.bajaRunning = false;
        }
        break;
      }
      case 'done': {
        this.bajaRunning = false;
        this.bajaHopY = this.fed > 0 ? Math.abs(Math.sin(this.time * 5)) * 5 : 0;
        break;
      }
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
          text: 'NOM! +1 🦴',
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
