import { useEffect, useRef } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DT, TANKS_ROUNDS, TANKS_ROUNDS_SHORT, TUNING, TanksSim, armourHearts, roundPoints, type RoundPoints, type TankEvent, type TankInput } from './logic';
import { ARENA_SCALE, TanksScene } from './scene';
import './tanks.css';

const READY_MS = 3500;
/** After the last tank falls, the explosion gets this long before the banner. */
const FINISH_MS = 1700;
const RESULTS_MS = 6500;
const HUD_MS = 150;
const FEED_MS = 6500;
const KO_MS = 1600;
const MORTAR_GREEN = '#a3e048';

type Phase = 'ready' | 'play' | 'finish' | 'results';

interface FeedLine {
  text: string;
  color: string;
  until: number;
}

interface KoFlash {
  id: number;
  x: number;
  y: number;
  color: string;
  until: number;
}

export class TanksGame implements Game {
  readonly id = 'tanks' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: TanksSim;
  scores: number[];
  lastPoints: RoundPoints | null = null;
  readonly removed = new Set<number>();
  private input: ArenaInput;
  private scene: TanksScene | null = null;
  private glError = false;
  private readyEnds = 0;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private timers: number[] = [];
  private pending: TankEvent[] = [];
  private mortarReadyAt: number[];
  private feed: FeedLine[] = [];
  private flashes: KoFlash[] = [];
  private flashId = 0;
  private suddenShown = false;
  private suddenAt = 0;
  private disposed = false;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? TANKS_ROUNDS_SHORT : TANKS_ROUNDS;
    this.scores = ids.map(() => 0);
    this.input = new ArenaInput(ids);
    this.mortarReadyAt = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, TanksGame>).tanks = this;
    this.newRound();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.detach();
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new TanksScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
      );
      this.scene.setLayout(this.sim.layout);
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
    this.timers.push(window.setTimeout(() => !this.disposed && fn(), ms));
  }

  // ---- flow --------------------------------------------------------------------

  private newRound() {
    this.round++;
    this.input.release();
    this.pending = [];
    this.feed = [];
    this.flashes = [];
    this.suddenShown = false;
    this.acc = 0;
    this.mortarReadyAt = this.ids.map(() => 0);
    this.sim = new TanksSim(this.ids.length, Math.random, { present: this.ids.map((_, i) => !this.removed.has(i)) });
    this.scene?.setLayout(this.sim.layout);
    this.phase = 'ready';
    this.readyEnds = Date.now() + READY_MS;
    this.lastPoints = null;
    for (const ms of [1000, 2000, 3000]) this.later(ms, () => this.phase === 'ready' && sound.count());
    this.later(READY_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      this.sim.locked = false;
      sound.go();
      this.update();
    });
    this.update();
  }

  private endRound() {
    if (this.phase === 'finish' || this.phase === 'results') return;
    this.phase = 'finish';
    sound.whistle();
    for (const [i, id] of this.ids.entries()) if (i === this.sim.winner) this.host.buzz(id, [100, 50, 100, 50, 300]);
    this.update();
    this.later(FINISH_MS, () => this.showResults());
  }

  private showResults() {
    const rp = roundPoints(this.sim.tanks);
    this.lastPoints = rp;
    rp.total.forEach((p, i) => (this.scores[i] += p));
    this.phase = 'results';
    sound.fanfare();
    this.update();
    this.later(RESULTS_MS, () => {
      if (this.round < this.rounds) this.newRound();
      else this.finishAll();
    });
  }

  private finishAll() {
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

  // ---- loop --------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'ready' || this.phase === 'play') {
      this.acc += elapsed;
      while (this.acc >= DT && !this.sim.over) {
        this.acc -= DT;
        this.pending.push(...this.sim.step(this.inputs()));
      }
    }
    if (this.pending.length) {
      const ev = this.pending;
      this.pending = [];
      this.react(ev);
      this.scene?.handle(ev, this.sim);
    }
    if (this.sim.over && this.phase === 'play') this.endRound();
    if (this.phase === 'play' && this.sim.suddenDeath && !this.suddenShown) {
      this.suddenShown = true;
      this.suddenAt = performance.now();
      sound.whistle();
      this.update();
    }
    this.scene?.update(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private inputs(): TankInput[] {
    return this.ids.map((_, i) => {
      const p = this.input.pads[i];
      const shell = this.input.takePresses(i, 0) + (p.held[0] ? 1 : 0);
      const mortar = this.input.takePresses(i, 1);
      return { x: p.x, y: p.y, fire: shell, mortar };
    });
  }

  private name(i: number) {
    return this.host.player(this.ids[i])?.name ?? '?';
  }

  private colorOf(i: number) {
    return colorHex(this.host.player(this.ids[i])?.color ?? 'sourcream');
  }

  /** Sounds, buzzes, the kill feed and phone updates for what just happened. */
  private react(events: TankEvent[]) {
    const now = performance.now();
    for (const e of events) {
      switch (e.e) {
        case 'shot':
          sound.plop();
          break;
        case 'bounce':
          sound.tick();
          break;
        case 'pop':
        case 'clash':
          sound.tick();
          break;
        case 'lob':
          sound.whoosh();
          this.mortarReadyAt[e.idx] = Date.now() + TUNING.mortarCool * 1000;
          this.host.refresh(this.ids[e.idx]);
          break;
        case 'splash':
          sound.crash();
          break;
        case 'crate':
          sound.plop();
          break;
        case 'block':
          sound.tick();
          break;
        case 'hit':
          sound.crash();
          this.host.buzz(this.ids[e.idx], [70]);
          this.host.refresh(this.ids[e.idx]);
          break;
        case 'ko': {
          sound.crash();
          sound.wrong();
          this.host.buzz(this.ids[e.idx], [220, 60, 220, 60, 400]);
          this.host.refresh(this.ids[e.idx]);
          const weapon = e.kind === 'mortar' ? 'mortar' : 'shell';
          const text =
            e.by === e.idx
              ? `${this.name(e.idx)} got hit by their own ${weapon}`
              : `${this.name(e.by)}’s ${weapon} got ${this.name(e.idx)}`;
          this.feed.push({ text, color: this.colorOf(e.by >= 0 ? e.by : e.idx), until: now + FEED_MS });
          if (this.feed.length > 5) this.feed.shift();
          const p = this.scene?.project(e.x, 2.4, e.z);
          if (p) this.flashes.push({ id: this.flashId++, x: p.x, y: p.y, color: this.colorOf(e.idx), until: now + KO_MS });
          if (e.by >= 0 && e.by !== e.idx) this.host.buzz(this.ids[e.by], [40, 30, 40]);
          break;
        }
      }
    }
  }

  // ---- phones ------------------------------------------------------------------

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
    if (this.ids.length - this.removed.size < 2) {
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];
      this.finishAll();
    }
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const t = this.sim?.tanks[i];
    const accent = this.colorOf(i);
    const base = { v: 'pad' as const, game: 'tanks' as const, round: this.round, rounds: this.rounds, accent, score: this.scores[i] ?? 0 };
    const stats = [{ k: 'Armour', v: armourHearts(t?.armour ?? TUNING.armour) }];
    const shell = { label: 'Shell' };
    const readyAt = this.mortarReadyAt[i];
    const mortar = { label: 'Mortar', color: MORTAR_GREEN, ...(readyAt > Date.now() ? { readyAt, cool: TUNING.mortarCool * 1000 } : {}) };
    if (this.phase === 'results' || this.phase === 'finish') {
      const win = this.sim.winner;
      const pts = this.lastPoints?.total[i];
      return {
        ...base,
        phase: this.phase === 'finish' && t && !t.alive ? 'out' : 'over',
        title: win === i ? 'Last tank rolling!' : win >= 0 ? `${this.name(win)} wins the round` : this.sim.timedOut ? 'Time’s up!' : 'Nobody left!',
        text: pts === undefined ? undefined : `+${pts} point${pts === 1 ? '' : 's'} this round`,
        accent: win === i ? '#ffc93c' : accent,
        buttons: [],
        noStick: true,
        stats,
      };
    }
    if (!t || t.removed) return { ...base, phase: 'out', title: 'You’re out!', text: 'Watch the TV', buttons: [], noStick: true };
    if (!t.alive)
      return { ...base, phase: 'out', title: 'You’re out!', text: 'Watch the TV', buttons: [], noStick: true, stats };
    if (this.phase === 'ready')
      return {
        ...base,
        phase: 'ready',
        title: 'Get ready!',
        text: 'Stick drives and aims',
        buttons: [{ ...shell, off: true }, { ...mortar, off: true }],
        stats,
      };
    return {
      ...base,
      phase: 'play',
      ...(this.sim.suddenDeath ? { title: 'Sudden death!', text: 'Any hit takes all your armour', accent: '#ff3d6e' } : {}),
      buttons: [shell, mortar],
      stats,
    };
  }

  // ---- TV ----------------------------------------------------------------------

  render() {
    return <TanksView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const left = Math.max(0, Math.ceil(sim.timeLeft));
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const players = this.ids.map((id) => this.host.player(id));
    const sudden = sim.suddenDeath && this.phase === 'play';
    this.feed = this.feed.filter((f) => f.until > now);
    this.flashes = this.flashes.filter((f) => f.until > now);
    return (
      <>
        <div class="tanks-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          <span class={`pill tanks-clock ${sudden ? 'sudden' : ''}`}>{clock}</span>
          <span class="tanks-rule">Shell bounces once · Mortar flies over walls</span>
        </div>
        {sudden && now - this.suddenAt < 3500 && <div class="tanks-sudden pop-in">Sudden death!</div>}
        {sudden && now - this.suddenAt >= 3500 && <div class="tanks-sudden-small">Sudden death: every hit counts double… and then some</div>}
        <div class="tanks-feed">
          {this.phase !== 'results' && this.feed.map((f, k) => (
            <div class="tanks-feed-line" key={f.until + f.text + k} style={{ '--pc': f.color }}>
              {f.text}
            </div>
          ))}
        </div>
        {this.flashes.map((f) => (
          <div class="tanks-ko" key={f.id} style={{ left: f.x, top: f.y, '--pc': f.color }}>
            KO!
          </div>
        ))}
        <div class={`tanks-chips n${this.ids.length}`}>
          {this.ids.map((_, i) => {
            const p = players[i];
            const t = sim.tanks[i];
            if (!p || this.removed.has(i)) return null;
            return (
              <div class={`tanks-chip ${t && !t.alive ? 'dead' : ''} ${p.connected ? '' : 'away'}`} style={{ '--pc': colorHex(p.color) }} key={i}>
                <Pierogi color={colorHex(p.color)} size={42} mood={t && !t.alive ? 'dead' : p.connected ? 'happy' : 'sleep'} />
                <div class="tanks-chip-main">
                  <span class="tanks-chip-name">{p.name}</span>
                  <span class="tanks-hearts">{armourHearts(t?.armour ?? 0)}</span>
                </div>
                <b class="tanks-chip-score">{this.scores[i]}</b>
              </div>
            );
          })}
        </div>
        {this.phase === 'ready' && <BigCountdown endsAt={this.readyEnds} key={this.round} />}
        {this.phase === 'results' && this.banner()}
        {this.glError && <div class="rally-count small">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  private banner() {
    const rp = this.lastPoints;
    if (!rp) return null;
    const win = this.sim.winner;
    const rows = this.ids
      .map((_, i) => i)
      .filter((i) => !this.removed.has(i))
      .sort((a, b) => rp.total[b] - rp.total[a] || this.scores[b] - this.scores[a]);
    const headline = win >= 0 ? `${this.name(win)} wins!` : this.sim.timedOut ? 'Time’s up!' : 'Nobody left rolling!';
    return (
      <div class="trails-banner tanks-banner">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds}
        </div>
        <div class="trails-banner-big" style={{ color: win >= 0 ? this.colorOf(win) : 'var(--yolk)' }}>
          {headline}
        </div>
        <div class="tanks-rows">
          {rows.map((i, k) => {
            const p = this.host.player(this.ids[i]);
            const t = this.sim.tanks[i];
            const parts = [
              rp.kos[i] ? `${rp.kos[i]} KO${rp.kos[i] === 1 ? '' : 's'}` : '',
              rp.survival[i] ? `outlasted ${rp.survival[i]}` : '',
              rp.bonus[i] ? `+${rp.bonus[i]} last tank` : '',
            ].filter(Boolean);
            return (
              <div class="tanks-row" key={i} style={{ '--pc': colorHex(p?.color ?? 'sourcream'), animationDelay: `${k * 60}ms` }}>
                <Pierogi color={colorHex(p?.color ?? 'sourcream')} size={46} mood={t.alive ? (win === i ? 'wow' : 'happy') : 'dead'} />
                <span class="tanks-row-name">{p?.name ?? '?'}</span>
                <span class="tanks-row-note">{parts.join(' · ') || 'no points'}</span>
                <b class="tanks-row-pts">+{rp.total[i]}</b>
                <span class="tanks-row-total">{this.scores[i]}</span>
              </div>
            );
          })}
        </div>
        <div class="muted tanks-next">{this.round < this.rounds ? 'Next round: a new farmyard…' : 'That was the last round!'}</div>
      </div>
    );
  }
}

function TanksView({ game }: { game: TanksGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    game.attach(canvas.current!);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally tanks">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
