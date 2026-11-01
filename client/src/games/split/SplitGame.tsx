import data from '../../../../data/split.json';
import type { PhoneMsg, PhoneView } from '../../../../shared/protocol';
import type { GameHost } from '../types';
import { usedSet } from '../usedStore';
import { pickQuestions } from '../quiz/logic';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { GRACE_MS, WordGame } from '../wordkit/WordGame';
import { cleanText, freshLine, shuffle } from '../wordkit/logic';
import {
  PN_MAX,
  PN_ROUNDS,
  PN_ROUNDS_SHORT,
  PN_VOTE_MS,
  PN_WRITE_MS,
  PN_WRITE_MS_SHORT,
  filled,
  multiplier,
  scoreSplit,
  splitAround,
  type PnScenario,
  type SplitResult,
} from './logic';
import './split.css';

const POOL = (data as { scenarios: PnScenario[] }).scenarios;
const FILLS = (data as { fills: string[] }).fills;
const used = usedSet('split');

const TITLE_MS = 4500;
const SHOW_MS = 3500;
const SCORES_MS = 7000;
/** The reveal: voters hop onto YES and NO, then the author and their points. */
const POP_START_MS = 700;
const POP_STEP_MS = 330;
const authorsAt = (n: number) => POP_START_MS + n * POP_STEP_MS + 600;
const revealMs = (n: number) => authorsAt(n) + 4500;

type Phase = 'title' | 'write' | 'show' | 'vote' | 'reveal' | 'scores';

interface Dilemma {
  author: string;
  scenario: PnScenario;
  answer: string | null;
  auto: boolean;
}

export class SplitGame extends WordGame<Phase> {
  readonly id = 'split' as const;
  protected readonly title = 'Pół na Pół';
  protected minLeft = 3;
  readonly rounds: number;
  readonly writeMs: number;
  round = 0;
  dilemmas: Dilemma[] = [];
  /** Position in `dilemmas` on the TV. */
  pos = -1;
  votes = new Map<string, boolean>();
  result: SplitResult | null = null;

  constructor(host: GameHost, ids: string[]) {
    super(host, ids, 'title');
    this.rounds = host.short ? PN_ROUNDS_SHORT : PN_ROUNDS;
    this.writeMs = host.short ? PN_WRITE_MS_SHORT : PN_WRITE_MS;
  }

  private get mult() {
    return multiplier(this.round);
  }

  private get current(): Dilemma | undefined {
    return this.dilemmas[this.pos];
  }

  private mine(id: string) {
    return this.dilemmas.find((d) => d.author === id);
  }

  start() {
    this.debugAs('split');
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
    this.after(TITLE_MS, () => this.startWrite());
    this.update();
  }

  private startWrite() {
    const picks = pickQuestions(POOL, used, this.ids.length);
    this.dilemmas = this.ids.map((author, k) => ({ author, scenario: picks[k], answer: null, auto: false }));
    this.setPhase('write', this.writeMs);
    sound.whoosh();
    this.after(this.writeMs + GRACE_MS, () => this.endWrite());
    this.update();
  }

  private autoFill() {
    return freshLine(
      FILLS,
      this.dilemmas.flatMap((d) => (d.answer ? [d.answer] : [])),
    );
  }

  private endWrite() {
    if (this.phase !== 'write') return;
    // Only dilemmas of players still here go up; the ones nobody filled get one of Babcia's.
    this.dilemmas = shuffle(this.dilemmas.filter((d) => this.here(d.author)));
    for (const d of this.dilemmas)
      if (!d.answer) {
        d.answer = this.autoFill();
        d.auto = true;
      }
    this.pos = -1;
    this.nextDilemma();
  }

  private nextDilemma() {
    this.pos++;
    while (this.pos < this.dilemmas.length && !this.here(this.current!.author)) this.pos++;
    if (this.pos >= this.dilemmas.length) {
      this.showScores();
      return;
    }
    this.votes.clear();
    this.result = null;
    this.setPhase('show', SHOW_MS);
    sound.whoosh();
    this.later(1200, () => sound.plop());
    this.after(SHOW_MS, () => this.startVote());
    this.update();
  }

  private get voters() {
    const d = this.current;
    return d ? this.ids.filter((id) => id !== d.author) : [];
  }

  private startVote() {
    if (this.phase !== 'show') return;
    this.setPhase('vote', PN_VOTE_MS);
    sound.bell();
    this.after(PN_VOTE_MS + GRACE_MS, () => this.startReveal());
    this.update();
  }

