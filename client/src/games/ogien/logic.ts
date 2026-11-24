/**
 * Ogień i Lód: a co-op platformer for up to 10. Fire pierogi (fresh from the pan) walk over lava but
 * drown in icy water; ice pierogi (straight from the freezer) are the other way round; green goo gets
 * everyone. Pressure plates open doors and bridges and power portals, but only while someone stands on
 * them, so people have to hold the way open for each other. A level is done when every pierogi has
 * walked into its own team's door.
 *
 * Everything is in tiles (1 tile = 60 px on the 1920×1080 TV), y grows downward, a hero's (x, y) is the
 * middle of its feet. No rendering here so it can be tested.
 */
import { LEVELS } from "./levels";

export type Team = "fire" | "ice";
export type Link = "a" | "b" | "c" | "d" | "e";

export const COLS = 32;
export const ROWS = 18;
export const TILE = 60;
export const DT = 1 / 60;

export const RUN = 6.2;
export const ACCEL = 60;
export const GRAV = 42;
export const JUMP_V = 17.4; // ≈ 3.6 tiles high: a 3-tile ledge is easy, 4 is impossible
export const MAX_FALL = 20;
export const PW = 0.62;
export const PH = 0.84;
export const COYOTE = 0.1;
export const BUFFER = 0.14;
export const RESPAWN_S = 1.3;
export const PORTAL_CD = 0.7;
export const LEVEL_S = 150;
export const SHORT_LEVELS = 3;

export const CLEAR_PTS = 150;
export const GEM_PTS = 25;
export const HOLD_PTS_PER_S = 4;
export const HOLD_CAP = 80;

export interface LevelDef {
  name: string;
  /** One short line on the TV and the phones. */
  tip: string;
  map: string[];
  /** How many people a plate letter needs (default 1); capped so someone is always left free. */
  need?: Partial<Record<Link, number>>;
  /** Letters whose tiles are bridges: solid only while their plates are held (doors are the reverse). */
  bridges?: Link[];
  /** Portals that only work while a plate is held. */
  portals?: Partial<Record<string, Link>>;
}

export { LEVELS };

export type Cell =
  | "empty"
  | "wall"
  | "lava"
  | "water"
  | "goo"
  | "flameCurtain"
  | "iceCurtain"
  | "plate"
  | "door"
  | "portal"
  | "exitFire"
  | "exitIce"
  | "gemFire"
  | "gemIce";

export function cellOf(ch: string): Cell {
  switch (ch) {
    case "#":
      return "wall";
    case "L":
      return "lava";
    case "W":
      return "water";
    case "G":
      return "goo";
    case "^":
      return "flameCurtain";
    case "v":
      return "iceCurtain";
    case "F":
      return "exitFire";
    case "I":
      return "exitIce";
    case "*":
      return "gemFire";
    case "+":
      return "gemIce";
  }
  if (ch >= "a" && ch <= "e") return "plate";
  if (ch >= "A" && ch <= "E") return "door";
  if (ch >= "1" && ch <= "4") return "portal";
  return "empty";
}

export interface Hero {
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ground: boolean;
  coyote: number;
  buffer: number;
  jumpHeld: boolean;
  face: 1 | -1;
  alive: boolean;
  deadT: number;
  home: boolean;
  homeOrder: number;
  /** In play: not removed and connected. Inactive heroes are hidden and don't count. */
  active: boolean;
  portalCd: number;
  gems: number;
  holdS: number;
  deaths: number;
  /** Seconds since the last death, for the blink after respawning. */
  since: number;
  /** Which spawn slot this hero uses. */
  slot: number;
}

export type OgienEvent =
  | { t: "jump"; i: number }
  | {
      t: "die";
      i: number;
      x: number;
      y: number;
      cause: "lava" | "water" | "goo" | "fall";
    }
  | { t: "respawn"; i: number }
  | { t: "gem"; i: number; x: number; y: number }
  | { t: "home"; i: number }
  | { t: "portal"; i: number; fx: number; fy: number; tx: number; ty: number }
  | { t: "link"; link: Link; on: boolean }
  | { t: "clear" }
  | { t: "timeout" };

