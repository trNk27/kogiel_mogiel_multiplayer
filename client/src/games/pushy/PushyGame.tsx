import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { BIG_BUMP, BRACE_COOL_MS, DT, PUSHY_ROUNDS, PUSHY_ROUNDS_SHORT, PushySim, SHOVE_COOL_MS, type PushyEvent } from './logic';
import { ARENA_SCALE, PushyScene } from './scene';
import './pushy.css';

const READY_MS = 3500;
/** After the round is decided, the camera lingers this long before the banner. */
const SETTLE_MS = 1700;
const BANNER_MS = 5500;
const HUD_MS = 200;
const BRACE_BLUE = '#4f9dff';

type Phase = 'ready' | 'play' | 'settle' | 'over';

interface Label {
  text: string;
  x: number;
  y: number;
  until: number;
  color: string;
}

export class PushyGame implements Game {
  readonly id = 'pushy' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: PushySim;
  /** Date.now() when the countdown ends. */
  goAt = 0;
  scores: number[];
  lastPts: number[];
  private input: ArenaInput;
  private removed = new Set<number>();
  private scene: PushyScene | null = null;
  glError = false;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private timers: number[] = [];
  /** Host-clock ms until which each button is cooling down. */
  private shoveUntil: number[];
  private braceUntil: number[];
  private labels: Label[] = [];
  private notice: { text: string; until: number } | null = null;
  private lastBump = 0;
  private winners: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? PUSHY_ROUNDS_SHORT : PUSHY_ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.lastPts = ids.map(() => 0);
    this.shoveUntil = ids.map(() => 0);
    this.braceUntil = ids.map(() => 0);
  }

  start() {
    // For automated tests: /?debug exposes the running game.
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, PushyGame>).pushy = this;
    this.newRound();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    cancelAnimationFrame(this.raf);
    this.detach();
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new PushyScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
      );
      this.scene.setup(this.sim);
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

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  // ---- round flow ------------------------------------------------------------------------------

  private newRound() {
    this.round++;
    this.sim = new PushySim(
      this.ids.length,
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
    );
    this.input.release();
    this.scene?.setup(this.sim);
    this.phase = 'ready';
    this.goAt = Date.now() + READY_MS;
    this.shoveUntil = this.ids.map(() => 0);
    this.braceUntil = this.ids.map(() => 0);
    this.labels = [];
    this.notice = null;
    this.winners = [];
    this.lastPts = this.ids.map(() => 0);
    [READY_MS - 3000, READY_MS - 2000, READY_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && sound.count()));
    this.later(READY_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      this.sim.start();
      sound.go();
      this.update();
    });
    this.update();
  }

  private endPlay() {
    if (this.phase !== 'play') return;
    this.phase = 'settle';
    const pts = this.sim.points();
    this.winners = [...this.sim.winners];
    this.lastPts = pts;
    pts.forEach((p, i) => (this.scores[i] += p));
    this.update();
    this.later(SETTLE_MS, () => {
      this.phase = 'over';
      sound.fanfare();
      for (const w of this.winners) this.host.buzz(this.ids[w], [120, 60, 120, 60, 240]);
      this.update();
      this.later(BANNER_MS, () => (this.round < this.rounds ? this.newRound() : this.finish()));
    });
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => {
      if (!this.removed.has(i)) out[id] = this.scores[i];
    });
    this.host.finish(out);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- loop ---------------------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += elapsed;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.tick();
    }
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private tick() {
    const sim = this.sim;
    const evs: PushyEvent[] = [];
    this.ids.forEach((id, i) => {
      if (this.removed.has(i)) return;
      const pad = this.input.pads[i];
      sim.setStick(i, pad.x, pad.y);
      const sh = this.input.takePresses(i, 0);
      const br = this.input.takePresses(i, 1);
      if (this.phase !== 'play') return;
      if (sh > 0 && sim.shove(i, evs)) {
        this.shoveUntil[i] = Date.now() + SHOVE_COOL_MS;
        this.host.refresh(id);
      }
      if (br > 0 && sim.brace(i, evs)) {
        this.braceUntil[i] = Date.now() + BRACE_COOL_MS;
        this.host.refresh(id);
      }
    });
    evs.push(...sim.step());
    if (evs.length) {
      this.react(evs);
      this.scene?.handle(evs, sim);
    }
    if (sim.over && this.phase === 'play') this.endPlay();
  }

  /** Sounds, buzzes, labels for what just happened. */
  private react(evs: PushyEvent[]) {
    const now = performance.now();
    for (const e of evs) {
      switch (e.k) {
        case 'bump':
          if (e.power >= BIG_BUMP || e.dash) {
            if (now - this.lastBump > 90) {
              this.lastBump = now;
              if (e.power > 7 || e.dash) sound.crash();
              else sound.plop();
            }
            for (const i of [e.a, e.b]) this.host.buzz(this.ids[i], [Math.min(90, 25 + e.power * 6)]);
          }
          break;
        case 'stoneHit':
          sound.crash();
          this.host.buzz(this.ids[e.i], [150, 50, 90]);
          break;
        case 'shove':
          sound.whoosh();
          break;
        case 'brace':
          sound.lockIn();
          this.host.buzz(this.ids[e.i], [30]);
          break;
        case 'crack':
          sound.tick();
          if (!this.notice || this.notice.until < performance.now()) this.say('The ice is cracking!', 2200);
          break;
        case 'break':
          sound.plop();
          break;
        case 'fall': {
          this.host.buzz(this.ids[e.i], [220, 80, 220]);
          this.host.refresh(this.ids[e.i]);
          break;
        }
        case 'splash': {
          sound.plop();
          window.setTimeout(() => sound.plop(), 110);
          const p = this.host.player(this.ids[e.i]);
          const s = this.scene?.labelAt(e.x, 0.8, e.z);
          if (s) this.labels.push({ text: 'Splash!', x: s.x, y: s.y, until: now + 1500, color: colorHex(p?.color ?? 'sourcream') });
          break;
        }
        case 'warn':
          sound.bell();
          this.say('Curling stone incoming!', 2000);
          break;
        case 'launch':
          sound.whoosh();
          break;
      }
    }
  }

  private say(text: string, ms: number) {
    this.notice = { text, until: performance.now() + ms };
  }

  // ---- phones ----------------------------------------------------------------------------------------

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
    if (this.ids.length - this.removed.size < 2) {
      this.finish();
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.sim?.players[i];
    const now = Date.now();
    const base = { v: 'pad' as const, game: 'pushy' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    const cd = (until: number, cool: number): Pick<PadButton, 'readyAt' | 'cool'> => (until > now ? { readyAt: until, cool } : { cool });
    const buttons = (off: boolean): PadButton[] => [
      { label: 'Shove', ...cd(this.shoveUntil[i] ?? 0, SHOVE_COOL_MS), ...(off ? { off: true } : {}) },
      { label: 'Brace', color: BRACE_BLUE, ...cd(this.braceUntil[i] ?? 0, BRACE_COOL_MS), ...(off ? { off: true } : {}) },
    ];
    if (this.phase === 'ready')
      return { ...base, phase: 'ready', title: 'Get ready!', text: 'Slide about with the stick. Shove and Brace work from GO.', buttons: buttons(true) };
    if (this.phase === 'settle' || this.phase === 'over') {
      const won = this.winners.includes(i);
      return {
        ...base,
        phase: 'over',
        title: won ? 'You win the round!' : 'Round over',
        text: `+${this.lastPts[i] ?? 0} points`,
        accent: won ? '#ffd23f' : undefined,
        buttons: [],
        noStick: true,
      };
    }
    if (p && !p.alive)
      return { ...base, phase: 'out', title: 'Splash!', text: 'You’re in the pond. Watch the TV.', accent: BRACE_BLUE, buttons: [], noStick: true };
    return { ...base, phase: 'play', buttons: buttons(false) };
  }

  // ---- TV ------------------------------------------------------------------------------------------------

  render() {
    return <PushyView game={this} />;
  }

  hud() {
    const sim = this.sim;
    const now = performance.now();
    const left = Math.ceil(sim.timeLeft());
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const players = this.ids.map((id) => this.host.player(id));
    const notice = this.notice && this.notice.until > now ? this.notice.text : null;
    return (
      <>
        <div class="pushy-top">
          <div class="pill">
            Round {this.round} / {this.rounds}
          </div>
          <div class="pushy-rule">
            <b>Shove</b> them off · <b class="pushy-brace">Brace</b> to stand firm
          </div>
          <div class={`pushy-clock ${sim.live && left <= 10 ? 'low' : ''}`}>{clock}</div>
        </div>
        {notice && (
          <div class="pushy-notice pop-in" key={notice}>
            {notice}
          </div>
        )}
        {this.labels
          .filter((l) => l.until > now)
          .map((l) => (
            <div class="pushy-splash" style={{ left: `${(l.x / 1920) * 100}%`, top: `${(l.y / 1080) * 100}%`, color: l.color }}>
              {l.text}
            </div>
          ))}
        <div class="pushy-chips">
          {this.ids.map((id, i) => {
            const p = players[i];
            if (!p || this.removed.has(i)) return null;
            const f = sim.players[i];
            const out = !!f && !f.alive;
            const status = out ? 'Splash!' : this.phase === 'ready' ? 'Ready' : f?.alive && this.sim.isBraced(i) ? 'Braced' : 'On the ice';
            return (
              <div class={`pushy-chip ${out ? 'out' : ''} ${p.connected ? '' : 'away'}`} style={{ '--pc': colorHex(p.color) }} key={id}>
                <Pierogi color={colorHex(p.color)} size={46} mood={out ? 'dead' : p.connected ? 'happy' : 'sleep'} />
                <div class="pushy-chip-text">
                  <span class="pushy-chip-name">{p.name}</span>
                  <span class="pushy-chip-status">{this.phase === 'over' || this.phase === 'settle' ? `+${this.lastPts[i]}` : status}</span>
                </div>
                <b class="pushy-chip-score">{this.scores[i]}</b>
              </div>
            );
          })}
        </div>
        {this.phase === 'ready' && <BigCountdown endsAt={this.goAt} key={this.round} />}
        {this.phase === 'over' && this.banner(players)}
        {this.glError && <div class="pushy-notice">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  private banner(players: ReturnType<GameHost['player']>[]) {
    const win = this.winners.map((w) => players[w]).filter(Boolean);
    const title =
      win.length === 0
        ? 'Everyone is wet!'
        : win.length === 1
          ? `${win[0]!.name} wins the round!`
          : win.length === this.ids.length - this.removed.size
            ? 'The ice holds – shared win!'
            : `${win.map((p) => p!.name).join(' & ')} win!`;
    return (
      <div class="trails-banner pop-in pushy-banner">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds}
        </div>
        <div class="trails-banner-big" style={{ color: win.length === 1 ? colorHex(win[0]!.color) : undefined }}>
          {title}
        </div>
        <div class="pushy-banner-pts">
          {this.ids
            .map((_, i) => i)
            .filter((i) => players[i] && !this.removed.has(i))
            .sort((a, b) => this.lastPts[b] - this.lastPts[a])
            .map((i) => (
              <span class={this.winners.includes(i) ? 'win' : ''}>
                <Pierogi color={colorHex(players[i]!.color)} size={44} mood={this.winners.includes(i) ? 'wow' : this.sim.players[i].alive ? 'happy' : 'dead'} />
                <b>+{this.lastPts[i]}</b>
              </span>
            ))}
        </div>
      </div>
    );
  }
}

function PushyView({ game }: { game: PushyGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="pushy">
      <canvas ref={canvas} class="pushy-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
