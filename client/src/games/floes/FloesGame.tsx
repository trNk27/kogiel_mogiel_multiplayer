import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DT, FLOES_ROUNDS, FLOES_ROUNDS_SHORT, FloesSim, ROUND_S, WATER_Y, type FloesEvent } from './logic';
import { FloesScene } from './scene';
import '../cookbook/cookbook.css';
import './floes.css';

const COUNTDOWN_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 6000;
const BANNER_DELAY_MS = 1100;
const HUD_MS = 150;

const LAYER_NAMES = ['Top layer', 'Middle layer', 'Bottom layer'];
const LAYER_SHORT = ['Top', 'Middle', 'Bottom'];
const LAYER_TEXT = ['Jump over the holes!', 'Down one – keep going!', 'Last layer – the river is next!'];
const LAYER_ACCENT = ['#ffffff', '#b9def5', '#79b2e0'];

type Phase = 'ready' | 'play' | 'over';

interface Pop {
  idx: number;
  x: number;
  z: number;
  until: number;
  key: number;
}

export class FloesGame implements Game {
  readonly id = 'floes' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: FloesSim;
  readonly input: ArenaInput;
  scores: number[];
  roundPts: number[];
  winners: number[] = [];
  goAt = 0;
  overAt = 0;
  pops: Pop[] = [];
  /** performance.now() of the last "down a layer" call, and which layer. */
  callAt = -1e9;
  call = '';
  private deepest = 0;
  readonly removed = new Set<number>();
  private scene: FloesScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private lastCrack = 0;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? FLOES_ROUNDS_SHORT : FLOES_ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, FloesGame>).floes = this;
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
      this.scene = new FloesScene(
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

  // ---- round flow --------------------------------------------------------------------------------

  private newRound() {
    this.round++;
    this.input.release();
    this.sim = new FloesSim(
      this.ids.length,
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
    );
    this.scene?.reset(this.sim);
    this.removed.forEach((i) => this.scene?.hide(i));
    this.roundPts = this.ids.map(() => 0);
    this.winners = [];
    this.pops = [];
    this.deepest = 0;
    this.callAt = -1e9;
    this.phase = 'ready';
    this.goAt = Date.now() + COUNTDOWN_MS;
    [COUNTDOWN_MS - 3000, COUNTDOWN_MS - 2000, COUNTDOWN_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && sound.count()));
    this.later(COUNTDOWN_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      this.sim.begin();
      sound.go();
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
    r.points.forEach((p, i) => (this.scores[i] += p));
    this.overAt = performance.now();
    if (this.sim.timeout) sound.whistle();
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
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += elapsed;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.tick(now);
    }
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private tick(now: number) {
    const sim = this.sim;
    this.ids.forEach((id, i) => {
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected && this.phase === 'play';
      const pad = this.input.pads[i];
      sim.setStick(i, live ? pad.x : 0, live ? pad.y : 0);
      const n = this.input.takePresses(i, 0);
      if (live && n > 0) sim.press(i);
    });
    const events = sim.step();
    if (events.length) this.handle(events, now);
  }

  private handle(events: FloesEvent[], now: number) {
    let refresh = false;
    for (const e of events) {
      switch (e.t) {
        case 'crack':
          this.scene?.cracked(e.l, e.f);
          if (now - this.lastCrack > 70) {
            this.lastCrack = now;
            sound.note(2200 + Math.random() * 900, 0.035, { type: 'square', vol: 0.025 });
          }
          break;
        case 'drop':
          this.scene?.dropped(this.sim, e.l, e.f);
          sound.hiss(0.09, 0.05);
          break;
        case 'jump':
          this.scene?.jumped(e.i);
          sound.note(520, 0.12, { type: 'triangle', vol: 0.06, slide: 900 });
          break;
        case 'fall':
          sound.note(700, 0.35, { type: 'sine', vol: 0.05, slide: 260 });
          break;
        case 'land': {
          this.scene?.landed(e.i, e.hard);
          if (e.hard) {
            sound.note(140, 0.12, { type: 'sine', vol: 0.12, slide: 70 });
            this.host.buzz(this.ids[e.i], [60]);
          }
          if (e.l > this.deepest && !this.sim.solo) {
            this.deepest = e.l;
            this.callAt = now;
            this.call = e.l === 1 ? 'Layer two!' : 'Last layer!';
          } else if (e.l > this.deepest) this.deepest = e.l;
          refresh = true;
          break;
        }
        case 'splash':
          this.scene?.splashed(e.i, e.x, e.z);
          sound.plop();
          sound.hiss(0.45, 0.22);
          this.host.buzz(this.ids[e.i], [220, 50, 140]);
          this.pops.push({ idx: e.i, x: e.x, z: e.z, until: now + 1800, key: this.sim.tick * 10 + e.i });
          refresh = true;
          break;
        case 'over':
          this.endRound();
          refresh = false;
          break;
      }
    }
    if (refresh) this.update();
  }

  // ---- phones ------------------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    this.input.handle(id, m);
  }

  onConnection(id: string, connected: boolean) {
    if (!connected) this.input.release(this.ids.indexOf(id));
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i)) return;
    this.removed.add(i);
    this.input.release(i);
    this.sim.remove(i);
    this.scene?.hide(i);
    if (this.removed.size >= this.ids.length) {
      this.host.finish({});
      return;
    }
    this.update();
  }

  private dryCount() {
    return `${this.sim.aliveCount}/${this.ids.length - this.removed.size}`;
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const sim = this.sim;
    const p = sim.players[i];
    const jump: PadButton = { label: 'Jump!', color: '#8fd0ff' };
    const base = { v: 'pad' as const, game: 'floes' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    const layer = p ? Math.min(2, p.layer) : 0;
    const stats = sim.solo ? [{ k: 'Layer', v: LAYER_SHORT[layer] }] : [{ k: 'Layer', v: LAYER_SHORT[layer] }, { k: 'Dry', v: this.dryCount() }];
    if (this.phase === 'ready') {
      return { ...base, phase: 'ready', title: 'Get ready!', text: 'The ice cracks where you stand', buttons: [{ ...jump, off: true }], stats };
    }
    if (this.phase === 'over') {
      const pts = this.roundPts[i] ?? 0;
      const won = this.winners.includes(i);
      const secs = Math.floor(sim.survived(i));
      return {
        ...base,
        phase: 'over',
        noStick: true,
        title: sim.solo ? `${secs} second${secs === 1 ? '' : 's'}!` : won ? (this.winners.length > 1 ? 'A tie for first!' : 'Last one dry!') : 'Round over',
        text: sim.solo ? 'That is how long you stayed dry.' : `+${pts} point${pts === 1 ? '' : 's'}`,
        accent: won ? '#ffc93c' : undefined,
        buttons: [],
        stats,
      };
    }
    if (!p || !p.alive) {
      return { ...base, phase: 'out', noStick: true, title: 'In the water!', text: 'Brr! Watch the TV', accent: '#8fc0e8', buttons: [], stats };
    }
    return { ...base, phase: 'play', title: 'Keep moving!', text: LAYER_TEXT[layer], accent: LAYER_ACCENT[layer], buttons: [jump], stats };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <FloesView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const left = Math.ceil(sim.timeLeft);
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    return (
      <>
        <div class="floes-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          <span class="floes-rule">Keep moving – the ice cracks where you stand!</span>
        </div>
        <div class="floes-count">
          {sim.solo ? (
            <>
              <b>{sim.survived(0).toFixed(1)}</b>
              <small>seconds dry</small>
            </>
          ) : (
            <>
              <b>{sim.aliveCount}</b>
              <small>still dry</small>
            </>
          )}
          <span class={`floes-clock ${left <= 10 && this.phase === 'play' ? 'hurry' : ''}`}>{clock}</span>
        </div>
        {now - this.callAt < 1400 && (
          <div class="floes-call" key={`c${this.callAt}`}>
            {this.call}
          </div>
        )}
        {this.pops.map((s) => {
          const p = players[s.idx];
          if (!p || s.until < now) return null;
          const at = this.scene?.toStage(s.x, WATER_Y + 1.6, s.z);
          if (!at) return null;
          return (
            <div class="cookbook-splat" key={s.key} style={{ left: at.x, top: Math.min(1000, at.y), '--pc': colorHex(p.color) }}>
              Plusk!
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
              <div class={`cookbook-chip ${out ? 'out' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={out ? 'dead' : p.connected ? 'happy' : 'sleep'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>
                    {this.phase === 'over'
                      ? sim.solo
                        ? `${Math.floor(sim.survived(i))} s dry`
                        : `+${this.roundPts[i]} · ${this.scores[i]} total`
                      : out
                        ? `In the water · ${sim.survived(i).toFixed(1)} s`
                        : `${LAYER_NAMES[Math.min(2, a.layer)]} · ${this.scores[i]} pts`}
                  </small>
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

  private banner(players: ReturnType<GameHost['player']>[]) {
    const sim = this.sim;
    const name = (i: number) => players[i]?.name ?? '?';
    const order = this.ids
      .map((_, i) => i)
      .filter((i) => !this.removed.has(i))
      .sort((a, b) => this.roundPts[b] - this.roundPts[a] || sim.survived(b) - sim.survived(a));
    let big: string;
    const secs = Math.floor(sim.survived(0));
    if (sim.solo) big = `${secs} second${secs === 1 ? '' : 's'} dry!`;
    else if (this.winners.length === 1) big = `${name(this.winners[0])} stays dry!`;
    else if (this.winners.length > 1) big = `A tie: ${this.winners.map(name).join(' & ')}`;
    else big = 'Round over';
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds}
          {sim.timeout ? ` · ${ROUND_S} seconds – time is up!` : sim.solo ? ' · into the river' : ''}
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
        {!sim.solo && (
          <div class="cookbook-banner-list">
            {order.map((i) => {
              const p = players[i];
              const won = this.winners.includes(i);
              return p ? (
                <div class={`cookbook-banner-row ${won ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                  <Pierogi color={colorHex(p.color)} size={38} mood={won ? 'wow' : 'dead'} />
                  <span class="grow">{p.name}</span>
                  <small class="floes-row-time">{sim.players[i]?.alive ? 'dry!' : `${sim.survived(i).toFixed(1)} s`}</small>
                  <b>+{this.roundPts[i]}</b>
                </div>
              ) : null;
            })}
          </div>
        )}
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'Fresh ice is floating in…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function FloesView({ game }: { game: FloesGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook floes">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
