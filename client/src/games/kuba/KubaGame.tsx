import data from "../../../../data/kuba.json";
import {
  colorHex,
  type AskInput,
  type AskView,
  type PhoneMsg,
  type PhoneView,
  type Stroke,
} from "../../../../shared/protocol";
import type { Game, GameHost } from "../types";
import { Leaderboard, TimerRing } from "../../host/components";
import { Pierogi } from "../../lib/art";
import { sound } from "../../lib/sound";
import { Doodle } from "../toty/art";
import { sanitizeStrokes } from "../toty/logic";
import {
  DRAW_MS,
  END_MS,
  KB_MAX,
  KB_ROUNDS,
  KB_ROUNDS_SHORT,
  READ_MS,
  RATE_MS,
  REVEAL_MS,
  ROUND_INFO,
  SCORES_MS,
  TITLE_MS,
  VERDICT_MS,
  WRITE_MS,
  average,
  crackedIn,
  dealPrompts,
  drunkLevel,
  fill,
  isShot,
  outcome,
  sanitize,
  scoreJoke,
  shuffle,
  soberFor,
  type KbRound,
  type Outcome,
} from "./logic";
import "./kuba.css";

const POOL = data as {
  joke: string[];
  finish: string[];
  draw: string[];
  roast: string[];
  styles: string[];
  safety: string[];
};
/** Phones hand in what's typed just before the deadline; give it time to arrive. */
const GRACE_MS = 1500;
const RATE_FACES = ["😐", "🙂", "😄", "😆", "🤣"];

type Phase =
  "title" | "write" | "read" | "verdict" | "rate" | "reveal" | "scores" | "end";

interface Entry {
  author: string;
  prompt: string;
  text?: string;
  strokes?: Stroke[];
  auto: boolean;
  style: string;
}

interface Result {
  outcome: Outcome;
  avg: number;
  cracked: number;
  held: number;
  authorPts: number;
}

export class KubaGame implements Game {
  readonly id = "kuba" as const;
  readonly rounds: KbRound[];
  round = 0;
  phase: Phase = "title";
  key = 1;
  endsAt = 0;
  total = 0;
  sober = "";
  /** Every sober one so far, with their shots. */
  shots = new Map<string, number>();
  prompts = new Map<string, string>();
  answers = new Map<
    string,
    { text?: string; strokes?: Stroke[]; auto: boolean }
  >();
  entries: Entry[] = [];
  idx = -1;
  laughed: boolean | null = null;
  votes = new Map<string, boolean>();
  ratings = new Map<string, number>();
  result: Result | null = null;
  scores: Record<string, number> = {};
  roundPts: Record<string, number> = {};
  best: { author: string; text: string; avg: number } | null = null;
  private timer = 0;
  private safetyDeck: string[] = [];
  private styleDeck: string[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? KB_ROUNDS_SHORT : KB_ROUNDS;
    ids.forEach((id) => (this.scores[id] = 0));
  }

  start() {
    if (new URLSearchParams(location.search).has("debug"))
      (window as unknown as Record<string, KubaGame>).kuba = this;
    this.nextRound();
  }

  dispose() {
    clearTimeout(this.timer);
  }

  // ---- helpers ------------------------------------------------------------------

  private name(id: string) {
    return this.host.player(id)?.name ?? "?";
  }

  private color(id: string) {
    return colorHex(this.host.player(id)?.color ?? "sourcream");
  }

  private live(): string[] {
    return this.ids.filter((id) => this.host.player(id));
  }

  private here(id: string) {
    return !!this.host.player(id)?.connected;
  }

  get kind(): KbRound {
    return this.rounds[this.round - 1] ?? "joke";
  }

  get entry(): Entry | null {
    return this.entries[this.idx] ?? null;
  }

  private writers() {
    return this.live().filter((id) => id !== this.sober);
  }

