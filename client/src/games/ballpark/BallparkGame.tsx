import questions from '../../../../data/ballpark.json';
import { colorHex, type BetSlot, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { usedSet } from '../usedStore';
import { pickQuestions } from '../quiz/logic';
import {
  BP_BET_MS,
  BP_GUESS_MS,
  BP_QUESTIONS_PER_GAME,
  buildSlots,
  formatNumber,
  scoreBallpark,
  winningSlot,
  type BallparkQuestion,
  type Guess,
  type RoundScore,
} from './logic';
import { Leaderboard, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

const REVEAL_MS = 9000;
const SCORES_MS = 5500;
const used = usedSet('ballpark');

type Phase = 'guess' | 'bet' | 'reveal' | 'scores';

export function withUnit(n: number, unit: string) {
  const num = formatNumber(n, unit);
  return unit && unit !== 'year' ? `${num} ${unit}` : num;
}

export class BallparkGame implements Game {
  readonly id = 'ballpark' as const;
  private questions: BallparkQuestion[];
  private index = -1;
  private phase: Phase = 'guess';
  private endsAt = 0;
  private guesses = new Map<string, number>();
  private bets = new Map<string, number>();
  private slots: BetSlot[] = [];
  private result: Record<string, RoundScore> = {};
  private scores: Record<string, number> = {};
  private timer: number | undefined;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.questions = pickQuestions(questions as BallparkQuestion[], used, BP_QUESTIONS_PER_GAME);
    for (const id of ids) this.scores[id] = 0;
  }

  private get q() {
    return this.questions[this.index];
  }

  start() {
    this.next();
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private after(ms: number, fn: () => void) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(fn, ms);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private next() {
    this.index++;
    if (this.index >= this.questions.length) {
      this.host.finish(this.scores);
      return;
    }
    this.phase = 'guess';
    this.guesses.clear();
    this.bets.clear();
    this.slots = [];
    this.result = {};
    this.endsAt = Date.now() + BP_GUESS_MS;
    sound.reveal();
    this.after(BP_GUESS_MS, () => this.toBetting());
    this.update();
  }

  private toBetting() {
    if (this.phase !== 'guess') return;
    const guesses: Guess[] = [...this.guesses].map(([id, value]) => ({ id, value, name: this.host.player(id)?.name ?? '?' }));
    if (guesses.length === 0) {
      this.slots = buildSlots([]);
      this.toReveal();
      return;
    }
    this.slots = buildSlots(guesses);
    this.phase = 'bet';
    this.endsAt = Date.now() + BP_BET_MS;
    sound.whoosh();
    this.after(BP_BET_MS, () => this.toReveal());
    this.update();
  }

  private toReveal() {
    if (this.phase === 'reveal' || this.phase === 'scores') return;
    this.phase = 'reveal';
    const guesses: Guess[] = [...this.guesses].map(([id, value]) => ({ id, value, name: '' }));
    this.result = scoreBallpark(this.ids, guesses, Object.fromEntries(this.bets), this.slots, this.q.answer);
    let anyone = false;
    for (const id of this.ids) {
      const r = this.result[id];
      this.scores[id] = (this.scores[id] ?? 0) + r.points;
      if (r.points > 0) {
        anyone = true;
        this.host.buzz(id, [60, 60, 60]);
      }
    }
    window.setTimeout(() => (anyone ? sound.correct() : sound.wrong()), 1200);
    sound.reveal();
    this.after(REVEAL_MS, () => {
      this.phase = 'scores';
      sound.whoosh();
      this.after(SCORES_MS, () => this.next());
      this.host.changed();
    });
    this.update();
  }

  private allDone(map: Map<string, number>) {
    return this.ids.every((id) => map.has(id) || !this.host.player(id)?.connected);
  }

  onMessage(id: string, m: PhoneMsg) {
    if (m.t === 'guess' && this.phase === 'guess' && !this.guesses.has(id)) {
      const v = Number(m.value);
      if (!Number.isFinite(v) || Math.abs(v) > 1e12) return;
      this.guesses.set(id, Math.round(v * 1000) / 1000);
      sound.lockIn();
      this.host.refresh(id);
      this.host.changed();
      if (this.allDone(this.guesses)) this.after(800, () => this.toBetting());
    } else if (m.t === 'bet' && this.phase === 'bet' && !this.bets.has(id)) {
      if (!Number.isInteger(m.slot) || m.slot < 0 || m.slot >= this.slots.length) return;
      this.bets.set(id, m.slot);
      sound.lockIn();
      this.host.refresh(id);
      this.host.changed();
      if (this.allDone(this.bets)) this.after(900, () => this.toReveal());
    }
  }

  onConnection() {
    if (this.phase === 'guess' && this.guesses.size > 0 && this.allDone(this.guesses)) this.after(800, () => this.toBetting());
    if (this.phase === 'bet' && this.bets.size > 0 && this.allDone(this.bets)) this.after(900, () => this.toReveal());
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    this.guesses.delete(id);
    this.bets.delete(id);
    if (this.ids.length === 0) this.host.finish({});
    else this.onConnection();
  }

  viewFor(id: string): PhoneView {
    switch (this.phase) {
      case 'guess':
        return {
          v: 'bpGuess',
          q: this.index + 1,
          total: this.questions.length,
          question: this.q.question,
          unit: this.q.unit,
          endsAt: this.endsAt,
          submitted: this.guesses.get(id) ?? null,
        };
      case 'bet':
        return { v: 'bpBet', slots: this.slots, unit: this.q.unit, endsAt: this.endsAt, picked: this.bets.get(id) ?? null };
      default: {
        const r = this.result[id] ?? { guessWon: false, betWon: false, points: 0 };
        return { v: 'bpResult', guessWon: r.guessWon, betWon: r.betWon, points: r.points, total: this.scores[id] ?? 0 };
      }
    }
  }

  render() {
    const q = this.q;
    if (!q) return <div />;
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);

    if (this.phase === 'scores') {
      return (
        <div class="screen bp-scores" key={`s${this.index}`}>
          <h2 class="screen-title">
            Scores after {this.index + 1} of {this.questions.length}
          </h2>
          <Leaderboard rows={players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: this.scores[p.id] ?? 0, delta: this.result[p.id]?.points }))} />
        </div>
      );
    }

    const header = (
      <div class="quiz-top">
        <div class="pill">
          Question {this.index + 1} / {this.questions.length}
        </div>
        {this.phase !== 'reveal' && <div class="pill pill-cat">{this.phase === 'guess' ? 'Make your guess' : 'Place your bet'}</div>}
        <div class="grow" />
        {(this.phase === 'guess' || this.phase === 'bet') && (
          <TimerRing
            key={this.phase}
            endsAt={this.endsAt}
            total={this.phase === 'guess' ? BP_GUESS_MS : BP_BET_MS}
            size={130}
            onTick={(s) => s <= 5 && s > 0 && sound.tick()}
          />
        )}
      </div>
    );

    if (this.phase === 'guess') {
      return (
        <div class="screen bp" key={`g${this.index}`}>
          {header}
          <div class="bp-question card-paper big">
            {q.question}
            {q.unit && q.unit !== 'year' && <div class="bp-unit">Answer in {q.unit}</div>}
          </div>
          <div class="bp-hint">Type your best guess on your phone. Close counts – but don’t go over!</div>
          <div class="answer-strip">
            {players.map((p) => {
              const done = this.guesses.has(p.id);
              return (
                <div class={`answer-chip ${done ? 'done' : ''} ${p.connected ? '' : 'offline'}`}>
                  <Pierogi color={colorHex(p.color)} size={60} mood={!p.connected ? 'sleep' : done ? 'happy' : 'wow'} />
                  <span>{p.name}</span>
                  <b>{done ? 'Guessed' : 'Thinking…'}</b>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    const revealed = this.phase === 'reveal';
    const win = revealed ? winningSlot(this.slots, q.answer) : -1;
    return (
      <div class="screen bp" key={`b${this.index}`}>
        {header}
        <div class="bp-question card-paper small">{q.question}</div>
        {revealed && (
          <div class="bp-answer pop-in">
            <span class="bp-answer-label">Answer</span>
            <span class="bp-answer-value">{withUnit(q.answer, q.unit)}</span>
          </div>
        )}
        <div class={`bp-slots ${revealed ? 'revealed' : ''}`} style={{ '--n': this.slots.length }}>
          {this.slots.map((slot, i) => {
            const bettors = players.filter((p) => this.bets.get(p.id) === i);
            const guessers = players.filter((p) => slot.value !== null && this.guesses.get(p.id) === slot.value);
            return (
              <div class={`bp-slot ${i === 0 ? 'edge' : ''} ${revealed ? (i === win ? 'win' : 'lose') : ''}`} style={{ animationDelay: `${i * 80}ms` }}>
                <div class="bp-payout">{slot.payout}×</div>
                <div class="bp-slot-value">
                  {slot.value === null ? (
                    <>
                      <small>Smaller than</small>
                      {this.slots[1] ? formatNumber(this.slots[1].value!, q.unit) : '—'}
                    </>
                  ) : (
                    formatNumber(slot.value, q.unit)
                  )}
                </div>
                <div class="bp-guessers">
                  {guessers.map((p) => (
                    <span class="bp-guesser" style={{ background: colorHex(p.color) }}>
                      {p.name}
                    </span>
                  ))}
                </div>
                <div class="bp-bets">
                  {bettors.map((p) => (
                    <Pierogi color={colorHex(p.color)} size={64} mood={revealed ? (i === win ? 'wow' : 'dead') : 'happy'} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {revealed ? (
          <div class="answer-strip">
            {players.map((p) => {
              const r = this.result[p.id];
              return (
                <div class={`answer-chip ${r?.points ? 'done' : ''}`}>
                  <Pierogi color={colorHex(p.color)} size={60} mood={r?.points ? 'wow' : 'happy'} />
                  <span>{p.name}</span>
                  <b class={r?.points ? 'gain' : 'nogain'}>
                    {r?.points ? `+${r.points}` : '0'}
                    {r?.bullseye ? ' 🎯' : ''}
                  </b>
                </div>
              );
            })}
          </div>
        ) : (
          <div class="bp-hint">
            Bet on the guess closest to the answer <b>without going over</b>. Edge slots pay more!
            <span class="bp-hint-count">
              {' '}
              {this.bets.size}/{players.length} bets in
            </span>
          </div>
        )}
      </div>
    );
  }
}
