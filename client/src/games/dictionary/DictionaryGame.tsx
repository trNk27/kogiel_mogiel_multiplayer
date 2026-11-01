import data from '../../../../data/dictionary.json';
import type { PhoneMsg, PhoneView } from '../../../../shared/protocol';
import type { GameHost } from '../types';
import { usedSet } from '../usedStore';
import { pickQuestions } from '../quiz/logic';
import { sound } from '../../lib/sound';
import { GRACE_MS, WordGame, type GridEntry } from '../wordkit/WordGame';
import { canVote, cleanText, freshLine, scoreVotes, shuffle, type VoteResult } from '../wordkit/logic';
import {
  DC_MAX,
  DC_ROUNDS,
  DC_ROUNDS_SHORT,
  DC_VOTE_MS,
  DC_VOTE_POINTS,
  DC_WIN_BONUS,
  DC_WRITE_MS,
  canonical,
  fillSentence,
  isEcho,
  stageTitle,
  usesWord,
  type DcWord,
  type Pos,
  type Stage,
} from './logic';
import './dictionary.css';

const D = data as { words: DcWord[]; definitions: Record<Pos, string[]>; synonyms: Record<Pos, string[]>; sentences: Record<Pos, string[]> };
const used = usedSet('dictionary');

const TITLE_MS = 4500;
const STAGE_MS = 3200;
const SCORES_MS = 7000;
const STAGE_NAMES = ['Definition', 'Synonym', 'Sentence'];

type Phase = 'title' | 'stage' | 'write' | 'vote' | 'reveal' | 'scores';

interface Entry extends GridEntry {
  auto: boolean;
}

export class DictionaryGame extends WordGame<Phase> {
  readonly id = 'dictionary' as const;
  protected readonly title = 'Słownik';
  protected minLeft = 3;
  readonly rounds: number;
  round = 0;
  stage: Stage = 0;
  word: DcWord = D.words[0];
  /** The winning definition and synonym of this word ('' until voted). */
  definition = '';
  synonym = '';
  /** What everyone wrote in this stage. */
  written = new Map<string, { text: string; auto: boolean }>();
  /** Why a phone's last entry was turned down. */
  errors = new Map<string, string>();
  entries: Entry[] = [];
  votes = new Map<string, number>();
  result: VoteResult | null = null;
  /** The entry that became official this stage. */
  chosen = -1;

  constructor(host: GameHost, ids: string[]) {
    super(host, ids, 'title');
    this.rounds = host.short ? DC_ROUNDS_SHORT : DC_ROUNDS;
  }

  start() {
    this.debugAs('dictionary');
    this.startTitle();
  }

  protected note() {
    return `Word ${this.round} / ${this.rounds} · ${STAGE_NAMES[this.stage]}`;
  }

  protected keyFor(id: string) {
    // A turned-down entry bumps the key, so the phone shows the error with a fresh input.
    return this.key * 4 + (this.errors.has(id) ? 1 : 0);
  }

  // ---- flow ---------------------------------------------------------------------

  private startTitle() {
    this.round++;
    this.roundPoints = {};
    this.word = pickQuestions(D.words, used, 1)[0];
    this.definition = '';
    this.synonym = '';
    this.stage = 0;
    this.setPhase('title', TITLE_MS);
    sound.reveal();
    this.later(TITLE_MS - 900, () => sound.go());
    this.after(TITLE_MS, () => this.startWrite());
    this.update();
  }

  /** A short card naming the next stage ("Now a synonym!"). */
  private startStage() {
    this.setPhase('stage', STAGE_MS);
    sound.whoosh();
    this.after(STAGE_MS, () => this.startWrite());
    this.update();
  }

  private startWrite() {
    this.written.clear();
    this.errors.clear();
    this.result = null;
    this.chosen = -1;
    this.setPhase('write', DC_WRITE_MS[this.stage]);
    sound.whoosh();
    this.after(DC_WRITE_MS[this.stage] + GRACE_MS, () => this.endWrite());
    this.update();
  }

  /** One of Babcia's lines for this stage, not used by anyone yet. */
  private babcia(): string {
    const pos = this.word.pos;
    const taken = [...this.written.values()].map((w) => w.text);
    if (this.stage === 0) return freshLine(D.definitions[pos], taken);
    if (this.stage === 1) return freshLine(D.synonyms[pos], taken);
    // Compare the filled-in sentences, since that's what's been written.
    const filledPool = D.sentences[pos].map((s) => fillSentence(s, this.word.word));
    return freshLine(filledPool, taken);
  }

