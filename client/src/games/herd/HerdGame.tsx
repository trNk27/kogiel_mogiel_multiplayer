import { useEffect, useRef, useState } from 'preact/hooks';
import questions from '../../../../data/herd.json';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { usedSet } from '../usedStore';
import { ARENA_SCALE } from '../arena/kit';
import { TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import {
  ANSWER_MS,
  COW_PENALTY,
  HerdMatch,
  MAX_ANSWER,
  clusterOffsets,
  clusterRadius,
  herdSpots,
  homeSpots,
  pickHerdQuestions,
  questionsFor,
  revealOrder,
  sanitizeAnswer,
  scoreQuestion,
  type Applied,
  type HerdOutcome,
  type HerdQuestion,
  type Spot,
} from './logic';
import { HerdScene } from './scene';
import { CowIcon } from './icon';
import '../cookbook/cookbook.css';
import './herd.css';

const POOL = questions as HerdQuestion[];
const used = usedSet('herd');

const INTRO_MS = 3200;
/** Phones hand in what's typed just before the deadline; give it time to arrive. */
const GRACE_MS = 2000;
/** Once everyone's in, a moment before the reveal starts. */
const ALL_IN_MS = 1200;
const VERDICT_MS = 4200;
const COW_MS = 3600;
const FINAL_MS = 9000;
const HUD_MS = 120;

type Phase = 'intro' | 'answer' | 'reveal' | 'verdict' | 'cow' | 'final';

interface Shown {
  herd: number;
  spot: Spot;
  /** Where the sign stands. */
  sx: number;
  sz: number;
}

export class HerdGame implements Game {
  readonly id = 'herd' as const;
  readonly total: number;
  readonly match: HerdMatch;
  /** Everybody at the start, in join order (indices into the 3D scene). */
  private readonly all: string[];
  private readonly qs: HerdQuestion[];
  qi = -1;
  phase: Phase = 'intro';
  /** Bumped on every phase change: answers carry it back, and phones reset their input. */
  private key = 0;
  endsAt = 0;
  answers = new Map<string, string>();
  outcome: HerdOutcome | null = null;
  applied: Applied | null = null;
  /** Herds on the meadow so far, in reveal order. */
  shown: Shown[] = [];
  private order: number[] = [];
  private spots: Spot[] = [];
  private homes: Spot[];
  /** performance.now() of the verdict (for the "+1" pops). */
  private verdictAt = 0;
  private scene: HerdScene | null = null;
  private glError = false;
  private timer: number | undefined;
  private timers: number[] = [];
  private raf = 0;
  private lastFrame = 0;
  private lastHud = 0;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.total = questionsFor(host.short);
    this.match = new HerdMatch(ids);
    this.all = [...ids];
    this.homes = homeSpots(ids.length);
    this.qs = pickHerdQuestions(POOL, used, this.total);
  }

  get question() {
    return this.qs[this.qi]?.q ?? '';
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, HerdGame>).herd = this;
    this.nextQuestion();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.detach();
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new HerdScene(
        canvas,
        this.all.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.homes,
      );
      this.all.forEach((id, i) => !this.ids.includes(id) && this.scene?.hide(i));
      this.scene.setCow(this.match.cow ? this.all.indexOf(this.match.cow) : -1, true);
      // Coming back mid-question: put the herds back up.
      if (this.phase === 'intro' || this.phase === 'answer') this.scene.home();
      else this.shown.forEach((s, k) => this.placeHerd(s, k, true));
      if (this.phase !== 'reveal' && this.phase !== 'intro' && this.phase !== 'answer') this.lightWinner(false);
    } catch (err) {
      console.error(err);
      this.glError = true;
      this.host.changed();
    }
  }

  detach() {
    this.scene?.dispose();
    this.scene = null;
  }

  // ---- helpers ------------------------------------------------------------------------------------

  /** One pending step of the flow (a new one replaces it). */
  private after(ms: number, fn: () => void) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(fn, ms);
  }

  /** A side effect that doesn't replace the flow (sounds). */
  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private idx(id: string) {
    return this.all.indexOf(id);
  }

  private connected(id: string) {
    return !!this.host.player(id)?.connected;
  }

  private moo(delay = 0) {
    sound.note(190, 0.25, { type: 'sawtooth', vol: 0.09, slide: 150, delay });
    sound.note(150, 0.75, { type: 'sawtooth', vol: 0.11, slide: 105, delay: delay + 0.22 });
  }

  // ---- flow ---------------------------------------------------------------------------------------

  private nextQuestion() {
    this.qi++;
    if (this.qi >= this.total || this.qi >= this.qs.length) {
      this.finale();
      return;
    }
    this.phase = 'intro';
    this.key++;
    this.answers.clear();
    this.outcome = null;
    this.applied = null;
    this.shown = [];
    this.scene?.home();
    sound.reveal();
    this.after(INTRO_MS, () => this.openAnswers());
    this.update();
  }

  private openAnswers() {
    if (this.phase !== 'intro') return;
    this.phase = 'answer';
    this.key++;
    this.endsAt = Date.now() + ANSWER_MS;
    sound.whoosh();
    this.after(ANSWER_MS + GRACE_MS, () => this.startReveal());
    this.update();
  }

  private maybeAllIn() {
    if (this.phase !== 'answer') return;
    const live = this.ids.filter((id) => this.connected(id));
    if (live.length > 0 && live.every((id) => this.answers.has(id))) this.after(ALL_IN_MS, () => this.startReveal());
  }

  private startReveal() {
    if (this.phase !== 'answer') return;
    // Everyone still here who answered, or who was connected and answered nothing (a blank).
    const entries = this.ids.filter((id) => this.answers.has(id) || this.connected(id)).map((id) => ({ id, text: this.answers.get(id) ?? '' }));
    this.outcome = scoreQuestion(entries);
    this.order = revealOrder(this.outcome.herds);
    this.spots = herdSpots(this.order.length);
    this.shown = [];
    this.phase = 'reveal';
    this.key++;
    if (!this.order.length) {
      this.after(800, () => this.verdict());
      this.update();
      return;
    }
    const step = Math.max(1300, Math.min(2300, 10_000 / this.order.length));
    const next = () => {
      if (this.phase !== 'reveal') return;
      const k = this.shown.length;
      if (k >= this.order.length) {
        this.verdict();
        return;
      }
      const herd = this.order[k];
      const spot = this.spots[k];
      const h = this.outcome!.herds[herd];
      const s: Shown = { herd, spot, sx: spot.x, sz: spot.z - clusterRadius(h.members.length) - 0.2 };
      this.shown.push(s);
      this.placeHerd(s, k, false);
      // A rising note per member as they gallop in: the bigger the herd, the higher it climbs.
      h.members.forEach((_, m) => this.later(m * 160, () => sound.note(330 * Math.pow(1.12, m), 0.12, { type: 'triangle', vol: 0.12 })));
      if (h.blank) sound.plop();
      this.after(k === this.order.length - 1 ? step + 600 : step, next);
      this.host.changed();
    };
    this.after(500, next);
    this.update();
  }

  /** Put a herd's sign up and send its members running to it. */
  private placeHerd(s: Shown, k: number, instant: boolean) {
    const scene = this.scene;
    const h = this.outcome?.herds[s.herd];
    if (!scene || !h) return;
    scene.sign(s.sx, s.sz, h.blank);
    const offs = clusterOffsets(h.members.length);
    h.members.forEach((id, m) => {
      const i = this.idx(id);
      if (!this.ids.includes(id)) return;
      scene.runTo(i, s.spot.x + offs[m].x, s.spot.z + offs[m].z, instant ? 0 : m * 0.16);
    });
    void k;
  }

  private lightWinner(cheer: boolean) {
    const o = this.outcome;
    if (!o || o.winner < 0 || !this.scene) return;
    const s = this.shown.find((x) => x.herd === o.winner);
    if (!s) return;
    const n = o.herds[o.winner].members.length;
    this.scene.setGlow({ x: s.spot.x, z: s.spot.z, r: clusterRadius(n) });
    if (cheer) for (const id of o.scorers) this.ids.includes(id) && this.scene.cheer(this.idx(id));
  }

  private verdict() {
    if (this.phase !== 'reveal' || !this.outcome) return;
    this.applied = this.match.apply(this.outcome);
    this.phase = 'verdict';
    this.key++;
    this.verdictAt = performance.now();
    if (this.outcome.verdict === 'herd') {
      sound.fanfare();
      this.lightWinner(true);
      for (const id of this.applied.gained) this.host.buzz(id, [60, 60, 60]);
    } else sound.wrong();
    const cowMoved = this.applied.cowMoved;
    this.after(VERDICT_MS, () => (cowMoved ? this.cowStep() : this.nextQuestion()));
    this.update();
  }

  private cowStep() {
    if (this.phase !== 'verdict') return;
    this.phase = 'cow';
    this.key++;
    const to = this.match.cow;
    this.scene?.setCow(to ? this.idx(to) : -1);
    this.moo();
    this.moo(1.4);
    if (to) this.host.buzz(to, [300, 100, 300]);
    this.after(COW_MS, () => this.nextQuestion());
    this.update();
  }

  private finale() {
    this.phase = 'final';
    this.key++;
    this.outcome = null;
    this.shown = [];
    this.scene?.home();
    sound.drumroll(1.2);
    if (this.match.cow) this.later(1500, () => this.moo());
    this.later(2600, () => sound.fanfare());
    this.after(FINAL_MS, () => this.host.finish(this.match.final()));
    this.update();
  }

  // ---- loop ---------------------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.scene?.render(dt);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  // ---- debug (?debug: window.herd) -----------------------------------------------------------------

  /** Hand in answers for players by join order ('' or undefined: no answer). */
  fake(texts: (string | undefined)[]) {
    texts.forEach((t, i) => {
      const id = this.ids[i];
      const text = sanitizeAnswer(t ?? '');
      if (id && text && this.phase === 'answer' && !this.answers.has(id)) {
        this.answers.set(id, text);
        this.scene?.answered(this.idx(id));
      }
    });
    this.update();
    this.maybeAllIn();
  }

  /** Jump straight to the end of the answering time. */
  skip() {
    if (this.phase === 'intro') this.openAnswers();
    else if (this.phase === 'answer') this.startReveal();
  }

  // ---- phones -------------------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (!this.ids.includes(id) || m.t !== 'ask' || m.key !== this.key || this.phase !== 'answer') return;
    if (this.answers.has(id)) return;
    const text = sanitizeAnswer(m.text);
    if (!text) return;
    this.answers.set(id, text);
    this.scene?.answered(this.idx(id));
    sound.lockIn();
    this.host.refresh(id);
    this.host.changed();
    this.maybeAllIn();
  }

  onConnection() {
    this.maybeAllIn();
    this.host.changed();
  }

  onRemoved(id: string) {
    if (!this.ids.includes(id)) return;
    this.ids = this.ids.filter((x) => x !== id);
    this.match.remove(id);
    this.answers.delete(id);
    this.scene?.hide(this.idx(id));
    if (this.ids.length === 0) {
      this.dispose();
      this.host.finish({});
      return;
    }
    this.maybeAllIn();
    this.update();
  }

  private herdOf(id: string) {
    return this.outcome?.herds.findIndex((h) => h.members.includes(id)) ?? -1;
  }

  viewFor(id: string): PhoneView {
    const note = `Question ${Math.min(this.total, this.qi + 1)} / ${this.total}`;
    const score = this.match.scores[id] ?? 0;
    const base = { v: 'ask' as const, game: 'herd' as const, key: this.key, note, score };
    const cow = this.match.cow === id;
    switch (this.phase) {
      case 'intro':
        return { ...base, title: 'Get ready…', text: cow ? 'You have the Pink Cow. Agree with the herd to lose it to someone else!' : 'Think like the herd!', input: { k: 'none', mood: 'wow' } };
      case 'answer':
        return {
          ...base,
          title: this.question,
          text: 'Type what everybody else will',
          accent: '#ffc93c',
          endsAt: this.endsAt,
          input: { k: 'text', max: MAX_ANSWER, placeholder: 'Your answer', sent: this.answers.get(id) ?? null },
        };
      case 'reveal': {
        const said = this.answers.get(id);
        return { ...base, title: 'Look at the TV!', text: said ? `You said “${said}”. The herds are forming…` : 'The herds are forming…', input: { k: 'none', mood: 'happy' } };
      }
      case 'verdict':
      case 'cow': {
        const o = this.outcome;
        const won = !!o && o.scorers.includes(id);
        const gotCow = this.phase === 'cow' && cow;
        const h = o?.herds[this.herdOf(id)];
        const herdLabel = o && o.winner >= 0 ? o.herds[o.winner].label : '';
        if (gotCow) return { ...base, title: 'Różowa Krowa!', text: `You were the only odd one out. The Pink Cow is yours: −${COW_PENALTY} at the end, unless someone else takes it.`, input: { k: 'none', mood: 'dead', good: false } };
        if (won) return { ...base, title: 'Zgodni!', text: `The biggest herd said “${herdLabel}”`, input: { k: 'none', big: '+1', mood: 'wow', good: true } };
        if (o?.verdict === 'tie') return { ...base, title: 'Nie zgodni!', text: 'The biggest herds tied – nobody scores.', input: { k: 'none', mood: 'dead', good: false } };
        if (o?.verdict === 'apart') return { ...base, title: 'Nie zgodni!', text: 'Nobody agreed with anybody.', input: { k: 'none', mood: 'dead', good: false } };
        return {
          ...base,
          title: 'Not this time',
          text: h?.blank || !h ? `The herd said “${herdLabel}”` : `The herd said “${herdLabel}”, you said “${h.label}”`,
          input: { k: 'none', mood: 'dead', good: false },
        };
      }
      case 'final': {
        const final = this.match.final()[id] ?? 0;
        return {
          ...base,
          note: 'Game over',
          title: cow ? 'You ended with the Pink Cow!' : 'That’s all the questions!',
          text: cow ? `−${this.match.penalty(id)} for the cow.` : 'Final scores on the TV.',
          input: { k: 'none', big: `${final} pierogi`, mood: cow ? 'dead' : 'happy' },
        };
      }
    }
  }

  // ---- TV ---------------------------------------------------------------------------------------------

  render() {
    return <HerdView game={this} />;
  }

  hud() {
    const players = this.ids.map((id) => this.host.player(id));
    const cowP = this.match.cow ? this.host.player(this.match.cow) : undefined;
    const o = this.outcome;
    const answering = this.phase === 'answer';
    const live = this.ids.filter((id) => this.connected(id));
    const inCount = this.ids.filter((id) => this.answers.has(id)).length;
    return (
      <>
        <div class="herd-top">
          <span class="pill">
            {this.phase === 'final' ? 'Game over' : `Question ${this.qi + 1} / ${this.total}`}
          </span>
          {answering && (
            <TimerRing key={`t${this.qi}`} endsAt={this.endsAt} total={ANSWER_MS} size={120} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />
          )}
        </div>
        {this.phase !== 'final' && this.phase !== 'intro' && (
          <div class={`herd-q card-paper ${answering ? 'big' : ''}`} key={`q${this.qi}`}>
            {this.question}
            {answering && (
              <small>
                Answer like everybody else · {inCount}/{Math.max(live.length, inCount)} in
              </small>
            )}
          </div>
        )}
        <div class={`herd-cow ${this.phase === 'cow' ? 'moved' : ''}`} key={`c${this.match.cow ?? ''}`}>
          <CowIcon size={92} />
          <span class="herd-cow-text">
            <small>Różowa Krowa</small>
            {cowP ? <b style={{ color: colorHex(cowP.color) }}>{cowP.name}</b> : <b class="nobody">nobody yet</b>}
            <small>−{COW_PENALTY} at the end</small>
          </span>
        </div>
        {this.phase === 'intro' && (
          <div class="herd-intro" key={`i${this.qi}`}>
            <b>Pytanie {this.qi + 1}</b>
            <small>{this.qi === this.total - 1 ? 'The last question!' : 'Think like the herd!'}</small>
          </div>
        )}
        {o && (this.phase === 'reveal' || this.phase === 'verdict' || this.phase === 'cow') && this.signs()}
        {(this.phase === 'verdict' || this.phase === 'cow') && o && this.verdictRibbon(o)}
        {this.phase === 'verdict' && this.pluses()}
        <div class="cookbook-chips herd-chips">
          {this.ids.map((id, n) => {
            const p = players[n];
            if (!p) return null;
            const done = this.answers.has(id);
            const gain = (this.phase === 'verdict' || this.phase === 'cow') && this.applied?.gained.includes(id);
            const status = !p.connected ? 'offline' : answering ? (done ? 'answered ✓' : 'thinking…') : '';
            const pts = this.match.scores[id] ?? 0;
            return (
              <div class={`cookbook-chip herd-chip ${answering && done ? 'done' : ''} ${gain ? 'gain' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={!p.connected ? 'sleep' : gain ? 'wow' : answering && !done ? 'wow' : 'happy'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>
                    {pts} pierogi{status ? ` · ${status}` : ''}
                  </small>
                </span>
                {this.match.cow === id && <CowIcon size={44} />}
              </div>
            );
          })}
        </div>
        {this.phase === 'final' && this.finalBanner()}
        {this.glError && <div class="trails-banner herd-glerr">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  /** The answers, as labels over the signposts (or as plain cards without 3D). */
  private signs() {
    const o = this.outcome!;
    const glowing = this.phase !== 'reveal';
    const top = Math.max(0, ...o.herds.map((h) => (h.blank ? 0 : h.members.length)));
    const card = (s: Shown) => {
      const h = o.herds[s.herd];
      const n = h.members.filter((id) => this.ids.includes(id)).length;
      const cls = ['herd-sign', h.blank ? 'blank' : '', glowing && s.herd === o.winner ? 'win' : '', glowing && o.verdict === 'tie' && !h.blank && h.members.length === top ? 'tie' : '', glowing && h.members.length === 1 && o.cow === h.members[0] ? 'cow' : '']
        .filter(Boolean)
        .join(' ');
      return { h, n, cls };
    };
    if (!this.scene) {
      return (
        <div class="herd-fallback">
          {this.shown.map((s) => {
            const { h, n, cls } = card(s);
            return (
              <div class={cls} key={s.herd}>
                <span class="herd-sign-text">{h.blank ? 'no answer' : h.label}</span>
                <span class="herd-sign-n">{n}</span>
                <span class="herd-sign-who">{h.members.map((id) => this.host.player(id)?.name ?? '').join(' · ')}</span>
              </div>
            );
          })}
        </div>
      );
    }
    return this.shown.map((s) => {
      const { h, n, cls } = card(s);
      const at = this.scene!.toStage(s.sx, 1.95, s.sz);
      return (
        <div class={cls} key={`s${this.qi}.${s.herd}`} style={{ left: at.x, top: at.y }}>
          <span class="herd-sign-text">{h.blank ? 'no answer' : h.label}</span>
          {!h.blank && n > 1 && <span class="herd-sign-n">×{n}</span>}
        </div>
      );
    });
  }

  private pluses() {
    const o = this.outcome;
    if (!o || !this.scene || !this.applied) return null;
    const age = performance.now() - this.verdictAt;
    if (age > 3000) return null;
    return this.applied.gained.map((id) => {
      const at = this.scene!.headOf(this.idx(id));
      const p = this.host.player(id);
      if (!at || !p) return null;
      return (
        <div class="herd-plus" key={`p${this.qi}${id}`} style={{ left: at.x, top: at.y, '--pc': colorHex(p.color) }}>
          +1
        </div>
      );
    });
  }

  private verdictRibbon(o: HerdOutcome) {
    const name = (id: string | null) => (id ? (this.host.player(id)?.name ?? '?') : '');
    if (this.phase === 'cow') {
      const from = this.applied?.cowFrom && this.ids.includes(this.applied.cowFrom) ? name(this.applied.cowFrom) : null;
      return (
        <div class="herd-verdict cow" key={`cow${this.qi}`}>
          <b>Różowa Krowa → {name(this.match.cow)}!</b>
          <small>{from ? `The only odd one out takes the cow from ${from}` : 'The only odd one out gets the Pink Cow'}</small>
        </div>
      );
    }
    let big: string;
    let small: string;
    if (o.verdict === 'herd') {
      const h = o.herds[o.winner];
      big = `Zgodni! “${h.label}”`;
      small = `${h.members.length} think alike · +1 pierogi each`;
    } else if (o.verdict === 'tie') {
      const top = Math.max(...o.herds.map((h) => (h.blank ? 0 : h.members.length)));
      const n = o.herds.filter((h) => !h.blank && h.members.length === top).length;
      big = 'Nie zgodni!';
      small = `${n === 2 ? 'Two' : n === 3 ? 'Three' : n} herds of ${top} – a tie scores nobody`;
    } else {
      big = 'Nie zgodni!';
      small = o.herds.length ? 'Nobody agreed with anybody' : 'Nobody answered';
    }
    return (
      <div class={`herd-verdict ${o.verdict}`} key={`v${this.qi}`}>
        <b>{big}</b>
        <small>{small}</small>
      </div>
    );
  }

  private finalBanner() {
    const final = this.match.final();
    const rows = this.ids
      .map((id) => ({ id, p: this.host.player(id), score: final[id] ?? 0 }))
      .filter((r) => r.p)
      .sort((a, b) => b.score - a.score);
    const best = rows[0]?.score ?? 0;
    return (
      <div class="trails-banner cookbook-banner herd-final pop-in">
        <div class="trails-banner-small">That’s all {this.total} questions</div>
        <div class="trails-banner-big cookbook-banner-big">{rows.length && rows.filter((r) => r.score === best).length === 1 ? `${rows[0].p!.name} thinks most like the herd!` : 'The herd has spoken!'}</div>
        <div class="cookbook-banner-list">
          {rows.map((r) => {
            const pen = this.match.penalty(r.id);
            const cow = this.match.cow === r.id;
            return (
              <div class={`cookbook-banner-row ${r.score === best ? 'win' : ''}`} style={{ '--pc': colorHex(r.p!.color) }}>
                <Pierogi color={colorHex(r.p!.color)} size={38} mood={cow ? 'dead' : r.score === best ? 'wow' : 'happy'} />
                <span class="grow">{r.p!.name}</span>
                {cow && (
                  <span class="herd-final-cow">
                    <CowIcon size={40} /> −{pen}
                  </span>
                )}
                <b>{r.score}</b>
              </div>
            );
          })}
        </div>
        <div class="trails-banner-small cookbook-next">{this.match.cow ? `The Pink Cow costs ${this.host.player(this.match.cow)?.name ?? '?'} ${COW_PENALTY} pierogi` : 'Nobody ended up with the Pink Cow'}</div>
      </div>
    );
  }
}

function HerdView({ game }: { game: HerdGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook herd">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
