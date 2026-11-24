/**
 * Lodowa Wieża: pure fixed-timestep single-screen Icy Tower simulation.
 * Zero DOM/Canvas/Three.js imports so Vitest can test everything deterministically.
 */
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

export const DT = 1 / 60;

/** Canonical pixel-art internal dimensions (3× integer scale to 1920×1080). */
export const VIEW_W = 640;
export const VIEW_H = 360;

/** Climbable tower shaft bounds inside the 640×360 stage. */
export const WALL_L = 176;
export const WALL_R = 464;
export const SHAFT_W = WALL_R - WALL_L;

export const GROUND_Y = 342;
export const FLOOR_STEP = 19;
export const FLOORS = 16;
export const SUMMIT_Y = GROUND_Y - FLOORS * FLOOR_STEP; // 38

export const PLAYER_HALF_W = 6;
export const PLAYER_H = 13;

export const TOWER_ROUNDS = 3;
export const TOWER_ROUNDS_SHORT = 1;
export const ROUND_S = 45;
export const POST_CROWN_S = 8;
export const FROST_DELAY_S = 6;
export const FROST_START_Y = VIEW_H + 8;

// Physics constants tuned for crisp single-screen Icy Tower momentum & wall-bounces.
export const GRAVITY = 680;
export const MAX_FALL_VY = 520;
export const MAX_VX = 175;
export const WALL_BOUNCE_MAX_VX = 225;
export const ACCEL_STONE = 560;
export const ACCEL_ICE = 360;
export const AIR_ACCEL = 400;
export const FRICTION_STONE = 420;
export const FRICTION_ICE = 95;
export const JUMP_BASE = 200;
export const JUMP_SPEED_BONUS = 128;
export const SPRING_VY = 335;
export const WALL_BOUNCE_MIN_VX = 95;
export const WALL_BOUNCE_BOOST = 1.14;
export const WALL_KICK_VY = 145;
export const WALL_JUMP_VX = 185;
export const WALL_JUMP_VY = 285;
export const COYOTE_S = 0.09;
export const JUMP_BUFFER_S = 0.12;
export const WALL_COYOTE_S = 0.11;
export const COMBO_WINDOW_S = 2.6;
export const CRUMBLE_BREAK_S = 0.7;
export const CRUMBLE_RESPAWN_S = 3.0;

export const PLACE_BONUS = [10, 7, 5, 3, 2, 1, 1, 1] as const;

export type TowerTheme = 'frost' | 'aurora' | 'blizzard';
export const TOWER_THEMES: readonly { id: TowerTheme; name: string; sub: string }[] = [
  { id: 'frost', name: 'Frost Stone', sub: 'Solid ledges, icy steps & bouncy springs' },
  { id: 'aurora', name: 'Aurora Ice', sub: 'Glacier shelves & drifting ice rafts' },
  { id: 'blizzard', name: 'Blizzard Peak', sub: 'Slick ice, moving rafts & crumbling snow' },
];

export type PlatformKind = 'ground' | 'stone' | 'ice' | 'crumble' | 'moving' | 'summit';

export interface Platform {
  floor: number;
  kind: PlatformKind;
  x: number;
  baseX: number;
  y: number;
  w: number;
  prevX: number;
  moveAmp: number;
  moveSpeed: number;
  movePhase: number;
  /** Offset from `x` where a spring pad sits (12 px wide), or null. */
  springOffset: number | null;
  springTimer: number;
  crumbleState: 'solid' | 'shaking' | 'gone';
  crumbleTimer: number;
}

export interface TowerPlayer {
  idx: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  grounded: boolean;
  standingFloor: number;
  coyote: number;
  jumpBuffer: number;
  wallTouch: -1 | 0 | 1;
  wallCoyote: number;
  spinning: boolean;
  alive: boolean;
  gone: boolean;
  finished: boolean;
  finishOrder: number | null;
  finishTime: number | null;
  bestFloor: number;
  comboBaseFloor: number;
  comboFloors: number;
  comboJumps: number;
  comboTimer: number;
  comboBonus: number;
  bestCombo: number;
  bonkTimer: number;
  moveX: number;
}

