import categories from '../../../../data/spy.json';
import { colorHex, type AskView, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { usedSet } from '../usedStore';
import { TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import {
  CARD_MS,
  CLUE_MS,
  GUESS_MS,
  MAX_CLUE,
  OFFLINE_TURN_MS,
  SKIPPED,
  SpyRound,
  VOTE_MS,
  pickCategory,
  pickSpy,
  roundsFor,
  type Outcome,
  type SpyCategory,
  type SpyWord,
} from './logic';
import './spy.css';

const POOL = categories as SpyCategory[];
const used = usedSet('spy');

/** Phones hand in what's typed just before the deadline; give it time to arrive. */
const GRACE_MS = 1200;
const REVEAL_INTRO_MS = 1600;
const VOTE_STEP_MS = 700;
const TALLY_MS = 2200;
const DRUM_MS = 2600;
const UNMASK_MS = 3800;
const GUESSED_MS = 3200;
const RESULT_MS = 8500;
/** Width of the TV's safe area, which the seats share. */
const TABLE_W = 1728;
const SEAT_GAP = 18;

type Phase = 'card' | 'clue' | 'vote' | 'reveal' | 'guess' | 'result';
type RevealStage = 'intro' | 'votes' | 'tally' | 'drum' | 'unmask';

const word = (w: SpyWord | undefined) => (w ? (w.e ? `${w.e} ${w.w}` : w.w) : '?');

export class SpyGame implements Game {
  readonly id = 'spy' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'card';
  r!: SpyRound;
  endsAt = 0;
  /** Bumped for every new question on the phones; answers with another key are ignored. */
  key = 1;
  scores: Record<string, number> = {};
  roundPts: Record<string, number> = {};
  /** The spy of every round so far. */
  spies: string[] = [];
  clueError = new Map<string, string>();
  revealStage: RevealStage = 'intro';
  /** The votes in the order they fly in, and how many have so far. */
  revealVotes: [string, string][] = [];
  shown = 0;
  /** The caught spy has picked (or run out of time); the grid shows the answer. */
  guessDone = false;
  outcome: Outcome = 'escaped';
  private timer: number | undefined;
  private sfx: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = roundsFor(ids.length, host.short);
    for (const id of ids) this.scores[id] = 0;
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, SpyGame>).spy = this;
    this.startRound();
  }

  dispose() {
    clearTimeout(this.timer);
    this.sfx.forEach((t) => clearTimeout(t));
    this.sfx = [];
  }

  private after(ms: number, fn: () => void) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(fn, ms);
  }

  private later(ms: number, fn: () => void) {
    this.sfx.push(window.setTimeout(fn, ms));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private name(id: string | undefined) {
    return (id && this.host.player(id)?.name) || '?';
  }

  private connected(id: string | undefined) {
    return !!id && !!this.host.player(id)?.connected;
  }

  // ---- flow ---------------------------------------------------------------------------------------

  private startRound() {
    this.round++;
    const spy = pickSpy(this.ids, this.spies);
    this.spies.push(spy);
    const cat = pickCategory(POOL, used);
    this.r = new SpyRound(this.ids, spy, cat, Math.floor(Math.random() * cat.words.length), Math.floor(Math.random() * this.ids.length));
    this.roundPts = {};
    this.clueError.clear();
    this.revealVotes = [];
    this.shown = 0;
    this.guessDone = false;
    this.phase = 'card';
    this.key++;
    this.endsAt = Date.now() + CARD_MS;
    sound.reveal();
    this.host.buzz(spy, [80, 60, 80, 60, 200]);
    this.after(CARD_MS, () => this.startClues());
    this.update();
  }

  private startClues() {
    if (this.phase !== 'card') return;
    this.phase = 'clue';
    sound.go();
    this.startTurn();
  }

  private startTurn() {
    if (this.r.cluesDone) {
      this.startVote();
      return;
    }
    this.key++;
    this.clueError.clear();
    const id = this.r.current!;
    const ms = this.connected(id) ? CLUE_MS : OFFLINE_TURN_MS;
    this.endsAt = Date.now() + ms;
    this.host.buzz(id, [120, 80, 120]);
    this.after(ms + (ms === CLUE_MS ? GRACE_MS : 0), () => this.timeOut());
    this.update();
  }

  private timeOut() {
    if (this.phase !== 'clue') return;
    this.r.skip();
    sound.wrong();
    this.startTurn();
  }

  private startVote() {
    this.phase = 'vote';
    this.key++;
    this.endsAt = Date.now() + VOTE_MS;
    sound.whistle();
    this.after(VOTE_MS + GRACE_MS, () => this.startReveal());
    this.update();
  }

  private startReveal() {
    if (this.phase !== 'vote') return;
    this.r.lock();
    this.revealVotes = shuffle([...this.r.votes]);
    this.phase = 'reveal';
    this.revealStage = 'intro';
    this.shown = 0;
    this.key++;
    sound.whoosh();
    this.after(REVEAL_INTRO_MS, () => this.revealVote());
    this.update();
  }

  private revealVote() {
    if (this.phase !== 'reveal') return;
    if (this.shown < this.revealVotes.length) {
      this.revealStage = 'votes';
      this.shown++;
      sound.note(330 * 1.06 ** this.shown, 0.12, { type: 'triangle', vol: 0.35 });
      this.later(260, () => sound.plop());
      this.after(VOTE_STEP_MS, () => this.revealVote());
    } else {
      this.revealStage = 'tally';
      sound.bell();
      this.after(TALLY_MS, () => this.drum());
    }
    this.host.changed();
  }

  private drum() {
    if (this.phase !== 'reveal') return;
    this.revealStage = 'drum';
    sound.drumroll(DRUM_MS / 1000 - 0.2);
    this.after(DRUM_MS, () => this.unmask());
    this.host.changed();
  }

  private unmask() {
    if (this.phase !== 'reveal') return;
    this.revealStage = 'unmask';
    if (this.r.caught) {
      sound.fanfare();
      this.host.buzz(this.r.spy, [300, 100, 300]);
    } else {
      // A sneaky little walk down the scale: the spy got away.
      [392, 370, 349, 330, 311].forEach((f, i) => sound.note(f, 0.16, { type: 'square', vol: 0.18, delay: i * 0.14 }));
    }
    this.after(UNMASK_MS, () => (this.r.caught ? this.startGuess() : this.showResult()));
    this.update();
  }

  private startGuess() {
    if (this.phase !== 'reveal') return;
    this.phase = 'guess';
    this.guessDone = false;
    this.key++;
    this.endsAt = Date.now() + GUESS_MS;
    sound.reveal();
    this.after(GUESS_MS + GRACE_MS, () => this.endGuess());
    this.update();
  }

  private endGuess() {
    if (this.phase !== 'guess' || this.guessDone) return;
    this.guessDone = true;
    if (this.r.guessedRight) sound.correct();
    else sound.crash();
    this.after(GUESSED_MS, () => this.showResult());
    this.update();
  }

  private showResult() {
    if (this.phase === 'result') return;
    const pts = this.r.settle();
    this.outcome = this.r.outcome();
    this.roundPts = pts;
    for (const [id, p] of Object.entries(pts)) if (id in this.scores) this.scores[id] += p;
    for (const [id, p] of Object.entries(pts)) if (p > 0) this.host.buzz(id, [60, 60, 60]);
    this.phase = 'result';
    this.key++;
    this.later(500, () => (this.outcome === 'void' ? sound.whoosh() : sound.fanfare()));
    this.after(RESULT_MS, () => (this.round < this.rounds ? this.startRound() : this.host.finish({ ...this.scores })));
    this.update();
  }

  private maybeAdvance() {
    if (this.phase !== 'vote') return;
    const active = this.r.ids.filter((id) => this.connected(id));
    if (active.length > 0 && active.every((id) => this.r.votes.has(id))) this.after(1000, () => this.startReveal());
  }

  // ---- phones ---------------------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'ask' || m.key !== this.key || !this.r.ids.includes(id)) return;
    if (this.phase === 'clue' && id === this.r.current) {
      const res = this.r.giveClue(id, m.text);
      if (!res.ok) {
        this.clueError.set(id, res.error);
        this.host.buzz(id, [200]);
        this.host.refresh(id);
        return;
      }
      sound.lockIn();
      this.startTurn();
    } else if (this.phase === 'vote' && typeof m.i === 'number') {
      const target = this.r.candidates(id)[m.i];
      if (!target || !this.r.vote(id, target)) return;
      sound.lockIn();
      this.update();
      this.maybeAdvance();
    } else if (this.phase === 'guess' && id === this.r.spy && !this.guessDone && typeof m.i === 'number') {
      if (!this.r.guessWord(m.i)) return;
      this.endGuess();
    }
  }

  onConnection(id: string, connected: boolean) {
    // The player whose turn it is dropped out: don't keep everybody waiting for long.
    if (!connected && this.phase === 'clue' && id === this.r.current && this.endsAt - Date.now() > OFFLINE_TURN_MS) {
      this.endsAt = Date.now() + OFFLINE_TURN_MS;
      this.after(OFFLINE_TURN_MS, () => this.timeOut());
      this.host.refresh();
    }
    this.maybeAdvance();
    this.host.changed();
  }

  onRemoved(id: string) {
    if (!this.ids.includes(id)) return;
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    delete this.roundPts[id];
    const what = this.r.remove(id);
    if (this.ids.length < 2) {
      this.dispose();
      this.host.finish({ ...this.scores });
      return;
    }
    if (what === 'spy' && this.phase !== 'result') {
      // No spy, no round: on to the next one, without points.
      this.showResult();
      return;
    }
    if (what === 'current' && this.phase === 'clue') {
      this.startTurn();
      return;
    }
    if (this.phase === 'vote') {
      // The choices changed (and votes for them were dropped).
      this.key++;
      this.maybeAdvance();
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const r = this.r;
    const spy = id === r.spy;
    const base = { v: 'ask' as const, game: 'spy' as const, key: this.key, note: `Round ${this.round} / ${this.rounds}`, score: this.scores[id] ?? 0 };
    const cat = `${r.category.icon} ${r.category.name}`;
    const secret = word(r.category.words[r.word]);
    const clueLine = () => {
      const said = r.clues.map((c) => c.text).filter((t) => t !== SKIPPED);
      return said.length ? `Clues so far: ${said.join(' · ')}` : 'No clues yet.';
    };
    const reminder = spy ? `You’re the spy 🕵️ · Category: ${cat}` : `Your word: ${secret} · ${cat}`;
    if (!r.ids.includes(id)) return { v: 'wait', title: 'Watch the TV!', icon: 'spy' };
    const wait = (title: string, text?: string, extra: Partial<AskView> = {}): AskView => ({ ...base, title, ...(text ? { text } : {}), input: { k: 'none', mood: 'happy' }, ...extra });

    switch (this.phase) {
      case 'card':
        return spy
          ? {
              ...base,
              title: 'You’re the SPY 🕵️ – blend in!',
              text: `Category: ${cat}. Everyone else knows the secret word. Listen to their clues and fake it!`,
              accent: '#ff7a8a',
              endsAt: this.endsAt,
              input: { k: 'none', big: '🕵️', mood: 'wow' },
            }
          : {
              ...base,
              title: 'Your secret word',
              text: `Category: ${cat}. One of you is the spy – don’t show your phone!`,
              accent: '#ffc93c',
              endsAt: this.endsAt,
              input: { k: 'none', big: secret, mood: 'happy' },
            };
      case 'clue': {
        if (id === r.current) {
          return {
            ...base,
            title: 'Your turn: one word!',
            text: `${reminder}. ${clueLine()}`,
            accent: spy ? '#ff7a8a' : '#ffc93c',
            endsAt: this.endsAt,
            input: { k: 'text', placeholder: 'One word', max: MAX_CLUE, sent: null, button: 'Say it', ...(this.clueError.has(id) ? { error: this.clueError.get(id) } : {}) },
          };
        }
        const mine = r.order.slice(r.turn).indexOf(id);
        return wait(`${this.name(r.current)} is thinking…`, `${reminder}. ${clueLine()}${mine > 0 ? ` You’re up in ${mine} turn${mine === 1 ? '' : 's'}.` : ''}`, { endsAt: this.endsAt });
      }
      case 'vote': {
        if (r.votes.has(id)) return wait(`You voted for ${this.name(r.votes.get(id))}`, 'Waiting for the others…', { endsAt: this.endsAt });
        return {
          ...base,
          title: spy ? 'Who do you blame? 🕵️' : 'Who is the spy?',
          text: spy ? 'Vote like you don’t know. Point at somebody else!' : `Your word was ${secret}. Who didn’t seem to know it?`,
          endsAt: this.endsAt,
          input: {
            k: 'choice',
            picked: null,
            options: r.candidates(id).map((c) => {
              const p = this.host.player(c);
              const said = r
                .cluesBy(c)
                .map((x) => x.text)
                .join(' · ');
              return { label: p?.name ?? '?', sub: said ? `said: ${said}` : undefined, color: p ? colorHex(p.color) : undefined };
            }),
          },
        };
      }
      case 'reveal':
        if (this.revealStage === 'unmask')
          return spy
            ? wait(r.caught ? 'Caught! 😱' : 'You got away! 🕵️', r.caught ? 'Get ready to guess the word…' : 'Nobody pinned it on you.', { input: { k: 'none', mood: r.caught ? 'dead' : 'wow' } })
            : wait(r.caught ? `${this.name(r.spy)} was the spy!` : `The spy was ${this.name(r.spy)}!`, r.caught ? 'Caught! But they get one last guess…' : 'The spy escaped…');
        return wait('Look at the TV!', 'Here come the votes…', { input: { k: 'none', mood: 'wow' } });
      case 'guess':
        if (spy && !this.guessDone) {
          return {
            ...base,
            title: 'Last chance! Which word is it?',
            text: `Category: ${cat}. Guess right and you steal the round.`,
            accent: '#ff7a8a',
            endsAt: this.endsAt,
            input: { k: 'choice', grid: true, picked: null, options: r.category.words.map((w) => ({ label: word(w) })) },
          };
        }
        if (this.guessDone) return wait(r.guessedRight ? 'The spy guessed it!' : 'Wrong guess!', `The word was ${secret}.`);
        return wait(`${this.name(r.spy)} is guessing the word…`, 'Fingers crossed!', { endsAt: this.endsAt });
      case 'result': {
        const pts = this.roundPts[id] ?? 0;
        const title =
          this.outcome === 'void'
            ? 'The spy left – no points'
            : spy
              ? this.outcome === 'escaped'
                ? 'You escaped! 🕵️'
                : this.outcome === 'stole'
                  ? 'You stole the round!'
                  : 'Caught red-handed!'
              : this.outcome === 'caught'
                ? 'Spy caught!'
                : this.outcome === 'stole'
                  ? 'The spy stole it!'
                  : 'The spy got away!';
        return {
          ...base,
          title,
          text: this.outcome === 'void' ? 'On to the next round.' : `The word was ${secret}. ${this.round < this.rounds ? 'Next round coming up…' : 'That was the last round!'}`,
          input: { k: 'none', big: `+${pts}`, good: pts > 0, mood: pts > 0 ? 'wow' : 'dead' },
        };
      }
    }
  }

  // ---- debug (the dev bench's `window.spy`) ----------------------------------------------------------

  /** Do whatever the phones would do next: a clue, everybody's vote (for the spy, or `target`), a guess. */
  debugStep(opts: { target?: string; right?: boolean } = {}) {
    const sample = ['crispy', 'golden', 'Babcia', 'boiled', 'Sunday', 'cheesy', 'yum', 'kitchen'];
    if (this.phase === 'card') this.after(0, () => this.startClues());
    else if (this.phase === 'clue' && this.r.current) this.onMessage(this.r.current, { t: 'ask', key: this.key, text: sample[this.r.turn % sample.length] });
    else if (this.phase === 'vote') {
      for (const id of this.r.ids) {
        const c = this.r.candidates(id);
        const t = opts.target && c.includes(opts.target) ? opts.target : c.includes(this.r.spy) ? this.r.spy : c[0];
        this.onMessage(id, { t: 'ask', key: this.key, i: c.indexOf(t) });
      }
    } else if (this.phase === 'guess') this.onMessage(this.r.spy, { t: 'ask', key: this.key, i: opts.right ? this.r.word : (this.r.word + 1) % 16 });
  }

  // ---- TV -------------------------------------------------------------------------------------------

  render() {
    const r = this.r;
    const seats = r.seats.filter((id) => r.ids.includes(id));
    const n = Math.max(1, seats.length);
    const seatW = Math.min(300, Math.floor((TABLE_W - SEAT_GAP * (n - 1)) / n));
    const unmasked = (this.phase === 'reveal' && this.revealStage === 'unmask') || this.phase === 'guess' || (this.phase === 'result' && this.outcome !== 'void');
    const timer = (total: number) => (
      <TimerRing key={`${this.phase}.${this.round}.${r.turn}.${this.key}`} endsAt={this.endsAt} total={total} size={120} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />
    );
    const showTimer = this.phase === 'card' || this.phase === 'clue' || this.phase === 'vote' || (this.phase === 'guess' && !this.guessDone);
    const total = this.phase === 'card' ? CARD_MS : this.phase === 'clue' ? (this.connected(r.current) ? CLUE_MS : OFFLINE_TURN_MS) : this.phase === 'vote' ? VOTE_MS : GUESS_MS;

    return (
      <div class={`screen spy phase-${this.phase}`} key={`spy${this.round}`}>
        <div class="quiz-top">
          <div class="pill">
            Round {this.round} / {this.rounds}
          </div>
          <div class="pill pill-cat spy-cat">
            <span>{r.category.icon}</span> {r.category.name}
          </div>
          {this.phase === 'clue' && r.laps > 1 && (
            <div class="pill">
              Lap {Math.min(r.laps, r.lap + 1)} / {r.laps}
            </div>
          )}
          <div class="grow" />
          {showTimer && timer(total)}
        </div>
        {this.phase === 'guess' ? this.guessView() : this.tableView(seats, seatW, unmasked)}
        <div class="spy-foot">{this.footText()}</div>
        {this.phase === 'result' && this.banner(seats)}
      </div>
    );
  }

  private footText() {
    switch (this.phase) {
      case 'card':
        return '🤫 Phones down – don’t show anybody your secret card!';
      case 'clue':
        return '🤫 Don’t show your phone · one word each: clear enough for friends, vague enough to fool the spy';
      case 'vote':
        return '🗳️ Vote on your phone · a tie and the spy escapes!';
      default:
        return '';
    }
  }

  private head() {
    const r = this.r;
    const pc = (id: string | undefined) => colorHex(this.host.player(id ?? '')?.color ?? 'sourcream');
    switch (this.phase) {
      case 'card':
        return (
          <div class="spy-head" key="card">
            <Candle />
            <div class="spy-head-text">
              <div class="spy-big">Look at your secret card</div>
              <div class="spy-small">Everybody knows the word… except the spy 🕵️</div>
            </div>
            <Candle />
          </div>
        );
      case 'clue':
        return (
          <div class="spy-head" key={`t${r.turn}`}>
            <div class="spy-head-text">
              <div class="spy-big">
                <b style={{ color: pc(r.current) }}>{this.name(r.current)}</b>
                {this.connected(r.current) ? ', your clue!' : ' is away – skipping'}
              </div>
              <div class="spy-small">One word about the secret word</div>
            </div>
          </div>
        );
      case 'vote':
        return (
          <div class="spy-head" key="vote">
            <div class="spy-head-text">
              <div class="spy-big">Who is the spy?</div>
              <div class="spy-small">
                {r.votes.size} / {r.ids.length} voted
              </div>
            </div>
          </div>
        );
      case 'reveal': {
        const t = r.tally;
        let big = 'The votes are in…';
        let small = '';
        if (this.revealStage === 'votes') small = `${this.shown} / ${this.revealVotes.length}`;
        if (this.revealStage === 'tally' || this.revealStage === 'drum') {
          big = !t || t.top.length === 0 ? 'Nobody voted!' : t.top.length > 1 ? 'A tie!' : `Most votes: ${this.name(t.top[0])}`;
          small = this.revealStage === 'drum' ? 'And the spy is…' : t && t.top.length > 1 ? 'A tie lets the spy slip away…' : '';
        }
        if (this.revealStage === 'unmask') {
          big = r.caught ? `Caught! ${this.name(r.spy)} was the spy!` : `The spy was ${this.name(r.spy)}!`;
          small = r.caught ? 'One last chance: guess the secret word…' : 'The spy escapes! 🕵️';
        }
        return (
          <div class={`spy-head stage-${this.revealStage}`} key={`r${this.revealStage}`}>
            <div class="spy-head-text">
              <div class={`spy-big ${this.revealStage === 'unmask' ? (r.caught ? 'good' : 'bad') : ''}`}>{big}</div>
              <div class="spy-small">{small}</div>
            </div>
            {(this.revealStage === 'intro' || this.revealStage === 'votes') && <div class="spy-ballot">🗳️</div>}
          </div>
        );
      }
      case 'result':
        return <div class="spy-head" />;
      default:
        return null;
    }
  }

  private tableView(seats: string[], seatW: number, unmasked: boolean) {
    const r = this.r;
    const n = seats.length;
    const voting = this.phase === 'reveal' || this.phase === 'result';
    const shownVotes = this.phase === 'result' ? this.revealVotes : this.revealVotes.slice(0, this.shown);
    const tallyOn = (this.phase === 'reveal' && this.revealStage !== 'intro' && this.revealStage !== 'votes') || this.phase === 'result';
    return (
      <>
        {this.head()}
        <div class={`spy-table laps${r.laps}`} style={{ '--seat-w': `${seatW}px`, '--seat-gap': `${SEAT_GAP}px` }}>
          <div class="spy-cloth" />
          {seats.map((id, i) => {
            const p = this.host.player(id);
            const color = colorHex(p?.color ?? 'sourcream');
            const current = this.phase === 'clue' && r.current === id;
            const isSpy = unmasked && id === r.spy;
            const x = (i - (n - 1) / 2) * (seatW + SEAT_GAP);
            const mine = shownVotes.filter(([, t]) => t === id);
            const top = tallyOn && !!r.tally && r.tally.top.includes(id);
            const mood = !p?.connected ? 'sleep' : isSpy ? (r.caught ? 'dead' : 'wow') : current ? 'wow' : unmasked ? 'happy' : 'happy';
            return (
              <div
                class={`spy-seat ${current ? 'current' : ''} ${isSpy ? 'unmasked' : ''} ${unmasked && !isSpy ? 'dim' : ''} ${top ? 'top' : ''} ${p?.connected ? '' : 'offline'}`}
                style={{ '--pc': color }}
                key={id}
              >
                <div class="spy-votes">
                  {voting &&
                    mine.map(([voter]) => {
                      const v = this.host.player(voter);
                      return v ? (
                        <span class="spy-token" key={voter} style={{ '--fx': `${-x}px`, '--fy': '-260px' }}>
                          <Pierogi color={colorHex(v.color)} size={40} />
                        </span>
                      ) : null;
                    })}
                  {this.phase === 'vote' && r.votes.has(id) && <span class="spy-voted pop-in">✓ voted</span>}
                </div>
                <div class="spy-avatar">
                  {tallyOn && r.tally && (
                    <span class={`spy-count pop-in ${top ? 'top' : ''}`} key="count">
                      {r.tally.counts[id] ?? 0}
                    </span>
                  )}
                  {current && <span class="spy-bubble">…</span>}
                  <Pierogi color={color} size={Math.min(130, seatW * 0.62)} mood={mood} class={current ? 'bob' : ''} />
                  {isSpy && <Disguise />}
                </div>
                <div class="spy-name">{p?.name ?? '?'}</div>
                <div class="spy-score">{(this.scores[id] ?? 0).toLocaleString('en-US')} pts</div>
                <div class="spy-clues">
                  {Array.from({ length: r.laps }, (_, lap) => {
                    const c = r.clues.find((x) => x.id === id && x.lap === lap);
                    if (!c) return <div class={`spy-clue empty ${current && r.lap === lap ? 'now' : ''}`} key={`e${lap}`} />;
                    const len = [...c.text].length;
                    const size = Math.max(18, Math.min(42, Math.floor((seatW - 34) / (0.62 * Math.max(1, len)))));
                    return (
                      <div class={`spy-clue card-paper ${c.skipped ? 'skipped' : ''}`} key={`c${lap}`} style={{ fontSize: `${size}px` }}>
                        {c.text}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  private guessView() {
    const r = this.r;
    const p = this.host.player(r.spy);
    const color = colorHex(p?.color ?? 'sourcream');
    return (
      <div class="spy-guess">
        <div class="spy-guess-side">
          <div class="spy-avatar big">
            <Pierogi color={color} size={220} mood={this.guessDone ? (r.guessedRight ? 'wow' : 'dead') : 'wow'} class={this.guessDone ? '' : 'bob'} />
            <Disguise />
          </div>
          <div class="spy-guess-name" style={{ color }}>
            {p?.name ?? '?'}
          </div>
          <div class="spy-guess-line">
            {!this.guessDone
              ? 'Caught! Last chance: which word is it?'
              : r.guess === null
                ? 'Too slow! No guess.'
                : r.guessedRight
                  ? 'Right! The spy steals the round!'
                  : 'Wrong! The spy is out of luck.'}
          </div>
        </div>
        <div class="spy-grid">
          {r.category.words.map((w, i) => {
            const cls = this.guessDone ? (i === r.word ? 'truth' : i === r.guess ? 'wrong' : 'dim') : '';
            return (
              <div class={`spy-tile card-paper ${cls}`} style={{ animationDelay: `${i * 40}ms` }} key={i}>
                {w.e && <span class="spy-tile-e">{w.e}</span>}
                <span class="spy-tile-w">{w.w}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  private banner(seats: string[]) {
    const r = this.r;
    const secret = r.category.words[r.word];
    const spyName = this.name(r.spy);
    const big =
      this.outcome === 'void'
        ? 'The spy left the party!'
        : this.outcome === 'escaped'
          ? `${spyName} the spy got away!`
          : this.outcome === 'stole'
            ? `${spyName} stole the round!`
            : `${spyName} the spy is caught!`;
    const order = [...seats].sort((a, b) => (this.roundPts[b] ?? 0) - (this.roundPts[a] ?? 0));
    return (
      <div class="trails-banner spy-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · the secret word was
        </div>
        <div class="spy-banner-word">
          {secret?.e && <span>{secret.e}</span>} {secret?.w}
        </div>
        <div class="trails-banner-big spy-banner-big">{big}</div>
        {this.outcome === 'void' ? (
          <div class="trails-banner-small">No points this round.</div>
        ) : (
          <div class="spy-banner-list">
            {order.map((id) => {
              const p = this.host.player(id);
              const pts = this.roundPts[id] ?? 0;
              return p ? (
                <div class={`spy-banner-row ${pts > 0 ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }} key={id}>
                  <Pierogi color={colorHex(p.color)} size={38} mood={pts > 0 ? 'wow' : 'dead'} />
                  <span class="grow">
                    {p.name}
                    {id === r.spy ? ' 🕵️' : ''}
                  </span>
                  <b>+{pts}</b>
                </div>
              ) : null;
            })}
          </div>
        )}
        <div class="trails-banner-small spy-next">{this.round < this.rounds ? 'A new spy is being picked…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A fedora and dark glasses, drawn over a pierogi (same 120 × 96 box). */
function Disguise() {
  return (
    <svg class="spy-disguise" viewBox="0 0 120 96" aria-hidden="true">
      <g class="spy-hat">
        <ellipse cx="60" cy="22" rx="50" ry="9" fill="#2b2b33" stroke="#120a0c" stroke-width="3" />
        <path d="M 34 22 Q 34 -8 60 -6 Q 86 -8 86 22 Z" fill="#3b3b46" stroke="#120a0c" stroke-width="3" stroke-linejoin="round" />
        <path d="M 35 14 Q 60 20 85 14 L 86 21 Q 60 26 34 21 Z" fill="#e8335a" />
        <path d="M 52 -2 Q 60 6 68 -2" fill="none" stroke="#120a0c" stroke-width="3" stroke-linecap="round" />
      </g>
      <g class="spy-glasses">
        <path d="M 30 47 H 90" stroke="#120a0c" stroke-width="4" />
        <rect x="29" y="42" width="27" height="17" rx="6" fill="#120a0c" />
        <rect x="64" y="42" width="27" height="17" rx="6" fill="#120a0c" />
        <path d="M 34 46 l 8 0" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".6" />
        <path d="M 69 46 l 8 0" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".6" />
      </g>
    </svg>
  );
}

/** A little candle on Babcia's table. */
function Candle() {
  return (
    <svg class="spy-candle" width="60" height="110" viewBox="0 0 60 110" aria-hidden="true">
      <ellipse cx="30" cy="104" rx="26" ry="6" fill="#c98a00" />
      <rect x="18" y="44" width="24" height="60" rx="5" fill="#fbf0d9" stroke="#2a120a" stroke-width="3" />
      <path d="M 22 50 q 4 10 0 18" fill="none" stroke="#ead7b0" stroke-width="3" stroke-linecap="round" />
      <path d="M 30 44 v -8" stroke="#2a120a" stroke-width="3" stroke-linecap="round" />
      <path class="spy-flame" d="M 30 6 C 40 20 40 32 30 36 C 20 32 20 20 30 6 Z" fill="#ffc93c" stroke="#e8335a" stroke-width="2.5" />
    </svg>
  );
}
