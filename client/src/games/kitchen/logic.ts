/**
 * Pierogi Panic – a co-op kitchen simulation (pure, no DOM, deterministic for a given seed).
 *
 * The world is a grid of 1×1 tiles. Cooks are circles that walk on floor tiles; every other tile
 * is a solid station (counter, crate, stove…). The station a cook faces is their target, and the
 * single action button does whatever makes sense for that station and what the cook is holding.
 * Some actions start a minigame on the cook's phone; the cook is frozen until it is done.
 */
import { DIFFICULTIES, FILLINGS, KITCHEN_LEVELS, type Filling, type KitchenItem, type KitchenMini, type KitchenMiniKind } from '../../../../shared/protocol';
import { mulberry32, type Rng } from '../rng';

export const TICK_HZ = 60;
export const DT_MS = 1000 / TICK_HZ;

export const KTUNING = {
  /** Walking speed in tiles per second. */
  speed: 4.2,
  /** How fast cooks reach that speed (tiles/s²). */
  accel: 32,
  radius: 0.3,
  /** How far beyond its body a cook can reach a station. */
  reach: 0.38,
  prepMs: 9_000,
  /** Default round length (each level sets its own). */
  roundMs: 180_000,
  orderTtlMs: 80_000,
  dirtyReturnMs: 7_000,
  overcookMs: 25_000,
  expirePenalty: 20,
  basePoints: 60,
  tipPoints: 40,
  /** Extra points for fried pierogi. */
  friedBonus: 30,
};
export type KitchenTuning = typeof KTUNING;

export interface KitchenLevel {
  name: string;
  /** Fillings that can be ordered (each needs a crate in the layout). */
  fillings: Filling[];
  /** Share of orders that are fried (needs pans in the layout). */
  fried: number;
  roundMs: number;
  /**
   * One character per tile:
   *  .  floor        #  counter       X  wall          F  flour sack     1-4  filling crates (FILLINGS order)
   *  R  rolling board  P  pierogi (folding) board  S  stove with pot   G  frying pan
   *  W  sink         K  plate rack    H  serving hatch  D  dirty dish return   T  bin
   */
  layout: string[];
}

export const LEVELS: KitchenLevel[] = [
  {
    name: KITCHEN_LEVELS[0].name,
    fillings: ['potato'],
    fried: 0,
    roundMs: 150_000,
    layout: [
      'X###R##R##S#S##X',
      'XF............HX',
      'X1............HX',
      'X#....####....#X',
      'X#....#PP#....DX',
      'X#............#X',
      'XT............#X',
      'X#####K#WW#####X',
      'XXXXXXXXXXXXXXXX',
    ],
  },
  {
    name: KITCHEN_LEVELS[1].name,
    fillings: ['potato', 'cabbage', 'meat'],
    fried: 0,
    roundMs: 165_000,
    layout: [
      '##R#R###S#S#S###',
      'F......#.......H',
      '1......#.......H',
      '2..P...#.......#',
      '#..P.......#...D',
      '3..P...#...#...#',
      '#......#.......#',
      '#......#.......#',
      '##T#####KWW#T###',
    ],
  },
  {
    name: KITCHEN_LEVELS[2].name,
    fillings: ['potato', 'cabbage', 'meat', 'berry'],
    fried: 0.4,
    roundMs: 180_000,
    layout: [
      '##R#R##S#S#G#G##',
      'F..............H',
      '1..............H',
      '2..#P#....#P#..#',
      '#..###....###..#',
      '3..#P#....#P#..D',
      '4..............#',
      '#..............#',
      '##T###K#WW#K##T#',
    ],
  },
];

export const GRID_W = 16;
export const GRID_H = 9;

export type StationKind = 'counter' | 'flour' | 'crate' | 'roll' | 'fold' | 'stove' | 'pan' | 'sink' | 'rack' | 'hatch' | 'return' | 'trash';

export interface Pot {
  f: Filling;
  /** In a pan, "mushy" means burnt. */
  state: 'raw' | 'cooked' | 'mushy';
  /** Sim time when it reached this state. */
  since: number;
}