  private startReveal() {
    if (this.phase !== 'vote') return;
    const d = this.current!;
    const r = scoreSplit(d.author, Object.fromEntries(this.votes), this.mult);
    this.result = r;
    this.addPoints({ [d.author]: r.points });
    this.setPhase('reveal');
    const n = r.yes.length + r.no.length;
    for (let k = 0; k < n; k++) this.later(POP_START_MS + k * POP_STEP_MS, () => sound.note(500 + k * 50, 0.09, { type: 'sine', vol: 0.13, slide: 260 }));
    this.later(authorsAt(n), () => (r.perfect ? sound.fanfare() : r.points ? sound.reveal() : sound.wrong()));
    if (r.perfect) this.later(authorsAt(n), () => this.host.buzz(d.author, [80, 60, 80, 60, 200]));
    this.after(revealMs(n), () => this.nextDilemma());
    this.update();
  }

  private showScores() {
    this.setPhase('scores', SCORES_MS);
    sound.whoosh();
    this.after(SCORES_MS, () => (this.round < this.rounds ? this.startTitle() : this.finish()));
    this.update();
  }

  protected maybeAdvance() {
    if (this.phase === 'write' && this.allDone(this.ids, (id) => !!this.mine(id)?.answer)) this.soon(1000, () => this.endWrite());
    else if (this.phase === 'vote' && this.allDone(this.voters, (id) => this.votes.has(id))) this.soon(800, () => this.startReveal());
  }

  protected forget(id: string) {
    this.votes.delete(id);
    if (this.current?.author === id && (this.phase === 'show' || this.phase === 'vote')) this.nextDilemma();
  }