  private endWrite() {
    if (this.phase !== 'write') return;
    for (const id of this.ids) if (!this.written.has(id)) this.written.set(id, { text: this.babcia(), auto: true });
    this.entries = shuffle(this.ids.map((author) => ({ author, ...this.written.get(author)! })));
    this.votes.clear();
    this.setPhase('vote', DC_VOTE_MS);
    sound.bell();
    this.entries.forEach((_, i) => this.later(600 + i * 260, () => sound.plop()));
    this.after(DC_VOTE_MS + GRACE_MS, () => this.startReveal());
    this.update();
  }

  private startReveal() {
    if (this.phase !== 'vote') return;
    const authors = this.entries.map((e) => e.author);
    const r = scoreVotes(authors, Object.fromEntries(this.votes), DC_VOTE_POINTS, DC_WIN_BONUS);
    this.result = r;
    this.addPoints(r.points);
    this.chosen = canonical(r.winners, this.entries.length);
    if (this.stage === 0) this.definition = this.entries[this.chosen]?.text ?? '';
    if (this.stage === 1) this.synonym = this.entries[this.chosen]?.text ?? '';
    this.setPhase('reveal');
    const ms = this.revealSounds(r);
    for (const i of r.winners) this.later(ms - 4000, () => this.host.buzz(this.entries[i].author, [80, 60, 160]));
    this.after(ms, () => {
      if (this.stage < 2) {
        this.stage = (this.stage + 1) as Stage;
        this.startStage();
      } else this.showScores();
    });
    this.update();
  }

  private showScores() {
    this.setPhase('scores', SCORES_MS);
    sound.fanfare();
    this.after(SCORES_MS, () => (this.round < this.rounds ? this.startTitle() : this.finish()));
    this.update();
  }

  protected maybeAdvance() {
    if (this.phase === 'write' && this.allDone(this.ids, (id) => this.written.has(id))) this.soon(1000, () => this.endWrite());
    else if (this.phase === 'vote' && this.allDone(this.ids, (id) => this.votes.has(id))) this.soon(800, () => this.startReveal());
  }

  protected forget(id: string) {
    this.votes.delete(id);
    this.written.delete(id);
  }

