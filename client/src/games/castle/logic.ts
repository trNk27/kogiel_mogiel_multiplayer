/**
 * Malbork Castle – co-op castle defence (pure, no DOM, deterministic for a given seed).
 *
 * The field is a 1920 × 1080 plan of the meadow in front of the castle: monsters come out of the
 * forest at the top and walk down to the wall at the bottom, where every player stands as an
 * archer (the TV shows it in 3D, from behind the battlements). Phones are bows: drag back to draw,
 * aim with the angle, let go to loose. A longer draw flies further and faster; holding a full draw
 * charges a piercing arrow, and the volley skill (after a cooldown) makes the next few shots three
 * arrows each. Monsters that reach the wall hit it, and if the wall falls the castle is lost. Five
 * waves, the last one with Smok the dragon himself.
 */
import { SIEGE_MODES, siegeMode } from '../../../../shared/protocol';
import { mulberry32, type Rng } from '../rng';

export const W = 1920;
export const H = 1080;
/** Where the monsters stop and attack (the foot of the wall). */
export const WALL_Y = 836;
/** Where the archers stand on the battlements. */
export const ARCHER_Y = 918;
export const DT = 1 / 60;

/** Seconds before each wave (a countdown and the wave's name on the TV). */
export const BREAK_S = 6;
/** The first break is a bit longer: everyone is still finding their bow. */
export const FIRST_BREAK_S = 7;
/** Seconds the end card stays up before the results. */
export const END_S = 6;
/** Seconds between arrows (nocking the next one). */
export const COOLDOWN_S = 0.35;
/** Draws below this (0–1) are let go without shooting. */
export const MIN_DRAW = 0.15;
/** How far an arrow flies at the weakest and the fullest draw (px). */
export const RANGE_MIN = 260;
export const RANGE_MAX = 1020;
/** Almost flat along the wall, so monsters at its foot can be shot from anywhere. */
export const MAX_ANGLE = 88;
export const WALL_HP = 100;
/** Volley skill: ready this long after the game starts and after each volley is used up (seconds). */
export const SKILL_COOLDOWN_S = 20;
/** A volley lasts this many shots, and each of them looses this many arrows one after another. */
export const VOLLEY_SHOTS = 5;
export const VOLLEY_ARROWS = 3;
/** Seconds between the arrows of one volley shot. */
export const VOLLEY_GAP_S = 0.09;
/** Arrows stuck in the ground stay this long (seconds). */
const STUCK_S = 1.4;

export type MonsterKind = 'imp' | 'wolf' | 'knight' | 'bat' | 'ghost' | 'giant' | 'dragon' | 'fireball';

export interface MonsterInfo {
  name: string;
  hp: number;
  /** px per second. */
  speed: number;
  /** Body radius in px (at the wall; things further up are hit a little smaller). */
  r: number;
  /** Wall damage per second while attacking (fireballs: per hit). */
  dmg: number;
  pts: number;
  fly?: boolean;
}

/** How much bigger the monsters are than they first were (their bodies and what an arrow has to hit). */
export const MONSTER_SCALE = 1.2;

export const MONSTERS: Record<MonsterKind, MonsterInfo> = {
  imp: { name: 'Bies', hp: 1, speed: 52, r: 30 * MONSTER_SCALE, dmg: 1.2, pts: 10 },
  wolf: { name: 'Wolf', hp: 1, speed: 118, r: 30 * MONSTER_SCALE, dmg: 1, pts: 15 },
  knight: { name: 'Black Knight', hp: 3, speed: 34, r: 36 * MONSTER_SCALE, dmg: 2.2, pts: 35 },
  bat: { name: 'Bat', hp: 1, speed: 78, r: 24 * MONSTER_SCALE, dmg: 0.8, pts: 20, fly: true },
  ghost: { name: 'Zmora', hp: 2, speed: 44, r: 32 * MONSTER_SCALE, dmg: 1.5, pts: 30 },
  giant: { name: 'Giant', hp: 8, speed: 21, r: 58 * MONSTER_SCALE, dmg: 4.5, pts: 100 },
  dragon: { name: 'Smok', hp: 20, speed: 46, r: 96 * MONSTER_SCALE, dmg: 0, pts: 500, fly: true },
  fireball: { name: 'Fireball', hp: 1, speed: 270, r: 26, dmg: 6, pts: 5, fly: true },
};