export function teamFor(index: number): Team {
  return index % 2 === 0 ? "fire" : "ice";
}

/** Parse helpers shared by the sim, the scene and the checker. */
export class Grid {
  readonly cells: string[][];
  readonly spawns: Record<Team, [number, number][]> = { fire: [], ice: [] };
  readonly portals = new Map<string, [number, number][]>();
  readonly plates: { x: number; y: number; link: Link }[] = [];
  readonly doors: { x: number; y: number; link: Link }[] = [];
  readonly gems: { x: number; y: number; team: Team }[] = [];
  exits: Record<Team, [number, number]> = { fire: [0, 0], ice: [0, 0] };

  constructor(readonly def: LevelDef) {
    this.cells = [];
    for (let y = 0; y < ROWS; y++) {
      const row = (def.map[y] ?? "").padEnd(COLS, "#");
      const line: string[] = [];
      for (let x = 0; x < COLS; x++) {
        let ch = row[x];
        if (ch === "f" || ch === "i") {
          this.spawns[ch === "f" ? "fire" : "ice"].push([x, y]);
          ch = ".";
        } else if (ch === "F") this.exits.fire = [x, y];
        else if (ch === "I") this.exits.ice = [x, y];
        else if (ch === "*" || ch === "+") {
          this.gems.push({ x, y, team: ch === "*" ? "fire" : "ice" });
          ch = ".";
        } else if (ch >= "1" && ch <= "4") {
          const l = this.portals.get(ch) ?? [];
          l.push([x, y]);
          this.portals.set(ch, l);
        } else if (ch >= "a" && ch <= "e")
          this.plates.push({ x, y, link: ch as Link });
        else if (ch >= "A" && ch <= "E")
          this.doors.push({ x, y, link: ch.toLowerCase() as Link });
        line.push(ch);
      }
      this.cells.push(line);
    }
  }

  at(x: number, y: number): string {
    if (x < 0 || x >= COLS || y < 0) return "#";
    if (y >= ROWS) return ".";
    return this.cells[y][x];
  }

  isBridge(link: Link) {
    return !!this.def.bridges?.includes(link);
  }

  /** Solid for this team, with these links held. */
  solid(
    x: number,
    y: number,
    team: Team,
    active: Record<Link, boolean>,
  ): boolean {
    const ch = this.at(x, y);
    switch (cellOf(ch)) {
      case "wall":
      case "lava":
      case "water":
      case "goo":
        return true;
      case "flameCurtain":
        return team === "ice";
      case "iceCurtain":
        return team === "fire";
      case "door": {
        const link = ch.toLowerCase() as Link;
        return this.isBridge(link) ? active[link] : !active[link];
      }
      default:
        return false;
    }
  }

  /** Floor that kills this team when stood on. */
  deadly(x: number, y: number, team: Team): "lava" | "water" | "goo" | null {
    const c = cellOf(this.at(x, y));
    if (c === "goo") return "goo";
    if (c === "lava" && team === "ice") return "lava";
    if (c === "water" && team === "fire") return "water";
    return null;
  }
}

const LINKS: Link[] = ["a", "b", "c", "d", "e"];
const noLinks = (): Record<Link, boolean> => ({
  a: false,
  b: false,
  c: false,
  d: false,
  e: false,
});

export class OgienSim {
  readonly grid: Grid;
  readonly heroes: Hero[];
  active: Record<Link, boolean> = noLinks();
  /** People standing on each letter's plates right now. */
  held: Record<Link, number> = { a: 0, b: 0, c: 0, d: 0, e: 0 };
  gemsLeft: Set<number>;
  time = 0;
  running = false;
  over: "clear" | "timeout" | null = null;
  homeCount = 0;
  private inputs: { x: number; jump: boolean }[];

