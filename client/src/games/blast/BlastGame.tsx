import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { BLAST_ROUNDS, BLAST_ROUNDS_SHORT, BlastSim, DT, FUSE_TIME, type BlastEvent, type BlastInput } from './logic';
import { BlastScene } from './scene';
import '../cookbook/cookbook.css';
import './blast.css';

const COUNTDOWN_MS = 3500;
const OVER_MS = 6500;
/** The banner waits for the blasted pierogi to land. */
const BANNER_DELAY_MS = 2600;
const HUD_MS = 120;

type Phase = 'ready' | 'play' | 'over';

export class BlastGame implements Game {
  readonly id = 'blast' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: BlastSim;
  readonly input: ArenaInput;
  scores: number[];
  roundPts: number[];
  winners: number[] = [];
  goAt = 0;
  overAt = 0;
  /** performance.now() of the last dud and the last blast, for the TV's pop-ups. */
  phewAt = -1e9;
  boomAt = -1e9;
  lastPusher = -1;
  readonly removed = new Set<number>();
  private scene: BlastScene | null = null;
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
    this.rounds = host.short ? BLAST_ROUNDS_SHORT : BLAST_ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, BlastGame>).blast = this;
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
      this.scene = new BlastScene(
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
    this.sim = new BlastSim(
      this.ids.length,
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
    );
    this.scene?.reset(this.sim);
    this.roundPts = this.ids.map(() => 0);
    this.winners = [];
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
    this.later(BANNER_DELAY_MS + OVER_MS, () => (this.round < this.rounds ? this.newRound() : this.finish()));
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
    const ins: BlastInput[] = this.ids.map((id, i) => {
      const pad = this.input.pads[i];
      const push = this.input.takePresses(i, 0);
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected;
      return { x: live ? pad.x : 0, push: live ? push : 0, live };
    });
    const events = this.sim.step(ins);
    if (events.length) this.handle(events, now);
  }

  private handle(events: BlastEvent[], now: number) {
    for (const e of events) {
      switch (e.t) {
        case 'set':
          sound.reveal();
          this.update();
          break;
        case 'turn':
          sound.bell();
          this.host.buzz(this.ids[e.i], [60, 40, 60]);
          this.update();
          break;
        case 'move':
          sound.tick();
          break;
        case 'push':
          this.lastPusher = e.i;
          this.scene?.pushed(e.plunger);
          sound.plop();
          sound.drumroll(FUSE_TIME);
          this.update();
          break;
        case 'safe':
          this.phewAt = now;
          this.scene?.fizzled(e.plunger);
          sound.correct();
          this.host.buzz(this.ids[e.i], [30]);
          this.update();
          break;
        case 'boom':
          this.boomAt = now;
          this.scene?.boom(e.i);
          sound.crash();
          this.later(90, () => sound.crash());
          this.later(400, () => sound.wrong());
          this.host.buzz(this.ids[e.i], [400, 80, 250]);
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

  private name(i: number) {
    return this.host.player(this.ids[i] ?? '')?.name ?? '?';
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.sim.players[i];
    const sim = this.sim;
    const base = { v: 'pad' as const, game: 'blast' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    const stats = sim.set ? [{ k: 'Plungers', v: `${sim.left} left` }] : undefined;
    if (this.phase === 'ready') {
      return { ...base, phase: 'ready', title: 'Get ready!', text: 'One plunger sets off the big one', buttons: [], noStick: true };
    }
    if (this.phase === 'over') {
      const pts = this.roundPts[i] ?? 0;
      const won = this.winners.includes(i);
      return {
        ...base,
        phase: 'over',
        title: won ? (this.winners.length > 1 ? 'A tie for first!' : 'Last one standing!') : 'Round over',
        text: `+${pts} point${pts === 1 ? '' : 's'}`,
        accent: won ? '#ffc93c' : undefined,
        buttons: [],
        noStick: true,
      };
    }
    if (!p || !p.alive) {
      return { ...base, phase: 'out', title: 'Blasted!', text: 'Watch the fireworks on the TV', accent: '#ff7a8a', buttons: [], noStick: true, stats };
    }
    const cur = sim.current;
    if (cur === i && sim.phase === 'choose') {
      return {
        ...base,
        phase: 'play',
        title: 'Your turn!',
        text: '◀ ▶ pick a plunger · then Push',
        accent: '#ffd23f',
        buttons: [{ label: 'Push!', color: '#e8335a' }],
        stats,
      };
    }
    if (cur === i && sim.phase === 'fuse') {
      return { ...base, phase: 'play', title: 'Fingers crossed…', text: 'The spark is on its way', buttons: [], noStick: true, stats };
    }
    if (cur === i && sim.phase === 'safe') {
      return { ...base, phase: 'play', title: 'Phew! A dud.', text: 'You’re safe this time', accent: '#2fd6a8', buttons: [], noStick: true, stats };
    }
    const order = sim.order;
    const mine = order.indexOf(i);
    const wait = mine > sim.turn ? mine - sim.turn : -1;
    return {
      ...base,
      phase: 'play',
      title: cur >= 0 ? `${this.name(cur)}’s turn` : 'New plungers…',
      text: wait === 1 ? 'You’re next!' : wait > 1 ? `You go in ${wait} turns` : 'You’ve pushed this set – phew',
      buttons: [],
      noStick: true,
      stats,
    };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <BlastView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const cur = sim.current;
    const curP = cur >= 0 ? players[cur] : undefined;
    const boom = now - this.boomAt < 1500;
    const phew = now - this.phewAt < 1100;
    const left = sim.phase === 'choose' ? Math.max(0, sim.turnTime - sim.phaseT) : 0;
    const pusher = this.lastPusher >= 0 ? sim.players[this.lastPusher] : undefined;
    const phewAt = phew && this.scene && pusher ? this.scene.toStage(this.scene.plungerTop(sim.cursor).x, 3.2, 1.3) : null;
    return (
      <>
        <div class="cookbook-top blast-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          {sim.set > 0 && (
            <span class="pill blast-set">
              {sim.left} of {sim.plungers.length} plungers left
            </span>
          )}
          <span class="cookbook-rule">One of them is live!</span>
        </div>
        {curP && (sim.phase === 'choose' || sim.phase === 'fuse') && (
          <div class="blast-turn" style={{ '--pc': colorHex(curP.color) }} key={`t${sim.set}-${sim.turn}`}>
            <Pierogi color={colorHex(curP.color)} size={64} mood={sim.phase === 'fuse' ? 'wow' : 'happy'} />
            <span>
              <b>{curP.name}</b>
              <small>{sim.phase === 'fuse' ? 'pushed it…' : 'picks a plunger'}</small>
            </span>
            {sim.phase === 'choose' && (
              <div class="blast-timer">
                <div style={{ width: `${(left / sim.turnTime) * 100}%` }} />
              </div>
            )}
          </div>
        )}
        {boom && (
          <>
            <div class="cookbook-flash blast-flash" key={`f${this.boomAt}`} />
            <div class="blast-boom" key={`b${this.boomAt}`}>
              BUM!
            </div>
          </>
        )}
        {phewAt && (
          <div class="blast-phew" key={`p${this.phewAt}`} style={{ left: phewAt.x, top: phewAt.y }}>
            Phew!
          </div>
        )}
        <div class="cookbook-chips">
          {this.ids.map((_, i) => {
            const p = players[i];
            const a = sim.players[i];
            if (!p || !a || this.removed.has(i)) return null;
            const out = !a.alive;
            return (
              <div class={`cookbook-chip ${out ? 'out' : ''} ${i === cur ? 'blast-now' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={out ? 'dead' : p.connected ? 'happy' : 'sleep'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{this.phase === 'over' ? `+${this.roundPts[i]} · ${this.scores[i]} total` : out ? 'Blasted!' : `${this.scores[i]} pts`}</small>
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
    const order = this.ids
      .map((_, i) => i)
      .filter((i) => !this.removed.has(i))
      .sort((a, b) => this.roundPts[b] - this.roundPts[a]);
    const big = this.winners.length === 1 ? `${name(this.winners[0])} survives!` : this.winners.length > 1 ? `A tie: ${this.winners.map(name).join(' & ')}` : 'Round over';
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {this.sim.set} firecracker{this.sim.set === 1 ? '' : 's'} went off
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
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'Setting up new plungers…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function BlastView({ game }: { game: BlastGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook blast">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
