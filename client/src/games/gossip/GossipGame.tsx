import data from '../../../../data/gossip.json';
import type { PhoneMsg, PhoneView } from '../../../../shared/protocol';
import type { GameHost } from '../types';
import { usedSet } from '../usedStore';
import { pickQuestions } from '../quiz/logic';
import { sound } from '../../lib/sound';
import { GRACE_MS, WordGame, type GridEntry } from '../wordkit/WordGame';
import { canVote, cleanText, freshLine, pick, scoreVotes, shuffle, type VoteResult } from '../wordkit/logic';
import {
  GS_ANSWER_MAX,
  GS_ANSWER_MS,
  GS_ROUNDS,
  GS_ROUNDS_SHORT,
  GS_TWIST_MAX,
  GS_TWIST_MS,
  GS_VOTE_MS,
  GS_VOTE_POINTS,
  GS_WIN_BONUS,
  assign,
  multiplier,
  type Assignment,
  type GsContext,
  type GsQuestion,
} from './logic';
import './gossip.css';

const D = data as { questions: GsQuestion[]; contexts: GsContext[]; answers: string[] };
const used = usedSet('gossip');

const TITLE_MS = 4500;
const SCORES_MS = 7000;

type Phase = 'title' | 'answer' | 'twist' | 'vote' | 'reveal' | 'scores';

interface Written {
  text: string;
  auto: boolean;
}

export class GossipGame extends WordGame<Phase> {
  readonly id = 'gossip' as const;
  protected readonly title = 'Plotki';
  protected minLeft = 3;
  readonly rounds: number;
  round = 0;
  /** This round's question for each player. */
  questions = new Map<string, string>();
  answers = new Map<string, Written>();
  /** Who twists whose answer: twister → [answerer, context index]. */
  jobs = new Map<string, [string, number]>();
  twists = new Map<string, Written>();
  entries: GridEntry[] = [];
  votes = new Map<string, number>();
  result: VoteResult | null = null;

  constructor(host: GameHost, ids: string[]) {
    super(host, ids, 'title');
    this.rounds = host.short ? GS_ROUNDS_SHORT : GS_ROUNDS;
  }

  private get mult() {
    return multiplier(this.round);
  }

  start() {
    this.debugAs('gossip');
    this.startTitle();
  }

  protected note() {
    return `Round ${this.round} / ${this.rounds}${this.mult > 1 ? ' · ×2' : ''}`;
  }

  // ---- flow ---------------------------------------------------------------------

  private startTitle() {
    this.round++;
    this.roundPoints = {};
    this.setPhase('title', TITLE_MS);
    sound.reveal();
    this.later(TITLE_MS - 900, () => sound.go());
    this.after(TITLE_MS, () => this.startAnswer());
    this.update();
  }

  private startAnswer() {
    const qs = pickQuestions(D.questions, used, this.ids.length);
    this.questions = new Map(this.ids.map((id, k) => [id, qs[k].q]));
    this.answers.clear();
    this.twists.clear();
    this.jobs.clear();
    this.result = null;
    this.setPhase('answer', GS_ANSWER_MS);
    sound.whoosh();
    this.after(GS_ANSWER_MS + GRACE_MS, () => this.startTwist());
    this.update();
  }

  private startTwist() {
    if (this.phase !== 'answer') return;
    for (const id of this.ids)
      if (!this.answers.has(id))
        this.answers.set(id, {
          text: freshLine(
            D.answers,
            [...this.answers.values()].map((a) => a.text),
          ),
          auto: true,
        });
    const plan: Assignment[] = assign(this.ids.length, D.contexts.length);
    this.jobs = new Map(this.ids.map((id, k) => [id, [this.ids[plan[k].from], plan[k].context]]));
    this.setPhase('twist', GS_TWIST_MS);
    sound.whoosh();
    this.after(GS_TWIST_MS + GRACE_MS, () => this.startVote());
    this.update();
  }

  private context(twister: string): GsContext {
    return D.contexts[this.jobs.get(twister)?.[1] ?? 0];
  }

  private fallbackTwist(twister: string) {
    return pick(this.context(twister).fallback);
  }

