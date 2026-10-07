import { useEffect, useRef } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { DT, POWERUP_RADIUS, POWER_KINDS, TrailsSim, WORLD_W, type PowerKind } from './sim';
import { POWER_INFO, PowerIcon, TARGET_COLOR, drawPowerIcon, powerColor } from './powerIcons';
import { awardDeaths, trailsTarget, trailsWinner } from './scoring';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

const COUNTDOWN_MS = 3000;
const ROUND_OVER_MS = 3500;
const CANVAS_W = 1440;
const CANVAS_H = 864;
const SCALE = CANVAS_W / WORLD_W;

const TOAST_MS = 2600;

type Phase = 'countdown' | 'play' | 'roundOver';

export class TrailsGame implements Game {
  readonly id = 'trails' as const;
  private sim!: TrailsSim;
  private scores: number[];
  private readonly target: number;
  private round = 0;
  private phase: Phase = 'countdown';
  private countdownEnds = 0;
  private roundWinner: number | null = null;
  private gameWinner: number | null = null;
  private removed = new Set<number>();
  private turn: (-1 | 0 | 1)[] = [];
  private timer: number | undefined;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private canvas: HTMLCanvasElement | null = null;
  private trailLayer: HTMLCanvasElement;
  private flashes: { x: number; y: number; color: string; t: number }[] = [];
  /** "Kasia makes everyone else fat!" */
  private toast: { idx: number; kind: PowerKind; until: number } | null = null;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.scores = ids.map(() => 0);
    this.turn = ids.map(() => 0);
    this.target = trailsTarget(ids.length, host.short);
    this.trailLayer = document.createElement('canvas');
    this.trailLayer.width = CANVAS_W;
    this.trailLayer.height = CANVAS_H;
  }

  start() {
    // For automated tests: /?debug exposes the running game.
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { trails: TrailsGame }).trails = this;
    this.newRound();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
  }

  // ---- round flow -------------------------------------------------------------

  private newRound() {
    this.round++;
    this.sim = new TrailsSim(this.ids.length, { powerups: this.host.options.powerups });
    for (const i of this.removed) this.sim.kill(i);
    this.sim.snakes.forEach((s) => (s.turn = this.turn[s.idx]));
    this.trailLayer.getContext('2d')!.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.flashes = [];
    this.roundWinner = null;
    this.phase = 'countdown';
    this.countdownEnds = performance.now() + COUNTDOWN_MS;
    sound.count();
    [1000, 2000].forEach((ms) => window.setTimeout(() => this.phase === 'countdown' && sound.count(), ms));
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.phase = 'play';
      this.acc = 0;
      sound.go();
      this.host.refresh();
      this.host.changed();
    }, COUNTDOWN_MS);
    this.host.refresh();
    this.host.changed();
  }

  private endRound() {
    this.phase = 'roundOver';
    const alive = this.sim.snakes.filter((s) => s.alive);
    this.roundWinner = alive.length === 1 ? alive[0].idx : null;
    this.gameWinner = trailsWinner(this.scores, this.target);
    if (this.gameWinner !== null) sound.fanfare();
    this.host.refresh();
    this.host.changed();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.gameWinner !== null) {
        const out: Record<string, number> = {};
        this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.scores[i]));
        this.host.finish(out);
      } else this.newRound();
    }, this.gameWinner !== null ? ROUND_OVER_MS + 1000 : ROUND_OVER_MS);
  }

  // ---- loop -------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.phase === 'play') {
      this.acc += elapsed;
      while (this.acc >= DT && this.phase === 'play') {
        this.acc -= DT;
        this.tick();
      }
    }
    this.draw(now);
  };

  private tick() {
    const ev = this.sim.step();
    const ctx = this.trailLayer.getContext('2d')!;
    ctx.lineCap = 'round';
    for (const seg of ev.segments) {
      ctx.strokeStyle = colorHex(this.colorOf(seg.idx));
      ctx.lineWidth = seg.r * 2 * SCALE;
      ctx.beginPath();
      ctx.moveTo(seg.x0 * SCALE, seg.y0 * SCALE);
      ctx.lineTo(seg.x1 * SCALE, seg.y1 * SCALE);
      ctx.stroke();
    }
    if (ev.cleared) {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      sound.whoosh();
    }
    for (const p of ev.pickups) {
      sound.pickup();
      this.host.buzz(this.ids[p.idx], [40]);
      this.toast = { idx: p.idx, kind: p.kind, until: performance.now() + TOAST_MS };
      this.host.changed();
    }
    if (ev.deaths.length) {
      const alive = this.sim.snakes.filter((s) => s.alive && !this.removed.has(s.idx)).map((s) => s.idx);
      const real = ev.deaths.filter((d) => !this.removed.has(d));
      this.scores = awardDeaths(this.scores, real, alive);
      for (const d of real) {
        const s = this.sim.snakes[d];
        this.flashes.push({ x: s.x, y: s.y, color: colorHex(this.colorOf(d)), t: performance.now() });
        this.host.buzz(this.ids[d], [300, 80, 300]);
      }
      sound.crash();
      for (const id of this.ids) this.host.refresh(id);
      this.host.changed();
      if (this.livingCount() <= 1) this.endRound();
    }
  }

  private livingCount() {
    return this.sim.snakes.filter((s) => s.alive && !this.removed.has(s.idx)).length;
  }

  private colorOf(idx: number) {
    return this.host.player(this.ids[idx])?.color ?? 'sourcream';
  }

  private draw(now: number) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(this.trailLayer, 0, 0);

    // Power-ups
    for (const p of this.sim.powerups) {
      const color = powerColor(p.kind);
      const pulse = 1 + Math.sin(now / 180 + p.id) * 0.08;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.arc(p.x * SCALE, p.y * SCALE, POWERUP_RADIUS * SCALE * 1.4 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x * SCALE, p.y * SCALE, POWERUP_RADIUS * SCALE * pulse, 0, Math.PI * 2);
      ctx.fill();
      drawPowerIcon(ctx, p.kind, p.x * SCALE, p.y * SCALE, POWERUP_RADIUS * SCALE * 1.2, '#2a120a');
    }

    // Crash flashes
    this.flashes = this.flashes.filter((f) => now - f.t < 700);
    for (const f of this.flashes) {
      const k = (now - f.t) / 700;
      ctx.beginPath();
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 6;
      ctx.arc(f.x * SCALE, f.y * SCALE, 10 + k * 70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Heads
    for (const s of this.sim.snakes) {
      if (this.removed.has(s.idx)) continue;
      const color = colorHex(this.colorOf(s.idx));
      const x = s.x * SCALE;
      const y = s.y * SCALE;
      const r = this.sim.radiusOf(s) * SCALE;
      if (!s.alive) {
        ctx.fillStyle = '#2a120a';
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - r, y - r);
        ctx.lineTo(x + r, y + r);
        ctx.moveTo(x + r, y - r);
        ctx.lineTo(x - r, y + r);
        ctx.stroke();
        continue;
      }
      const ghost = this.phase === 'countdown' || s.ghostTicks > 0;
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = color;
      ctx.globalAlpha = ghost ? 0.55 + 0.45 * Math.abs(Math.sin(now / 120)) : 1;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff4dc';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, r * 0.45), 0, Math.PI * 2);
      ctx.fill();
      // Show effects on the head: a hop ring while jumping, a dashed ring for through-walls.
      if (s.fx.jump > 0) {
        ctx.strokeStyle = '#fff4dc';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, r + 10 + Math.sin(now / 70) * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (s.fx.wrap > 0) {
        ctx.save();
        ctx.strokeStyle = TARGET_COLOR.self;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -now / 30;
        ctx.beginPath();
        ctx.arc(x, y, r + 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (this.phase === 'countdown') {
        // Heading arrow + name so everyone can find themselves.
        const ax = Math.cos(s.angle);
        const ay = Math.sin(s.angle);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + ax * 22, y + ay * 22);
        ctx.lineTo(x + ax * 70, y + ay * 70);
        ctx.stroke();
        ctx.beginPath();
        const tx = x + ax * 84;
        const ty = y + ay * 84;
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - ax * 20 - ay * 13, ty - ay * 20 + ax * 13);
        ctx.lineTo(tx - ax * 20 + ay * 13, ty - ay * 20 - ax * 13);
        ctx.closePath();
        ctx.fill();
        const name = this.host.player(this.ids[s.idx])?.name ?? '';
        ctx.font = '800 30px "Fraunces Variable", Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#1a0a0e';
        ctx.strokeText(name, x, y - 22);
        ctx.fillText(name, x, y - 22);
      }
    }
  }

  // ---- input & connection ----------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'steer') return;
    const idx = this.ids.indexOf(id);
    if (idx < 0) return;
    const turn = ((m.r ? 1 : 0) - (m.l ? 1 : 0)) as -1 | 0 | 1;
    this.turn[idx] = turn;
    this.sim.setTurn(idx, turn);
  }

  onConnection(id: string, connected: boolean) {
    if (!connected) {
      const idx = this.ids.indexOf(id);
      if (idx >= 0) {
        this.turn[idx] = 0;
        this.sim.setTurn(idx, 0);
      }
    }
    this.host.changed();
  }

  onRemoved(id: string) {
    const idx = this.ids.indexOf(id);
    if (idx < 0) return;
    this.removed.add(idx);
    this.sim.kill(idx);
    this.host.changed();
    if (this.phase === 'play' && this.livingCount() <= 1) this.endRound();
    if (this.ids.length - this.removed.size < 1) this.host.finish({});
  }

  viewFor(id: string): PhoneView {
    const idx = this.ids.indexOf(id);
    const s = this.sim.snakes[idx];
    const base = { v: 'trails' as const, score: this.scores[idx] ?? 0, target: this.target, round: this.round };
    if (this.phase === 'roundOver') {
      const w = this.gameWinner ?? this.roundWinner;
      return { ...base, phase: 'roundOver', winner: w !== null ? (this.host.player(this.ids[w])?.name ?? null) : null };
    }
    if (s && !s.alive) return { ...base, phase: 'dead' };
    return { ...base, phase: this.phase === 'countdown' ? 'countdown' : 'play' };
  }

  // ---- TV ---------------------------------------------------------------------

  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
  }

  render() {
    return <TrailsView game={this} />;
  }

  /** Data for the TV view. */
  get board() {
    return this.ids
      .map((id, idx) => ({ id, idx, p: this.host.player(id), score: this.scores[idx], alive: this.sim.snakes[idx]?.alive ?? false }))
      .filter((r) => r.p && !this.removed.has(r.idx))
      .sort((a, b) => b.score - a.score);
  }

  get info() {
    const w = this.gameWinner ?? this.roundWinner;
    return {
      phase: this.phase,
      round: this.round,
      target: this.target,
      countdownEnds: this.countdownEnds,
      winnerName: w !== null ? this.host.player(this.ids[w])?.name : null,
      winnerColor: w !== null ? colorHex(this.colorOf(w)) : null,
      gameOver: this.gameWinner !== null,
      powerups: this.host.options.powerups,
      toast:
        this.toast && this.toast.until > performance.now()
          ? { ...this.toast, name: this.host.player(this.ids[this.toast.idx])?.name ?? '?', color: colorHex(this.colorOf(this.toast.idx)) }
          : null,
    };
  }
}