/** What each wave sends: [kind, how many for one archer on Normal]. */
export interface Wave {
  name: string;
  /** The new monster this wave introduces (shown on the TV during the break). */
  news: string;
  groups: [MonsterKind, number][];
  /** Seconds over which the wave's monsters come out. */
  dur: number;
}

export const WAVES: Wave[] = [
  { name: 'The woods stir', news: 'Biesy! One arrow each', groups: [['imp', 8]], dur: 34 },
  { name: 'Wolves at the gate', news: 'Wolves zig-zag – and they’re fast', groups: [['imp', 6], ['wolf', 6]], dur: 38 },
  { name: 'Iron and wings', news: 'Black Knights take 3 arrows · bats flutter', groups: [['imp', 4], ['wolf', 3], ['knight', 2], ['bat', 4]], dur: 44 },
  { name: 'Giants in the mist', news: 'Zmory fade away – shoot when you see them', groups: [['imp', 3], ['wolf', 3], ['knight', 2], ['bat', 3], ['ghost', 3], ['giant', 1]], dur: 56 },
  { name: 'Smok!', news: 'The dragon! Shoot down his fireballs', groups: [['dragon', 1], ['imp', 3], ['wolf', 2], ['bat', 3], ['knight', 1]], dur: 48 },
];

export interface Monster {
  id: number;
  kind: MonsterKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Seconds alive. */
  age: number;
  /** Where it set off from (weaving monsters swing around it). */
  baseX: number;
  /** Per-monster phase, so a pack doesn't move in step. */
  ph: number;
  speed: number;
  atWall: boolean;
  /** Seconds since the last arrow hit it (for a flash). */
  hurt: number;
  /** Fireballs: where they fly to. */
  tx: number;
  ty: number;
  /** The dragon: seconds until the next fireball / the next bats. */
  next: number;
  summon: number;
}

export interface Arrow {
  id: number;
  owner: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  /** Distance still to fly. */
  left: number;
  /** How many more monsters it can go through (0 = stops at the first). */
  pierce: number;
  dmg: number;
  charged: boolean;
  /** Seconds since it stuck in the ground, or -1 while flying. */
  stuck: number;
  /** Monsters already hit by this arrow. */
  hit: number[];
}

export interface Archer {
  x: number;
  y: number;
  /** Aim in degrees from straight up, draw 0–1, charged draw. */
  aim: number;
  draw: number;
  charged: boolean;
  aiming: boolean;
  readyAt: number;
  /** Volley skill: sim time it's ready again, and triple shots still loaded (0 = not in use). */
  skillAt: number;
  volley: number;
  active: boolean;
  points: number;
  kills: number;
  shots: number;
  hits: number;
}

export type CastlePhase = 'break' | 'play' | 'won' | 'lost';

export type CEvent =
  | { e: 'wave'; wave: number }
  | { e: 'go'; wave: number }
  | { e: 'cleared'; wave: number }
  | { e: 'shoot'; by: number; charged: boolean }
  /** Volley skill switched on (`on`), or used up (its cooldown starts). */
  | { e: 'skill'; by: number; on: boolean }
  | { e: 'hit'; by: number; kind: MonsterKind; x: number; y: number }
  | { e: 'kill'; by: number; kind: MonsterKind; x: number; y: number; pts: number }
  | { e: 'wall'; x: number; dmg: number; kind: MonsterKind }
  | { e: 'fire'; x: number; y: number }
  | { e: 'summon'; x: number; y: number }
  | { e: 'won' }
  | { e: 'lost' };

/** Draw 0–1 → how far the arrow flies. */
export function rangeFor(draw: number) {
  return RANGE_MIN + (RANGE_MAX - RANGE_MIN) * Math.max(0, Math.min(1, draw));
}

/** Draw 0–1 → arrow speed in px/s. */
export function arrowSpeed(draw: number) {
  return 1150 + 750 * Math.max(0, Math.min(1, draw));
}

/** Unit vector for an aim angle in degrees from straight up. */
export function aimVector(deg: number): [number, number] {
  const a = (Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, deg)) * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

/** Things nearer the top of the field are drawn (and hit) a little smaller. */
export function depthScale(y: number) {
  return 0.72 + 0.28 * Math.max(0, Math.min(1, y / WALL_Y));
}

