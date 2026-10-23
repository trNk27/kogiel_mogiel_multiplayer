import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { BOULES_ENDS, BOULES_ENDS_SHORT, BoulesSim, DT, TURN_TIME, type BoulesEvent, type BoulesInput, type Measured } from './logic';
import { BoulesScene, type CamMode } from './scene';
import '../cookbook/cookbook.css';
import '../blast/blast.css';
import './boules.css';

const COUNTDOWN_MS = 3500;
/** The ref measures for this long before the banner. */
const MEASURE_MS = 4200;
const OVER_MS = 6500;
const HUD_MS = 120;

type Phase = 'ready' | 'play' | 'measure' | 'over';

interface Pop {
  text: string;
  x: number;
  z: number;
  color: string;
  until: number;
  key: number;
}

export class BoulesGame implements Game {
  readonly id = 'boules' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: BoulesSim;
  readonly input: ArenaInput;
  scores: number[];
  roundPts: number[];
  ranked: Measured[] = [];
  goAt = 0;
  phaseAt = 0;
  pops: Pop[] = [];
  readonly removed = new Set<number>();
  private popKey = 0;
  private scene: BoulesScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private timers: number[] = [];
  /** The power meter's fill, updated every frame without re-rendering the HUD. */
  meterFill: HTMLDivElement | null = null;
  /** The last ball touched the jack (for "Kiss!"). */
  private kissed = false;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? BOULES_ENDS_SHORT : BOULES_ENDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, BoulesGame>).boules = this;
    this.newEnd();
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
      this.scene = new BoulesScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
      );
      this.scene.reset(this.sim, [...this.removed]);
    } catch (err) {
      console.error(err);
      this.glError = true;
      this.host.changed();
    }
  }

  detach() {
    this.scene?.dispose();
    this.scene = null;
    this.meterFill = null;
  }

  // ---- end flow ----------------------------------------------------------------------------------

  private newEnd() {
    this.round++;
    this.input.release();
    this.sim = new BoulesSim(
      this.ids.length,
      this.round - 1,
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
    );
    this.scene?.reset(this.sim, [...this.removed]);
    this.roundPts = this.ids.map(() => 0);
    this.ranked = [];
    this.pops = [];
    this.phase = 'ready';
    this.phaseAt = performance.now();
    this.goAt = Date.now() + COUNTDOWN_MS;
    sound.whoosh();
    [COUNTDOWN_MS - 3000, COUNTDOWN_MS - 2000, COUNTDOWN_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && sound.count()));
    this.later(COUNTDOWN_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      sound.go();
      this.handle(this.sim.begin(), performance.now());
      this.update();
    });
    this.update();
  }

  private measure() {
    if (this.phase !== 'play') return;
    const r = this.sim.results();
    this.phase = 'measure';
    this.phaseAt = performance.now();
    this.ranked = r.ranked;
    this.roundPts = r.points.map((p, i) => (this.removed.has(i) ? 0 : p));
    sound.drumroll(1.6);
    this.later(1700, () => this.phase === 'measure' && sound.reveal());
    this.later(MEASURE_MS, () => this.endOver());
    this.update();
  }

  private endOver() {
    if (this.phase !== 'measure') return;
    this.roundPts.forEach((p, i) => (this.scores[i] += p));
    this.phase = 'over';
    this.phaseAt = performance.now();
    sound.fanfare();
    this.scene?.cheer();
    this.later(OVER_MS, () => (this.round < this.rounds ? this.newEnd() : this.finish()));
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

  /** The power meter follows the charge every frame (replayed on second screens, see host/caster.ts). */
  paintMeter() {
    if (this.meterFill) this.meterFill.style.height = `${Math.round(this.sim.power * 100)}%`;
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += elapsed;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.tick(now);
    }
    this.scene?.render(this.sim, this.camMode(), elapsed, {
      thrower: this.sim.thrower,
      gone: [...this.removed],
      measured: this.phase === 'measure' || this.phase === 'over' ? this.ranked.slice(0, 3).map((m) => m.b) : [],
    });
    this.paintMeter();
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private camMode(): CamMode {
    if (this.phase === 'ready') return 'intro';
    if (this.phase === 'measure' || this.phase === 'over') return 'measure';
    switch (this.sim.phase) {
      case 'aim':
        return 'aim';
      case 'flight':
        return 'flight';
      default:
        return 'judge';
    }
  }

  private tick(now: number) {
    const ins: BoulesInput[] = this.ids.map((id, i) => {
      const pad = this.input.pads[i];
      const presses = this.input.takePresses(i, 0);
      this.input.takePresses(i, 1);
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected;
      return { x: live ? pad.x : 0, held: live && pad.held[0], presses: live ? presses : 0, live };
    });
    if (this.phase !== 'play') return;
    const events = this.sim.step(ins);
    if (events.length) this.handle(events, now);
  }

  private pop(text: string, x: number, z: number, color: string, now: number, ms = 1500) {
    this.pops.push({ text, x, z, color, until: now + ms, key: ++this.popKey });
    if (this.pops.length > 8) this.pops.shift();
  }

  private handle(events: BoulesEvent[], now: number) {
    const sim = this.sim;
    for (const e of events) {
      switch (e.t) {
        case 'turn':
          sound.bell();
          this.kissed = false;
          this.host.buzz(this.ids[e.i], [60, 40, 60]);
          this.update();
          break;
        case 'charge':
          sound.tick();
          break;
        case 'throw':
          this.scene?.thrown(e.i);
          sound.whoosh();
          if (e.auto) this.pop(this.host.player(this.ids[e.i] ?? '')?.connected ? 'Too slow!' : 'Auto throw', 0, -1.2, '#fff4dc', now);
          this.update();
          break;
        case 'land': {
          const b = sim.balls[e.b];
          this.scene?.landed(e.x, e.z);
          sound.hiss(0.18, 0.18);
          sound.note(150, 0.12, { type: 'triangle', vol: 0.35 });
          if (b && b.out === undefined && e.z < -15) this.pop('Too far!', e.x, e.z, '#ff7a8a', now);
          break;
        }
        case 'hit': {
          this.scene?.hit(e.x, e.z, e.j, e.jack);
          const vol = Math.min(0.4, 0.06 + e.j * 0.08);
          if (e.jack) {
            sound.note(880, 0.1, { type: 'triangle', vol });
            if (e.j < 0.6) this.kissed = true;
            else this.pop('The pierożek moves!', e.x, e.z, '#ffd23f', now);
          } else {
            sound.note(1900, 0.06, { type: 'square', vol: vol * 0.6 });
            sound.note(2700, 0.09, { type: 'triangle', vol, delay: 0.01 });
            if (e.j > 1.6) {
              this.pop('Bang!', e.x, e.z, '#fff4dc', now);
              this.scene?.cheer();
            }
          }
          break;
        }
        case 'board':
          sound.note(190, 0.08, { type: 'square', vol: Math.min(0.3, 0.05 + e.v * 0.05) });
          break;
        case 'dead': {
          const b = sim.balls[e.b];
          this.scene?.died(e.x, e.z);
          sound.wrong();
          this.pop('Dead ball!', e.x, Math.max(-14.6, e.z), b ? colorHex(this.host.player(this.ids[b.owner] ?? '')?.color ?? 'sourcream') : '#fff', now, 1800);
          break;
        }
        case 'settled': {
          const b = sim.current >= 0 ? sim.balls[sim.current] : undefined;
          if (b && b.alive) {
            const d = Math.hypot(b.x - sim.jack.x, b.z - sim.jack.z) - b.r - sim.jack.r;
            if (this.kissed || d < 0.05) {
              this.pop('Kiss!', b.x, b.z, '#ff7ad1', now, 1800);
              sound.correct();
              this.scene?.cheer(b.owner);
            } else if (d < 0.25) {
              this.pop('Close!', b.x, b.z, '#2fd6a8', now);
              sound.pickup();
            }
          }
          this.update();
          break;
        }
        case 'over':
          this.measure();
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
    this.scene?.hide(i);
    if (this.removed.size >= this.ids.length) {
      this.host.finish({});
      return;
    }
    const ev = this.sim.remove(i);
    this.roundPts[i] = 0;
    this.ranked = this.ranked.filter((m) => m.owner !== i);
    if (ev.length && this.phase === 'play') this.handle(ev, performance.now());
    this.update();
  }

  private name(i: number) {
    return this.host.player(this.ids[i] ?? '')?.name ?? '?';
  }

  private dots(i: number) {
    const left = this.sim.ballsLeft(i);
    return left > 0 ? '●'.repeat(left) : '–';
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const sim = this.sim;
    const base = { v: 'pad' as const, game: 'boules' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    const stats = [{ k: 'Balls', v: this.dots(i) }];
    if (this.phase === 'ready') {
      return { ...base, phase: 'ready', title: `End ${this.round} of ${this.rounds}`, text: 'The ref tosses out the pierożek…', buttons: [], noStick: true, stats };
    }
    if (this.phase === 'measure' || this.phase === 'over') {
      const pts = this.roundPts[i] ?? 0;
      const best = this.ranked.find((m) => m.owner === i);
      return {
        ...base,
        phase: 'over',
        title: this.phase === 'measure' ? 'Measuring…' : pts > 0 ? `+${pts} this end!` : 'No points this end',
        text: best ? `Your closest ball: ${best.cm} cm` : 'No ball left on the pitch',
        accent: this.phase === 'over' && pts > 0 ? '#ffc93c' : undefined,
        buttons: [],
        noStick: true,
      };
    }
    const cur = sim.thrower;
    if (cur === i && sim.phase === 'aim') {
      return {
        ...base,
        phase: 'play',
        title: 'Your throw!',
        text: 'Aim with the stick, hold THROW, let go',
        accent: '#ffd23f',
        buttons: [{ label: 'Throw', color: '#ffd23f' }],
        stats,
      };
    }
    if (cur === i) return { ...base, phase: 'play', title: 'Rolling…', text: 'Watch your ball on the TV', buttons: [], noStick: true, stats };
    const next = sim.turnsUntil(i);
    return {
      ...base,
      phase: 'play',
      title: cur >= 0 ? `${this.name(cur)} is throwing` : 'Wait for it…',
      text: next === 1 ? 'You’re next! Watch the TV' : 'Watch the TV',
      buttons: [],
      noStick: true,
      stats,
    };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <BoulesView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const cur = sim.thrower;
    const curP = cur >= 0 ? players[cur] : undefined;
    const aiming = this.phase === 'play' && sim.phase === 'aim';
    const measuring = this.phase === 'measure' || this.phase === 'over';
    this.pops = this.pops.filter((p) => p.until > now);
    return (
      <>
        <div class="cookbook-top">
          <span class="pill">
            End {this.round} / {this.rounds}
          </span>
          <span class="cookbook-rule">{sim.solo ? 'Under 30 cm 3 · under 80 cm 2 · under 150 cm 1' : 'Closest three balls to the pierożek: 3 · 2 · 1'}</span>
        </div>
        {curP && this.phase === 'play' && (
          <div class="blast-turn boules-turn" style={{ '--pc': colorHex(curP.color) }} key={`t${this.round}-${sim.cursor}`}>
            <Pierogi color={colorHex(curP.color)} size={64} mood={sim.phase === 'flight' ? 'wow' : 'happy'} />
            <span>
              <b>{curP.name}</b>
              <small>{sim.phase === 'flight' ? 'there it goes…' : `ball ${sim.ballNo + 1} of ${sim.ballsEach}${curP.connected ? '' : ' · offline'}`}</small>
            </span>
            {aiming && (
              <div class="blast-timer">
                <div style={{ width: `${(sim.turnLeft / TURN_TIME) * 100}%` }} />
              </div>
            )}
          </div>
        )}
        {aiming && curP && (
          <div class={`boules-meter ${sim.charging ? 'on' : ''}`} style={{ '--pc': colorHex(curP.color) }}>
            <small>Power</small>
            <div class="boules-meter-bar">
              <div class="boules-meter-fill" ref={(el) => { this.meterFill = el; }} />
            </div>
            <small>{sim.charging ? 'let go!' : 'hold THROW'}</small>
          </div>
        )}
        {this.pops.map((p) => {
          const at = this.scene?.toStage(p.x, 0.9, p.z);
          if (!at || !at.visible) return null;
          return (
            <div class="boules-pop" key={p.key} style={{ left: at.x, top: at.y, '--pc': p.color }}>
              {p.text}
            </div>
          );
        })}
        {measuring &&
          this.ranked.slice(0, sim.solo ? 3 : 3).map((m) => {
            const b = sim.balls[m.b];
            const p = players[m.owner];
            if (!b || !p) return null;
            const at = this.scene?.toStage(b.x, 0.55, b.z);
            if (!at || !at.visible) return null;
            return (
              <div class={`boules-measure ${m.pts > 0 ? '' : 'none'}`} key={`m${m.b}`} style={{ left: at.x, top: at.y, '--pc': colorHex(p.color) }}>
                <b>{m.place}</b>
                {m.cm} cm
              </div>
            );
          })}
        <div class="cookbook-chips">
          {this.ids.map((_, i) => {
            const p = players[i];
            if (!p || this.removed.has(i)) return null;
            const left = sim.ballsLeft(i);
            return (
              <div class={`cookbook-chip ${i === cur ? 'blast-now' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={p.connected ? (i === cur ? 'wow' : 'happy') : 'sleep'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>
                    <span class="boules-balls">{Array.from({ length: sim.ballsEach }, (_, k) => (k < left ? '●' : '○')).join('')}</span> {this.phase === 'over' ? `+${this.roundPts[i]} · ${this.scores[i]}` : this.scores[i]} pts
                  </small>
                </span>
              </div>
            );
          })}
        </div>
        {this.phase === 'ready' && now - this.phaseAt > 0 && (
          <div class="boules-intro pop-in" key={`i${this.round}`}>
            <small>{this.round === this.rounds ? (this.rounds > 1 ? 'Last end' : 'One end') : `End ${this.round} of ${this.rounds}`}</small>
            <b>{curOrFirst(this, players)}</b>
          </div>
        )}
        {this.phase === 'ready' && <BigCountdown key={this.goAt} endsAt={this.goAt} />}
        {this.phase === 'measure' && <div class="boules-measuring">The ref measures…</div>}
        {this.phase === 'over' && this.banner(players)}
        {this.glError && <div class="trails-banner">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  private banner(players: ReturnType<GameHost['player']>[]) {
    const sim = this.sim;
    const live = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i));
    const order = [...live].sort((a, b) => this.roundPts[b] - this.roundPts[a] || this.scores[b] - this.scores[a]);
    const top = Math.max(0, ...live.map((i) => this.roundPts[i]));
    const winners = top > 0 ? live.filter((i) => this.roundPts[i] === top) : [];
    let big: string;
    if (sim.solo) big = top > 0 ? `${top} point${top === 1 ? '' : 's'}!` : 'No points this time';
    else if (winners.length === 1) big = `${this.name(winners[0])} takes the end!`;
    else if (winners.length > 1) big = `A tie: ${winners.map((i) => this.name(i)).join(' & ')}`;
    else big = 'Nobody scores!';
    const closest = this.ranked[0];
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          End {this.round} of {this.rounds}
          {closest ? ` · closest ball ${closest.cm} cm (${this.name(closest.owner)})` : ' · every ball went dead'}
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
        <div class="cookbook-banner-list">
          {order.map((i) => {
            const p = players[i];
            const best = this.ranked.find((m) => m.owner === i);
            return p ? (
              <div class={`cookbook-banner-row ${winners.includes(i) ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={38} mood={winners.includes(i) ? 'wow' : 'happy'} />
                <span class="grow">{p.name}</span>
                <small class="boules-best">{best ? `${best.cm} cm` : 'no ball'}</small>
                <b>+{this.roundPts[i]}</b>
              </div>
            ) : null;
          })}
        </div>
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'The ref picks up the pierożek…' : 'That was the last end!'}</div>
      </div>
    );
  }
}

/** Who opens the end. */
function curOrFirst(game: BoulesGame, players: ReturnType<GameHost['player']>[]) {
  const first = game.sim.order.find((t) => !game.removed.has(t.i));
  const p = first ? players[first.i] : undefined;
  return p ? `${p.name} throws first` : 'Ready?';
}

function BoulesView({ game }: { game: BoulesGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook blast boules">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
