import {
  colorHex,
  type AskInput,
  type AskView,
  type PhoneMsg,
  type PhoneView,
} from "../../../../shared/protocol";
import type { Game, GameHost } from "../types";
import { TimerRing } from "../../host/components";
import { Pierogi } from "../../lib/art";
import { sound } from "../../lib/sound";
import {
  DECIDE_MS,
  EXIT_MS,
  GOAL,
  GOAL_SHORT,
  LEARN_MS,
  MAX_WALKS,
  MAX_WALKS_SHORT,
  PLANT_MS,
  PTS,
  REVEAL_MS,
  WALK_MS,
  anomaly,
  groupCall,
  nameOptions,
  nextLevel,
  nextPlanter,
  plantOptions,
  rightCall,
  type AnomalyId,
} from "./logic";
import { Street, ringY, walkMs } from "./scene";
import "./spacer.css";

type Phase = "learn" | "plant" | "walk" | "decide" | "reveal" | "exit" | "lost";
type Call = "back" | "forward";
/** The "what did you see?" question uses its own key so it can't be confused with the vote. */
const NAME_KEY = 100_000;

interface Result {
  call: Call;
  right: boolean;
  back: number;
  forward: number;
  from: number;
  to: number;
  fooled: number;
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
  readonly maxWalks: number;
  phase: Phase = "learn";
  key = 1;
  endsAt = 0;
  total = 0;
  level = 0;
  walks = 0;
  planter: string | null = null;
  planted: AnomalyId | null = null;
  picked = false;
  options: AnomalyId[] = [];
  nameOpts: AnomalyId[] = [];
  votes = new Map<string, Call>();
  named = new Map<string, AnomalyId>();
  used = new Set<AnomalyId>();
  turns = new Map<string, number>();
  scores: Record<string, number> = {};
  gained: Record<string, number> = {};
  result: Result | null = null;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.goal = host.short ? GOAL_SHORT : GOAL;
    this.maxWalks = host.short ? MAX_WALKS_SHORT : MAX_WALKS;
    ids.forEach((id) => (this.scores[id] = 0));
  }

  start() {
    if (new URLSearchParams(location.search).has("debug"))
      (window as unknown as Record<string, SpacerGame>).spacer = this;
    this.go("learn", LEARN_MS, () => this.plant());
    this.later(LEARN_MS * 0.42, () => bark(2));
  }

  dispose() {
    this.clear();
  }

  // ---- helpers ------------------------------------------------------------------

  private clear() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private go(phase: Phase, ms: number, then: () => void) {
    this.clear();
    this.phase = phase;
    if (phase !== "decide") this.key++;
    this.total = ms;
    this.endsAt = Date.now() + ms;
    this.later(ms, then);
    this.host.refresh();
    this.host.changed();
  }

  private live() {
    return this.ids.filter((id) => this.host.player(id));
  }

  private here(id: string) {
    return !!this.host.player(id)?.connected;
  }

  private name(id: string | null) {
    return (id && this.host.player(id)?.name) || "?";
  }

  private color(id: string) {
    return colorHex(this.host.player(id)?.color ?? "sourcream");
  }

  /** Everyone who calls this walk: all but the planter (unless they're alone). */
  voters() {
    const live = this.live();
    return live.length > 1 ? live.filter((id) => id !== this.planter) : live;
  }

  get walkTime() {
    return walkMs(WALK_MS, this.planted);
  }

  // ---- flow -----------------------------------------------------------------------

  private plant() {
    const live = this.live();
    this.planter =
      live.length > 1 ? nextPlanter(live, this.turns, this.planter) : null;
    if (this.planter)
      this.turns.set(this.planter, (this.turns.get(this.planter) ?? 0) + 1);
    this.options = plantOptions(this.level, this.used, this.goal);
    this.planted = null;
    this.picked = false;
    this.votes = new Map();
    this.named = new Map();
    this.result = null;
    if (!this.planter) {
      // Playing alone: the street plants its own anomalies, about half the time.
      this.planted = Math.random() < 0.5 ? this.options[0] : null;
      this.picked = true;
      this.walk();
      return;
    }
    sound.whoosh();
    this.host.buzz(this.planter, [40, 40, 40]);
    this.go("plant", PLANT_MS, () => {
      if (!this.picked) {
        this.planted =
          Math.random() < 0.35
            ? null
            : this.options[Math.floor(Math.random() * this.options.length)];
        this.picked = true;
      }
      this.walk();
    });
  }

  private walk() {
    this.walks++;
    if (this.planted) this.used.add(this.planted);
    this.nameOpts = nameOptions(this.planted);
    const ms = this.walkTime;
    this.go("walk", ms, () => this.decide());
    if (this.planted === "noBaja") this.later(ms * 0.45, () => bark(3));
    else if (this.planted !== "sitting") this.later(ms * 0.45, () => bark(2));
    if (this.planted === "ballWave")
      this.later(ms * 0.4, () => sound.drumroll(1));
  }

  private decide() {
    sound.bell();
    this.go("decide", DECIDE_MS, () => this.reveal());
    if (this.allIn()) this.later(800, () => this.reveal());
  }

  private allIn() {
    return this.voters().every(
      (id) =>
        !this.here(id) ||
        (this.votes.has(id) &&
          (this.votes.get(id) === "forward" || this.named.has(id))),
    );
  }

  private reveal() {
    if (this.phase !== "decide" && this.phase !== "walk") return;
    const voters = this.voters();
    let back = 0;
    let forward = 0;
    for (const id of voters) {
      const v = this.votes.get(id);
      if (v === "back") back++;
      else if (v === "forward") forward++;
    }
    const call = groupCall(back, forward);
    const truth = rightCall(this.planted);
    const right = call === truth;
    this.gained = {};
    const add = (id: string, n: number) => {
      if (!(id in this.scores) || !n) return;
      this.scores[id] += n;
      this.gained[id] = (this.gained[id] ?? 0) + n;
    };
    let fooled = 0;
    for (const id of voters) {
      const v = this.votes.get(id);
      if (v === truth) add(id, PTS.right);
      else fooled++;
      if (this.planted && this.named.get(id) === this.planted)
        add(id, PTS.named);
    }
    if (this.planter) add(this.planter, fooled * PTS.fooled);
    const from = this.level;
    this.level = nextLevel(this.level, call, this.planted);
    this.result = { call, right, back, forward, from, to: this.level, fooled };
    if (right) sound.correct();
    else sound.wrong();
    this.go("reveal", REVEAL_MS, () => {
      if (this.level >= this.goal) this.escape();
      else if (this.walks >= this.maxWalks) this.lost();
      else this.plant();
    });
  }

  private escape() {
    for (const id of this.live()) {
      this.scores[id] += PTS.escape;
      this.host.buzz(id, [80, 60, 80, 60, 200]);
    }
    sound.fanfare();
    bark(4);
    this.go("exit", EXIT_MS, () => this.finish());
  }

  private lost() {
    sound.wrong();
    this.go("lost", EXIT_MS, () => this.finish());
  }

  private finish() {
    const out: Record<string, number> = {};
    for (const id of this.live()) out[id] = this.scores[id] ?? 0;
    this.host.finish(out);
  }

  // ---- phones ---------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== "ask" || !this.host.player(id) || typeof m.i !== "number")
      return;
    if (
      this.phase === "plant" &&
      id === this.planter &&
      m.key === this.key &&
      !this.picked
    ) {
      if (m.i < 0 || m.i > this.options.length) return;
      this.planted = m.i < this.options.length ? this.options[m.i] : null;
      this.picked = true;
      sound.lockIn();
      this.host.refresh(id);
      this.clear();
      this.later(700, () => this.walk());
      return;
    }
    if (
      (this.phase !== "walk" && this.phase !== "decide") ||
      !this.voters().includes(id)
    )
      return;
    if (m.key === this.key && !this.votes.has(id) && (m.i === 0 || m.i === 1)) {
      this.votes.set(id, m.i === 0 ? "back" : "forward");
    } else if (
      m.key === this.key + NAME_KEY &&
      this.votes.get(id) === "back" &&
      !this.named.has(id)
    ) {
      const pick = this.nameOpts[m.i];
      if (!pick) return;
      this.named.set(id, pick);
    } else return;
    sound.lockIn();
    this.host.refresh(id);
    this.host.changed();
    if (this.phase === "decide" && this.allIn()) {
      this.clear();
      this.later(800, () => this.reveal());
    }
  }

  onConnection() {
    if (this.phase === "decide" && this.allIn()) {
      this.clear();
      this.later(800, () => this.reveal());
    }
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    this.votes.delete(id);
    this.named.delete(id);
    if (!this.ids.length) {
      this.host.finish({});
      return;
    }
    if (id === this.planter && this.phase === "plant") {
      this.planter = null;
      this.planted = Math.random() < 0.5 ? this.options[0] : null;
      this.picked = true;
      this.walk();
      return;
    }
    if (this.phase === "decide" && this.allIn()) {
      this.clear();
      this.later(800, () => this.reveal());
    }
    this.host.refresh();
    this.host.changed();
  }

  viewFor(id: string): PhoneView {
    const base = {
      v: "ask" as const,
      game: "spacer" as const,
      key: this.key,
      note: `Exit ${this.level} of ${this.goal} · walk ${Math.max(1, this.walks)}`,
      score: this.scores[id] ?? 0,
    };
    const view = (
      title: string,
      input: AskInput,
      extra: Partial<AskView> = {},
    ): AskView => ({ ...base, title, input, ...extra });
    const none = (
      big: string,
      mood?: "happy" | "wow" | "dead" | "sleep",
      good?: boolean,
    ): AskInput => ({ k: "none", big, mood, good });
    const planter = id === this.planter;
    switch (this.phase) {
      case "learn":
        return view(
          "Remember this street 👀",
          none(
            "Every lamp, every window, every Baja. Next time something will be off.",
            "wow",
          ),
        );
      case "plant":
        if (planter)
          return view(
            "😈 You plant the weird thing",
            {
              k: "choice",
              options: [
                ...this.options.map((a) => ({ label: anomaly(a).label })),
                { label: "🙂 Nothing (bluff!)", color: "#5b6b8a" },
              ],
              picked: this.picked
                ? this.planted
                  ? this.options.indexOf(this.planted)
                  : this.options.length
                : null,
            },
            {
              endsAt: this.endsAt,
              text: "Every friend you fool is +100. Keep a straight face!",
            },
          );
        return view(
          "🤫 Someone is up to something…",
          none("Get ready to walk. Watch everything.", "sleep"),
        );
      case "walk":
      case "decide": {
        if (planter)
          return view(
            "😈 Watch them squirm",
            none(
              this.planted
                ? anomaly(this.planted).label
                : "You planted nothing",
              "wow",
            ),
            { endsAt: this.phase === "decide" ? this.endsAt : undefined },
          );
        const v = this.votes.get(id);
        if (!v)
          return view(
            this.phase === "walk" ? "Anything weird?" : "Decide now!",
            {
              k: "choice",
              options: [
                {
                  label: "↩ Go back",
                  color: "#ff5c8a",
                  sub: "something is off",
                },
                {
                  label: "➡ Keep walking",
                  color: "#3ee0b5",
                  sub: "all normal",
                },
              ],
              picked: null,
            },
            { endsAt: this.phase === "decide" ? this.endsAt : undefined },
          );
        if (v === "back" && !this.named.has(id))
          return view(
            "What did you see? (+50)",
            {
              k: "choice",
              options: this.nameOpts.map((a) => ({ label: anomaly(a).label })),
              picked: null,
            },
            {
              key: this.key + NAME_KEY,
              endsAt: this.phase === "decide" ? this.endsAt : undefined,
            },
          );
        return view(
          v === "back" ? "↩ Going back" : "➡ Keep walking",
          none("Locked in. Waiting for the others…", "happy"),
        );
      }
      case "reveal": {
        const r = this.result!;
        const pts = this.gained[id] ?? 0;
        const title = r.right
          ? `Right! Exit ${r.to} 🎉`
          : "Wrong! Back to Exit 0 😱";
        if (planter)
          return view(
            title,
            none(
              r.fooled
                ? `You fooled ${r.fooled}! +${pts}`
                : "Nobody fell for it",
              r.fooled ? "wow" : "sleep",
              r.fooled > 0,
            ),
          );
        return view(
          title,
          none(
            pts ? `+${pts}` : "No points this time",
            pts ? "wow" : "sleep",
            pts > 0,
          ),
        );
      }
      case "exit":
        return view(
          "You found Exit 8! 🐕",
          none(`${this.scores[id] ?? 0} points`, "wow", true),
        );
      case "lost":
        return view(
          "Still lost on the street…",
          none(`${this.scores[id] ?? 0} points`, "sleep"),
        );
    }
  }

  // ---- TV ---------------------------------------------------------------------

  render() {
    const walkers = this.live().map((id) => ({
      color: this.color(id),
      name: this.name(id),
    }));
    const r = this.result;
    const walking = this.phase === "learn" || this.phase === "walk";
    const a =
      this.phase === "learn" || this.phase === "plant" ? null : this.planted;
    const focus =
      this.phase === "reveal" && this.planted
        ? anomaly(this.planted).x
        : this.phase === "reveal"
          ? 3000
          : 3600;
    const ring =
      this.phase === "reveal"
        ? this.planted
          ? `👀 ${anomaly(this.planted).label}`
          : "✅ Nothing was off"
        : null;
    return (
      <div class="sp">
        <Street
          anomaly={this.phase === "exit" ? null : a}
          mode={walking ? "walk" : "still"}
          ms={this.phase === "learn" ? LEARN_MS : this.walkTime}
          focus={focus}
          level={this.level}
          walkers={walkers}
          runKey={walking ? `w${this.key}` : `s${this.walks}`}
          ring={ring}
        />
        <div
          class={`sp-exit ${this.phase === "reveal" && r && !r.right ? "reset" : ""}`}
        >
          🚪 Exit <b>{this.level}</b>
          <span class="sp-dots">
            {Array.from({ length: this.goal }, (_, k) => (
              <i class={k < this.level ? "on" : ""} key={k} />
            ))}
          </span>
        </div>
        {this.phase === "learn" && (
          <div class="sp-banner fade">
            <div class="sp-banner-big">Remember this street</div>
            <div class="sp-banner-line">
              Baja trots past, the tram goes by, the lamps are lit. From now on,
              if anything is different: turn back.
            </div>
          </div>
        )}
        {this.phase === "plant" && (
          <div class="sp-banner pop-in" key={`p${this.walks}`}>
            <div class="sp-banner-big">🤫 Someone is planting something…</div>
            <div class="sp-banner-line">
              One of you secretly picks what's weird on this walk. Or nothing at
              all.
            </div>
          </div>
        )}
        {this.phase === "decide" && (
          <div class="sp-decide pop-in">
            ↩ Go back or ➡ keep walking?
            <span class="sp-votes">
              {this.voters().map((id) => (
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
              onTick={(s) => s <= 3 && s > 0 && sound.tick()}
            />
          </div>
        )}
        {this.phase === "reveal" && r && (
          <div
            class={`sp-banner late ${ringY(this.planted) >= 700 ? "up" : ""} ${r.right ? "good" : "bad"} pop-in`}
            key={`r${this.walks}`}
          >
            <div class="sp-banner-big">
              {r.right
                ? `Right call! On to Exit ${r.to}`
                : "Wrong call! Back to Exit 0"}
            </div>
            <div class="sp-banner-row">
              <span>
                ↩ {r.back} · ➡ {r.forward}
              </span>
              {this.planter && (
                <span>
                  😈 Planted by {this.name(this.planter)}
                  {r.fooled ? `, fooled ${r.fooled}` : ""}
                </span>
              )}
            </div>
            <div class="sp-chips">
              {this.voters().map((id) => {
                const v = this.votes.get(id);
                const ok = v === rightCall(this.planted);
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
                ? `🚪 Exit ${this.goal}! You made it out!`
                : "Still walking the same street…"}
            </div>
            <div class="sp-banner-line">
              {this.phase === "exit"
                ? `${this.walks} walks, and Baja finally lets you go home. +${PTS.escape} each!`
                : `${this.walks} walks and no way out. Baja will see you tomorrow.`}
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
      </div>
    );
  }
}