  constructor(
    readonly def: LevelDef,
    readonly teams: Team[],
    inactive: boolean[] = [],
  ) {
    this.grid = new Grid(def);
    this.gemsLeft = new Set(this.grid.gems.map((_, k) => k));
    const count: Record<Team, number> = { fire: 0, ice: 0 };
    this.heroes = teams.map((team, i) => {
      const h: Hero = {
        team,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        ground: false,
        coyote: 0,
        buffer: 0,
        jumpHeld: false,
        face: 1,
        alive: true,
        deadT: 0,
        home: false,
        homeOrder: 0,
        active: !inactive[i],
        portalCd: 0,
        gems: 0,
        holdS: 0,
        deaths: 0,
        since: 99,
        slot: count[team]++,
      };
      this.place(h);
      return h;
    });
    this.inputs = teams.map(() => ({ x: 0, jump: false }));
  }

  get timeLeft() {
    return Math.max(0, LEVEL_S - this.time);
  }

  /** People needed on a letter's plates, never more than everyone but one still out there. */
  needFor(link: Link): number {
    const want = this.def.need?.[link] ?? 1;
    const out = this.heroes.filter((h) => h.active && !h.home).length;
    return Math.max(1, Math.min(want, out - 1));
  }

  private place(h: Hero) {
    const list = this.grid.spawns[h.team];
    const [sx, sy] = list.length ? list[h.slot % list.length] : [1, 1];
    const lap = Math.floor(h.slot / Math.max(1, list.length));
    // Spread out along the floor next to the spawn, never into a wall or onto a deadly floor.
    const g = this.grid;
    const ok = (x: number) => {
      const l = Math.floor(x - PW / 2);
      const r = Math.floor(x + PW / 2);
      for (let cx = l; cx <= r; cx++) if (g.solid(cx, sy, h.team, this.active) || g.deadly(cx, sy + 1, h.team)) return false;
      return g.solid(Math.floor(x), sy + 1, h.team, this.active);
    };
    const offs = [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, 2.8, -2.8];
    let x = sx + 0.5;
    for (let k = lap, tries = 0; tries < offs.length; k++, tries++) {
      const cand = sx + 0.5 + offs[k % offs.length];
      if (ok(cand)) {
        x = cand;
        break;
      }
    }
    h.x = x;
    h.y = sy + 1 - 0.001;
    h.vx = h.vy = 0;
    h.ground = false;
  }

  setInput(i: number, x: number, jump: boolean) {
    const inp = this.inputs[i];
    if (!inp) return;
    inp.x = Math.max(-1, Math.min(1, x));
    inp.jump = jump;
  }

  pressJump(i: number) {
    const h = this.heroes[i];
    if (h) h.buffer = BUFFER;
  }

  setActive(i: number, on: boolean) {
    const h = this.heroes[i];
    if (!h || h.active === on) return;
    h.active = on;
    if (on && !h.home) {
      this.place(h);
      h.alive = true;
      h.since = 0;
    }
  }

  /** The ↺ button: back to your spawn (if you got yourself stuck). */
  respawn(i: number) {
    const h = this.heroes[i];
    if (!h || !h.active || h.home || !h.alive || !this.running) return;
    this.place(h);
    h.since = 0;
  }

  private cellsOf(h: Hero, inset = 0): [number, number][] {
    const out: [number, number][] = [];
    for (
      let cy = Math.floor(h.y - PH + inset);
      cy <= Math.floor(h.y - 0.0001 - inset);
      cy++
    )
      for (
        let cx = Math.floor(h.x - PW / 2 + inset);
        cx <= Math.floor(h.x + PW / 2 - 0.0001 - inset);
        cx++
      )
        out.push([cx, cy]);
    return out;
  }

  private ghost = new Set<number>();

  private solidFor(h: Hero, cx: number, cy: number) {
    if (this.ghost.has(cy * COLS + cx)) return false;
    return this.grid.solid(cx, cy, h.team, this.active);
  }