  private startVote() {
    if (this.phase !== 'twist') return;
    const twisters = this.ids.filter((id) => this.jobs.has(id));
    for (const id of twisters) if (!this.twists.has(id)) this.twists.set(id, { text: this.fallbackTwist(id), auto: true });
    this.entries = shuffle(twisters).map((id) => {
      const [from] = this.jobs.get(id)!;
      const ctx = this.context(id);
      const t = this.twists.get(id)!;
      return {
        author: id,
        text: t.text,
        auto: t.auto,
        head: ctx.label,
        foot: `“${this.answers.get(from)?.text ?? '…'}” – ${this.name(from)}`,
      };
    });
    this.votes.clear();
    this.setPhase('vote', GS_VOTE_MS);
    sound.bell();
    this.entries.forEach((_, i) => this.later(600 + i * 260, () => sound.plop()));
    this.after(GS_VOTE_MS + GRACE_MS, () => this.startReveal());
    this.update();
  }

  private startReveal() {
    if (this.phase !== 'vote') return;
    const r = scoreVotes(
      this.entries.map((e) => e.author),
      Object.fromEntries(this.votes),
      GS_VOTE_POINTS * this.mult,
      GS_WIN_BONUS * this.mult,
    );
    this.result = r;
    this.addPoints(r.points);
    this.setPhase('reveal');
    const ms = this.revealSounds(r);
    for (const i of r.winners) this.later(ms - 4000, () => this.host.buzz(this.entries[i].author, [80, 60, 160]));
    this.after(ms, () => this.showScores());
    this.update();
  }

  private showScores() {
    this.setPhase('scores', SCORES_MS);
    sound.fanfare();
    this.after(SCORES_MS, () => (this.round < this.rounds ? this.startTitle() : this.finish()));
    this.update();
  }

  protected maybeAdvance() {
    if (this.phase === 'answer' && this.allDone(this.ids, (id) => this.answers.has(id))) this.soon(1000, () => this.startTwist());
    else if (this.phase === 'twist' && this.allDone(this.ids, (id) => this.twists.has(id) || !this.jobs.has(id))) this.soon(1000, () => this.startVote());
    else if (this.phase === 'vote' && this.allDone(this.ids, (id) => this.votes.has(id))) this.soon(800, () => this.startReveal());
  }

  protected forget(id: string) {
    this.votes.delete(id);
    this.jobs.delete(id);
  }

