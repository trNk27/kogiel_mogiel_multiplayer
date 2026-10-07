import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import {
  SWAP_CLOSED_AT,
  SWAP_CURTAIN_MS,
  SWAP_ITEMS,
  SWAP_PICK_MS,
  SWAP_ROUNDS,
  SWAP_ROUNDS_SHORT,
  SWAP_SLOTS,
  makeRound,
  swapPoints,
  type SwapItem,
  type SwapRound,
} from './logic';
import { TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

const RESULT_MS = 7000;
/** Picks sent right at the deadline get this long to arrive. */
const LATE_MS = 400;

type Phase = 'look' | 'curtain' | 'pick' | 'result';

export class SwapGame implements Game {
  readonly id = 'swap' as const;
  private readonly rounds: number;
  private round = 0;
  private phase: Phase = 'look';
  private r!: SwapRound;
  /** The curtain is closed and the swap has happened. */
  private swapped = false;
  private endsAt = 0;
  private pickStart = 0;
  private picks = new Map<string, { i: number; at: number }>();
  private roundPts: Record<string, number> = {};
  private scores: Record<string, number> = {};
  private fresh = new Set(SWAP_ITEMS.map((x) => x.id));
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? SWAP_ROUNDS_SHORT : SWAP_ROUNDS;
    for (const id of ids) this.scores[id] = 0;
    // Warm the TV's image cache so the shelves don't pop in.
    for (const it of SWAP_ITEMS) new Image().src = it.src;
  }

  start() {
    this.next();
  }

  dispose() {
    this.clear();
  }

  private clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private at(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private next() {
    this.clear();
    this.round++;
    if (this.round > this.rounds) {
      this.host.finish(this.scores);
      return;
    }
    this.r = makeRound(this.round - 1, this.rounds, Math.random, this.fresh);
    this.phase = 'look';
    this.swapped = false;
    this.picks.clear();
    this.roundPts = {};
    this.endsAt = Date.now() + this.r.lookMs;
    sound.reveal();
    this.at(this.r.lookMs, () => this.curtain());
    this.update();
  }

  private curtain() {
    this.phase = 'curtain';
    this.endsAt = Date.now() + SWAP_CURTAIN_MS;
    sound.whoosh();
    this.at(SWAP_CLOSED_AT, () => {
      this.swapped = true;
      sound.tick();
      this.host.changed();
    });
    this.at(SWAP_CURTAIN_MS, () => {
      this.phase = 'pick';
      this.pickStart = Date.now();
      this.endsAt = this.pickStart + SWAP_PICK_MS;
      sound.whoosh();
      this.at(SWAP_PICK_MS + LATE_MS, () => this.reveal());
      this.update();
    });
    this.update();
  }

  private reveal() {
    if (this.phase !== 'pick') return;
    this.clear();
    this.phase = 'result';
    let anyone = false;
    for (const id of this.ids) {
      const p = this.picks.get(id);
      const pts = p ? swapPoints(p.i === this.r.answer, p.at - this.pickStart) : 0;
      this.roundPts[id] = pts;
      this.scores[id] = (this.scores[id] ?? 0) + pts;
      if (pts > 0) {
        anyone = true;
        this.host.buzz(id, [60, 60, 60]);
      }
    }
    window.setTimeout(() => (anyone ? sound.correct() : sound.wrong()), 300);
    this.at(RESULT_MS, () => this.next());
    this.update();
  }

  private allPicked() {
    return this.ids.every((id) => this.picks.has(id) || !this.host.player(id)?.connected);
  }

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'pick' || this.phase !== 'pick' || this.picks.has(id)) return;
    if (!Number.isInteger(m.i) || m.i < 0 || m.i >= SWAP_SLOTS) return;
    this.picks.set(id, { i: m.i, at: Date.now() });
    sound.lockIn();
    this.host.refresh(id);
    this.host.changed();
    if (this.allPicked()) {
      this.clear();
      this.at(700, () => this.reveal());
    }
  }

  onConnection() {
    if (this.phase === 'pick' && this.picks.size > 0 && this.allPicked()) {
      this.clear();
      this.at(700, () => this.reveal());
    }
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    this.picks.delete(id);
    if (this.ids.length === 0) this.host.finish({});
    else this.onConnection();
  }

  viewFor(id: string): PhoneView {
    const p = this.picks.get(id);
    const showing = this.phase === 'pick' || this.phase === 'result';
    const added = this.r.after[this.r.answer];
    return {
      v: 'swap',
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      endsAt: this.endsAt,
      items: showing ? this.r.after.map((x) => x.src) : null,
      picked: p?.i ?? null,
      res:
        this.phase === 'result'
          ? {
              correct: p?.i === this.r.answer,
              answer: this.r.answer,
              added: added.name,
              removed: this.r.removed.name,
              removedSrc: this.r.removed.src,
              pts: this.roundPts[id] ?? 0,
              total: this.scores[id] ?? 0,
            }
          : null,
    };
  }

  // ---- TV -------------------------------------------------------------------------

  render() {
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
    const items: SwapItem[] = this.phase === 'look' || (this.phase === 'curtain' && !this.swapped) ? this.r.before : this.r.after;
    const result = this.phase === 'result';
    const hint =
      this.phase === 'look'
        ? this.round === 1
          ? 'Remember everything on the shelves!'
          : this.r.shuffled
            ? 'Remember them – they’ll be moved around too!'
            : 'Remember everything on the shelves!'
        : this.phase === 'curtain'
          ? 'Something’s being swapped…'
          : this.phase === 'pick'
            ? 'Which one is new? Tap it on your phone!'
            : '';

    return (
      <div class="screen swap" key={`r${this.round}`}>
        <div class="quiz-top">
          <div class="pill">
            Round {this.round} / {this.rounds}
          </div>
          {this.r.lookalike && this.phase !== 'look' && <div class="pill pill-cat">Sneaky swap!</div>}
          {result ? (
            <div class="swap-reveal pop-in">
              <img src={this.r.removed.src} alt="" class="swap-reveal-old" />
              <span class="swap-arrow">→</span>
              <img src={this.r.after[this.r.answer].src} alt="" />
              <span class="swap-reveal-text">
                <b>{this.r.removed.name}</b> became <b>{this.r.after[this.r.answer].name}</b>
              </span>
            </div>
          ) : (
            <div class="swap-hint">{hint}</div>
          )}
          <div class="grow" />
          {result && (
            <div class="swap-reveal-scores">
              {players.map((p) => (
                <span class={(this.roundPts[p.id] ?? 0) > 0 ? 'gain' : ''} style={{ '--pc': colorHex(p.color) }}>
                  {p.name} <b>{(this.roundPts[p.id] ?? 0) > 0 ? `+${this.roundPts[p.id]}` : '0'}</b>
                </span>
              ))}
            </div>
          )}
          {this.phase === 'look' && <TimerRing key={`l${this.round}`} endsAt={this.endsAt} total={this.r.lookMs} size={110} />}
          {this.phase === 'pick' && (
            <TimerRing key={`p${this.round}`} endsAt={this.endsAt} total={SWAP_PICK_MS} size={110} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />
          )}
        </div>

        <div class="swap-stage">
          <div class="swap-wall" />
          <div class="swap-shelves">
            {[0, 1].map((row) => (
              <div class="swap-shelf">
                {items.slice(row * 4, row * 4 + 4).map((it, k) => {
                  const i = row * 4 + k;
                  const isNew = result && i === this.r.answer;
                  const pickers = result ? players.filter((p) => this.picks.get(p.id)?.i === i) : [];
                  return (
                    <div class={`swap-slot ${isNew ? 'new' : result ? 'old' : ''}`} key={`${it.id}-${i}`} style={{ animationDelay: `${i * 60}ms` }}>
                      <img src={it.src} alt={it.name} draggable={false} />
                      {isNew && <span class="swap-badge">NEW!</span>}
                      {result && (
                        <div class="swap-pickers">
                          {pickers.map((p) => (
                            <Pierogi color={colorHex(p.color)} size={42} mood={isNew ? 'wow' : 'dead'} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div class="swap-plank" />
              </div>
            ))}
          </div>
          <div class="swap-pelmet" />
          {this.phase === 'curtain' && (
            <div class="swap-curtain" key={`c${this.round}`} style={{ animationDuration: `${SWAP_CURTAIN_MS}ms` }}>
              <div class="swap-drape left" style={{ animationDuration: `${SWAP_CURTAIN_MS}ms` }} />
              <div class="swap-drape right" style={{ animationDuration: `${SWAP_CURTAIN_MS}ms` }} />
            </div>
          )}
        </div>

        {this.phase === 'pick' && (
          <div class="swap-status">
            {players.map((p) => (
              <div class={`answer-chip ${this.picks.has(p.id) ? 'done' : ''} ${p.connected ? '' : 'offline'}`}>
                <Pierogi color={colorHex(p.color)} size={52} mood={this.picks.has(p.id) ? 'happy' : 'wow'} />
                <span>{p.name}</span>
              </div>
            ))}
          </div>
        )}

      </div>
    );
  }
}
