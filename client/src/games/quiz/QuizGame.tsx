import trivia from '../../../../data/trivia.json';
import { ANSWER_STYLES, colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { usedSet } from '../usedStore';
import { QUIZ_ROUND_LENGTH, QUIZ_TIME_MS, pickQuestions, quizPoints, shuffleOptions, type TriviaQuestion } from './logic';
import { Leaderboard, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { Shape } from '../../lib/shapes';
import { sound } from '../../lib/sound';

const REVEAL_MS = 6500;
const SCORES_MS = 5500;
const used = usedSet('quiz');

interface Asked {
  q: TriviaQuestion;
  options: string[];
  answerIndex: number;
}

type Phase = 'question' | 'reveal' | 'scores';

export class QuizGame implements Game {
  readonly id = 'quiz' as const;
  private questions: Asked[];
  private index = -1;
  private phase: Phase = 'question';
  private openedAt = 0;
  private endsAt = 0;
  private answers = new Map<string, { i: number; at: number }>();
  private scores: Record<string, number> = {};
  private gained: Record<string, number> = {};
  private timer: number | undefined;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.questions = pickQuestions(trivia as TriviaQuestion[], used, QUIZ_ROUND_LENGTH).map((q) => ({ q, ...shuffleOptions(q) }));
    for (const id of ids) this.scores[id] = 0;
  }

  start() {
    this.next();
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private get current() {
    return this.questions[this.index];
  }

  private next() {
    this.index++;
    if (this.index >= this.questions.length) {
      this.host.finish(this.scores);
      return;
    }
    this.phase = 'question';
    this.answers.clear();
    this.gained = {};
    this.openedAt = Date.now();
    this.endsAt = this.openedAt + QUIZ_TIME_MS;
    sound.reveal();
    this.after(QUIZ_TIME_MS, () => this.reveal());
    this.host.refresh();
    this.host.changed();
  }

  private reveal() {
    if (this.phase !== 'question') return;
    this.phase = 'reveal';
    const { answerIndex } = this.current;
    let anyCorrect = false;
    for (const id of this.ids) {
      const a = this.answers.get(id);
      const pts = a ? quizPoints(a.i === answerIndex, a.at - this.openedAt) : 0;
      if (pts > 0) anyCorrect = true;
      this.gained[id] = pts;
      this.scores[id] = (this.scores[id] ?? 0) + pts;
      if (a) this.host.buzz(id, a.i === answerIndex ? [60, 60, 60] : [250]);
    }
    if (anyCorrect) sound.correct();
    else sound.wrong();
    this.after(REVEAL_MS, () => this.showScores());
    this.host.refresh();
    this.host.changed();
  }

  private showScores() {
    this.phase = 'scores';
    sound.whoosh();
    this.after(SCORES_MS, () => this.next());
    this.host.changed();
  }

  private after(ms: number, fn: () => void) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(fn, ms);
  }

  private everyoneAnswered() {
    return this.ids.every((id) => this.answers.has(id) || !this.host.player(id)?.connected);
  }

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'answer' || this.phase !== 'question' || this.answers.has(id)) return;
    if (!Number.isInteger(m.i) || m.i < 0 || m.i > 3) return;
    const now = Date.now();
    if (now > this.endsAt + 300) return;
    this.answers.set(id, { i: m.i, at: Math.min(now, this.endsAt) });
    sound.lockIn();
    this.host.refresh(id);
    this.host.changed();
    if (this.everyoneAnswered()) this.after(700, () => this.reveal());
  }

  onConnection() {
    if (this.phase === 'question' && this.answers.size > 0 && this.everyoneAnswered()) this.after(700, () => this.reveal());
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    if (this.ids.length === 0) this.host.finish({});
    else this.onConnection();
  }

  private rank(id: string) {
    const s = this.scores[id] ?? 0;
    return 1 + this.ids.filter((o) => (this.scores[o] ?? 0) > s).length;
  }

  viewFor(id: string): PhoneView {
    if (this.phase === 'question') {
      const a = this.answers.get(id);
      return {
        v: 'quiz',
        phase: a ? 'locked' : 'answer',
        q: this.index + 1,
        total: this.questions.length,
        endsAt: this.endsAt,
        picked: a?.i ?? null,
      };
    }
    const a = this.answers.get(id);
    return {
      v: 'quizResult',
      correct: a ? a.i === this.current.answerIndex : null,
      points: this.gained[id] ?? 0,
      total: this.scores[id] ?? 0,
      rank: this.rank(id),
    };
  }

  render() {
    const cur = this.current;
    if (!cur) return <div />;
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);

    if (this.phase === 'scores') {
      return (
        <div class="screen quiz-scores" key={`scores-${this.index}`}>
          <h2 class="screen-title">
            Scores after {this.index + 1} of {this.questions.length}
          </h2>
          <Leaderboard rows={players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: this.scores[p.id] ?? 0, delta: this.gained[p.id] }))} />
        </div>
      );
    }

    const revealed = this.phase === 'reveal';
    return (
      <div class="screen quiz" key={`q-${this.index}`}>
        <div class="quiz-top">
          <div class="pill">
            Question {this.index + 1} / {this.questions.length}
          </div>
          <div class="pill pill-cat">{cur.q.category}</div>
          <div class="grow" />
          {!revealed && <TimerRing endsAt={this.endsAt} total={QUIZ_TIME_MS} size={130} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />}
        </div>
        <div class="quiz-question card-paper">{cur.q.question}</div>
        <div class="quiz-options">
          {cur.options.map((text, i) => {
            const pickers = players.filter((p) => this.answers.get(p.id)?.i === i);
            const correct = i === cur.answerIndex;
            return (
              <div
                class={`quiz-option ${revealed ? (correct ? 'is-correct' : 'is-wrong') : ''}`}
                style={{ '--opt': ANSWER_STYLES[i].hex, animationDelay: `${120 + i * 90}ms` }}
              >
                <Shape index={i} size={58} />
                <span class="quiz-option-text">{text}</span>
                {revealed && (
                  <span class="quiz-pickers">
                    {pickers.map((p) => (
                      <Pierogi color={colorHex(p.color)} size={58} mood={correct ? 'wow' : 'dead'} />
                    ))}
                  </span>
                )}
                {revealed && correct && <span class="quiz-check">✓</span>}
              </div>
            );
          })}
        </div>
        <div class="answer-strip">
          {players.map((p) => {
            const answered = this.answers.has(p.id);
            const pts = this.gained[p.id];
            return (
              <div class={`answer-chip ${answered ? 'done' : ''} ${p.connected ? '' : 'offline'}`}>
                <Pierogi color={colorHex(p.color)} size={60} mood={!p.connected ? 'sleep' : answered ? 'happy' : 'wow'} />
                <span>{p.name}</span>
                {revealed ? <b class={pts ? 'gain' : 'nogain'}>{pts ? `+${pts}` : '0'}</b> : <b>{answered ? 'Locked in' : '…'}</b>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}