export type TowerEvent =
  | { t: 'jump'; i: number; x: number; y: number }
  | { t: 'superJump'; i: number; x: number; y: number }
  | { t: 'wallBounce'; i: number; x: number; y: number; dir: -1 | 1 }
  | { t: 'spring'; i: number; x: number; y: number }
  | { t: 'bonk'; top: number; bottom: number; x: number; y: number }
  | { t: 'combo'; i: number; floors: number; label: string; pts: number; x: number; y: number }
  | { t: 'crumble'; floor: number; x: number; y: number }
  | { t: 'crown'; i: number; place: number; x: number; y: number }
  | { t: 'freeze'; i: number; x: number; y: number }
  | { t: 'hurry' }
  | { t: 'over' };

export function comboLabel(floors: number): string | null {
  if (floors < 4) return null;
  if (floors <= 5) return 'GOOD!';
  if (floors <= 7) return 'SWEET!';
  if (floors <= 10) return 'GREAT!';
  if (floors <= 13) return 'SUPER!';
  return 'NO WAY!';
}

export function comboPoints(floors: number): number {
  return floors >= 4 ? Math.floor(floors / 2) : 0;
}

export function edgeGap(ax: number, aw: number, bx: number, bw: number): number {
  return Math.max(0, bx - (ax + aw), ax - (bx + bw));
}

function makePlatform(floor: number, kind: PlatformKind, x: number, w: number): Platform {
  return {
    floor,
    kind,
    x,
    baseX: x,
    y: GROUND_Y - floor * FLOOR_STEP,
    w,
    prevX: x,
    moveAmp: 0,
    moveSpeed: 0,
    movePhase: 0,
    springOffset: null,
    springTimer: 0,
    crumbleState: 'solid',
    crumbleTimer: 0,
  };
}

/**
 * Generates all 17 platforms (Floor 0 ground through Floor 16 Summit) inside the fixed shaft.
 * Guarantees every consecutive pair of platforms stays horizontally reachable (`gap <= 72` px),
 * including across full moving-platform oscillation.
 */
