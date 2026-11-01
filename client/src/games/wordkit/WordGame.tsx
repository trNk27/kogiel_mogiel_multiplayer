/**
 * The common frame of the newer Jackbox-style games (Ankieta, Pół na Pół, Słownik, Plotki): phases with
 * deadlines, phone keys, scores, the round title card, the writing screen, a grid of entries to vote on,
 * the score strip and the scoreboard. Each game adds its own rules and screens on top.
 *
 * Everything the TV shows lives on the game object (second screens copy it), and timers are only used to
 * move from phase to phase.
 */
import type { ComponentChildren, JSX } from 'preact';
import { colorHex, type AskInput, type AskView, type GameId, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { Leaderboard, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import type { VoteResult } from './logic';
import '../quip/quip.css';
import './wordkit.css';

/** Phones hand in what's typed just before the deadline; give it time to arrive. */
export const GRACE_MS = 1800;
const LETTERS = 'ABCDEFGH';

export type Mood = 'happy' | 'wow' | 'dead' | 'sleep';

/** One entry in a grid to vote on. */
export interface GridEntry {
  author: string;
  text: string;
  /** Written by "🎲 … for me" or because time ran out. */
  auto?: boolean;
  /** Something small above the text (a label, a quote). */
  head?: ComponentChildren;
  /** Something small under the text. */
  foot?: ComponentChildren;
}

export abstract class WordGame<P extends string> implements Game {
  abstract readonly id: GameId;
  /** The game's name, for the title card and the phone's wait screen. */
  protected abstract readonly title: string;
  /** Fewer players than this left: the game ends. */
  protected minLeft = 2;
  protected phase: P;
  protected endsAt = 0;
  /** Bumped on every phase change; phone keys are built from it. */
  protected key = 0;
  protected scores: Record<string, number> = {};
  /** Points per player since the round started (shown as +deltas on the scoreboard). */
  protected roundPoints: Record<string, number> = {};
  private timer: number | undefined;
  /** The phase key `soon` was called in (-1: not waiting). */
  private soonKey = -1;
  private fx: number[] = [];
  private finished = false;

  constructor(
    protected host: GameHost,
    public ids: string[],
    first: P,
  ) {
    this.phase = first;
    for (const id of ids) this.scores[id] = 0;
  }

  abstract start(): void;
  abstract viewFor(id: string): PhoneView;
  abstract render(): JSX.Element;
  abstract onMessage(id: string, m: PhoneMsg): void;

  dispose() {
    clearTimeout(this.timer);
    for (const t of this.fx) clearTimeout(t);
    this.fx = [];
  }

  /** Expose the game as `window[name]` with `?debug`. */
  protected debugAs(name: string) {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>)[name] = this;
  }

  /** The next step, replacing any pending one. */
  protected after(ms: number, fn: () => void) {
    clearTimeout(this.timer);
    this.soonKey = -1;
    this.timer = window.setTimeout(fn, ms);
  }

  /**
   * Move on shortly because everyone's done: like `after`, but only once per phase, so later calls
   * (another answer, a phone reconnecting) don't keep pushing it back.
   */
  protected soon(ms: number, fn: () => void) {
    if (this.soonKey === this.key) return;
    this.after(ms, fn);
    this.soonKey = this.key;
  }

  /** A sound (or other effect) a little later; cleared on dispose. */
  protected later(ms: number, fn: () => void) {
    this.fx.push(window.setTimeout(fn, ms));
    if (this.fx.length > 64) this.fx = this.fx.slice(-64);
  }

  protected update() {
    this.host.refresh();
    this.host.changed();
  }

  protected setPhase(p: P, ms = 0) {
    this.phase = p;
    this.key++;
    this.endsAt = Date.now() + ms;
  }

  protected name(id: string) {
    return this.host.player(id)?.name ?? '?';
  }

  protected color(id: string) {
    return colorHex(this.host.player(id)?.color ?? 'sourcream');
  }

  protected here(id: string) {
    return this.ids.includes(id);
  }

  protected connected(id: string) {
    return !!this.host.player(id)?.connected;
  }

  /** Everybody still here and connected who has to do something has done it. */
  protected allDone(who: readonly string[], has: (id: string) => boolean) {
    const active = who.filter((id) => this.connected(id));
    return active.length > 0 && active.every(has);
  }

  protected addPoints(points: Record<string, number>) {
    for (const [id, pts] of Object.entries(points)) {
      if (!(id in this.scores) || !pts) continue;
      this.scores[id] += pts;
      this.roundPoints[id] = (this.roundPoints[id] ?? 0) + pts;
    }
  }

  /** 1-based place by score. */
  protected place(id: string) {
    return 1 + this.ids.filter((o) => (this.scores[o] ?? 0) > (this.scores[id] ?? 0)).length;
  }

  protected finish() {
    if (this.finished) return;
    this.finished = true;
    this.dispose();
    const out: Record<string, number> = {};
    for (const id of this.ids) out[id] = this.scores[id] ?? 0;
    this.host.finish(out);
  }

  // ---- phones -------------------------------------------------------------------

  /** Check phases and move on if everyone's done (called after every answer and connection change). */
  protected maybeAdvance() {}

  /** Forget what a player who left had going (votes, answers…). */
  protected forget(_id: string) {}

  onConnection() {
    this.maybeAdvance();
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    delete this.roundPoints[id];
    this.forget(id);
    if (this.ids.length < this.minLeft) {
      this.finish();
      return;
    }
    this.onConnection();
  }

  /** The phone key: the phase's key, plus a sub-step (e.g. the 2nd of two prompts). */
  protected keyFor(_id: string): number {
    return this.key * 4;
  }

  /** A line at the top of the phone, e.g. "Round 1 / 2". */
  protected note(): string {
    return '';
  }

  protected ask(id: string, title: string, input: AskInput, extra: Partial<AskView> = {}): AskView {
    return { v: 'ask', game: this.id, key: this.keyFor(id), note: this.note(), title, input, score: this.scores[id] ?? 0, ...extra };
  }

  protected wait(id: string, title: string, text?: string, mood: Mood = 'happy', big?: string, good?: boolean): AskView {
    return this.ask(id, title, { k: 'none', mood, ...(big ? { big } : {}), ...(good !== undefined ? { good } : {}) }, text ? { text } : {});
  }

  /** For someone watching who isn't in the game. */
  protected watch(): PhoneView {
    return { v: 'wait', title: this.title, text: 'Watch the TV!', icon: this.id };
  }

  /** The end-of-round phone line: place and points. */
  protected standing(id: string, last: boolean, next?: string): AskView {
    const place = this.place(id);
    return this.wait(
      id,
      last ? 'That’s the game!' : 'Scores so far',
      `You’re #${place} with ${(this.scores[id] ?? 0).toLocaleString('en-US')} points.${!last && next ? ` ${next}` : ''}`,
      place === 1 ? 'wow' : 'happy',
    );
  }

  // ---- TV -------------------------------------------------------------------------

  protected players() {
    return this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
  }

  /** The bar at the top: a label pill, extras, and a timer ring for `total` ms (or none). */
  protected top(label: string, total: number | null, extra?: ComponentChildren) {
    return (
      <div class="quiz-top">
        <div class="pill">{label}</div>
        {extra}
        <div class="grow" />
        {total !== null && <TimerRing key={`t${this.key}`} endsAt={this.endsAt} total={total} size={130} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />}
      </div>
    );
  }

  /** Everyone's pierogi, name and score along the bottom; `done` ticks them off. */
  protected strip(done?: (id: string) => boolean) {
    return (
      <div class="qp-strip">
        {this.players().map((p) => {
          const ok = done?.(p.id);
          return (
            <div class={`qp-chip ${ok ? 'done' : ''} ${p.connected ? '' : 'offline'}`} style={{ '--pc': colorHex(p.color) }} key={p.id}>
              <Pierogi color={colorHex(p.color)} size={46} mood={!p.connected ? 'sleep' : 'happy'} />
              <span class="qp-chip-name">{p.name}</span>
              <b class="qp-chip-score">{(this.scores[p.id] ?? 0).toLocaleString('en-US')}</b>
              {ok && <i class="qp-chip-tick">✓</i>}
            </div>
          );
        })}
      </div>
    );
  }

  /** A big title card between rounds. */
  protected titleCard(big: string, sub: string, opts: { mult?: number; final?: boolean; who?: string[] } = {}) {
    const who = opts.who ?? this.ids;
    return (
      <div class={`screen qp-title ${opts.final ? 'final' : ''}`} key={`title${this.key}`}>
        <div class="qp-kicker">{this.title}</div>
        <h1 class="qp-big">{big}</h1>
        <p class="qp-sub">{sub}</p>
        {opts.mult && opts.mult > 1 && <div class="qp-mult pop-in">×{opts.mult}</div>}
        <div class="qp-title-row">
          {who.map((id, i) => (
            <Pierogi color={this.color(id)} size={110} mood="wow" class="bob" style={{ animationDelay: `${i * -0.3}s` }} key={id} />
          ))}
        </div>
      </div>
    );
  }

  /** Everyone writing on their phone: a heading, a card, and a chip per player. */
  protected writeScreen(label: string, total: number, head: ComponentChildren, sub: string, done: (id: string) => boolean, status?: (id: string) => string, card?: ComponentChildren) {
    return (
      <div class="screen qp" key={`w${this.key}`}>
        {this.top(label, total, <div class="pill">Write!</div>)}
        {card}
        <h2 class={`qp-head ${card ? 'wk-head-small' : ''}`}>{head}</h2>
        <p class="qp-sub">{sub}</p>
        <div class="qp-chips">
          {this.players().map((p) => {
            const ok = done(p.id);
            return (
              <div class={`answer-chip ${ok ? 'done' : ''} ${p.connected ? '' : 'offline'}`} key={p.id}>
                <Pierogi color={colorHex(p.color)} size={72} mood={!p.connected ? 'sleep' : ok ? 'happy' : 'wow'} class={ok ? '' : 'bob'} />
                <span>{p.name}</span>
                <b>{ok ? 'Done!' : (status?.(p.id) ?? 'Writing…')}</b>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /**
   * A grid of entries to vote on (letters A, B, C…). With `result`, the voters pop onto the entries one
   * after another, then the authors and their points show, and the winners light up.
   */
  protected entryGrid(entries: readonly GridEntry[], result: VoteResult | null, opts: { appear?: boolean } = {}) {
    const cols = entries.length <= 4 ? Math.max(1, entries.length) : Math.ceil(entries.length / 2);
    const startOf: number[] = [];
    if (result) result.voters.reduce((acc, v, i) => ((startOf[i] = acc), acc + v.length), 0);
    const total = result ? result.voters.reduce((s, v) => s + v.length, 0) : 0;
    const authorsAt = authorsDelay(total);
    return (
      <div class={`qp-grid wk-grid n${entries.length} ${result ? 'revealed' : ''}`} style={{ '--cols': cols }}>
        {entries.map((e, i) => {
          const pts = result?.points[e.author] ?? 0;
          const win = result?.winners.includes(i);
          return (
            <div
              class={`qp-entry ${win ? 'win' : ''} ${result && !win ? 'lose' : ''}`}
              style={{ animationDelay: opts.appear ? `${600 + i * 260}ms` : '0ms', '--win-at': `${authorsAt}ms` }}
              key={i}
            >
              <span class="qp-letter">{LETTERS[i]}</span>
              {e.head && <div class="wk-entry-head">{e.head}</div>}
              <span class="qp-entry-text">{e.text}</span>
              {e.foot && <div class="wk-entry-foot">{e.foot}</div>}
              {result && (
                <>
                  <div class="qp-voters small">
                    {result.voters[i].map((v, k) => (
                      <span class="qp-voter" style={{ animationDelay: `${POP_START_MS + (startOf[i] + k) * POP_STEP_MS}ms` }} key={v}>
                        <Pierogi color={this.color(v)} size={40} mood="happy" />
                      </span>
                    ))}
                  </div>
                  <div class="qp-author small" style={{ animationDelay: `${authorsAt}ms`, '--pc': this.color(e.author) }}>
                    <Pierogi color={this.color(e.author)} size={52} mood={pts ? 'wow' : 'dead'} />
                    <span class="qp-author-name">
                      {this.name(e.author)}
                      {!this.here(e.author) && <small> (left)</small>}
                      {e.auto && <small> 🎲</small>}
                    </span>
                    <b class={`qp-pts ${pts ? '' : 'zero'}`}>+{pts.toLocaleString('en-US')}</b>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  /** Play the pops of a vote reveal: a blip per vote, then a fanfare (or a sad note if nobody voted). */
  protected revealSounds(result: VoteResult) {
    const n = result.voters.reduce((s, v) => s + v.length, 0);
    for (let k = 0; k < n; k++) this.later(POP_START_MS + k * POP_STEP_MS, () => sound.note(480 + (k % 8) * 50, 0.08, { type: 'sine', vol: 0.12, slide: 250 }));
    this.later(authorsDelay(n), () => (n ? sound.reveal() : sound.wrong()));
    return revealMs(n);
  }

  /** Choice options for voting on a grid: your own is greyed out. */
  protected voteOptions(id: string, entries: readonly GridEntry[]) {
    return entries.map((e, i) => ({ label: `${LETTERS[i]}  ${e.text}`, sub: e.author === id ? 'Yours' : undefined, off: e.author === id }));
  }

  /** The scoreboard between rounds and at the end. */
  protected scoresScreen(title: string) {
    const players = this.players();
    return (
      <div class="screen bp-scores qp-scores" key={`s${this.key}`}>
        <h2 class="screen-title">{title}</h2>
        <Leaderboard rows={players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: this.scores[p.id] ?? 0, delta: this.roundPoints[p.id] }))} />
      </div>
    );
  }
}

/** On a vote reveal: when voter pierogi start popping onto the entries, and how far apart. */
export const POP_START_MS = 700;
export const POP_STEP_MS = 260;
export function authorsDelay(votes: number) {
  return POP_START_MS + votes * POP_STEP_MS + 800;
}
/** How long a vote reveal stays up. */
export function revealMs(votes: number) {
  return authorsDelay(votes) + 4500;
}
