import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import {
  BAJA_ROUNDS,
  BAJA_ROUNDS_SHORT,
  BAJA_TRIES,
  BUILD_MS,
  Craving,
  MIND_AFTER_TRY,
  MIND_FROM_ROUND,
  ROWS,
  changeMind,
  makeCraving,
  makeHint,
  mulberry32,
  plateEmoji,
  reactionFor,
  reactionText,
  rowsFor,
  type Rng,
  type Tasting,
} from './logic';
import { Baja, BajaRun, Offering, type Mood } from './art';
import './baja.css';

const INTRO_MS = 6000;
const MIND_MS = 4000;
const REVEAL_MS = 8000;
/** Plates sent right at the deadline get this long to arrive. */
const LATE_MS = 500;
/** Each plate: she sniffs, then reacts. A plate she loves gets zoomies. */
const SNIFF_MS = 1000;
const REACT_MS = 1900;
const EAT_MS = 3600;
const AFTER_MS = 900;

type Phase = 'intro' | 'build' | 'taste' | 'mind' | 'reveal';

function bark(sound_: typeof sound, times = 2) {
  for (let i = 0; i < times; i++) sound_.note(880, 0.07, { type: 'square', vol: 0.07, delay: i * 0.16, slide: 1250 });
}

export class BajaGame implements Game {
  readonly id = 'baja' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'intro';
  c!: Craving;
  hint = { row: 0, opt: 0 };
  endsAt = 0;
  scores: Record<string, number> = {};
  /** The tastings of the current try, in order, and how far the TV has got. */
  tastings: Tasting[] = [];
  tasteIdx = -1;
  tasteStage: 'sniff' | 'react' = 'sniff';
  /** Players whose plate for the current try has been tasted on the TV (their phone may show it). */
  private shown = new Set<string>();
  private rng: Rng;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.rng = mulberry32(seed);
    this.rounds = host.short ? BAJA_ROUNDS_SHORT : BAJA_ROUNDS;
    for (const id of ids) this.scores[id] = 0;
  }

  start() {
    this.nextRound();
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

  private present = (id: string) => !!this.host.player(id)?.connected;

  // ---- Flow -----------------------------------------------------------------------

  private nextRound() {
    this.clear();
    this.round++;
    if (this.round > this.rounds) {
      this.host.finish(this.scores);
      return;
    }
    const craving = makeCraving(rowsFor(this.round, this.rounds), this.rng);
    this.c = new Craving(this.ids, craving);
    this.hint = makeHint(craving, this.rng);
    this.phase = 'intro';
    this.endsAt = Date.now() + INTRO_MS;
    this.shown.clear();
    bark(sound);
    this.at(INTRO_MS, () => this.build());
    this.update();
  }

  private build() {
    this.clear();
    this.phase = 'build';
    this.tastings = [];
    this.tasteIdx = -1;
    this.shown.clear();
    this.endsAt = Date.now() + BUILD_MS;
    sound.reveal();
    this.at(BUILD_MS + LATE_MS, () => this.taste());
    this.update();
  }

  private taste() {
    if (this.phase !== 'build') return;
    this.clear();
    this.phase = 'taste';
    this.tastings = this.c.taste();
    for (const t of this.tastings) if (t.fed) this.scores[t.id] = (this.scores[t.id] ?? 0) + t.pts;
    this.tasteIdx = -1;
    this.update();
    this.nextPlate();
  }

  private nextPlate() {
    this.tasteIdx++;
    const t = this.tastings[this.tasteIdx];
    if (!t) {
      this.at(AFTER_MS, () => this.afterTry());
      this.update();
      return;
    }
    this.tasteStage = 'sniff';
    sound.note(1400, 0.05, { type: 'sine', vol: 0.06 });
    sound.note(1500, 0.05, { type: 'sine', vol: 0.06, delay: 0.15 });
    sound.note(1400, 0.05, { type: 'sine', vol: 0.06, delay: 0.3 });
    this.host.changed();
    this.at(SNIFF_MS, () => {
      this.tasteStage = 'react';
      this.shown.add(t.id);
      const r = reactionFor(t.hits, this.c.rows);
      if (r === 'eat') {
        sound.correct();
        bark(sound, 3);
        this.host.buzz(t.id, [80, 60, 80, 60, 200]);
      } else if (r === 'snub') sound.wrong();
      else if (r === 'lick') sound.plop();
      else {
        sound.note(300, 0.12, { type: 'triangle', vol: 0.1 });
        sound.note(300, 0.12, { type: 'triangle', vol: 0.1, delay: 0.25 });
        sound.note(700, 0.18, { type: 'sawtooth', vol: 0.07, delay: 0.6, slide: 200 });
      }
      this.update();
      this.at(r === 'eat' ? EAT_MS : REACT_MS, () => this.nextPlate());
    });
  }

  private afterTry() {
    const tried = this.c.tryN;
    this.c.nextTry();
    if (this.c.over) {
      this.reveal();
      return;
    }
    if (this.round >= MIND_FROM_ROUND && tried === MIND_AFTER_TRY) {
      const m = changeMind(this.c.craving, this.rng);
      this.c.setCraving(m.craving, m.row);
      this.phase = 'mind';
      this.endsAt = Date.now() + MIND_MS;
      sound.whoosh();
      bark(sound, 1);
      this.at(MIND_MS, () => this.build());
      this.update();
      return;
    }
    this.build();
  }

  private reveal() {
    this.clear();
    this.phase = 'reveal';
    this.endsAt = Date.now() + REVEAL_MS;
    sound.fanfare();
    this.at(REVEAL_MS, () => this.nextRound());
    this.update();
  }

  // ---- Phones ---------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'feed' || this.phase !== 'build') return;
    if (m.round !== this.round || m.tryN !== this.c.tryN) return;
    if (!this.c.submit(id, m.plate)) return;
    sound.lockIn();
    this.host.refresh(id);
    this.host.changed();
    if (this.c.allIn(this.present)) {
      this.clear();
      this.at(600, () => this.taste());
    }
  }

  onConnection() {
    if (this.phase === 'build' && this.c.plates.size > 0 && this.c.allIn(this.present)) {
      this.clear();
      this.at(600, () => this.taste());
    }
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    this.c?.remove(id);
    if (this.ids.length === 0) {
      this.clear();
      this.host.finish({});
      return;
    }
    if (this.phase === 'build' && this.c.activeIds().length === 0) {
      this.clear();
      this.at(300, () => this.taste());
    }
    this.onConnection();
  }

  viewFor(id: string): PhoneView {
    const c = this.c;
    const hist = (c.history.get(id) ?? []).slice();
    // Don't spoil the TV: this try's result shows on the phone once Baja has tasted that plate.
    if (this.phase === 'taste' && !this.shown.has(id) && hist.length >= c.tryN) hist.pop();
    const fedOn = c.fedOn.get(id) ?? null;
    return {
      v: 'baja',
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      tryN: Math.min(c.tryN, BAJA_TRIES),
      tries: BAJA_TRIES,
      rows: c.rows,
      endsAt: this.endsAt,
      hint: this.hint,
      changed: c.changed.slice(),
      sent: c.plates.get(id) ?? null,
      history: hist,
      fed: fedOn !== null && (this.phase !== 'taste' || this.shown.has(id) || fedOn < c.tryN) ? fedOn : null,
      pts: this.phase === 'reveal' ? (c.pts.get(id) ?? 0) : 0,
      total: this.scores[id] ?? 0,
      answer: this.phase === 'reveal' ? c.craving.slice() : null,
    };
  }

  // ---- TV -------------------------------------------------------------------------

  private mood(): Mood {
    if (this.phase === 'taste') {
      const t = this.tastings[this.tasteIdx];
      if (!t) return 'idle';
      return this.tasteStage === 'sniff' ? 'sniff' : reactionFor(t.hits, this.c.rows);
    }
    if (this.phase === 'reveal') return this.c.fedOn.size > 0 ? 'eat' : 'snub';
    if (this.phase === 'mind') return 'snub';
    return 'idle';
  }

  private bubble(): string | null {
    const h = ROWS[this.hint.row].options[this.hint.opt];
    switch (this.phase) {
      case 'intro':
        return `I'm hungry! But not ${h.emoji} ${h.label.toLowerCase()}. Never ${h.emoji}.`;
      case 'build':
        return this.c.tryN === 1 ? 'Guess what I want…' : 'Still hungry…';
      case 'taste': {
        const t = this.tastings[this.tasteIdx];
        if (!t) return this.tastings.length ? null : 'Nobody fed me?!';
        return this.tasteStage === 'sniff' ? '*sniff sniff*' : reactionText(reactionFor(t.hits, this.c.rows));
      }
      case 'mind': {
        const row = this.c.changed[this.c.changed.length - 1];
        return `Hmm… I changed my mind about ${ROWS[row].title.toLowerCase()}!`;
      }
      case 'reveal':
        return this.c.fedOn.size > 0 ? 'Best. Dinner. Ever.' : 'Nobody got it. I’m starving!';
    }
  }

  render() {
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
    const t = this.phase === 'taste' ? this.tastings[this.tasteIdx] : undefined;
    const mood = this.mood();
    const bubble = this.bubble();
    const taster = t ? this.host.player(t.id) : undefined;
    const zoom = mood === 'eat' && this.phase === 'taste';
    const extra = this.c.rows === 4;

    return (
      <div class="screen baja-screen">
        <div class="baja-sofa" />
        <div class="baja-top">
          <div class="pill">
            Craving {this.round} / {this.rounds}
          </div>
          {this.phase !== 'intro' && this.phase !== 'reveal' && <div class="pill">Try {Math.min(this.c.tryN, BAJA_TRIES)} / {BAJA_TRIES}</div>}
          {extra && <div class="pill pill-cat">Extra picky: trick first!</div>}
          <div class="grow" />
          {this.phase === 'build' && (
            <TimerRing key={`b${this.round}-${this.c.tryN}`} endsAt={this.endsAt} total={BUILD_MS} size={110} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />
          )}
        </div>

        <div class="baja-stage">
          <div class={`baja-wrap mood-${mood}`} key={`${this.phase}-${this.tasteIdx}-${this.tasteStage}`}>
            <Baja mood={mood} size={640} />
          </div>
          {bubble && (
            <div class="baja-bubble pop-in" key={`b-${this.phase}-${this.tasteIdx}-${this.tasteStage}`}>
              {bubble}
            </div>
          )}
          {this.phase === 'intro' && <div class="baja-title pop-in">Baja is hungry!</div>}
          {t && (
            <div class="baja-plate" key={`p${this.tasteIdx}`}>
              {taster && (
                <div class="baja-plate-who" style={{ '--pc': colorHex(taster.color) }}>
                  <Pierogi color={colorHex(taster.color)} size={46} mood={this.tasteStage === 'react' ? (t.fed ? 'wow' : 'dead') : 'happy'} />
                  {taster.name}’s plate
                </div>
              )}
              <Offering plate={t.plate} size={1.25} />
              {this.tasteStage === 'react' && <Paws hits={t.hits} rows={this.c.rows} big />}
            </div>
          )}
          {this.phase === 'reveal' && (
            <div class="baja-answer pop-in">
              <small>Baja wanted</small>
              <Offering plate={this.c.craving} size={1.1} />
              <div class="baja-answer-text">
                {this.c.craving.map((v, i) => (
                  <span>
                    {ROWS[i].options[v].emoji} {ROWS[i].options[v].label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {zoom && (
            <div class="baja-zoomies">
              <BajaRun size={300} />
            </div>
          )}
          {zoom && (
            <div class="baja-hearts">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span style={{ '--i': i }}>❤️</span>
              ))}
            </div>
          )}
        </div>

        {this.phase === 'intro' && (
          <div class="baja-how pop-in">
            <b>Build a plate on your phone</b>
            <span>
              {ROWS.slice(0, this.c.rows)
                .map((r) => r.title)
                .join(' + ')}
            </span>
            <span class="baja-legend">
              <i>😤 0 right</i> <i>👅 1</i> <i>💦 {extra ? '2–3' : '2'}</i> <i>😍 all!</i>
            </span>
          </div>
        )}

        <div class="baja-board">
          {players.map((p) => {
            const hist = this.c.history.get(p.id) ?? [];
            const fedOn = this.c.fedOn.get(p.id);
            const fedShown = fedOn !== undefined && (this.phase !== 'taste' || this.shown.has(p.id) || fedOn < this.c.tryN);
            const pts = this.c.pts.get(p.id) ?? 0;
            const tasting = t?.id === p.id;
            const ready = this.phase === 'build' && this.c.plates.has(p.id);
            return (
              <div class={`baja-row ${fedShown ? 'fed' : ''} ${tasting ? 'tasting' : ''} ${p.connected ? '' : 'offline'}`} style={{ '--pc': colorHex(p.color) }}>
                <div class="baja-who">
                  <Pierogi color={colorHex(p.color)} size={48} mood={fedShown ? 'wow' : ready ? 'happy' : 'sleep'} />
                  <span class="baja-name">{p.name}</span>
                  <b class="baja-score">{(this.scores[p.id] ?? 0).toLocaleString('en-US')}</b>
                </div>
                <div class="baja-tries">
                  {Array.from({ length: BAJA_TRIES }, (_, k) => {
                    const h = hist[k];
                    // Hide this try's result until Baja has tasted that plate.
                    const hidden = this.phase === 'taste' && k === this.c.tryN - 1 && !this.shown.has(p.id);
                    if (h && !hidden) {
                      const shift = this.c.changed.length > 0 && k < MIND_AFTER_TRY && this.round >= MIND_FROM_ROUND;
                      return (
                        <div class={`baja-try ${h.plate ? '' : 'empty'} ${shift ? 'stale' : ''} ${h.hits === this.c.rows ? 'win' : ''}`}>
                          {h.plate ? (
                            <>
                              <span class="baja-try-emoji">{plateEmoji(h.plate).join('')}</span>
                              <Paws hits={h.hits} rows={this.c.rows} />
                            </>
                          ) : (
                            <span class="baja-try-emoji">💤</span>
                          )}
                        </div>
                      );
                    }
                    if (k === this.c.tryN - 1 && this.phase === 'build' && !fedShown) return <div class={`baja-try next ${ready ? 'ready' : ''}`}>{ready ? '🍽️' : '…'}</div>;
                    return <div class="baja-try blank" />;
                  })}
                </div>
                {fedShown && <div class="baja-gain">+{pts}</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}

/** How many rows she liked: filled paws out of `rows`. */
export function Paws({ hits, rows, big }: { hits: number; rows: number; big?: boolean }) {
  return (
    <span class={`baja-paws ${big ? 'big' : ''}`}>
      {Array.from({ length: rows }, (_, i) => (
        <i class={i < hits ? 'on' : ''}>🐾</i>
      ))}
    </span>
  );
}
