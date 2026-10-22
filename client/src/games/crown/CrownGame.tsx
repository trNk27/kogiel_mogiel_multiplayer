import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { CrownSim, DASH_CD, DT, ROUNDS, ROUNDS_SHORT, botInput, placeText, type CrownEvent, type CrownInput } from './logic';
import { CrownScene } from './scene';
import '../cookbook/cookbook.css';
import './crown.css';

const READY_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 7000;
const BANNER_DELAY_MS = 900;
const HUD_MS = 120;
const PHONE_MS = 250;
const GOLD = '#ffc93c';

type Phase = 'ready' | 'play' | 'over';

interface Pop {
  text: string;
  color: string;
  x: number;
  z: number;
  until: number;
  key: number;
}

export class CrownGame implements Game {
  readonly id = 'crown' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim: CrownSim;
  /** Points over finished rounds. */
  totals: number[];
  /** Points in the round just played (while 'over'). */
  roundPts: number[];
  winners: number[] = [];
  goAt = 0;
  overAt = 0;
  /** performance.now() when double time started. */
  doubleAt = -1e9;
  pops: Pop[] = [];
  readonly removed = new Set<number>();
  /** Debug (/dev?debug): computer players. true = everybody, or a list of player indices. */
  auto: boolean | number[] = false;
  readonly input: ArenaInput;
  private scene: CrownScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private lastPhone = 0;
  private dashReady: number[];
  private popKey = 0;
  private tickedSec = -1;
  private lastPts = -1;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? ROUNDS_SHORT : ROUNDS;
    this.input = new ArenaInput(ids);
    this.totals = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
    this.dashReady = ids.map(() => 0);
    this.sim = new CrownSim(ids.length);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, CrownGame>).crown = this;
    this.newRound();
    this.last = performance.now();
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
      this.scene = new CrownScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
      );
      this.scene.reset(this.sim);
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
    this.sim = new CrownSim(this.ids.length, { gone: this.ids.map((_, i) => this.removed.has(i)) });
    this.ids.forEach((id, i) => {
      if (!this.removed.has(i) && !this.host.player(id)?.connected) this.sim.setAway(i, true);
    });
    this.input.release();
    this.scene?.reset(this.sim);
    this.roundPts = this.ids.map(() => 0);
    this.dashReady = this.ids.map(() => 0);
    this.winners = [];
    this.pops = [];
    this.phase = 'ready';
    this.acc = 0;
    this.tickedSec = -1;
    this.lastPts = -1;
    this.doubleAt = -1e9;
    this.goAt = Date.now() + READY_MS;
    [READY_MS - 3000, READY_MS - 2000, READY_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && sound.count()));
    this.later(READY_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      this.acc = 0;
      this.handle(this.sim.begin());
      sound.go();
      this.update();
    });
    this.update();
  }

  private endRound() {
    if (this.phase !== 'play') return;
    this.phase = 'over';
    this.roundPts = this.sim.results();
    this.roundPts.forEach((p, i) => (this.totals[i] += this.removed.has(i) ? 0 : p));
    this.winners = this.sim.winners();
    this.overAt = performance.now();
    this.input.release();
    sound.whistle();
    this.later(BANNER_DELAY_MS, () => this.phase === 'over' && sound.fanfare());
    for (const w of this.winners) this.host.buzz(this.ids[w], [120, 60, 120, 60, 240]);
    this.later(OVER_MS, () => (this.round < this.rounds ? this.newRound() : this.finish()));
    this.update();
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.totals[i] + (this.phase === 'play' ? this.sim.points(i) : 0)));
    this.host.finish(out);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- loop --------------------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'play') {
      const press = this.ids.map((_, i) => this.input.takePresses(i, 0) > 0);
      this.acc += elapsed;
      let first = true;
      while (this.acc >= DT && this.phase === 'play') {
        this.acc -= DT;
        this.stepOnce(first ? press : null);
        first = false;
      }
    } else this.ids.forEach((_, i) => this.input.takePresses(i, 0));
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
    if (this.phase === 'play' && now - this.lastPhone > PHONE_MS) {
      this.lastPhone = now;
      this.host.refresh();
    }
  };

  private isBot(i: number) {
    return this.auto === true || (Array.isArray(this.auto) && this.auto.includes(i));
  }

  private stepOnce(press: boolean[] | null) {
    const inputs: (CrownInput | undefined)[] = this.ids.map((id, i) => {
      if (this.removed.has(i)) return undefined;
      if (this.isBot(i)) return botInput(this.sim, i);
      if (!this.host.player(id)?.connected) return undefined;
      const pad = this.input.pads[i];
      return { x: pad.x, z: pad.y, dash: press ? press[i] : false };
    });
    this.handle(this.sim.step(inputs));
    // The wearer's counter ticks with a little coin sound.
    const w = this.sim.wearer;
    const pts = w >= 0 ? this.sim.points(w) : -1;
    if (w >= 0 && pts !== this.lastPts && this.lastPts >= 0) sound.note(this.sim.double ? 1760 : 1320, 0.06, { type: 'triangle', vol: 0.05 });
    this.lastPts = pts;
    const sec = Math.ceil(this.sim.left);
    if (sec !== this.tickedSec) {
      if (sec <= 5 && sec > 0) sound.tick();
      this.tickedSec = sec;
    }
    if (this.sim.done) this.endRound();
  }

  /** Sounds, buzzes, pops and phone cooldowns for what just happened. */
  private handle(ev: CrownEvent[]) {
    if (!ev.length) return;
    this.scene?.events(ev, this.sim);
    const now = performance.now();
    let refresh = false;
    for (const e of ev) {
      switch (e.t) {
        case 'launch':
          sound.hiss(0.5, 0.18);
          sound.note(440, 0.4, { type: 'sine', vol: 0.1, slide: 990 });
          break;
        case 'dash':
          sound.whoosh();
          this.dashReady[e.p] = Date.now() + DASH_CD * 1000;
          this.host.buzz(this.ids[e.p], [25]);
          refresh = true;
          break;
        case 'pickup': {
          sound.pickup();
          sound.note(1568, 0.25, { type: 'triangle', vol: 0.08, delay: 0.14 });
          this.host.buzz(this.ids[e.p], [60, 40, 60]);
          const p = this.sim.players[e.p];
          this.pop('Crowned!', GOLD, p.x, p.z, now);
          refresh = true;
          break;
        }
        case 'steal': {
          sound.crash();
          sound.note(1200, 0.3, { type: 'square', vol: 0.05, slide: 300 });
          this.host.buzz(this.ids[e.from], [200, 40, 120]);
          this.host.buzz(this.ids[e.by], [40]);
          const p = this.sim.players[e.from];
          const by = this.host.player(this.ids[e.by]);
          this.pop('Knocked off!', colorHex(by?.color ?? 'sourcream'), p.x, p.z, now);
          refresh = true;
          break;
        }
        case 'bump':
          sound.plop();
          this.host.buzz(this.ids[e.p], [40]);
          break;
        case 'land':
          sound.note(1900, 0.08, { type: 'triangle', vol: 0.08 });
          sound.note(2500, 0.12, { type: 'triangle', vol: 0.05, delay: 0.06 });
          refresh = true;
          break;
        case 'drop':
          sound.plop();
          refresh = true;
          break;
        case 'double':
          this.doubleAt = now;
          sound.whistle();
          sound.correct();
          this.ids.forEach((id) => this.host.buzz(id, [80, 50, 80]));
          refresh = true;
          break;
        default:
          break;
      }
    }
    if (refresh) this.update();
  }

  private pop(text: string, color: string, x: number, z: number, now: number) {
    this.pops = this.pops.filter((p) => p.until > now);
    this.pops.push({ text, color, x, z, until: now + 1500, key: ++this.popKey });
  }

  /** For tests in the browser (/dev?debug): run the round forward without waiting. */
  debugAdvance(seconds: number) {
    for (let k = 0; k < Math.round(seconds / DT) && this.phase === 'play'; k++) this.stepOnce(null);
  }

  // ---- phones ------------------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    this.input.handle(id, m);
  }

  onConnection(id: string, connected: boolean) {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    if (!connected) this.input.release(i);
    if (!this.removed.has(i)) this.handle(this.sim.setAway(i, !connected));
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i)) return;
    this.removed.add(i);
    this.input.release(i);
    this.handle(this.sim.remove(i));
    this.scene?.hide(i);
    if (this.ids.length - this.removed.size < 2) {
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];
      if (this.removed.size >= this.ids.length) this.host.finish({});
      else this.finish();
      return;
    }
    this.update();
  }

  /** Points so far, the round being played included. */
  total(i: number) {
    return (this.totals[i] ?? 0) + (this.phase === 'play' ? this.sim.points(i) : 0);
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.sim.players[i];
    const base = { v: 'pad' as const, game: 'crown' as const, round: this.round, rounds: this.rounds, score: this.total(i) };
    const ready = this.dashReady[i] ?? 0;
    const dash: PadButton = { label: 'Dash', ...(ready > Date.now() ? { readyAt: ready } : {}), cool: DASH_CD * 1000 };
    const stats = [{ k: 'Points', v: String(this.total(i)) }, ...(this.sim.double ? [{ k: 'Now', v: '×2' }] : [])];
    if (this.phase === 'ready') {
      return { ...base, phase: 'ready', title: 'Get ready!', text: 'Grab the crown when the fountain spits it out', buttons: [{ ...dash, off: true }], stats };
    }
    if (this.phase === 'over') {
      const place = this.sim.ranking().indexOf(i) + 1;
      const won = this.winners.includes(i);
      return {
        ...base,
        phase: 'over',
        title: won ? (this.winners.length > 1 ? 'A shared throne!' : 'You rule this round!') : `${placeText(place)} · ${this.roundPts[i] ?? 0} points`,
        text: won ? `${this.roundPts[i] ?? 0} points this round` : this.round < this.rounds ? 'Next round coming up' : 'That’s the lot!',
        accent: won ? GOLD : undefined,
        buttons: [],
        stats,
      };
    }
    const c = this.sim.crown;
    if ((p?.daze ?? 0) > 0) return { ...base, phase: 'play', title: 'Dazed!', text: 'They knocked your crown off', accent: '#ff7a8a', buttons: [{ ...dash, off: true }], stats };
    if (c.state === 'held' && c.wearer === i) {
      return {
        ...base,
        phase: 'play',
        title: 'Your Majesty! Run!',
        text: this.sim.double ? 'Double points – keep running!' : 'Every second you wear it scores',
        accent: GOLD,
        buttons: [{ ...dash, color: GOLD }],
        stats,
      };
    }
    if (c.state === 'held') {
      const who = this.host.player(this.ids[c.wearer]);
      return { ...base, phase: 'play', title: 'Steal the crown!', text: `Dash into ${who?.name ?? 'the wearer'}`, accent: colorHex(who?.color ?? 'sourcream'), buttons: [dash], stats };
    }
    return { ...base, phase: 'play', title: 'Grab the crown!', text: 'Touch it to put it on', accent: GOLD, buttons: [dash], stats };
  }

  // ---- TV ----------------------------------------------------------------------------------------

  render() {
    return <CrownView game={this} />;
  }

  get contenders() {
    return this.ids.map((id, idx) => ({ id, idx, p: this.host.player(id) })).filter((c) => c.p && !this.removed.has(c.idx));
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const people = this.contenders;
    const left = this.phase === 'ready' ? Math.round(sim.length) : Math.ceil(sim.left);
    const double = this.phase === 'play' && sim.double;
    const w = this.phase === 'play' ? sim.wearer : -1;
    const order = [...people].sort((a, b) => this.total(b.idx) - this.total(a.idx) || a.idx - b.idx);
    const rankOf = new Map(order.map((c, k) => [c.idx, k]));
    const head = w >= 0 ? this.scene?.headAt(w, sim) : null;
    return (
      <>
        <div class="crown-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          <div class={`crown-timer ${double ? 'double' : ''} ${this.phase === 'play' && left <= 5 ? 'low' : ''}`} key={this.phase === 'play' && left <= 10 ? left : 'x'}>
            {left}
            <small>s</small>
            {double && <span class="crown-x2">×2</span>}
          </div>
          <span class="crown-rule">
            Wear the crown to score · <b>Dash</b> into the wearer to steal it
          </span>
        </div>
        {head && head.visible && (
          <div class={`crown-counter ${double ? 'double' : ''}`} style={{ left: head.x, top: head.y }} key="counter">
            <b key={sim.points(w)}>{sim.points(w)}</b>
          </div>
        )}
        {this.phase === 'play' && now - this.doubleAt < 2200 && (
          <div class="crown-call" key={this.doubleAt}>
            Podwójne punkty!
            <small>Double points!</small>
          </div>
        )}
        {this.pops.map((s) => {
          if (s.until < now) return null;
          const at = this.scene?.toStage(s.x, 2.2, s.z);
          if (!at) return null;
          return (
            <div class="cookbook-splat crown-pop" key={s.key} style={{ left: at.x, top: at.y, '--pc': s.color }}>
              {s.text}
            </div>
          );
        })}
        <div class="crown-chips">
          {people.map((c) => {
            const pl = this.sim.players[c.idx];
            const wearing = w === c.idx;
            return (
              <div
                class={`crown-chip ${wearing ? 'wearing' : ''} ${c.p!.connected ? '' : 'away'}`}
                style={{ '--pc': colorHex(c.p!.color), order: rankOf.get(c.idx) }}
                key={c.id}
              >
                {wearing && <CrownBadge />}
                <Pierogi color={colorHex(c.p!.color)} size={people.length > 5 ? 40 : 48} mood={!c.p!.connected ? 'sleep' : (pl?.daze ?? 0) > 0 ? 'dead' : wearing ? 'wow' : 'happy'} />
                <span class="crown-chip-name">{c.p!.name}</span>
                <b class="crown-chip-n">{this.total(c.idx)}</b>
              </div>
            );
          })}
        </div>
        {this.phase === 'ready' && (
          <>
            <div class="crown-intro">
              <div class="crown-intro-small">
                Round {this.round} of {this.rounds}
              </div>
              <div class="crown-intro-big">Grab the crown!</div>
            </div>
            <BigCountdown key={this.goAt} endsAt={this.goAt} />
          </>
        )}
        {this.phase === 'over' && now - this.overAt > BANNER_DELAY_MS && this.banner()}
        {this.glError && <div class="trails-banner">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  private banner() {
    const people = this.contenders;
    const order = [...people].sort((a, b) => this.roundPts[b.idx] - this.roundPts[a.idx] || a.idx - b.idx);
    const names = this.winners.map((i) => this.host.player(this.ids[i])?.name ?? '?');
    const big = names.length === 0 ? 'Nobody kept the crown!' : names.length === 1 ? `Long live ${names[0]}!` : `A shared throne: ${names.join(' & ')}`;
    const last = this.round >= this.rounds;
    return (
      <div class="trails-banner cookbook-banner crown-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · points for wearing the crown
        </div>
        <div class="trails-banner-big cookbook-banner-big crown-banner-big">{big}</div>
        <div class="cookbook-banner-list">
          {order.map((c) => (
            <div class={`cookbook-banner-row ${this.winners.includes(c.idx) ? 'win' : ''}`} style={{ '--pc': colorHex(c.p!.color) }} key={c.id}>
              <Pierogi color={colorHex(c.p!.color)} size={38} mood={this.winners.includes(c.idx) ? 'wow' : 'happy'} />
              <span class="grow">{c.p!.name}</span>
              {this.sim.players[c.idx]?.steals ? <small class="crown-steals">{this.sim.players[c.idx].steals}× stolen</small> : null}
              <b>+{this.roundPts[c.idx]}</b>
              {this.rounds > 1 && <span class="crown-banner-total">{this.totals[c.idx]}</span>}
            </div>
          ))}
        </div>
        <div class="trails-banner-small cookbook-next">{last ? 'That was the last round!' : 'The crown goes back in the fountain…'}</div>
      </div>
    );
  }
}

function CrownBadge() {
  return (
    <svg class="crown-badge" width="40" height="30" viewBox="0 0 40 30" aria-hidden="true">
      <path d="M4 26 L2 8 L12 16 L20 3 L28 16 L38 8 L36 26 Z" fill="#ffc93c" stroke="#241015" stroke-width="3" stroke-linejoin="round" />
      <circle cx="20" cy="20" r="3" fill="#e8233a" />
    </svg>
  );
}

function CrownView({ game }: { game: CrownGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook crown">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
