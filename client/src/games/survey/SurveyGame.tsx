import data from '../../../../data/survey.json';
import type { PhoneMsg, PhoneView } from '../../../../shared/protocol';
import type { GameHost } from '../types';
import { usedSet } from '../usedStore';
import { pickQuestions } from '../quiz/logic';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { GRACE_MS, WordGame } from '../wordkit/WordGame';
import {
  SV_ANSWER_MS,
  SV_BET_MS,
  SV_EXACT_POINTS,
  SV_GUESS_MS,
  SV_SIDE_POINTS,
  betLabel,
  betOff,
  roundsFor,
  scoreRound,
  surveyors,
  type Bet,
  type RoundResult,
  type SvQuestion,
} from './logic';
import './survey.css';

const POOL = (data as { questions: SvQuestion[] }).questions;
const used = usedSet('survey');

const TITLE_MS = 4000;
const SCORES_MS = 7500;
/** The reveal: answers flip one by one, then the number, then the guess and the bets. */
const FLIP_START_MS = 900;
const FLIP_STEP_MS = 320;
const flipsDone = (n: number) => FLIP_START_MS + n * FLIP_STEP_MS + 500;
const revealMs = (n: number) => flipsDone(n) + 6500;

type Phase = 'title' | 'answer' | 'guess' | 'bet' | 'reveal' | 'scores';

export class SurveyGame extends WordGame<Phase> {
  readonly id = 'survey' as const;
  protected readonly title = 'Ankieta';
  protected minLeft = 3;
  readonly rounds: number;
  round = 0;
  /** The surveyor of each round. */
  order: string[];
  question = '';
  /** Secret answers: true = yes. */
  answers = new Map<string, boolean>();
  guess: number | null = null;
  /** The guess was made for the surveyor (they ran out of time). */
  autoGuess = false;
  bets = new Map<string, Bet>();
  result: RoundResult | null = null;

  constructor(host: GameHost, ids: string[]) {
    super(host, ids, 'title');
    this.rounds = roundsFor(ids.length, host.short);
    this.order = surveyors(ids, this.rounds);
  }

  private get surveyor() {
    return this.order[this.round - 1];
  }

  /** How many answered (the most the guess can be). */
  private get total() {
    return this.answers.size;
  }

  start() {
    this.debugAs('survey');
    this.startTitle();
  }

  protected note() {
    return `Round ${this.round} / ${this.rounds}`;
  }

  // ---- flow ---------------------------------------------------------------------

  private startTitle() {
    this.round++;
    // The surveyor of this round left: hand the round to someone still here.
    if (!this.here(this.surveyor)) this.order[this.round - 1] = this.ids[(this.round - 1) % this.ids.length];
    this.roundPoints = {};
    this.question = pickQuestions(POOL, used, 1)[0].q;
    this.answers.clear();
    this.bets.clear();
    this.guess = null;
    this.autoGuess = false;
    this.result = null;
    this.setPhase('title', TITLE_MS);
    sound.reveal();
    this.after(TITLE_MS, () => this.startAnswer());
    this.update();
  }

  private startAnswer() {
    this.setPhase('answer', SV_ANSWER_MS);
    sound.whoosh();
    this.after(SV_ANSWER_MS + GRACE_MS, () => this.startGuess());
    this.update();
  }

  private startGuess() {
    if (this.phase !== 'answer') return;
    if (this.total === 0) {
      this.startReveal();
      return;
    }
    this.setPhase('guess', SV_GUESS_MS);
    sound.bell();
    this.after(SV_GUESS_MS + GRACE_MS, () => {
      if (this.guess === null) {
        this.guess = Math.round(this.total / 2);
        this.autoGuess = true;
      }
      this.startBet();
    });
    this.update();
  }

  private get bettors() {
    return this.ids.filter((id) => id !== this.surveyor);
  }

  private startBet() {
    if (this.phase !== 'guess') return;
    this.setPhase('bet', SV_BET_MS);
    sound.bell();
    this.after(SV_BET_MS + GRACE_MS, () => this.startReveal());
    this.update();
  }

