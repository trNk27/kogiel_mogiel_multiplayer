import { useEffect, useRef } from "preact/hooks";
import {
  colorHex,
  type AskView,
  type PadView,
  type PhoneMsg,
  type PhoneView,
} from "../../../../shared/protocol";
import type { Game, GameHost } from "../types";
import { ArenaInput } from "../arena/input";
import { TimerRing } from "../../host/components";
import { Pierogi } from "../../lib/art";
import { sound } from "../../lib/sound";
import {
  AUTO_SPEED,
  DECIDE_MS,
  EXIT_MS,
  GOAL,
  GOAL_SHORT,
  IDLE_MS,
  MAX_LOOPS,
  MAX_LOOPS_SHORT,
  PTS,
  REVEAL_MS,
  TURN_MS,
  WALK_SPEED,
  anomaly,
  groupCall,
  nextLevel,
  pickAnomaly,
  rightCall,
  walkerFor,
  type AnomalyId,
} from "./logic";
import { Flat as Corridor, walkEnd } from "./flat";
import "./spacer.css";

type Phase = "walk" | "decide" | "turn" | "reveal" | "exit" | "lost";
type Call = "back" | "forward";

interface Result {
  call: Call;
  right: boolean;
  back: number;
  forward: number;
  to: number;
}

function bark(times = 2) {
  for (let i = 0; i < times; i++)
    sound.note(880, 0.07, {
      type: "square",
      vol: 0.07,
      delay: i * 0.16,
      slide: 1250,
    });
}

