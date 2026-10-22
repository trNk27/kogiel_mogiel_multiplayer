import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DASH_CD, DT, POTATO_ROUNDS, POTATO_ROUNDS_SHORT, PotatoSim, type PotatoEvent, type PotatoInput } from './logic';
import { PotatoScene } from './scene';
import '../cookbook/cookbook.css';
import './potato.css';

const COUNTDOWN_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 6500;
/** Let the last burst play out before the banner. */
const BANNER_DELAY_MS = 1800;
const HUD_MS = 150;
const HOT = '#ff4a3a';

type Phase = 'ready' | 'play' | 'over';

interface Pop {
  idx: number;
  x: number;
  y: number;
  until: number;
  key: number;
}

export class PotatoGame implements Game {
  readonly id = 'potato' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: PotatoSim;
  readonly input: ArenaInput;
  scores: number[];
  roundPts: number[];
  winners: number[] = [];
  goAt = 0;
  overAt = 0;
  /** performance.now() of the last burst, and of the last "X's got it!" call (and whose). */
  boomAt = -1e9;
  callAt = -1e9;
  callIdx = -1;
  pops: Pop[] = [];
  /** Date.now() when each player's Dash is ready again. */
  dashReady: number[];
  readonly removed = new Set<number>();
  private scene: PotatoScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  /** Sim time of the next whistle of the fuse. */
  private nextHiss = 0;
  private lastBump = -1e9;
  private timers: number[] = [];
  private finished = false;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? POTATO_ROUNDS_SHORT : POTATO_ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
    this.dashReady = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, PotatoGame>).potato = this;
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
      this.scene = new PotatoScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.sim.arena,
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

  private name(i: number) {
    return this.host.player(this.ids[i])?.name ?? '?';
  }

  // ---- round flow --------------------------------------------------------------------------------

  private newRound() {
    this.round++;
    this.input.release();
    this.sim = new PotatoSim(
      this.ids.length,
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
    );
    this.scene?.reset(this.sim);
    this.roundPts = this.ids.map(() => 0);
    this.dashReady = this.ids.map(() => 0);
    this.winners = [];
    this.pops = [];
    this.boomAt = -1e9;
    this.phase = 'ready';
    this.goAt = Date.now() + COUNTDOWN_MS;
    this.nextHiss = 0;
    this.callIdx = this.sim.holder;
    this.callAt = performance.now();
    if (this.sim.holder >= 0) this.host.buzz(this.ids[this.sim.holder], [90, 40, 90, 40, 160]);
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
    this.later(BANNER_DELAY_MS, () => this.phase === 'over' && sound.fanfare());
    this.later(OVER_MS, () => (this.round < this.rounds ? this.newRound() : this.finish()));
    this.update();
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
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

  private inputs(): (PotatoInput | undefined)[] {
    return this.ids.map((id, i) => {
      const dash = this.input.takePresses(i, 0) > 0;
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected;
      if (!live || this.phase === 'ready') return undefined;
      const pad = this.input.pads[i];
      return { x: pad.x, z: pad.y, dash: dash && this.phase === 'play' };
    });
  }

  private tick(now: number) {
    const events = this.sim.step(this.inputs());
    if (events.length) this.handle(events, now);
    this.fuseSound();
  }

  /** The fuse-like whistle: quicker and higher as the potato heats up (the burst itself stays a surprise). */
  private fuseSound() {
    const sim = this.sim;
    if (this.phase !== 'play' || sim.phase !== 'play' || !sim.potato) return;
    if (sim.time < this.nextHiss) return;
    const h = sim.heat;
    sound.note(1500 + 1300 * h, 0.07, { type: 'sine', vol: 0.03 + 0.03 * h, slide: 2100 + 1500 * h });
    sound.hiss(0.05 + 0.05 * h, 0.03 + 0.06 * h);
    this.nextHiss = sim.time + Math.max(0.12, 0.95 - 0.85 * Math.pow(h, 1.1));
  }

  private handle(events: PotatoEvent[], now: number) {
    for (const e of events) {
      switch (e.t) {
        case 'dash':
          this.scene?.dashed(e.i);
          sound.whoosh();
          this.dashReady[e.i] = Date.now() + DASH_CD * 1000;
          this.host.refresh(this.ids[e.i]);
          break;
        case 'bump':
          this.scene?.bumped(e.j);
          if (now - this.lastBump > 120) {
            this.lastBump = now;
            sound.plop();
          }
          this.host.buzz(this.ids[e.j], [60]);
          break;
        case 'pass':
          this.scene?.passed(e.to);
          sound.note(520, 0.12, { type: 'triangle', vol: 0.14, slide: 1040 });
          sound.note(1040, 0.1, { type: 'triangle', vol: 0.1, delay: 0.12, slide: 700 });
          this.host.buzz(this.ids[e.to], [90, 40, 90, 40, 160]);
          this.update();
          break;
        case 'burst': {
          this.boomAt = now;
          this.scene?.burst(e.i, e.x, e.z);
          sound.crash();
          this.later(70, () => sound.crash());
          sound.hiss(0.8, 0.45, 0.05);
          this.later(380, () => sound.wrong());
          this.host.buzz(this.ids[e.i], [400, 80, 300]);
          const at = this.scene?.headOnStage(e.i);
          if (at) this.pops.push({ idx: e.i, x: at.x, y: at.y, until: now + 1800, key: e.n });
          this.update();
          break;
        }
        case 'drop':
          this.callIdx = e.i;
          this.callAt = now;
          sound.whoosh();
          this.later(420, () => sound.plop());
          this.host.buzz(this.ids[e.i], [90, 40, 90, 40, 160]);
          this.update();
          break;
        case 'lost':
          this.update();
          break;
        case 'over':
          this.endRound();
          break;
      }
    }
  }

  /** For tests in the browser (/?debug): run the round forward without waiting. */
  debugAdvance(seconds: number) {
    if (this.phase !== 'play') return;
    const steps = Math.round(seconds / DT);
    for (let k = 0; k < steps && this.phase === 'play'; k++) {
      const ev = this.sim.step(this.inputs());
      if (ev.length) this.handle(ev, performance.now());
    }
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
    if (this.ids.length - this.removed.size < 2) {
      // Nobody left to chase: the game ends with the scores so far.
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];
      this.finish();
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.sim.players[i];
    const holder = this.sim.holder;
    const mine = holder === i && i >= 0;
    const ready = this.dashReady[i] ?? 0;
    const dash: PadButton = { label: 'Dash', color: mine ? HOT : '#ffd23f', cool: DASH_CD * 1000, ...(ready > Date.now() ? { readyAt: ready } : {}) };
    const base = { v: 'pad' as const, game: 'potato' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    const left = this.sim.aliveCount;
    const stats = [{ k: 'Left', v: String(left) }];
    if (this.phase === 'over') {
      const pts = this.roundPts[i] ?? 0;
      const won = this.winners.includes(i);
      return {
        ...base,
        phase: 'over',
        title: won ? (this.winners.length > 1 ? 'A tie for first!' : 'You survived!') : 'Round over',
        text: `+${pts} point${pts === 1 ? '' : 's'}`,
        accent: won ? '#ffc93c' : undefined,
        buttons: [],
        noStick: true,
        stats,
      };
    }
    if (!p || !p.alive) {
      return { ...base, phase: 'out', title: 'Mashed!', text: 'Watch the TV', accent: '#f3e3b0', buttons: [], noStick: true, stats };
    }
    if (this.phase === 'ready') {
      if (mine) return { ...base, phase: 'ready', title: 'You’ve got the potato!', text: 'Pass it on as soon as we start', accent: HOT, buttons: [{ ...dash, off: true }], stats };
      return { ...base, phase: 'ready', title: 'Get ready!', text: holder >= 0 ? `${this.name(holder)} starts with the potato` : 'Run from the hot potato', buttons: [{ ...dash, off: true }], stats };
    }
    if (mine) return { ...base, phase: 'play', title: 'You’ve got the potato! Pass it!', text: 'Touch someone – you’re faster now', accent: HOT, buttons: [dash], stats };
    if (holder < 0) return { ...base, phase: 'play', title: 'Run!', text: 'A new potato is coming…', buttons: [dash], stats };
    return { ...base, phase: 'play', title: 'Run!', text: `${this.name(holder)} has the potato`, buttons: [dash], stats };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <PotatoView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const holder = sim.holder;
    const hp = holder >= 0 ? players[holder] : undefined;
    const boom = now - this.boomAt < 1500;
    const call = this.callIdx >= 0 && now - this.callAt < 2200 && sim.holder === this.callIdx && this.phase !== 'over';
    const callP = call ? players[this.callIdx] : undefined;
    const heat = sim.heat;
    return (
      <>
        <div class="cookbook-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          <span class="cookbook-rule">Pass the hot potato!</span>
          <span style={{ flex: 1 }} />
          {sim.bursts > 0 && (
            <span class="pill potato-left">
              {sim.aliveCount} left
            </span>
          )}
        </div>
        {this.phase !== 'over' && (
          <div class="potato-holder" style={{ '--pc': hp ? colorHex(hp.color) : '#8a7a70', '--heat': String(heat) }} key={hp ? `h${holder}` : 'none'}>
            <PotatoIcon size={64} hot={heat} />
            {hp ? (
              <span>
                <b>{hp.name}</b>
                <small>has the potato!</small>
              </span>
            ) : (
              <span>
                <b>Splat!</b>
                <small>A new potato is coming…</small>
              </span>
            )}
          </div>
        )}
        {callP && this.phase === 'play' && (
          <div class="potato-call" key={`c${this.callAt}`} style={{ '--pc': colorHex(callP.color) }}>
            {callP.name}’s got it!
          </div>
        )}
        {boom && (
          <>
            <div class="cookbook-flash potato-flash" key={`f${this.boomAt}`} />
            <div class="potato-boom" key={`b${this.boomAt}`}>
              PLASK!
            </div>
          </>
        )}
        {this.pops.map((s) => {
          const p = players[s.idx];
          if (!p || s.until < now) return null;
          return (
            <div class="potato-pop" key={s.key} style={{ left: s.x, top: s.y, '--pc': colorHex(p.color) }}>
              Mashed!
            </div>
          );
        })}
        <div class="cookbook-chips">
          {this.ids.map((_, i) => {
            const p = players[i];
            const a = sim.players[i];
            if (!p || !a || this.removed.has(i)) return null;
            const out = !a.alive;
            const has = i === holder;
            return (
              <div class={`cookbook-chip ${out ? 'out' : ''} ${has ? 'potato-has' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={out ? 'dead' : has ? 'wow' : p.connected ? 'happy' : 'sleep'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{this.phase === 'over' ? `+${this.roundPts[i]} · ${this.scores[i]} total` : out ? 'Mashed!' : has ? 'Has the potato!' : `${this.scores[i]} pts`}</small>
                </span>
                {has && <PotatoIcon size={34} hot={heat} />}
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
    const name = (i: number) => players[i]?.name ?? '?';
    const order = this.ids
      .map((_, i) => i)
      .filter((i) => !this.removed.has(i))
      .sort((a, b) => this.roundPts[b] - this.roundPts[a]);
    const big = this.winners.length === 1 ? `${name(this.winners[0])} survives!` : this.winners.length > 1 ? `A tie: ${this.winners.map(name).join(' & ')}` : 'Round over';
    const n = this.sim.bursts;
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {n} potato{n === 1 ? '' : 'es'} went splat
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
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
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'Another potato is baking…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

/** A little hot potato for the HUD; `hot` 0..1 makes it glow redder. */
function PotatoIcon({ size, hot = 0 }: { size: number; hot?: number }) {
  const r = Math.round(201 + (255 - 201) * hot);
  const g = Math.round(145 - 70 * hot);
  const b = Math.round(78 - 40 * hot);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" class="potato-icon">
      <path d="M22 14 q-3 -6 2 -10 M32 13 q3 -6 -1 -11 M42 15 q4 -5 1 -10" fill="none" stroke="#fff4dc" stroke-width="3" stroke-linecap="round" opacity=".8" />
      <path d="M8 38 C6 24 22 18 34 20 C48 22 58 28 56 40 C54 52 40 56 28 54 C16 52 9 48 8 38 Z" fill={`rgb(${r},${g},${b})`} stroke="#2a120a" stroke-width="3.5" />
      <circle cx="22" cy="34" r="2" fill="#6b4220" />
      <circle cx="38" cy="30" r="2" fill="#6b4220" />
      <circle cx="44" cy="44" r="2" fill="#6b4220" />
      <circle cx="28" cy="46" r="1.6" fill="#6b4220" />
    </svg>
  );
}

function PotatoView({ game }: { game: PotatoGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook potato">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
