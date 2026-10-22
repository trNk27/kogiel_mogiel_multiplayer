import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DASH_CD, DT, GOLDEN_S, ROUNDS, ROUNDS_SHORT, ROUND_S, STUN, CoinsSim, placeText, type CoinsEvent, type CoinsInput } from './logic';
import { CoinsScene } from './scene';
import '../cookbook/cookbook.css';
import './coins.css';

const COUNTDOWN_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 7000;
const BANNER_DELAY_MS = 900;
const HUD_MS = 120;
const PHONE_MS = 900;

type Phase = 'ready' | 'play' | 'over';

interface Pop {
  idx: number;
  text: string;
  until: number;
  key: number;
}

export class CoinsGame implements Game {
  readonly id = 'coins' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim: CoinsSim;
  readonly input: ArenaInput;
  /** Coins over finished rounds, and in the round just played. */
  totals: number[];
  roundCoins: number[] = [];
  goAt = 0;
  overAt = 0;
  goldenAt = -1e9;
  pops: Pop[] = [];
  readonly removed = new Set<number>();
  private scene: CoinsScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private lastPhone = 0;
  private lastSound = { pick: 0, hit: 0, land: 0 };
  private phoneCoins: number[];
  private dashReady: number[];
  private popKey = 0;
  private tickedSec = -1;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? ROUNDS_SHORT : ROUNDS;
    this.input = new ArenaInput(ids);
    this.totals = ids.map(() => 0);
    this.roundCoins = ids.map(() => 0);
    this.phoneCoins = ids.map(() => 0);
    this.dashReady = ids.map(() => 0);
    this.sim = new CoinsSim(ids.length);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, CoinsGame>).coins = this;
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

  /** Called by the view once its canvas exists. */
  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new CoinsScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.sim,
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
    if (this.round > 1) this.sim = new CoinsSim(this.ids.length);
    this.removed.forEach((i) => this.sim.remove(i));
    this.input.release();
    this.scene?.reset(this.sim);
    this.roundCoins = this.ids.map(() => 0);
    this.phoneCoins = this.ids.map(() => 0);
    this.dashReady = this.ids.map(() => 0);
    this.pops = [];
    this.acc = 0;
    this.tickedSec = -1;
    this.phase = 'ready';
    this.goAt = Date.now() + COUNTDOWN_MS;
    [COUNTDOWN_MS - 3000, COUNTDOWN_MS - 2000, COUNTDOWN_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && sound.count()));
    this.later(COUNTDOWN_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      this.acc = 0;
      sound.go();
      this.update();
    });
    this.update();
  }

  private endRound() {
    if (this.phase !== 'play') return;
    this.phase = 'over';
    this.roundCoins = this.sim.scores();
    this.roundCoins.forEach((c, i) => (this.totals[i] += this.removed.has(i) ? 0 : c));
    this.phoneCoins = this.roundCoins.slice();
    this.overAt = performance.now();
    this.later(BANNER_DELAY_MS, () => this.phase === 'over' && sound.fanfare());
    for (const w of this.sim.winners()) this.host.buzz(this.ids[w], [120, 60, 120, 60, 240]);
    this.later(OVER_MS, () => (this.round < this.rounds ? this.newRound() : this.finish()));
    this.update();
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.totals[i]));
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
      const dashes = this.ids.map((id, i) => this.input.takePresses(i, 0) > 0 && !this.removed.has(i) && !!this.host.player(id)?.connected);
      this.acc += elapsed;
      let first = true;
      while (this.acc >= DT && this.phase === 'play') {
        this.acc -= DT;
        this.stepOnce(first ? dashes : null);
        first = false;
      }
    } else {
      this.ids.forEach((_, i) => this.input.takePresses(i, 0));
    }
    this.scene?.render(this.sim, elapsed, this.phase === 'play');
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
    if (this.phase === 'play' && now - this.lastPhone > PHONE_MS) {
      this.lastPhone = now;
      const c = this.sim.players.map((p) => p.coins);
      if (c.some((v, i) => v !== this.phoneCoins[i])) {
        this.phoneCoins = c;
        this.host.refresh();
      }
    }
  };

  private stepOnce(dashes: boolean[] | null) {
    const inputs: CoinsInput[] = this.ids.map((id, i) => {
      const pad = this.input.pads[i];
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected;
      return live ? { x: pad.x, z: pad.y, dash: dashes ? dashes[i] : false } : { x: 0, z: 0 };
    });
    const ev = this.sim.step(inputs);
    if (ev.length) {
      this.scene?.events(ev, this.sim);
      this.react(ev);
    }
    const sec = Math.ceil(this.sim.left - 1e-6);
    if (sec !== this.tickedSec) {
      if (sec <= 5 && sec > 0) sound.tick();
      this.tickedSec = sec;
    }
    if (this.sim.done) this.endRound();
  }

  /** Sounds, buzzes, phone cooldowns and floating labels for what just happened. */
  private react(ev: CoinsEvent[]) {
    const now = performance.now();
    for (const e of ev) {
      switch (e.t) {
        case 'pick':
          if (now - this.lastSound.pick > 50) {
            this.lastSound.pick = now;
            if (e.kind === 'gold') {
              sound.note(1320, 0.12, { type: 'triangle', vol: 0.3 });
              sound.note(1760, 0.22, { type: 'triangle', vol: 0.3, delay: 0.08 });
            } else sound.note(e.kind === 'silver' ? 1175 : 880, 0.09, { type: 'triangle', vol: 0.22 });
          }
          if (e.kind === 'gold') this.host.buzz(this.ids[e.p], [40, 30, 40]);
          break;
        case 'hit':
          if (now - this.lastSound.hit > 120) {
            this.lastSound.hit = now;
            sound.crash();
          }
          this.host.buzz(this.ids[e.p], [220, 50, 160]);
          if (e.lost > 0) this.pop(e.p, `−${e.lost}`);
          this.host.refresh(this.ids[e.p]);
          break;
        case 'recover':
          this.host.refresh(this.ids[e.p]);
          break;
        case 'bump':
          sound.plop();
          this.host.buzz(this.ids[e.p], [120, 40, 80]);
          if (e.lost > 0) this.pop(e.p, `−${e.lost}`);
          break;
        case 'dash':
          sound.whoosh();
          this.dashReady[e.p] = Date.now() + DASH_CD * 1000;
          this.host.refresh(this.ids[e.p]);
          break;
        case 'throw':
          sound.whistle();
          break;
        case 'land':
          if (e.kind === 'gold' && now - this.lastSound.land > 200) {
            this.lastSound.land = now;
            sound.note(1568, 0.15, { type: 'sine', vol: 0.18 });
          }
          break;
        case 'golden':
          this.goldenAt = now;
          sound.bell();
          this.later(300, () => sound.bell());
          break;
        default:
          break;
      }
    }
  }

  private pop(idx: number, text: string) {
    this.pops.push({ idx, text, until: performance.now() + 1500, key: ++this.popKey });
    if (this.pops.length > 12) this.pops.shift();
  }

  /** For tests in the browser (/?debug): run the round forward without waiting. */
  debugAdvance(seconds: number) {
    if (this.phase !== 'play') return;
    const steps = Math.round(seconds / DT);
    const inputs = this.ids.map((_, i) => ({ x: this.input.pads[i].x, z: this.input.pads[i].y }));
    for (let k = 0; k < steps && this.phase === 'play'; k++) {
      const ev = this.sim.step(inputs);
      if (ev.length) this.scene?.events(ev, this.sim);
      if (this.sim.done) this.endRound();
    }
  }

  // ---- phones ------------------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    this.input.handle(id, m);
  }

  onConnection(id: string, connected: boolean) {
    const i = this.ids.indexOf(id);
    if (i >= 0 && !connected) this.input.release(i);
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
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];
      this.host.finish({});
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.sim.players[i];
    const coins = this.phase === 'over' ? (this.roundCoins[i] ?? 0) : (this.phoneCoins[i] ?? 0);
    const base = { v: 'pad' as const, game: 'coins' as const, round: this.round, rounds: this.rounds, score: this.totals[i] ?? 0 };
    const stats = [{ k: 'Coins', v: String(coins) }];
    const dash = (off: boolean): PadButton => ({
      label: 'Dash',
      off,
      ...((this.dashReady[i] ?? 0) > Date.now() ? { readyAt: this.dashReady[i] } : {}),
      cool: DASH_CD * 1000,
    });
    if (this.phase === 'ready') return { ...base, phase: 'ready', title: 'Get ready!', text: 'Catch the coins, dodge the pots', buttons: [dash(true)], stats };
    if (this.phase === 'over') {
      const place = this.sim.ranking().indexOf(i) + 1;
      const solo = this.ids.length - this.removed.size <= 1;
      const won = this.sim.winners().includes(i);
      return {
        ...base,
        phase: 'over',
        title: solo || coins === 0 ? `${coins} coin${coins === 1 ? '' : 's'}!` : `${placeText(place)} · ${coins} coin${coins === 1 ? '' : 's'}`,
        text: this.round < this.rounds ? 'Next round coming up' : 'That’s the lot!',
        accent: won ? '#ffc93c' : undefined,
        buttons: [],
        noStick: true,
        stats,
      };
    }
    if (p && p.stun > 0) {
      return { ...base, phase: 'play', title: 'Bonk!', text: `Stunned for ${STUN.toFixed(1)} s`, accent: '#ff7a8a', buttons: [dash(true)], stats };
    }
    const golden = this.sim.golden;
    return {
      ...base,
      phase: 'play',
      title: golden ? 'Złoty deszcz!' : undefined,
      accent: golden ? '#ffc93c' : undefined,
      text: golden ? 'Grab all the gold!' : 'Catch coins · dodge pots',
      buttons: [dash(false)],
      stats,
    };
  }

  // ---- TV ----------------------------------------------------------------------------------------

  render() {
    return <CoinsView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const left = Math.ceil(sim.left - 1e-6);
    const golden = sim.golden && this.phase === 'play';
    const live = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i) && players[i]);
    const best = Math.max(0, ...live.map((i) => sim.players[i].coins));
    const shown = (i: number) => (this.phase === 'over' ? this.roundCoins[i] : sim.players[i].coins);
    return (
      <>
        <div class="coins-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          <span class={`coins-rule ${golden ? 'gold' : ''}`}>{golden ? 'Złoty deszcz! Gold everywhere!' : 'Catch coins · dodge the babcias’ pots'}</span>
          <span class={`coins-timer ${this.phase === 'play' && left <= 10 ? 'low' : ''} ${golden ? 'gold' : ''}`} key={this.phase === 'play' && left <= 10 ? left : 'x'}>
            {this.phase === 'ready' ? Math.round(sim.length) : left}
            <small>s</small>
          </span>
        </div>
        {now - this.goldenAt < 2400 && this.phase === 'play' && (
          <div class="coins-call" key={`g${this.goldenAt}`}>
            Złoty deszcz!
          </div>
        )}
        {this.phase === 'play' && sim.time < 6 && <div class="coins-key">Last {GOLDEN_S} s: golden rain</div>}
        {this.pops.map((s) => {
          const p = players[s.idx];
          const a = sim.players[s.idx];
          if (!p || !a || s.until < now) return null;
          const at = this.scene?.toStage(a.x, 2.2, a.z);
          if (!at) return null;
          return (
            <div class="coins-pop" key={s.key} style={{ left: at.x, top: at.y, '--pc': colorHex(p.color) }}>
              {s.text}
            </div>
          );
        })}
        <div class="cookbook-chips">
          {live.map((i) => {
            const p = players[i]!;
            const a = sim.players[i];
            const lead = this.phase === 'play' && best > 1 && a.coins === best;
            return (
              <div class={`cookbook-chip coins-chip ${lead ? 'lead' : ''} ${p.connected ? '' : 'out'}`} style={{ '--pc': colorHex(p.color) }} key={this.ids[i]}>
                <Pierogi color={colorHex(p.color)} size={live.length > 5 ? 42 : 48} mood={!p.connected ? 'sleep' : a.stun > 0 ? 'dead' : a.stagger > 0 ? 'wow' : 'happy'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{this.phase === 'over' ? `${this.totals[i]} total` : this.round > 1 ? `${this.totals[i]} so far` : 'coins'}</small>
                </span>
                <span class="coins-chip-n">
                  {shown(i)}
                  <i />
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
    const name = (i: number) => players[i]?.name ?? '?';
    const live = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i) && players[i]);
    const order = live.slice().sort((a, b) => this.roundCoins[b] - this.roundCoins[a] || a - b);
    const winners = this.sim.winners().filter((i) => !this.removed.has(i));
    const solo = live.length === 1;
    let big: string;
    if (solo) big = `${this.roundCoins[live[0]]} coins!`;
    else if (winners.length === 1) big = `${name(winners[0])} wins the round!`;
    else if (winners.length > 1) big = `A tie: ${winners.map(name).join(' & ')}`;
    else big = 'Nobody caught a thing!';
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {ROUND_S} s of coins
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
        {!solo && (
          <div class="cookbook-banner-list">
            {order.map((i) => {
              const p = players[i]!;
              return (
                <div class={`cookbook-banner-row ${winners.includes(i) ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }} key={this.ids[i]}>
                  <Pierogi color={colorHex(p.color)} size={38} mood={winners.includes(i) ? 'wow' : 'happy'} />
                  <span class="grow">{p.name}</span>
                  <b>{this.roundCoins[i]}</b>
                  {this.rounds > 1 && <small class="coins-total">{this.totals[i]} total</small>}
                </div>
              );
            })}
          </div>
        )}
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'The babcias reload their flower pots…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function CoinsView({ game }: { game: CoinsGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook coins">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