  step(): OgienEvent[] {
    const ev: OgienEvent[] = [];
    if (!this.running || this.over) return ev;
    this.time += DT;
    const g = this.grid;

    // Plates first, from where everyone is standing now.
    const held: Record<Link, number> = { a: 0, b: 0, c: 0, d: 0, e: 0 };
    this.heroes.forEach((h) => {
      if (!h.active || h.home || !h.alive || !h.ground) return;
      const seen = new Set<Link>();
      for (const [cx, cy] of this.cellsOf(h, 0.08)) {
        const ch = g.at(cx, cy);
        if (cellOf(ch) === "plate") seen.add(ch as Link);
      }
      seen.forEach((l) => held[l]++);
      if (seen.size) {
        const othersOut = this.heroes.some(
          (o) => o !== h && o.active && !o.home,
        );
        if (othersOut) h.holdS += DT;
      }
    });
    this.held = held;
    for (const l of LINKS) {
      const on = held[l] >= this.needFor(l);
      if (on !== this.active[l]) {
        this.active[l] = on;
        ev.push({ t: "link", link: l, on });
      }
    }

    this.heroes.forEach((h, i) => {
      if (!h.active || h.home) return;
      h.since += DT;
      if (!h.alive) {
        h.deadT -= DT;
        if (h.deadT <= 0) {
          h.alive = true;
          h.since = 0;
          this.place(h);
          ev.push({ t: "respawn", i });
        }
        return;
      }
      const inp = this.inputs[i];
      // Doors and bridges you're already inside don't push you out.
      this.ghost.clear();
      for (const [cx, cy] of this.cellsOf(h))
        if (cellOf(g.at(cx, cy)) === "door") this.ghost.add(cy * COLS + cx);

      const want = inp.x * RUN;
      const dv = ACCEL * DT * (h.ground ? 1 : 0.7);
      h.vx =
        h.vx < want ? Math.min(want, h.vx + dv) : Math.max(want, h.vx - dv);
      if (Math.abs(inp.x) > 0.2) h.face = inp.x > 0 ? 1 : -1;

      h.coyote = h.ground ? COYOTE : Math.max(0, h.coyote - DT);
      h.buffer = Math.max(0, h.buffer - DT);
      if (h.buffer > 0 && h.coyote > 0) {
        h.vy = -JUMP_V;
        h.buffer = 0;
        h.coyote = 0;
        h.ground = false;
        ev.push({ t: "jump", i });
      }
      // Let go of jump early for a short hop.
      if (!inp.jump && h.vy < -6) h.vy += GRAV * DT * 1.2;
      h.vy = Math.min(MAX_FALL, h.vy + GRAV * DT);

      this.moveX(h, h.vx * DT);
      h.ground = false;
      this.moveY(h, h.vy * DT);

      if (h.y - PH > ROWS + 1) {
        this.kill(h, i, "fall", ev);
        return;
      }
      if (h.ground) {
        const fy = Math.floor(h.y + 0.02);
        for (
          let cx = Math.floor(h.x - PW / 2 + 0.14);
          cx <= Math.floor(h.x + PW / 2 - 0.14);
          cx++
        ) {
          const d = g.deadly(cx, fy, h.team);
          if (d) {
            this.kill(h, i, d, ev);
            return;
          }
        }
      }

      // Gems.
      for (const k of this.gemsLeft) {
        const gem = g.gems[k];
        if (
          gem.team === h.team &&
          h.x + PW / 2 > gem.x + 0.2 &&
          h.x - PW / 2 < gem.x + 0.8 &&
          h.y > gem.y + 0.2 &&
          h.y - PH < gem.y + 0.8
        ) {
          this.gemsLeft.delete(k);
          h.gems++;
          ev.push({ t: "gem", i, x: gem.x + 0.5, y: gem.y + 0.5 });
        }
      }

      // Portals.
      h.portalCd = Math.max(0, h.portalCd - DT);
      const cx = Math.floor(h.x);
      const cy = Math.floor(h.y - PH / 2);
      const pch = g.at(cx, cy);
      if (h.portalCd <= 0 && cellOf(pch) === "portal" && this.portalOn(pch)) {
        const pair = g.portals
          .get(pch)!
          .find(([px, py]) => px !== cx || py !== cy);
        if (pair) {
          const fx = h.x;
          const fy = h.y;
          h.x = pair[0] + 0.5;
          h.y = pair[1] + 1 - 0.001;
          h.portalCd = PORTAL_CD;
          ev.push({ t: "portal", i, fx, fy, tx: h.x, ty: h.y });
        }
      }

      // Home.
      const ex = g.exits[h.team];
      if (
        h.ground &&
        Math.abs(h.x - (ex[0] + 0.5)) < 0.45 &&
        Math.floor(h.y - 0.01) === ex[1]
      ) {
        h.home = true;
        h.homeOrder = ++this.homeCount;
        h.vx = h.vy = 0;
        ev.push({ t: "home", i });
      }
    });

    const left = this.heroes.filter((h) => h.active && !h.home);
    const anyone = this.heroes.some((h) => h.active || h.home);
    if (anyone && left.length === 0 && this.heroes.some((h) => h.home)) {
      this.over = "clear";
      ev.push({ t: "clear" });
    } else if (this.time >= LEVEL_S) {
      this.over = "timeout";
      ev.push({ t: "timeout" });
    }
    return ev;
  }

