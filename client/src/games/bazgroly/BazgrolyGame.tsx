import prompts from '../../../../data/bazgroly.json';
import { colorHex, type PhoneMsg, type PhoneView, type Stroke } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { usedSet } from '../usedStore';
import { sanitizeStrokes } from '../toty/logic';
import { Doodle } from '../toty/art';
import {
  BZ_ARTIST_POINTS,
  BZ_DRAW_MS,
  BZ_GUESS_MS,
  BZ_LIE_MS,
  BZ_LIE_POINTS,
  assignPrompts,
  buildOptions,
  revealOrder,
  roundsFor,
  sanitizeTitle,
  scoreDrawing,
  shuffle,
  titleKey,
  type BzOption,
  type BzPrompt,
  type BzScore,
} from './logic';
import { Leaderboard, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

const POOL = prompts as BzPrompt[];
/** Phones hand in their drawing (or typed lie) just before the deadline; give it time to arrive. */
const GRACE_MS = 2500;
/** How long each fooling lie stays in the spotlight, and the truth after it. */
const REVEAL_STEP_MS = 3200;
const TRUTH_MS = 6000;
const SCORES_MS = 7000;
const LETTERS = 'ABCDEFGHIJ';
const used = usedSet('bazgroly');

type Phase = 'draw' | 'lie' | 'guess' | 'reveal' | 'scores';

export class BazgrolyGame implements Game {
  readonly id = 'bazgroly' as const;
  private readonly rounds: number;
  private round = 0;
  private phase: Phase = 'draw';
  private endsAt = 0;
  private timer: number | undefined;
  private scores: Record<string, number> = {};
  /** Points earned this round, for the scoreboard. */
  private roundPoints: Record<string, number> = {};

  private prompts: Record<string, string> = {};
  private drawings = new Map<string, Stroke[]>();
  /** Artists in the order their drawings are shown. */
  private queue: string[] = [];
  private qi = -1;

  private lies = new Map<string, string>();
  private lieErrors = new Map<string, string>();
  private options: BzOption[] = [];
  private picks = new Map<string, number>();
  private result: BzScore = { points: {}, found: 0, pickers: [] };
  /** Options in reveal order, and how many of them the TV shows so far. */
  private order: number[] = [];
  private shown = 0;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = roundsFor(ids.length);
    for (const id of ids) this.scores[id] = 0;
  }

  private get artist() {
    return this.queue[this.qi];
  }

  private get truth() {
    return this.prompts[this.artist] ?? '';
  }

  /** The truth is on screen (the last reveal step). */
  private get truthShown() {
    return this.phase === 'reveal' && this.shown >= this.order.length;
  }

  start() {
    this.startRound();
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

  private name(id: string) {
    return this.host.player(id)?.name ?? '?';
  }

  private connected(id: string) {
    return !!this.host.player(id)?.connected;
  }

  /** Everybody still here (and connected) who has to do something has done it. */
  private allDone(who: readonly string[], has: (id: string) => boolean) {
    const active = who.filter((id) => this.connected(id));
    return active.length > 0 && active.every(has);
  }

  private get guessers() {
    return this.ids.filter((id) => id !== this.artist);
  }

  // ---- flow ---------------------------------------------------------------------

  private startRound() {
    this.round++;
    this.roundPoints = {};
    this.prompts = assignPrompts(POOL, used, this.ids);
    this.drawings.clear();
    this.phase = 'draw';
    this.endsAt = Date.now() + BZ_DRAW_MS;
    sound.reveal();
    this.after(BZ_DRAW_MS + GRACE_MS, () => this.startShowing());
    this.update();
  }

  private startShowing() {
    if (this.phase !== 'draw') return;
    this.queue = shuffle(this.ids.filter((id) => (this.drawings.get(id)?.length ?? 0) > 0));
    this.qi = -1;
    this.nextDrawing();
  }

  private nextDrawing() {
    this.qi++;
    while (this.qi < this.queue.length && !this.ids.includes(this.artist)) this.qi++;
    if (this.qi >= this.queue.length) {
      this.showScores();
      return;
    }
    this.phase = 'lie';
    this.lies.clear();
    this.lieErrors.clear();
    this.picks.clear();
    this.options = [];
    this.endsAt = Date.now() + BZ_LIE_MS;
    sound.whoosh();
    this.after(BZ_LIE_MS + GRACE_MS, () => this.startGuess());
    this.update();
  }

  /** Other prompts from the pool, to fill out the options or to lie for a player. */
  private decoys(): string[] {
    const taken = new Set([...Object.values(this.prompts), ...this.lies.values()].map(titleKey));
    return shuffle(POOL.map((p) => p.prompt).filter((p) => !taken.has(titleKey(p))));
  }

  private startGuess() {
    if (this.phase !== 'lie') return;
    this.options = buildOptions(this.truth, Object.fromEntries(this.lies), this.decoys());
    this.phase = 'guess';
    this.endsAt = Date.now() + BZ_GUESS_MS;
    sound.reveal();
    this.after(BZ_GUESS_MS, () => this.startReveal());
    this.update();
  }

  private startReveal() {
    if (this.phase !== 'guess') return;
    this.result = scoreDrawing(this.options, Object.fromEntries(this.picks), this.artist, this.round);
    for (const [id, pts] of Object.entries(this.result.points)) {
      if (!(id in this.scores)) continue;
      this.scores[id] += pts;
      this.roundPoints[id] = (this.roundPoints[id] ?? 0) + pts;
    }
    this.order = revealOrder(this.options, this.result.pickers);
    this.phase = 'reveal';
    this.shown = 0;
    this.revealNext();
  }

  private revealNext() {
    this.shown++;
    const i = this.order[this.shown - 1];
    const o = this.options[i];
    if (o.truth) {
      sound.fanfare();
      for (const [id, pts] of Object.entries(this.result.points)) if (pts > 0) this.host.buzz(id, [60, 60, 60]);
      this.after(TRUTH_MS, () => this.nextDrawing());
    } else {
      sound.wrong();
      this.after(REVEAL_STEP_MS, () => this.revealNext());
    }
    this.update();
  }

  private showScores() {
    this.phase = 'scores';
    sound.whoosh();
    this.after(SCORES_MS, () => (this.round < this.rounds ? this.startRound() : this.host.finish(this.scores)));
    this.update();
  }

  private maybeAdvance() {
    if (this.phase === 'draw' && this.allDone(this.ids, (id) => this.drawings.has(id))) this.after(1200, () => this.startShowing());
    else if (this.phase === 'lie' && this.allDone(this.guessers, (id) => this.lies.has(id))) this.after(900, () => this.startGuess());
    else if (this.phase === 'guess' && this.allDone(this.guessers, (id) => this.picks.has(id))) this.after(900, () => this.startReveal());
  }

  // ---- phones -------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (!this.ids.includes(id)) return;
    switch (m.t) {
      case 'doodle': {
        if (this.phase !== 'draw' || this.drawings.has(id)) return;
        const strokes = sanitizeStrokes(m.strokes);
        if (!strokes) return;
        this.drawings.set(id, strokes);
        sound.lockIn();
        break;
      }
      case 'lie': {
        if (this.phase !== 'lie' || id === this.artist || this.lies.has(id)) return;
        const text = m.auto ? this.decoys()[0] ?? '' : sanitizeTitle(m.text);
        if (!text) return;
        if (titleKey(text) === titleKey(this.truth)) {
          this.lieErrors.set(id, 'That’s the real title! Now write a fake one.');
          this.host.buzz(id, [200]);
          this.host.refresh(id);
          return;
        }
        this.lies.set(id, text);
        this.lieErrors.delete(id);
        sound.lockIn();
        break;
      }
      case 'pick': {
        if (this.phase !== 'guess' || id === this.artist || this.picks.has(id)) return;
        const o = this.options[m.i];
        if (!Number.isInteger(m.i) || !o || o.authors.includes(id)) return;
        this.picks.set(id, m.i);
        sound.lockIn();
        break;
      }
      default:
        return;
    }
    this.host.refresh(id);
    this.host.changed();
    this.maybeAdvance();
  }

  onConnection() {
    this.maybeAdvance();
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    delete this.roundPoints[id];
    this.drawings.delete(id);
    this.lies.delete(id);
    this.picks.delete(id);
    if (this.ids.length === 0) {
      this.host.finish({});
      return;
    }
    // The artist left: skip to the next drawing.
    if ((this.phase === 'lie' || this.phase === 'guess') && id === this.artist) this.nextDrawing();
    else this.onConnection();
  }

  viewFor(id: string): PhoneView {
    const yours = id === this.artist;
    switch (this.phase) {
      case 'draw':
        return { v: 'bzDraw', prompt: this.prompts[id] ?? '', round: this.round, rounds: this.rounds, endsAt: this.endsAt, done: this.drawings.has(id) };
      case 'lie':
        return {
          v: 'bzLie',
          n: this.qi + 1,
          of: this.queue.length,
          artist: this.name(this.artist),
          yours,
          endsAt: this.endsAt,
          lie: this.lies.get(id) ?? null,
          ...(this.lieErrors.has(id) ? { error: this.lieErrors.get(id) } : {}),
        };
      case 'guess':
        return {
          v: 'bzGuess',
          artist: this.name(this.artist),
          yours,
          options: this.options.map((o) => o.text),
          own: this.options.flatMap((o, i) => (o.authors.includes(id) ? [i] : [])),
          endsAt: this.endsAt,
          picked: this.picks.get(id) ?? null,
        };
      case 'reveal': {
        if (!this.truthShown) return { v: 'wait', title: 'Look at the TV!', text: 'Who fell for what…', icon: 'bazgroly' };
        const pick = this.picks.get(id);
        const picked = pick !== undefined ? this.options[pick] : undefined;
        return {
          v: 'bzResult',
          truth: this.truth,
          yours,
          points: this.result.points[id] ?? 0,
          total: this.scores[id] ?? 0,
          found: this.result.found,
          correct: yours || !picked ? null : picked.truth,
          fooledBy: picked && !picked.truth ? picked.authors.map((a) => this.name(a)).join(' & ') : null,
          fooled: this.result.pickers.reduce((n, p, i) => n + (this.options[i].authors.includes(id) ? p.length : 0), 0),
        };
      }
      case 'scores':
        return {
          v: 'wait',
          title: this.round < this.rounds ? `End of round ${this.round}` : 'That’s all the drawings!',
          text: this.round < this.rounds ? 'Round 2 is worth double. Sharpen your pencil…' : 'Final scores coming up.',
          icon: 'bazgroly',
        };
    }
  }

  // ---- TV -------------------------------------------------------------------------

  render() {
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
    const timer = (total: number) => (
      <TimerRing key={`${this.phase}${this.round}.${this.qi}`} endsAt={this.endsAt} total={total} size={130} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />
    );
    const roundPill = (
      <div class="pill">
        Round {this.round} / {this.rounds}
        {this.round > 1 ? ' · double points' : ''}
      </div>
    );

    if (this.phase === 'draw') {
      return (
        <div class="screen bz" key={`d${this.round}`}>
          <div class="quiz-top">
            {roundPill}
            <div class="pill pill-cat">Draw!</div>
            <div class="grow" />
            {timer(BZ_DRAW_MS)}
          </div>
          <h2 class="bz-title">Everyone has a secret prompt on their phone.</h2>
          <p class="bz-sub">Draw it! Then the others make up fake titles – and you all try to spot the real one.</p>
          <div class="bz-chips">
            {players.map((p) => {
              const done = this.drawings.has(p.id);
              return (
                <div class={`answer-chip ${done ? 'done' : ''} ${p.connected ? '' : 'offline'}`}>
                  <Pierogi color={colorHex(p.color)} size={64} mood={!p.connected ? 'sleep' : done ? 'happy' : 'wow'} />
                  <span>{p.name}</span>
                  <b>{done ? 'Done' : 'Drawing…'}</b>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (this.phase === 'scores') {
      return (
        <div class="screen bp-scores" key={`s${this.round}`}>
          <h2 class="screen-title">{this.round < this.rounds ? `Scores after round ${this.round} – round ${this.round + 1} pays double!` : 'Scores after the last drawing'}</h2>
          {this.queue.length === 0 && <p class="bz-sub">Nobody drew anything this round!</p>}
          <Leaderboard rows={players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: this.scores[p.id] ?? 0, delta: this.roundPoints[p.id] }))} />
        </div>
      );
    }

    const artist = this.host.player(this.artist);
    const strokes = this.drawings.get(this.artist) ?? [];
    const art = (
      <div class="bz-art pop-in">
        <Doodle strokes={strokes} animate={this.phase === 'lie'} seconds={5} />
        <div class="bz-art-by" style={{ '--pc': colorHex(artist?.color ?? 'sourcream') }}>
          by <b>{artist?.name ?? '?'}</b>
        </div>
      </div>
    );
    const top = (total: number | null) => (
      <div class="quiz-top">
        {roundPill}
        <div class="pill">
          Drawing {this.qi + 1} / {this.queue.length}
        </div>
        <div class="grow" />
        {total !== null && timer(total)}
      </div>
    );

    if (this.phase === 'lie') {
      return (
        <div class="screen bz" key={`l${this.round}.${this.qi}`}>
          {top(BZ_LIE_MS)}
          <div class="bz-body">
            {art}
            <div class="bz-side">
              <div class="bz-ask card-paper">What is this?</div>
              <p class="bz-sub left">Write a fake title on your phone. Fool the others into picking it!</p>
              <div class="bz-chips">
                {players.map((p) => {
                  const isArtist = p.id === this.artist;
                  const done = this.lies.has(p.id);
                  return (
                    <div class={`answer-chip ${done || isArtist ? 'done' : ''} ${p.connected ? '' : 'offline'}`}>
                      <Pierogi color={colorHex(p.color)} size={56} mood={!p.connected ? 'sleep' : isArtist ? 'happy' : done ? 'happy' : 'wow'} />
                      <span>{p.name}</span>
                      <b>{isArtist ? 'Artist' : done ? 'Done' : 'Lying…'}</b>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (this.phase === 'guess') {
      return (
        <div class="screen bz" key={`g${this.round}.${this.qi}`}>
          {top(BZ_GUESS_MS)}
          <div class="bz-body">
            {art}
            <div class="bz-side">
              <div class={`bz-options n${this.options.length}`}>
                {this.options.map((o, i) => (
                  <div class="bz-option" style={{ animationDelay: `${i * 80}ms` }}>
                    <span class="bz-letter">{LETTERS[i]}</span>
                    <span class="bz-text">{o.text}</span>
                  </div>
                ))}
              </div>
              <div class="bp-hint">
                Pick the real title on your phone!
                <span class="bp-hint-count">
                  {' '}
                  {this.picks.size}/{this.guessers.length} in
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // reveal: lies that fooled somebody one by one, then the truth
    const current = this.order[this.shown - 1];
    const revealed = new Set(this.order.slice(0, this.shown));
    const done = this.truthShown;
    return (
      <div class="screen bz" key={`r${this.round}.${this.qi}`}>
        {top(null)}
        <div class="bz-body">
          {art}
          <div class="bz-side">
            <div class={`bz-options n${this.options.length} reveal`}>
              {this.options.map((o, i) => {
                const isShown = revealed.has(i);
                const pickers = this.result.pickers[i] ?? [];
                const cls = [
                  'bz-option',
                  isShown ? 'shown' : '',
                  i === current ? 'current' : '',
                  isShown && o.truth ? 'truth' : '',
                  isShown && !o.truth ? 'lie' : '',
                  done && !isShown ? 'dim' : '',
                ].join(' ');
                return (
                  <div class={cls}>
                    <span class="bz-letter">{LETTERS[i]}</span>
                    <span class="bz-text">
                      {o.text}
                      {isShown && (
                        <small class="bz-who">
                          {o.truth ? (
                            <>
                              The truth, drawn by {artist?.name ?? '?'}
                              {this.result.found > 0 && <b class="bz-gain"> +{(this.result.found * BZ_ARTIST_POINTS * this.round).toLocaleString('en-US')}</b>}
                            </>
                          ) : o.authors.length ? (
                            <>
                              {o.authors.map((a) => this.name(a)).join(' & ')}’s lie{' '}
                              <b class="bz-gain">
                                +{(pickers.length * BZ_LIE_POINTS * this.round).toLocaleString('en-US')}
                                {o.authors.length > 1 ? ' each' : ''}
                              </b>
                            </>
                          ) : (
                            'Our decoy – nobody wrote that!'
                          )}
                        </small>
                      )}
                    </span>
                    {isShown && (
                      <span class="bz-pickers">
                        {pickers.map((pid) => {
                          const p = this.host.player(pid);
                          return p ? (
                            <span class="bz-picker">
                              <Pierogi color={colorHex(p.color)} size={56} mood={o.truth ? 'wow' : 'dead'} />
                              <small>{p.name}</small>
                            </span>
                          ) : null;
                        })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {done && (
              <div class={`bz-verdict pop-in ${this.result.found ? '' : 'none'}`}>
                {this.result.found === 0
                  ? 'Nobody found it!'
                  : this.result.found === this.guessers.length
                    ? 'Everyone got it!'
                    : `${this.result.found} found the truth`}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}
