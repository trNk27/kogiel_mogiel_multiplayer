import questions from '../../../../data/toty.json';
import { colorHex, type PhoneMsg, type PhoneView, type Stroke, type TyPlayer } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { usedSet } from '../usedStore';
import {
  TY_DOODLE_POINTS,
  TY_DRAW_MS,
  TY_LETTERS,
  TY_PICK_MS,
  TY_FULL,
  TY_SHORT,
  TY_VOTE_MS,
  isPhotoData,
  pickOne,
  pickPlan,
  sanitizeStrokes,
  scoreVotes,
  shuffle,
  tally,
  tallyPicks,
  type Tally,
  type TotyQuestion,
  type TyLayout,
} from './logic';
import { Doodle, Face } from './art';
import { Leaderboard, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

const VOTE_REVEAL_MS = 8000;
const PICK_REVEAL_MS = 9000;
const SCORES_MS = 6000;
/** Phones send their doodle just before the deadline; give them time to arrive. */
const DRAW_GRACE_MS = 2500;
const used = usedSet('toty');

/**
 * Selfies taken this TV session, by player id. Kept between games so "Play again" can reuse
 * them. They only ever live in the TV's memory and pass through the relay; nothing stores them.
 */
const PHOTOS = new Map<string, { rev: number; data: string }>();
let photoRev = 0;

type Phase = 'selfie' | 'vote' | 'voteReveal' | 'draw' | 'pick' | 'pickReveal' | 'scores';

interface DoodleRound {
  subject: TyPlayer;
  prompt: string;
  doodles: Map<string, Stroke[]>;
  /** Artist ids in gallery order (shuffled, only non-empty doodles). */
  gallery: string[];
  picks: Map<string, number>;
  counts: number[];
}

export class TotyGame implements Game {
  readonly id = 'toty' as const;
  private readonly layout: TyLayout;
  private plan: TotyQuestion[];
  private index = -1;
  private phase: Phase = 'selfie';
  private endsAt = 0;
  private selfieDone = new Set<string>();
  private votes = new Map<string, string>();
  private tally: Tally = { counts: {}, winners: [] };
  private roundPoints: Record<string, number> = {};
  private doodle: DoodleRound | null = null;
  private scores: Record<string, number> = {};
  private timer: number | undefined;
  /** Last time each phone was sent each photo, to ignore repeated requests. */
  private served = new Map<string, number>();

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.layout = host.short ? TY_SHORT : TY_FULL;
    this.plan = pickPlan(questions as TotyQuestion[], used, Math.random, this.layout);
    for (const id of ids) this.scores[id] = 0;
  }

  private get q() {
    return this.plan[this.index];
  }

  private get isFinal() {
    return this.index === this.layout.questions - 1;
  }

  start() {
    this.phase = 'selfie';
    this.endsAt = Date.now() + this.layout.selfieMs;
    this.after(this.layout.selfieMs, () => this.nextQuestion());
    sound.reveal();
    this.update();
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

  private tyPlayer(id: string): TyPlayer {
    const p = this.host.player(id);
    return { id, name: p?.name ?? '?', color: p?.color ?? 'sourcream' };
  }

  private photo(id: string) {
    return PHOTOS.get(id)?.data ?? null;
  }

  /** Player id → photo version, for everybody in the game with a photo. */
  private photoRevs(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of this.ids) {
      const p = PHOTOS.get(id);
      if (p) out[id] = p.rev;
    }
    return out;
  }

  private connected(id: string) {
    return !!this.host.player(id)?.connected;
  }

  private allDone(has: (id: string) => boolean) {
    return this.ids.every((id) => has(id) || !this.connected(id));
  }

  // ---- flow ---------------------------------------------------------------------

  private nextQuestion() {
    this.index++;
    if (this.index >= this.layout.questions) {
      this.host.finish(this.scores);
      return;
    }
    this.phase = 'vote';
    this.votes.clear();
    this.roundPoints = {};
    this.doodle = null;
    this.endsAt = Date.now() + TY_VOTE_MS;
    sound.whoosh();
    this.after(TY_VOTE_MS, () => this.revealVotes());
    this.update();
  }

  private revealVotes() {
    if (this.phase !== 'vote') return;
    this.phase = 'voteReveal';
    const votes = Object.fromEntries(this.votes);
    this.tally = tally(votes, this.ids);
    this.roundPoints = scoreVotes(votes, this.tally, this.isFinal);
    for (const [id, pts] of Object.entries(this.roundPoints)) {
      this.scores[id] = (this.scores[id] ?? 0) + pts;
      if (pts > 0) this.host.buzz(id, [60, 60, 60]);
    }
    for (const id of this.tally.winners) this.host.buzz(id, [200, 80, 200]);
    sound.reveal();
    window.setTimeout(() => (this.tally.winners.length ? sound.correct() : sound.wrong()), 1400);
    const doodleNext = this.layout.doodleAfter.includes(this.index) && !!this.q.draw;
    this.after(VOTE_REVEAL_MS, () => (doodleNext ? this.startDraw() : this.nextQuestion()));
    this.update();
  }

  private startDraw() {
    const counts = this.tally.counts;
    // The room's pick, or whoever got the most votes, or anybody at all.
    const max = Math.max(0, ...Object.values(counts));
    const top = this.ids.filter((id) => max > 0 && counts[id] === max);
    const subjectId = pickOne(this.tally.winners.length ? this.tally.winners : top.length ? top : this.ids)!;
    const subject = this.tyPlayer(subjectId);
    this.doodle = {
      subject,
      prompt: this.q.draw!.replace('{name}', subject.name),
      doodles: new Map(),
      gallery: [],
      picks: new Map(),
      counts: [],
    };
    this.phase = 'draw';
    this.endsAt = Date.now() + TY_DRAW_MS;
    sound.whoosh();
    this.after(TY_DRAW_MS + DRAW_GRACE_MS, () => this.startPick());
    this.update();
  }

  private startPick() {
    const d = this.doodle;
    if (!d || this.phase !== 'draw') return;
    d.gallery = shuffle([...d.doodles].filter(([, s]) => s.length > 0).map(([id]) => id));
    if (d.gallery.length < 2) {
      // Nothing to vote on: just show what there is.
      this.revealPicks();
      return;
    }
    this.phase = 'pick';
    this.endsAt = Date.now() + TY_PICK_MS;
    sound.reveal();
    this.after(TY_PICK_MS, () => this.revealPicks());
    this.update();
  }

  private revealPicks() {
    const d = this.doodle;
    if (!d || this.phase === 'pickReveal' || this.phase === 'scores') return;
    this.phase = 'pickReveal';
    d.counts = tallyPicks(Object.fromEntries(d.picks), d.gallery);
    this.roundPoints = {};
    d.gallery.forEach((artist, i) => {
      const pts = d.counts[i] * TY_DOODLE_POINTS;
      this.roundPoints[artist] = pts;
      if (artist in this.scores) this.scores[artist] += pts;
      if (pts > 0) this.host.buzz(artist, [60, 60, 60]);
    });
    sound.fanfare();
    this.after(d.gallery.length ? PICK_REVEAL_MS : 3000, () => {
      this.phase = 'scores';
      sound.whoosh();
      this.after(SCORES_MS, () => this.nextQuestion());
      this.update();
    });
    this.update();
  }

  private maybeAdvance() {
    const d = this.doodle;
    if (this.phase === 'selfie' && this.selfieDone.size > 0 && this.allDone((id) => this.selfieDone.has(id))) this.after(1500, () => this.nextQuestion());
    else if (this.phase === 'vote' && this.votes.size > 0 && this.allDone((id) => this.votes.has(id))) this.after(900, () => this.revealVotes());
    else if (this.phase === 'draw' && d && d.doodles.size > 0 && this.allDone((id) => d.doodles.has(id))) this.after(1200, () => this.startPick());
    else if (this.phase === 'pick' && d && d.picks.size > 0 && this.allDone((id) => d.picks.has(id) || d.gallery.every((a) => a === id)))
      this.after(900, () => this.revealPicks());
  }

  // ---- phones -------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    const d = this.doodle;
    switch (m.t) {
      case 'selfie': {
        if (this.phase !== 'selfie') return;
        if (m.data === '') PHOTOS.delete(id);
        else if (m.data === 'keep') {
          if (!PHOTOS.has(id)) return;
        } else if (isPhotoData(m.data)) PHOTOS.set(id, { rev: ++photoRev, data: m.data });
        else return;
        this.selfieDone.add(id);
        sound.plop();
        this.host.refresh(id);
        this.host.changed();
        this.maybeAdvance();
        return;
      }
      case 'photos': {
        if (!Array.isArray(m.ids)) return;
        const now = Date.now();
        for (const pid of m.ids.slice(0, 16)) {
          if (typeof pid !== 'string' || !this.ids.includes(pid)) continue;
          const p = PHOTOS.get(pid);
          const key = `${id}>${pid}:${p?.rev ?? 0}`;
          if (now - (this.served.get(key) ?? 0) < 3000) continue;
          this.served.set(key, now);
          this.host.message([id], { t: 'photo', id: pid, rev: p?.rev ?? 0, data: p?.data ?? '' });
        }
        return;
      }
      case 'vote':
        if (this.phase !== 'vote' || this.votes.has(id) || !this.ids.includes(m.id)) return;
        this.votes.set(id, m.id);
        sound.lockIn();
        this.host.refresh(id);
        this.host.changed();
        this.maybeAdvance();
        return;
      case 'doodle': {
        if (this.phase !== 'draw' || !d || d.doodles.has(id)) return;
        const strokes = sanitizeStrokes(m.strokes);
        if (!strokes) return;
        d.doodles.set(id, strokes);
        sound.lockIn();
        this.host.refresh(id);
        this.host.changed();
        this.maybeAdvance();
        return;
      }
      case 'pick':
        if (this.phase !== 'pick' || !d || d.picks.has(id)) return;
        if (!Number.isInteger(m.i) || m.i < 0 || m.i >= d.gallery.length || d.gallery[m.i] === id) return;
        d.picks.set(id, m.i);
        sound.lockIn();
        this.host.refresh(id);
        this.host.changed();
        this.maybeAdvance();
        return;
    }
  }

  onConnection() {
    this.maybeAdvance();
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    this.selfieDone.delete(id);
    this.votes.delete(id);
    this.doodle?.doodles.delete(id);
    this.doodle?.picks.delete(id);
    PHOTOS.delete(id);
    if (this.ids.length === 0) this.host.finish({});
    else this.onConnection();
  }

  viewFor(id: string): PhoneView {
    const d = this.doodle;
    switch (this.phase) {
      case 'selfie':
        return { v: 'tySelfie', id, endsAt: this.endsAt, rev: PHOTOS.get(id)?.rev ?? null, done: this.selfieDone.has(id) };
      case 'vote':
        return {
          v: 'tyVote',
          q: this.index + 1,
          total: this.layout.questions,
          question: this.q.question,
          double: this.isFinal,
          endsAt: this.endsAt,
          players: this.ids.map((p) => this.tyPlayer(p)),
          ph: this.photoRevs(),
          picked: this.votes.get(id) ?? null,
        };
      case 'voteReveal':
        return {
          v: 'tyResult',
          kind: 'vote',
          points: this.roundPoints[id] ?? 0,
          total: this.scores[id] ?? 0,
          winners: this.tally.winners.map((w) => this.tyPlayer(w).name),
          matched: (this.roundPoints[id] ?? 0) > 0,
          votes: this.tally.counts[id] ?? 0,
        };
      case 'draw':
        return { v: 'tyDraw', prompt: d!.prompt, subject: d!.subject, ph: this.photoRevs(), endsAt: this.endsAt, done: d!.doodles.has(id) };
      case 'pick': {
        const mine = d!.gallery.indexOf(id);
        return {
          v: 'tyPick',
          endsAt: this.endsAt,
          letters: d!.gallery.map((_, i) => TY_LETTERS[i]),
          mine: mine >= 0 ? mine : null,
          picked: d!.picks.get(id) ?? null,
        };
      }
      default: {
        const i = d?.gallery.indexOf(id) ?? -1;
        return { v: 'tyResult', kind: 'doodle', points: this.roundPoints[id] ?? 0, total: this.scores[id] ?? 0, votes: i >= 0 ? d!.counts[i] ?? 0 : 0 };
      }
    }
  }

  // ---- TV -------------------------------------------------------------------------

  render() {
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
    const timer = (total: number) => (
      <TimerRing key={`${this.phase}${this.index}`} endsAt={this.endsAt} total={total} size={130} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />
    );

    if (this.phase === 'selfie') {
      return (
        <div class="screen ty">
          <div class="quiz-top">
            <div class="pill pill-cat">Selfie time!</div>
            <div class="grow" />
            {timer(this.layout.selfieMs)}
          </div>
          <h2 class="ty-title">Selfie time – pull a face!</h2>
          <div class="ty-selfies">
            {players.map((p) => {
              const done = this.selfieDone.has(p.id);
              return (
                <div class={`ty-selfie ${done ? 'done' : ''} ${p.connected ? '' : 'offline'}`}>
                  {done ? (
                    <Face color={p.color} photo={this.photo(p.id)} size={260} mood="wow" class="pop-in" />
                  ) : (
                    <div class="ty-face ty-face-wait" style={{ width: 260, height: 260, '--pc': colorHex(p.color) }}>
                      <span>📸</span>
                    </div>
                  )}
                  <span class="ty-name">{p.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (this.phase === 'scores') {
      return (
        <div class="screen bp-scores" key={`s${this.index}`}>
          <h2 class="screen-title">
            Scores after {this.index + 1} of {this.layout.questions} questions
          </h2>
          <Leaderboard rows={players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: this.scores[p.id] ?? 0, delta: this.roundPoints[p.id] }))} />
        </div>
      );
    }

    if (this.phase === 'vote' || this.phase === 'voteReveal') {
      const reveal = this.phase === 'voteReveal';
      const { counts, winners } = this.tally;
      const names = winners.map((w) => this.tyPlayer(w).name);
      return (
        <div class="screen ty" key={`v${this.index}`}>
          <div class="quiz-top">
            <div class="pill">
              Question {this.index + 1} / {this.layout.questions}
            </div>
            {this.isFinal && <div class="pill pill-cat">Double points!</div>}
            <div class="grow" />
            {!reveal && timer(TY_VOTE_MS)}
          </div>
          <div class={`ty-question card-paper ${reveal ? 'small' : ''}`}>{this.q.question}</div>
          {reveal && (
            <div class={`ty-banner pop-in ${winners.length ? '' : 'none'}`}>
              {winners.length ? `To ty, ${joinNames(names)}!` : 'Nobody agreed!'}
              <small>{winners.length ? (winners.length > 1 ? 'That’s you – it’s a tie!' : 'That’s you!') : 'Everyone picked someone different.'}</small>
            </div>
          )}
          <div class={`ty-row ${reveal ? 'reveal' : ''}`}>
            {players.map((p, i) => {
              const voted = this.votes.has(p.id);
              const won = reveal && winners.includes(p.id);
              const voters = reveal ? players.filter((v) => this.votes.get(v.id) === p.id) : [];
              return (
                <div class={`ty-cand ${won ? 'won' : ''} ${reveal && !won ? 'lost' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
                  <Face color={p.color} photo={this.photo(p.id)} size={players.length > 6 ? 170 : 200} mood={won ? 'wow' : 'happy'} />
                  <span class="ty-name">{p.name}</span>
                  {reveal ? (
                    <>
                      <span class="ty-count">{counts[p.id] ?? 0}</span>
                      <div class="ty-voters">
                        {voters.map((v) => (
                          <Pierogi color={colorHex(v.color)} size={40} />
                        ))}
                      </div>
                      {this.roundPoints[p.id] ? (
                        <b class="ty-gain">
                          +{this.roundPoints[p.id]} <small>agreed</small>
                        </b>
                      ) : null}
                    </>
                  ) : (
                    <span class={`ty-status ${voted ? 'yes' : ''}`}>{voted ? 'Voted' : p.connected ? 'Thinking…' : 'Away'}</span>
                  )}
                </div>
              );
            })}
          </div>
          {!reveal && <div class="bp-hint">Vote on your phone. You score if you agree with the room!</div>}
        </div>
      );
    }

    const d = this.doodle!;
    if (this.phase === 'draw') {
      return (
        <div class="screen ty ty-draw" key={`d${this.index}`}>
          <div class="quiz-top">
            <div class="pill pill-cat">Doodle time!</div>
            <div class="grow" />
            {timer(TY_DRAW_MS)}
          </div>
          <div class="ty-draw-body">
            <Face color={d.subject.color} photo={this.photo(d.subject.id)} size={520} mood="wow" class="ty-draw-subject pop-in" />
            <div class="ty-draw-side">
              <div class="ty-prompt card-paper">{d.prompt}</div>
              <p class="muted">Draw on {d.subject.name}’s photo on your phone.</p>
              <div class="ty-progress">
                {players.map((p) => {
                  const done = d.doodles.has(p.id);
                  return (
                    <div class={`answer-chip ${done ? 'done' : ''} ${p.connected ? '' : 'offline'}`}>
                      <Pierogi color={colorHex(p.color)} size={56} mood={!p.connected ? 'sleep' : done ? 'happy' : 'wow'} />
                      <span>{p.name}</span>
                      <b>{done ? 'Done' : 'Drawing…'}</b>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // pick / pickReveal: the gallery
    const reveal = this.phase === 'pickReveal';
    const best = reveal ? Math.max(0, ...d.counts) : 0;
    const n = d.gallery.length;
    return (
      <div class="screen ty" key={`g${this.index}`}>
        <div class="quiz-top">
          <div class="pill">{d.prompt}</div>
          <div class="grow" />
          {!reveal && timer(TY_PICK_MS)}
        </div>
        {n === 0 ? (
          <div class="ty-banner none pop-in">
            No doodles this time!
            <small>Nobody drew anything. Pencils ready for next time…</small>
          </div>
        ) : (
          <div class={`ty-gallery n${Math.min(n, 8)}`}>
            {d.gallery.map((artistId, i) => {
              const artist = this.tyPlayer(artistId);
              const won = reveal && best > 0 && d.counts[i] === best;
              return (
                <div class={`ty-art ${won ? 'won' : ''}`} style={{ animationDelay: `${i * 90}ms` }}>
                  <Doodle strokes={d.doodles.get(artistId) ?? []} photo={this.photo(d.subject.id)} color={d.subject.color} animate={!reveal} />
                  <span class="ty-letter">{TY_LETTERS[i]}</span>
                  {reveal && (
                    <div class="ty-art-foot" style={{ '--pc': colorHex(artist.color) }}>
                      <span>{artist.name}</span>
                      <b>
                        {d.counts[i]} vote{d.counts[i] === 1 ? '' : 's'}
                      </b>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!reveal && n > 0 && (
          <div class="bp-hint">
            Vote for your favourite on your phone (not your own!)
            <span class="bp-hint-count">
              {' '}
              {d.picks.size}/{players.length} votes in
            </span>
          </div>
        )}
      </div>
    );
  }
}

function joinNames(names: string[]) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}
