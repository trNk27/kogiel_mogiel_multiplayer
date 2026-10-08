import { useEffect, useRef, useState } from 'preact/hooks';
import { RALLY_FX_BITS, colorHex, type HostToPhone, type PhoneMsg, type PhoneView, type RallyNet } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { DT, HAZARDS, LAPS, RallySim, driftCode, driftLevel, racePoints } from './sim';
import { generateTrack, type Track } from './track';
import { RENDER_SCALE, RallyScene, splitLayout, type Slot } from './render3d';
import { ItemIcon, hitLabel } from './items';
import { Minimap } from './minimap';
import { ALL_SHAPES, cupShapes, type Shape } from './track';
import { shuffle } from '../quiz/logic';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

export const RACES = 3;
/** Tournament version: a single race. */
export const RACES_SHORT = 1;
const COUNTDOWN_MS = 4000;
const RESULTS_MS = 9000;
/** After the first car finishes, the others get this long. */
const FINISH_GRACE_MS = 25_000;
const RACE_LIMIT_MS = 5 * 60_000;
const HUD_MS = 200;
/** No-TV races: how often the host tells every phone where everything is. */
export const SNAPSHOT_MS = 66;

const round = (v: number, k = 100) => Math.round(v * k) / k;

type Phase = 'countdown' | 'race' | 'results';

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export class RallyGame implements Game {
  readonly id = 'rally' as const;
  private readonly races: number;
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
  /** A different track shape for each race of the cup. */
  private shapes: Shape[];
  /** Short labels shown in a player's view when something happens to them ("SPLAT!"). */
  private flash: { text: string; until: number }[];
  /** No TV: every phone drives its own car and renders the race; this host referees. */
  private readonly net: boolean;
  private loop: number | undefined;
  private lastSnapshot = 0;
  /** Host clock (Date.now) when the lights go green, and when the first car finished. */
  private goAt = 0;
  private firstFinishAt: number | null = null;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.cup = ids.map(() => 0);
    this.lastPoints = ids.map(() => 0);
    this.lastBump = ids.map(() => 0);
    this.layout = splitLayout(ids.length);
    this.races = host.short ? RACES_SHORT : RACES;
    this.shapes = cupShapes(host.options.track, this.races, shuffle);
    this.flash = ids.map(() => ({ text: '', until: 0 }));
    this.net = host.noTv;
  }

  start() {
    // For automated tests: /?debug exposes the running game.
    const q = new URLSearchParams(location.search);
    if (q.has('debug')) {
      // Without a TV the host runs on a phone, whose own race view is window.rally.
      (window as unknown as Record<string, RallyGame>)[this.net ? 'rallyHost' : 'rally'] = this;
      const forced = q.get('shape') as Shape | null;
      if (forced && ALL_SHAPES.includes(forced)) this.shapes = [forced, ...this.shapes.filter((x) => x !== forced)];
    }
    this.newRace();
    this.lastFrame = performance.now();
    // Without a TV nothing is drawn here, and timers keep going where animation frames might not.
    if (this.net) this.loop = window.setInterval(() => this.frame(performance.now()), 16);
    else this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    clearTimeout(this.timer);
    clearInterval(this.loop);
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
    this.track = generateTrack((Math.random() * 2 ** 31) | 0, this.shapes[(this.race - 1) % this.shapes.length]);
    this.sim = new RallySim(this.track, this.ids.length, LAPS, this.host.options.items, Math.random, { remote: this.net ? () => true : undefined });
    this.sim.cars.forEach((c, i) => (c.parked = this.removed.has(i) || !this.host.player(this.ids[i])?.connected));
    this.firstFinish = null;
    this.firstFinishAt = null;
    this.goAt = Date.now() + COUNTDOWN_MS;
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
      if (this.race < this.races) this.newRace();
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
    if (!this.net) this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.phase === 'race') {
      this.acc += elapsed;
      while (this.acc >= DT && this.phase === 'race') {
        this.acc -= DT;
        this.tick(now);
      }
    }
    if (this.net) {
      if (this.phase === 'race' && now - this.lastSnapshot >= SNAPSHOT_MS) {
        this.lastSnapshot = now;
        this.snapshot();
      }
    } else {
      this.scene?.render(this.sim, this.layout.slots, elapsed);
      this.drawMap();
    }
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
        this.firstFinishAt = Date.now();
        sound.fanfare();
      } else sound.correct();
      this.host.buzz(this.ids[idx], [120, 60, 120, 60, 240]);
    }
    for (const p of ev.pickups) {
      sound.pickup();
      this.host.buzz(this.ids[p.idx], [30, 30, 30]);
      this.host.refresh(this.ids[p.idx]);
    }
    for (const u of ev.used) {
      sound.whoosh();
      this.tell(u.idx, { use: u.item });
      this.host.refresh(this.ids[u.idx]);
    }
    for (const h of ev.hits) {
      this.say(h.idx, hitLabel(h.kind, h.blocked), 1500);
      this.tell(h.idx, { hit: h.kind, blocked: h.blocked, by: this.name(h.by) });
      if (h.blocked) sound.tick();
      else {
        sound.crash();
        this.host.buzz(this.ids[h.idx], h.kind === 'beet' ? [60] : [200, 60, 120]);
      }
      if (h.by !== h.idx && !h.blocked) {
        this.say(h.by, 'Got one!', 1200);
        this.tell(h.by, { got: this.name(h.idx) });
      }
    }
    for (const t of ev.turbos) {
      this.say(t.idx, t.level === 2 ? 'Super turbo!' : 'Mini-turbo!', 1000);
      this.host.buzz(this.ids[t.idx], [25]);
    }
    for (const st of ev.steals) {
      this.say(st.idx, 'Stolen!', 1400);
      this.say(st.from, 'ROBBED!', 1400);
      this.tell(st.from, { lost: st.item, by: this.name(st.idx) });
      this.host.refresh(this.ids[st.idx]);
      this.host.refresh(this.ids[st.from]);
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

  private say(idx: number, text: string, ms: number) {
    this.flash[idx] = { text, until: performance.now() + ms };
  }

  private name(idx: number) {
    return this.host.player(this.ids[idx])?.name ?? '?';
  }

  /** No TV: tell a phone what just happened to its car. */
  private tell(idx: number, e: Omit<Extract<HostToPhone, { t: 'rfx' }>, 't' | 'r'>) {
    if (this.net && this.ids[idx]) this.host.message([this.ids[idx]], { t: 'rfx', r: this.race, ...e });
  }

  /** No TV: send every phone where all the cars and items are. */
  private snapshot() {
    const sim = this.sim;
    const B = RALLY_FX_BITS;
    const c: number[] = [];
    for (const car of sim.cars) {
      const bits =
        (car.spin > 0 ? B.spin : 0) |
        (car.rocket > 0 ? B.rocket : 0) |
        (car.boost > 0 ? B.boost : 0) |
        (car.shield > 0 ? B.shield : 0) |
        (car.slow > 0 ? B.slow : 0) |
        (car.ghost > 0 ? B.ghost : 0) |
        (car.parked || this.removed.has(car.idx) ? B.parked : 0) |
        (car.drift ? B.drift : 0) |
        (driftLevel(car) === 1 ? B.sparks : driftLevel(car) === 2 ? B.superSparks : 0);
      c.push(round(car.x), round(car.z), round(car.heading, 1000), round(car.speed, 10), bits);
    }
    const b: number[] = [];
    sim.boxes.forEach((box, i) => box.back > sim.time && b.push(i));
    const sl: number[] = [];
    for (const x of sim.slicks) sl.push(round(x.x), round(x.z), round(x.h), round(x.heading, 100), HAZARDS.indexOf(x.kind));
    const p: number[] = [];
    for (const x of sim.pickles) p.push(round(x.d), round(x.lateral));
    const k: number[] = [];
    for (const x of sim.bombs) k.push(round(x.d), round(x.lateral), round(x.speed, 10), round(x.age, 1000));
    const bl: number[] = [];
    for (const x of sim.blasts) bl.push(round(x.x), round(x.z), round(x.h), round(sim.time - x.at, 1000));
    const ids = this.ids.filter((id, i) => !this.removed.has(i) && this.host.player(id)?.connected);
    this.host.message(ids, { t: 'rs', r: this.race, c, b, s: sl, p, k, x: bl });
  }

  private minimap: Minimap | null = null;

  private drawMap() {
    const cv = this.map;
    const t = this.track;
    if (!cv || !t) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (!this.minimap || this.minimap.track !== t) this.minimap = new Minimap(t, cv.width, 7);
    this.minimap.draw(
      ctx,
      this.sim.cars
        .filter((c) => !this.removed.has(c.idx))
        .map((c) => ({ x: c.x, z: c.z, color: colorHex(this.host.player(this.ids[c.idx])?.color ?? 'sourcream') })),
    );
  }

  // ---- phones ---------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    const i = this.ids.indexOf(id);
    const c = this.sim.cars[i];
    if (m.t === 'car') {
      if (!this.net || !c || m.r !== this.race || this.phase !== 'race' || this.removed.has(i)) return;
      const v = [m.x, m.z, m.a, m.v].map(Number);
      if (!v.every((x) => Number.isFinite(x) && Math.abs(x) < 1e4)) return;
      const d = Math.round(Number(m.d) || 0);
      this.sim.report(i, v[0], v[1], v[2], Math.max(-20, Math.min(80, v[3])), d >= 0 && d <= 3 ? d : 0);
      return;
    }
    if (m.t === 'act') {
      // Lifting the thumb fires the item.
      if (this.phase === 'race' && c && !this.removed.has(i)) this.sim.useItem(i);
      return;
    }
    if (m.t !== 'stick') return;
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
      races: this.races,
      lap: c ? this.sim.lap(c) : 1,
      laps: LAPS,
      pos: order.indexOf(i) + 1,
      of: order.length,
      item: c && this.phase === 'race' ? c.item : null,
      fx: c && this.phase === 'race' ? this.sim.effect(c) : null,
      ...(!this.net && c && this.phase === 'race' && c.drift ? { drift: driftCode(c) } : {}),
      ...(this.net ? { net: this.netView(i) } : {}),
    };
  }

  private netView(i: number): RallyNet {
    return {
      seed: this.track.seed,
      shape: this.track.shape,
      idx: i,
      items: this.host.options.items,
      cars: this.ids.map((id) => {
        const p = this.host.player(id);
        return { name: p?.name ?? '?', color: p?.color ?? 'sourcream' };
      }),
      goAt: this.goAt,
      closesAt: this.firstFinishAt === null ? null : this.firstFinishAt + FINISH_GRACE_MS,
      ...(this.phase === 'results'
        ? {
            board: this.lastOrder.map((idx) => {
              const car = this.sim.cars[idx];
              return { idx, time: car.finished ? round(car.finishTime!) : null, pts: this.lastPoints[idx], cup: this.cup[idx] };
            }),
          }
        : {}),
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
    const small = this.ids.length > 2;
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
                  {c.item && !c.finished && (
                    <div class="rally-item pop-in" key={c.item}>
                      <ItemIcon item={c.item} size={small ? 58 : 76} />
                      <small>Let go!</small>
                    </div>
                  )}
                  {c.ink > 0 && <div class="rally-ink" style={{ opacity: Math.min(1, c.ink / 1.2) }} />}
                  {this.flash[i].until > now && (
                    <div class="rally-flash pop-in" key={`${this.flash[i].text}${this.flash[i].until}`}>
                      {this.flash[i].text}
                    </div>
                  )}
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
              Race {this.race} / {this.races}
            </div>
            <div class="rally-free-track">{this.track.name}</div>
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
            {this.countdownEnds - now > 3000 ? (
              <span class="rally-count-title">
                Race {this.race} of {this.races}
                <small>{this.track.name}</small>
              </span>
            ) : (
              Math.max(1, Math.ceil((this.countdownEnds - now) / 1000))
            )}
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
            Race {this.race} of {this.races} · {this.track.name}
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
          <div class="muted rally-next">{this.race < this.races ? 'Next track coming up…' : 'That was the last race!'}</div>
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