export function generatePlatforms(themeIndex: number, rng: Rng = Math.random): Platform[] {
  const theme = ((themeIndex % 3) + 3) % 3;
  const plats: Platform[] = [];
  const margin = 4;
  const minX = WALL_L + margin;
  const maxX = WALL_R - margin;

  // Floor 0: solid base floor spanning the entire shaft.
  plats.push(makePlatform(0, 'ground', WALL_L, SHAFT_W));

  const movingFloors = theme === 1 ? new Set([7, 12]) : theme === 2 ? new Set([6, 11, 14]) : new Set<number>();
  const crumbleFloors = theme === 2 ? new Set([4, 9]) : new Set<number>();
  const springFloors = new Set([3, 9]);

  // Pre-build floor 16 summit so floor 15 can ensure reachability to it.
  const summitW = 116;
  const summitX = Math.round((WALL_L + WALL_R - summitW) / 2);

  for (let floor = 1; floor <= FLOORS - 1; floor++) {
    const prev = plats[floor - 1];
    const milestone = floor === 5 || floor === 10;

    let w: number;
    if (milestone) {
      w = theme === 0 ? SHAFT_W : theme === 1 ? 208 : 184;
    } else if (theme === 0) {
      w = Math.round(96 + rng() * 22);
    } else if (theme === 1) {
      w = Math.round(80 + rng() * 24);
    } else {
      w = Math.round(70 + rng() * 24);
    }

    let kind: PlatformKind = 'stone';
    if (milestone) {
      kind = theme === 0 ? 'stone' : 'ice';
    } else if (movingFloors.has(floor)) {
      kind = 'moving';
    } else if (crumbleFloors.has(floor)) {
      kind = 'crumble';
    } else if (theme === 0) {
      kind = floor >= 8 && rng() < 0.45 ? 'ice' : 'stone';
    } else if (theme === 1) {
      kind = rng() < 0.55 ? 'ice' : 'stone';
    } else {
      kind = rng() < 0.7 ? 'ice' : 'stone';
    }

    let x: number;
    let moveAmp = 0;
    if (milestone && theme === 0) {
      x = WALL_L;
    } else if (milestone) {
      x = Math.round((WALL_L + WALL_R - w) / 2);
    } else {
      const lo = minX;
      const hi = maxX - w;
      const maxGap = kind === 'moving' || prev.kind === 'moving' ? 40 : 62;
      const reachLo = Math.max(lo, prev.baseX - maxGap - w);
      const reachHi = Math.min(hi, prev.baseX + prev.w + maxGap);

      // Floor 15 must also reach Floor 16 Summit cleanly.
      let pickLo = reachLo;
      let pickHi = reachHi;
      if (floor === FLOORS - 1) {
        pickLo = Math.max(pickLo, summitX - 62 - w);
        pickHi = Math.min(pickHi, summitX + summitW + 62);
      }
      if (pickLo > pickHi) {
        const mid = Math.max(lo, Math.min(hi, Math.round((pickLo + pickHi) / 2)));
        pickLo = mid;
        pickHi = mid;
      }

      // Bias away from directly above the previous platform center so climbs zig-zag cleanly.
      const prevMid = prev.baseX + prev.w / 2;
      const shaftMid = (WALL_L + WALL_R) / 2;
      const preferRight = prevMid < shaftMid;
      let bestX = Math.round((pickLo + pickHi) / 2);
      let bestScore = -1;
      for (let attempt = 0; attempt < 12; attempt++) {
        const cand = Math.round(pickLo + rng() * Math.max(0, pickHi - pickLo));
        if (edgeGap(prev.baseX, prev.w, cand, w) > maxGap) continue;
        if (floor === FLOORS - 1 && edgeGap(summitX, summitW, cand, w) > 62) continue;
        const candMid = cand + w / 2;
        const sep = Math.abs(candMid - prevMid);
        const sideBonus = (preferRight ? candMid > prevMid : candMid < prevMid) ? 40 : 0;
        const score = sep + sideBonus;
        if (score > bestScore) {
          bestScore = score;
          bestX = cand;
        }
      }
      x = Math.max(pickLo, Math.min(pickHi, bestX));
    }

    const p = makePlatform(floor, kind, x, w);
    if (kind === 'moving') {
      const maxLeft = Math.max(0, x - minX);
      const maxRight = Math.max(0, maxX - (x + w));
      const room = Math.min(26, maxLeft, maxRight);
      moveAmp = room;
      while (moveAmp > 4) {
        const leftGap = edgeGap(prev.baseX - prev.moveAmp, prev.w + prev.moveAmp * 2, x - moveAmp, w);
        const rightGap = edgeGap(prev.baseX - prev.moveAmp, prev.w + prev.moveAmp * 2, x + moveAmp, w);
        if (leftGap <= 70 && rightGap <= 70) break;
        moveAmp -= 2;
      }
      p.moveAmp = Math.max(0, Math.min(room, moveAmp));
      p.moveSpeed = 1.45 + rng() * 0.65;
      p.movePhase = rng() * Math.PI * 2;
    }

    if (springFloors.has(floor) && kind !== 'crumble' && w >= 40) {
      p.springOffset = Math.round(w / 2 - 6 + (rng() - 0.5) * 16);
    }
    plats.push(p);
  }

  // Floor 16: the Summit Crown balcony.
  plats.push(makePlatform(FLOORS, 'summit', summitX, summitW));
  return plats;
}

export class TowerSim {
  readonly theme: TowerTheme;
  readonly platforms: Platform[];
  readonly players: TowerPlayer[];
  readonly solo: boolean;
  phase: 'idle' | 'play' | 'done' = 'idle';
  time = 0;
  frostY = FROST_START_Y;
  hurry = false;
  finishCount = 0;
  rushEndsAt: number | null = null;
  over = false;

