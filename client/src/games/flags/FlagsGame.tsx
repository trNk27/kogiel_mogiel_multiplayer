import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DT, FLAGS_ROUNDS, FLAGS_ROUNDS_SHORT, FlagsSim, MAX_CALLS, callWords, type FlagsEvent } from './logic';
import { FlagsScene } from './scene';
import '../cookbook/cookbook.css';
import './flags.css';

const COUNTDOWN_MS = 3500;
const OVER_MS = 6000;
const BANNER_DELAY_MS = 1400;
const HUD_MS = 100;

type Phase = 'ready' | 'play' | 'over';

interface Pop {
  idx: number;
  until: number;
  key: number;
  wrong: boolean;
}

export class FlagsGame implements Game {
  readonly id = 'flags' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: FlagsSim;
  readonly input: ArenaInput;
  scores: number[];
  roundPts: number[];
  winners: number[] = [];
  goAt = 0;
  overAt = 0;
  pops: Pop[] = [];
  readonly removed = new Set<number>();
  private scene: FlagsScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? FLAGS_ROUNDS_SHORT : FLAGS_ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, FlagsGame>).flags = this;
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
      this.scene = new FlagsScene(
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
    this.sim = new FlagsSim(
      this.ids.length,
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
    );
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
    this.winners = r.winners;
    r.points.forEach((p, i) => (this.scores[i] += p));
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
    const presses = this.ids.map((id, i) => {
      const w = this.input.takePresses(i, 0);
      const r = this.input.takePresses(i, 1);
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected && this.phase === 'play';
      return live ? [w, r] : [0, 0];
    });
    const events = this.sim.step(presses);
    if (events.length) this.handle(events, now);
  }

  private handle(events: FlagsEvent[], now: number) {
    for (const e of events) {
      switch (e.t) {
        case 'call':
          sound.whistle();
          this.update();
          break;
        case 'raise':
          sound.whoosh();
          break;
        case 'lock':
          sound.lockIn();
          this.scene?.cheered(e.i);
          this.host.refresh(this.ids[e.i]);
          break;
        case 'out':
          this.scene?.fell(e.i);
          this.host.buzz(this.ids[e.i], [220, 50, 140]);
          this.pops.push({ idx: e.i, until: now + 1700, key: (this.sim.calls * 100 + e.i) * 2 + (e.wrong ? 1 : 0), wrong: e.wrong });
          this.later(500, () => sound.plop());
          sound.wrong();
          this.host.refresh(this.ids[e.i]);
          break;
        case 'resolve':
          if (!e.out.length) sound.correct();
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
      this.host.finish({});
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.sim.players[i];
    const white: PadButton = { label: 'White', color: '#fbf6ec' };
    const red: PadButton = { label: 'Red', color: '#e8335a' };
    const base = { v: 'pad' as const, game: 'flags' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0, noStick: true };
    const stats = [{ k: 'Calls', v: String(p?.right ?? 0) }];
    if (this.phase === 'ready') {
      return { ...base, phase: 'ready', title: 'Get ready!', text: 'Raise the flag Babcia SAYS', buttons: [{ ...white, off: true }, { ...red, off: true }], stats };
    }
    if (this.phase === 'over') {
      const pts = this.roundPts[i] ?? 0;
      const won = this.winners.includes(i);
      return {
        ...base,
        phase: 'over',
        title: this.sim.solo ? `${p?.right ?? 0} call${p?.right === 1 ? '' : 's'}!` : won ? (this.winners.length > 1 ? 'A tie for first!' : 'Still dry – you win!') : 'Round over',
        text: this.sim.solo ? 'That is how many you got right.' : `+${pts} point${pts === 1 ? '' : 's'}`,
        accent: won ? '#ffc93c' : undefined,
        buttons: [],
        stats,
      };
    }
    if (!p || !p.alive) {
      return { ...base, phase: 'out', title: 'Splash!', text: 'Watch the TV', accent: '#7ab8ff', buttons: [], stats };
    }
    if (this.sim.phase === 'call' && p.locked) {
      return { ...base, phase: 'play', title: 'Got it!', text: 'Wait for the next call', accent: '#2fd6a8', buttons: [white, red], stats };
    }
    return { ...base, phase: 'play', title: 'Watch Babcia!', text: 'Do what she SAYS, not what she shows', buttons: [white, red], stats };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <FlagsView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const call = sim.phase === 'call' ? sim.call : null;
    // The bubble stays up through the gap after a call, so everyone can read what she said.
    const said = call ?? (sim.phase === 'gap' ? sim.call : null);
    const words = said ? callWords(said.kind) : null;
    const left = call ? Math.max(0, call.limit - sim.phaseT) / call.limit : 0;
    return (
      <>
        <div class="cookbook-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          {sim.calls > 0 && <span class="pill cookbook-page">{sim.calls >= MAX_CALLS ? 'Last call!' : `Call ${sim.calls}`}</span>}
          <span class="cookbook-rule">Do what Babcia SAYS!</span>
        </div>
        {words && said && (
          <div class={`flags-bubble ${said.kind} ${call ? '' : 'done'}`} key={`c${said.n}`}>
            <b>{words.en}</b>
            <small>„{words.pl}”</small>
            <div class="flags-timer">
              <div style={{ width: `${left * 100}%` }} />
            </div>
          </div>
        )}
        {this.pops.map((s) => {
          const p = players[s.idx];
          if (!p || s.until < now || !this.scene) return null;
          const at = this.scene.above(s.idx);
          return (
            <div class="cookbook-splat" key={s.key} style={{ left: at.x, top: at.y, '--pc': colorHex(p.color) }}>
              {s.wrong ? 'Wrong flag!' : 'Too slow!'}
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
              <div class={`cookbook-chip ${out ? 'out' : ''} ${call && a.locked ? 'flags-ok' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={out ? 'dead' : p.connected ? (call && a.locked ? 'wow' : 'happy') : 'sleep'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{this.phase === 'over' ? `+${this.roundPts[i]} · ${this.scores[i]} total` : out ? `In the lake · call ${a.outAt}` : `${a.right} right · ${this.scores[i]} pts`}</small>
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
      const right = sim.players[order[0]]?.right ?? 0;
      big = `${right} call${right === 1 ? '' : 's'} right!`;
    } else if (this.winners.length === 1) big = `${name(this.winners[0])} stays dry!`;
    else if (this.winners.length > 1) big = `A tie: ${this.winners.map(name).join(' & ')}`;
    else big = 'Round over';
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {sim.calls} call{sim.calls === 1 ? '' : 's'}
          {sim.calls >= MAX_CALLS ? ' · Babcia lost her voice!' : ''}
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
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'Everybody dry off for the next round…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function FlagsView({ game }: { game: FlagsGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook flags">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