  private after(ms: number, fn: () => void) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(fn, ms);
  }

  private go(phase: Phase, ms: number, then: () => void) {
    this.phase = phase;
    this.key++;
    this.total = ms;
    this.endsAt = Date.now() + ms;
    this.after(ms + (phase === "write" ? GRACE_MS : 0), then);
    this.host.refresh();
    this.host.changed();
  }

  private draw<T>(deck: T[], pool: T[]): T {
    if (!deck.length) deck.push(...shuffle(pool));
    return deck.pop()!;
  }

  // ---- flow -----------------------------------------------------------------------

  private nextRound() {
    this.round++;
    const players = this.live().map((id) => ({ id, name: this.name(id) }));
    this.sober = soberFor(players, this.round);
    if (!this.shots.has(this.sober)) this.shots.set(this.sober, 0);
    this.roundPts = {};
    const writers = this.writers();
    const pool = POOL[this.kind];
    const dealt = dealPrompts(pool, writers.length);
    this.prompts = new Map(
      writers.map((id, i) => [id, fill(dealt[i], this.name(this.sober))]),
    );
    this.answers = new Map();
    this.entries = [];
    this.idx = -1;
    sound.whoosh();
    this.go("title", TITLE_MS, () => this.startWrite());
  }

  private startWrite() {
    this.go("write", this.kind === "draw" ? DRAW_MS : WRITE_MS, () =>
      this.endWrite(),
    );
  }

  private allWritten() {
    return this.writers().every((id) => this.answers.has(id) || !this.here(id));
  }

  private endWrite() {
    if (this.phase !== "write") return;
    const list: Entry[] = [];
    for (const id of this.writers()) {
      let a = this.answers.get(id);
      if (!a && this.kind !== "draw")
        a = { text: this.draw(this.safetyDeck, POOL.safety), auto: true };
      if (!a || (!a.text && !a.strokes?.length)) continue;
      list.push({
        author: id,
        prompt: this.prompts.get(id) ?? "",
        ...a,
        style: this.draw(this.styleDeck, POOL.styles),
      });
    }
    this.entries = shuffle(list);
    this.idx = -1;
    this.nextEntry();
  }

  private nextEntry() {
    this.idx++;
    while (this.entry && !this.host.player(this.entry.author)) this.idx++;
    if (!this.entry) {
      this.showScores();
      return;
    }
    this.laughed = null;
    this.votes = new Map();
    this.ratings = new Map();
    this.result = null;
    sound.drumroll(1);
    this.go("read", READ_MS, () => this.startVerdict());
  }

  private startVerdict() {
    sound.bell();
    this.go("verdict", VERDICT_MS, () => this.startRate());
  }

  private voters() {
    const e = this.entry;
    return this.live().filter((id) => id !== this.sober && id !== e?.author);
  }

  private raters() {
    const e = this.entry;
    return this.live().filter((id) => id !== e?.author);
  }

  private verdictDone() {
    return (
      (this.laughed !== null || !this.here(this.sober)) &&
      this.voters().every((id) => this.votes.has(id) || !this.here(id))
    );
  }

  private startRate() {
    if (this.phase !== "verdict") return;
    this.go("rate", RATE_MS, () => this.reveal());
  }

  private rateDone() {
    return this.raters().every((id) => this.ratings.has(id) || !this.here(id));
  }

  private reveal() {
    if (this.phase !== "rate") return;
    const e = this.entry!;
    const cracked = [...this.votes.values()].filter((v) => v).length;
    const held = this.votes.size - cracked;
    const o = outcome(this.laughed === true, cracked, held);
    const avg = average([...this.ratings.values()]);
    const s = scoreJoke(o, avg);
    const add = (id: string, n: number) => {
      if (!n || !(id in this.scores)) return;
      this.scores[id] += n;
      this.roundPts[id] = (this.roundPts[id] ?? 0) + n;
    };
    add(e.author, s.author);
    add(this.sober, s.sober);
    for (const [id, v] of this.votes) if (v === crackedIn(o)) add(id, s.guess);
    if (isShot(o)) {
      this.shots.set(this.sober, (this.shots.get(this.sober) ?? 0) + 1);
      this.host.buzz(this.sober, [80, 60, 80, 60, 200]);
      this.host.buzz(e.author, [60, 40, 120]);
      sound.fanfare();
    } else sound.wrong();
    if (e.text && this.ratings.size && (!this.best || avg > this.best.avg))
      this.best = { author: e.author, text: e.text, avg };
    this.result = { outcome: o, avg, cracked, held, authorPts: s.author };
    this.go("reveal", REVEAL_MS, () => this.nextEntry());
  }

  private showScores() {
    const last = this.round >= this.rounds.length;
    this.go("scores", SCORES_MS, () => (last ? this.end() : this.nextRound()));
  }

  private end() {
    sound.fanfare();
    this.go("end", END_MS, () => this.finish());
  }

  private finish() {
    const out: Record<string, number> = {};
    for (const id of this.live()) out[id] = this.scores[id] ?? 0;
    this.host.finish(out);
  }

  // ---- phones ---------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== "ask" || m.key !== this.key || !this.host.player(id)) return;
    const e = this.entry;
    if (this.phase === "write") {
      if (id === this.sober || this.answers.has(id)) return;
      if (this.kind === "draw") {
        const strokes = sanitizeStrokes(m.strokes);
        if (!strokes || !strokes.length) return;
        this.answers.set(id, { strokes, auto: false });
      } else {
        const text = m.auto
          ? this.draw(this.safetyDeck, POOL.safety)
          : sanitize(m.text);
        if (!text) return;
        this.answers.set(id, { text, auto: !!m.auto });
      }
      sound.lockIn();
      if (this.allWritten()) this.endWrite();
    } else if (this.phase === "verdict") {
      if (m.i !== 0 && m.i !== 1) return;
      if (id === this.sober) {
        if (this.laughed !== null) return;
        this.laughed = m.i === 0;
      } else if (id !== e?.author && !this.votes.has(id))
        this.votes.set(id, m.i === 0);
      else return;
      sound.lockIn();
      if (this.verdictDone()) this.after(400, () => this.startRate());
    } else if (this.phase === "rate") {
      if (
        id === e?.author ||
        this.ratings.has(id) ||
        typeof m.i !== "number" ||
        m.i < 0 ||
        m.i > 4
      )
        return;
      this.ratings.set(id, m.i + 1);
      sound.lockIn();
      if (this.rateDone()) this.after(400, () => this.reveal());
    } else return;
    this.host.refresh(id);
    this.host.changed();
  }

  onConnection() {
    if (this.phase === "write" && this.allWritten()) this.endWrite();
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    this.prompts.delete(id);
    this.answers.delete(id);
    this.votes.delete(id);
    this.ratings.delete(id);
    if (this.ids.length < 2) {
      this.finish();
      return;
    }
    if (id === this.sober) {
      // Someone else takes over the poker face; they can't judge their own joke, so it goes.
      this.sober = soberFor(
        this.live().map((x) => ({ id: x, name: this.name(x) })),
        this.round,
      );
      if (!this.shots.has(this.sober)) this.shots.set(this.sober, 0);
      this.answers.delete(this.sober);
      this.entries = this.entries.filter(
        (en, k) => k <= this.idx || en.author !== this.sober,
      );
      if (
        this.entry?.author === this.sober &&
        (this.phase === "read" ||
          this.phase === "verdict" ||
          this.phase === "rate")
      ) {
        this.nextEntry();
        return;
      }
    }
    if (
      this.entry?.author === id &&
      (this.phase === "read" ||
        this.phase === "verdict" ||
        this.phase === "rate")
    ) {
      this.nextEntry();
      return;
    }
    if (this.phase === "write" && this.allWritten()) this.endWrite();
    this.host.refresh();
    this.host.changed();
  }

  viewFor(id: string): PhoneView {
    const soberName = this.name(this.sober);
    const me = id === this.sober;
    const e = this.entry;
    const base = {
      v: "ask" as const,
      game: "kuba" as const,
      key: this.key,
      note: `Round ${this.round}/${this.rounds.length} · ${ROUND_INFO[this.kind].title}`,
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

    switch (this.phase) {
      case "title":
        return me
          ? view(
              `You're the sober one 😐`,
              none("Keep a straight face. Every laugh is a shot!", "sleep"),
            )
          : view(
              ROUND_INFO[this.kind].title,
              none(fill(ROUND_INFO[this.kind].line, soberName), "happy"),
            );
      case "write": {
        if (me)
          return view(
            "Poker face time 😐",
            none("They are writing jokes about you. Stay strong.", "sleep"),
            { endsAt: this.endsAt },
          );
        const prompt = this.prompts.get(id) ?? "";
        const done = this.answers.get(id);
        if (this.kind === "draw")
          return view(
            prompt,
            { k: "draw", prompt, sent: !!done },
            { endsAt: this.endsAt },
          );
        return view(
          prompt,
          {
            k: "text",
            placeholder: "Your joke…",
            max: KB_MAX,
            sent: done?.text ?? null,
            auto: "🎲 Dad joke for me",
            button: "Send it",
          },
          { endsAt: this.endsAt, text: `Make ${soberName} laugh` },
        );
      }
      case "read":
        if (e?.author === id)
          return view(
            "📣 Read it out loud!",
            none(e.style.charAt(0).toUpperCase() + e.style.slice(1), "wow"),
            {
              accent: "#ffd23f",
              text: e.text ?? "Explain your drawing",
              endsAt: this.endsAt,
            },
          );
        if (me)
          return view(
            "Poker face! 😐",
            none("Don't laugh. Don't laugh. Don't laugh.", "sleep"),
            { endsAt: this.endsAt },
          );
        return view(
          `Watch ${soberName}'s face 👀`,
          none("Listen, and look for a smile", "happy"),
          { endsAt: this.endsAt },
        );
      case "verdict":
        if (e?.author === id)
          return view(
            `Did ${soberName} crack?`,
            none("Fingers crossed 🤞", "wow"),
            { endsAt: this.endsAt },
          );
        if (me)
          return view(
            "Did you laugh? Be honest…",
            {
              k: "choice",
              options: [
                { label: "😂 I laughed", color: "#ff7a2f" },
                { label: "😐 Not even a smile", color: "#5b6b8a" },
              ],
              picked: this.laughed === null ? null : this.laughed ? 0 : 1,
            },
            {
              endsAt: this.endsAt,
              text: "If they saw you crack, you drink anyway",
            },
          );
        return view(
          `Did ${soberName} crack?`,
          {
            k: "choice",
            options: [
              { label: "😂 Cracked!", color: "#ff7a2f" },
              { label: "😐 Poker face", color: "#5b6b8a" },
            ],
            picked: this.votes.has(id) ? (this.votes.get(id) ? 0 : 1) : null,
          },
          { endsAt: this.endsAt },
        );
      case "rate":
        if (e?.author === id)
          return view("They are rating your joke…", none("🤞", "wow"), {
            endsAt: this.endsAt,
          });
        return view(
          "How funny was it?",
          {
            k: "choice",
            grid: true,
            options: RATE_FACES.map((f, k) => ({
              label: `${f} ${k + 1}`,
              sub: k === 0 ? "no haha" : "ha".repeat(k + 1),
            })),
            picked: this.ratings.has(id) ? this.ratings.get(id)! - 1 : null,
          },
          { endsAt: this.endsAt },
        );
      case "reveal": {
        const r = this.result!;
        const shot = isShot(r.outcome);
        if (me)
          return view(
            r.outcome === "liar"
              ? "Caught lying! 🤥"
              : shot
                ? "Drink! 🥃"
                : "Survived 😐",
            none(
              shot ? "Take your shot!" : "Poker face held",
              shot ? "dead" : "happy",
              !shot,
            ),
          );
        if (e?.author === id)
          return view(
            shot ? `You got ${soberName}! 🥃` : "Tough crowd 😐",
            none(`+${r.authorPts}`, shot ? "wow" : "sleep", shot),
          );
        const v = this.votes.get(id);
        const right = v !== undefined && v === crackedIn(r.outcome);
        return view(
          shot ? "Shot! 🥃" : "No shot",
          none(
            v === undefined ? "" : right ? "You called it! +75" : "Wrong call",
            right ? "wow" : "happy",
            right,
          ),
        );
      }
      case "scores":
      case "end":
        return view(
          this.phase === "end" ? "Game over!" : "Scores",
          none(`${this.scores[id] ?? 0} points`, "happy"),
        );
    }
  }

  // ---- TV ---------------------------------------------------------------------

  render() {
    const soberName = this.name(this.sober);
    const shots = this.shots.get(this.sober) ?? 0;
    const lvl = drunkLevel(shots);
    const e = this.entry;
    const r = this.result;
    const showShot = this.phase === "reveal" && r && isShot(r.outcome);
    return (
      <div class="kb">
        <div class="kb-side">
          <div class="kb-sober-label">The sober one</div>
          <div class="kb-sober-name" style={{ color: this.color(this.sober) }}>
            {soberName}
          </div>
          <div
            class={`kb-kuba lvl${lvl.level} ${showShot ? "drinking" : ""}`}
            key={`k${this.sober}`}
          >
            <Pierogi
              color={this.color(this.sober)}
              size={260}
              mood={lvl.level >= 5 ? "sleep" : showShot ? "wow" : "happy"}
            />
            {lvl.level >= 1 && <span class="kb-blush l" />}
            {lvl.level >= 1 && <span class="kb-blush r" />}
            {lvl.level >= 2 && <span class="kb-hic">hic!</span>}
            {lvl.level >= 4 && <span class="kb-notes">♪ ♫</span>}
            {showShot && <span class="kb-shot-pop">🥃</span>}
          </div>
          <div class="kb-level">
            {lvl.emoji} {lvl.label}
          </div>
          <div class="kb-glasses">
            {Array.from({ length: Math.max(6, shots) }, (_, k) => (
              <ShotGlass key={k} full={k >= shots} />
            ))}
          </div>
          <div class="kb-shots">
            {shots} shot{shots === 1 ? "" : "s"}
          </div>
        </div>
        <div class="kb-main">
          <div class="kb-note">
            Round {this.round} of {this.rounds.length} ·{" "}
            {ROUND_INFO[this.kind].title}
          </div>
          {this.phase === "title" && (
            <div class="kb-card kb-title pop-in" key={`t${this.round}`}>
              <div class="kb-big">{ROUND_INFO[this.kind].title}</div>
              <div class="kb-line">
                {fill(ROUND_INFO[this.kind].line, soberName)}
              </div>
              <div class="kb-line small">
                Everyone writes one. Then you read yours out loud, in a voice
                the game picks for you. 🎭
              </div>
            </div>
          )}
          {this.phase === "write" && (
            <div class="kb-card" key="w">
              <div class="kb-big">
                {this.kind === "draw"
                  ? "Draw on your phone!"
                  : "Write on your phone!"}
              </div>
              <div class="kb-line">{`${soberName}, poker face on. They're coming for you.`}</div>
              <div class="kb-chips">
                {this.writers().map((id) => (
                  <span
                    class={`kb-chip ${this.answers.has(id) ? "done" : ""}`}
                    style={{ "--pc": this.color(id) }}
                    key={id}
                  >
                    <Pierogi
                      color={this.color(id)}
                      size={34}
                      mood={this.answers.has(id) ? "wow" : "happy"}
                    />
                    {this.name(id)} {this.answers.has(id) ? "✓" : "…"}
                  </span>
                ))}
              </div>
            </div>
          )}
          {e &&
            (this.phase === "read" ||
              this.phase === "verdict" ||
              this.phase === "rate" ||
              this.phase === "reveal") && (
              <div class="kb-card kb-joke" key={`e${this.round}-${this.idx}`}>
                <div class="kb-prompt">{e.prompt}</div>
                {e.strokes ? (
                  <div class="kb-pic">
                    <Doodle
                      strokes={e.strokes}
                      animate={this.phase === "read"}
                      seconds={4}
                    />
                  </div>
                ) : (
                  <div
                    class={`kb-text ${(e.text?.length ?? 0) > 90 ? "long" : ""}`}
                  >
                    “{e.text}”
                  </div>
                )}
                <div class="kb-reader" style={{ "--pc": this.color(e.author) }}>
                  <Pierogi color={this.color(e.author)} size={44} mood="wow" />
                  <span>
                    <b>{this.name(e.author)}</b>{" "}
                    {e.strokes ? "explains it" : "reads it"} <i>{e.style}</i>
                    {e.auto ? " (a dad joke picked for them 🎲)" : ""}
                  </span>
                </div>
                {this.phase === "verdict" && (
                  <div class="kb-ask">
                    <span>
                      {soberName}: did you laugh?{" "}
                      {this.laughed !== null ? "✓" : "…"}
                    </span>
                    <span>
                      Everyone else: did {soberName} crack? {this.votes.size}/
                      {this.voters().length}
                    </span>
                  </div>
                )}
                {this.phase === "rate" && (
                  <div class="kb-ask">
                    <span>
                      Rate it 1 to 5 haha · {this.ratings.size}/
                      {this.raters().length}
                    </span>
                  </div>
                )}
                {this.phase === "reveal" && r && (
                  <Reveal
                    r={r}
                    sober={soberName}
                    author={this.name(e.author)}
                  />
                )}
              </div>
            )}
          {this.phase === "scores" && (
            <div class="kb-card kb-scores" key="s">
              <div class="kb-big">After round {this.round}</div>
              <Leaderboard
                rows={this.live().map((id) => ({
                  id,
                  name: this.name(id),
                  color: this.host.player(id)!.color,
                  score: this.scores[id] ?? 0,
                  delta: this.roundPts[id],
                }))}
              />
            </div>
          )}
          {this.phase === "end" && this.endCard()}
          {(this.phase === "write" ||
            this.phase === "read" ||
            this.phase === "verdict" ||
            this.phase === "rate") && (
            <div class="kb-timer">
              <TimerRing
                key={`t${this.key}`}
                endsAt={this.endsAt}
                total={this.total}
                size={110}
                onTick={(s) =>
                  s <= 3 && s > 0 && this.phase !== "read" && sound.tick()
                }
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  private endCard() {
    const list = [...this.shots.entries()].filter(([id]) =>
      this.host.player(id),
    );
    return (
      <div class="kb-card kb-end pop-in" key="end">
        <div class="kb-big">
          {list.length === 1
            ? `${this.name(list[0][0])} drank ${list[0][1]} shot${list[0][1] === 1 ? "" : "s"}!`
            : "Who got drunk?"}
        </div>
        {list.length > 1 && (
          <div class="kb-chips">
            {list.map(([id, n]) => (
              <span
                class="kb-chip done"
                style={{ "--pc": this.color(id) }}
                key={id}
              >
                {this.name(id)}: {n} 🥃 · {drunkLevel(n).label}
              </span>
            ))}
          </div>
        )}
        {list.length === 1 && (
          <div class="kb-line">{`${drunkLevel(list[0][1]).emoji} ${drunkLevel(list[0][1]).label}`}</div>
        )}
        {this.best && (
          <div class="kb-best">
            <div class="kb-line small">
              😂 Joke of the night, by {this.name(this.best.author)}
            </div>
            <div class="kb-text">“{this.best.text}”</div>
          </div>
        )}
      </div>
    );
  }
}

function Reveal({
  r,
  sober,
  author,
}: {
  r: Result;
  sober: string;
  author: string;
}) {
  const big = {
    admit: `😂 ${sober} laughed! SHOT! 🥃`,
    pity: `🙄 A pity laugh… still a shot! 🥃`,
    liar: `🤥 LIAR! We all saw it. Drink! 🥃`,
    poker: `😐 Poker face. No shot.`,
  }[r.outcome];
  return (
    <div class={`kb-reveal pop-in ${isShot(r.outcome) ? "shot" : "held"}`}>
      <div class="kb-reveal-big">{big}</div>
      <div class="kb-reveal-row">
        <span>
          {r.cracked} of {r.cracked + r.held} saw {sober} crack
        </span>
        <span>
          {RATE_FACES[Math.max(0, Math.min(4, Math.round(r.avg) - 1))]}{" "}
          {r.avg ? r.avg.toFixed(1) : "–"} haha
        </span>
        <span>
          {author} +{r.authorPts}
        </span>
      </div>
    </div>
  );
}

function ShotGlass({ full }: { full: boolean }) {
  return (
    <svg
      class={`kb-glass ${full ? "full" : "empty"}`}
      width="34"
      height="44"
      viewBox="0 0 34 44"
      aria-hidden="true"
    >
      <path
        d="M4 4 H30 L26 40 H8 Z"
        fill="rgba(255,255,255,.12)"
        stroke="#fff4dc"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      {full && <path d="M7 14 H27 L25 38 H9 Z" fill="#f3e9c6" opacity=".9" />}
    </svg>
  );
}
