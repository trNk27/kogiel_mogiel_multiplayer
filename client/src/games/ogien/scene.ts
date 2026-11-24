/**
 * Ogień i Lód TV picture: one 1920×1080 canvas, the whole level on screen (32×18 tiles of 60 px).
 * A warm stone temple: lava and icy water pools sunk into the floor, flame and icicle curtains, plates,
 * doors that slide into the ceiling, plank bridges, swirling portals, and everyone's pierogi with a
 * flame or frost crown in their own colour.
 */
import { PIEROGI_PATH } from "../../lib/art";
import {
  COLS,
  PH,
  ROWS,
  TILE,
  cellOf,
  type Link,
  type OgienEvent,
  type OgienSim,
  type Team,
} from "./logic";

export interface OgienLook {
  name: string;
  color: string;
}

export const LINK_COLOR: Record<Link, string> = {
  a: "#ffd23f",
  b: "#ff5c8a",
  c: "#3ee0b5",
  d: "#b78cff",
  e: "#9be15d",
};
const FIRE = "#ff7a2f";
const ICE = "#6fd3ff";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  grav: number;
}

const pierogi = typeof Path2D !== "undefined" ? new Path2D(PIEROGI_PATH) : null;

export class OgienScene {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement | null = null;
  private bgFor: OgienSim | null = null;
  private parts: Particle[] = [];
  private t = 0;
  /** Doors slide: 0 shut, 1 fully open. */
  private slide: Record<Link, number> = { a: 0, b: 0, c: 0, d: 0, e: 0 };
  private shake = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private looks: OgienLook[],
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  dispose() {
    this.parts = [];
  }

  onEvent(e: OgienEvent, sim: OgienSim) {
    switch (e.t) {
      case "die": {
        const team = sim.heroes[e.i]?.team ?? "fire";
        const col = this.looks[e.i]?.color ?? "#fff";
        for (let k = 0; k < 26; k++)
          this.puff(
            e.x,
            e.y,
            k % 3 === 0 ? col : team === "fire" ? "#ffb347" : "#dff6ff",
            5 + Math.random() * 7,
            5,
            -3,
          );
        this.shake = 0.25;
        break;
      }
      case "gem":
        for (let k = 0; k < 14; k++)
          this.puff(
            e.x,
            e.y,
            k % 2 ? "#fff" : sim.heroes[e.i]?.team === "fire" ? FIRE : ICE,
            3 + Math.random() * 4,
            4,
            -1,
          );
        break;
      case "home":
      case "respawn": {
        const h = sim.heroes[e.i];
        if (h)
          for (let k = 0; k < 16; k++)
            this.puff(
              h.x,
              h.y - PH / 2,
              h.team === "fire" ? "#ffd27a" : "#c9f1ff",
              3 + Math.random() * 5,
              3,
              -2,
            );
        break;
      }
      case "portal":
        for (let k = 0; k < 14; k++) {
          this.puff(e.fx, e.fy - 0.4, "#e9d5ff", 3 + Math.random() * 4, 3, 0);
          this.puff(e.tx, e.ty - 0.4, "#e9d5ff", 3 + Math.random() * 4, 3, 0);
        }
        break;
    }
  }

