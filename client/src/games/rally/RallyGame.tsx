import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { DT, LAPS, RallySim, racePoints } from './sim';
import { generateTrack, type Track } from './track';
import { RENDER_SCALE, RallyScene, splitLayout, type Slot } from './render3d';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

export const RACES = 3;
const COUNTDOWN_MS = 4000;
const RESULTS_MS = 9000;
/** After the first car finishes, the others get this long. */
const FINISH_GRACE_MS = 25_000;
const RACE_LIMIT_MS = 5 * 60_000;
const HUD_MS = 200;

type Phase = 'countdown' | 'race' | 'results';

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export class RallyGame implements Game {
  readonly id = 'rally' as const;
  private race = 0;
  private phase: Phase = 'countdown';
  private track!: Track;
  private sim!: RallySim;
  private scene: RallyScene | null = null;
  private map: HTMLCanvasElement | null = null;
  private glError = false;
  private countdownEnds = 0;
  private raceStart = 0;
  private firstFinish: number | null = null;
  private cup: number[];
  private lastPoints: number[];
  private lastOrder: number[] = [];
  private removed = new Set<number>();
  private lastBump: number[];
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private timer: number | undefined;
  private readonly layout: { slots: Slot[]; free: Slot | null };

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.cup = ids.map(() => 0);
    this.lastPoints = ids.map(() => 0);
    this.lastBump = ids.map(() => 0);
    this.layout = splitLayout(ids.length);
  }

  start() {
    this.newRace();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    this.detach();
  }

  /** Called by the view once its canvases exist. */
  attach(canvas: HTMLCanvasElement, map: HTMLCanvasElement) {
    this.map = map;
    try {
      this.scene = new RallyScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
      );
      this.scene.setTrack(this.track);
      this.scene.resetCameras(this.sim.cars);
    } catch (err) {
      console.error(err);
      this.glError = true;
      this.host.changed();
    }
  }

  detach() {
    this.scene?.dispose();
    this.scene = null;
    this.map = null;
  }

  // ---- race flow --------------------------------------------------------------

  private newRace() {
    this.race++;
    this.track = generateTrack((Math.random() * 2 ** 31) | 0);
    this.sim = new RallySim(this.track, this.ids.length, LAPS);
    this.sim.cars.forEach((c, i) => (c.parked = this.removed.has(i) || !this.host.player(this.ids[i])?.connected));
    this.firstFinish = null;
    this.scene?.setTrack(this.track);
    this.scene?.resetCameras(this.sim.cars);
    this.phase = 'countdown';
    this.countdownEnds = performance.now() + COUNTDOWN_MS;
    [1000, 2000, 3000].forEach((ms) => window.setTimeout(() => this.phase === 'countdown' && sound.count(), ms));
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.phase = 'race';
      this.raceStart = performance.now();
      this.acc = 0;
      sound.go();
      this.update();
    }, COUNTDOWN_MS);
    this.update();
  }

  private endRace() {
    if (this.phase !== 'race') return;
    this.phase = 'results';
    this.lastOrder = this.sim.order().filter((i) => !this.removed.has(i));
    this.lastPoints = this.ids.map(() => 0);
    this.lastOrder.forEach((idx, place) => {
      const pts = racePoints(place + 1);
      this.lastPoints[idx] = pts;
      this.cup[idx] += pts;
    });
    sound.fanfare();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.race < RACES) this.newRace();
      else this.finishCup();
    }, RESULTS_MS);
    this.update();
  }

  private finishCup() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => {
      if (!this.removed.has(i)) out[id] = this.cup[i];
    });
    this.host.finish(out);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- loop -------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.phase === 'race') {
      this.acc += elapsed;
      while (this.acc >= DT && this.phase === 'race') {
        this.acc -= DT;
        this.tick(now);
      }
    }
    this.scene?.render(this.sim.cars, this.layout.slots, elapsed);
    this.drawMap();
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.refresh();
      this.host.changed();
    }
  };

  private tick(now: number) {
    const ev = this.sim.step();
    for (const l of ev.laps) {
      sound.lockIn();
      this.host.buzz(this.ids[l.idx], [40, 40, 40]);
    }
    for (const idx of ev.finished) {
      if (this.firstFinish === null) {
        this.firstFinish = now;
        sound.fanfare();
      } else sound.correct();
      this.host.buzz(this.ids[idx], [120, 60, 120, 60, 240]);
    }
    for (const idx of ev.bumps) {
      if (now - this.lastBump[idx] < 700) continue;
      this.lastBump[idx] = now;
      this.host.buzz(this.ids[idx], [35]);
    }
    const racing = this.sim.cars.filter((c) => !c.parked && !this.removed.has(c.idx));
    const allDone = racing.length === 0 || racing.every((c) => c.finished);
    const graceOver = this.firstFinish !== null && now - this.firstFinish > FINISH_GRACE_MS;
    if ((allDone && this.firstFinish !== null) || graceOver || now - this.raceStart > RACE_LIMIT_MS) this.endRace();
  }

  private drawMap() {
    const cv = this.map;
    const t = this.track;
    if (!cv || !t) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width;
    const H = cv.height;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < t.n; i++) {
      minX = Math.min(minX, t.xs[i]);
      maxX = Math.max(maxX, t.xs[i]);
      minZ = Math.min(minZ, t.zs[i]);
      maxZ = Math.max(maxZ, t.zs[i]);
    }
    const s = Math.min((W - 40) / (maxX - minX), (H - 40) / (maxZ - minZ));
    const ox = W / 2 - ((minX + maxX) / 2) * s;
    const oz = H / 2 - ((minZ + maxZ) / 2) * s;
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= t.n; i++) {
        const j = i % t.n;
        if (i === 0) ctx.moveTo(ox + t.xs[j] * s, oz + t.zs[j] * s);
        else ctx.lineTo(ox + t.xs[j] * s, oz + t.zs[j] * s);
      }
    };
    path();
    ctx.strokeStyle = 'rgba(20,6,10,.7)';
    ctx.lineWidth = 16;
    ctx.stroke();
    path();
    ctx.strokeStyle = '#fff4dc';
    ctx.lineWidth = 7;
    ctx.stroke();
    // Start line.
    ctx.strokeStyle = '#e8335a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(ox + (t.xs[0] + t.tz[0] * 14) * s, oz + (t.zs[0] - t.tx[0] * 14) * s);
    ctx.lineTo(ox + (t.xs[0] - t.tz[0] * 14) * s, oz + (t.zs[0] + t.tx[0] * 14) * s);
    ctx.stroke();
    for (const c of [...this.sim.cars].reverse()) {
      if (this.removed.has(c.idx)) continue;
      ctx.beginPath();
      ctx.arc(ox + c.x * s, oz + c.z * s, 9, 0, Math.PI * 2);
      ctx.fillStyle = colorHex(this.host.player(this.ids[c.idx])?.color ?? 'sourcream');
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#2a120a';
      ctx.stroke();
    }
  }

  // ---- phones ---------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'stick') return;
    const i = this.ids.indexOf(id);
    const c = this.sim.cars[i];
    if (!c || c.finished) return;
    const x = Number(m.x);
    const y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    c.input = { x: Math.max(-100, Math.min(100, x)), y: Math.max(-100, Math.min(100, y)) };
  }

  onConnection(id: string, connected: boolean) {
    const c = this.sim.cars[this.ids.indexOf(id)];
    if (c) {
      c.parked = !connected || this.removed.has(c.idx);
      if (!connected) c.input = { x: 0, y: 0 };
    }
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    this.removed.add(i);
    const c = this.sim.cars[i];
    if (c) {
      c.parked = true;
      c.input = { x: 0, y: 0 };
    }
    if (this.removed.size >= this.ids.length) this.host.finish({});
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const c = this.sim.cars[i];
    const order = this.phase === 'results' ? this.lastOrder : this.sim.order().filter((k) => !this.removed.has(k));
    return {
      v: 'rally',
      phase: this.phase === 'countdown' ? 'countdown' : this.phase === 'results' ? 'standings' : c?.finished ? 'finished' : 'race',
      race: this.race,
      races: RACES,
      lap: c ? this.sim.lap(c) : 1,
      laps: LAPS,
      pos: order.indexOf(i) + 1,
      of: order.length,
    };
  }

  // ---- TV -------------------------------------------------------------------------

  render() {
    return <RallyView game={this} />;
  }

  /** Overlays drawn over the 3D view (re-rendered a few times a second). */
  hud() {
    const now = performance.now();
    const order = this.sim.order().filter((k) => !this.removed.has(k));
    const players = this.ids.map((id) => this.host.player(id));
    const free = this.layout.free;
    return (
      <>
        {this.layout.slots.map((slot, i) => {
          const c = this.sim.cars[i];
          const p = players[i];
          if (!c || !p) return null;
          const pos = order.indexOf(i) + 1;
          return (
            <div class="rally-slot" style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h, '--pc': colorHex(p.color) }}>
              <div class="rally-tag">
                <Pierogi color={colorHex(p.color)} size={44} mood={c.finished ? 'wow' : p.connected ? 'happy' : 'sleep'} />
                <span>{p.name}</span>
              </div>
              {this.removed.has(i) ? null : (
                <>
                  <div class="rally-pos">
                    {pos}
                    <small>{ordinal(pos).replace(String(pos), '')}</small>
                  </div>
                  <div class="rally-lap">
                    Lap {this.sim.lap(c)}/{LAPS}
                  </div>
                  <div class="rally-speed">
                    {Math.round(Math.abs(c.speed) * 3.6)}
                    <small> km/h</small>
                  </div>
                  {c.finished && (
                    <div class="rally-finished pop-in">
                      FINISHED
                      <small>{ordinal(pos)}</small>
                    </div>
                  )}
                  {!p.connected && <div class="rally-away">Reconnecting…</div>}
                </>
              )}
            </div>
          );
        })}
        {free && (
          <div class="rally-free" style={{ left: free.x, top: free.y, width: free.w, height: free.h }}>
            <div class="rally-free-title">
              Race {this.race} / {RACES}
            </div>
            <ol class="rally-board">
              {order.map((idx) => {
                const p = players[idx];
                return p ? (
                  <li style={{ '--pc': colorHex(p.color) }}>
                    <span>{p.name}</span>
                    <b>{this.cup[idx]}</b>
                  </li>
                ) : null;
              })}
            </ol>
          </div>
        )}
        {this.phase === 'countdown' && (
          <div class="rally-count" key={Math.ceil((this.countdownEnds - now) / 1000)}>
            {this.countdownEnds - now > 3000 ? `Race ${this.race} of ${RACES}` : Math.max(1, Math.ceil((this.countdownEnds - now) / 1000))}
          </div>
        )}
        {this.phase === 'race' && now - this.raceStart < 900 && <div class="rally-count go">GO!</div>}
        {this.phase === 'race' && this.firstFinish !== null && (
          <div class="rally-clock">{Math.max(0, Math.ceil((FINISH_GRACE_MS - (now - this.firstFinish)) / 1000))}s left to finish</div>
        )}
        {this.phase === 'results' && this.results(players)}
        {this.glError && <div class="rally-count small">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  private results(players: ReturnType<GameHost['player']>[]) {
    const cupOrder = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i)).sort((a, b) => this.cup[b] - this.cup[a]);
    return (
      <div class="rally-results">
        <div class="rally-results-card card-paper">
          <h2>
            Race {this.race} of {RACES}
          </h2>
          <div class="rally-results-cols">
            <ol class="rally-results-list">
              {this.lastOrder.map((idx, place) => {
                const p = players[idx];
                const c = this.sim.cars[idx];
                return p ? (
                  <li>
                    <span class="rr-place">{place + 1}</span>
                    <Pierogi color={colorHex(p.color)} size={44} mood={place === 0 ? 'wow' : 'happy'} />
                    <span class="grow">{p.name}</span>
                    <span class="rr-time">{c.finished ? formatTime(c.finishTime!) : 'DNF'}</span>
                    <b class="rr-pts">+{this.lastPoints[idx]}</b>
                  </li>
                ) : null;
              })}
            </ol>
            {this.ids.length > 1 && (
              <div class="rally-cup">
                <div class="rally-cup-title">Cup standings</div>
                {cupOrder.map((idx) => {
                  const p = players[idx];
                  return p ? (
                    <div class="rally-cup-row">
                      <Pierogi color={colorHex(p.color)} size={36} />
                      <span class="grow">{p.name}</span>
                      <b>{this.cup[idx]}</b>
                    </div>
                  ) : null;
                })}
              </div>
            )}
          </div>
          <div class="muted rally-next">{this.race < RACES ? 'Next track coming up…' : 'That was the last race!'}</div>
        </div>
      </div>
    );
  }
}

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function RallyView({ game }: { game: RallyGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!, map.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  const free = splitLayout(game.ids.length).free;
  const side = free ? Math.min(free.w - 250, free.h - 90) : 0;
  const mapStyle = free
    ? { left: free.x + free.w - side - 20, top: free.y + 70, width: side, height: side }
    : game.ids.length === 1
      ? { right: 40, bottom: 40, width: 300, height: 300 }
      : { left: 960 - 130, top: 540 - 130, width: 260, height: 260 };
  return (
    <div class="rally">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * RENDER_SCALE)} height={Math.round(1080 * RENDER_SCALE)} />
      <canvas ref={map} class={`rally-map ${free ? 'in-slot' : ''}`} width={400} height={400} style={mapStyle} />
      {game.hud()}
    </div>
  );
}