  portalOn(ch: string) {
    const link = this.def.portals?.[ch];
    return !link || this.active[link];
  }

  private kill(
    h: Hero,
    i: number,
    cause: "lava" | "water" | "goo" | "fall",
    ev: OgienEvent[],
  ) {
    h.alive = false;
    h.deadT = RESPAWN_S;
    h.deaths++;
    ev.push({ t: "die", i, x: h.x, y: h.y - PH / 2, cause });
  }

  private moveX(h: Hero, dx: number) {
    if (!dx) return;
    h.x += dx;
    const top = Math.floor(h.y - PH + 0.001);
    const bot = Math.floor(h.y - 0.001);
    if (dx > 0) {
      const cx = Math.floor(h.x + PW / 2);
      for (let cy = top; cy <= bot; cy++)
        if (this.solidFor(h, cx, cy)) {
          h.x = cx - PW / 2 - 0.0001;
          h.vx = 0;
          return;
        }
    } else {
      const cx = Math.floor(h.x - PW / 2);
      for (let cy = top; cy <= bot; cy++)
        if (this.solidFor(h, cx, cy)) {
          h.x = cx + 1 + PW / 2 + 0.0001;
          h.vx = 0;
          return;
        }
    }
  }

  private moveY(h: Hero, dy: number) {
    h.y += dy;
    const l = Math.floor(h.x - PW / 2 + 0.001);
    const r = Math.floor(h.x + PW / 2 - 0.001);
    if (dy >= 0) {
      const cy = Math.floor(h.y);
      for (let cx = l; cx <= r; cx++)
        if (this.solidFor(h, cx, cy)) {
          h.y = cy - 0.0001;
          h.vy = 0;
          h.ground = true;
          return;
        }
    } else {
      const cy = Math.floor(h.y - PH);
      for (let cx = l; cx <= r; cx++)
        if (this.solidFor(h, cx, cy)) {
          h.y = cy + 1 + PH + 0.0001;
          h.vy = 0;
          return;
        }
    }
  }

  /** Points for this level per hero. */
  points(): number[] {
    const cleared = this.over === "clear";
    const timeBonus = cleared
      ? Math.max(0, Math.round((LEVEL_S - this.time) * 1.5))
      : 0;
    return this.heroes.map((h) => {
      if (!h.active && !h.home) return 0;
      const hold = Math.min(HOLD_CAP, Math.round(h.holdS * HOLD_PTS_PER_S));
      return (
        (cleared ? CLEAR_PTS + timeBonus : h.home ? 50 : 0) +
        h.gems * GEM_PTS +
        hold
      );
    });
  }

