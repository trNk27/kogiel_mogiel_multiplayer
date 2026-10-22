import sentences from '../../../../data/telephone.json';
import { colorHex, type AskInput, type AskView, type ColorId, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { usedSet } from '../usedStore';
import { Doodle } from '../toty/art';
import { Leaderboard, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import {
  DRAW_ANYTHING,
  TEL_MAX_TEXT,
  TEL_VOTE_MS,
  TEL_VOTE_POINTS,
  Telephone,
  pickSentences,
  revealMs,
  seating,
  stepKind,
  stepMs,
  type ChainVotes,
  type Entry,
  type StepKind,
  type TelSentence,
} from './logic';
import './telephone.css';

const POOL = sentences as TelSentence[];
const used = usedSet('telephone');
/** Phones hand in what they have just before the deadline; give it time to arrive. */
const GRACE_MS = 2500;
/** "Pass it on!" between steps. */
const PASS_MS = 2200;
/** The vote result of a chain. */
const VOTES_MS = 5500;
const FINAL_MS = 7000;
/** Once everyone is in, wait this long before moving on. */
const ALL_IN_MS = 1200;

type Phase = 'step' | 'pass' | 'show' | 'vote' | 'votes' | 'final';

const KIND_ICON: Record<StepKind, string> = { write: '✍️', draw: '🎨', describe: '💬' };
const KIND_VERB: Record<StepKind, string> = { write: 'Writing…', draw: 'Drawing…', describe: 'Guessing…' };

export class TelephoneGame implements Game {
  readonly id = 'telephone' as const;
  private readonly tel: Telephone;
  private phase: Phase = 'step';
  private key = 1;
  private endsAt = 0;
  private timer: number | undefined;
  /** Sentences for "🎲 Pick for me" (and for players whose time ran out on the first step). */
  private dice: string[] = [];
  /** The chain on the TV, and how many of its entries are shown. */
  private chain = 0;
  private shown = 0;
  private result: ChainVotes = { counts: [], points: {}, voters: [] };
  private finished = false;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.tel = new Telephone(seating(ids), host.short);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, TelephoneGame>).telephone = this;
    this.dice = pickSentences(POOL, used, Math.max(this.tel.n * 3, 12));
    this.startStep();
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

  private player(id: string) {
    return this.host.player(id);
  }

  private connected(id: string) {
    return !!this.player(id)?.connected;
  }

  private nextSentence(): string {
    if (!this.dice.length) this.dice = pickSentences(POOL, used, 12);
    return this.dice.shift() ?? 'A pierogi riding a bicycle';
  }

  // ---- flow ---------------------------------------------------------------------------

  private startStep() {
    this.phase = 'step';
    this.key++;
    const ms = stepMs(this.tel.step);
    this.endsAt = Date.now() + ms;
    if (this.tel.step === 0) sound.go();
    else sound.reveal();
    this.after(ms + GRACE_MS, () => this.endStep());
    this.update();
    this.maybeAdvance();
  }

  private endStep() {
    if (this.phase !== 'step') return;
    this.tel.endStep(() => this.nextSentence());
    if (this.tel.done) {
      this.startShow();
      return;
    }
    this.phase = 'pass';
    this.key++;
    sound.whoosh();
    this.after(PASS_MS, () => this.startStep());
    this.update();
  }

  private startShow() {
    this.chain = -1;
    this.nextChain();
  }

  private nextChain() {
    this.chain++;
    if (this.chain >= this.tel.n) {
      this.showFinal();
      return;
    }
    this.phase = 'show';
    this.shown = 0;
    this.revealNext();
  }

  /** Show the next entry of the chain (or go to the vote after the last). */
  private revealNext() {
    if (this.phase !== 'show') return;
    const entries = this.tel.chains[this.chain];
    this.shown++;
    if (this.shown > entries.length) {
      this.startVote();
      return;
    }
    this.key++;
    const e = entries[this.shown - 1];
    if (e.empty) sound.wrong();
    else if (e.kind === 'draw') sound.whoosh();
    else sound.plop();
    this.after(revealMs(e, this.shown === 1), () => this.revealNext());
    this.update();
  }

  private startVote() {
    this.phase = 'vote';
    this.key++;
    this.endsAt = Date.now() + TEL_VOTE_MS;
    sound.bell();
    this.after(TEL_VOTE_MS + 800, () => this.endVote());
    this.update();
    this.maybeAdvance();
  }

  private endVote() {
    if (this.phase !== 'vote') return;
    this.result = this.tel.tally(this.chain);
    this.phase = 'votes';
    this.key++;
    const any = this.result.counts.some((c) => c > 0);
    if (any) sound.fanfare();
    else sound.wrong();
    for (const [id, pts] of Object.entries(this.result.points)) if (pts > 0) this.host.buzz(id, [60, 60, 60]);
    this.after(VOTES_MS, () => this.nextChain());
    this.update();
  }

  private showFinal() {
    this.phase = 'final';
    this.key++;
    sound.fanfare();
    this.after(FINAL_MS, () => this.finish());
    this.update();
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.host.finish(this.tel.scores());
  }

  /** Move on early once everybody who can still answer has. */
  private maybeAdvance() {
    if (this.phase === 'step') {
      // Disconnected players don't hold the others up (their step times out with an empty entry).
      const live = this.tel.active.filter((id) => this.connected(id));
      if (live.length > 0 && live.every((id) => this.tel.has(id))) this.after(ALL_IN_MS, () => this.endStep());
    } else if (this.phase === 'vote') {
      const voters = this.tel.active.filter((id) => this.tel.canVote(this.chain, id));
      const live = voters.filter((id) => this.connected(id));
      if (voters.length === 0) this.after(1500, () => this.endVote());
      else if (live.length > 0 && live.every((id) => this.tel.votes[this.chain].has(id))) this.after(ALL_IN_MS, () => this.endVote());
    }
  }

  // ---- phones -------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (!this.ids.includes(id) || m.t !== 'ask' || m.key !== this.key) return;
    if (this.phase === 'step') {
      const ok = this.tel.submit(id, { text: m.text, strokes: m.strokes, auto: m.auto ? this.nextSentence() : undefined });
      if (!ok) return;
      sound.lockIn();
      this.host.refresh(id);
      this.host.changed();
      this.maybeAdvance();
    } else if (this.phase === 'vote') {
      if (!this.tel.vote(this.chain, id, m.i)) return;
      sound.lockIn();
      this.host.refresh(id);
      this.host.changed();
      this.maybeAdvance();
    } else if (this.phase === 'show' && id === this.vip() && m.i === 0) {
      this.revealNext();
    }
  }

  private vip(): string | null {
    const v = this.host.vipId?.() ?? null;
    return v && this.ids.includes(v) ? v : null;
  }

  onConnection() {
    this.maybeAdvance();
    this.host.changed();
  }

  onRemoved(id: string) {
    if (!this.ids.includes(id)) return;
    this.ids = this.ids.filter((x) => x !== id);
    this.tel.remove(id);
    if (this.ids.length === 0) {
      this.finish();
      return;
    }
    this.onConnection();
    this.host.refresh();
  }

  viewFor(id: string): PhoneView {
    const base = { v: 'ask' as const, game: 'telephone' as const, key: this.key };
    const wait = (title: string, text?: string, mood: 'happy' | 'wow' | 'sleep' = 'happy', extra: Partial<AskView> = {}): AskView => ({
      ...base,
      title,
      ...(text ? { text } : {}),
      ...extra,
      input: { k: 'none', mood },
    });
    const steps = this.tel.steps;
    const score = this.tel.scores(this.phase === 'votes' || this.phase === 'final' ? this.chain : this.chain - 1)[id] ?? 0;
    switch (this.phase) {
      case 'step': {
        const t = this.tel.task(id);
        const note = `Step ${this.tel.step + 1} / ${steps}`;
        if (!t) return wait('Look at the TV!', 'The others are busy.', 'sleep', { note });
        const mine = this.tel.current(id);
        if (t.kind === 'draw') {
          return { ...base, note: `${note} · draw it!`, title: 'Draw it!', endsAt: this.endsAt, input: { k: 'draw', prompt: t.prompt || DRAW_ANYTHING, sent: !!mine } };
        }
        const input: AskInput = {
          k: 'text',
          max: TEL_MAX_TEXT,
          sent: mine ? (mine.text ?? '') : null,
          button: 'Pass it on',
          placeholder: t.kind === 'write' ? 'A goose stealing Babcia’s pierogi' : 'A cat conducting an orchestra',
          ...(t.kind === 'write' ? { auto: '🎲 Pick for me' } : {}),
        };
        if (t.kind === 'write') {
          return { ...base, note, title: 'Write a sentence', text: 'Something silly for the next player to draw.', accent: '#ffc93c', endsAt: this.endsAt, input };
        }
        return {
          ...base,
          note,
          title: 'What is this?',
          text: t.pic?.length ? 'Describe the drawing in a few words.' : 'A blank page! Make something up.',
          accent: '#4f9dff',
          endsAt: this.endsAt,
          pic: t.pic ?? [],
          input,
        };
      }
      case 'pass':
        return wait('Pass it on!', `Next: ${KIND_ICON[stepKind(this.tel.step)]} ${stepKind(this.tel.step) === 'draw' ? 'draw what you get' : 'say what you see'}`, 'wow', {
          note: `Step ${this.tel.step + 1} / ${steps}`,
        });
      case 'show': {
        const note = `Chain ${this.chain + 1} / ${this.tel.n}`;
        if (id === this.vip()) {
          return {
            ...base,
            note,
            title: 'Look at the TV!',
            text: 'It moves on by itself, or tap when everyone has had a laugh.',
            input: { k: 'choice', options: [{ label: 'Next ▶', color: '#ffc93c' }], picked: null },
          };
        }
        return wait('Look at the TV!', `${this.name(this.tel.seats[this.chain])}’s chain`, 'happy', { note });
      }
      case 'vote': {
        const note = `Chain ${this.chain + 1} / ${this.tel.n} · vote`;
        if (!this.tel.canVote(this.chain, id)) return wait('The others are voting', 'Nothing for you to vote for here.', 'sleep', { note, score });
        const can = this.tel.canPick(this.chain, id);
        return {
          ...base,
          note,
          score,
          title: 'Your favourite?',
          text: '+100 for its author',
          endsAt: this.endsAt,
          input: {
            k: 'choice',
            options: this.tel.chains[this.chain].map((e, i) => ({
              label: `${i + 1} · ${e.kind === 'draw' ? `🎨 ${this.name(e.by)}’s drawing` : `“${e.text ?? ''}”`}`,
              sub: e.by === id ? 'yours' : e.kind === 'draw' ? undefined : this.name(e.by),
              off: !can[i],
            })),
            picked: this.tel.votes[this.chain].get(id) ?? null,
          },
        };
      }
      case 'votes': {
        const pts = this.result.points[id] ?? 0;
        return {
          ...base,
          note: `Chain ${this.chain + 1} / ${this.tel.n}`,
          score,
          title: pts ? 'They liked yours!' : 'No votes for you this time',
          input: { k: 'none', mood: pts ? 'wow' : 'happy', big: pts ? `+${pts}` : undefined, good: pts > 0 },
        };
      }
      case 'final':
        return wait('That’s every chain!', 'Final scores on the TV.', 'happy', { score });
    }
  }

  private name(id: string | undefined) {
    return (id && this.player(id)?.name) || '?';
  }

  private color(id: string | undefined): ColorId {
    return (id && this.player(id)?.color) || 'sourcream';
  }

  // ---- TV -------------------------------------------------------------------------------

  render() {
    switch (this.phase) {
      case 'step':
      case 'pass':
        return this.renderStep();
      case 'show':
        return this.renderShow();
      case 'vote':
      case 'votes':
        return this.renderVote();
      case 'final':
        return this.renderFinal();
    }
  }

  private track() {
    const steps = this.tel.steps;
    return (
      <div class="tel-track">
        {Array.from({ length: steps }, (_, s) => {
          const state = s < this.tel.step ? 'done' : s === this.tel.step && this.phase === 'step' ? 'now' : '';
          return (
            <>
              {s > 0 && <span class={`tel-track-line ${s <= this.tel.step ? 'done' : ''}`} />}
              <span class={`tel-track-step ${state}`}>{KIND_ICON[stepKind(s)]}</span>
            </>
          );
        })}
      </div>
    );
  }

  private renderStep() {
    const passing = this.phase === 'pass';
    const kind = stepKind(this.tel.step);
    const total = stepMs(this.tel.step);
    const heads: Record<StepKind, [string, string]> = {
      write: ['Write a silly sentence!', 'The next player has to draw it – then it goes round the room'],
      draw: ['Draw the sentence you were handed!', 'No letters or numbers – just your best doodle'],
      describe: ['What’s in the drawing?', 'Say what you see – the next player draws your words'],
    };
    const [title, sub] = passing ? ['Pass it on!', `Next up: ${kind === 'draw' ? 'draw what you get' : 'say what you see'}`] : heads[kind];
    return (
      <div class="screen tel" key={`st${this.tel.step}${passing ? 'p' : ''}`}>
        <div class="quiz-top">
          <div class="pill">
            Step {Math.min(this.tel.step + 1, this.tel.steps)} / {this.tel.steps}
          </div>
          <div class="pill pill-cat">
            {KIND_ICON[kind]} {kind === 'write' ? 'Write' : kind === 'draw' ? 'Draw' : 'Describe'}
          </div>
          <div class="grow" />
          {!passing && <TimerRing key={`t${this.tel.step}`} endsAt={this.endsAt} total={total} size={130} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />}
        </div>
        {this.track()}
        <h2 class="bz-title tel-title">{title}</h2>
        <p class="bz-sub">{sub}</p>
        <div class={`tel-ring ${passing ? 'passing' : ''}`}>
          {this.tel.seats.map((id) => {
            const p = this.player(id);
            const gone = this.tel.left.has(id);
            const done = !passing && this.tel.has(id) && !gone;
            const status = gone ? 'Left' : passing ? '' : done ? 'Done' : KIND_VERB[kind];
            return (
              <div class={`answer-chip tel-chip ${done ? 'done' : ''} ${!p?.connected || gone ? 'offline' : ''}`}>
                <div class="tel-paper">{KIND_ICON[kind]}</div>
                <Pierogi color={colorHex(this.color(id))} size={64} mood={gone || !p?.connected ? 'sleep' : done ? 'happy' : 'wow'} />
                <span>{this.name(id)}</span>
                <b>{status || ' '}</b>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  private by(e: Entry, small = false) {
    return (
      <div class="tel-by" style={{ '--pc': colorHex(this.color(e.by)) }}>
        <Pierogi color={colorHex(this.color(e.by))} size={small ? 34 : 52} mood={e.empty ? 'sleep' : 'happy'} />
        <b>{this.name(e.by)}</b>
        {!small && <span class="muted-ink">{e.kind === 'write' ? (e.auto ? 'rolled the dice' : 'wrote') : e.kind === 'draw' ? 'drew' : 'guessed'}</span>}
      </div>
    );
  }

  /** One entry of a chain as a paper card: a sentence, a drawing or a placeholder. */
  private card(e: Entry, opts: { size: 'big' | 'mid' | 'small'; animate?: boolean; n?: number; key?: string }) {
    const { size, animate, n } = opts;
    const blank = e.kind === 'draw' && !e.strokes?.length;
    return (
      <div class={`tel-card tel-${size} tel-${e.kind} ${e.empty ? 'empty' : ''}`} key={opts.key}>
        {n !== undefined && <span class="tel-num">{n}</span>}
        {e.kind === 'draw' ? (
          <div class="tel-pic">
            <Doodle strokes={e.strokes ?? []} animate={animate} seconds={size === 'big' ? 3.8 : 2} />
            {blank && <span class="tel-blank">{e.empty === 'left' ? LEFT_LABEL : e.empty ? 'Time ran out' : 'A blank page'}</span>}
          </div>
        ) : (
          <div class="tel-text">{e.text}</div>
        )}
        {this.by(e, size === 'small')}
      </div>
    );
  }

  private renderShow() {
    const entries = this.tel.chains[this.chain];
    const cur = entries[this.shown - 1];
    const prev = entries[this.shown - 2];
    const owner = this.tel.seats[this.chain];
    if (!cur) return <div class="screen tel" />;
    return (
      <div class="screen tel" key={`sh${this.chain}`}>
        <div class="quiz-top">
          <div class="pill">
            Chain {this.chain + 1} / {this.tel.n}
          </div>
          <div class="pill tel-owner" style={{ '--pc': colorHex(this.color(owner)) }}>
            <Pierogi color={colorHex(this.color(owner))} size={40} /> {this.name(owner)}’s chain
          </div>
          <div class="grow" />
          {this.vip() && <div class="tel-hint">{this.name(this.vip() ?? undefined)} can tap Next ▶</div>}
        </div>
        <div class="tel-stage" key={`e${this.chain}.${this.shown}`}>
          {prev ? (
            <>
              <div class="tel-prev">{this.card(prev, { size: 'mid', key: `p${this.shown}` })}</div>
              <div class="tel-arrow">➜</div>
            </>
          ) : (
            <div class="tel-start">It started with…</div>
          )}
          <div class="tel-cur pop-in">{this.card(cur, { size: 'big', animate: true, key: `c${this.shown}` })}</div>
        </div>
        <div class="tel-strip">
          {entries.map((e, i) =>
            i < this.shown ? (
              <div class={`tel-thumb ${i === this.shown - 1 ? 'now' : ''}`}>
                <span class="tel-thumb-n">{i + 1}</span>
                {e.kind === 'draw' ? <Doodle strokes={e.strokes ?? []} /> : <span class="tel-thumb-text">{e.text}</span>}
              </div>
            ) : (
              <div class="tel-thumb hidden">
                <span class="tel-thumb-n">{i + 1}</span>
                {KIND_ICON[e.kind]}
              </div>
            ),
          )}
        </div>
      </div>
    );
  }

  private renderVote() {
    const entries = this.tel.chains[this.chain];
    const results = this.phase === 'votes';
    const top = results ? Math.max(0, ...this.result.counts) : 0;
    const voters = this.tel.active.filter((id) => this.tel.canVote(this.chain, id));
    const owner = this.tel.seats[this.chain];
    return (
      <div class="screen tel" key={`v${this.chain}`}>
        <div class="quiz-top">
          <div class="pill">
            Chain {this.chain + 1} / {this.tel.n}
          </div>
          <div class="pill pill-cat">{results ? 'Favourites' : '⭐ Vote!'}</div>
          <div class="grow" />
          {!results && <TimerRing key={`vt${this.chain}`} endsAt={this.endsAt} total={TEL_VOTE_MS} size={130} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />}
        </div>
        <h2 class="tel-vote-title">
          {results
            ? top > 0
              ? 'The room’s favourites'
              : 'Nobody voted!'
            : `From “${entries[0]?.text ?? ''}” to “${entries[entries.length - 1]?.kind === 'draw' ? '…this' : (entries[entries.length - 1]?.text ?? '')}”`}
        </h2>
        <div class={`tel-grid n${entries.length}`}>
          {entries.map((e, i) => {
            const count = this.result.counts[i] ?? 0;
            const win = results && top > 0 && count === top;
            return (
              <div class={`tel-cell ${win ? 'win' : ''} ${results && !count ? 'dim' : ''}`} style={{ animationDelay: `${i * 90}ms` }}>
                {this.card(e, { size: 'small', n: i + 1 })}
                {results && count > 0 && (
                  <div class="tel-votes pop-in">
                    <b>+{count * TEL_VOTE_POINTS}</b>
                    <span class="tel-voters">
                      {this.result.voters[i].map((v) => (
                        <Pierogi color={colorHex(this.color(v))} size={36} mood="wow" />
                      ))}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!results && (
          <div class="bp-hint tel-vote-hint">
            Vote for your favourite on your phone!
            <span class="bp-hint-count">
              {' '}
              {this.tel.votes[this.chain].size}/{voters.length} in
            </span>
          </div>
        )}
        {results && top === 0 && <p class="bz-sub">{this.name(owner)}’s chain goes home empty-handed.</p>}
      </div>
    );
  }

  private renderFinal() {
    const scores = this.tel.scores();
    const rows = this.ids
      .map((id) => this.player(id))
      .filter((p) => !!p)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, score: scores[p.id] ?? 0, note: `${Math.round((scores[p.id] ?? 0) / TEL_VOTE_POINTS)} votes` }));
    return (
      <div class="screen bp-scores" key="final">
        <h2 class="screen-title">Every chain is back home!</h2>
        <Leaderboard rows={rows} />
      </div>
    );
  }

  // ---- debug (window.telephone with ?debug) ---------------------------------------------

  /** Hand in something for everyone who hasn't yet (scribbles and silly guesses), to test the show. */
  fill() {
    if (this.phase !== 'step') return;
    for (const id of this.tel.pending()) {
      const k = this.tel.kind;
      if (k === 'draw') this.tel.submit(id, { strokes: scribble() });
      else this.tel.submit(id, { text: this.nextSentence() });
    }
    this.update();
    this.maybeAdvance();
  }

  /** Skip the current wait. */
  skip() {
    if (this.phase === 'step') this.endStep();
    else if (this.phase === 'show') this.revealNext();
    else if (this.phase === 'vote') this.endVote();
  }

  /** Random votes for everyone who can vote. */
  voteAll() {
    if (this.phase !== 'vote') return;
    for (const id of this.tel.pendingVoters(this.chain)) {
      const can = this.tel.canPick(this.chain, id);
      const options = can.flatMap((ok, i) => (ok ? [i] : []));
      this.tel.vote(this.chain, id, options[Math.floor(Math.random() * options.length)]);
    }
    this.update();
    this.maybeAdvance();
  }

  get state() {
    return { phase: this.phase, step: this.tel.step, steps: this.tel.steps, chain: this.chain, shown: this.shown, key: this.key };
  }
}

const LEFT_LABEL = 'Left the game';

/** A random doodle for the debug filler: a few wobbly loops and a sun. */
function scribble(): number[][] {
  const out: number[][] = [];
  const loops = 3 + Math.floor(Math.random() * 4);
  for (let l = 0; l < loops; l++) {
    const cx = 200 + Math.random() * 600;
    const cy = 200 + Math.random() * 600;
    const r = 60 + Math.random() * 160;
    const s = [Math.floor(Math.random() * 8), Math.floor(Math.random() * 3)];
    for (let a = 0; a <= 40; a++) {
      const t = (a / 40) * Math.PI * 2;
      const wob = 1 + 0.15 * Math.sin(t * 5 + l);
      s.push(Math.round(cx + Math.cos(t) * r * wob), Math.round(cy + Math.sin(t) * r * wob));
    }
    out.push(s);
  }
  out.push([3, 2, 820, 160]);
  return out;
}