export interface Station {
  id: number;
  kind: StationKind;
  /** Tile coordinates (top-left corner). */
  x: number;
  y: number;
  /** What sits on it (counters, boards). On a folding board this is the finished raw pierogi. */
  item: KitchenItem | null;
  /** Crates: which filling they hold. */
  crate?: Filling;
  /** Folding board ingredients. */
  dough: boolean;
  fill: Filling | null;
  /** Contents of a stove's pot or a frying pan. */
  pot: Pot | null;
  /** Plates in a sink / rack / dish return. */
  count: number;
  /** Id of the cook doing a minigame here. */
  busy: string | null;
  /** Minigame progress 0..1 (reported by the phone, for the TV). */
  progress: number;
}

export interface Cook {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Unit facing vector. */
  fx: number;
  fy: number;
  /** Joystick, magnitude ≤ 1. */
  sx: number;
  sy: number;
  hold: KitchenItem | null;
  mini: (KitchenMini & { station: number }) | null;
  /** Station currently faced (and in reach), or null. */
  target: number | null;
  /** Stats for the results screen. */
  jobs: number;
  served: number;
  /** Distance walked this tick (for the waddle animation). */
  moving: boolean;
}

export interface Order {
  id: number;
  f: Filling;
  fried: boolean;
  born: number;
  ttl: number;
}

export type KEvent =
  | { e: 'phase'; phase: KitchenPhase }
  | { e: 'order'; f: Filling; fried: boolean }
  | { e: 'served'; by: string; f: Filling; fried: boolean; points: number; x: number; y: number }
  | { e: 'expired'; f: Filling }
  | { e: 'reject'; by: string; x: number; y: number }
  | { e: 'pick'; by: string }
  | { e: 'drop'; by: string }
  | { e: 'trash'; by: string; x: number; y: number }
  | { e: 'mini'; by: string; kind: KitchenMiniKind }
  | { e: 'made'; by: string; kind: KitchenMiniKind; x: number; y: number }
  | { e: 'mushy'; x: number; y: number; pan: boolean }
  | { e: 'dishes' };

export type KitchenPhase = 'prep' | 'play' | 'over';

interface Action {
  label: string;
  run: () => void;
}

export function itemName(it: KitchenItem): string {
  switch (it.k) {
    case 'flour':
      return 'flour';
    case 'dough':
      return 'dough';
    case 'fill':
      return fillName(it.f).toLowerCase();
    case 'raw':
      return 'raw pierogi';
    case 'plate':
      return it.f ? (it.fried ? 'fried pierogi' : 'pierogi') : 'plate';
    case 'dirty':
      return it.n === 1 ? 'dirty plate' : 'dirty plates';
  }
}

export function fillName(f: Filling) {
  return FILLINGS.find((x) => x.id === f)!.name;
}

export function dishName(f: Filling, fried: boolean) {
  return fried ? `Fried ${fillName(f).toLowerCase()}` : fillName(f);
}

function difficulty(d: number) {
  return DIFFICULTIES[Math.max(1, Math.min(5, Math.round(d) || 3)) - 1];
}

/** Seconds between new orders for a given team size and difficulty (1–5). */
export function orderInterval(players: number, diff = 3): number {
  return Math.max(12, 34 - 3.5 * (Math.max(1, players) - 1)) * difficulty(diff).pace;
}

export function maxOrders(players: number): number {
  return Math.min(5, 2 + Math.ceil(Math.max(1, players) / 2));
}

export function startingPlates(players: number): number {
  return Math.min(6, Math.max(3, 2 + Math.ceil(players / 2)));
}

/** How many orders a team can expect to see in one round. */
export function expectedOrders(players: number, roundMs = KTUNING.roundMs, diff = 3): number {
  const first = players >= 3 ? 2 : 1;
  // No new orders in the last 15 seconds.
  return first + Math.floor((roundMs - 15_000) / 1000 / orderInterval(players, diff));
}

/** Team score needed for 1, 2 and 3 stars. */
export function starThresholds(players: number, roundMs = KTUNING.roundMs, diff = 3, friedShare = 0): [number, number, number] {
  const e = expectedOrders(players, roundMs, diff) * (80 + friedShare * KTUNING.friedBonus);
  const r = (k: number) => Math.round((e * k) / 10) * 10;
  return [r(0.3), r(0.55), r(0.8)];
}