  // ---- phones -------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'ask' || !this.here(id) || m.key !== this.keyFor(id)) return;
    if (this.phase === 'write') {
      if (this.written.has(id)) return;
      const text = m.auto ? this.babcia() : cleanText(m.text, DC_MAX[this.stage]);
      if (!text) return;
      const why = m.auto ? '' : this.stage === 2 && !usesWord(text, this.word.word) ? `Use “${this.word.word}” in it!` : this.stage === 1 && isEcho(text, this.word.word) ? 'That’s the word itself!' : '';
      if (why) {
        this.errors.set(id, why);
        sound.wrong();
        this.host.refresh(id);
        return;
      }
      this.errors.delete(id);
      this.written.set(id, { text, auto: !!m.auto });
    } else if (this.phase === 'vote') {
      if (this.votes.has(id) || !canVote(id, this.entries.map((e) => e.author), m.i)) return;
      this.votes.set(id, m.i);
    } else return;
    sound.lockIn();
    this.host.refresh(id);
    this.host.changed();
    this.maybeAdvance();
  }

  private wordLine() {
    return `${this.word.word} (${this.word.pos})`;
  }

  viewFor(id: string): PhoneView {
    if (!this.here(id)) return this.watch();
    const w = this.word.word;
    switch (this.phase) {
      case 'title':
        return this.wait(id, w, `A brand-new ${this.word.pos}. What could it mean?`, 'wow');
      case 'stage':
        return this.wait(id, `Now: ${STAGE_NAMES[this.stage].toLowerCase()}!`, this.stage === 1 ? `${w}: ${this.definition}` : `${w}: ${this.definition} · also “${this.synonym}”`, 'wow');
      case 'write': {
        const mine = this.written.get(id);
        if (mine) return this.wait(id, 'Sent!', `“${mine.text}”`);
        const text = this.stage === 0 ? `A made-up ${this.word.pos}. Make it sound official.` : this.stage === 1 ? `It means: ${this.definition}` : `${this.wordLine()}: ${this.definition}`;
        const placeholder = this.stage === 0 ? (this.word.pos === 'verb' ? 'To…' : this.word.pos === 'adjective' ? 'Feeling like…' : 'A thing that…') : this.stage === 1 ? 'One to three words…' : `A sentence with “${w}”…`;
        return this.ask(
          id,
          stageTitle(this.stage, w),
          { k: 'text', placeholder, max: DC_MAX[this.stage], sent: null, auto: '🎲 Babcia, help!', button: 'Send', ...(this.errors.has(id) ? { error: this.errors.get(id) } : {}) },
          { endsAt: this.endsAt, accent: '#ffc93c', text },
        );
      }
      case 'vote': {
        const v = this.votes.get(id);
        if (v !== undefined) return this.wait(id, 'Vote in!', `You picked “${this.entries[v].text}”`);
        return this.ask(id, `Best ${STAGE_NAMES[this.stage].toLowerCase()} for “${w}”?`, { k: 'choice', options: this.voteOptions(id, this.entries), picked: null }, { endsAt: this.endsAt, text: 'Not your own!' });
      }
      case 'reveal': {
        const r = this.result!;
        const i = this.entries.findIndex((e) => e.author === id);
        const pts = r.points[id] ?? 0;
        const n = i >= 0 ? r.voters[i].length : 0;
        const won = i === this.chosen && this.stage < 2;
        return this.wait(id, won ? 'Yours is official!' : `${n} vote${n === 1 ? '' : 's'}`, i >= 0 ? `“${this.entries[i].text}”` : undefined, pts ? 'wow' : 'dead', `+${pts}`, pts > 0);
      }
      case 'scores':
        return this.standing(id, this.round >= this.rounds, 'Another word coming up!');
    }
  }

  // ---- debug (only with ?debug: window.dictionary) -------------------------------

  /** Write or vote at random for everyone who still has to. */
  debugPlay() {
    if (this.phase === 'write') for (const id of this.ids) if (!this.written.has(id)) this.written.set(id, { text: this.babcia(), auto: false });
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
    return `Word ${this.round} / ${this.rounds}`;
  }

  /** The dictionary page: the word, its part of speech, and what's official so far. */
  private page(small = false) {
    return (
      <div class={`wk-card card-paper dc-page ${small ? 'small' : ''}`} key={`p${this.round}`}>
        <div class="dc-word">
          {this.word.word} <i>{this.word.pos}</i>
        </div>
        {this.definition && <div class="dc-def">{this.definition}</div>}
        {this.synonym && (
          <div class="dc-syn">
            <b>see also:</b> {this.synonym}
          </div>
        )}
      </div>
    );
  }

  render() {
    switch (this.phase) {
      case 'title':
        return (
          <div class="screen qp-title dc-title" key={`t${this.round}`}>
            <div class="qp-kicker">Słownik · word {this.round}</div>
            <h1 class="qp-big dc-big">{this.word.word}</h1>
            <p class="qp-sub">
              <i>{this.word.pos}</i> · nobody knows what it means – yet
            </p>
          </div>
        );
      case 'stage':
        return (
          <div class="screen qp dc" key={`st${this.key}`}>
            {this.top(this.label(), null)}
            {this.page()}
            <h2 class="qp-head dc-next pop-in">
              Now: a {STAGE_NAMES[this.stage].toLowerCase()}!
            </h2>
            <p class="qp-sub">{this.stage === 1 ? 'Another word that means the same' : `Use “${this.word.word}” in a sentence – any form of it counts`}</p>
          </div>
        );
      case 'write':
        return this.writeScreen(
          this.label(),
          DC_WRITE_MS[this.stage],
          stageTitle(this.stage, this.word.word),
          this.stage === 0 ? 'Write a definition on your phone. Make it sound like it belongs in a dictionary.' : this.stage === 1 ? 'One to three words. Not the word itself!' : 'Any form of the word counts.',
          (id) => this.written.has(id),
          undefined,
          this.page(true),
        );
      case 'vote':
      case 'reveal':
        return this.renderVote();
      case 'scores':
        return this.scoresScreen(this.round >= this.rounds ? 'Final scores' : `After “${this.word.word}”`);
    }
  }

  private renderVote() {
    const r = this.phase === 'reveal' ? this.result : null;
    const total = r ? r.voters.reduce((s, v) => s + v.length, 0) : 0;
    return (
      <div class={`screen qp dc ${this.phase}`} key={`v${this.key}`}>
        {this.top(this.label(), r ? null : DC_VOTE_MS, <div class="pill">Best {STAGE_NAMES[this.stage].toLowerCase()}?</div>)}
        {this.page(true)}
        {this.entryGrid(this.entries, r, { appear: !r })}
        {!r && (
          <div class="bp-hint qp-hint">
            Vote for your favourite on your phone – not your own!
            <span class="bp-hint-count">
              {' '}
              {this.votes.size}/{this.ids.length} in
            </span>
          </div>
        )}
        {r && this.chosen >= 0 && this.stage < 2 && (
          <div class="qp-splash final dc-splash" style={{ animationDelay: `${700 + total * 260 + 1300}ms` }}>
            {String.fromCharCode(65 + this.chosen)} is now official!
          </div>
        )}
        {r && this.stage === 2 && r.winners.length > 0 && (
          <div class="qp-splash final dc-splash" style={{ animationDelay: `${700 + total * 260 + 1300}ms` }}>
            {r.winners.length > 1 ? 'A tie!' : `${this.name(this.entries[r.winners[0]].author)} said it best!`}
          </div>
        )}
        {!r && this.strip((id) => this.votes.has(id))}
      </div>
    );
  }
}