function TrailsView({ game }: { game: TrailsGame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    game.attach(ref.current);
    return () => game.attach(null);
  }, [game]);
  const info = game.info;
  const board = game.board;
  return (
    <div class="screen trails">
      <div class="trails-arena">
        <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} class="trails-canvas" />
        {info.phase !== 'roundOver' && <Countdown endsAt={info.countdownEnds} key={info.round} />}
        {info.toast && (
          <div class="trails-toast pop-in" key={info.toast.until}>
            <PowerIcon kind={info.toast.kind} size={44} />
            <span>
              <b style={{ color: info.toast.color }}>{info.toast.name}</b> {POWER_INFO[info.toast.kind].toast}
            </span>
          </div>
        )}
        {info.phase === 'roundOver' && (
          <div class="trails-banner pop-in">
            {info.winnerName ? (
              <>
                <div class="trails-banner-small">{info.gameOver ? 'Winner of the game' : `Round ${info.round}`}</div>
                <div class="trails-banner-big" style={{ color: info.winnerColor ?? undefined }}>
                  {info.winnerName} {info.gameOver ? 'wins!' : 'survives!'}
                </div>
              </>
            ) : (
              <div class="trails-banner-big">Nobody survived!</div>
            )}
          </div>
        )}
      </div>
      <aside class="trails-side">
        <div class="trails-goal">
          <div class="trails-goal-label">First to</div>
          <div class="trails-goal-num">{info.target}</div>
          <div class="trails-goal-label">Round {info.round}</div>
        </div>
        <div class="trails-list">
          {board.map((r) => (
            <div class={`trails-row ${r.alive ? '' : 'dead'} ${r.p!.connected ? '' : 'offline'}`} key={r.id}>
              <Pierogi color={colorHex(r.p!.color)} size={54} mood={!r.p!.connected ? 'sleep' : r.alive ? 'happy' : 'dead'} />
              <div class="trails-name">{r.p!.name}</div>
              <div class="trails-score">{r.score}</div>
            </div>
          ))}
        </div>
        {info.powerups && (
          <div class="trails-legend">
            <div class="trails-legend-key">
              <span style={{ color: TARGET_COLOR.self }}>● you</span> <span style={{ color: TARGET_COLOR.others }}>● others</span>{' '}
              <span style={{ color: TARGET_COLOR.all }}>● all</span>
            </div>
            <div class="trails-legend-grid">
              {POWER_KINDS.map((k) => (
                <div class="trails-legend-row">
                  <PowerIcon kind={k} size={26} />
                  {POWER_INFO[k].label}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Countdown({ endsAt }: { endsAt: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const left = endsAt - performance.now();
      const label = left > 0 ? String(Math.ceil(left / 1000)) : 'GO!';
      if (label !== last && ref.current) {
        last = label;
        ref.current.textContent = label;
        ref.current.classList.remove('beat');
        void ref.current.offsetWidth;
        ref.current.classList.add('beat');
      }
      if (left > -600) raf = requestAnimationFrame(loop);
      else if (ref.current) ref.current.style.display = 'none';
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [endsAt]);
  return <div class="trails-count" ref={ref} />;
}