  constructor(
    count: number,
    readonly themeIndex: number,
    private rng: Rng = Math.random,
    gone: boolean[] = [],
  ) {
    this.theme = TOWER_THEMES[((themeIndex % 3) + 3) % 3].id;
    this.platforms = generatePlatforms(themeIndex, this.rng);
    const activeIndices = Array.from({ length: count }, (_, i) => i).filter((i) => !gone[i]);
    const activeCount = Math.max(1, activeIndices.length);
    const span = SHAFT_W - 48;
    this.players = Array.from({ length: count }, (_, i) => {
      const slot = activeIndices.indexOf(i);
      const frac = activeCount === 1 ? 0.5 : slot >= 0 ? slot / (activeCount - 1) : 0.5;
      const x = WALL_L + 24 + frac * span;
      return {
        idx: i,
        x,
        y: GROUND_Y,
        vx: 0,
        vy: 0,
        facing: x >= (WALL_L + WALL_R) / 2 ? -1 : 1,
        grounded: true,
        standingFloor: 0,
        coyote: COYOTE_S,
        jumpBuffer: 0,
        wallTouch: 0,
        wallCoyote: 0,
        spinning: false,
        alive: !gone[i],
        gone: !!gone[i],
        finished: false,
        finishOrder: null,
        finishTime: null,
        bestFloor: 0,
        comboBaseFloor: 0,
        comboFloors: 0,
        comboJumps: 0,
        comboTimer: 0,
        comboBonus: 0,
        bestCombo: 0,
        bonkTimer: 0,
        moveX: 0,
      };
    });
    this.solo = this.players.filter((p) => !p.gone).length <= 1;
  }

  begin() {
    if (this.phase === 'idle') this.phase = 'play';
  }

  setInput(i: number, moveX: number) {
    const p = this.players[i];
    if (!p || p.gone) return;
    p.moveX = Math.max(-1, Math.min(1, Number.isFinite(moveX) ? moveX : 0));
  }

  pressJump(i: number) {
    const p = this.players[i];
    if (!p || !p.alive || p.gone || p.finished) return;
    p.jumpBuffer = JUMP_BUFFER_S;
  }

  remove(i: number) {
    const p = this.players[i];
    if (!p || p.gone) return;
    p.gone = true;
    p.alive = false;
    p.moveX = 0;
  }

  get timeLeft(): number {
    const end = this.rushEndsAt ?? ROUND_S;
    return Math.max(0, end - this.time);
  }

  private cashCombo(p: TowerPlayer, events: TowerEvent[], newBaseFloor = p.standingFloor) {
    if (p.comboFloors >= 4) {
      const label = comboLabel(p.comboFloors);
      const pts = comboPoints(p.comboFloors);
      p.comboBonus += pts;
      p.bestCombo = Math.max(p.bestCombo, p.comboFloors);
      if (label) {
        events.push({
          t: 'combo',
          i: p.idx,
          floors: p.comboFloors,
          label,
          pts,
          x: p.x,
          y: p.y - 16,
        });
      }
    }
    p.comboFloors = 0;
    p.comboJumps = 0;
    p.comboTimer = 0;
    p.comboBaseFloor = newBaseFloor;
  }

  private finishPlayer(p: TowerPlayer, events: TowerEvent[]) {
    if (p.finished) return;
    this.cashCombo(p, events, FLOORS);
    p.finished = true;
    p.finishOrder = ++this.finishCount;
    p.finishTime = this.time;
    p.bestFloor = FLOORS;
    p.standingFloor = FLOORS;
    p.y = SUMMIT_Y;
    p.vy = 0;
    p.vx = 0;
    p.grounded = true;
    p.spinning = false;
    if (this.finishCount === 1) {
      this.rushEndsAt = Math.min(ROUND_S, this.time + POST_CROWN_S);
    }
    events.push({ t: 'crown', i: p.idx, place: p.finishOrder, x: p.x, y: p.y - 14 });
  }