  private puff(
    x: number,
    y: number,
    color: string,
    size: number,
    speed: number,
    up: number,
  ) {
    const a = Math.random() * Math.PI * 2;
    const v = Math.random() * speed;
    this.parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v + up,
      life: 0,
      max: 0.5 + Math.random() * 0.5,
      color,
      size,
      grav: 8,
    });
  }

  render(sim: OgienSim, dt: number) {
    this.t += dt;
    const ctx = this.ctx;
    if (this.bgFor !== sim) {
      this.bg = this.paintBackground(sim);
      this.bgFor = sim;
      this.slide = { a: 0, b: 0, c: 0, d: 0, e: 0 };
    }
    for (const l of Object.keys(this.slide) as Link[]) {
      const target = sim.active[l] ? 1 : 0;
      this.slide[l] +=
        Math.sign(target - this.slide[l]) *
        Math.min(Math.abs(target - this.slide[l]), dt * 5);
    }
    ctx.save();
    if (this.shake > 0) {
      this.shake -= dt;
      ctx.translate(
        (Math.random() - 0.5) * 10 * this.shake,
        (Math.random() - 0.5) * 10 * this.shake,
      );
    }
    ctx.drawImage(this.bg!, 0, 0);
    this.drawLiquids(sim);
    this.drawCurtains(sim);
    this.drawExits(sim);
    this.drawDoors(sim);
    this.drawPlates(sim);
    this.drawPortals(sim);
    this.drawGems(sim);
    this.drawHeroes(sim);
    this.drawParticles(dt);
    ctx.restore();
  }

  // ---- static background ---------------------------------------------------------

  private paintBackground(sim: OgienSim) {
    const c = document.createElement("canvas");
    c.width = COLS * TILE;
    c.height = ROWS * TILE;
    const ctx = c.getContext("2d")!;
    const g = sim.grid;
    // Air: warm on the left, cold on the right.
    const sky = ctx.createLinearGradient(0, 0, c.width, c.height);
    sky.addColorStop(0, "#3a1d1a");
    sky.addColorStop(0.5, "#241a2c");
    sky.addColorStop(1, "#152536");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, c.width, c.height);
    // Faint back wall bricks.
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 2;
    for (let y = 0; y < ROWS * 2; y++) {
      const off = y % 2 ? TILE / 2 : 0;
      for (let x = -1; x < COLS + 1; x++)
        ctx.strokeRect(x * TILE + off, y * (TILE / 2), TILE, TILE / 2);
    }
    // Glow spots behind the doors.
    for (const team of ["fire", "ice"] as Team[]) {
      const [ex, ey] = g.exits[team];
      const glow = ctx.createRadialGradient(
        (ex + 0.5) * TILE,
        (ey + 0.2) * TILE,
        10,
        (ex + 0.5) * TILE,
        (ey + 0.2) * TILE,
        160,
      );
      glow.addColorStop(
        0,
        team === "fire" ? "rgba(255,120,40,.35)" : "rgba(110,210,255,.35)",
      );
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    // Stone blocks (and the stone under every pool).
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const cell = cellOf(g.at(x, y));
        if (
          cell !== "wall" &&
          cell !== "lava" &&
          cell !== "water" &&
          cell !== "goo"
        )
          continue;
        const px = x * TILE;
        const py = y * TILE;
        const shade = ((x * 7 + y * 13) % 5) * 4;
        ctx.fillStyle = `rgb(${92 + shade},${78 + shade},${70 + shade})`;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(px, py + TILE / 2 - 2, TILE, 3);
        ctx.fillRect(px + (y % 2 ? 18 : 40), py, 3, TILE / 2);
        ctx.fillRect(px + (y % 2 ? 44 : 14), py + TILE / 2, 3, TILE / 2);
        const open = (dx: number, dy: number) => {
          const n = cellOf(g.at(x + dx, y + dy));
          return n !== "wall" && n !== "lava" && n !== "water" && n !== "goo";
        };
        if (open(0, -1)) {
          ctx.fillStyle = "rgba(255,236,200,0.45)";
          ctx.fillRect(px, py, TILE, 5);
          ctx.fillStyle = "#5a8f3c";
          if ((x + y) % 3 === 0) ctx.fillRect(px + 10, py - 4, 6, 6);
        }
        if (open(0, 1)) {
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(px, py + TILE - 6, TILE, 6);
        }
        if (open(-1, 0)) {
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.fillRect(px, py, 4, TILE);
        }
        if (open(1, 0)) {
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(px + TILE - 4, py, 4, TILE);
        }
      }
    // Outer frame.
    ctx.strokeStyle = "#1a0f0c";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, c.width - 6, c.height - 6);
    return c;
  }

  // ---- moving parts ---------------------------------------------------------------

  private drawLiquids(sim: OgienSim) {
    const ctx = this.ctx;
    const g = sim.grid;
    const t = this.t;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const cell = cellOf(g.at(x, y));
        if (cell !== "lava" && cell !== "water" && cell !== "goo") continue;
        const px = x * TILE;
        const py = y * TILE;
        const [deep, mid, top] =
          cell === "lava"
            ? ["#a3240f", "#ff5a1f", "#ffd166"]
            : cell === "water"
              ? ["#0f4c8a", "#2f8fe0", "#c8f2ff"]
              : ["#2d5c12", "#62c022", "#d4ff7a"];
        const grad = ctx.createLinearGradient(0, py, 0, py + TILE * 0.7);
        grad.addColorStop(0, mid);
        grad.addColorStop(1, deep);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(px, py + TILE * 0.7);
        for (let k = 0; k <= 6; k++) {
          const wx = px + (k / 6) * TILE;
          ctx.lineTo(wx, py + 6 + Math.sin(t * 3 + (x * 6 + k) * 0.9) * 3);
        }
        ctx.lineTo(px + TILE, py + TILE * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = top;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const wx = px + (k / 6) * TILE;
          const wy = py + 6 + Math.sin(t * 3 + (x * 6 + k) * 0.9) * 3;
          if (k === 0) ctx.moveTo(wx, wy);
          else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
        // Bubbles / sparkles.
        const ph = (t * (cell === "water" ? 0.6 : 0.9) + x * 0.37) % 1;
        ctx.globalAlpha = 1 - ph;
        ctx.fillStyle = top;
        ctx.beginPath();
        ctx.arc(
          px + 15 + ((x * 23) % 30),
          py + 30 - ph * 30,
          cell === "water" ? 2.5 : 4,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.globalAlpha = 1;
        if (cell === "lava") {
          const glow = ctx.createRadialGradient(
            px + TILE / 2,
            py,
            4,
            px + TILE / 2,
            py,
            TILE,
          );
          glow.addColorStop(0, "rgba(255,140,40,.35)");
          glow.addColorStop(1, "rgba(255,140,40,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(px - TILE / 2, py - TILE, TILE * 2, TILE * 1.4);
        }
      }
  }

  private drawCurtains(sim: OgienSim) {
    const ctx = this.ctx;
    const g = sim.grid;
    const t = this.t;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const cell = cellOf(g.at(x, y));
        if (cell !== "flameCurtain" && cell !== "iceCurtain") continue;
        const px = x * TILE;
        const py = y * TILE;
        if (cell === "flameCurtain") {
          for (let k = 0; k < 4; k++) {
            const fx = px + 8 + k * 14;
            const h = 34 + Math.sin(t * 9 + k * 2 + y) * 10;
            const grad = ctx.createLinearGradient(
              0,
              py + TILE,
              0,
              py + TILE - h,
            );
            grad.addColorStop(0, "rgba(255,90,20,.85)");
            grad.addColorStop(0.6, "rgba(255,190,60,.7)");
            grad.addColorStop(1, "rgba(255,240,160,0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(fx - 9, py + TILE);
            ctx.quadraticCurveTo(
              fx - 6,
              py + TILE - h * 0.6,
              fx + Math.sin(t * 7 + k) * 4,
              py + TILE - h,
            );
            ctx.quadraticCurveTo(
              fx + 6,
              py + TILE - h * 0.6,
              fx + 9,
              py + TILE,
            );
            ctx.fill();
          }
          ctx.fillStyle = "rgba(255,120,40,.18)";
          ctx.fillRect(px, py, TILE, TILE);
        } else {
          ctx.fillStyle = "rgba(170,230,255,.22)";
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = "rgba(225,248,255,.85)";
          for (let k = 0; k < 5; k++) {
            const ix = px + 6 + k * 12;
            const len = 22 + ((k * 7 + y * 3) % 4) * 7;
            ctx.beginPath();
            ctx.moveTo(ix - 5, py);
            ctx.lineTo(ix + 5, py);
            ctx.lineTo(ix, py + len);
            ctx.fill();
          }
          ctx.strokeStyle = "rgba(255,255,255,.5)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          const sx = px + 30 + Math.sin(t * 2 + y) * 14;
          ctx.moveTo(sx, py + 36);
          ctx.lineTo(sx + 4, py + 44);
          ctx.stroke();
        }
      }
  }

  private drawExits(sim: OgienSim) {
    const ctx = this.ctx;
    for (const team of ["fire", "ice"] as Team[]) {
      const [ex, ey] = sim.grid.exits[team];
      const px = ex * TILE;
      const py = ey * TILE;
      const col = team === "fire" ? FIRE : ICE;
      const w = TILE * 0.92;
      const h = TILE * 1.6;
      const x0 = px + (TILE - w) / 2;
      const y0 = py + TILE - h;
      ctx.fillStyle = "#2a1712";
      ctx.beginPath();
      ctx.moveTo(x0, py + TILE);
      ctx.lineTo(x0, y0 + w / 2);
      ctx.arc(x0 + w / 2, y0 + w / 2, w / 2, Math.PI, 0);
      ctx.lineTo(x0 + w, py + TILE);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = col;
      ctx.stroke();
      const inner = ctx.createLinearGradient(0, y0, 0, py + TILE);
      inner.addColorStop(
        0,
        team === "fire" ? "rgba(255,170,60,.65)" : "rgba(160,230,255,.65)",
      );
      inner.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = inner;
      ctx.fill();
      ctx.font = "700 30px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        team === "fire" ? "🔥" : "❄️",
        px + TILE / 2,
        y0 + w / 2 + 4,
      );
      // How many are home.
      const total = sim.heroes.filter(
        (hh) => hh.team === team && (hh.active || hh.home),
      ).length;
      const home = sim.heroes.filter(
        (hh) => hh.team === team && hh.home,
      ).length;
      if (total) {
        ctx.font = "800 22px system-ui, sans-serif";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#1a0f0c";
        const label = `${home}/${total}`;
        ctx.strokeText(label, px + TILE / 2, y0 - 16);
        ctx.fillStyle = home === total ? "#9be15d" : "#fff4dc";
        ctx.fillText(label, px + TILE / 2, y0 - 16);
      }
    }
  }

  private drawDoors(sim: OgienSim) {
    const ctx = this.ctx;
    const g = sim.grid;
    for (const d of g.doors) {
      const px = d.x * TILE;
      const py = d.y * TILE;
      const col = LINK_COLOR[d.link];
      const s = this.slide[d.link];
      if (g.isBridge(d.link)) {
        if (s < 0.05) {
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.45;
          ctx.setLineDash([8, 8]);
          ctx.lineWidth = 3;
          ctx.strokeRect(px + 3, py + 6, TILE - 6, TILE / 2 - 6);
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = s;
          ctx.fillStyle = "#8a5a34";
          ctx.fillRect(px, py + 4, TILE, TILE / 2);
          ctx.fillStyle = "#b07842";
          ctx.fillRect(px + 2, py + 6, TILE / 2 - 3, TILE / 2 - 6);
          ctx.fillRect(px + TILE / 2 + 1, py + 6, TILE / 2 - 3, TILE / 2 - 6);
          ctx.fillStyle = col;
          ctx.fillRect(px, py + 4, TILE, 5);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      // Bars that slide up into the ceiling.
      const h = TILE * (1 - s);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(px + 4, py, TILE - 8, TILE);
      if (h > 1) {
        ctx.fillStyle = "#4b4f63";
        ctx.fillRect(px + 6, py, TILE - 12, h);
        ctx.fillStyle = col;
        for (let k = 0; k < 3; k++) ctx.fillRect(px + 12 + k * 14, py, 6, h);
        ctx.fillStyle = "rgba(255,255,255,.25)";
        ctx.fillRect(px + 6, py + h - 6, TILE - 12, 6);
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.strokeRect(px + 4, py, TILE - 8, TILE);
    }
  }

  private drawPlates(sim: OgienSim) {
    const ctx = this.ctx;
    const g = sim.grid;
    for (const p of g.plates) {
      const px = p.x * TILE;
      const py = p.y * TILE;
      const col = LINK_COLOR[p.link];
      const on = sim.active[p.link];
      const down = on ? 5 : 0;
      // A plate sitting on lava or water only works for that team: tint its base.
      const below = cellOf(g.at(p.x, p.y + 1));
      ctx.fillStyle =
        below === "lava"
          ? "#7a2b10"
          : below === "water"
            ? "#123d66"
            : "#3a3030";
      ctx.fillRect(px + 6, py + TILE - 10, TILE - 12, 10);
      ctx.fillStyle = col;
      ctx.fillRect(px + 9, py + TILE - 18 + down, TILE - 18, 9 - down / 2);
      ctx.fillStyle = "rgba(255,255,255,.45)";
      ctx.fillRect(px + 11, py + TILE - 18 + down, TILE - 22, 3);
      if (on) {
        const glow = ctx.createRadialGradient(
          px + TILE / 2,
          py + TILE - 12,
          2,
          px + TILE / 2,
          py + TILE - 12,
          50,
        );
        glow.addColorStop(0, col + "aa");
        glow.addColorStop(1, col + "00");
        ctx.fillStyle = glow;
        ctx.fillRect(px - 20, py + 10, TILE + 40, TILE);
      }
      const need = sim.needFor(p.link);
      const runStart = g.at(p.x - 1, p.y) !== p.link;
      if (need > 1 && runStart) {
        let x1 = p.x;
        while (g.at(x1 + 1, p.y) === p.link) x1++;
        const cx = ((p.x + x1 + 1) / 2) * TILE;
        ctx.font = "800 28px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 6;
        ctx.strokeStyle = "#1a0f0c";
        const label = `${Math.min(sim.held[p.link], need)}/${need} 🧍`;
        ctx.strokeText(label, cx, py + TILE - 38);
        ctx.fillStyle = on ? "#9be15d" : col;
        ctx.fillText(label, cx, py + TILE - 38);
      }
    }
  }

  private drawPortals(sim: OgienSim) {
    const ctx = this.ctx;
    for (const [ch, list] of sim.grid.portals) {
      const on = sim.portalOn(ch);
      const link = sim.def.portals?.[ch];
      const col = link ? LINK_COLOR[link] : "#c084fc";
      for (const [x, y] of list) {
        const cx = (x + 0.5) * TILE;
        const cy = (y + 0.45) * TILE;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = on ? 1 : 0.35;
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 32);
        grad.addColorStop(0, on ? "#ffffff" : "#666");
        grad.addColorStop(0.5, on ? "#a855f7" : "#3a3346");
        grad.addColorStop(1, "rgba(60,20,90,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, 24, 30, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 4;
        ctx.stroke();
        if (on) {
          ctx.rotate(this.t * 3);
          ctx.strokeStyle = "rgba(255,255,255,.7)";
          ctx.lineWidth = 2;
          for (let k = 0; k < 3; k++) {
            ctx.rotate((Math.PI * 2) / 3);
            ctx.beginPath();
            ctx.arc(8, 0, 12, 0, Math.PI * 0.8);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
  }

  private drawGems(sim: OgienSim) {
    const ctx = this.ctx;
    for (const k of sim.gemsLeft) {
      const gem = sim.grid.gems[k];
      const cx = (gem.x + 0.5) * TILE;
      const cy = (gem.y + 0.5) * TILE + Math.sin(this.t * 3 + k) * 4;
      const [a, b] =
        gem.team === "fire" ? ["#ff3b1f", "#ffc06b"] : ["#1f8fff", "#c8f2ff"];
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 30);
      glow.addColorStop(
        0,
        gem.team === "fire" ? "rgba(255,120,40,.45)" : "rgba(110,210,255,.45)",
      );
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - 30, cy - 30, 60, 60);
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 16);
      ctx.lineTo(cx + 13, cy - 4);
      ctx.lineTo(cx, cy + 16);
      ctx.lineTo(cx - 13, cy - 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = b;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 16);
      ctx.lineTo(cx + 13, cy - 4);
      ctx.lineTo(cx, cy - 1);
      ctx.lineTo(cx - 13, cy - 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(30,10,10,.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  private drawHeroes(sim: OgienSim) {
    const ctx = this.ctx;
    sim.heroes.forEach((h, i) => {
      if (!h.active || h.home || !h.alive) return;
      if (h.since < 1 && Math.floor(h.since * 12) % 2) return; // blink after respawn
      const look = this.looks[i] ?? { name: "?", color: "#fff4dc" };
      const cx = h.x * TILE;
      const feet = h.y * TILE;
      const w = 70;
      const scale = w / 120;
      const squash = h.ground
        ? 1 + Math.abs(h.vx) * 0.006 * Math.sin(this.t * 22)
        : 1 - Math.min(0.12, Math.abs(h.vy) * 0.006);
      // Team glow.
      const glow = ctx.createRadialGradient(
        cx,
        feet - 22,
        4,
        cx,
        feet - 22,
        46,
      );
      glow.addColorStop(
        0,
        h.team === "fire" ? "rgba(255,130,40,.45)" : "rgba(110,210,255,.45)",
      );
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - 50, feet - 72, 100, 90);
      ctx.save();
      ctx.translate(cx, feet);
      ctx.scale(h.face * scale * (2 - squash), scale * squash);
      ctx.translate(-60, -92);
      if (pierogi) {
        ctx.fillStyle = look.color;
        ctx.fill(pierogi);
        ctx.lineWidth = 6;
        ctx.strokeStyle = h.team === "fire" ? "#7a2208" : "#0d4a78";
        ctx.stroke(pierogi);
      }
      // Crimped edge.
      ctx.strokeStyle = "rgba(40,16,8,.25)";
      ctx.lineWidth = 4;
      ctx.setLineDash([3, 9]);
      ctx.beginPath();
      ctx.arc(60, 66, 42, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.setLineDash([]);
      // Eyes looking where they run.
      ctx.fillStyle = "#2a120a";
      ctx.beginPath();
      ctx.ellipse(48, 52, 6, 8, 0, 0, Math.PI * 2);
      ctx.ellipse(78, 52, 6, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(51, 49, 2.5, 0, Math.PI * 2);
      ctx.arc(81, 49, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2a120a";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(64, 64, 9, 0.2, Math.PI - 0.2);
      ctx.stroke();
      // Crown: flames or frost.
      if (h.team === "fire") {
        for (let k = 0; k < 3; k++) {
          const fx = 38 + k * 22;
          const fh = 26 + Math.sin(this.t * 14 + k * 2 + i) * 7;
          ctx.fillStyle = k === 1 ? "#ffd166" : "#ff6a1f";
          ctx.beginPath();
          ctx.moveTo(fx - 10, 20);
          ctx.quadraticCurveTo(fx - 6, 20 - fh * 0.6, fx, 20 - fh);
          ctx.quadraticCurveTo(fx + 6, 20 - fh * 0.6, fx + 10, 20);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = "#e6f8ff";
        ctx.strokeStyle = "#4bb3e6";
        ctx.lineWidth = 3;
        for (let k = 0; k < 3; k++) {
          const fx = 38 + k * 22;
          const fh = k === 1 ? 30 : 22;
          ctx.beginPath();
          ctx.moveTo(fx - 8, 20);
          ctx.lineTo(fx, 20 - fh);
          ctx.lineTo(fx + 8, 20);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
      // Name tag.
      ctx.font = "800 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#1a0f0c";
      const ny = feet - 78;
      ctx.strokeText(look.name, cx, ny);
      ctx.fillStyle = look.color;
      ctx.fillText(look.name, cx, ny);
    });
  }

  private drawParticles(dt: number) {
    const ctx = this.ctx;
    this.parts = this.parts.filter((p) => (p.life += dt) < p.max);
    for (const p of this.parts) {
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * TILE, p.y * TILE, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
