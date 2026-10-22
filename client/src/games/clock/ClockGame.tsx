import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { CLOCK_ROUNDS, CLOCK_ROUNDS_SHORT, ClockRound, SHOW_MS, TIMEOUT_S, errLabel, flagLanes, mulberry32, rulerRange, secs, targetsFor, type RoundResult } from './logic';
import { ClockScene } from './scene';
import '../cookbook/cookbook.css';
import './clock.css';

const COUNTDOWN_MS = 3500;
/** Once everybody has pressed, wait this long before the reveal (so the last bell rings out). */
const ALL_IN_MS = 900;
/** The reveal, in ms after it starts: the towel lifts, the ruler sweeps, the closest is crowned, the banner. */
const SWEEP_START = 1100;
const SWEEP_MS = 3400;
const CROWN_AT = SWEEP_START + SWEEP_MS + 300;
const BANNER_AT = CROWN_AT + 1600;
const NEXT_AT = BANNER_AT + 6000;
const HUD_MS = 150;
/** Width of the reveal ruler on the stage, px. */
const RULER_W = 1560;
const FLAG_W = 168;

type Phase = 'ready' | 'play' | 'reveal';

export class ClockGame implements Game {
  readonly id = 'clock' as const;
  readonly rounds: number;
  readonly targets: number[];
  round = 0;
  phase: Phase = 'ready';
  cur!: ClockRound;
  result: RoundResult | null = null;
  scores: number[];
  goAt = 0;
  /** The towel is over the timer. */
  covered = false;
  coveredAt = -1e9;
  /** performance.now() when the reveal started, and whether its results are out (crown, phones). */
  revealAt = 0;
  shown = false;
  readonly removed = new Set<number>();
  private dinged = new Set<number>();
  private targetDinged = false;
  private scene: ClockScene | null = null;
  private glError = false;
  private raf = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private timers: number[] = [];
  private roundTimers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.rounds = host.short ? CLOCK_ROUNDS_SHORT : CLOCK_ROUNDS;
    this.targets = targetsFor(this.rounds, mulberry32(seed));
    this.scores = ids.map(() => 0);
  }

  get target() {
    return this.cur?.target ?? this.targets[0];
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, ClockGame>).clock = this;
    this.newRound();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    [...this.timers, ...this.roundTimers].forEach((t) => clearTimeout(t));
    this.timers = [];
    this.roundTimers = [];
    this.detach();
  }

  private later(ms: number, fn: () => void, round = false) {
    const t = window.setTimeout(fn, ms);
    (round ? this.roundTimers : this.timers).push(t);
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new ClockScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
      );
      this.removed.forEach((i) => this.scene?.hide(i));
      if (this.covered && this.phase === 'play') this.scene.dropTowel();
      this.cur?.presses.forEach((p, i) => p !== null && this.scene?.ding(i));
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
    this.cur = new ClockRound(
      this.ids.length,
      this.targets[this.round - 1],
      this.ids.map((_, i) => this.removed.has(i)),
    );
    this.result = null;
    this.shown = false;
    this.covered = false;
    this.dinged.clear();
    this.targetDinged = false;
    this.roundTimers.forEach((t) => clearTimeout(t));
    this.roundTimers = [];
    this.scene?.resetRound();
    this.phase = 'ready';
    this.goAt = Date.now() + COUNTDOWN_MS;
    [COUNTDOWN_MS - 3000, COUNTDOWN_MS - 2000, COUNTDOWN_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && sound.count(), true));
    this.later(COUNTDOWN_MS, () => this.go(), true);
    this.update();
  }

  private go() {
    if (this.phase !== 'ready') return;
    this.phase = 'play';
    this.cur.begin(this.goAt);
    sound.go();
    // Tick, tock, where everybody can see and hear it…
    for (let ms = 0; ms < SHOW_MS; ms += 500) {
      this.later(
        ms,
        () => {
          if (this.phase !== 'play' || this.covered) return;
          const whole = ms % 1000 === 0;
          sound.note(whole ? 2300 : 1600, 0.035, { type: 'square', vol: whole ? 0.09 : 0.05 });
          if (whole) sound.note(120, 0.06, { type: 'sine', vol: 0.12 });
          this.scene?.tick();
        },
        true,
      );
    }
    // …then Babcia throws her towel over it.
    this.later(
      SHOW_MS,
      () => {
        if (this.phase !== 'play') return;
        this.covered = true;
        this.coveredAt = performance.now();
        this.scene?.dropTowel();
        sound.whoosh();
        sound.hiss(0.25, 0.25, 0.65);
        this.update();
      },
      true,
    );
    this.later((this.target + TIMEOUT_S) * 1000 + 60, () => this.phase === 'play' && this.reveal(), true);
    this.update();
  }

  private connected() {
    return this.ids.map((id) => !!this.host.player(id)?.connected);
  }

  /** Everybody's in? Then reveal shortly. */
  private checkIn() {
    if (this.phase !== 'play' || !this.cur.allIn(this.connected())) return;
    this.later(ALL_IN_MS, () => this.phase === 'play' && this.cur.allIn(this.connected()) && this.reveal(), true);
  }

  private reveal() {
    if (this.phase !== 'play') return;
    this.phase = 'reveal';
    this.result = this.cur.results();
    this.result.players.forEach((r, i) => (this.scores[i] += r.pts));
    this.revealAt = performance.now();
    this.covered = false;
    this.scene?.liftTowel();
    sound.whoosh();
    this.later(SWEEP_START, () => sound.drumroll(SWEEP_MS / 1000), true);
    this.later(
      CROWN_AT,
      () => {
        this.shown = true;
        const r = this.result;
        if (r) {
          r.winners.forEach((i) => this.scene?.crown(i));
          if (r.winners.length) sound.fanfare();
          else sound.wrong();
          r.players.forEach((p, i) => {
            if (p.pts > 0 && !this.removed.has(i)) this.host.buzz(this.ids[i], p.rank === 1 ? [80, 60, 80, 60, 160] : [60]);
          });
        }
        this.update();
      },
      true,
    );
    this.later(BANNER_AT, () => this.host.changed(), true);
    this.later(NEXT_AT, () => (this.round < this.rounds ? this.newRound() : this.finish()), true);
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

  /** Where the ruler's cursor is during the reveal, seconds (null before/after the sweep). */
  cursor(now = performance.now()): number | null {
    if (this.phase !== 'reveal') return null;
    const k = (now - this.revealAt - SWEEP_START) / SWEEP_MS;
    if (k < 0 || k > 1) return null;
    const { lo, hi } = rulerRange(this.target, this.cur.presses);
    return lo + (hi - lo) * k;
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const scene = this.scene;
    if (scene) {
      if (this.phase === 'play') {
        const t = Math.max(0, (Date.now() - this.goAt) / 1000);
        scene.setDial(this.covered ? this.target : t, this.covered ? '?' : String(Math.floor(t)), this.target);
      } else if (this.phase === 'reveal') {
        const c = this.cursor(now);
        const since = now - this.revealAt;
        if (c !== null) {
          scene.setDial(c, c.toFixed(1), this.target);
          this.cur.presses.forEach((p, i) => {
            if (p === null || this.dinged.has(i) || p / 1000 > c) return;
            this.dinged.add(i);
            scene.ding(i, false);
            sound.note(1568 + (i % 4) * 196, 0.45, { type: 'sine', vol: 0.12 });
          });
          if (!this.targetDinged && c >= this.target) {
            this.targetDinged = true;
            sound.note(392, 0.5, { type: 'triangle', vol: 0.16 });
            sound.note(523, 0.6, { type: 'triangle', vol: 0.12, delay: 0.05 });
          }
        } else if (since < SWEEP_START) {
          scene.setDial(rulerRange(this.target, this.cur.presses).lo, '…', this.target);
        } else scene.setDial(this.target, this.target.toFixed(1), this.target);
      } else scene.setDial(0, '0', this.target);
      scene.render(dt);
    }
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  // ---- phones ------------------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'btn' || !m.on || m.b !== 0) return;
    const i = this.ids.indexOf(id);
    if (i < 0 || this.phase !== 'play') return;
    this.pressAt(i, Date.now());
  }

  /** Player i pressed STOP at host time `at` (also the debug handle's way in). */
  pressAt(i: number, at: number) {
    if (this.phase !== 'play') return;
    if (this.cur.press(i, at) !== 'ok') return;
    this.scene?.ding(i);
    sound.bell();
    this.host.buzz(this.ids[i], [40]);
    this.update();
    this.checkIn();
  }

  /** Debug: every player who hasn't pressed yet presses around the target (± `spread` s). */
  bots(spread = 0.8) {
    if (this.phase !== 'play') return;
    this.ids.forEach((_, i) => {
      if (this.cur.pressed(i) || this.removed.has(i)) return;
      const at = this.goAt + (this.target + (Math.random() * 2 - 1) * spread) * 1000;
      const wait = Math.max(0, at - Date.now());
      this.later(wait, () => this.pressAt(i, at), true);
    });
  }

  onConnection(_id: string, _connected: boolean) {
    this.host.changed();
    this.checkIn();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i)) return;
    this.removed.add(i);
    if (this.phase !== 'reveal') this.cur.remove(i);
    this.scene?.hide(i);
    if (this.removed.size >= this.ids.length) {
      this.host.finish({});
      return;
    }
    this.update();
    this.checkIn();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const t = this.target;
    const base = {
      v: 'pad' as const,
      game: 'clock' as const,
      round: this.round,
      rounds: this.rounds,
      score: this.scores[i] ?? 0,
      noStick: true,
      stats: [{ k: 'Target', v: `${t} s` }],
    };
    const stop: PadButton = { label: 'STOP!', color: '#e8335a' };
    const goal = `STOP at ${t.toFixed(2)} s`;
    if (i < 0 || this.removed.has(i)) return { ...base, phase: 'out', title: 'Watch the TV', buttons: [] };
    if (this.phase === 'ready') return { ...base, phase: 'ready', title: goal, text: 'Watch the timer… then count in your head', buttons: [{ ...stop, off: true }] };
    const pressed = this.cur.pressed(i);
    if (this.phase === 'play') {
      if (pressed) return { ...base, phase: 'play', title: 'Locked in!', text: 'Wait for the reveal', accent: '#2fd6a8', buttons: [] };
      return { ...base, phase: 'play', title: goal, text: this.covered ? 'Count in your head… tap when it’s time' : 'Watch it tick…', buttons: [stop] };
    }
    const r = this.result?.players[i];
    if (!this.shown || !r) return { ...base, phase: 'over', title: pressed ? 'Locked in!' : 'Too late!', text: 'The towel comes off… watch the TV', buttons: [] };
    if (r.ms === null || r.err === null) return { ...base, phase: 'over', title: 'Timed out', text: '0 points this round', accent: '#ff7a8a', buttons: [] };
    const closest = r.rank === 1 && !this.result!.solo;
    return {
      ...base,
      phase: 'over',
      title: r.perfect ? `Idealnie! · +${r.pts}` : `${errLabel(r.err)} · +${r.pts}`,
      text: `You stopped at ${secs(r.ms)} s${closest ? ' · closest!' : ''}`,
      accent: closest || r.perfect ? '#ffc93c' : undefined,
      buttons: [],
    };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <ClockView game={this} />;
  }

  hud() {
    const now = performance.now();
    const players = this.ids.map((id) => this.host.player(id));
    const t = this.target;
    const since = now - this.revealAt;
    const res = this.result;
    return (
      <>
        <div class="clock-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          <span class="clock-rule">Stop the timer at exactly {t} seconds!</span>
        </div>
        <div class="clock-target">
          <b>{t}</b>
          <small>seconds</small>
        </div>
        {this.phase === 'play' && !this.covered && (
          <div class="clock-call watch" key={`w${this.round}`}>
            Watch it tick…
          </div>
        )}
        {this.phase === 'play' && this.covered && (
          <div class="clock-call head" key={`h${this.round}`}>
            Now count in your head!
          </div>
        )}
        {this.phase === 'reveal' && since < BANNER_AT && this.ruler(players)}
        <div class="cookbook-chips">
          {this.ids.map((_, i) => {
            const p = players[i];
            if (!p || this.removed.has(i)) return null;
            const pressed = this.cur.pressed(i);
            const r = res?.players[i];
            let line: string;
            if (this.phase === 'reveal' && this.shown && r) line = r.ms === null ? `timed out · ${this.scores[i]} pts` : `${secs(r.ms)} s · +${r.pts} · ${this.scores[i]} pts`;
            else if (this.phase === 'ready') line = `${this.scores[i]} pts`;
            else line = pressed ? '🔔 Locked in' : this.phase === 'reveal' ? 'too late' : 'thinking…';
            return (
              <div class={`cookbook-chip clock-chip ${pressed ? 'in' : ''} ${this.shown && r?.rank === 1 ? 'best' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={!p.connected ? 'sleep' : this.shown && r?.rank === 1 ? 'wow' : 'happy'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{line}</small>
                </span>
              </div>
            );
          })}
        </div>
        {this.phase === 'ready' && <BigCountdown key={this.goAt} endsAt={this.goAt} />}
        {this.phase === 'reveal' && since >= BANNER_AT && res && this.banner(players, res)}
        {this.glError && <div class="trails-banner">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  /** The reveal: a wooden ruler slides in, a cursor runs along it, and the flags pop up as it passes. */
  private ruler(players: ReturnType<GameHost['player']>[]) {
    const t = this.target;
    const { lo, hi } = rulerRange(t, this.cur.presses);
    const span = hi - lo;
    const x = (s: number) => ((s - lo) / span) * RULER_W;
    const delay = (s: number) => SWEEP_START + ((s - lo) / span) * SWEEP_MS;
    const pressed = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i) && this.cur.presses[i] !== null);
    const xs = pressed.map((i) => x(this.cur.presses[i]! / 1000));
    const lanes = flagLanes(
      xs.map((v) => v - FLAG_W / 2),
      FLAG_W + 6,
    );
    const late = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i) && this.cur.presses[i] === null);
    const pps = RULER_W / span;
    const ticks: { s: number; kind: 'big' | 'mid' | 'small' }[] = [];
    const step = pps > 260 ? 0.1 : 0.5;
    for (let k = 0; lo + k * step <= hi + 1e-6; k++) {
      const s = lo + k * step;
      const whole = Math.abs(s - Math.round(s)) < 1e-6;
      const half = Math.abs(s * 2 - Math.round(s * 2)) < 1e-6;
      ticks.push({ s, kind: whole ? 'big' : half ? 'mid' : 'small' });
    }
    return (
      <div class="clock-ruler-wrap" key={`ruler${this.round}`} style={{ '--sweep': `${SWEEP_MS}ms`, '--start': `${SWEEP_START}ms` }}>
        <div class="clock-flags" style={{ width: `${RULER_W}px` }}>
          <div class="clock-target-line" style={{ left: `${x(t)}px`, animationDelay: `${delay(t)}ms` }}>
            <span>{t.toFixed(2)} s</span>
          </div>
          {pressed.map((i, k) => {
            const p = players[i];
            const ms = this.cur.presses[i]!;
            const best = this.result?.winners.includes(i);
            return p ? (
              <div class={`clock-flag ${best ? 'best' : ''}`} style={{ left: `${xs[k]}px`, '--pc': colorHex(p.color), '--lane': lanes[k], animationDelay: `${delay(ms / 1000)}ms` }}>
                <div class="clock-flag-card">
                  <b>{p.name}</b>
                  <span>{secs(ms)}</span>
                </div>
              </div>
            ) : null;
          })}
        </div>
        <div class="clock-ruler" style={{ width: `${RULER_W}px` }}>
          {ticks.map((k) => (
            <div class={`clock-tick ${k.kind}`} style={{ left: `${x(k.s)}px` }}>
              {k.kind === 'big' && <span>{Math.round(k.s)}</span>}
            </div>
          ))}
          <div class="clock-cursor" />
        </div>
        {late.length > 0 && (
          <div class="clock-late" style={{ animationDelay: `${SWEEP_START + SWEEP_MS}ms` }}>
            Timed out: {late.map((i) => players[i]?.name ?? '?').join(', ')}
          </div>
        )}
      </div>
    );
  }

  private banner(players: ReturnType<GameHost['player']>[], res: RoundResult) {
    const name = (i: number) => players[i]?.name ?? '?';
    const live = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i));
    const order = [...live].sort((a, b) => res.players[b].pts - res.players[a].pts || (res.players[a].rank ?? 99) - (res.players[b].rank ?? 99));
    const w = res.winners.filter((i) => !this.removed.has(i));
    let big: string;
    if (res.solo) {
      const r = res.players[live[0]];
      big = !r || r.ms === null ? 'Timed out!' : r.perfect ? `Idealnie! ${secs(r.ms)} s` : `${secs(r.ms)} s · ${errLabel(r.err!)}`;
    } else if (w.length === 1) big = res.players[w[0]].perfect ? `Idealnie, ${name(w[0])}!` : `${name(w[0])} is closest!`;
    else if (w.length > 1) big = `A tie: ${w.map(name).join(' & ')}`;
    else big = 'Nobody stopped the timer!';
    return (
      <div class="trails-banner cookbook-banner clock-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · target {this.target.toFixed(2)} s
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
        <div class="cookbook-banner-list">
          {order.map((i) => {
            const p = players[i];
            const r = res.players[i];
            const win = w.includes(i);
            return p ? (
              <div class={`cookbook-banner-row ${win ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={38} mood={win ? 'wow' : r.ms === null ? 'sleep' : 'happy'} />
                <span class="grow">{p.name}</span>
                <span class="clock-row-time">{r.ms === null ? 'timed out' : `${secs(r.ms)} s`}</span>
                <span class="clock-row-err">{r.err === null ? '' : r.perfect ? 'Idealnie!' : errLabel(r.err)}</span>
                <b>+{r.pts}</b>
              </div>
            ) : null;
          })}
        </div>
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'Babcia winds the timer again…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function ClockView({ game }: { game: ClockGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook clock">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
