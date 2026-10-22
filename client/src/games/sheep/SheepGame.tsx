import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DT, ROUNDS, ROUNDS_SHORT, ROUND_S, WHISTLE_CD, SheepSim, finalScores, placeText, type SheepEvent, type SheepInput } from './logic';
import { SheepScene } from './scene';
import '../cookbook/cookbook.css';
import './sheep.css';

const COUNTDOWN_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 7000;
const BANNER_DELAY_MS = 900;
const HUD_MS = 120;
const PHONE_MS = 900;

type Phase = 'ready' | 'play' | 'over';

export class SheepGame implements Game {
  readonly id = 'sheep' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim: SheepSim;
  readonly input: ArenaInput;
  /** Points over finished rounds, and in the round just played. */
  totals: number[];
  roundPts: number[];
  goAt = 0;
  overAt = 0;
  readonly removed = new Set<number>();
  private scene: SheepScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private lastPhone = 0;
  private lastSound = { pen: 0, bleat: 0 };
  private phonePts: number[];
  private whistleReady: number[];
  private tickedSec = -1;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? ROUNDS_SHORT : ROUNDS;
    this.input = new ArenaInput(ids);
    this.totals = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
    this.phonePts = ids.map(() => 0);
    this.whistleReady = ids.map(() => 0);
    this.sim = new SheepSim(ids.length, { short: host.short });
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, SheepGame>).sheep = this;
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
      this.scene = new SheepScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.sim.pens,
      );
      this.scene.reset();
      this.removed.forEach((i) => this.scene?.closePen(i));
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
    if (this.round > 1) this.sim = new SheepSim(this.ids.length, { short: this.host.short });
    this.removed.forEach((i) => this.sim.remove(i));
    this.input.release();
    this.scene?.reset();
    this.roundPts = this.ids.map(() => 0);
    this.phonePts = this.ids.map(() => 0);
    this.whistleReady = this.ids.map(() => 0);
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
    this.roundPts = this.sim.scores().map((p, i) => (this.removed.has(i) ? 0 : p));
    this.roundPts.forEach((c, i) => (this.totals[i] += c));
    this.phonePts = this.roundPts.slice();
    this.overAt = performance.now();
    this.later(BANNER_DELAY_MS, () => this.phase === 'over' && sound.fanfare());
    for (const w of this.winners()) this.host.buzz(this.ids[w], [120, 60, 120, 60, 240]);
    this.later(OVER_MS, () => (this.round < this.rounds ? this.newRound() : this.finish()));
    this.update();
  }

  private finish() {
    this.host.finish(finalScores(this.ids, this.totals, this.removed));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  /** Everyone sharing the best round (nobody if nobody penned a sheep). */
  winners() {
    const live = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i));
    const best = Math.max(0, ...live.map((i) => this.roundPts[i]));
    return best > 0 ? live.filter((i) => this.roundPts[i] === best) : [];
  }

  // ---- loop --------------------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'play') {
      const whistles = this.ids.map((id, i) => this.input.takePresses(i, 0) > 0 && !this.removed.has(i) && !!this.host.player(id)?.connected);
      this.acc += elapsed;
      let first = true;
      while (this.acc >= DT && this.phase === 'play') {
        this.acc -= DT;
        this.stepOnce(first ? whistles : null);
        first = false;
      }
    } else {
      this.ids.forEach((_, i) => this.input.takePresses(i, 0));
    }
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
    if (this.phase === 'play' && now - this.lastPhone > PHONE_MS) {
      this.lastPhone = now;
      const c = this.sim.scores();
      if (c.some((v, i) => v !== this.phonePts[i])) {
        this.phonePts = c;
        this.host.refresh();
      }
    }
  };

  private stepOnce(whistles: boolean[] | null) {
    const inputs: SheepInput[] = this.ids.map((id, i) => {
      const pad = this.input.pads[i];
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected;
      return live ? { x: pad.x, z: pad.y, whistle: whistles ? whistles[i] : false } : { x: 0, z: 0 };
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

  /** Sounds, buzzes and phone cooldowns for what just happened. */
  private react(ev: SheepEvent[]) {
    const now = performance.now();
    for (const e of ev) {
      switch (e.t) {
        case 'pen':
          if (now - this.lastSound.pen > 80) {
            this.lastSound.pen = now;
            sound.pickup();
            if (e.black) {
              sound.note(660, 0.12, { type: 'triangle', vol: 0.3, delay: 0.06 });
              sound.note(990, 0.2, { type: 'triangle', vol: 0.3, delay: 0.16 });
            }
          }
          this.host.buzz(this.ids[e.pen], e.black ? [40, 30, 40] : [30]);
          break;
        case 'whistle':
          sound.whistle();
          this.whistleReady[e.p] = Date.now() + WHISTLE_CD * 1000;
          this.host.refresh(this.ids[e.p]);
          break;
        case 'spawn':
          if (now - this.lastSound.bleat > 900) {
            this.lastSound.bleat = now;
            // A bleat: a wobbly sawtooth that sags.
            sound.note(430, 0.32, { type: 'sawtooth', vol: 0.1, slide: -90 });
            sound.note(436, 0.28, { type: 'sawtooth', vol: 0.08, delay: 0.14, slide: -70 });
          }
          break;
        case 'bump':
          if (e.force > 1) sound.plop();
          break;
        default:
          break;
      }
    }
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
    this.scene?.closePen(i);
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
    const pts = this.phase === 'over' ? (this.roundPts[i] ?? 0) : (this.phonePts[i] ?? 0);
    const pen = this.sim.pens[i];
    const base = { v: 'pad' as const, game: 'sheep' as const, round: this.round, rounds: this.rounds, score: this.totals[i] ?? 0 };
    const stats = [{ k: 'Penned', v: String(pen?.count ?? 0) }, { k: 'Points', v: String(pts) }];
    const whistle = (off: boolean): PadButton => ({
      label: 'Whistle',
      color: '#ffd23f',
      off,
      ...((this.whistleReady[i] ?? 0) > Date.now() ? { readyAt: this.whistleReady[i] } : {}),
      cool: WHISTLE_CD * 1000,
    });
    if (this.phase === 'ready') return { ...base, phase: 'ready', title: 'Get ready!', text: 'Herd the sheep into your pen', buttons: [whistle(true)], stats };
    if (this.phase === 'over') {
      const solo = this.ids.length - this.removed.size <= 1;
      const place = this.sim.ranking().indexOf(i) + 1;
      const won = this.winners().includes(i);
      return {
        ...base,
        phase: 'over',
        title: solo || pts === 0 ? `${pts} point${pts === 1 ? '' : 's'}!` : `${placeText(place)} · ${pts} point${pts === 1 ? '' : 's'}`,
        text: this.round < this.rounds ? 'Next round coming up' : 'That’s the flock!',
        accent: won ? '#ffc93c' : undefined,
        buttons: [],
        noStick: true,
        stats,
      };
    }
    return { ...base, phase: 'play', text: 'Run at them · Whistle scares sheep away', buttons: [whistle(false)], stats };
  }

  // ---- TV ----------------------------------------------------------------------------------------

  render() {
    return <SheepView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const left = Math.ceil(sim.left - 1e-6);
    const live = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i) && players[i]);
    const pts = (i: number) => (this.phase === 'over' ? this.roundPts[i] : sim.pens[i].points);
    const best = Math.max(0, ...live.map((i) => pts(i)));
    return (
      <>
        <div class="sheep-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          <span class="sheep-rule">Herd sheep into your pen · black ones are worth 3</span>
          <span class={`sheep-timer ${this.phase === 'play' && left <= 10 ? 'low' : ''}`} key={this.phase === 'play' && left <= 10 ? left : 'x'}>
            {this.phase === 'ready' ? ROUND_S : left}
            <small>s</small>
          </span>
        </div>
        {this.scene &&
          live.map((i) => {
            const p = players[i]!;
            const at = this.scene!.penBadge(sim.pens[i]);
            return (
              <div class={`sheep-badge ${pts(i) > 0 && pts(i) === best && this.phase === 'play' && best > 1 ? 'lead' : ''}`} key={`b${this.ids[i]}`} style={{ left: at.x, top: at.y, '--pc': colorHex(p.color) }}>
                {pts(i)}
              </div>
            );
          })}
        <div class="cookbook-chips">
          {live.map((i) => {
            const p = players[i]!;
            const pen = sim.pens[i];
            return (
              <div class={`cookbook-chip sheep-chip ${p.connected ? '' : 'out'}`} style={{ '--pc': colorHex(p.color) }} key={this.ids[i]}>
                <Pierogi color={colorHex(p.color)} size={live.length > 5 ? 42 : 48} mood={!p.connected ? 'sleep' : pts(i) > 0 && pts(i) === best ? 'wow' : 'happy'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{this.phase === 'over' ? `${this.totals[i]} total` : this.round > 1 ? `${this.totals[i]} so far` : `${pen.count} penned`}</small>
                </span>
                <span class="sheep-chip-n">{pts(i)}</span>
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
    const order = live.slice().sort((a, b) => this.roundPts[b] - this.roundPts[a] || a - b);
    const winners = this.winners();
    const solo = live.length === 1;
    let big: string;
    if (solo) big = `${this.roundPts[live[0]]} point${this.roundPts[live[0]] === 1 ? '' : 's'}!`;
    else if (winners.length === 1) big = `${name(winners[0])} wins the round!`;
    else if (winners.length > 1) big = `A tie: ${winners.map(name).join(' & ')}`;
    else big = 'Not a single sheep penned!';
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {ROUND_S} s on the meadow
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
        {!solo && (
          <div class="cookbook-banner-list">
            {order.map((i) => {
              const p = players[i]!;
              const pen = this.sim.pens[i];
              return (
                <div class={`cookbook-banner-row ${winners.includes(i) ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }} key={this.ids[i]}>
                  <Pierogi color={colorHex(p.color)} size={38} mood={winners.includes(i) ? 'wow' : 'happy'} />
                  <span class="grow">{p.name}</span>
                  <small class="sheep-total">{pen.count} sheep</small>
                  <b>{this.roundPts[i]}</b>
                  {this.rounds > 1 && <small class="sheep-total">{this.totals[i]} total</small>}
                </div>
              );
            })}
          </div>
        )}
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'The shepherds let the sheep out again…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function SheepView({ game }: { game: SheepGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook sheep">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