/**
 * More archers, more monsters. A crowd covers the wall better than a lone archer (everyone takes
 * what's in front of them), so each extra archer brings a little more than one share.
 */
export function crowd(players: number) {
  const n = Math.max(1, players);
  return 0.85 * n + 0.025 * n * n;
}

/** How many of a group come for this many archers in this mode (1-based). */
export function groupCount(kind: MonsterKind, base: number, players: number, mode: number) {
  if (kind === 'dragon') return 1;
  return Math.max(1, Math.round(base * crowd(players) * siegeMode(mode).count));
}

/** The dragon's health: tougher for bigger crews. */
export function dragonHp(players: number, mode: number) {
  return Math.round((MONSTERS.dragon.hp + 10 * Math.max(1, players)) * siegeMode(mode).hp);
}

/** Archers spread along the wall. */
export function archerX(i: number, n: number) {
  const left = 300;
  const right = W - 300;
  return n <= 1 ? W / 2 : left + ((right - left) * i) / (n - 1);
}

/** Stars for a finished siege: none if the castle fell, else by how much wall is left. */
export function starsFor(won: boolean, wallFrac: number) {
  if (!won) return 0;
  return wallFrac >= 0.7 ? 3 : wallFrac >= 0.35 ? 2 : 1;
}

/** Ghosts (Zmory) fade in and out; arrows go through them while they're faded. */
export function ghostVisible(m: Monster) {
  if (m.kind !== 'ghost' || m.atWall) return true;
  return (m.age + m.ph * 3.6) % 3.6 < 2.3;
}

interface Spawn {
  at: number;
  kind: MonsterKind;
  x: number;
}

/** The later arrows of a volley shot, waiting their turn. */
interface Burst {
  at: number;
  by: number;
  aim: number;
  draw: number;
  full: boolean;
}

export class CastleSim {
  /** Sim time in seconds. */
  t = 0;
  phase: CastlePhase = 'break';
  /** 1-based: the wave being fought, or coming next during a break. */
  wave = 1;
  /** When the current break ends. */
  breakEnds: number;
  wall = WALL_HP;
  readonly wallMax = WALL_HP;
  readonly mode: number;
  monsters: Monster[] = [];
  arrows: Arrow[] = [];
  readonly archers: Archer[];
  /** Kills and wall damage over the whole siege. */
  kills = 0;
  leaks = 0;
  private queue: Spawn[] = [];
  private bursts: Burst[] = [];
  private rng: Rng;
  private seq = 0;
  private events: CEvent[] = [];

  constructor(
    readonly players: number,
    seed = Date.now(),
    mode = 2,
  ) {
    this.rng = mulberry32(seed);
    this.mode = SIEGE_MODES.indexOf(siegeMode(mode)) + 1;
    this.archers = Array.from({ length: players }, (_, i) => ({
      x: archerX(i, players),
      y: ARCHER_Y,
      aim: 0,
      draw: 0,
      charged: false,
      aiming: false,
      readyAt: 0,
      skillAt: SKILL_COOLDOWN_S,
      volley: 0,
      active: true,
      points: 0,
      kills: 0,
      shots: 0,
      hits: 0,
    }));
    this.breakEnds = FIRST_BREAK_S;
    this.events.push({ e: 'wave', wave: 1 });
  }

  get waves() {
    return WAVES.length;
  }

  get current() {
    return WAVES[this.wave - 1];
  }

  get over() {
    return this.phase === 'won' || this.phase === 'lost';
  }

  get stars() {
    return starsFor(this.phase === 'won', this.wall / this.wallMax);
  }

  /** The dragon, while he's around. */
  get dragon() {
    return this.monsters.find((m) => m.kind === 'dragon') ?? null;
  }

  /** Monsters still to come out in this wave. */
  get pending() {
    return this.queue.length;
  }

  get score() {
    return this.archers.reduce((a, r) => a + r.points, 0);
  }

  drain(): CEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---- input ---------------------------------------------------------------------

  aim(i: number, deg: number, draw: number, charged = false) {
    const a = this.archers[i];
    if (!a?.active) return;
    a.aim = clampAngle(deg);
    a.draw = Math.max(0, Math.min(1, draw));
    a.charged = charged && a.draw >= 0.95;
    a.aiming = true;
  }

