import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, colorName, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import {
  Autopilot,
  DOCK_HOLD,
  DT,
  LAST_BOAT_S,
  LEVELS,
  MARINA_ROUNDS,
  MARINA_ROUNDS_SHORT,
  MarinaSim,
  emptyScore,
  levelFor,
  ordinal,
  type MarinaEvent,
  type RoundScore,
} from './logic';
import { MarinaScene } from './scene';
import '../cookbook/cookbook.css';
import '../floes/floes.css';
import './marina.css';

const COUNTDOWN_MS = 4500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 9000;
const BANNER_DELAY_MS = 1300;
const HUD_MS = 120;

const LEVEL_HINT = [
  'Straight in, then stop inside your lines',
  'Some berths are beside the jetty: turn in!',
  'Wind! Allow for the drift',
];

type Phase = 'ready' | 'play' | 'over';

interface Pop {
  x: number;
  z: number;
  text: string;
  color: string;
  until: number;
  key: number;
}

export class MarinaGame implements Game {
  readonly id = 'marina' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: MarinaSim;
  readonly input: ArenaInput;
  scores: number[];
  roundPts: RoundScore[];
  goAt = 0;
  overAt = 0;
  pops: Pop[] = [];
  /** performance.now() of the last big call ("Last boat!"), and its text. */
  callAt = -1e9;
  call = '';
  readonly removed = new Set<number>();
  /** /?debug: boats driven by the autopilot (window.marina.bot(i)). */
  bots = new Map<number, Autopilot>();
  /** What each phone was last told (in lines / not), so views are refreshed only when that changes. */
  private hint: string[] = [];
  private scene: MarinaScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private putter = 0;
  private popKey = 0;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? MARINA_ROUNDS_SHORT : MARINA_ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => emptyScore());
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, MarinaGame>).marina = this;
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
      this.scene = new MarinaScene(
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

  /** Debug: let the autopilot drive boat `i` (or every boat with no argument). */
  bot(i?: number) {
    const all = i === undefined ? this.ids.map((_, k) => k) : [i];
    for (const k of all) this.bots.set(k, new Autopilot(this.sim, k));
  }

  get level() {
    return levelFor(this.round, this.rounds);
  }

  // ---- round flow --------------------------------------------------------------------------------

  private newRound() {
    this.round++;
    this.input.release();
    this.sim = new MarinaSim(
      this.ids.length,
      this.level,
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
    );
    const botted = [...this.bots.keys()];
    this.bots.clear();
    for (const k of botted) this.bots.set(k, new Autopilot(this.sim, k));
    this.scene?.reset(this.sim);
    this.removed.forEach((i) => this.scene?.hide(i));
    this.roundPts = this.ids.map(() => emptyScore());
    this.pops = [];
    this.hint = [];
    this.callAt = -1e9;
    this.phase = 'ready';
    this.goAt = Date.now() + COUNTDOWN_MS;
    [COUNTDOWN_MS - 3000, COUNTDOWN_MS - 2000, COUNTDOWN_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && sound.count()));
    this.later(COUNTDOWN_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      this.sim.begin();
      sound.go();
      this.hornSound(0.6);
      this.update();
    });
    this.update();
  }

  private endRound() {
    if (this.phase === 'over') return;
    const r = this.sim.results();
    this.phase = 'over';
    this.roundPts = r;
    r.forEach((p, i) => (this.scores[i] += p.total));
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
    this.engine(elapsed);
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  /** The engines: one low putter for the whole harbour, faster and higher the more throttle there is. */
  private engine(dt: number) {
    if (this.phase !== 'play') return;
    const live = this.sim.boats.filter((b) => !b.gone && !b.docked);
    if (!live.length) return;
    const thr = Math.max(...live.map((b) => Math.abs(b.throttle)));
    if (thr < 0.05) return;
    this.putter += dt * (5 + thr * 13);
    if (this.putter >= 1) {
      this.putter = 0;
      sound.note(52 + thr * 46, 0.07, { type: 'square', vol: 0.018 + thr * 0.03 });
    }
  }

  private hornSound(vol = 1) {
    sound.note(311, 0.42, { type: 'square', vol: 0.05 * vol });
    sound.note(392, 0.42, { type: 'square', vol: 0.04 * vol });
  }

  private tick(now: number) {
    const sim = this.sim;
    this.ids.forEach((id, i) => {
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected;
      const bot = this.bots.get(i);
      if (bot && this.phase === 'play') {
        const st = bot.stick();
        sim.setStick(i, st.x, st.y);
      } else {
        const pad = this.input.pads[i];
        sim.setStick(i, live ? pad.x : 0, live ? pad.y : 0);
      }
      const n = this.input.takePresses(i, 0);
      if (live && n > 0 && this.phase !== 'ready' && sim.horn(i)) this.handle([{ t: 'horn', i }], now);
    });
    const events = sim.step();
    if (events.length) this.handle(events, now);
    // Phones say "hold still" while the boat is in its lines.
    this.ids.forEach((id, i) => {
      const b = sim.boats[i];
      const h = b?.docked ? 'd' : b?.inLines ? 'in' : 'out';
      if (this.hint[i] !== h) {
        this.hint[i] = h;
        this.host.refresh(id);
      }
    });
  }

  private handle(events: MarinaEvent[], now: number) {
    let refresh = false;
    for (const e of events) {
      switch (e.t) {
        case 'bump': {
          this.scene?.bumped(e.i, e.x, e.z, e.v, e.hard);
          const vol = Math.min(1, e.v / 3);
          sound.note(e.hard ? 95 : 140, e.hard ? 0.22 : 0.12, { type: 'sine', vol: 0.12 + vol * 0.14, slide: e.hard ? 50 : 90 });
          sound.hiss(e.hard ? 0.2 : 0.1, 0.06 + vol * 0.12);
          if (e.hard) {
            this.host.buzz(this.ids[e.i], [90]);
            const p = this.host.player(this.ids[e.i]);
            this.pops.push({ x: e.x, z: e.z, text: 'Bonk! −1', color: colorHex(p?.color ?? 'sourcream'), until: now + 1600, key: ++this.popKey });
          }
          break;
        }
        case 'dock': {
          this.scene?.docked(e.i);
          sound.pickup();
          this.later(150, () => sound.correct());
          this.host.buzz(this.ids[e.i], [40, 60, 40, 60, 160]);
          const b = this.sim.boats[e.i];
          const p = this.host.player(this.ids[e.i]);
          this.pops.push({ x: b.x, z: b.z, text: this.sim.solo ? 'Parked!' : `${ordinal(e.place)}!`, color: colorHex(p?.color ?? 'sourcream'), until: now + 2400, key: ++this.popKey });
          refresh = true;
          break;
        }
        case 'horn':
          this.scene?.horn(e.i);
          this.hornSound();
          break;
        case 'last': {
          const p = this.host.player(this.ids[e.i]);
          this.callAt = now;
          this.call = `${p?.name ?? 'Last boat'}: ${LAST_BOAT_S} s!`;
          sound.whoosh();
          refresh = true;
          break;
        }
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
    this.bots.delete(i);
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
    const b = sim.boats[i];
    const me = this.host.player(id);
    const colour = colorName(me?.color ?? 'sourcream');
    const horn: PadButton = { label: '📯 Horn', color: '#8fd0ff' };
    const base = { v: 'pad' as const, game: 'marina' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    const parked = `${sim.dockedCount}/${sim.liveCount}`;
    const stats = sim.solo ? [{ k: 'Berth', v: colour }] : [{ k: 'Berth', v: colour }, { k: 'Parked', v: parked }];
    if (this.phase === 'ready') {
      return { ...base, phase: 'ready', title: 'Get ready!', text: `Your berth has the ${colour} flag`, buttons: [{ ...horn, off: true }], stats };
    }
    if (this.phase === 'over') {
      const r = this.roundPts[i] ?? emptyScore();
      return {
        ...base,
        phase: 'over',
        noStick: true,
        title: r.docked ? (sim.solo ? `Parked! +${r.total}` : `${ordinal(r.place)} · +${r.total}`) : `Not parked · +${r.total}`,
        text: r.docked ? breakdown(r) : 'Closer next time!',
        accent: r.docked && r.place === 1 ? '#ffc93c' : undefined,
        buttons: [],
        stats,
      };
    }
    if (!b || b.gone) return { ...base, phase: 'out', noStick: true, title: 'Watch the TV', buttons: [], stats };
    if (b.docked) {
      return {
        ...base,
        phase: 'out',
        noStick: true,
        title: sim.solo ? 'Parked!' : `Parked ${ordinal(b.place)}!`,
        text: sim.solo ? `${b.dockTime.toFixed(1)} s` : 'Moored. Toot at the others!',
        accent: b.place === 1 ? '#ffc93c' : colorHex(me?.color ?? 'sourcream'),
        buttons: [horn],
        stats,
      };
    }
    if (b.inLines) return { ...base, phase: 'play', title: 'Hold still…', text: 'Inside the lines – stop!', accent: '#9be37a', buttons: [horn], stats };
    return { ...base, phase: 'play', title: 'Park it!', text: `${colour} flag · ▲ ahead · ▼ astern · ◀ ▶ rudder`, accent: colorHex(me?.color ?? 'sourcream'), buttons: [horn], stats };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <MarinaView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const left = Math.ceil(sim.timeLeft);
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const L = LEVELS[sim.level];
    const wind = sim.layout.wind;
    return (
      <>
        <div class="floes-top marina-top">
          <span class="pill">
            Round {this.round} / {this.rounds} · {L.name}
          </span>
          <span class="floes-rule">{LEVEL_HINT[sim.level]}</span>
          {wind.x !== 0 && <span class={`marina-wind ${wind.x > 0 ? 'right' : 'left'}`}>Wind {wind.x > 0 ? '→' : '←'}</span>}
        </div>
        <div class="floes-count marina-count">
          {sim.solo ? (
            <>
              <b>{(sim.boats[0]?.docked ? sim.boats[0].dockTime : sim.time).toFixed(1)}</b>
              <small>seconds</small>
            </>
          ) : (
            <>
              <b>
                {sim.dockedCount}/{sim.liveCount}
              </b>
              <small>parked</small>
            </>
          )}
          <span class={`floes-clock ${left <= 10 && this.phase === 'play' ? 'hurry' : ''}`}>{clock}</span>
        </div>
        {this.labels(players, now)}
        {now - this.callAt < 1800 && (
          <div class="floes-call marina-call" key={`c${this.callAt}`}>
            {this.call}
          </div>
        )}
        {this.pops.map((s) => {
          if (s.until < now) return null;
          const at = this.scene?.toStage(s.x, 2.2, s.z);
          if (!at) return null;
          return (
            <div class="cookbook-splat marina-pop" key={s.key} style={{ left: at.x, top: Math.min(1000, at.y), '--pc': s.color }}>
              {s.text}
            </div>
          );
        })}
        <div class="cookbook-chips marina-chips">
          {this.ids.map((_, i) => {
            const p = players[i];
            const b = sim.boats[i];
            if (!p || !b || this.removed.has(i)) return null;
            const r = this.roundPts[i];
            const status =
              this.phase === 'over'
                ? `+${r.total} · ${this.scores[i]} total`
                : b.docked
                  ? `Parked ${sim.solo ? `${b.dockTime.toFixed(1)} s` : ordinal(b.place)} · ${this.scores[i]} pts`
                  : b.inLines
                    ? 'Holding…'
                    : `${this.scores[i]} pts`;
            return (
              <div class={`cookbook-chip ${b.docked ? 'marina-done' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={b.docked ? 'wow' : p.connected ? 'happy' : 'sleep'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{status}</small>
                </span>
              </div>
            );
          })}
        </div>
        {this.phase === 'ready' && (
          <>
            <BigCountdown key={this.goAt} endsAt={this.goAt} />
            <div class="marina-intro pop-in">Find your flag · park inside your lines · stop</div>
          </>
        )}
        {this.phase === 'over' && now - this.overAt > BANNER_DELAY_MS && this.banner(players)}
        {this.glError && <div class="trails-banner">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  /** Over each boat that's holding still in its lines: a ring filling up. */
  private labels(players: ReturnType<GameHost['player']>[], _now: number) {
    if (!this.scene || this.phase !== 'play') return null;
    return this.sim.boats.map((b, i) => {
      if (b.gone || b.docked || b.hold <= 0) return null;
      const at = this.scene!.toStage(b.x, 1.2, b.z);
      const k = Math.min(1, b.hold / DOCK_HOLD);
      const c = colorHex(players[i]?.color ?? 'sourcream');
      return (
        <svg class="marina-ring" style={{ left: at.x, top: at.y }} width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="38" fill="rgba(16,24,40,.55)" stroke="#ffffff55" stroke-width="10" />
          <circle cx="48" cy="48" r="38" fill="none" stroke={c} stroke-width="10" stroke-linecap="round" stroke-dasharray={`${(k * 238.8).toFixed(1)} 300`} transform="rotate(-90 48 48)" />
          <text x="48" y="58" text-anchor="middle" font-size="30" fill="#fff" font-weight="800">
            ⚓
          </text>
        </svg>
      );
    });
  }

  private banner(players: ReturnType<GameHost['player']>[]) {
    const sim = this.sim;
    const order = this.ids
      .map((_, i) => i)
      .filter((i) => !this.removed.has(i))
      .sort((a, b) => this.roundPts[b].total - this.roundPts[a].total || (this.roundPts[a].place || 99) - (this.roundPts[b].place || 99));
    const best = order[0];
    const bestName = best !== undefined ? (players[best]?.name ?? '?') : '';
    const big = sim.solo
      ? this.roundPts[0]?.docked
        ? `Parked in ${sim.boats[0].dockTime.toFixed(1)} s!`
        : 'Not parked in time'
      : sim.dockedCount === 0
        ? 'Nobody parked!'
        : `${bestName} parks best!`;
    return (
      <div class="trails-banner cookbook-banner marina-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {LEVELS[sim.level].name}
          {sim.timeout ? ' · time is up!' : ' · everybody parked'}
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
        <div class="marina-table">
          <div class="marina-row head">
            <span />
            <span class="grow" />
            <span>{sim.solo ? 'Time' : 'Place'}</span>
            <span>Centred</span>
            <span>Straight</span>
            <span>Clean</span>
            <span>Bumps</span>
            <span>Total</span>
          </div>
          {order.map((i) => {
            const p = players[i];
            const r = this.roundPts[i];
            if (!p) return null;
            return (
              <div class={`marina-row ${r.place === 1 ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={36} mood={r.docked ? 'wow' : 'dead'} />
                <span class="grow">{p.name}</span>
                {r.docked ? (
                  <>
                    <span>
                      {sim.solo ? `${sim.boats[i].dockTime.toFixed(1)} s` : ordinal(r.place)} <small>+{r.order}</small>
                    </span>
                    <span>+{r.centre}</span>
                    <span>+{r.straight}</span>
                    <span>{r.clean ? `+${r.clean}` : '–'}</span>
                  </>
                ) : (
                  <>
                    <span class="marina-miss">not parked</span>
                    <span class="marina-span2">close: +{r.near}</span>
                    <span />
                  </>
                )}
                <span class={r.bumps ? 'marina-bad' : ''}>{r.bumps ? `−${r.bumps}` : '–'}</span>
                <b>+{r.total}</b>
              </div>
            );
          })}
        </div>
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? `Next: ${LEVELS[levelFor(this.round + 1, this.rounds)].name}` : 'That was the last round!'}</div>
      </div>
    );
  }
}

function breakdown(r: RoundScore) {
  const parts = [`centred +${r.centre}`, `straight +${r.straight}`];
  if (r.clean) parts.push(`clean +${r.clean}`);
  if (r.bumps) parts.push(`bumps −${r.bumps}`);
  return parts.join(' · ');
}

function MarinaView({ game }: { game: MarinaGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook floes marina">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
