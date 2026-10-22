import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type AskInput, type AskView, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { BELLS, BELLS_ROUNDS, BELLS_ROUNDS_SHORT, BellsSim, MAX_LEN, lenAt, limitMs, type BellsEvent } from './logic';
import { BellsScene } from './scene';
import { chime, clonk, countBell, ringBell, ringHandbell } from './sounds';
import '../cookbook/cookbook.css';
import './bells.css';

const COUNTDOWN_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 6500;
const BANNER_DELAY_MS = 900;
const HUD_MS = 120;
/** Progress shows as dots up to this many notes, as a number after. */
const MAX_DOTS = 12;

type Phase = 'ready' | 'play' | 'over';

interface Pop {
  idx: number;
  text: string;
  until: number;
  key: number;
}

const KEYS = BELLS.map((b) => ({ label: b.name, color: b.color }));

export class BellsGame implements Game {
  readonly id = 'bells' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: BellsSim;
  scores: number[];
  roundPts: number[];
  winners: number[] = [];
  goAt = 0;
  overAt = 0;
  /** The last turn's outcome, for the call under the top bar. */
  lastResolve: { turn: number; out: number[]; safe: number[] } | null = null;
  pops: Pop[] = [];
  readonly removed = new Set<number>();
  /** Debug: bots ring for everybody (`window.bells.bots(true)`), getting a note wrong this often. */
  botErr: number | null = null;
  private botAt: number[] = [];
  private lit: number | null = null;
  private scene: BellsScene | null = null;
  private glError = false;
  private raf = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private timers: number[] = [];
  private popKey = 0;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? BELLS_ROUNDS_SHORT : BELLS_ROUNDS;
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, BellsGame>).bells = this;
    this.newRound();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.detach();
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new BellsScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
      );
      this.scene.reset(this.sim);
      this.removed.forEach((i) => this.scene?.hide(i));
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

  /** Debug: let bots ring for every player (`err`: the chance of a wrong bell per note). */
  bots(on = true, err = 0.04) {
    this.botErr = on ? err : null;
  }

  // ---- round flow --------------------------------------------------------------------------------

  private newRound() {
    this.round++;
    this.sim = new BellsSim(
      this.ids.length,
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
      this.round * 1000,
    );
    this.scene?.reset(this.sim);
    this.roundPts = this.ids.map(() => 0);
    this.winners = [];
    this.pops = [];
    this.lastResolve = null;
    this.lit = null;
    this.phase = 'ready';
    this.goAt = Date.now() + COUNTDOWN_MS;
    [COUNTDOWN_MS - 3000, COUNTDOWN_MS - 2000, COUNTDOWN_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && countBell(false)));
    this.later(COUNTDOWN_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      this.handle(this.sim.begin(Date.now()));
      this.update();
    });
    this.update();
  }

  private endRound() {
    if (this.phase === 'over') return;
    const r = this.sim.results();
    this.phase = 'over';
    this.roundPts = r.points;
    this.winners = r.winners;
    // Together you add up round points; on your own you keep your longest tune.
    r.points.forEach((p, i) => (this.scores[i] = this.sim.solo ? Math.max(this.scores[i], p) : this.scores[i] + p));
    this.overAt = performance.now();
    this.later(BANNER_DELAY_MS, () => this.phase === 'over' && sound.fanfare());
    this.later(OVER_MS, () => (this.round < this.rounds ? this.newRound() : this.finish()));
    this.update();
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.scores[i]));
    this.host.finish(out);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- loop --------------------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.phase === 'play') {
      const t = Date.now();
      this.handle(this.sim.step(t));
      if (this.botErr !== null) this.runBots(t);
      // Phones mirror the glowing bell while the tune plays.
      const lit = this.sim.lit(t);
      if (lit !== this.lit) {
        this.lit = lit;
        this.host.refresh();
      }
    }
    this.scene?.render(this.sim, dt, this.phase === 'play' && this.sim.phase === 'repeat');
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private handle(events: BellsEvent[]) {
    for (const e of events) {
      switch (e.t) {
        case 'turn':
          this.lastResolve = null;
          this.update();
          break;
        case 'note':
          this.scene?.ring(e.bell);
          ringBell(e.bell);
          break;
        case 'repeat':
          sound.pickup();
          this.ids.forEach((id, i) => this.sim.players[i]?.alive && this.host.buzz(id, [40]));
          this.update();
          break;
        case 'out':
          this.knockOut(e.i, 'Too slow!');
          break;
        case 'resolve':
          this.lastResolve = { turn: e.turn, out: e.out, safe: e.safe };
          if (e.safe.length && !e.out.length) this.later(150, () => sound.correct());
          else if (e.out.length && !e.safe.length) this.later(150, () => sound.wrong());
          this.update();
          break;
        case 'over':
          this.endRound();
          break;
      }
    }
  }

  private knockOut(i: number, text: string) {
    this.scene?.out(i);
    clonk();
    this.host.buzz(this.ids[i], [220, 60, 160]);
    this.pops.push({ idx: i, text, until: performance.now() + 1700, key: ++this.popKey });
  }

  private tap(i: number, bell: number, key: number) {
    if (this.phase !== 'play') return;
    const r = this.sim.tap(i, bell, key, Date.now());
    if (!r) return;
    if (r.ok) {
      this.scene?.handbell(i, bell);
      ringHandbell(bell);
      if (r.done) {
        this.scene?.cheer(i);
        this.later(120, chime);
      }
    } else {
      this.scene?.handbell(i, bell);
      this.knockOut(i, 'Wrong bell!');
    }
    this.host.refresh(this.ids[i]);
    this.host.changed();
  }

  private runBots(now: number) {
    const sim = this.sim;
    if (sim.phase !== 'repeat') return;
    sim.players.forEach((p, i) => {
      if (!p.alive || p.done) return;
      if ((this.botAt[i] ?? 0) > now) return;
      this.botAt[i] = now + 260 + Math.random() * 260;
      const want = sim.tune[p.pos];
      const bell = Math.random() < (this.botErr ?? 0) ? (want + 1) % BELLS.length : want;
      this.tap(i, bell, sim.key);
    });
  }

  // ---- phones ------------------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'ask' || typeof m.i !== 'number') return;
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i)) return;
    this.tap(i, m.i, m.key);
  }

  onConnection() {
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i)) return;
    this.removed.add(i);
    this.sim.remove(i);
    this.scene?.hide(i);
    if (this.removed.size >= this.ids.length) {
      this.host.finish({});
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const sim = this.sim;
    const p = sim.players[i];
    const base = { v: 'ask' as const, game: 'bells' as const, note: `Round ${this.round} / ${this.rounds}${sim.turn ? ` · Tune ${sim.turn}` : ''}`, score: this.scores[i] ?? 0 };
    const keys = (off: boolean, lit: number | null = null): AskInput => ({ k: 'keys', keys: KEYS, off, lit });
    const none = (mood: 'happy' | 'wow' | 'dead' | 'sleep', good?: boolean, big?: string): AskInput => ({ k: 'none', mood, good, big });
    const view = (v: Omit<AskView, 'v' | 'game' | 'note' | 'score'>): AskView => ({ ...base, ...v });
    if (!p || p.gone) return view({ key: 0, title: 'Watch the TV', input: none('sleep') });

    if (this.phase === 'ready') return view({ key: sim.keyBase, title: 'Get ready!', text: 'Listen to the bells, then ring them back', input: keys(true) });
    if (this.phase === 'over') {
      const pts = this.roundPts[i] ?? 0;
      const won = this.winners.includes(i);
      if (sim.solo) return view({ key: sim.keyBase + 999, title: `${p.best} notes!`, text: 'Your longest tune', accent: '#ffc93c', input: none(p.best ? 'wow' : 'dead', p.best > 0, `${p.best}`) });
      return view({
        key: sim.keyBase + 999,
        title: won ? (this.winners.length > 1 ? 'A tie for first!' : 'You win the round!') : 'Round over',
        text: `+${pts} point${pts === 1 ? '' : 's'}`,
        accent: won ? '#ffc93c' : undefined,
        input: none(won ? 'wow' : 'happy', won, `+${pts}`),
      });
    }

    const len = sim.len;
    if (!p.alive) {
      if (p.outAt === sim.turn)
        return view({
          key: sim.afterKey,
          title: p.why === 'time' ? 'Too slow – you’re out!' : 'Wrong bell – you’re out!',
          text: `You rang ${p.pos} of ${len}`,
          accent: '#ff7a8a',
          input: none('dead', false),
        });
      return view({ key: sim.key, title: 'You’re out', text: `Watch the others: tune ${sim.turn}`, input: keys(true, sim.lit(Date.now())) });
    }
    if (sim.phase === 'idle' || sim.phase === 'listen') return view({ key: sim.key, title: 'Listen…', text: `${len} notes`, input: keys(true, sim.lit(Date.now())) });
    if (sim.phase === 'repeat' && !p.done)
      return view({ key: sim.key, title: `Your turn! ${len} notes`, text: `${p.pos} / ${len}`, accent: '#ffc93c', endsAt: sim.endsAt, input: keys(false) });
    return view({
      key: sim.afterKey,
      title: 'Perfect!',
      text: sim.phase === 'repeat' ? 'Waiting for the others…' : len >= MAX_LEN ? 'That was the longest tune!' : `Next: ${len + 1} notes`,
      accent: '#2fd6a8',
      input: none('wow', true, `${len} / ${len}`),
    });
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <BellsView game={this} />;
  }

  private call() {
    const sim = this.sim;
    if (this.phase !== 'play') return null;
    const now = Date.now();
    if (sim.phase === 'listen') {
      return (
        <div class="bells-call" key={`l${sim.turn}`}>
          <b>Listen…</b>
          <div class="bells-tune">
            {sim.tune.map((_, k) => (
              <i class={k < sim.played ? 'on' : ''} />
            ))}
          </div>
        </div>
      );
    }
    if (sim.phase === 'repeat') {
      const left = Math.max(0, sim.endsAt - now);
      return (
        <div class="bells-call go" key={`r${sim.turn}`}>
          <b>Ring it back!</b>
          <div class="bells-timer">
            <span style={{ width: `${(left / limitMs(sim.len)) * 100}%` }} />
          </div>
        </div>
      );
    }
    const r = this.lastResolve;
    if (sim.phase === 'result' && r) {
      const name = (i: number) => this.host.player(this.ids[i])?.name ?? '?';
      let text: string;
      if (!r.out.length) text = r.safe.length > 1 ? 'Everyone got it!' : 'Perfect!';
      else if (!r.safe.length) text = r.out.length > 1 ? 'Nobody got it!' : `${name(r.out[0])} is out!`;
      else text = r.out.length === 1 ? `${name(r.out[0])} is out!` : `${r.out.length} are out!`;
      return (
        <div class={`bells-call result ${r.out.length ? 'bad' : 'good'}`} key={`x${r.turn}`}>
          <b>{text}</b>
          {!sim.over && sim.len < MAX_LEN && (r.safe.length > 1 || (sim.solo && r.safe.length)) && <small>Next tune: {sim.len + 1} notes</small>}
        </div>
      );
    }
    return null;
  }

  private dots(i: number) {
    const sim = this.sim;
    const p = sim.players[i];
    if (!p || p.gone || this.phase !== 'play' || sim.phase === 'listen' || sim.phase === 'idle') return null;
    if (p.outAt !== null && p.outAt < sim.turn) return null;
    const at = this.scene?.above(i);
    if (!at) return null;
    const pc = colorHex(this.host.player(this.ids[i])?.color ?? 'sourcream');
    const state = p.done ? 'done' : !p.alive ? 'out' : '';
    return (
      <div class={`bells-dots ${state}`} style={{ left: at.x, top: at.y, '--pc': pc }}>
        {p.done ? (
          <span class="bells-tick">✓</span>
        ) : !p.alive ? (
          <span class="bells-cross">✗</span>
        ) : sim.len > MAX_DOTS ? (
          <span class="bells-num">
            {p.pos}/{sim.len}
          </span>
        ) : (
          sim.tune.map((_, k) => <i class={k < p.pos ? 'on' : ''} />)
        )}
      </div>
    );
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const rule = this.phase === 'ready' ? 'Listen, then ring it back!' : sim.phase === 'repeat' ? 'Ring the tune back on your phone!' : 'Listen to the bells…';
    return (
      <>
        <div class="cookbook-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          {sim.turn > 0 && <span class="pill cookbook-page">{sim.len >= MAX_LEN ? `Last tune: ${sim.len} notes` : `Tune: ${sim.len} notes`}</span>}
          <span class="cookbook-rule">{rule}</span>
        </div>
        {this.call()}
        {this.ids.map((_, i) => (this.removed.has(i) ? null : this.dots(i)))}
        {this.pops.map((s) => {
          const p = players[s.idx];
          if (!p || s.until < now) return null;
          const at = this.scene?.above(s.idx);
          if (!at) return null;
          return (
            <div class="cookbook-splat bells-pop" key={s.key} style={{ left: at.x, top: at.y - 50, '--pc': colorHex(p.color) }}>
              {s.text}
            </div>
          );
        })}
        <div class="cookbook-chips">
          {this.ids.map((_, i) => {
            const p = players[i];
            const a = sim.players[i];
            if (!p || !a || this.removed.has(i)) return null;
            const out = !a.alive;
            return (
              <div class={`cookbook-chip ${out ? 'out' : ''} ${a.done ? 'bells-ok' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={out ? 'dead' : !p.connected ? 'sleep' : a.done ? 'wow' : 'happy'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{this.status(i)}</small>
                </span>
              </div>
            );
          })}
        </div>
        {this.phase === 'ready' && <BigCountdown key={this.goAt} endsAt={this.goAt} />}
        {this.phase === 'over' && now - this.overAt > BANNER_DELAY_MS && this.banner(players)}
        {this.glError && <div class="trails-banner">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  private status(i: number) {
    const sim = this.sim;
    const a = sim.players[i];
    const total = sim.solo ? `best ${this.scores[i]}` : `${this.scores[i]} pts`;
    if (this.phase === 'over') return sim.solo ? `${a.best} notes · ${total}` : `+${this.roundPts[i]} · ${this.scores[i]} total`;
    if (!a.alive && a.outAt !== null) return `${a.why === 'time' ? 'Too slow' : 'Wrong bell'} on ${lenAt(a.outAt)} notes`;
    if (this.phase === 'ready' || sim.phase === 'idle') return `Ready · ${total}`;
    if (sim.phase === 'listen') return `Listening… · ${total}`;
    if (a.done) return `Perfect! · ${total}`;
    if (sim.phase === 'repeat') return `${a.pos} / ${sim.len} · ${total}`;
    return total;
  }

  private banner(players: ReturnType<GameHost['player']>[]) {
    const sim = this.sim;
    const name = (i: number) => players[i]?.name ?? '?';
    const best = sim.results().best;
    const order = this.ids
      .map((_, i) => i)
      .filter((i) => !this.removed.has(i))
      .sort((a, b) => this.roundPts[b] - this.roundPts[a]);
    let big: string;
    if (sim.solo) big = `${best} note${best === 1 ? '' : 's'}!`;
    else if (this.winners.length === 1) big = `${name(this.winners[0])} wins the round!`;
    else if (this.winners.length > 1) big = `A tie: ${this.winners.map(name).join(' & ')}`;
    else big = 'Round over';
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {sim.solo ? 'your longest tune' : `the longest tune rung: ${best} notes`}
          {sim.len >= MAX_LEN && sim.aliveCount > 0 ? ' · Babcia ran out of rope!' : ''}
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
        {!sim.solo && (
          <div class="cookbook-banner-list">
            {order.map((i) => {
              const p = players[i];
              return p ? (
                <div class={`cookbook-banner-row ${this.winners.includes(i) ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                  <Pierogi color={colorHex(p.color)} size={38} mood={this.winners.includes(i) ? 'wow' : 'dead'} />
                  <span class="grow">{p.name}</span>
                  <b>+{this.roundPts[i]}</b>
                </div>
              ) : null;
            })}
          </div>
        )}
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'Babcia is learning a new tune…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function BellsView({ game }: { game: BellsGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook bells">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