  step(): TowerEvent[] {
    if (this.phase !== 'play') return [];
    const events: TowerEvent[] = [];
    this.time += DT;

    // 1. Update platforms (moving rafts, spring compression, crumbling snow).
    for (const plat of this.platforms) {
      plat.prevX = plat.x;
      if (plat.kind === 'moving') {
        plat.x = plat.baseX + Math.sin(this.time * plat.moveSpeed + plat.movePhase) * plat.moveAmp;
      }
      if (plat.springTimer > 0) plat.springTimer = Math.max(0, plat.springTimer - DT);
      if (plat.kind === 'crumble') {
        if (plat.crumbleState === 'shaking') {
          plat.crumbleTimer -= DT;
          if (plat.crumbleTimer <= 0) {
            plat.crumbleState = 'gone';
            plat.crumbleTimer = CRUMBLE_RESPAWN_S;
            events.push({ t: 'crumble', floor: plat.floor, x: plat.x + plat.w / 2, y: plat.y });
          }
        } else if (plat.crumbleState === 'gone') {
          plat.crumbleTimer -= DT;
          if (plat.crumbleTimer <= 0) {
            plat.crumbleState = 'solid';
            plat.crumbleTimer = 0;
          }
        }
      }
    }

    // 2. Update rising frost flood.
    if (this.time >= 20 && !this.hurry) {
      this.hurry = true;
      events.push({ t: 'hurry' });
    }
    if (this.time >= FROST_DELAY_S) {
      let frostRate = this.hurry ? 12 : 5.5;
      if (this.rushEndsAt !== null) frostRate = Math.max(frostRate, 26);
      this.frostY = Math.max(SUMMIT_Y + 8, this.frostY - frostRate * DT);
    }

    // 3. Step players.
    const prevY = this.players.map((p) => p.y);
    for (const p of this.players) {
      if (!p.alive || p.gone || p.finished) continue;

      if (p.bonkTimer > 0) p.bonkTimer = Math.max(0, p.bonkTimer - DT);
      if (p.jumpBuffer > 0) p.jumpBuffer = Math.max(0, p.jumpBuffer - DT);
      if (p.wallCoyote > 0) {
        p.wallCoyote = Math.max(0, p.wallCoyote - DT);
        if (p.wallCoyote === 0) p.wallTouch = 0;
      }

      // Check whether grounded player is still supported by their platform.
      let standingPlat: Platform | null = null;
      if (p.grounded) {
        const cand = this.platforms[p.standingFloor];
        if (cand && cand.crumbleState !== 'gone' && p.x + PLAYER_HALF_W >= cand.x && p.x - PLAYER_HALF_W <= cand.x + cand.w) {
          standingPlat = cand;
          p.x += cand.x - cand.prevX;
          p.coyote = COYOTE_S;
        } else {
          p.grounded = false;
        }
      }
      if (!p.grounded && p.coyote > 0) p.coyote = Math.max(0, p.coyote - DT);

      // Horizontal acceleration & friction.
      const inputX = Math.abs(p.moveX) > 0.12 ? p.moveX : 0;
      if (inputX !== 0) p.facing = inputX > 0 ? 1 : -1;

      const onIce = standingPlat?.kind === 'ice';
      const accel = p.grounded ? (onIce ? ACCEL_ICE : ACCEL_STONE) : AIR_ACCEL;
      const friction = onIce ? FRICTION_ICE : FRICTION_STONE;

      if (inputX !== 0) {
        const target = inputX * MAX_VX;
        if (Math.abs(p.vx) > MAX_VX && Math.sign(p.vx) === Math.sign(target)) {
          // Preserve wall-bounce overspeed smoothly until turning back.
          p.vx *= 1 - 0.5 * DT;
        } else {
          const dv = accel * DT;
          if (Math.abs(target - p.vx) <= dv) p.vx = target;
          else p.vx += Math.sign(target - p.vx) * dv;
        }
      } else if (p.grounded) {
        const dv = friction * DT;
        if (Math.abs(p.vx) <= dv) p.vx = 0;
        else p.vx -= Math.sign(p.vx) * dv;
      } else {
        p.vx *= 1 - 0.8 * DT;
      }

      // Jump consumption: ground/coyote jump OR wall jump.
      if (p.jumpBuffer > 0) {
        if (p.grounded || p.coyote > 0) {
          p.jumpBuffer = 0;
          p.coyote = 0;
          p.grounded = false;
          const speedRatio = Math.min(1.12, Math.abs(p.vx) / MAX_VX);
          p.vy = -(JUMP_BASE + JUMP_SPEED_BONUS * Math.pow(speedRatio, 1.25));
          if (speedRatio >= 0.72) {
            p.spinning = true;
            events.push({ t: 'superJump', i: p.idx, x: p.x, y: p.y });
          } else {
            p.spinning = false;
            events.push({ t: 'jump', i: p.idx, x: p.x, y: p.y });
          }
        } else if (p.wallCoyote > 0 && p.wallTouch !== 0) {
          const dir = (-p.wallTouch) as -1 | 1;
          p.jumpBuffer = 0;
          p.wallCoyote = 0;
          p.wallTouch = 0;
          p.vx = dir * Math.max(WALL_JUMP_VX, Math.min(WALL_BOUNCE_MAX_VX, Math.abs(p.vx) * 1.1));
          p.vy = -WALL_JUMP_VY;
          p.facing = dir;
          p.spinning = true;
          events.push({ t: 'wallBounce', i: p.idx, x: dir > 0 ? WALL_L : WALL_R, y: p.y - 6, dir });
        }
      }

      // Integrate velocity & position.
      if (!p.grounded) {
        p.vy = Math.min(MAX_FALL_VY, p.vy + GRAVITY * DT);
      }
      p.x += p.vx * DT;
      p.y += p.vy * DT;

      // Left / Right brick wall collisions & Icy Tower wall-bounce!
      if (p.x - PLAYER_HALF_W < WALL_L) {
        p.x = WALL_L + PLAYER_HALF_W;
        if (!p.grounded && p.vx <= -WALL_BOUNCE_MIN_VX) {
          p.vx = Math.min(WALL_BOUNCE_MAX_VX, Math.abs(p.vx) * WALL_BOUNCE_BOOST);
          p.vy = Math.min(p.vy, -WALL_KICK_VY);
          p.facing = 1;
          p.spinning = true;
          p.wallTouch = 0;
          p.wallCoyote = 0;
          events.push({ t: 'wallBounce', i: p.idx, x: WALL_L, y: p.y - 6, dir: 1 });
        } else {
          p.vx = 0;
          if (!p.grounded) {
            p.wallTouch = -1;
            p.wallCoyote = WALL_COYOTE_S;
          }
        }
      } else if (p.x + PLAYER_HALF_W > WALL_R) {
        p.x = WALL_R - PLAYER_HALF_W;
        if (!p.grounded && p.vx >= WALL_BOUNCE_MIN_VX) {
          p.vx = -Math.min(WALL_BOUNCE_MAX_VX, Math.abs(p.vx) * WALL_BOUNCE_BOOST);
          p.vy = Math.min(p.vy, -WALL_KICK_VY);
          p.facing = -1;
          p.spinning = true;
          p.wallTouch = 0;
          p.wallCoyote = 0;
          events.push({ t: 'wallBounce', i: p.idx, x: WALL_R, y: p.y - 6, dir: -1 });
        } else {
          p.vx = 0;
          if (!p.grounded) {
            p.wallTouch = 1;
            p.wallCoyote = WALL_COYOTE_S;
          }
        }
      }

      // Swept one-way platform landing (check highest-y platform crossed first).
      if (!p.grounded && p.vy >= 0) {
        const py0 = prevY[p.idx];
        let landed: Platform | null = null;
        for (let k = this.platforms.length - 1; k >= 0; k--) {
          const plat = this.platforms[k];
          if (plat.crumbleState === 'gone') continue;
          if (py0 <= plat.y + 1.5 && p.y >= plat.y && p.x + PLAYER_HALF_W >= plat.x && p.x - PLAYER_HALF_W <= plat.x + plat.w) {
            landed = plat;
            break;
          }
        }
        if (landed) {
          p.y = landed.y;
          p.vy = 0;
          p.grounded = true;
          p.standingFloor = landed.floor;
          p.coyote = COYOTE_S;
          p.spinning = false;
          p.wallTouch = 0;
          p.wallCoyote = 0;
          p.bestFloor = Math.max(p.bestFloor, landed.floor);

          if (landed.kind === 'crumble' && landed.crumbleState === 'solid') {
            landed.crumbleState = 'shaking';
            landed.crumbleTimer = CRUMBLE_BREAK_S;
          }

          // Combo update before potential spring launch or summit finish.
          const diff = landed.floor - p.comboBaseFloor;
          if (diff >= 2) {
            p.comboFloors += diff;
            p.comboJumps++;
            p.comboTimer = COMBO_WINDOW_S;
            p.comboBaseFloor = landed.floor;
          } else if (landed.floor !== p.comboBaseFloor) {
            this.cashCombo(p, events, landed.floor);
          }

          if (landed.floor === FLOORS) {
            this.finishPlayer(p, events);
            continue;
          }

          if (landed.springOffset !== null) {
            const sx = landed.x + landed.springOffset;
            if (p.x + PLAYER_HALF_W >= sx && p.x - PLAYER_HALF_W <= sx + 12) {
              landed.springTimer = 0.28;
              p.grounded = false;
              p.vy = -SPRING_VY;
              p.spinning = true;
              events.push({ t: 'spring', i: p.idx, x: sx + 6, y: landed.y });
            }
          }
        }
      }

      // Direct crown touch while leaping up onto the summit balcony.
      if (!p.finished && p.y <= SUMMIT_Y + 6 && p.y >= SUMMIT_Y - 22 && Math.abs(p.x - (WALL_L + WALL_R) / 2) <= 22) {
        this.finishPlayer(p, events);
        continue;
      }

      // Combo timer expires while grounded.
      if (p.comboFloors > 0 && p.grounded) {
        p.comboTimer = Math.max(0, p.comboTimer - DT);
        if (p.comboTimer <= 0) this.cashCombo(p, events, p.standingFloor);
      }

      // Floor 0 safety clamp.
      if (p.y > GROUND_Y) {
        p.y = GROUND_Y;
        p.vy = 0;
        p.grounded = true;
        p.standingFloor = 0;
        p.spinning = false;
        if (p.comboBaseFloor > 0) this.cashCombo(p, events, 0);
      }

      // Rising frost freeze check.
      if (this.frostY <= GROUND_Y + 2 && p.y >= this.frostY + 2) {
        this.cashCombo(p, events, p.standingFloor);
        p.alive = false;
        p.vx = 0;
        p.vy = 0;
        p.spinning = false;
        events.push({ t: 'freeze', i: p.idx, x: p.x, y: p.y });
      }
    }

    // 4. Friendly head-bonk bounces between active climbers.
    for (let a = 0; a < this.players.length; a++) {
      const pa = this.players[a];
      if (!pa.alive || pa.gone || pa.finished || pa.grounded || pa.vy <= 0) continue;
      for (let b = 0; b < this.players.length; b++) {
        if (a === b) continue;
        const pb = this.players[b];
        if (!pb.alive || pb.gone || pb.finished) continue;
        if (Math.abs(pa.x - pb.x) < 11 && prevY[a] <= pb.y - 8 && pa.y >= pb.y - 11) {
          pa.y = pb.y - 11;
          pa.vy = Math.min(pa.vy, -195);
          pa.spinning = true;
          pb.bonkTimer = 0.25;
          events.push({ t: 'bonk', top: a, bottom: b, x: pa.x, y: pa.y });
          break;
        }
      }
    }

    // 5. Round completion check.
    const activeRemaining = this.players.some((p) => !p.gone && p.alive && !p.finished);
    const timedOut = this.time >= ROUND_S || (this.rushEndsAt !== null && this.time >= this.rushEndsAt);
    if (!activeRemaining || timedOut) {
      for (const p of this.players) {
        if (!p.gone && p.comboFloors > 0) this.cashCombo(p, events, p.standingFloor);
      }
      this.phase = 'done';
      this.over = true;
      events.push({ t: 'over' });
    }

    return events;
  }

  scoreOf(i: number): number {
    const p = this.players[i];
    if (!p || p.gone) return 0;
    let placePts = 0;
    if (p.finished && p.finishOrder !== null) {
      if (this.solo && p.finishTime !== null) {
        placePts = Math.max(0, Math.round((ROUND_S - p.finishTime) / 3));
      } else {
        placePts = PLACE_BONUS[p.finishOrder - 1] ?? 1;
      }
    }
    return p.bestFloor + placePts + p.comboBonus;
  }

  results(): { points: number[]; winners: number[] } {
    const points = this.players.map((_, i) => this.scoreOf(i));
    if (this.solo) return { points, winners: [] };
    const live = this.players.filter((p) => !p.gone);
    if (!live.length) return { points, winners: [] };
    const best = Math.max(...live.map((p) => points[p.idx]));
    const winners = live.filter((p) => points[p.idx] === best).map((p) => p.idx);
    return { points, winners };
  }
}

export function howTo(short: boolean): string[] {
  return [
    'Run left & right, tap Jump – speed makes you leap higher',
    'Bounce off the tower walls and skip floors for big combos',
    short ? 'One tower: beat the rising frost to the crown!' : 'Three towers: beat the rising frost to the crown!',
  ];
}
