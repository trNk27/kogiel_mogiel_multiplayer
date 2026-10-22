import type { ComponentChildren } from 'preact';
import data from '../../../../data/quip.json';
import { colorHex, type AskInput, type AskView, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { usedSet } from '../usedStore';
import {
  QP_FINAL_MULT,
  QP_FINAL_POP_MS,
  QP_FINAL_VOTE_MS,
  QP_FINAL_WRITE_MS,
  QP_MAX,
  QP_POP_START_MS,
  QP_POP_STEP_MS,
  QP_VOTE_MS,
  authorsAt,
  canPickFinal,
  finalAuthorsAt,
  finalJinxed,
  finalRevealMs,
  finalVotesFor,
  layoutFor,
  matchupRevealMs,
  multiplier,
  orderMatchups,
  pairKey,
  pairUp,
  pickPrompts,
  safetyAnswer,
  sanitizeAnswer,
  scoreFinal,
  scoreMatchup,
  shuffle,
  slotsFor,
  type FinalEntry,
  type FinalResult,
  type MatchupResult,
  type Pair,
  type QpLayout,
  type QpPrompt,
} from './logic';
import { Leaderboard, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import './quip.css';

const POOL = (data as { prompts: QpPrompt[] }).prompts;
const SAFETY = (data as { safety: string[] }).safety;
const used = usedSet('quip');

/** Phones hand in what's typed just before the deadline; give it time to arrive. */
const GRACE_MS = 1800;
const TITLE_MS = 4500;
/** The prompt, then the two answers popping in. */
const SHOW_MS = 3800;
const FINAL_SHOW_MS = 5500;
const SCORES_MS = 7500;
const LETTERS = 'ABCDEFGH';

type Phase = 'title' | 'write' | 'show' | 'vote' | 'reveal' | 'fshow' | 'fvote' | 'freveal' | 'scores';

interface Answer {
  text: string;
  /** Picked by "🎲 Answer for me" or because time ran out. */
  auto: boolean;
}

interface Matchup {
  prompt: string;
  authors: Pair;
  answers: [Answer | null, Answer | null];
}

interface Entry extends FinalEntry {
  auto: boolean;
}

export class QuipGame implements Game {
  readonly id = 'quip' as const;
  private readonly layout: QpLayout;
  /** 1…rounds are matchup rounds; rounds + 1 is Ostatnia Riposta. */
  private round = 0;
  private phase: Phase = 'title';
  private endsAt = 0;
  /** Bumped on every phase change; phone keys are built from it. */
  private key = 0;
  private timer: number | undefined;
  private fx: number[] = [];
  private finished = false;
  private scores: Record<string, number> = {};
  private roundPoints: Record<string, number> = {};
  /** Pairs that already met, so the next round mixes them up. */
  private met = new Set<string>();

  private matchups: Matchup[] = [];
  private order: number[] = [];
  /** Position in `order`. */
  private pos = -1;
  private votes = new Map<string, number>();
  private result: MatchupResult | null = null;

  private finalPrompt = '';
  private finalAnswers = new Map<string, Answer>();
  private entries: Entry[] = [];
  private jinxed: boolean[] = [];
  private fvotes = new Map<string, number[]>();
  private fresult: FinalResult | null = null;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.layout = layoutFor(host.short);
    for (const id of ids) this.scores[id] = 0;
  }

  private get isFinal() {
    return this.round > this.layout.rounds;
  }

  private get mult() {
    return this.isFinal ? QP_FINAL_MULT : multiplier(this.round);
  }

  private get current(): Matchup | undefined {
    return this.matchups[this.order[this.pos]];
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, QuipGame>).quip = this;
    this.startTitle();
  }

  dispose() {
    clearTimeout(this.timer);
    for (const t of this.fx) clearTimeout(t);
    this.fx = [];
  }

  private after(ms: number, fn: () => void) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(fn, ms);
  }

  /** A sound (or other effect) a little later; cleared on dispose. */
  private later(ms: number, fn: () => void) {
    this.fx.push(window.setTimeout(fn, ms));
    if (this.fx.length > 64) this.fx = this.fx.slice(-64);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private setPhase(p: Phase, ms = 0) {
    this.phase = p;
    this.key++;
    this.endsAt = Date.now() + ms;
  }

  private name(id: string) {
    return this.host.player(id)?.name ?? '?';
  }

  private here(id: string) {
    return this.ids.includes(id);
  }

  private connected(id: string) {
    return !!this.host.player(id)?.connected;
  }

  /** Everybody still here and connected who has to do something has done it. */
  private allDone(who: readonly string[], has: (id: string) => boolean) {
    const active = who.filter((id) => this.connected(id));
    return active.length > 0 && active.every(has);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.dispose();
    const out: Record<string, number> = {};
    for (const id of this.ids) out[id] = this.scores[id] ?? 0;
    this.host.finish(out);
  }

  private addPoints(points: Record<string, number>) {
    for (const [id, pts] of Object.entries(points)) {
      if (!(id in this.scores) || !pts) continue;
      this.scores[id] += pts;
      this.roundPoints[id] = (this.roundPoints[id] ?? 0) + pts;
    }
  }

  // ---- flow ---------------------------------------------------------------------

  private startTitle() {
    this.round++;
    this.roundPoints = {};
    this.setPhase('title', TITLE_MS);
    if (this.isFinal) sound.drumroll(1.4);
    else sound.reveal();
    this.later(TITLE_MS - 900, () => sound.go());
    this.after(TITLE_MS, () => this.startWrite());
    this.update();
  }

  private startWrite() {
    if (this.isFinal) {
      this.finalPrompt = pickPrompts(POOL, used, 1)[0];
      this.finalAnswers.clear();
      this.setPhase('write', QP_FINAL_WRITE_MS);
      this.after(QP_FINAL_WRITE_MS + GRACE_MS, () => this.endWrite());
    } else {
      const pairs = pairUp(this.ids, Math.random, this.met);
      for (const [a, b] of pairs) this.met.add(pairKey(a, b));
      const prompts = pickPrompts(POOL, used, pairs.length);
      this.matchups = pairs.map((authors, i) => ({ prompt: prompts[i], authors, answers: [null, null] }));
      this.setPhase('write', this.layout.writeMs);
      this.after(this.layout.writeMs + GRACE_MS, () => this.endWrite());
    }
    sound.whoosh();
    this.update();
  }

  /** Every answer given so far, to keep safety answers unique. */
  private givenAnswers(): string[] {
    if (this.isFinal) return [...this.finalAnswers.values()].map((a) => a.text);
    return this.matchups.flatMap((m) => m.answers.flatMap((a) => (a ? [a.text] : [])));
  }

  private safety() {
    return safetyAnswer(SAFETY, this.givenAnswers());
  }

  /** The matchups (indices) a player answers, and the first one still open (-1 when done). */
  private slots(id: string): number[] {
    if (this.isFinal) return this.here(id) ? [0] : [];
    return slotsFor(
      id,
      this.matchups.map((m) => m.authors),
    );
  }

  private pending(id: string): number {
    if (this.isFinal) return this.here(id) && !this.finalAnswers.has(id) ? 0 : -1;
    return this.slots(id).find((mi) => !this.matchups[mi].answers[this.matchups[mi].authors.indexOf(id)]) ?? -1;
  }

  private setAnswer(id: string, slot: number, a: Answer) {
    if (this.isFinal) this.finalAnswers.set(id, a);
    else {
      const m = this.matchups[slot];
      m.answers[m.authors.indexOf(id)] = a;
    }
  }

  private endWrite() {
    if (this.phase !== 'write') return;
    if (this.isFinal) {
      for (const id of this.ids) if (!this.finalAnswers.has(id)) this.finalAnswers.set(id, { text: this.safety(), auto: true });
      this.startFinalShow();
      return;
    }
    // Whoever didn't answer in time gets a safety answer (players who left too, so their matchup still plays).
    for (const m of this.matchups)
      for (const side of [0, 1] as const) if (!m.answers[side]) m.answers[side] = { text: this.safety(), auto: true };
    this.order = orderMatchups(this.matchups.map((m) => m.authors));
    this.pos = -1;
    this.nextMatchup();
  }

  private nextMatchup() {
    this.pos++;
    while (this.pos < this.order.length && !this.current!.authors.some((a) => this.here(a))) this.pos++;
    if (this.pos >= this.order.length) {
      this.showScores();
      return;
    }
    this.votes.clear();
    this.result = null;
    this.setPhase('show', SHOW_MS);
    sound.whoosh();
    this.later(1300, () => sound.plop());
    this.later(2100, () => sound.plop());
    this.after(SHOW_MS, () => this.startVote());
    this.update();
  }

  private get voters(): string[] {
    const m = this.current;
    return m ? this.ids.filter((id) => !m.authors.includes(id)) : [];
  }

  private get isJinx() {
    const m = this.current;
    return !!m && scoreMatchup([m.answers[0]!.text, m.answers[1]!.text], m.authors, {}).jinx;
  }

  private startVote() {
    if (this.phase !== 'show') return;
    if (this.isJinx || this.voters.length === 0) {
      this.startReveal();
      return;
    }
    this.setPhase('vote', QP_VOTE_MS);
    sound.bell();
    this.after(QP_VOTE_MS + 500, () => this.startReveal());
    this.update();
  }

  private startReveal() {
    if (this.phase !== 'vote' && this.phase !== 'show') return;
    const m = this.current!;
    const r = scoreMatchup([m.answers[0]!.text, m.answers[1]!.text], m.authors, Object.fromEntries(this.votes), this.mult);
    this.result = r;
    this.addPoints(r.points);
    const n = r.voters[0].length + r.voters[1].length;
    this.setPhase('reveal');
    if (r.jinx) {
      sound.wrong();
      this.later(250, () => sound.note(330, 0.18, { type: 'square', vol: 0.08, slide: 660 }));
      this.later(450, () => sound.note(660, 0.25, { type: 'square', vol: 0.08, slide: 330 }));
    } else {
      for (let k = 0; k < n; k++) this.later(QP_POP_START_MS + k * QP_POP_STEP_MS, () => sound.note(500 + k * 60, 0.09, { type: 'sine', vol: 0.13, slide: 260 }));
      const at = authorsAt(n);
      this.later(at, () => (n ? sound.reveal() : sound.wrong()));
      if (r.riposta !== null) {
        this.later(at + 500, () => sound.fanfare());
        this.later(at + 500, () => this.host.buzz(m.authors[r.riposta!], [80, 60, 80, 60, 200]));
      }
    }
    this.after(matchupRevealMs(n, r.jinx), () => this.nextMatchup());
    this.update();
  }

  private startFinalShow() {
    this.entries = shuffle(this.ids.filter((id) => this.finalAnswers.has(id)).map((id) => ({ author: id, ...this.finalAnswers.get(id)! })));
    this.jinxed = finalJinxed(this.entries);
    this.fvotes.clear();
    this.fresult = null;
    this.setPhase('fshow', FINAL_SHOW_MS);
    sound.whoosh();
    this.entries.forEach((_, i) => this.later(1200 + i * 280, () => sound.plop()));
    this.after(FINAL_SHOW_MS, () => this.startFinalVote());
    this.update();
  }

  private votesLeft(id: string) {
    return finalVotesFor(id, this.entries, this.jinxed) - (this.fvotes.get(id)?.length ?? 0);
  }

  private startFinalVote() {
    if (this.phase !== 'fshow') return;
    if (!this.ids.some((id) => this.votesLeft(id) > 0)) {
      this.startFinalReveal();
      return;
    }
    this.setPhase('fvote', QP_FINAL_VOTE_MS);
    sound.bell();
    this.after(QP_FINAL_VOTE_MS + 500, () => this.startFinalReveal());
    this.update();
  }

  private startFinalReveal() {
    if (this.phase !== 'fvote' && this.phase !== 'fshow') return;
    const r = scoreFinal(this.entries, Object.fromEntries(this.fvotes), QP_FINAL_MULT);
    this.fresult = r;
    this.addPoints(r.points);
    this.setPhase('freveal');
    const n = r.voters.reduce((s, v) => s + v.length, 0);
    for (let k = 0; k < n; k++) this.later(QP_POP_START_MS + k * QP_FINAL_POP_MS, () => sound.note(480 + (k % 8) * 50, 0.08, { type: 'sine', vol: 0.12, slide: 250 }));
    this.later(finalAuthorsAt(n), () => (n ? sound.fanfare() : sound.wrong()));
    this.after(finalRevealMs(n), () => this.showScores());
    this.update();
  }

  private showScores() {
    this.setPhase('scores', SCORES_MS);
    sound.whoosh();
    this.after(SCORES_MS, () => (this.isFinal ? this.finish() : this.startTitle()));
    this.update();
  }

  private maybeAdvance() {
    if (this.phase === 'write' && this.allDone(this.ids, (id) => this.pending(id) < 0)) this.after(1000, () => this.endWrite());
    else if (this.phase === 'vote' && this.allDone(this.voters, (id) => this.votes.has(id))) this.after(800, () => this.startReveal());
    else if (this.phase === 'fvote' && this.allDone(this.ids, (id) => this.votesLeft(id) <= 0)) this.after(1000, () => this.startFinalReveal());
  }

  // ---- phones -------------------------------------------------------------------

  /** The key of the question this phone is answering now. */
  private keyFor(id: string): number {
    let sub = 0;
    if (this.phase === 'write') {
      const p = this.pending(id);
      sub = p < 0 ? 3 : this.slots(id).indexOf(p);
    } else if (this.phase === 'fvote') sub = this.fvotes.get(id)?.length ?? 0;
    return this.key * 4 + sub;
  }

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'ask' || !this.here(id) || m.key !== this.keyFor(id)) return;
    if (this.phase === 'write') {
      const slot = this.pending(id);
      if (slot < 0) return;
      const text = m.auto ? this.safety() : sanitizeAnswer(m.text);
      if (!text) return;
      this.setAnswer(id, slot, { text, auto: !!m.auto });
      sound.lockIn();
    } else if (this.phase === 'vote') {
      if (this.current!.authors.includes(id) || this.votes.has(id) || (m.i !== 0 && m.i !== 1)) return;
      this.votes.set(id, m.i);
      sound.lockIn();
    } else if (this.phase === 'fvote') {
      const picks = this.fvotes.get(id) ?? [];
      if (m.i === undefined || this.votesLeft(id) <= 0 || !canPickFinal(id, this.entries, this.jinxed, picks, m.i)) return;
      this.fvotes.set(id, [...picks, m.i]);
      sound.lockIn();
    } else return;
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
    this.votes.delete(id);
    this.fvotes.delete(id);
    if (this.phase === 'write' && this.isFinal) this.finalAnswers.delete(id);
    if (this.ids.length < 2) {
      this.finish();
      return;
    }
    // Both authors of the matchup on screen are gone: skip it.
    const m = this.current;
    if ((this.phase === 'show' || this.phase === 'vote') && m && !m.authors.some((a) => this.here(a))) {
      this.nextMatchup();
      return;
    }
    this.onConnection();
  }

  private note() {
    return this.isFinal ? 'Ostatnia Riposta · votes ×3' : `Round ${this.round} / ${this.layout.rounds}${this.mult > 1 ? ' · ×2' : ''}`;
  }

  private ask(id: string, title: string, input: AskInput, extra: Partial<AskView> = {}): AskView {
    return { v: 'ask', game: 'quip', key: this.keyFor(id), note: this.note(), title, input, score: this.scores[id] ?? 0, ...extra };
  }

  private wait(id: string, title: string, text?: string, mood: 'happy' | 'wow' | 'dead' | 'sleep' = 'happy', big?: string, good?: boolean): AskView {
    return this.ask(id, title, { k: 'none', mood, ...(big ? { big } : {}), ...(good !== undefined ? { good } : {}) }, text ? { text } : {});
  }

  viewFor(id: string): PhoneView {
    if (!this.here(id)) return { v: 'wait', title: 'Riposta', text: 'Watch the TV!', icon: 'quip' };
    switch (this.phase) {
      case 'title':
        return this.isFinal
          ? this.wait(id, 'Ostatnia Riposta!', 'One prompt for everyone. Every vote is worth triple.', 'wow')
          : this.wait(id, `Round ${this.round}`, this.round === 1 ? 'Get ready to answer two prompts.' : 'Two new prompts – every vote counts double!', 'wow');
      case 'write': {
        const p = this.pending(id);
        if (p < 0) return this.wait(id, 'All answered!', 'Look at the TV while the others finish.');
        const slots = this.slots(id);
        const title = this.isFinal ? this.finalPrompt : this.matchups[p].prompt;
        return this.ask(
          id,
          title,
          { k: 'text', placeholder: 'Your funniest answer…', max: QP_MAX, sent: null, auto: '🎲 Answer for me', button: 'Send' },
          { endsAt: this.endsAt, accent: '#ffc93c', ...(this.isFinal ? { text: 'Everyone answers this one' } : { text: `Prompt ${slots.indexOf(p) + 1} of ${slots.length}` }) },
        );
      }
      case 'show': {
        const mine = this.current!.authors.includes(id);
        return mine ? this.wait(id, 'Your matchup is up!', 'Sit tight, keep a straight face.', 'wow') : this.wait(id, 'Look at the TV!', 'Read both answers – then vote.');
      }
      case 'vote': {
        const m = this.current!;
        if (m.authors.includes(id)) return this.wait(id, 'Your matchup!', 'The others are voting. No peeking at faces.', 'wow');
        const picked = this.votes.get(id);
        return this.ask(
          id,
          m.prompt,
          { k: 'choice', options: m.answers.map((a, i) => ({ label: a!.text, color: i ? '#4f9dff' : '#e8335a' })), picked: picked ?? null },
          { endsAt: this.endsAt, text: 'Which answer is funnier?' },
        );
      }
      case 'reveal': {
        const m = this.current!;
        const r = this.result!;
        const side = m.authors.indexOf(id);
        if (r.jinx) return this.wait(id, 'Jinx!', 'Same answer – nobody scores.', 'dead');
        if (side >= 0) {
          const pts = r.points[id] ?? 0;
          const n = r.voters[side].length;
          return this.wait(id, r.riposta === side ? 'RIPOSTA!' : `${n} vote${n === 1 ? '' : 's'}`, `“${m.answers[side]!.text}”`, pts ? 'happy' : 'dead', `+${pts}`, pts > 0);
        }
        const v = this.votes.get(id);
        if (v === undefined) return this.wait(id, 'Look at the TV!', 'Who wrote what…', 'sleep');
        return this.wait(id, 'You voted for', `“${m.answers[v]!.text}” by ${this.name(m.authors[v])}`, 'happy');
      }
      case 'fshow':
        return this.wait(id, 'Look at the TV!', 'Read all the answers. You get three votes.', 'wow');
      case 'fvote': {
        const picks = this.fvotes.get(id) ?? [];
        const left = this.votesLeft(id);
        if (left <= 0) return this.wait(id, picks.length ? 'Votes in!' : 'Nothing to vote for', 'Waiting for the others…');
        const total = finalVotesFor(id, this.entries, this.jinxed);
        return this.ask(
          id,
          `Vote ${picks.length + 1} of ${total}`,
          {
            k: 'choice',
            options: this.entries.map((e, i) => ({
              label: e.text,
              sub: e.author === id ? 'Yours' : this.jinxed[i] ? 'Jinx!' : picks.includes(i) ? 'Voted ✓' : undefined,
              off: !canPickFinal(id, this.entries, this.jinxed, picks, i),
            })),
            picked: null,
          },
          { endsAt: this.endsAt, text: this.finalPrompt },
        );
      }
      case 'freveal': {
        const r = this.fresult!;
        const i = this.entries.findIndex((e) => e.author === id);
        if (i < 0) return this.wait(id, 'Look at the TV!');
        const pts = r.points[id] ?? 0;
        const n = r.voters[i].length;
        return this.wait(id, r.winners.includes(i) ? 'Ostatnia Riposta!' : `${n} vote${n === 1 ? '' : 's'}`, `“${this.entries[i].text}”`, pts ? 'happy' : 'dead', `+${pts}`, pts > 0);
      }
      case 'scores': {
        const place = 1 + this.ids.filter((o) => (this.scores[o] ?? 0) > (this.scores[id] ?? 0)).length;
        return this.wait(
          id,
          this.isFinal ? 'That’s the game!' : `End of round ${this.round}`,
          `You’re #${place} with ${(this.scores[id] ?? 0).toLocaleString('en-US')} points.${this.isFinal ? '' : this.round + 1 > this.layout.rounds ? ' Ostatnia Riposta is next – votes ×3!' : ' Next round pays double!'}`,
          place === 1 ? 'wow' : 'happy',
        );
      }
    }
  }

  // ---- debug (only with ?debug: window.quip) ---------------------------------------

  /** Answer everything still open for everyone (as if typed). */
  debugAnswer() {
    if (this.phase !== 'write') return;
    for (const id of this.ids) {
      for (let p = this.pending(id); p >= 0; p = this.pending(id)) this.setAnswer(id, p, { text: this.safety(), auto: false });
    }
    this.update();
    this.maybeAdvance();
  }

  /** Random votes for everyone who can vote. `jinx` makes the next matchup's answers the same instead. */
  debugVote() {
    if (this.phase === 'vote') {
      for (const id of this.voters) if (!this.votes.has(id)) this.votes.set(id, Math.random() < 0.7 ? 0 : 1);
    } else if (this.phase === 'fvote') {
      for (const id of this.ids) {
        while (this.votesLeft(id) > 0) {
          const picks = this.fvotes.get(id) ?? [];
          const ok = this.entries.map((_, i) => i).filter((i) => canPickFinal(id, this.entries, this.jinxed, picks, i));
          this.fvotes.set(id, [...picks, ok[Math.floor(Math.random() * ok.length)]]);
        }
      }
    }
    this.update();
    this.maybeAdvance();
  }

  // ---- TV -------------------------------------------------------------------------

  private players() {
    return this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
  }

  private top(withTimer: number | null, extra?: ComponentChildren) {
    return (
      <div class="quiz-top">
        <div class={`pill ${this.isFinal ? 'pill-cat' : ''}`}>{this.isFinal ? 'Ostatnia Riposta · votes ×3' : `Round ${this.round} / ${this.layout.rounds}${this.mult > 1 ? ' · ×2' : ''}`}</div>
        {extra}
        <div class="grow" />
        {withTimer !== null && (
          <TimerRing key={`t${this.key}`} endsAt={this.endsAt} total={withTimer} size={130} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />
        )}
      </div>
    );
  }

  /** Everyone's pierogi, name and score along the bottom; `done` ticks them off. */
  private strip(done?: (id: string) => boolean) {
    return (
      <div class="qp-strip">
        {this.players().map((p) => {
          const ok = done?.(p.id);
          return (
            <div class={`qp-chip ${ok ? 'done' : ''} ${p.connected ? '' : 'offline'}`} style={{ '--pc': colorHex(p.color) }}>
              <Pierogi color={colorHex(p.color)} size={46} mood={!p.connected ? 'sleep' : ok ? 'happy' : 'happy'} />
              <span class="qp-chip-name">{p.name}</span>
              <b class="qp-chip-score">{(this.scores[p.id] ?? 0).toLocaleString('en-US')}</b>
              {ok && <i class="qp-chip-tick">✓</i>}
            </div>
          );
        })}
      </div>
    );
  }

  render() {
    switch (this.phase) {
      case 'title':
        return this.renderTitle();
      case 'write':
        return this.renderWrite();
      case 'show':
      case 'vote':
      case 'reveal':
        return this.renderMatchup();
      case 'fshow':
      case 'fvote':
      case 'freveal':
        return this.renderFinal();
      case 'scores':
        return this.renderScores();
    }
  }

  private renderTitle() {
    const final = this.isFinal;
    return (
      <div class={`screen qp-title ${final ? 'final' : ''}`} key={`title${this.round}`}>
        <div class="qp-kicker">Riposta</div>
        <h1 class="qp-big">{final ? 'Ostatnia Riposta' : `Round ${this.round}`}</h1>
        <p class="qp-sub">
          {final
            ? 'One prompt for everyone · three votes each · every vote ×3'
            : this.round === 1
              ? 'Two prompts each · answer on your phone · the room votes'
              : 'Two new prompts · every vote counts double!'}
        </p>
        {this.mult > 1 && <div class="qp-mult pop-in">×{this.mult}</div>}
        <div class="qp-title-row">
          {this.players().map((p, i) => (
            <Pierogi color={colorHex(p.color)} size={110} mood="wow" class="bob" style={{ animationDelay: `${i * -0.3}s` }} />
          ))}
        </div>
      </div>
    );
  }

  private renderWrite() {
    const final = this.isFinal;
    const total = final ? QP_FINAL_WRITE_MS : this.layout.writeMs;
    return (
      <div class="screen qp" key={`w${this.round}`}>
        {this.top(total, <div class="pill">Write!</div>)}
        {final ? (
          <>
            <div class="qp-prompt card-paper pop-in">{this.finalPrompt}</div>
            <p class="qp-sub">Everyone answers this one on their phone</p>
          </>
        ) : (
          <>
            <h2 class="qp-head">Answer your prompts on your phone!</h2>
            <p class="qp-sub">Funny beats clever. Stuck? Tap 🎲 and Babcia answers for you.</p>
          </>
        )}
        <div class="qp-chips">
          {this.players().map((p) => {
            const slots = this.slots(p.id);
            const open = this.pending(p.id);
            const doneCount = open < 0 ? slots.length : slots.indexOf(open);
            const done = open < 0;
            return (
              <div class={`answer-chip ${done ? 'done' : ''} ${p.connected ? '' : 'offline'}`}>
                <Pierogi color={colorHex(p.color)} size={72} mood={!p.connected ? 'sleep' : done ? 'happy' : 'wow'} class={done ? '' : 'bob'} />
                <span>{p.name}</span>
                <b>{done ? 'Done!' : final ? 'Writing…' : `${doneCount} / ${slots.length}`}</b>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  private renderMatchup() {
    const m = this.current!;
    const r = this.phase === 'reveal' ? this.result : null;
    const n = r ? r.voters[0].length + r.voters[1].length : 0;
    const authorsDelay = r ? authorsAt(n) : 0;
    /** Voters in the order they voted, so their pierogi pop in turn on both sides. */
    const popOrder = [...this.votes.keys()];
    return (
      <div class={`screen qp ${this.phase}`} key={`m${this.round}.${this.pos}`}>
        {this.top(this.phase === 'vote' ? QP_VOTE_MS : null, <div class="pill">Matchup {this.pos + 1} / {this.order.length}</div>)}
        <div class="qp-prompt card-paper qp-prompt-in">{m.prompt}</div>
        <div class="qp-duel">
          {([0, 1] as const).map((side) => {
            const a = m.answers[side]!;
            const author = this.host.player(m.authors[side]);
            const left = !this.here(m.authors[side]);
            const voters = r ? r.voters[side] : [];
            const pct = n ? Math.round((voters.length / n) * 100) : 0;
            const win = r && !r.jinx && r.winner === side;
            const lose = r && !r.jinx && r.winner !== null && r.winner !== side;
            const pts = r?.points[m.authors[side]] ?? 0;
            return (
              <div class={`qp-side s${side} ${win ? 'win' : ''} ${lose ? 'lose' : ''}`} style={{ '--win-at': `${authorsDelay}ms` }}>
                <div class="qp-answer" style={{ animationDelay: this.phase === 'show' ? `${1300 + side * 800}ms` : '0ms' }}>
                  <span class="qp-answer-text">{a.text}</span>
                </div>
                {r && !r.jinx && (
                  <>
                    <div class="qp-bar">
                      <div class="qp-bar-fill" style={{ '--w': `${pct}%`, '--c': colorHex(author?.color ?? 'sourcream'), animationDelay: `${authorsDelay - 600}ms` }} />
                      <span class="qp-pct" style={{ animationDelay: `${authorsDelay - 300}ms` }}>
                        {voters.length} vote{voters.length === 1 ? '' : 's'} · {pct}%
                      </span>
                    </div>
                    <div class="qp-voters">
                      {voters.map((v) => {
                        const p = this.host.player(v);
                        const k = popOrder.indexOf(v);
                        return p ? (
                          <span class="qp-voter" style={{ animationDelay: `${QP_POP_START_MS + Math.max(0, k) * QP_POP_STEP_MS}ms` }}>
                            <Pierogi color={colorHex(p.color)} size={58} mood="happy" />
                            <small>{p.name}</small>
                          </span>
                        ) : null;
                      })}
                    </div>
                    <div class="qp-author" style={{ animationDelay: `${authorsDelay}ms`, '--pc': colorHex(author?.color ?? 'sourcream') }}>
                      <Pierogi color={colorHex(author?.color ?? 'sourcream')} size={84} mood={pts ? 'wow' : 'dead'} />
                      <span class="qp-author-name">
                        {author?.name ?? '?'}
                        {left && <small> (left)</small>}
                        {a.auto && <small class="qp-auto"> 🎲 Babcia answered</small>}
                      </span>
                      <b class={`qp-pts ${pts ? '' : 'zero'}`}>+{pts.toLocaleString('en-US')}</b>
                    </div>
                  </>
                )}
                {r && r.riposta === side && (
                  <div class="qp-splash" style={{ animationDelay: `${authorsDelay + 400}ms` }}>
                    RIPOSTA!
                    <small>+{(250 * this.mult).toLocaleString('en-US')} bonus</small>
                  </div>
                )}
              </div>
            );
          })}
          <div class="qp-vs">VS</div>
          {r?.jinx && (
            <div class="qp-splash jinx">
              JINX!
              <small>Same answer – nobody scores</small>
            </div>
          )}
        </div>
        {this.phase === 'vote' && (
          <div class="bp-hint qp-hint">
            Vote for the funnier answer on your phone!
            <span class="bp-hint-count">
              {' '}
              {this.votes.size}/{this.voters.length} in
            </span>
          </div>
        )}
        {r && !r.jinx && n === 0 && (
          <div class="bp-hint qp-hint" style={{ animationDelay: '600ms' }}>
            {this.voters.length ? 'Nobody voted – no points!' : 'Nobody left to vote – no points!'}
          </div>
        )}
        {this.strip(this.phase === 'vote' ? (id) => this.votes.has(id) : undefined)}
      </div>
    );
  }

  private renderFinal() {
    const r = this.phase === 'freveal' ? this.fresult : null;
    const total = r ? r.voters.reduce((s, v) => s + v.length, 0) : 0;
    const authorsDelay = r ? finalAuthorsAt(total) : 0;
    const cols = this.entries.length <= 4 ? Math.max(1, this.entries.length) : Math.ceil(this.entries.length / 2);
    // Pop the votes in one entry after another.
    const startOf: number[] = [];
    if (r) r.voters.reduce((acc, v, i) => ((startOf[i] = acc), acc + v.length), 0);
    const voting = this.phase === 'fvote';
    const voters = this.ids.filter((id) => finalVotesFor(id, this.entries, this.jinxed) > 0);
    return (
      <div class={`screen qp qp-final ${this.phase}`} key={`f${this.round}`}>
        {this.top(voting ? QP_FINAL_VOTE_MS : null)}
        <div class="qp-prompt card-paper small">{this.finalPrompt}</div>
        <div class={`qp-grid n${this.entries.length}`} style={{ '--cols': cols }}>
          {this.entries.map((e, i) => {
            const author = this.host.player(e.author);
            const pts = r?.points[e.author] ?? 0;
            const win = r?.winners.includes(i);
            return (
              <div
                class={`qp-entry ${this.jinxed[i] ? 'jinxed' : ''} ${win ? 'win' : ''} ${r && !win ? 'lose' : ''}`}
                style={{ animationDelay: this.phase === 'fshow' ? `${1200 + i * 280}ms` : '0ms', '--win-at': `${authorsDelay}ms` }}
              >
                <span class="qp-letter">{LETTERS[i]}</span>
                <span class="qp-entry-text">{e.text}</span>
                {this.jinxed[i] && <span class="qp-jinx-tag">Jinx!</span>}
                {r && (
                  <>
                    <div class="qp-voters small">
                      {r.voters[i].map((v, k) => {
                        const p = this.host.player(v);
                        return p ? (
                          <span class="qp-voter" style={{ animationDelay: `${QP_POP_START_MS + (startOf[i] + k) * QP_FINAL_POP_MS}ms` }}>
                            <Pierogi color={colorHex(p.color)} size={40} mood="happy" />
                          </span>
                        ) : null;
                      })}
                    </div>
                    <div class="qp-author small" style={{ animationDelay: `${authorsDelay}ms`, '--pc': colorHex(author?.color ?? 'sourcream') }}>
                      <Pierogi color={colorHex(author?.color ?? 'sourcream')} size={52} mood={pts ? 'wow' : 'dead'} />
                      <span class="qp-author-name">
                        {author?.name ?? '?'}
                        {!this.here(e.author) && <small> (left)</small>}
                        {e.auto && <small> 🎲</small>}
                      </span>
                      <b class={`qp-pts ${pts ? '' : 'zero'}`}>+{pts.toLocaleString('en-US')}</b>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {voting && (
          <div class="bp-hint qp-hint">
            Three votes each – not for your own!
            <span class="bp-hint-count">
              {' '}
              {voters.filter((id) => this.votesLeft(id) <= 0).length}/{voters.length} done
            </span>
          </div>
        )}
        {r && r.winners.length > 0 && (
          <div class="qp-splash final" style={{ animationDelay: `${authorsDelay + 500}ms` }}>
            {r.winners.length > 1 ? 'A tie!' : `${this.name(this.entries[r.winners[0]].author)} wins the Riposta!`}
          </div>
        )}
        {r && total === 0 && <div class="bp-hint qp-hint">Nobody voted – no points!</div>}
        {this.phase !== 'freveal' && this.strip(voting ? (id) => voters.includes(id) && this.votesLeft(id) <= 0 : undefined)}
      </div>
    );
  }

  private renderScores() {
    const players = this.players();
    const title = this.isFinal ? 'Final scores' : this.round < this.layout.rounds ? `After round ${this.round} – round ${this.round + 1} pays double!` : `After round ${this.round} – Ostatnia Riposta is next!`;
    return (
      <div class="screen bp-scores qp-scores" key={`s${this.round}`}>
        <h2 class="screen-title">{title}</h2>
        <Leaderboard rows={players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: this.scores[p.id] ?? 0, delta: this.roundPoints[p.id] }))} />
      </div>
    );
  }
}
