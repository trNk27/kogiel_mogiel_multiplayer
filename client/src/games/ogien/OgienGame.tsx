import { useEffect, useRef, useState } from "preact/hooks";
import {
  colorHex,
  type PadButton,
  type PhoneMsg,
  type PhoneView,
} from "../../../../shared/protocol";
import type { CoopLevel, Game, GameHost } from "../types";
import { ArenaInput } from "../arena/input";
import { Pierogi } from "../../lib/art";
import { sound } from "../../lib/sound";
import {
  DT,
  LEVELS,
  SHORT_LEVELS,
  OgienSim,
  teamFor,
  type OgienEvent,
  type Team,
} from "./logic";
import { OgienScene } from "./scene";
import "../cookbook/cookbook.css";
import "./ogien.css";

const INTRO_MS = 5000;
const DONE_MS = 5500;
const HUD_MS = 150;

type Phase = "intro" | "play" | "done";

export class OgienGame implements Game {
  readonly id = "ogien" as const;
  readonly levels: number;
  level = 0;
  phase: Phase = "intro";
  sim!: OgienSim;
  readonly input: ArenaInput;
  readonly teams: Team[];
  scores: number[];
  levelPts: number[];
  goAt = 0;
  doneAt = 0;
  history: CoopLevel[] = [];
  readonly removed = new Set<number>();
  private scene: OgienScene | null = null;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.levels = host.short ? SHORT_LEVELS : LEVELS.length;
    this.input = new ArenaInput(ids);
    this.teams = ids.map((_, i) => teamFor(i));
    this.scores = ids.map(() => 0);
    this.levelPts = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has("debug"))
      (window as unknown as Record<string, OgienGame>).ogien = this;
    this.nextLevel();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.detach();
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  attach(canvas: HTMLCanvasElement) {
    this.scene = new OgienScene(
      canvas,
      this.ids.map((id) => {
        const p = this.host.player(id);
        return {
          name: p?.name ?? "?",
          color: colorHex(p?.color ?? "sourcream"),
        };
      }),
    );
  }

  detach() {
    this.scene?.dispose();
    this.scene = null;
  }

  private gone(i: number) {
    return this.removed.has(i) || !this.host.player(this.ids[i])?.connected;
  }

  /** Jump straight to a level (for testing on the dev bench with ?debug). */
  goto(n: number) {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, n - 1));
    this.nextLevel();
  }

  private nextLevel() {
    this.level++;
    this.input.release();
    // The short version plays the first, a middle and the last of a few shorter levels.
    const def = this.host.short
      ? LEVELS[[1, 3, 7][this.level - 1] ?? 1]
      : LEVELS[this.level - 1];
    this.sim = new OgienSim(
      def,
      this.teams,
      this.ids.map((_, i) => this.gone(i)),
    );
    this.levelPts = this.ids.map(() => 0);
    this.phase = "intro";
    this.goAt = Date.now() + INTRO_MS;
    [INTRO_MS - 3000, INTRO_MS - 2000, INTRO_MS - 1000].forEach((ms) =>
      this.later(ms, () => this.phase === "intro" && sound.count()),
    );
    this.later(INTRO_MS, () => {
      if (this.phase !== "intro") return;
      this.phase = "play";
      this.sim.running = true;
      sound.go();
      this.update();
    });
    this.update();
  }

  private endLevel() {
    if (this.phase === "done") return;
    const sim = this.sim;
    this.phase = "done";
    this.doneAt = performance.now();
    this.levelPts = sim.points();
    this.levelPts.forEach((p, i) => (this.scores[i] += p));
    this.history.push({
      name: sim.def.name,
      stars: sim.stars(),
      score: this.levelPts.reduce((a, b) => a + b, 0),
      served: sim.grid.gems.length - sim.gemsLeft.size,
      missed: sim.heroes.reduce((a, h) => a + h.deaths, 0),
    });
    if (sim.over === "clear") {
      sound.fanfare();
      this.ids.forEach((id) => this.host.buzz(id, [60, 40, 120]));
    } else sound.whistle();
    this.later(DONE_MS, () =>
      this.level < this.levels ? this.nextLevel() : this.finish(),
    );
    this.update();
  }

  private finish() {
    const scores: Record<string, number> = {};
    this.ids.forEach(
      (id, i) => !this.removed.has(i) && (scores[id] = this.scores[i]),
    );
    const h = this.history;
    const cleared = h.filter((l) => l.stars > 0).length;
    const gems = h.reduce((a, l) => a + l.served, 0);
    const falls = h.reduce((a, l) => a + l.missed, 0);
    const stars = Math.round(
      h.reduce((a, l) => a + l.stars, 0) / Math.max(1, h.length),
    );
    this.host.finish(scores, {
      score: h.reduce((a, l) => a + l.score, 0),
      stars,
      served: gems,
      missed: falls,
      levels: h,
      look: {
        line:
          cleared === h.length
            ? "Every level cleared. Fire and ice, best friends!"
            : `${cleared} of ${h.length} levels cleared`,
        stats: [
          { v: cleared, label: `of ${h.length} levels cleared` },
          { v: gems, label: "gems collected" },
          { v: falls, label: "pierogi lost to lava, water and goo" },
        ],
        unit: ["point", "points"],
        scoreUnit: "points",
      },
    });
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += elapsed;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.tick();
    }
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private tick() {
    const sim = this.sim;
    this.ids.forEach((_, i) => {
      const live = this.phase === "play" && !this.gone(i);
      const pad = this.input.pads[i];
      const jumps = this.input.takePresses(i, 0);
      const resets = this.input.takePresses(i, 1);
      sim.setInput(i, live ? pad.x : 0, live && pad.held[0]);
      if (live && jumps > 0) sim.pressJump(i);
      if (live && resets > 0) sim.respawn(i);
    });
    const events = sim.step();
    if (events.length) this.handle(events);
  }

  private handle(events: OgienEvent[]) {
    let refresh = false;
    for (const e of events) {
      this.scene?.onEvent(e, this.sim);
      switch (e.t) {
        case "jump":
          sound.note(this.teams[e.i] === "fire" ? 420 : 560, 0.09, {
            type: "square",
            vol: 0.035,
            slide: 760,
          });
          break;
        case "die":
          if (e.cause === "lava") sound.hiss(0.35, 0.14);
          else if (e.cause === "water")
            sound.note(300, 0.3, { type: "sine", vol: 0.08, slide: 90 });
          else sound.plop();
          this.host.buzz(this.ids[e.i], [160]);
          refresh = true;
          break;
        case "respawn":
          refresh = true;
          break;
        case "gem":
          sound.pickup();
          this.host.buzz(this.ids[e.i], [30]);
          refresh = true;
          break;
        case "home":
          sound.serve();
          this.host.buzz(this.ids[e.i], [50, 30, 80]);
          refresh = true;
          break;
        case "portal":
          sound.note(380, 0.2, { type: "triangle", vol: 0.06, slide: 1200 });
          break;
        case "link":
          sound.note(e.on ? 520 : 300, 0.08, {
            type: "square",
            vol: 0.04,
            slide: e.on ? 680 : 220,
          });
          refresh = true;
          break;
        case "clear":
        case "timeout":
          this.endLevel();
          refresh = false;
          break;
      }
    }
    if (refresh) this.host.refresh();
  }

  onMessage(id: string, m: PhoneMsg) {
    this.input.handle(id, m);
  }

  onConnection(id: string, connected: boolean) {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    if (!connected) this.input.release(i);
    if (!this.removed.has(i)) this.sim.setActive(i, connected);
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i)) return;
    this.removed.add(i);
    this.input.release(i);
    this.sim.setActive(i, false);
    if (this.removed.size >= this.ids.length) {
      this.host.finish({});
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const sim = this.sim;
    const h = sim.heroes[i];
    const team = this.teams[i] ?? "fire";
    const fire = team === "fire";
    const accent = fire ? "#ff7a2f" : "#6fd3ff";
    const jump: PadButton = { label: "Jump!", color: accent };
    const reset: PadButton = { label: "↺", color: "#5b4a6b" };
    const base = {
      v: "pad" as const,
      game: "ogien" as const,
      round: this.level,
      rounds: this.levels,
      score: this.scores[i] ?? 0,
    };
    const stats = [
      { k: "Team", v: fire ? "🔥 Fire" : "❄ Ice" },
      { k: "Gems", v: String(h?.gems ?? 0) },
    ];
    const safe = fire
      ? "Lava is fine. Water kills you."
      : "Water is fine. Lava kills you.";
    if (this.phase === "intro") {
      return {
        ...base,
        phase: "ready",
        title: fire ? "🔥 You are FIRE" : "❄ You are ICE",
        text: safe,
        accent,
        buttons: [
          { ...jump, off: true },
          { ...reset, off: true },
        ],
        stats,
      };
    }
    if (this.phase === "done") {
      const pts = this.levelPts[i] ?? 0;
      return {
        ...base,
        phase: "over",
        noStick: true,
        title: sim.over === "clear" ? "Level cleared!" : "Time's up!",
        text: `+${pts} points`,
        accent: sim.over === "clear" ? "#9be15d" : "#ff5c8a",
        buttons: [],
        stats,
      };
    }
    if (!h || h.home) {
      return {
        ...base,
        phase: "play",
        noStick: true,
        title: "Home! 🏠",
        text: "Cheer the others on",
        accent: "#9be15d",
        buttons: [],
        stats,
      };
    }
    if (!h.alive) {
      return {
        ...base,
        phase: "out",
        noStick: true,
        title: fire ? "Sizzled… 💧" : "Melted… 🔥",
        text: "Back in a second",
        accent: "#ff5c8a",
        buttons: [],
        stats,
      };
    }
    return {
      ...base,
      phase: "play",
      title: fire ? "🔥 Fire" : "❄ Ice",
      text: safe,
      accent,
      buttons: [jump, reset],
      stats,
    };
  }

  render() {
    return <OgienView game={this} />;
  }

  hud() {
    const sim = this.sim;
    const now = performance.now();
    const left = Math.ceil(sim.timeLeft);
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    const players = this.ids.map((id) => this.host.player(id));
    return (
      <>
        <div class="og-top">
          <span class="og-level">
            Level {this.level}/{this.levels}
          </span>
          <b>{sim.def.name}</b>
          <span
            class={`og-clock ${this.phase === "play" && left <= 20 ? "hurry" : ""}`}
          >
            {clock}
          </span>
        </div>
        {this.phase === "intro" && (
          <div class="og-intro-wrap">
            <div class="og-intro pop-in">
              <div class="og-intro-small">
                Level {this.level} of {this.levels}
              </div>
              <div class="og-intro-big">{sim.def.name}</div>
              <div class="og-intro-tip">{sim.def.tip}</div>
              <div class="og-teams">
                {(["fire", "ice"] as Team[]).map((t) => (
                  <div class={`og-team ${t}`} key={t}>
                    <div class="og-team-title">
                      {t === "fire"
                        ? "🔥 Fire · lava is fine"
                        : "❄ Ice · water is fine"}
                    </div>
                    <div class="og-team-list">
                      {this.ids.map((id, i) =>
                        this.teams[i] === t &&
                        players[i] &&
                        !this.removed.has(i) ? (
                          <span
                            class="og-chip"
                            style={{ "--pc": colorHex(players[i]!.color) }}
                            key={id}
                          >
                            <Pierogi
                              color={colorHex(players[i]!.color)}
                              size={30}
                            />
                            {players[i]!.name}
                          </span>
                        ) : null,
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div class="og-go">
                {Math.max(1, Math.ceil((this.goAt - Date.now()) / 1000))}
              </div>
            </div>
          </div>
        )}
        {this.phase === "done" &&
          now - this.doneAt > 600 &&
          this.banner(players)}
      </>
    );
  }

  private banner(players: ReturnType<GameHost["player"]>[]) {
    const sim = this.sim;
    const stars = sim.stars();
    const order = this.ids
      .map((_, i) => i)
      .filter((i) => !this.removed.has(i) && players[i])
      .sort((a, b) => this.levelPts[b] - this.levelPts[a]);
    return (
      <div class="trails-banner cookbook-banner og-banner pop-in">
        <div class="trails-banner-small">
          Level {this.level} of {this.levels} · {sim.def.name}
        </div>
        <div class="trails-banner-big cookbook-banner-big">
          {sim.over === "clear" ? "Everyone made it home!" : "Time's up!"}
        </div>
        <div class="og-stars">
          {[0, 1, 2].map((k) => (k < stars ? "★" : "☆")).join(" ")}
        </div>
        <div class="cookbook-banner-list">
          {order.map((i) => {
            const p = players[i]!;
            const h = sim.heroes[i];
            return (
              <div
                class="cookbook-banner-row"
                style={{ "--pc": colorHex(p.color) }}
                key={p.id}
              >
                <Pierogi
                  color={colorHex(p.color)}
                  size={34}
                  mood={h.home ? "wow" : "happy"}
                />
                <span class="grow">
                  {this.teams[i] === "fire" ? "🔥" : "❄"} {p.name}
                </span>
                <small class="og-row-meta">
                  {h.gems ? `💎 ${h.gems}` : ""}
                  {h.holdS >= 3 ? ` · held ${Math.round(h.holdS)}s` : ""}
                  {h.deaths ? ` · 💀 ${h.deaths}` : ""}
                </small>
                <b>+{this.levelPts[i]}</b>
              </div>
            );
          })}
        </div>
        <div class="trails-banner-small cookbook-next">
          {this.level < this.levels
            ? "Next level…"
            : "That was the last level!"}
        </div>
      </div>
    );
  }
}

function OgienView({ game }: { game: OgienGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally ogien">
      <canvas ref={canvas} class="og-canvas" width={1920} height={1080} />
      {game.hud()}
    </div>
  );
}