  /** 0–3 stars for the level: clear it, fast, with most of the gems. */
  stars(): number {
    if (this.over !== "clear") return 0;
    let s = 1;
    if (this.time < LEVEL_S * 0.5) s++;
    if (this.gemsLeft.size <= this.grid.gems.length / 4) s++;
    return s;
  }
}

// ---------------------------------------------------------------------------
// Level checker (used by the tests): can each team get to its door and its gems, and can somebody
// reach every plate, if every plate were being held? A rough grid version of the real jump.
// ---------------------------------------------------------------------------

const ALL_ON: Record<Link, boolean> = {
  a: true,
  b: true,
  c: true,
  d: true,
  e: true,
};

export function reachable(
  def: LevelDef,
  team: Team,
  links: Record<Link, boolean> = ALL_ON,
): Set<number> {
  const g = new Grid(def);
  const pass = (x: number, y: number) =>
    y >= 0 && y < ROWS && !g.solid(x, y, team, links);
  const key = (x: number, y: number) => y * COLS + x;
  const seen = new Set<number>();
  const queue: [number, number][] = [];
  const push = (x: number, y: number) => {
    const k = key(x, y);
    if (seen.has(k)) return;
    seen.add(k);
    queue.push([x, y]);
  };
  const fall = (x: number, y: number) => {
    for (let yy = y; yy < ROWS; yy++) {
      if (!pass(x, yy)) return;
      if (g.solid(x, yy + 1, team, links)) {
        if (!g.deadly(x, yy + 1, team)) push(x, yy);
        return;
      }
    }
  };
  for (const [x, y] of g.spawns[team]) fall(x, y);
  while (queue.length) {
    const [x, y] = queue.shift()!;
    const ch = g.at(x, y);
    if (
      cellOf(ch) === "portal" &&
      (!def.portals?.[ch] || links[def.portals[ch]!])
    ) {
      for (const [px, py] of g.portals.get(ch) ?? [])
        if (px !== x || py !== y) fall(px, py);
    }
    for (const d of [-1, 1]) if (pass(x + d, y)) fall(x + d, y);
    for (let up = 1; up <= 3; up++) {
      if (!pass(x, y - up)) break;
      const reach = up === 3 ? 2 : up === 2 ? 3 : 4;
      for (const d of [-1, 1]) {
        for (let k = 1; k <= reach; k++) {
          if (!pass(x + d * k, y - up)) break;
          fall(x + d * k, y - up);
        }
      }
    }
    // Run-off jumps across gaps at the same height or lower.
    for (const d of [-1, 1]) {
      for (let k = 1; k <= 4; k++) {
        if (!pass(x + d * k, y) || !pass(x + d * k, y - 1)) break;
        fall(x + d * k, y);
      }
    }
  }
  return seen;
}

export interface LevelReport {
  fireHome: boolean;
  iceHome: boolean;
  gemsUnreachable: number;
  platesUnreachable: number;
}

export function checkLevel(def: LevelDef): LevelReport {
  const g = new Grid(def);
  const fire = reachable(def, "fire");
  const ice = reachable(def, "ice");
  const reach = (set: Set<number>, x: number, y: number, jump = 0) => {
    for (let dy = 0; dy <= jump; dy++)
      if (set.has((y + dy) * COLS + x)) return true;
    return false;
  };
  const gemsUnreachable = g.gems.filter(
    (gm) => !reach(gm.team === "fire" ? fire : ice, gm.x, gm.y, 3),
  ).length;
  const platesUnreachable = g.plates.filter(
    (p) => !reach(fire, p.x, p.y) && !reach(ice, p.x, p.y),
  ).length;
  return {
    fireHome: fire.has(g.exits.fire[1] * COLS + g.exits.fire[0]),
    iceHome: ice.has(g.exits.ice[1] * COLS + g.exits.ice[0]),
    gemsUnreachable,
    platesUnreachable,
  };
}

export function howTo(): string[] {
  return [
    "🔥 Fire walks on lava, ❄ ice walks on water. Green goo gets everyone",
    "Plates only work while someone stands on them. Hold the way open for each other",
    "Everyone into their own door · stick + Jump",
  ];
}