  private startReveal() {
    if (this.phase !== 'bet' && this.phase !== 'answer') return;
    const r = scoreRound(this.surveyor, this.guess ?? 0, Object.fromEntries(this.answers), Object.fromEntries(this.bets));
    this.result = r;
    this.addPoints(r.points);
    this.setPhase('reveal');
    for (let k = 0; k < r.total; k++) this.later(FLIP_START_MS + k * FLIP_STEP_MS, () => sound.note(440 + k * 40, 0.08, { type: 'triangle', vol: 0.12 }));
    this.later(flipsDone(r.total), () => (r.total && r.guess === r.yes ? sound.fanfare() : sound.reveal()));
    if (r.total && r.guess === r.yes) this.later(flipsDone(r.total), () => this.host.buzz(this.surveyor, [80, 60, 80, 60, 200]));
    this.after(revealMs(r.total), () => (this.round < this.rounds ? this.startTitle() : this.showScores()));
    this.update();
  }

  private showScores() {
    this.setPhase('scores', SCORES_MS);
    sound.fanfare();
    this.after(SCORES_MS, () => this.finish());
    this.update();
  }

  protected maybeAdvance() {
    if (this.phase === 'answer' && this.allDone(this.ids, (id) => this.answers.has(id))) this.soon(900, () => this.startGuess());
    else if (this.phase === 'guess' && this.guess !== null) this.soon(700, () => this.startBet());
    else if (this.phase === 'guess' && !this.here(this.surveyor)) {
      this.guess = Math.round(this.total / 2);
      this.autoGuess = true;
      this.soon(700, () => this.startBet());
    } else if (this.phase === 'bet' && this.allDone(this.bettors, (id) => this.bets.has(id))) this.soon(800, () => this.startReveal());
  }

  protected forget(id: string) {
    this.bets.delete(id);
  }