  cancel(i: number) {
    const a = this.archers[i];
    if (!a) return;
    a.aiming = false;
    a.draw = 0;
    a.charged = false;
  }

  /**
   * Loose an arrow (three in a row while a volley is on). False if the bow isn't ready, the draw is
   * too weak or the siege is over.
   */
  fire(i: number, deg: number, draw: number, charged = false): boolean {
    const a = this.archers[i];
    this.cancel(i);
    if (!a?.active || this.over || this.t < a.readyAt || !(draw >= MIN_DRAW)) return false;
    a.aim = clampAngle(deg);
    draw = Math.min(1, draw);
    const full = charged && draw >= 0.95;
    this.loose(i, a.aim, draw, full);
    a.readyAt = this.t + COOLDOWN_S;
    if (a.volley > 0) {
      for (let k = 1; k < VOLLEY_ARROWS; k++) this.bursts.push({ at: this.t + k * VOLLEY_GAP_S, by: i, aim: a.aim, draw, full });
      if (--a.volley === 0) {
        a.skillAt = this.t + SKILL_COOLDOWN_S;
        this.events.push({ e: 'skill', by: i, on: false });
      }
    }
    return true;
  }

  /** Switch on the volley skill: the next VOLLEY_SHOTS shots loose VOLLEY_ARROWS arrows each. */
  skill(i: number): boolean {
    const a = this.archers[i];
    if (!a?.active || this.over || a.volley > 0 || this.t < a.skillAt) return false;
    a.volley = VOLLEY_SHOTS;
    this.events.push({ e: 'skill', by: i, on: true });
    return true;
  }

  private loose(i: number, aim: number, draw: number, full: boolean) {
    const a = this.archers[i];
    const [dx, dy] = aimVector(aim);
    this.arrows.push({
      id: ++this.seq,
      owner: i,
      x: a.x + dx * 30,
      y: a.y - 26 + dy * 30,
      dx,
      dy,
      speed: arrowSpeed(draw) * (full ? 1.15 : 1),
      left: rangeFor(draw) * (full ? 1.1 : 1),
      pierce: full ? 3 : 0,
      dmg: full ? 2 : 1,
      charged: full,
      stuck: -1,
      hit: [],
    });
    a.shots++;
    this.events.push({ e: 'shoot', by: i, charged: full });
  }

  /** A player left: their archer stops (the siege goes on). */
  remove(i: number) {
    const a = this.archers[i];
    if (!a) return;
    a.active = false;
    a.volley = 0;
    this.bursts = this.bursts.filter((b) => b.by !== i);
    this.cancel(i);
  }

  // ---- simulation ------------------------------------------------------------------

  step(dt = DT) {
    if (this.over) {
      this.t += dt;
      this.stepArrows(dt);
      return;
    }
    this.t += dt;
    if (this.phase === 'break' && this.t >= this.breakEnds) this.startWave();
    if (this.phase === 'play') {
      while (this.queue.length && this.queue[0].at <= this.t) this.spawn(this.queue.shift()!);
    }
    if (this.bursts.some((b) => b.at <= this.t)) {
      for (const b of this.bursts) if (b.at <= this.t) this.loose(b.by, b.aim, b.draw, b.full);
      this.bursts = this.bursts.filter((b) => b.at > this.t);
    }
    this.stepMonsters(dt);
    this.stepArrows(dt);
    if (this.wall <= 0) {
      this.wall = 0;
      this.phase = 'lost';
      this.events.push({ e: 'lost' });
      return;
    }
    if (this.phase === 'play' && this.queue.length === 0 && this.monsters.length === 0) this.waveCleared();
  }

  private startWave() {
    this.phase = 'play';
    const w = this.current;
    const spawns: Spawn[] = [];
    const start = this.t + 0.5;
    for (const [kind, base] of w.groups) {
      const n = groupCount(kind, base, this.players, this.mode);
      for (let k = 0; k < n; k++) {
        // The dragon comes early; everything else is spread over the wave, with a little jitter.
        const at = kind === 'dragon' ? start + 2 : start + (w.dur * (k + 0.15 + this.rng() * 0.7)) / n;
        const x = kind === 'giant' || kind === 'dragon' ? W / 2 + (this.rng() - 0.5) * 900 : 150 + this.rng() * (W - 300);
        spawns.push({ at, kind, x });
      }
    }
    spawns.sort((a, b) => a.at - b.at);
    this.queue = spawns;
    this.events.push({ e: 'go', wave: this.wave });
  }

