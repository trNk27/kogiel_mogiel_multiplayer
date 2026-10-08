import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadView, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DT, MUSH_ROUNDS, MUSH_ROUNDS_SHORT, MushroomSim, OVER_S, READY_S, SHOVE_COOL, SPECIES, capsFor, type MEvent } from './logic';
import { MushroomScene } from './scene';
import './mushroom.css';

export { MUSH_ROUNDS, MUSH_ROUNDS_SHORT };
const HUD_MS = 200;
/** How long the final splash is shown before the round-over banner comes up. */
const BANNER_DELAY_MS = 1100;
const GOLD = '#ffc93c';

export class MushroomGame implements Game {
  readonly id = 'mushroom' as const;
  readonly rounds: number;
  round = 0;
  sim: MushroomSim;
  cup: number[];
  lastPoints: number[];
  lastWinner: number | null = null;
  /** Date.now() when the round-over banner appears, or 0. */
  overAt = 0;
  readyEndsAt = 0;
  /** What the TV says about the last sink ("Splash! Kasia, Tomek"). */
  splashLine = '';
  twist: { text: string; until: number } | null = null;
  private input: ArenaInput;
  private removed = new Set<number>();
  private scene: MushroomScene | null = null;
  private glError = false;
  private readyAt: number[];
  private caps: number;
  private raf = 0;
  private timer: number | undefined;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private lastTick = -1;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? MUSH_ROUNDS_SHORT : MUSH_ROUNDS;
    this.cup = ids.map(() => 0);
    this.lastPoints = ids.map(() => 0);
    this.readyAt = ids.map(() => 0);
    this.input = new ArenaInput(ids);
    this.caps = capsFor(ids.length);
    this.sim = new MushroomSim(ids.length, Math.random, ids.map(() => true), undefined, this.caps);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, MushroomGame>).mushroom = this;
    this.newRound();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.detach();
  }

  // ---- 3D view -----------------------------------------------------------------------

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new MushroomScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.sim,
      );
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

  // ---- round flow ----------------------------------------------------------------------

  private present() {
    return this.ids.map((_, i) => !this.removed.has(i));
  }

  private newRound() {
    this.round++;
    this.sim = new MushroomSim(this.ids.length, Math.random, this.present(), undefined, this.caps);
    if (this.scene) this.scene.sim = this.sim;
    this.input.release();
    this.overAt = 0;
    this.lastWinner = null;
    this.lastPoints = this.ids.map(() => 0);
    this.splashLine = '';
    this.twist = null;
    this.readyEndsAt = Date.now() + READY_S * 1000;
    this.acc = 0;
    this.lastTick = -1;
    [0, 1, 2].forEach((k) => window.setTimeout(() => this.sim.phase === 'ready' && sound.count(), (READY_S - 3 + k) * 1000));
    this.update();
  }

  private endRound(fresh: boolean) {
    if (this.overAt) return;
    const res = this.sim.result();
    this.lastPoints = res.points.map((pts, i) => (this.removed.has(i) ? 0 : pts));
    this.lastWinner = res.winner;
    this.ids.forEach((_, i) => (this.cup[i] += this.lastPoints[i]));
    this.overAt = Date.now() + (fresh ? BANNER_DELAY_MS : 0);
    sound.fanfare();
    if (res.winner !== null) this.host.buzz(this.ids[res.winner], [120, 60, 120, 60, 240]);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.round < this.rounds ? this.newRound() : this.finishGame()), OVER_S * 1000);
    this.update();
  }

  private finishGame() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.cup[i]));
    this.host.finish(out);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private name(i: number) {
    return this.host.player(this.ids[i])?.name ?? '?';
  }

  // ---- loop ----------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += elapsed;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.tick();
    }
    this.scene?.render(elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private tick() {
    const sim = this.sim;
    for (let i = 0; i < this.ids.length; i++) {
      const pad = this.input.pads[i];
      const p = sim.players[i];
      if (!p?.alive) {
        this.input.takePresses(i, 0);
        continue;
      }
      sim.setInput(i, pad.x, pad.y);
      const n = this.input.takePresses(i, 0);
      for (let k = 0; k < n; k++) sim.queueShove(i);
    }
    const ev = sim.step();
    if (ev.length > 0) this.events(ev);
    if (sim.phase === 'call') {
      const sec = Math.ceil(sim.callLeft);
      if (sec !== this.lastTick && sim.callLeft < 3.05) {
        this.lastTick = sec;
        sound.tick();
      }
    }
  }

  private events(evs: MEvent[]) {
    let refresh = false;
    for (const e of evs) {
      this.scene?.onEvent(e);
      switch (e.t) {
        case 'call': {
          sound.bell();
          this.lastTick = -1;
          this.splashLine = '';
          if (e.swap) {
            window.setTimeout(() => sound.reveal(), 120);
            this.twist = { text: 'The mushrooms swapped colours!', until: Date.now() + 2200 };
          } else if (e.twin !== null) {
            this.twist = { text: 'Two mushrooms are the same colour – either one is safe', until: Date.now() + 2400 };
          } else this.twist = null;
          refresh = true;
          break;
        }
        case 'sink': {
          sound.whoosh();
          window.setTimeout(() => e.fell.length > 0 && sound.plop(), 380);
          const names = e.fell.map((i) => this.name(i));
          this.splashLine = this.mergeSplash(names);
          for (const i of e.fell) this.host.buzz(this.ids[i], [200, 60, 120]);
          for (const i of this.sim.alive()) this.host.buzz(this.ids[i], [30]);
          refresh = true;
          break;
        }
        case 'fall':
          if (e.why === 'edge') {
            sound.plop();
            this.host.buzz(this.ids[e.p], [200, 60, 120]);
            this.splashLine = this.mergeSplash([this.name(e.p)]);
          }
          refresh = true;
          break;
        case 'shove':
          sound.whoosh();
          this.readyAt[e.p] = Date.now() + SHOVE_COOL * 1000;
          this.host.refresh(this.ids[e.p]);
          break;
        case 'hit':
          sound.crash();
          this.host.buzz(this.ids[e.b], [80, 30, 80]);
          this.host.buzz(this.ids[e.a], [35]);
          break;
        case 'rise':
          sound.lockIn();
          refresh = true;
          break;
        case 'over':
          this.endRound(e.fresh);
          refresh = true;
          break;
        case 'recolour':
          break;
      }
    }
    if (refresh) this.update();
  }

  /** "Splash! Kasia, Tomek" – shoved-in players and the sink's victims add up on one line. */
  private mergeSplash(names: string[]) {
    const have = this.splashLine.startsWith('Splash! ') && this.sim.phase !== 'gap' ? this.splashLine.slice(8).split(', ') : [];
    const all = [...have, ...names.filter((n) => !have.includes(n))];
    return all.length > 0 ? `Splash! ${all.join(', ')}` : '';
  }

  // ---- phones --------------------------------------------------------------------------

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
    const ev = this.sim.remove(i);
    if (this.ids.length - this.removed.size < 2) {
      clearTimeout(this.timer);
      this.finishGame();
      return;
    }
    if (ev.length > 0) this.events(ev);
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const sim = this.sim;
    const p = sim.players[i];
    const round = Math.max(1, this.round);
    const buttons = [{ label: 'Shove', ...(this.readyAt[i] ? { readyAt: this.readyAt[i], cool: SHOVE_COOL * 1000 } : {}) }];
    const alive = sim.alive().length;
    const stats = [
      ...(sim.callNo > 0 ? [{ k: 'Call', v: String(sim.callNo) }] : []),
      { k: 'Left', v: String(alive) },
    ];
    const base = { v: 'pad' as const, game: 'mushroom' as const, round, rounds: this.rounds, score: this.cup[i] ?? 0 };
    let view: PadView;
    if (!p || !p.present) {
      view = { ...base, phase: 'over', title: 'Removed', buttons: [], noStick: true };
    } else if (sim.phase === 'over') {
      const won = this.lastWinner === i;
      view = {
        ...base,
        phase: 'over',
        title: won ? 'You win the round!' : this.lastWinner === null ? 'It’s a tie!' : `${this.name(this.lastWinner)} wins!`,
        text: `+${this.lastPoints[i]} point${this.lastPoints[i] === 1 ? '' : 's'}`,
        accent: won ? GOLD : undefined,
        buttons: [],
        noStick: true,
        stats,
      };
    } else if (!p.alive) {
      view = { ...base, phase: 'out', title: 'Splash!', text: 'You’re in the pond', accent: '#4f9dff', buttons: [], noStick: true, stats };
    } else if (sim.phase === 'ready') {
      view = { ...base, phase: 'ready', title: 'Get ready!', text: 'Stay on the stump', buttons, stats };
    } else if (sim.phase === 'call') {
      const sp = SPECIES[sim.targetColour];
      view = { ...base, phase: 'play', title: `Run to ${sp.word}!`, text: sp.mushroom, accent: sp.hex, buttons, stats };
    } else if (sim.phase === 'sink' || sim.phase === 'rise') {
      view = { ...base, phase: 'play', title: 'Safe!', text: 'You’re dry. For now…', accent: '#2fd6a8', buttons, stats };
    } else {
      view = { ...base, phase: 'play', title: 'Get ready…', text: 'Next call coming up', buttons, stats };
    }
    return view;
  }

  // ---- TV ------------------------------------------------------------------------------

  render() {
    return <MushroomView game={this} />;
  }

  hud() {
    const sim = this.sim;
    const now = Date.now();
    const calling = sim.phase === 'call' || sim.phase === 'sink' || (sim.phase === 'rise' && sim.callNo > 0);
    const over = sim.phase === 'over' && this.overAt > 0 && now >= this.overAt;
    const live = this.ids.map((id, i) => ({ id, i, p: this.host.player(id) })).filter((r) => r.p && !this.removed.has(r.i));
    const winner = this.lastWinner !== null ? this.host.player(this.ids[this.lastWinner]) : null;
    return (
      <>
        <div class="mush-top">
          <div class="pill">
            Round {Math.max(1, this.round)} / {this.rounds}
          </div>
          {sim.callNo > 0 && <div class="pill">Call {sim.callNo}</div>}
          <div class="mush-rule">Get on the called colour · shove rivals off</div>
        </div>

        {sim.phase === 'ready' && <BigCountdown endsAt={this.readyEndsAt} key={`r${this.round}`} />}

        {!calling && sim.phase === 'gap' && sim.callNo > 0 && <div class="mush-wait">Next call coming…</div>}
        {sim.phase !== 'ready' && !over && this.splashLine && (
          <div class="mush-splash pop-in" key={this.splashLine}>
            {this.splashLine}
          </div>
        )}
        {this.twist && this.twist.until > now && sim.phase === 'call' && <div class="mush-twist pop-in">{this.twist.text}</div>}

        <div class="mush-chips">
          {live.map((r) => {
            const pl = sim.players[r.i];
            const out = !pl.alive && sim.phase !== 'ready';
            const color = colorHex(r.p!.color);
            return (
              <div class={`mush-chip ${out ? 'out' : ''} ${r.p!.connected ? '' : 'away'}`} style={{ '--pc': color }} key={r.id}>
                <Pierogi color={color} size={52} mood={out ? 'dead' : !r.p!.connected ? 'sleep' : sim.winner === r.i ? 'wow' : 'happy'} />
                <div class="mush-chip-text">
                  <span class="mush-chip-name">{r.p!.name}</span>
                  <span class="mush-chip-status">{out ? 'Splashed!' : sim.phase === 'over' && sim.winner === r.i ? 'Last one dry!' : 'In'}</span>
                </div>
                <b class="mush-chip-pts">{this.cup[r.i]}</b>
              </div>
            );
          })}
        </div>

        {over && (
          <div class="trails-banner pop-in mush-over">
            <div class="trails-banner-small">
              Round {this.round} of {this.rounds}
            </div>
            <div class="trails-banner-big" style={{ color: winner ? colorHex(winner.color) : GOLD }}>
              {winner ? `${winner.name} wins the round!` : 'Everyone splashed – a tie!'}
            </div>
            <div class="mush-points">
              {live
                .slice()
                .sort((a, b) => this.lastPoints[b.i] - this.lastPoints[a.i])
                .map((r) => (
                  <div class="mush-point" style={{ '--pc': colorHex(r.p!.color) }}>
                    <Pierogi color={colorHex(r.p!.color)} size={46} mood={this.lastWinner === r.i ? 'wow' : this.sim.players[r.i].alive ? 'happy' : 'dead'} />
                    <span class="mush-point-name">{r.p!.name}</span>
                    <b>+{this.lastPoints[r.i]}</b>
                  </div>
                ))}
            </div>
            <div class="muted mush-next">{this.round < this.rounds ? 'Next round coming up…' : 'That was the last round!'}</div>
          </div>
        )}
        {this.glError && <div class="mush-wait">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }
}

function MushroomView({ game }: { game: MushroomGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally mushroom">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