  // ---- phones -------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'ask' || !this.here(id) || m.key !== this.keyFor(id)) return;
    if (this.phase === 'answer') {
      if (this.answers.has(id) || (m.i !== 0 && m.i !== 1)) return;
      this.answers.set(id, m.i === 0);
    } else if (this.phase === 'guess') {
      if (id !== this.surveyor || this.guess !== null || typeof m.n !== 'number' || !Number.isFinite(m.n)) return;
      this.guess = Math.max(0, Math.min(this.total, Math.round(m.n)));
    } else if (this.phase === 'bet') {
      if (id === this.surveyor || this.bets.has(id) || (m.i !== 0 && m.i !== 1 && m.i !== 2)) return;
      if (betOff(this.guess ?? 0, this.total)[m.i]) return;
      this.bets.set(id, m.i as Bet);
    } else return;
    sound.lockIn();
    this.host.refresh(id);
    this.host.changed();
    this.maybeAdvance();
  }

  viewFor(id: string): PhoneView {
    if (!this.here(id)) return this.watch();
    const me = id === this.surveyor;
    const who = this.name(this.surveyor);
    switch (this.phase) {
      case 'title':
        return me
          ? this.wait(id, 'You’re the surveyor!', 'Answer the question like everyone else – then guess how many said yes.', 'wow')
          : this.wait(id, `Round ${this.round}`, `${who} is the surveyor. Answer honestly – then bet on their guess.`, 'wow');
      case 'answer': {
        const a = this.answers.get(id);
        if (a !== undefined) return this.wait(id, `You said ${a ? 'YES' : 'NO'}`, 'Secret’s safe. Waiting for the others…');
        return this.ask(
          id,
          this.question,
          {
            k: 'choice',
            options: [
              { label: 'Yes', color: '#2fb07a' },
              { label: 'No', color: '#e8335a' },
            ],
            picked: null,
          },
          { endsAt: this.endsAt, text: 'Nobody will see your answer' },
        );
      }
      case 'guess':
        if (!me) return this.wait(id, `${who} is guessing…`, `How many of the ${this.total} said yes?`);
        if (this.guess !== null) return this.wait(id, `You guessed ${this.guess}`, 'Now the others bet on it…');
        return this.ask(
          id,
          `How many of the ${this.total} said YES?`,
          { k: 'slider', min: 0, max: this.total, step: 1, start: Math.round(this.total / 2), left: '0', right: String(this.total), sent: null, button: 'Lock in' },
          { endsAt: this.endsAt, text: this.question, accent: '#ffc93c' },
        );
      case 'bet': {
        const g = this.guess ?? 0;
        if (me) return this.wait(id, `You guessed ${g}`, 'The others are betting on your guess…', 'wow');
        const b = this.bets.get(id);
        if (b !== undefined) return this.wait(id, betLabel(b, g), `${who} guessed ${g} of ${this.total}. Fingers crossed!`);
        const off = betOff(g, this.total);
        return this.ask(
          id,
          `${who} guessed ${g} of ${this.total}`,
          {
            k: 'choice',
            options: ([0, 1, 2] as Bet[]).map((k) => ({
              label: betLabel(k, g),
              sub: k === 1 ? `+${SV_EXACT_POINTS}` : `+${SV_SIDE_POINTS}`,
              color: ['#4f9dff', '#ffc93c', '#b27bff'][k],
              off: off[k],
            })),
            picked: null,
          },
          { endsAt: this.endsAt, text: 'How many really said yes?' },
        );
      }
      case 'reveal': {
        const r = this.result!;
        const pts = r.points[id] ?? 0;
        if (!r.total) return this.wait(id, 'Nobody answered!', 'No points this round.', 'sleep');
        if (me) return this.wait(id, r.guess === r.yes ? 'Spot on!' : `${r.yes} said yes`, `You guessed ${r.guess}.`, pts ? 'wow' : 'dead', `+${pts}`, pts > 0);
        const b = r.bets[id];
        if (!b) return this.wait(id, `${r.yes} of ${r.total} said yes`, 'You didn’t bet.', 'sleep');
        return this.wait(id, b.right ? 'Good bet!' : 'Bad bet!', `${r.yes} of ${r.total} said yes · you bet ${betLabel(b.bet, r.guess).toLowerCase()}`, b.right ? 'wow' : 'dead', `+${pts}`, b.right);
      }
      case 'scores':
        return this.standing(id, true);
    }
  }

  // ---- debug (only with ?debug: window.survey) -----------------------------------

  /** Answer, guess or bet at random for everyone who still has to. */
  debugPlay() {
    if (this.phase === 'answer') for (const id of this.ids) if (!this.answers.has(id)) this.answers.set(id, Math.random() < 0.5);
    if (this.phase === 'guess' && this.guess === null) this.guess = Math.floor(Math.random() * (this.total + 1));
    if (this.phase === 'bet')
      for (const id of this.bettors) {
        if (this.bets.has(id)) continue;
        const ok = ([0, 1, 2] as Bet[]).filter((k) => !betOff(this.guess ?? 0, this.total)[k]);
        this.bets.set(id, ok[Math.floor(Math.random() * ok.length)]);
      }
    this.update();
    this.maybeAdvance();
  }

  // ---- TV -------------------------------------------------------------------------

  private label() {
    return `Round ${this.round} / ${this.rounds}`;
  }

  /** The surveyor's chip, for the top bar. */
  private surveyorPill() {
    return (
      <div class="pill sv-who" style={{ '--pc': this.color(this.surveyor) }}>
        <Pierogi color={this.color(this.surveyor)} size={40} mood="wow" /> Surveyor: {this.name(this.surveyor)}
      </div>
    );
  }

  private card(small?: boolean) {
    return (
      <div class={`qp-prompt card-paper ${small ? 'small' : ''} qp-prompt-in`} key={`q${this.round}`}>
        {this.question}
      </div>
    );
  }

  render() {
    switch (this.phase) {
      case 'title':
        return this.titleCard(`Round ${this.round}`, `${this.name(this.surveyor)} is the surveyor · everyone answers, ${this.name(this.surveyor)} guesses, the rest bet`, {
          who: [this.surveyor],
        });
      case 'answer':
        return (
          <div class="screen qp" key={`a${this.key}`}>
            {this.top(this.label(), SV_ANSWER_MS, this.surveyorPill())}
            {this.card()}
            <p class="qp-sub sv-sub">Answer YES or NO on your phone – it’s secret!</p>
            {this.strip((id) => this.answers.has(id))}
          </div>
        );
      case 'guess':
        return (
          <div class="screen qp" key={`g${this.key}`}>
            {this.top(this.label(), SV_GUESS_MS, this.surveyorPill())}
            {this.card(true)}
            <div class="sv-guessing">
              <Pierogi color={this.color(this.surveyor)} size={150} mood="wow" class="bob" />
              <div>
                <div class="sv-big">How many said yes?</div>
                <div class="sv-mid">
                  {this.name(this.surveyor)} is guessing… <b>{this.total}</b> answered
                </div>
              </div>
            </div>
            {this.strip()}
          </div>
        );
      case 'bet':
        return (
          <div class="screen qp" key={`b${this.key}`}>
            {this.top(this.label(), SV_BET_MS, this.surveyorPill())}
            {this.card(true)}
            <div class="sv-guess pop-in">
              <small>{this.name(this.surveyor)} says</small>
              <b>
                {this.guess} <span>of {this.total}</span>
              </b>
              {this.autoGuess && <small>(out of time – Babcia guessed half)</small>}
            </div>
            <div class="bp-hint qp-hint">
              More, exactly or fewer? Bet on your phone!
              <span class="bp-hint-count">
                {' '}
                {this.bets.size}/{this.bettors.length} in
              </span>
            </div>
            {this.strip((id) => this.bets.has(id))}
          </div>
        );
      case 'reveal':
        return this.renderReveal();
      case 'scores':
        return this.scoresScreen('Final scores');
    }
  }

  private renderReveal() {
    const r = this.result!;
    const at = flipsDone(r.total);
    const tokens = [...Array(r.yes).fill(true), ...Array(r.total - r.yes).fill(false)] as boolean[];
    const guesserPts = r.points[this.surveyor] ?? 0;
    return (
      <div class="screen qp sv-reveal" key={`r${this.key}`}>
        {this.top(this.label(), null, this.surveyorPill())}
        {this.card(true)}
        {r.total === 0 ? (
          <div class="sv-big sv-none">Nobody answered – no points!</div>
        ) : (
          <>
            <div class="sv-tokens">
              {tokens.map((y, k) => (
                <div class={`sv-token ${y ? 'yes' : 'no'}`} style={{ animationDelay: `${FLIP_START_MS + k * FLIP_STEP_MS}ms` }} key={k}>
                  <span>{y ? 'YES' : 'NO'}</span>
                </div>
              ))}
            </div>
            <div class="sv-count" style={{ animationDelay: `${at}ms` }}>
              <b>{r.yes}</b> of {r.total} said yes
            </div>
            <div class="sv-results" style={{ animationDelay: `${at + 600}ms` }}>
              <div class={`sv-res sv-res-guess ${guesserPts ? 'good' : 'bad'}`} style={{ '--pc': this.color(this.surveyor) }}>
                <Pierogi color={this.color(this.surveyor)} size={64} mood={guesserPts ? 'wow' : 'dead'} />
                <span>
                  {this.name(this.surveyor)} guessed <b>{r.guess}</b>
                  {r.guess === r.yes && <em> Spot on!</em>}
                </span>
                <b class={`qp-pts ${guesserPts ? '' : 'zero'}`}>+{guesserPts}</b>
              </div>
              {Object.entries(r.bets).map(([id, b]) => (
                <div class={`sv-res ${b.right ? 'good' : 'bad'}`} style={{ '--pc': this.color(id) }} key={id}>
                  <Pierogi color={this.color(id)} size={48} mood={b.right ? 'happy' : 'dead'} />
                  <span>
                    {this.name(id)}: {betLabel(b.bet, r.guess).toLowerCase()}
                  </span>
                  <b class={`qp-pts ${b.right ? '' : 'zero'}`}>{b.right ? `+${r.points[id]}` : '✗'}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }
}