  // ---- phones -------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'ask' || !this.here(id) || m.key !== this.keyFor(id)) return;
    if (this.phase === 'answer') {
      if (this.answers.has(id)) return;
      const text = m.auto
        ? freshLine(
            D.answers,
            [...this.answers.values()].map((a) => a.text),
          )
        : cleanText(m.text, GS_ANSWER_MAX);
      if (!text) return;
      this.answers.set(id, { text, auto: !!m.auto });
    } else if (this.phase === 'twist') {
      if (this.twists.has(id) || !this.jobs.has(id)) return;
      const text = m.auto ? this.fallbackTwist(id) : cleanText(m.text, GS_TWIST_MAX);
      if (!text) return;
      this.twists.set(id, { text, auto: !!m.auto });
    } else if (this.phase === 'vote') {
      if (this.votes.has(id) || !canVote(id, this.entries.map((e) => e.author), m.i)) return;
      this.votes.set(id, m.i);
    } else return;
    sound.lockIn();
    this.host.refresh(id);
    this.host.changed();
    this.maybeAdvance();
  }

  viewFor(id: string): PhoneView {
    if (!this.here(id)) return this.watch();
    switch (this.phase) {
      case 'title':
        return this.wait(id, `Round ${this.round}`, this.round === 1 ? 'Answer honestly. Someone else will make it sound terrible.' : 'New questions – every vote counts double!', 'wow');
      case 'answer': {
        const a = this.answers.get(id);
        if (a) return this.wait(id, 'Sent!', `“${a.text}” – what could go wrong?`);
        return this.ask(
          id,
          this.questions.get(id) ?? '',
          { k: 'text', placeholder: 'Your honest answer…', max: GS_ANSWER_MAX, sent: null, auto: '🎲 Answer for me', button: 'Send' },
          { endsAt: this.endsAt, accent: '#ffc93c', text: 'Keep it short and honest – someone else will see it' },
        );
      }
      case 'twist': {
        const job = this.jobs.get(id);
        if (!job) return this.wait(id, 'Look at the TV!');
        const t = this.twists.get(id);
        if (t) return this.wait(id, 'Sent!', `“${t.text}”`);
        const ctx = this.context(id);
        return this.ask(
          id,
          `“${this.answers.get(job[0])?.text ?? ''}”`,
          { k: 'text', placeholder: ctx.placeholder, max: GS_TWIST_MAX, sent: null, auto: '🎲 Twist it for me', button: 'Send' },
          { endsAt: this.endsAt, accent: '#ff7aa8', text: `${this.name(job[0])} said this. ${ctx.label}: ${ctx.ask.toLowerCase()}` },
        );
      }
      case 'vote': {
        const v = this.votes.get(id);
        if (v !== undefined) return this.wait(id, 'Vote in!', `You picked ${String.fromCharCode(65 + v)}`);
        return this.ask(id, 'Best gossip?', { k: 'choice', options: this.voteOptions(id, this.entries), picked: null }, { endsAt: this.endsAt, text: 'Not your own twist!' });
      }
      case 'reveal': {
        const r = this.result!;
        const i = this.entries.findIndex((e) => e.author === id);
        const pts = r.points[id] ?? 0;
        const n = i >= 0 ? r.voters[i].length : 0;
        return this.wait(id, r.winners.includes(i) ? 'Best gossip!' : `${n} vote${n === 1 ? '' : 's'}`, i >= 0 ? `“${this.entries[i].text}”` : undefined, pts ? 'wow' : 'dead', `+${pts}`, pts > 0);
      }
      case 'scores':
        return this.standing(id, this.round >= this.rounds, 'Next round pays double!');
    }
  }

  // ---- debug (only with ?debug: window.gossip) -----------------------------------

  /** Write or vote at random for everyone who still has to. */
  debugPlay() {
    if (this.phase === 'answer') for (const id of this.ids) if (!this.answers.has(id)) this.answers.set(id, { text: pick(D.answers), auto: false });
    if (this.phase === 'twist') for (const id of this.ids) if (this.jobs.has(id) && !this.twists.has(id)) this.twists.set(id, { text: this.fallbackTwist(id), auto: false });
    if (this.phase === 'vote')
      for (const id of this.ids) {
        if (this.votes.has(id)) continue;
        const ok = this.entries.map((e, i) => (e.author === id ? -1 : i)).filter((i) => i >= 0);
        this.votes.set(id, ok[Math.floor(Math.random() * ok.length)]);
      }
    this.update();
    this.maybeAdvance();
  }

  // ---- TV -------------------------------------------------------------------------

  private label() {
    return `Round ${this.round} / ${this.rounds}${this.mult > 1 ? ' · ×2' : ''}`;
  }

  render() {
    switch (this.phase) {
      case 'title':
        return this.titleCard(`Round ${this.round}`, this.round === 1 ? 'Answer a question about yourself · then twist someone else’s answer into gossip' : 'New questions · every vote counts double!', {
          mult: this.mult,
        });
      case 'answer':
        return this.writeScreen(
          this.label(),
          GS_ANSWER_MS,
          'Answer your question on your phone!',
          'Everyone has a different one. Be honest – it’s only the village gossip that’s listening…',
          (id) => this.answers.has(id),
        );
      case 'twist':
        return this.writeScreen(
          this.label(),
          GS_TWIST_MS,
          'Now twist it!',
          'You’ve got someone else’s answer. Put it somewhere it sounds terrible – a headline, a police report, a dating profile…',
          (id) => this.twists.has(id) || !this.jobs.has(id),
          undefined,
          <div class="wk-card card-paper gs-example">
            <div class="wk-card-kicker">For example · Police report</div>
            <div class="wk-card-big gs-ex-big">Suspect accused of stealing the church bell</div>
            <div class="wk-card-small">“I hide it under the bed” – Kasia</div>
          </div>,
        );
      case 'vote':
      case 'reveal': {
        const r = this.phase === 'reveal' ? this.result : null;
        const total = r ? r.voters.reduce((s, v) => s + v.length, 0) : 0;
        return (
          <div class={`screen qp gs ${this.phase}`} key={`v${this.key}`}>
            {this.top(this.label(), r ? null : GS_VOTE_MS, <div class="pill">Best gossip?</div>)}
            {this.entryGrid(this.entries, r, { appear: !r })}
            {!r && (
              <div class="bp-hint qp-hint">
                Vote for the best twist on your phone – not your own!
                <span class="bp-hint-count">
                  {' '}
                  {this.votes.size}/{this.ids.length} in
                </span>
              </div>
            )}
            {r && r.winners.length > 0 && (
              <div class="qp-splash final gs-splash" style={{ animationDelay: `${700 + total * 260 + 1300}ms` }}>
                {r.winners.length > 1 ? 'A tie!' : `${this.name(this.entries[r.winners[0]].author)} spread the best gossip!`}
              </div>
            )}
            {!r && this.strip((id) => this.votes.has(id))}
          </div>
        );
      }
      case 'scores':
        return this.scoresScreen(this.round >= this.rounds ? 'Final scores' : `After round ${this.round} – round ${this.round + 1} pays double!`);
    }
  }
}