export function starsFor(score: number, thresholds: readonly number[]): number {
  return thresholds.filter((x) => score >= x).length;
}

export function pointsFor(leftMs: number, ttl: number, t: KitchenTuning = KTUNING, fried = false): number {
  return t.basePoints + (fried ? t.friedBonus : 0) + Math.round(t.tipPoints * Math.max(0, Math.min(1, leftMs / ttl)));
}

/** Floor tiles spread around the kitchen, used as spawn points (farthest-point sampling). */
export function spawnPoints(layout: string[], n = 8): [number, number][] {
  const floor: [number, number][] = [];
  layout.forEach((row, y) => [...row].forEach((ch, x) => ch === '.' && floor.push([x, y])));
  // Start with the floor tile closest to the middle of the bottom half.
  const mid: [number, number] = [GRID_W / 2, GRID_H * 0.65];
  floor.sort((a, b) => Math.hypot(a[0] - mid[0], a[1] - mid[1]) - Math.hypot(b[0] - mid[0], b[1] - mid[1]));
  const out: [number, number][] = [floor[0]];
  while (out.length < Math.min(n, floor.length)) {
    let best = floor[0];
    let bestD = -1;
    for (const f of floor) {
      // Prefer tiles at least 2 away from everyone, but not hugging the far corners.
      const d = Math.min(...out.map((o) => Math.hypot(o[0] - f[0], o[1] - f[1])));
      const score = Math.min(d, 3) - Math.hypot(f[0] - mid[0], f[1] - mid[1]) * 0.05;
      if (score > bestD) {
        bestD = score;
        best = f;
      }
    }
    out.push(best);
  }
  return out.map(([x, y]) => [x + 0.5, y + 0.5]);
}

const KIND_OF: Record<string, StationKind> = {
  '#': 'counter',
  F: 'flour',
  '1': 'crate',
  '2': 'crate',
  '3': 'crate',
  '4': 'crate',
  R: 'roll',
  P: 'fold',
  S: 'stove',
  G: 'pan',
  W: 'sink',
  K: 'rack',
  H: 'hatch',
  D: 'return',
  T: 'trash',
};

export interface KitchenOptions {
  /** 0-based index into LEVELS. */
  level?: number;
  /** 1 (relaxed) … 5 (chaos). */
  difficulty?: number;
  tuning?: Partial<KitchenTuning>;
}

export class KitchenSim {
  readonly stations: Station[] = [];
  /** Station id per tile, -1 for floor, -2 for wall. */
  readonly grid: Int16Array;
  readonly cooks: Cook[] = [];
  orders: Order[] = [];
  phase: KitchenPhase = 'prep';
  /** Sim time in ms. */
  t = 0;
  score = 0;
  served = 0;
  expired = 0;
  readonly players: number;
  readonly level: KitchenLevel;
  readonly levelIndex: number;
  readonly difficulty: number;
  readonly tuning: KitchenTuning;
  readonly thresholds: [number, number, number];
  private events: KEvent[] = [];
  private rng: Rng;
  private nextOrderAt = 0;
  private orderSeq = 0;
  private miniSeq = 0;
  private dirtyQueue: number[] = [];
  private lastFillings: Filling[] = [];