  private waveCleared() {
    this.events.push({ e: 'cleared', wave: this.wave });
    if (this.wave >= WAVES.length) {
      this.phase = 'won';
      this.events.push({ e: 'won' });
      return;
    }
    this.wall = Math.min(this.wallMax, this.wall + siegeMode(this.mode).repair);
    this.wave++;
    this.phase = 'break';
    this.breakEnds = this.t + BREAK_S;
    this.events.push({ e: 'wave', wave: this.wave });
  }

  /** Put a monster on the field (tests use this too). */
  spawn(s: { kind: MonsterKind; x: number; y?: number }): Monster {
    const info = MONSTERS[s.kind];
    const mode = siegeMode(this.mode);
    const hp = s.kind === 'dragon' ? dragonHp(this.players, this.mode) : s.kind === 'fireball' ? 1 : Math.max(1, Math.round(info.hp * mode.hp));
    const m: Monster = {
      id: ++this.seq,
      kind: s.kind,
      x: s.x,
      y: s.y ?? (s.kind === 'dragon' ? -140 : -50),
      hp,
      maxHp: hp,
      age: 0,
      baseX: s.x,
      ph: this.rng(),
      speed: info.speed * mode.speed * (0.9 + this.rng() * 0.2),
      atWall: false,
      hurt: 9,
      tx: s.x,
      ty: WALL_Y + 20,
      next: 3.5,
      summon: 8,
    };
    this.monsters.push(m);
    return m;
  }

  private stepMonsters(dt: number) {
    const mode = siegeMode(this.mode);
    const gone: Monster[] = [];
    for (const m of this.monsters) {
      m.age += dt;
      m.hurt += dt;
      const info = MONSTERS[m.kind];
      const stopY = WALL_Y - info.r * 0.55;
      switch (m.kind) {
        case 'fireball': {
          const dx = m.tx - m.x;
          const dy = m.ty - m.y;
          const d = Math.hypot(dx, dy);
          const step = m.speed * dt;
          if (d <= step) {
            this.hitWall(m, info.dmg * mode.dmg);
            gone.push(m);
          } else {
            m.x += (dx / d) * step;
            m.y += (dy / d) * step;
          }
          continue;
        }
        case 'dragon':
          this.stepDragon(m, dt);
          continue;
        case 'wolf':
          if (!m.atWall) m.x = m.baseX + Math.sin(m.age * 2.6 + m.ph * 6) * 70;
          break;
        case 'bat':
          if (!m.atWall) m.x = m.baseX + Math.sin(m.age * 2.2 + m.ph * 6) * 150;
          break;
        case 'imp':
        case 'ghost':
          if (!m.atWall) m.x = m.baseX + Math.sin(m.age * 1.3 + m.ph * 6) * 18;
          break;
      }
      m.x = Math.max(60, Math.min(W - 60, m.x));
      if (!m.atWall) {
        m.y += m.speed * dt;
        if (m.y >= stopY) {
          m.y = stopY;
          m.atWall = true;
        }
      } else {
        const dmg = info.dmg * mode.dmg * dt;
        this.wall -= dmg;
        this.leaks += dmg;
        // A thump on the TV now and then.
        if (Math.floor((m.age - dt) / 0.9) !== Math.floor(m.age / 0.9)) this.events.push({ e: 'wall', x: m.x, dmg: info.dmg * 0.9, kind: m.kind });
      }
    }
    if (gone.length) this.monsters = this.monsters.filter((m) => !gone.includes(m));
  }

