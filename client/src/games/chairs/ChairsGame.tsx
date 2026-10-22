import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { CHAIRS_ROUNDS, CHAIRS_ROUNDS_SHORT, ChairsSim, DT, STUN_S, eighthFor, type ChairsEvent } from './logic';
import { ChairsScene } from './scene';
import { Band, sadTrombone, sitSound } from './music';
import '../cookbook/cookbook.css';
import './chairs.css';

const COUNTDOWN_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 7000;
const BANNER_DELAY_MS = 1600;
const HUD_MS = 150;

type Phase = 'ready' | 'play' | 'over';

interface Pop {
  idx: number;
  until: number;
  key: number;
  text: string;
  kind: 'bad' | 'good';
}

export class ChairsGame implements Game {
  readonly id = 'chairs' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: ChairsSim;
  readonly input: ArenaInput;
  readonly band = new Band();
  scores: number[];
  roundPts: number[];
  winners: number[] = [];
  goAt = 0;
  overAt = 0;
  /** performance.now() of the last real stop, and of the last "Too slow!" timeout. */
  stopAt = -1e9;
  slowAt = -1e9;
  pops: Pop[] = [];
  readonly removed = new Set<number>();
  private scene: ChairsScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private popKey = 0;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? CHAIRS_ROUNDS_SHORT : CHAIRS_ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, ChairsGame>).chairs = this;
    this.newRound();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.band.stop();
    this.detach();
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new ChairsScene(
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

  /** Debug: stop the music now. */
  stopNow() {
    if (this.sim.phase === 'music') this.sim.plan = { dur: this.sim.phaseT, fakes: [] };
  }

  // ---- round flow --------------------------------------------------------------------------------

  private newRound() {
    this.round++;
    this.input.release();
    this.band.stop();
    this.sim = new ChairsSim(this.ids.length, { gone: this.ids.map((_, i) => this.removed.has(i)) });
    this.scene?.reset(this.sim);
    this.roundPts = this.ids.map(() => 0);
    this.winners = [];
    this.pops = [];
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
    this.winners = this.sim.solo ? this.ids.map((_, i) => i).filter((i) => this.sim.players[i].alive) : r.winners;
    r.points.forEach((p, i) => (this.scores[i] += p));
    this.overAt = performance.now();
    this.band.stop();
    if (this.winners.length) {
      this.scene?.crown(this.winners);
      sound.fanfare();
      // The band strikes up for the winner.
      this.later(BANNER_DELAY_MS, () => this.phase === 'over' && this.band.play(0.12));
    } else sadTrombone();
    this.later(OVER_MS, () => {
      this.band.stop();
      if (this.round < this.rounds) this.newRound();
      else this.finish();
    });
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
    this.band.update();
    this.scene?.render(this.sim, elapsed, this.winners, this.band.eighth);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private tick(now: number) {
    const inputs = this.ids.map((id, i) => {
      const pad = this.input.pads[i];
      const n = this.input.takePresses(i, 0);
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected;
      return live ? { x: pad.x, z: pad.y, sit: this.phase === 'play' ? n : 0 } : { x: 0, z: 0, sit: 0 };
    });
    const events = this.sim.step(inputs);
    if (events.length) this.handle(events, now);
  }

  private pop(idx: number, text: string, kind: Pop['kind'], now: number, ms = 1500) {
    this.pops = this.pops.filter((p) => p.until > now && p.idx !== idx);
    this.pops.push({ idx, text, kind, until: now + ms, key: ++this.popKey });
  }

  private handle(events: ChairsEvent[], now: number) {
    for (const e of events) {
      switch (e.t) {
        case 'music':
          this.band.play(eighthFor(e.n));
          this.update();
          break;
        case 'fake':
          if (e.on) this.band.sag();
          else this.band.resume();
          break;
        case 'stop':
          this.band.stop(true);
          this.stopAt = now;
          this.scene?.stopped();
          this.ids.forEach((id, i) => this.sim.players[i]?.alive && this.host.buzz(id, [90]));
          this.update();
          break;
        case 'trip':
          this.scene?.tripped(e.i);
          this.pop(e.i, 'Too early!', 'bad', now);
          this.host.buzz(this.ids[e.i], [200, 60, 200]);
          sound.note(260, 0.25, { type: 'sawtooth', vol: 0.07, slide: 130 });
          sound.hiss(0.15, 0.2);
          this.update();
          this.later(STUN_S * 1000 + 60, () => this.host.refresh());
          break;
        case 'sit':
          this.scene?.sat(e.i);
          this.pop(e.i, 'Got a chair!', 'good', now, 1200);
          this.host.buzz(this.ids[e.i], [40]);
          sitSound();
          this.update();
          break;
        case 'out':
          this.scene?.wentOut(e.idx);
          for (const i of e.idx) {
            this.pop(i, 'Out!', 'bad', now, 1800);
            this.host.buzz(this.ids[i], [300, 80, 300]);
          }
          if (e.timeout) this.slowAt = now;
          if (e.idx.length) this.later(250, () => sadTrombone());
          this.update();
          break;
        case 'setup':
          sound.whoosh();
          this.update();
          break;
        case 'over':
          this.endRound();
          break;
      }
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
    if (this.removed.size >= this.ids.length) {
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];
      this.band.stop();
      this.host.finish({});
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const sim = this.sim;
    const p = sim.players[i];
    const base = { v: 'pad' as const, game: 'chairs' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    const stats = [{ k: 'Chairs', v: String(sim.chairs.length) }];
    const sit: PadButton = { label: 'Sit', color: '#7a6a62' };
    if (this.phase === 'ready') {
      return { ...base, phase: 'ready', title: 'Get ready!', text: 'Walk round the chairs while the band plays', buttons: [{ ...sit, off: true }], stats };
    }
    if (this.phase === 'over') {
      const pts = this.roundPts[i] ?? 0;
      const won = this.winners.includes(i);
      return {
        ...base,
        phase: 'over',
        title: sim.solo ? `${sim.n - (p?.alive ? 0 : 1)} stop${sim.n === 1 ? '' : 's'}!` : won ? (this.winners.length > 1 ? 'A tie for first!' : 'The throne is yours!') : 'Round over',
        text: sim.solo ? 'That is how many chairs you got.' : `+${pts} point${pts === 1 ? '' : 's'}`,
        accent: won ? '#ffc93c' : undefined,
        buttons: [],
        noStick: true,
        stats,
      };
    }
    if (!p || !p.alive) {
      return { ...base, phase: 'out', title: 'No chair – you’re out!', text: 'Watch the TV', accent: '#ff7a8a', buttons: [], noStick: true, stats };
    }
    if (p.seat >= 0) {
      return { ...base, phase: 'play', title: 'You got a chair!', text: 'Sit tight…', accent: '#2fd6a8', buttons: [], noStick: true, stats };
    }
    if (p.stun > 0) {
      return { ...base, phase: 'play', title: 'Too early!', text: 'You tripped – wait for the music to stop', accent: '#ff7a8a', buttons: [{ ...sit, off: true }], stats };
    }
    if (sim.phase === 'scramble') {
      return { ...base, phase: 'play', title: 'SIT!', text: 'Run to a free chair and press SIT', accent: '#ffd23f', buttons: [{ label: 'SIT!', color: '#ffd23f' }], stats };
    }
    if (sim.phase === 'out' || sim.phase === 'setup') {
      return { ...base, phase: 'play', title: 'Up you get!', text: 'A chair goes – the band plays again', buttons: [{ ...sit, off: true }], stats };
    }
    return { ...base, phase: 'play', title: 'Walk around…', text: 'Keep outside the ring – sit only when the music stops!', buttons: [sit], stats };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <ChairsView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const stopCall = sim.phase === 'scramble' && now - this.stopAt < 1500;
    const left = sim.scrambleLeft;
    let rule = 'Walk round the chairs';
    if (this.phase === 'ready') rule = 'Musical chairs – one seat fewer every time';
    else if (sim.phase === 'music' || sim.phase === 'wait') rule = '♪ Walk round the ring – wait for the music to stop!';
    else if (sim.phase === 'scramble') rule = 'Grab a chair!';
    else if (sim.phase === 'out') rule = 'Left standing!';
    else if (sim.phase === 'setup') rule = 'One chair goes…';
    else if (sim.phase === 'done') rule = 'Long live the king of the chairs!';
    return (
      <>
        <div class="chairs-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          {sim.n > 0 && <span class="pill chairs-stop">Stop {sim.n}</span>}
          <span class="chairs-rule">{rule}</span>
        </div>
        {sim.phase !== 'done' && (
          <div class="chairs-count" key={`c${sim.chairs.length}`}>
            <b>{sim.chairs.length - (sim.phase === 'scramble' ? sim.chairs.length - sim.freeChairs : 0)}</b>
            <small>{sim.phase === 'scramble' ? (sim.freeChairs === 1 ? 'chair free' : 'chairs free') : sim.chairs.length === 1 ? 'chair left' : 'chairs left'}</small>
          </div>
        )}
        {stopCall && (
          <div class="chairs-call" key={`s${this.stopAt}`}>
            SIADAJ!
            <small>Sit down!</small>
          </div>
        )}
        {sim.phase === 'scramble' && left <= 5 && <div class="chairs-timer">{Math.ceil(left)}</div>}
        {now - this.slowAt < 1600 && (
          <div class="chairs-call slow" key={`t${this.slowAt}`}>
            Too slow!
          </div>
        )}
        {this.pops.map((s) => {
          const p = players[s.idx];
          const a = sim.players[s.idx];
          if (!p || !a || s.until < now) return null;
          const at = this.scene?.toStage(a.x, 1.6, a.z);
          if (!at) return null;
          return (
            <div class={`chairs-pop ${s.kind}`} key={s.key} style={{ left: at.x, top: at.y, '--pc': colorHex(p.color) }}>
              {s.text}
            </div>
          );
        })}
        <div class="cookbook-chips">
          {this.ids.map((_, i) => {
            const p = players[i];
            const a = sim.players[i];
            if (!p || !a || this.removed.has(i)) return null;
            const out = !a.alive && this.phase !== 'over';
            let line = `${this.scores[i]} pts`;
            if (this.phase === 'over') line = `+${this.roundPts[i]} · ${this.scores[i]} total`;
            else if (!a.alive) line = `Out at stop ${a.outAt}`;
            else if (a.seat >= 0) line = `Seated · ${this.scores[i]} pts`;
            else if (a.stun > 0) line = 'Tripped!';
            return (
              <div class={`cookbook-chip ${out ? 'out' : ''} ${a.seat >= 0 ? 'chairs-seated' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={out ? 'dead' : !p.connected ? 'sleep' : a.stun > 0 ? 'dead' : 'happy'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{line}</small>
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
      .sort((a, b) => this.roundPts[b] - this.roundPts[a]);
    let big: string;
    if (sim.solo) {
      const got = sim.players.find((p) => !p.gone);
      const n = got ? (got.alive ? sim.n : (got.outAt ?? 1) - 1) : 0;
      big = `${n} chair${n === 1 ? '' : 's'}!`;
    } else if (this.winners.length === 1) big = `${name(this.winners[0])} takes the throne!`;
    else if (this.winners.length > 1) big = `A tie: ${this.winners.map(name).join(' & ')}`;
    else big = 'Round over';
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {sim.n} stop{sim.n === 1 ? '' : 's'}
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
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'The band tunes up again…' : 'That was the last dance!'}</div>
      </div>
    );
  }
}

function ChairsView({ game }: { game: ChairsGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook chairs">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
