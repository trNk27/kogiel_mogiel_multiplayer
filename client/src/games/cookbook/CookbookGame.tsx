import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { COOKBOOK_ROUNDS, COOKBOOK_ROUNDS_SHORT, CookbookSim, DASH_COOL, DT, MAX_PAGES, type PadIn, type SimEvent } from './logic';
import { CookbookScene } from './scene';
import './cookbook.css';

const COUNTDOWN_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 6500;
/** The banner waits for the squash animation to finish. */
const BANNER_DELAY_MS = 1400;
const HUD_MS = 150;
const THWUMP_MS = 900;

type Phase = 'ready' | 'play' | 'over';

interface Splat {
  idx: number;
  until: number;
  key: number;
}

export class CookbookGame implements Game {
  readonly id = 'cookbook' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: CookbookSim;
  readonly input: ArenaInput;
  /** Total points per player index. */
  scores: number[];
  roundPts: number[];
  winners: number[] = [];
  /** Date.now() when the countdown ends. */
  goAt = 0;
  overAt = 0;
  lastLand = 0;
  lastLandPage = 0;
  splats: Splat[] = [];
  readonly removed = new Set<number>();
  private scene: CookbookScene | null = null;
  private glError = false;
  private dashWall: number[];
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? COOKBOOK_ROUNDS_SHORT : COOKBOOK_ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
    this.dashWall = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, CookbookGame>).cookbook = this;
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

  /** Called by the view once its canvas exists. */
  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new CookbookScene(
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
    this.sim = new CookbookSim(
      this.ids.length,
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
    );
    this.scene?.reset(this.sim);
    this.roundPts = this.ids.map(() => 0);
    this.winners = [];
    this.splats = [];
    this.dashWall = this.ids.map(() => 0);
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
    const ins: PadIn[] = this.ids.map((id, i) => {
      const pad = this.input.pads[i];
      const dash = this.input.takePresses(i, 0);
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected;
      if (!live) return { x: 0, z: 0, dash: 0 };
      return { x: pad.x, z: pad.y, dash: this.phase === 'ready' ? 0 : dash };
    });
    const events = this.sim.step(ins);
    if (events.length) this.handle(events, now);
  }

  private handle(events: SimEvent[], now: number) {
    for (const e of events) {
      switch (e.t) {
        case 'page':
          sound.whoosh();
          this.update();
          break;
        case 'dash':
          this.dashWall[e.i] = Date.now() + DASH_COOL * 1000;
          this.scene?.dashed(e.i);
          sound.tick();
          this.host.refresh(this.ids[e.i]);
          break;
        case 'bump':
          sound.plop();
          this.host.buzz(this.ids[e.i], [30]);
          break;
        case 'land':
          this.lastLand = now;
          this.lastLandPage = e.n;
          this.scene?.landed(e.squashed, e.survivors);
          sound.crash();
          for (const i of e.squashed) {
            this.host.buzz(this.ids[i], [220, 50, 140]);
            this.splats.push({ idx: i, until: now + 1800, key: e.n * 100 + i });
          }
          if (e.squashed.length) this.later(120, () => sound.wrong());
          for (const i of e.survivors) this.host.buzz(this.ids[i], [30]);
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
    const dash: PadButton = { label: 'Dash' };
    if (this.phase === 'ready') dash.off = true;
    else if (this.dashWall[i] > Date.now()) {
      dash.readyAt = this.dashWall[i];
      dash.cool = DASH_COOL * 1000;
    }
    const base = { v: 'pad' as const, game: 'cookbook' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    if (this.phase === 'ready') {
      return { ...base, phase: 'ready', title: 'Get ready!', text: 'Stand in a hole when the page comes down.', buttons: [dash] };
    }
    if (this.phase === 'over') {
      const pts = this.roundPts[i] ?? 0;
      const won = this.winners.includes(i);
      return {
        ...base,
        phase: 'over',
        title: this.sim.solo ? `${pts} page${pts === 1 ? '' : 's'}!` : won ? (this.winners.length > 1 ? 'A tie for first!' : 'You win the round!') : 'Round over',
        text: this.sim.solo ? 'That is how many you survived.' : `+${pts} point${pts === 1 ? '' : 's'}`,
        accent: won ? '#ffc93c' : undefined,
        buttons: [],
        noStick: true,
      };
    }
    if (!p || !p.alive) {
      return { ...base, phase: 'out', title: 'Squashed!', text: 'Watch the TV', accent: '#ff7a8a', buttons: [], noStick: true };
    }
    return {
      ...base,
      phase: 'play',
      title: this.sim.page.n >= MAX_PAGES ? 'Last page – find a hole!' : `Page ${this.sim.page.n} – find a hole!`,
      text: 'Run into a lit patch. Dash to hurry or to shove.',
      buttons: [dash],
    };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <CookbookView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const thump = now - this.lastLand < THWUMP_MS;
    const book = this.scene?.toStage(8, 0.5, 0);
    return (
      <>
        <div class="cookbook-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          <span class="pill cookbook-page">{sim.page.n >= MAX_PAGES ? 'Last page!' : `Page ${sim.page.n}`}</span>
          <span class="cookbook-rule">Stand in a hole when the page comes down!</span>
        </div>
        {thump && (
          <>
            <div class="cookbook-flash" key={`f${this.lastLand}`} />
            <div class="cookbook-thwump" key={`t${this.lastLand}`} style={book ? { left: book.x, top: book.y - 150 } : undefined}>
              THWUMP!
            </div>
          </>
        )}
        {this.splats.map((s) => {
          const p = players[s.idx];
          const a = sim.players[s.idx];
          if (!p || !a || s.until < now) return null;
          const at = this.scene?.toStage(a.x, 1.6, a.z);
          if (!at) return null;
          return (
            <div class="cookbook-splat" key={s.key} style={{ left: at.x, top: at.y, '--pc': colorHex(p.color) }}>
              Squashed!
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
              <div class={`cookbook-chip ${out ? 'out' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={46} mood={out ? 'dead' : p.connected ? 'happy' : 'sleep'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>
                    {this.phase === 'over'
                      ? `+${this.roundPts[i]} · ${this.scores[i]} total`
                      : out
                        ? `Squashed · page ${a.outPage}`
                        : `Still standing · ${this.scores[i]} pts`}
                  </small>
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
    if (sim.solo) big = `${this.roundPts[order[0]] ?? 0} page${this.roundPts[order[0]] === 1 ? '' : 's'} survived!`;
    else if (this.winners.length === 1) big = `${name(this.winners[0])} wins the round!`;
    else if (this.winners.length > 1) big = `A tie: ${this.winners.map(name).join(' & ')}`;
    else big = 'Round over';
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {sim.landed} page{sim.landed === 1 ? '' : 's'} came down{sim.landed >= MAX_PAGES ? ' · that was the last page!' : ''}
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
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'Next page turner coming up…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function CookbookView({ game }: { game: CookbookGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