  /** Smok flies in, then hovers over the field breathing fireballs at the wall. */
  private stepDragon(m: Monster, dt: number) {
    const hoverY = 300;
    if (m.y < hoverY) {
      m.y = Math.min(hoverY, m.y + m.speed * dt);
      return;
    }
    m.x += (W / 2 + Math.sin(m.age * 0.42 + m.ph * 6) * 640 - m.x) * Math.min(1, dt * 1.5);
    const mode = siegeMode(this.mode);
    m.next -= dt;
    if (m.next <= 0) {
      // Fewer archers to shoot fireballs down: he breathes a little less often.
      m.next = ((m.hp < m.maxHp / 2 ? 3.2 : 4.4) * (1 + 0.6 / Math.max(1, this.players))) / mode.speed;
      const fb = this.spawn({ kind: 'fireball', x: m.x, y: m.y + 60 });
      const target = this.archers.filter((a) => a.active);
      const a = target.length ? target[Math.floor(this.rng() * target.length)] : null;
      fb.tx = (a ? a.x : W / 2) + (this.rng() - 0.5) * 260;
      fb.ty = WALL_Y + 24;
      this.events.push({ e: 'fire', x: m.x, y: m.y });
    }
    if (m.hp < m.maxHp / 2) {
      m.summon -= dt;
      if (m.summon <= 0) {
        m.summon = 9;
        for (const k of [-1, 1]) this.spawn({ kind: 'bat', x: m.x + k * 120, y: m.y });
        this.events.push({ e: 'summon', x: m.x, y: m.y });
      }
    }
  }

  private hitWall(m: Monster, dmg: number) {
    this.wall -= dmg;
    this.leaks += dmg;
    this.events.push({ e: 'wall', x: m.x, dmg, kind: m.kind });
  }

  private stepArrows(dt: number) {
    const keep: Arrow[] = [];
    for (const ar of this.arrows) {
      if (ar.stuck >= 0) {
        ar.stuck += dt;
        if (ar.stuck < STUCK_S) keep.push(ar);
        continue;
      }
      const d = Math.min(ar.left, ar.speed * dt);
      const x1 = ar.x + ar.dx * d;
      const y1 = ar.y + ar.dy * d;
      let stopped = false;
      if (!this.over) {
        // Everything this stretch of flight passes through, nearest first.
        const hits: { m: Monster; along: number }[] = [];
        for (const m of this.monsters) {
          if (m.hp <= 0 || ar.hit.includes(m.id) || !ghostVisible(m) || m.y < -30) continue;
          const r = MONSTERS[m.kind].r * depthScale(m.y) + 6;
          const along = segmentHit(ar.x, ar.y, x1, y1, m.x, m.y, r);
          if (along !== null) hits.push({ m, along });
        }
        hits.sort((a, b) => a.along - b.along);
        for (const { m, along } of hits) {
          this.damage(ar, m);
          if (ar.pierce <= 0) {
            ar.x += (x1 - ar.x) * along;
            ar.y += (y1 - ar.y) * along;
            stopped = true;
            break;
          }
          ar.pierce--;
        }
      }
      if (stopped) continue;
      ar.x = x1;
      ar.y = y1;
      ar.left -= d;
      if (ar.x < -80 || ar.x > W + 80 || ar.y < -120) continue;
      if (ar.left <= 0) ar.stuck = 0;
      keep.push(ar);
    }
    this.arrows = keep;
    if (this.monsters.some((m) => m.hp <= 0)) this.monsters = this.monsters.filter((m) => m.hp > 0);
  }

  private damage(ar: Arrow, m: Monster) {
    ar.hit.push(m.id);
    const a = this.archers[ar.owner];
    if (ar.hit.length === 1) a.hits++;
    m.hp -= ar.dmg;
    m.hurt = 0;
    if (m.hp > 0) {
      this.events.push({ e: 'hit', by: ar.owner, kind: m.kind, x: m.x, y: m.y });
      return;
    }
    const pts = MONSTERS[m.kind].pts;
    a.points += pts;
    a.kills++;
    this.kills++;
    this.events.push({ e: 'kill', by: ar.owner, kind: m.kind, x: m.x, y: m.y, pts });
    // The dragon takes his fireballs with him.
    if (m.kind === 'dragon') for (const o of this.monsters) if (o.kind === 'fireball') o.hp = 0;
  }
}

function clampAngle(deg: number) {
  return Number.isFinite(deg) ? Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, deg)) : 0;
}

/**
 * Where along the segment (x0,y0)→(x1,y1) it first comes within `r` of (cx,cy), as 0–1, or null.
 */
export function segmentHit(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** How to play, for the intro screen. */
export function howTo(): string[] {
  return [
    'Drag back on your phone to draw your bow, aim, let go',
    'A full pull pierces · Volley fires 3 arrows in a row',
    'Five waves – keep the monsters off the wall together',
  ];
}