  // ---- phones -------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'ask' || !this.here(id) || m.key !== this.keyFor(id)) return;
    if (this.phase === 'write') {
      const d = this.mine(id);
      if (!d || d.answer) return;
      const text = m.auto ? this.autoFill() : cleanText(m.text, PN_MAX);
      if (!text) return;
      d.answer = text;
      d.auto = !!m.auto;
    } else if (this.phase === 'vote') {
      if (id === this.current?.author || this.votes.has(id) || (m.i !== 0 && m.i !== 1)) return;
      this.votes.set(id, m.i === 0);
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
        return this.wait(id, `Round ${this.round}`, this.round === 1 ? 'Finish your dilemma so the room splits in half.' : 'New dilemmas – every point counts double!', 'wow');
      case 'write': {
        const d = this.mine(id);
        if (!d) return this.wait(id, 'Look at the TV!');
        if (d.answer) return this.wait(id, 'Sent!', `“${filled(d.scenario.text, d.answer)}”`);
        return this.ask(
          id,
          d.scenario.text,
          { k: 'text', placeholder: 'Fill in the blank…', max: PN_MAX, sent: null, auto: '🎲 Fill it for me', button: 'Send' },
          { endsAt: this.endsAt, accent: '#ffc93c', text: `${d.scenario.ask} Make it a close call!` },
        );
      }
      case 'show':
      case 'vote': {
        const d = this.current!;
        if (d.author === id) return this.wait(id, 'Your dilemma is up!', 'Hope the room splits right down the middle…', 'wow');
        if (this.phase === 'show') return this.wait(id, 'Look at the TV!', 'Then vote yes or no.');
        const v = this.votes.get(id);
        if (v !== undefined) return this.wait(id, `You said ${v ? 'YES' : 'NO'}`, 'Waiting for the others…');
        return this.ask(
          id,
          filled(d.scenario.text, d.answer!),
          {
            k: 'choice',
            options: [
              { label: 'Yes', color: '#2fb07a' },
              { label: 'No', color: '#e8335a' },
            ],
            picked: null,
          },
          { endsAt: this.endsAt, text: d.scenario.ask },
        );
      }
      case 'reveal': {
        const d = this.current!;
        const r = this.result!;
        if (d.author === id)
          return this.wait(id, r.perfect ? 'Perfect split!' : `${r.yes.length} yes · ${r.no.length} no`, `“${d.answer}”`, r.points ? 'wow' : 'dead', `+${r.points}`, r.points > 0);
        const v = this.votes.get(id);
        return this.wait(id, `${r.yes.length} yes · ${r.no.length} no`, v === undefined ? 'You didn’t vote.' : `You said ${v ? 'yes' : 'no'}.`);
      }
      case 'scores':
        return this.standing(id, this.round >= this.rounds, 'Next round pays double!');
    }
  }

  // ---- debug (only with ?debug: window.split) ------------------------------------

  /** Fill in or vote at random for everyone who still has to. */
  debugPlay() {
    if (this.phase === 'write')
      for (const d of this.dilemmas)
        if (!d.answer) {
          d.answer = this.autoFill();
          d.auto = false;
        }
    if (this.phase === 'vote') for (const id of this.voters) if (!this.votes.has(id)) this.votes.set(id, Math.random() < 0.5);
    this.update();
    this.maybeAdvance();
  }

  // ---- TV -------------------------------------------------------------------------

  private label() {
    return `Round ${this.round} / ${this.rounds}${this.mult > 1 ? ' · ×2' : ''}`;
  }

  private dilemmaCard(d: Dilemma) {
    const [a, b] = splitAround(d.scenario.text);
    const ans = b.startsWith('.') ? d.answer!.replace(/[.!]+$/, '') : d.answer!;
    return (
      <div class="wk-card card-paper pn-card" key={`d${this.pos}`}>
        <div class="wk-card-big pn-text">
          {a}
          <span class="wk-fill pn-fill">{ans}</span>
          {b}
        </div>
        <div class="pn-ask">{d.scenario.ask}</div>
      </div>
    );
  }

  render() {
    switch (this.phase) {
      case 'title':
        return this.titleCard(`Round ${this.round}`, this.round === 1 ? 'Fill in your dilemma · the room votes yes or no · split them half-and-half!' : 'New dilemmas · every point counts double!', {
          mult: this.mult,
        });
      case 'write':
        return this.writeScreen(
          this.label(),
          this.writeMs,
          'Fill in your dilemma on your phone!',
          'Too nice and everyone says yes. Too nasty and everyone says no. Aim for half-and-half.',
          (id) => !!this.mine(id)?.answer,
          undefined,
          <div class="wk-card card-paper pn-example">
            <div class="wk-card-kicker">For example</div>
            <div class="wk-card-small">
              You can fly, but <span class="wk-fill">you have to flap your arms the whole time</span>. Would you take the power?
            </div>
          </div>,
        );
      case 'show':
      case 'vote':
      case 'reveal':
        return this.renderDilemma();
      case 'scores':
        return this.scoresScreen(this.round >= this.rounds ? 'Final scores' : `After round ${this.round} – round ${this.round + 1} pays double!`);
    }
  }

  private renderDilemma() {
    const d = this.current!;
    const r = this.phase === 'reveal' ? this.result : null;
    const n = r ? r.yes.length + r.no.length : 0;
    const at = authorsAt(n);
    const order = [...this.votes.keys()];
    const side = (list: string[], yes: boolean) => (
      <div class={`pn-side ${yes ? 'yes' : 'no'}`}>
        <div class="pn-side-label">{yes ? 'YES' : 'NO'}</div>
        <div class="pn-side-count" style={{ animationDelay: `${at - 300}ms` }}>
          {list.length}
        </div>
        <div class="qp-voters">
          {list.map((v) => (
            <span class="qp-voter" style={{ animationDelay: `${POP_START_MS + Math.max(0, order.indexOf(v)) * POP_STEP_MS}ms` }} key={v}>
              <Pierogi color={this.color(v)} size={58} mood={yes ? 'happy' : 'dead'} />
              <small>{this.name(v)}</small>
            </span>
          ))}
        </div>
      </div>
    );
    return (
      <div class={`screen qp pn ${this.phase}`} key={`p${this.round}.${this.pos}`}>
        {this.top(this.label(), this.phase === 'vote' ? PN_VOTE_MS : null, <div class="pill">Dilemma {this.pos + 1} / {this.dilemmas.length}</div>)}
        {this.dilemmaCard(d)}
        {r ? (
          <>
            <div class="pn-split">
              {side(r.yes, true)}
              {side(r.no, false)}
            </div>
            <div class="qp-author pn-author" style={{ animationDelay: `${at}ms`, '--pc': this.color(d.author) }}>
              <Pierogi color={this.color(d.author)} size={84} mood={r.points ? 'wow' : 'dead'} />
              <span class="qp-author-name">
                {this.name(d.author)} wrote it
                {d.auto && <small class="qp-auto"> 🎲 Babcia filled it in</small>}
              </span>
              <b class={`qp-pts ${r.points ? '' : 'zero'}`}>+{r.points.toLocaleString('en-US')}</b>
            </div>
            {r.perfect && (
              <div class="qp-splash final" style={{ animationDelay: `${at + 400}ms` }}>
                Perfect split!
              </div>
            )}
          </>
        ) : (
          this.phase === 'vote' && (
            <div class="bp-hint qp-hint">
              Yes or no? Vote on your phone!
              <span class="bp-hint-count">
                {' '}
                {this.votes.size}/{this.voters.length} in
              </span>
            </div>
          )
        )}
        {!r && this.strip(this.phase === 'vote' ? (id) => this.votes.has(id) : undefined)}
      </div>
    );
  }
}