  constructor(ids: string[], seed = Date.now(), opts: KitchenOptions = {}) {
    this.rng = mulberry32(seed);
    this.players = ids.length;
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, opts.level ?? 0));
    this.level = LEVELS[this.levelIndex];
    this.difficulty = Math.max(1, Math.min(5, Math.round(opts.difficulty ?? 3)));
    this.tuning = { ...KTUNING, roundMs: this.level.roundMs, ...opts.tuning };
    this.tuning.orderTtlMs = Math.round(this.tuning.orderTtlMs * difficulty(this.difficulty).ttl);
    this.thresholds = starThresholds(ids.length, this.tuning.roundMs, this.difficulty, this.level.fried);
    this.grid = new Int16Array(GRID_W * GRID_H).fill(-1);
    this.level.layout.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === 'X') {
          this.grid[y * GRID_W + x] = -2;
          return;
        }
        const kind = KIND_OF[ch];
        if (!kind) return;
        const st: Station = { id: this.stations.length, kind, x, y, item: null, dough: false, fill: null, pot: null, count: 0, busy: null, progress: 0 };
        if (kind === 'crate') st.crate = FILLINGS[Number(ch) - 1].id;
        this.grid[y * GRID_W + x] = st.id;
        this.stations.push(st);
      }),
    );
    // Share the starting plates between the racks.
    const racks = this.stations.filter((s) => s.kind === 'rack');
    for (let i = 0; i < startingPlates(ids.length); i++) racks[i % racks.length].count++;
    const spawns = spawnPoints(this.level.layout);
    ids.forEach((id, i) => {
      const [x, y] = spawns[i % spawns.length];
      this.cooks.push({ id, x, y, vx: 0, vy: 0, fx: 0, fy: 1, sx: 0, sy: 0, hold: null, mini: null, target: null, jobs: 0, served: 0, moving: false });
    });
  }

  /** Tile is a wall (not a station, not floor). */
  isWall(x: number, y: number) {
    return this.grid[y * GRID_W + x] === -2;
  }

  // ---- queries ------------------------------------------------------------------

  cook(id: string) {
    return this.cooks.find((c) => c.id === id);
  }

  stationAt(x: number, y: number): Station | null {
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null;
    const i = this.grid[y * GRID_W + x];
    return i >= 0 ? this.stations[i] : null;
  }

  private solid(x: number, y: number) {
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return true;
    return this.grid[y * GRID_W + x] !== -1;
  }

  get playStart() {
    return this.tuning.prepMs;
  }
  get playEnd() {
    return this.tuning.prepMs + this.tuning.roundMs;
  }
  /** Ms of service left (counts down during play). */
  get timeLeft() {
    return Math.max(0, Math.min(this.tuning.roundMs, this.playEnd - this.t));
  }
  get stars() {
    return starsFor(this.score, this.thresholds);
  }

  drain(): KEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** What the action button would do for this cook right now. */
  hint(id: string): string | null {
    const c = this.cook(id);
    if (!c) return null;
    this.updateTarget(c);
    return this.actionFor(c)?.label ?? null;
  }

  // ---- input --------------------------------------------------------------------

  setStick(id: string, x: number, y: number) {
    const c = this.cook(id);
    if (!c) return;
    let sx = Number.isFinite(x) ? x : 0;
    let sy = Number.isFinite(y) ? y : 0;
    const m = Math.hypot(sx, sy);
    if (m > 1) {
      sx /= m;
      sy /= m;
    }
    c.sx = sx;
    c.sy = sy;
  }

  act(id: string): boolean {
    const c = this.cook(id);
    if (!c) return false;
    this.updateTarget(c);
    const a = this.actionFor(c);
    if (!a) return false;
    a.run();
    return true;
  }

  miniProgress(id: string, miniId: number, p: number) {
    const c = this.cook(id);
    if (!c?.mini || c.mini.id !== miniId) return;
    this.stations[c.mini.station].progress = Math.max(0, Math.min(1, Number(p) || 0));
  }

  miniDone(id: string, miniId: number): boolean {
    const c = this.cook(id);
    if (!c?.mini || c.mini.id !== miniId) return false;
    const s = this.stations[c.mini.station];
    const kind = c.mini.kind;
    switch (kind) {
      case 'roll':
        s.item = { k: 'dough' };
        break;
      case 'fold':
        s.item = { k: 'raw', f: s.fill! };
        s.dough = false;
        s.fill = null;
        break;
      case 'boil':
      case 'fry':
        s.pot = { f: s.pot!.f, state: 'cooked', since: this.t };
        break;
      case 'wash': {
        s.count = Math.max(0, s.count - 1);
        const rack = this.nearest(s, 'rack');
        if (rack) rack.count++;
        break;
      }
    }
    c.jobs++;
    this.endMini(c);
    this.events.push({ e: 'made', by: c.id, kind, x: s.x + 0.5, y: s.y + 0.5 });
    return true;
  }

  miniCancel(id: string, miniId?: number) {
    const c = this.cook(id);
    if (!c?.mini || (miniId !== undefined && c.mini.id !== miniId)) return;
    this.endMini(c);
  }

  /** A phone went away: stop walking and leave any minigame. */
  pause(id: string) {
    const c = this.cook(id);
    if (!c) return;
    c.sx = c.sy = 0;
    this.miniCancel(id);
  }

  remove(id: string) {
    const i = this.cooks.findIndex((c) => c.id === id);
    if (i < 0) return;
    this.miniCancel(id);
    this.cooks.splice(i, 1);
  }

  private endMini(c: Cook) {
    if (!c.mini) return;
    const s = this.stations[c.mini.station];
    s.busy = null;
    s.progress = 0;
    c.mini = null;
  }

  private nearest(from: Station, kind: StationKind) {
    let best: Station | null = null;
    let bestD = Infinity;
    for (const s of this.stations) {
      if (s.kind !== kind) continue;
      const d = Math.abs(s.x - from.x) + Math.abs(s.y - from.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // ---- the rules ----------------------------------------------------------------

  private actionFor(c: Cook): Action | null {
    if (this.phase !== 'play' || c.mini || c.target === null) return null;
    const s = this.stations[c.target];
    if (s.busy) return null;
    const h = c.hold;
    const take = (label: string, item: KitchenItem, after?: () => void): Action => ({
      label,
      run: () => {
        c.hold = item;
        after?.();
        this.events.push({ e: 'pick', by: c.id });
      },
    });
    const put = (label: string, apply: () => void): Action => ({
      label,
      run: () => {
        apply();
        c.hold = null;
        this.events.push({ e: 'drop', by: c.id });
      },
    });
    const mini = (label: string, kind: KitchenMiniKind, f?: Filling): Action => ({
      label,
      run: () => {
        c.mini = { id: ++this.miniSeq, kind, f, station: s.id };
        s.busy = c.id;
        s.progress = 0;
        c.vx = c.vy = 0;
        this.events.push({ e: 'mini', by: c.id, kind });
      },
    });

    switch (s.kind) {
      case 'counter':
        if (!s.item && h) return put('Put down', () => (s.item = h));
        if (s.item && !h) {
          const it = s.item;
          return take(`Pick up ${itemName(it)}`, it, () => (s.item = null));
        }
        if (s.item?.k === 'dirty' && h?.k === 'dirty') {
          const n = s.item.n;
          return put('Stack plates', () => (s.item = { k: 'dirty', n: n + h.n }));
        }
        return null;
      case 'flour':
        if (!h) return take('Take flour', { k: 'flour' });
        if (h.k === 'flour') return put('Put back', () => {});
        return null;
      case 'crate': {
        const f = s.crate!;
        if (!h) return take(`Take ${fillName(f).toLowerCase()}`, { k: 'fill', f });
        if (h.k === 'fill' && h.f === f) return put('Put back', () => {});
        return null;
      }
      case 'roll':
        if (!s.item && h?.k === 'flour') return put('Put flour here', () => (s.item = h));
        if (s.item?.k === 'flour' && !h) return mini('Roll dough', 'roll');
        if (s.item?.k === 'dough' && !h) return take('Pick up dough', { k: 'dough' }, () => (s.item = null));
        return null;
      case 'fold':
        if (s.item) {
          const it = s.item;
          return h ? null : take(`Pick up ${itemName(it)}`, it, () => (s.item = null));
        }
        if (h?.k === 'dough' && !s.dough) return put('Add dough', () => (s.dough = true));
        if (h?.k === 'fill' && !s.fill) {
          const f = h.f;
          return put('Add filling', () => (s.fill = f));
        }
        if (!h && s.dough && s.fill) return mini('Make pierogi', 'fold', s.fill);
        if (!h && s.fill) {
          const f = s.fill;
          return take(`Pick up ${fillName(f).toLowerCase()}`, { k: 'fill', f }, () => (s.fill = null));
        }
        if (!h && s.dough) return take('Pick up dough', { k: 'dough' }, () => (s.dough = false));
        return null;
      case 'stove': {
        const pot = s.pot;
        if (!pot) {
          if (h?.k === 'raw') {
            const f = h.f;
            return put('Into the pot', () => (s.pot = { f, state: 'raw', since: this.t }));
          }
          return null;
        }
        if (pot.state === 'raw' && !h) return mini('Boil pierogi', 'boil', pot.f);
        if (pot.state === 'cooked' && h?.k === 'plate' && !h.f) {
          const f = pot.f;
          return {
            label: 'Plate up',
            run: () => {
              c.hold = { k: 'plate', f };
              s.pot = null;
              this.events.push({ e: 'pick', by: c.id });
            },
          };
        }
        if (pot.state === 'mushy' && !h)
          return {
            label: 'Scrape the pot',
            run: () => {
              s.pot = null;
              this.events.push({ e: 'trash', by: c.id, x: s.x + 0.5, y: s.y + 0.5 });
            },
          };
        return null;
      }
      case 'pan': {
        const pan = s.pot;
        if (!pan) {
          if (h?.k === 'raw') {
            const f = h.f;
            return put('Into the pan', () => (s.pot = { f, state: 'raw', since: this.t }));
          }
          return null;
        }
        if (pan.state === 'raw' && !h) return mini('Fry pierogi', 'fry', pan.f);
        if (pan.state === 'cooked' && h?.k === 'plate' && !h.f) {
          const f = pan.f;
          return {
            label: 'Plate up',
            run: () => {
              c.hold = { k: 'plate', f, fried: true };
              s.pot = null;
              this.events.push({ e: 'pick', by: c.id });
            },
          };
        }
        if (pan.state === 'mushy' && !h)
          return {
            label: 'Scrape the pan',
            run: () => {
              s.pot = null;
              this.events.push({ e: 'trash', by: c.id, x: s.x + 0.5, y: s.y + 0.5 });
            },
          };
        return null;
      }
      case 'sink':
        if (h?.k === 'dirty') {
          const n = h.n;
          return put('Into the sink', () => (s.count += n));
        }
        if (!h && s.count > 0) return mini('Wash a plate', 'wash');
        return null;
      case 'rack':
        if (!h && s.count > 0) return take('Take a plate', { k: 'plate' }, () => s.count--);
        if (h?.k === 'plate' && !h.f) return put('Put plate back', () => s.count++);
        return null;
      case 'hatch':
        if (h?.k === 'plate' && h.f) {
          const f = h.f;
          const fried = !!h.fried;
          const ok = this.orders.some((o) => o.f === f && o.fried === fried);
          return {
            label: ok ? 'Serve!' : 'Not ordered',
            run: () => (ok ? this.serve(c, s, f, fried) : this.events.push({ e: 'reject', by: c.id, x: s.x + 0.5, y: s.y + 0.5 })),
          };
        }
        return null;
      case 'return':
        if (!h && s.count > 0) {
          const n = s.count;
          return take(n === 1 ? 'Take dirty plate' : 'Take dirty plates', { k: 'dirty', n }, () => (s.count = 0));
        }
        if (h?.k === 'dirty') {
          const n = h.n;
          return put('Put back', () => (s.count += n));
        }
        return null;
      case 'trash':
        if (!h) return null;
        if (h.k === 'plate') {
          if (!h.f) return null;
          return {
            label: 'Bin pierogi',
            run: () => {
              c.hold = { k: 'plate' };
              this.events.push({ e: 'trash', by: c.id, x: s.x + 0.5, y: s.y + 0.5 });
            },
          };
        }
        if (h.k === 'dirty') return null;
        return {
          label: `Bin ${itemName(h)}`,
          run: () => {
            c.hold = null;
            this.events.push({ e: 'trash', by: c.id, x: s.x + 0.5, y: s.y + 0.5 });
          },
        };
    }
  }

  private serve(c: Cook, s: Station, f: Filling, fried: boolean) {
    // The matching order closest to running out.
    let best: Order | null = null;
    for (const o of this.orders) if (o.f === f && o.fried === fried && (!best || o.born + o.ttl < best.born + best.ttl)) best = o;
    if (!best) return;
    const points = pointsFor(best.born + best.ttl - this.t, best.ttl, this.tuning, fried);
    this.orders = this.orders.filter((o) => o !== best);
    this.score += points;
    this.served++;
    c.served++;
    c.hold = null;
    this.dirtyQueue.push(this.t + this.tuning.dirtyReturnMs);
    this.events.push({ e: 'served', by: c.id, f, fried, points, x: s.x + 0.5, y: s.y + 0.5 });
    // Don't leave the team idle when the board is empty.
    if (this.orders.length === 0) this.nextOrderAt = Math.min(this.nextOrderAt, this.t + 2500);
  }

  // ---- simulation ---------------------------------------------------------------

  step() {
    this.t += DT_MS;
    if (this.phase === 'prep' && this.t >= this.playStart) {
      this.phase = 'play';
      this.events.push({ e: 'phase', phase: 'play' });
      this.spawnOrder();
      if (this.players >= 3) this.nextOrderAt = this.t + 6000;
      else this.nextOrderAt = this.t + orderInterval(this.players, this.difficulty) * 1000;
    }
    if (this.phase === 'play') {
      this.tickKitchen();
      if (this.t >= this.playEnd) {
        this.phase = 'over';
        this.orders = [];
        for (const c of this.cooks) this.endMini(c);
        this.events.push({ e: 'phase', phase: 'over' });
      }
    }
    this.moveCooks();
  }

  private tickKitchen() {
    const t = this.t;
    for (const o of [...this.orders]) {
      if (t >= o.born + o.ttl) {
        this.orders = this.orders.filter((x) => x !== o);
        this.score = Math.max(0, this.score - this.tuning.expirePenalty);
        this.expired++;
        this.events.push({ e: 'expired', f: o.f });
      }
    }
    if (t >= this.nextOrderAt && t < this.playEnd - 15_000) {
      if (this.orders.length < maxOrders(this.players)) {
        this.spawnOrder();
        this.nextOrderAt = t + orderInterval(this.players, this.difficulty) * 1000;
      }
    }
    for (const s of this.stations) {
      if (s.pot?.state === 'cooked' && t - s.pot.since >= this.tuning.overcookMs) {
        s.pot = { ...s.pot, state: 'mushy', since: t };
        this.events.push({ e: 'mushy', x: s.x + 0.5, y: s.y + 0.5, pan: s.kind === 'pan' });
      }
    }
    if (this.dirtyQueue.length && this.dirtyQueue[0] <= t) {
      const ret = this.stations.find((s) => s.kind === 'return');
      while (this.dirtyQueue.length && this.dirtyQueue[0] <= t) {
        this.dirtyQueue.shift();
        if (ret) ret.count++;
      }
      this.events.push({ e: 'dishes' });
    }
  }

  private spawnOrder() {
    const menu = this.level.fillings;
    let f: Filling;
    let fried = false;
    if (this.orderSeq === 0) f = menu[0];
    else {
      // Random, but never three of the same in a row.
      const [a, b] = this.lastFillings.slice(-2);
      const options = menu.length > 1 ? menu.filter((x) => !(a === b && x === a)) : menu;
      f = options[Math.floor(this.rng() * options.length)];
      fried = this.rng() < this.level.fried;
    }
    this.lastFillings.push(f);
    this.orders.push({ id: ++this.orderSeq, f, fried, born: this.t, ttl: this.tuning.orderTtlMs });
    this.events.push({ e: 'order', f, fried });
  }

  private moveCooks() {
    const { speed, accel, radius } = this.tuning;
    const dt = DT_MS / 1000;
    for (const c of this.cooks) {
      const frozen = !!c.mini || this.phase === 'over';
      const tx = frozen ? 0 : c.sx * speed;
      const ty = frozen ? 0 : c.sy * speed;
      let dx = tx - c.vx;
      let dy = ty - c.vy;
      const d = Math.hypot(dx, dy);
      const maxDv = accel * dt;
      if (d > maxDv) {
        dx = (dx / d) * maxDv;
        dy = (dy / d) * maxDv;
      }
      c.vx += dx;
      c.vy += dy;
      const ox = c.x;
      const oy = c.y;
      c.x += c.vx * dt;
      this.collideTiles(c, radius);
      c.y += c.vy * dt;
      this.collideTiles(c, radius);
      if (!frozen && Math.hypot(c.sx, c.sy) > 0.25) {
        const m = Math.hypot(c.sx, c.sy);
        c.fx = c.sx / m;
        c.fy = c.sy / m;
      }
      c.moving = Math.hypot(c.x - ox, c.y - oy) > 0.004;
    }
    // Cooks push each other apart.
    for (let i = 0; i < this.cooks.length; i++) {
      for (let j = i + 1; j < this.cooks.length; j++) {
        const a = this.cooks[i];
        const b = this.cooks[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = radius * 2;
        if (d >= min) continue;
        if (d < 1e-6) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        // A cook busy at a station stays put; the other one takes the whole push.
        const wa = a.mini ? 0 : b.mini ? 2 : 1;
        const wb = b.mini ? 0 : a.mini ? 2 : 1;
        a.x -= ux * push * wa;
        a.y -= uy * push * wa;
        b.x += ux * push * wb;
        b.y += uy * push * wb;
        this.collideTiles(a, radius);
        this.collideTiles(b, radius);
      }
    }
    for (const c of this.cooks) this.updateTarget(c);
  }

  private collideTiles(c: Cook, r: number) {
    const x0 = Math.floor(c.x - r);
    const x1 = Math.floor(c.x + r);
    const y0 = Math.floor(c.y - r);
    const y1 = Math.floor(c.y + r);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.solid(tx, ty)) continue;
        const qx = Math.max(tx, Math.min(c.x, tx + 1));
        const qy = Math.max(ty, Math.min(c.y, ty + 1));
        let dx = c.x - qx;
        let dy = c.y - qy;
        const d = Math.hypot(dx, dy);
        if (d >= r) continue;
        if (d < 1e-9) {
          // Centre inside the tile: push out along the shallowest axis.
          const pen = [c.x - tx, tx + 1 - c.x, c.y - ty, ty + 1 - c.y];
          const k = pen.indexOf(Math.min(...pen));
          if (k === 0) c.x = tx - r;
          else if (k === 1) c.x = tx + 1 + r;
          else if (k === 2) c.y = ty - r;
          else c.y = ty + 1 + r;
          continue;
        }
        dx /= d;
        dy /= d;
        c.x += dx * (r - d);
        c.y += dy * (r - d);
        // Kill velocity into the wall so cooks slide along counters.
        const vn = c.vx * dx + c.vy * dy;
        if (vn < 0) {
          c.vx -= vn * dx;
          c.vy -= vn * dy;
        }
      }
    }
  }

  private updateTarget(c: Cook) {
    if (c.mini) {
      c.target = c.mini.station;
      return;
    }
    const { radius, reach } = this.tuning;
    // First choice: the tile right in front of the cook.
    const front = this.stationAt(Math.floor(c.x + c.fx * (radius + reach * 0.8)), Math.floor(c.y + c.fy * (radius + reach * 0.8)));
    if (front) {
      c.target = front.id;
      return;
    }
    // Otherwise the best station roughly in the facing direction (corners, diagonals).
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    let best: number | null = null;
    let bestScore = -Infinity;
    for (let ty = cy - 1; ty <= cy + 1; ty++) {
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        const s = this.stationAt(tx, ty);
        if (!s) continue;
        const qx = Math.max(tx, Math.min(c.x, tx + 1));
        const qy = Math.max(ty, Math.min(c.y, ty + 1));
        const d = Math.hypot(c.x - qx, c.y - qy);
        if (d > radius + reach) continue;
        let dx = tx + 0.5 - c.x;
        let dy = ty + 0.5 - c.y;
        const m = Math.hypot(dx, dy) || 1;
        dx /= m;
        dy /= m;
        const dot = dx * c.fx + dy * c.fy;
        if (dot < 0.3) continue;
        const score = dot - d;
        if (score > bestScore) {
          bestScore = score;
          best = s.id;
        }
      }
    }
    c.target = best;
  }

  /** The current view-relevant state for one cook. */
  viewState(id: string) {
    const c = this.cook(id);
    if (!c) return null;
    const mini: KitchenMini | null = c.mini ? { id: c.mini.id, kind: c.mini.kind, ...(c.mini.f ? { f: c.mini.f } : {}) } : null;
    return { hold: c.hold, hint: this.actionFor(c)?.label ?? null, mini };
  }
}