export class SpacerGame implements Game {
  readonly id = "spacer" as const;
  readonly goal: number;
  readonly maxLoops: number;
  readonly input: ArenaInput;
  phase: Phase = "walk";
  key = 1;
  endsAt = 0;
  total = 0;
  level = 0;
  /** Loops walked so far; loop 0 is the learning walk (always normal, no vote). */
  loop = 0;
  walker = "";
  a: AnomalyId | null = null;
  /** Metres walked through the flat. */
  s = 0;
  turn = 0;
  votes = new Map<string, Call>();
  used = new Set<AnomalyId>();
  scores: Record<string, number> = {};
  gained: Record<string, number> = {};
  result: Result | null = null;
  readonly removed = new Set<string>();
  private lastMove = 0;
  private barked = false;
  private timers: number[] = [];
  private corridor: Corridor | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private last = 0;
  private hud = 0;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.goal = host.short ? GOAL_SHORT : GOAL;
    this.maxLoops = host.short ? MAX_LOOPS_SHORT : MAX_LOOPS;
    this.input = new ArenaInput(ids);
    ids.forEach((id) => (this.scores[id] = 0));
  }

  start() {
    if (new URLSearchParams(location.search).has("debug"))
      (window as unknown as Record<string, SpacerGame>).spacer = this;
    this.startLoop();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clear();
    this.corridor?.dispose();
    this.corridor = null;
  }

  // ---- helpers ------------------------------------------------------------------

  private clear() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private set(phase: Phase, ms = 0) {
    this.phase = phase;
    this.key++;
    this.total = ms;
    this.endsAt = Date.now() + ms;
    this.host.refresh();
    this.host.changed();
  }

  live() {
    return this.ids.filter(
      (id) => !this.removed.has(id) && this.host.player(id),
    );
  }

  private here(id: string) {
    return !!this.host.player(id)?.connected;
  }

  private name(id: string) {
    return this.host.player(id)?.name ?? "?";
  }

  private color(id: string) {
    return colorHex(this.host.player(id)?.color ?? "sourcream");
  }

  get learning() {
    return this.loop === 0;
  }

  get end() {
    return walkEnd(this.a);
  }

  // ---- flow -----------------------------------------------------------------------

  /** Build the passage for this loop (with or without an anomaly) and hand the walk to the next player. */
  private startLoop() {
    const live = this.live();
    this.walker = walkerFor(live, this.loop);
    this.a = this.learning
      ? null
      : pickAnomaly(this.level, this.used, this.goal);
    if (this.a) this.used.add(this.a);
    this.s = 0;
    this.turn = 0;
    this.votes = new Map();
    this.result = null;
    this.barked = false;
    this.lastMove = performance.now();
    this.input.release();
    this.rebuild();
    this.host.buzz(this.walker, [60, 40, 60]);
    this.set("walk");
  }

  private rebuild() {
    this.corridor?.dispose();
    this.corridor = this.canvas
      ? new Corridor(this.canvas, this.a, this.level)
      : null;
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.rebuild();
  }

  detach() {
    this.corridor?.dispose();
    this.corridor = null;
    this.canvas = null;
  }

  /** Jump straight to a loop with a given anomaly (dev bench, ?debug). */
  debugLoop(a: AnomalyId | null, s = 0) {
    this.clear();
    if (this.loop === 0) this.loop = 1;
    this.a = a;
    this.s = s;
    this.turn = 0;
    this.votes = new Map();
    this.result = null;
    this.rebuild();
    this.set("walk");
  }

  private reachEnd() {
    if (this.learning) {
      // The learning walk just carries on round the corner.
      this.phase = "turn";
      this.result = null;
      this.host.refresh();
      this.host.changed();
      this.later(TURN_MS, () => this.nextLoop());
      return;
    }
    sound.bell();
    this.set("decide", DECIDE_MS);
    this.later(DECIDE_MS, () => this.decide());
    if (this.allVoted()) this.later(900, () => this.decide());
  }

  voters() {
    return this.live();
  }

  private allVoted() {
    return this.voters().every((id) => this.votes.has(id) || !this.here(id));
  }

  private decide() {
    if (this.phase !== "decide") return;
    this.clear();
    let back = 0;
    let forward = 0;
    for (const v of this.votes.values()) {
      if (v === "back") back++;
      else forward++;
    }
    const call = groupCall(back, forward);
    const truth = rightCall(this.a);
    const right = call === truth;
    this.gained = {};
    for (const [id, v] of this.votes)
      if (v === truth && id in this.scores) {
        this.scores[id] += PTS.right;
        this.gained[id] = PTS.right;
      }
    this.level = nextLevel(this.level, call, this.a);
    this.result = { call, right, back, forward, to: this.level };
    this.set("turn", TURN_MS);
    sound.whoosh();
    this.later(TURN_MS, () => {
      if (right) sound.correct();
      else sound.wrong();
      if (this.a && anomaly(this.a).creepy)
        sound.note(110, 0.9, { type: "sawtooth", vol: 0.05, slide: 70 });
      this.set("reveal", REVEAL_MS);
      this.later(REVEAL_MS, () => {
        if (this.level >= this.goal) this.escape();
        else if (this.loop >= this.maxLoops) this.lost();
        else this.nextLoop();
      });
    });
  }

  private nextLoop() {
    this.loop++;
    this.startLoop();
  }

  private escape() {
    for (const id of this.live()) {
      this.scores[id] += PTS.escape;
      this.host.buzz(id, [80, 60, 80, 60, 200]);
    }
    sound.fanfare();
    bark(4);
    this.set("exit", EXIT_MS);
    this.later(EXIT_MS, () => this.finish());
  }

  private lost() {
    sound.wrong();
    this.set("lost", EXIT_MS);
    this.later(EXIT_MS, () => this.finish());
  }

  private finish() {
    const out: Record<string, number> = {};
    for (const id of this.live()) out[id] = this.scores[id] ?? 0;
    this.host.finish(out);
  }

  // ---- the frame loop -----------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === "walk") this.walk(dt, now);
    else if (this.phase === "turn") {
      if (this.result?.call === "back")
        this.turn = Math.min(1, this.turn + dt / 1.4);
      else this.s += WALK_SPEED * 0.9 * dt; // on round the corner
    }
    this.corridor?.update(dt, this.s, this.turn);
    if (now - this.hud > 250) {
      this.hud = now;
      this.host.changed();
    }
  };

  private walk(dt: number, now: number) {
    const i = this.ids.indexOf(this.walker);
    const pad = this.input.pads[i];
    // The stick: up (negative y) walks forward, down backs up for a second look.
    let v = pad && this.here(this.walker) ? -pad.y : 0;
    if (Math.abs(v) < 0.15) v = 0;
    if (v !== 0) this.lastMove = now;
    else if (now - this.lastMove > IDLE_MS) v = AUTO_SPEED / WALK_SPEED;
    this.s = Math.max(0, Math.min(this.end, this.s + v * WALK_SPEED * dt));
    if (!this.barked && this.s > 9) {
      this.barked = true;
      bark(this.a === "noBaja" ? 3 : 2);
    }
    if (this.s >= this.end) this.reachEnd();
  }

  // ---- phones ---------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (this.removed.has(id)) return;
    this.input.handle(id, m);
    const voting =
      (this.phase === "walk" && !this.learning) || this.phase === "decide";
    if (!voting) return;
    let v: Call | null = null;
    if (m.t === "ask" && m.key === this.key && (m.i === 0 || m.i === 1))
      v = m.i === 0 ? "back" : "forward";
    if (id === this.walker) {
      const i = this.ids.indexOf(id);
      if (this.input.takePresses(i, 0) > 0) v = "back";
      if (this.input.takePresses(i, 1) > 0) v = "forward";
    }
    if (!v) return;
    // Votes can change until the vote closes; the key moves on so the phone shows the buttons again.
    this.votes.set(id, v);
    if (id !== this.walker) this.key++;
    sound.lockIn();
    this.host.refresh();
    this.host.changed();
    if (this.phase === "decide" && this.allVoted()) {
      this.clear();
      this.later(900, () => this.decide());
      this.later(DECIDE_MS, () => this.decide());
    }
  }

  onConnection(id: string, connected: boolean) {
    const i = this.ids.indexOf(id);
    if (!connected && i >= 0) this.input.release(i);
    if (this.phase === "decide" && this.allVoted()) {
      this.clear();
      this.later(900, () => this.decide());
    }
    this.host.changed();
  }

  onRemoved(id: string) {
    this.removed.add(id);
    this.votes.delete(id);
    delete this.scores[id];
    if (!this.live().length) {
      this.host.finish({});
      return;
    }
    if (id === this.walker) this.walker = this.live()[0];
    this.host.refresh();
    this.host.changed();
  }

  viewFor(id: string): PhoneView {
    const me = id === this.walker;
    const v = this.votes.get(id);
    const note = `Exit ${this.level} of ${this.goal}`;
    const voting =
      (this.phase === "walk" && !this.learning) || this.phase === "decide";
    if (me && this.phase === "walk") {
      const pad: PadView = {
        v: "pad",
        game: "spacer",
        phase: "play",
        round: this.level,
        rounds: this.goal,
        title: this.learning
          ? "🚶 You walk! Push up"
          : "🚶 You walk! Look closely",
        text: this.learning
          ? "Up walks, down backs up. Remember everything in the flat."
          : v
            ? `Your vote: ${v === "back" ? "↩ Go back" : "➡ Keep going"}`
            : "Up walks, down backs up. Vote below.",
        accent: "#ffd21f",
        buttons: this.learning
          ? []
          : [
              {
                label: v === "back" ? "✓ Go back" : "↩ Go back",
                color: "#ff5c8a",
              },
              {
                label: v === "forward" ? "✓ Keep going" : "➡ Keep going",
                color: "#3ee0b5",
              },
            ],
        score: this.scores[id] ?? 0,
        stats: [{ k: "Exit", v: `${this.level}/${this.goal}` }],
      };
      return pad;
    }
    const ask = (
      title: string,
      input: AskView["input"],
      extra: Partial<AskView> = {},
    ): AskView => ({
      v: "ask",
      game: "spacer",
      key: this.key,
      note,
      title,
      input,
      score: this.scores[id] ?? 0,
      ...extra,
    });
    if (voting) {
      return ask(
        this.phase === "decide"
          ? "Decide now! ⏳"
          : v
            ? v === "back"
              ? "You say: go back"
              : "You say: keep going"
            : "Anything strange?",
        {
          k: "choice",
          options: [
            {
              label: v === "back" ? "✓ Go back" : "↩ Go back",
              color: "#ff5c8a",
              sub: "something is off",
            },
            {
              label: v === "forward" ? "✓ Keep going" : "➡ Keep going",
              color: "#3ee0b5",
              sub: "all normal",
            },
          ],
          picked: null,
        },
        {
          endsAt: this.phase === "decide" ? this.endsAt : undefined,
          text: `${this.name(this.walker)} is walking. You can change your vote until the end.`,
        },
      );
    }
    switch (this.phase) {
      case "walk":
        return ask("Watch the TV 👀", {
          k: "none",
          big: `${this.name(this.walker)} walks first. Remember everything: the paintings, the bookcase, the kitchen, Baja and her dragon.`,
          mood: "wow",
        });
      case "turn":
        return ask(
          this.result
            ? this.result.call === "back"
              ? "↩ Turning back…"
              : "➡ Carrying on…"
            : "Round the corner…",
          { k: "none", big: "", mood: "happy" },
        );
      case "reveal": {
        const r = this.result!;
        const pts = this.gained[id] ?? 0;
        return ask(
          r.right ? `Right! Exit ${r.to} 🎉` : "Wrong! Back to Exit 0 😱",
          {
            k: "none",
            big: this.a ? anomaly(this.a).label : "Nothing was off",
            mood: pts ? "wow" : "sleep",
            good: pts > 0,
          },
        );
      }
      case "exit":
        return ask(`You found Exit ${this.goal}! 🐕`, {
          k: "none",
          big: `${this.scores[id] ?? 0} points`,
          mood: "wow",
          good: true,
        });
      default:
        return ask("Still lost in Baja’s flat…", {
          k: "none",
          big: `${this.scores[id] ?? 0} points`,
          mood: "sleep",
        });
    }
  }

  // ---- TV ---------------------------------------------------------------------

  render() {
    return <SpacerView game={this} />;
  }

  overlay() {
    const r = this.result;
    const voters = this.voters();
    return (
      <>
        <div
          class={`sp-exit ${this.phase === "reveal" && r && !r.right ? "reset" : ""}`}
        >
          WYJŚCIE <b>{this.level}</b>
          <span class="sp-dots">
            {Array.from({ length: this.goal }, (_, k) => (
              <i class={k < this.level ? "on" : ""} key={k} />
            ))}
          </span>
        </div>
        {(this.phase === "walk" || this.phase === "decide") && (
          <div class="sp-walker" style={{ "--pc": this.color(this.walker) }}>
            <Pierogi color={this.color(this.walker)} size={44} mood="happy" />
            <span>
              <b>{this.name(this.walker)}</b> is walking
            </span>
          </div>
        )}
        {this.learning && this.phase === "walk" && this.s < 5 && (
          <div class="sp-banner low pop-in">
            <div class="sp-banner-big">Remember Baja’s flat</div>
            <div class="sp-banner-line">
              The paintings, the bookcase, the kitchen, Baja and her green
              dragon. From now on, if anything is different: turn back.
            </div>
          </div>
        )}
        {!this.learning &&
          (this.phase === "walk" || this.phase === "decide") && (
            <div class="sp-votes-bar">
              {this.phase === "decide" ? "↩ Go back or ➡ keep going?" : "Votes"}
              <span class="sp-votes">
                {voters.map((id) => (
                  <span
                    class={`vote-dot ${this.votes.has(id) ? "in" : ""}`}
                    style={{ "--pc": this.color(id) }}
                    key={id}
                  />
                ))}
              </span>
            </div>
          )}
        {this.phase === "decide" && (
          <div class="sp-timer">
            <TimerRing
              key={`t${this.key}`}
              endsAt={this.endsAt}
              total={this.total}
              size={110}
              onTick={(sec) => sec <= 3 && sec > 0 && sound.tick()}
            />
          </div>
        )}
        {this.phase === "turn" && r && (
          <div class="sp-call pop-in" key={`c${this.loop}`}>
            {r.call === "back"
              ? `↩ Going back (${r.back} to ${r.forward})`
              : `➡ Keep going (${r.forward} to ${r.back})`}
          </div>
        )}
        {this.phase === "reveal" && r && (
          <div
            class={`sp-banner ${r.right ? "good" : "bad"} pop-in`}
            key={`r${this.loop}`}
          >
            <div class="sp-banner-small">
              {this.a ? `👀 ${anomaly(this.a).label}` : "✅ Nothing was off"}
            </div>
            <div class="sp-banner-big">
              {r.right
                ? `Right call! WYJŚCIE ${r.to}`
                : "Wrong call! Back to WYJŚCIE 0"}
            </div>
            <div class="sp-chips">
              {voters.map((id) => {
                const v = this.votes.get(id);
                const ok = v === rightCall(this.a);
                return (
                  <span
                    class={`sp-chip ${ok ? "right" : "wrong"}`}
                    style={{ "--pc": this.color(id) }}
                    key={id}
                  >
                    <Pierogi
                      color={this.color(id)}
                      size={30}
                      mood={ok ? "wow" : "sleep"}
                    />
                    {this.name(id)}{" "}
                    {v === "back" ? "↩" : v === "forward" ? "➡" : "…"}
                    {this.gained[id] ? ` +${this.gained[id]}` : ""}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {(this.phase === "exit" || this.phase === "lost") && (
          <div
            class={`sp-banner ${this.phase === "exit" ? "good" : "bad"} pop-in`}
          >
            <div class="sp-banner-big">
              {this.phase === "exit"
                ? `☀️ WYJŚCIE ${this.goal}! You're out!`
                : "Still stuck in the same flat…"}
            </div>
            <div class="sp-banner-line">
              {this.phase === "exit"
                ? `${this.loop} loops, and Baja finally lets you go home. +${PTS.escape} each!`
                : `${this.loop} loops and no way out. Baja will see you tomorrow.`}
            </div>
            <div class="sp-chips">
              {this.live()
                .sort((x, y) => (this.scores[y] ?? 0) - (this.scores[x] ?? 0))
                .map((id) => (
                  <span
                    class="sp-chip right"
                    style={{ "--pc": this.color(id) }}
                    key={id}
                  >
                    <Pierogi color={this.color(id)} size={30} mood="happy" />
                    {this.name(id)} {this.scores[id] ?? 0}
                  </span>
                ))}
            </div>
          </div>
        )}
      </>
    );
  }
}

function SpacerView({ game }: { game: SpacerGame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    game.attach(ref.current!);
    return () => game.detach();
  }, [game]);
  return (
    <div class="sp">
      <canvas ref={ref} class="sp-canvas" width={1440} height={810} />
      {game.overlay()}
    </div>
  );
}
