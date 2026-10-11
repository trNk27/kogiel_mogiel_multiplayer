/**
 * Maluch Rallye Premium: Maluch Rally's big brother, a game of its own.
 *
 * It opens on a title screen, with a camera flying over the tracks while little demo races go
 * on. The VIP picks a Grand Prix (three tracks in a row, cup points) or a single track from
 * their phone; then everybody picks one of four cars, each with its own speed, acceleration,
 * handling and off-road grip, and says they're ready. The races themselves are Maluch Rally's
 * (RallyGame), on named tracks that are the same every time.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  KARTS,
  PREMIUM_CUPS,
  PREMIUM_TRACKS,
  colorHex,
  premiumTrack,
  type KartId,
  type PhoneMsg,
  type PhoneView,
  type PremiumPhase,
  type PremiumTrack,
} from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { RallyGame } from '../rally/RallyGame';
import { DT, RallySim, kartSpec } from '../rally/sim';
import { HARD_SHAPES, generateTrack, type Shape, type Track } from '../rally/track';
import { RENDER_SCALE, RallyScene, type RaceState } from '../rally/render3d';
import { Minimap } from '../rally/minimap';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { KartArt, StatBars } from './karts';
import { SHOWROOM_SCALE, Showroom } from './showroom';
import './premium.css';

/** The title screen flies over these, one after the other. */
const SHOWCASE = ['garden', 'tatra', 'crossroads', 'mazury', 'krakow', 'crown', 'kielbasa', 'nowahuta'];
/** Seconds on each track: three camera shots. */
const SHOW_SECONDS = 21;
/** Once everyone is ready, the race starts this much later. */
const START_DELAY_MS = 1600;
/** Size of the car select's 3D strip on the 1920 × 1080 stage. */
const ROOM_W = 1920;
const ROOM_H = 470;

export const isHardTrack = (t: PremiumTrack) => (HARD_SHAPES as readonly string[]).includes(t.shape);

export function cupOf(trackId: string) {
  return PREMIUM_CUPS.find((c) => c.tracks.includes(trackId)) ?? PREMIUM_CUPS[0];
}

export class PremiumGame implements Game {
  readonly id = 'premium' as const;
  phase: PremiumPhase | 'race' = 'title';
  /** Highlighted cup (in 'cups') or track (in 'tracks'). */
  cursor = 0;
  /** Which menu the VIP came from to the car select. */
  private from: 'cups' | 'tracks' = 'cups';
  karts: KartId[];
  ready: boolean[];
  /** What's being raced: a Grand Prix or a track. */
  event = '';
  private courses: PremiumTrack[] = [];
  private removed = new Set<number>();
  race: RallyGame | null = null;
  private startTimer: number | undefined;
  private warm: number | undefined;
  private tracks = new Map<string, Track>();

  // ---- the TV's flyover and showroom ----
  private scene: RallyScene | null = null;
  private room: Showroom | null = null;
  private demo: RallySim | null = null;
  private demoState: RaceState | null = null;
  /** Track the flyover is showing, and when it started (performance.now). */
  showing: string | null = null;
  private showAt = 0;
  /** When the menu last changed (the cups' flyover starts again from their first track). */
  private menuAt = 0;
  private raf = 0;
  private last = 0;
  private acc = 0;
  glError = false;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.karts = ids.map(() => 'maluch');
    this.ready = ids.map(() => false);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, PremiumGame>).premium = this;
    this.menuAt = performance.now();
    // Build the tracks a little at a time, so the menus' maps are ready without a hiccup.
    this.warm = window.setInterval(() => {
      const next = PREMIUM_TRACKS.find((t) => !this.tracks.has(t.id));
      if (next) this.trackFor(next.id);
      else clearInterval(this.warm);
    }, 150);
    this.update();
  }

  dispose() {
    clearTimeout(this.startTimer);
    clearInterval(this.warm);
    this.detach();
    this.race?.dispose();
  }

  /** A named track (built once, then kept). */
  trackFor(id: string): Track {
    let t = this.tracks.get(id);
    if (!t) {
      const info = premiumTrack(id);
      t = generateTrack(info.seed, info.shape as Shape);
      t.name = info.name;
      this.tracks.set(id, t);
    }
    return t;
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- who's who ------------------------------------------------------------------

  /** Players still in the game and connected. */
  private active(): number[] {
    return this.ids.map((_, i) => i).filter((i) => !this.removed.has(i) && !!this.host.player(this.ids[i])?.connected);
  }

  /** The player who drives the menus: the VIP, or (if the VIP isn't racing) the first player here. */
  private leader(): string | null {
    const vip = this.host.vipId?.() ?? null;
    if (vip && this.ids.includes(vip) && !this.removed.has(this.ids.indexOf(vip))) return vip;
    const first = this.active()[0];
    return first === undefined ? null : this.ids[first];
  }

  // ---- menus ------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (this.race) {
      this.race.onMessage(id, m);
      return;
    }
    if (m.t !== 'prem') return;
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i)) return;
    const lead = this.leader() === id;
    const n = Math.round(Number(m.i));
    switch (m.a) {
      case 'mode':
        if (!lead || this.phase !== 'title' || (n !== 0 && n !== 1)) return;
        this.setPhase(n === 0 ? 'cups' : 'tracks');
        sound.whoosh();
        break;
      case 'hover': {
        const max = this.phase === 'cups' ? PREMIUM_CUPS.length : this.phase === 'tracks' ? PREMIUM_TRACKS.length : 0;
        if (!lead || !(n >= 0 && n < max) || n === this.cursor) return;
        this.cursor = n;
        this.menuAt = performance.now();
        sound.tick();
        break;
      }
      case 'go':
        if (!lead) return;
        if (this.phase === 'cups' || this.phase === 'tracks') this.choose();
        // At the car select, the VIP can start without waiting for everyone to say they're ready.
        else if (this.phase === 'karts') this.go();
        else return;
        break;
      case 'back':
        if (!lead) return;
        if (this.phase === 'cups' || this.phase === 'tracks') this.setPhase('title');
        else if (this.phase === 'karts') {
          clearTimeout(this.startTimer);
          this.startTimer = undefined;
          this.setPhase(this.from, this.from === 'cups' ? PREMIUM_CUPS.findIndex((c) => c.name === this.event) : PREMIUM_TRACKS.findIndex((t) => t.name === this.event));
        } else return;
        sound.tick();
        break;
      case 'kart':
        if (this.phase !== 'karts' || this.ready[i] || !(n >= 0 && n < KARTS.length)) return;
        this.karts[i] = KARTS[n].id;
        sound.tick();
        break;
      case 'ready':
        if (this.phase !== 'karts') return;
        this.ready[i] = !!m.on;
        if (m.on) sound.lockIn();
        this.checkReady();
        break;
      default:
        return;
    }
    this.update();
  }

  private setPhase(p: PremiumPhase, cursor = 0) {
    this.phase = p;
    this.cursor = Math.max(0, cursor);
    this.menuAt = performance.now();
  }

  /** The VIP picked the highlighted cup or track: on to the car select. */
  private choose() {
    if (this.phase === 'cups') {
      const cup = PREMIUM_CUPS[this.cursor];
      this.courses = cup.tracks.map(premiumTrack);
      this.event = cup.name;
      this.from = 'cups';
    } else {
      const t = PREMIUM_TRACKS[this.cursor];
      this.courses = [t];
      this.event = t.name;
      this.from = 'tracks';
    }
    this.ready = this.ids.map(() => false);
    this.setPhase('karts');
    sound.whoosh();
  }

  private checkReady() {
    const here = this.active();
    const all = here.length > 0 && here.every((i) => this.ready[i]);
    if (all && this.startTimer === undefined) this.startTimer = window.setTimeout(() => this.go(), START_DELAY_MS);
    else if (!all && this.startTimer !== undefined) {
      clearTimeout(this.startTimer);
      this.startTimer = undefined;
    }
  }

  /** Lights, camera, Maluch. */
  private go() {
    if (this.race || this.phase !== 'karts') return;
    clearTimeout(this.startTimer);
    clearInterval(this.warm);
    this.detach();
    this.race = new RallyGame(this.host, this.ids, {
      id: 'premium',
      courses: this.courses.map((t) => ({ seed: t.seed, shape: t.shape as Shape, name: t.name })),
      karts: this.karts,
      cup: this.courses.length > 1 ? this.event : 'Points',
    });
    this.phase = 'race';
    sound.go();
    this.race.start();
    for (const i of this.removed) this.race.onRemoved(this.ids[i]);
    this.update();
  }

  onConnection(id: string, connected: boolean) {
    if (this.race) {
      this.race.onConnection(id, connected);
      return;
    }
    if (this.phase === 'karts') this.checkReady();
    this.update();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    this.removed.add(i);
    if (this.race) {
      this.race.onRemoved(id);
      return;
    }
    if (this.removed.size >= this.ids.length) {
      this.host.finish({});
      return;
    }
    if (this.phase === 'karts') this.checkReady();
    this.update();
  }

  viewFor(id: string): PhoneView {
    if (this.race) return this.race.viewFor(id);
    const i = this.ids.indexOf(id);
    const here = this.active();
    const lead = this.leader();
    return {
      v: 'premium',
      phase: this.phase === 'race' ? 'karts' : this.phase,
      vip: lead === id,
      vipName: this.host.player(lead ?? '')?.name ?? '',
      cursor: this.cursor,
      kart: this.karts[i] ?? 'maluch',
      ready: !!this.ready[i],
      readyCount: here.filter((k) => this.ready[k]).length,
      total: here.length,
      ...(this.phase === 'karts' ? { event: this.event } : {}),
    };
  }

  // ---- TV: flyover and showroom -------------------------------------------------------

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new RallyScene(
        canvas,
        KARTS.map((k) => ({ name: '', color: k.paint, kart: k.id })),
        undefined,
        ['psx'],
      );
    } catch (err) {
      console.error(err);
      this.glError = true;
      this.host.changed();
      return;
    }
    this.showing = null;
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  attachRoom(canvas: HTMLCanvasElement | null) {
    this.room?.dispose();
    this.room = null;
    if (!canvas) return;
    try {
      this.room = new Showroom(canvas);
    } catch (err) {
      console.error(err);
    }
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.scene?.dispose();
    this.scene = null;
    this.room?.dispose();
    this.room = null;
    this.demo = null;
    this.showing = null;
  }

  /** The track the flyover should be showing now. */
  private wantShow(now: number): string {
    if (this.phase === 'tracks') return PREMIUM_TRACKS[this.cursor].id;
    if (this.phase === 'cups') {
      const cup = PREMIUM_CUPS[this.cursor];
      return cup.tracks[Math.floor((now - this.menuAt) / 1000 / SHOW_SECONDS) % cup.tracks.length];
    }
    if (this.phase === 'karts') return this.courses[0]?.id ?? SHOWCASE[0];
    return SHOWCASE[Math.floor((now - this.menuAt) / 1000 / SHOW_SECONDS) % SHOWCASE.length];
  }

  /** Fly over another track, with four demo cars racing on it. */
  private show(id: string, now: number) {
    const t = this.trackFor(id);
    this.showing = id;
    this.showAt = now;
    this.scene?.setTrack(t);
    this.demo = new RallySim(t, KARTS.length, 1000, this.host.options.items, Math.random, { specs: KARTS.map((k) => kartSpec(k.stats)) });
    this.demoState = this.demo;
    // Get them going before the camera arrives.
    for (let k = 0; k < 4 / DT; k++) this.stepDemo();
    this.scene?.resetCameras(this.demo.cars);
    this.host.changed();
  }

  private stepDemo() {
    const sim = this.demo!;
    sim.cars.forEach((c, i) => {
      c.input = sim.autopilot(c, 29 + i * 2.5);
      // Use items now and then, for the show.
      if (c.item && Math.random() < DT / 1.8) sim.useItem(i);
    });
    sim.step();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'race') return;
    if (this.phase === 'karts' && this.room) {
      const picked = KARTS.map((k) => this.active().filter((i) => this.karts[i] === k.id).length);
      const here = this.active();
      this.room.render(dt, picked, here.length > 0 && here.every((i) => this.ready[i]));
      return;
    }
    const want = this.wantShow(now);
    if (want !== this.showing) this.show(want, now);
    if (!this.demo || !this.scene || !this.demoState) return;
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.stepDemo();
    }
    this.scene.renderFly(this.demoState, (now - this.showAt) / 1000, dt);
  };

  render() {
    if (this.race) return this.race.render();
    return <PremiumView game={this} />;
  }

  /** Name of the track the flyover is on. */
  showingName() {
    return this.showing ? premiumTrack(this.showing).name : '';
  }

  /** Who picked each car, for the car select. */
  pickers() {
    return KARTS.map((k) =>
      this.active()
        .filter((i) => this.karts[i] === k.id)
        .map((i) => ({ p: this.host.player(this.ids[i])!, ready: this.ready[i] })),
    );
  }

  leaderName() {
    return this.host.player(this.leader() ?? '')?.name ?? 'The VIP';
  }

  readyCounts() {
    const here = this.active();
    return { ready: here.filter((i) => this.ready[i]).length, total: here.length };
  }

  courseList() {
    return this.courses;
  }
}

// ---------------------------------------------------------------------------------------
// TV views
// ---------------------------------------------------------------------------------------

function PremiumView({ game }: { game: PremiumGame }) {
  const fly = useRef<HTMLCanvasElement>(null);
  const room = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(fly.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  const karts = game.phase === 'karts';
  useEffect(() => {
    game.attachRoom(karts ? room.current : null);
  }, [karts]);
  return (
    <div class={`prem is-${game.phase}`}>
      <canvas ref={fly} class="prem-fly" width={Math.round(1920 * RENDER_SCALE)} height={Math.round(1080 * RENDER_SCALE)} />
      {game.phase !== 'karts' && <div class="prem-vignette" />}
      {game.phase === 'title' && <Title game={game} />}
      {game.phase === 'cups' && <Cups game={game} />}
      {game.phase === 'tracks' && <Tracks game={game} />}
      {karts && (
        <>
          <div class="prem-room-bg" />
          <canvas ref={room} class="prem-room" width={Math.round(ROOM_W * SHOWROOM_SCALE)} height={Math.round(ROOM_H * SHOWROOM_SCALE)} />
          <Karts game={game} />
        </>
      )}
      {game.phase !== 'karts' && game.showing && (
        <div class="prem-now" key={game.showing}>
          <span>📍</span> {game.showingName()}
        </div>
      )}
      {game.glError && <div class="rally-count small">This screen can’t show 3D graphics (WebGL is off).</div>}
    </div>
  );
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div class={`prem-logo ${small ? 'small' : ''}`}>
      <span class="prem-logo-top">Maluch</span>
      <span class="prem-logo-main">Rallye</span>
      <span class="prem-ribbon">Premium</span>
    </div>
  );
}

export function Trophy({ color, size = 80 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M28 14 H72 V40 Q72 64 50 66 Q28 64 28 40 Z" fill={color} stroke="#2a120a" stroke-width="4" stroke-linejoin="round" />
      <path d="M28 22 Q10 22 12 36 Q14 50 30 50 M72 22 Q90 22 88 36 Q86 50 70 50" fill="none" stroke="#2a120a" stroke-width="4" />
      <rect x="44" y="64" width="12" height="14" fill={color} stroke="#2a120a" stroke-width="4" />
      <rect x="30" y="78" width="40" height="10" rx="3" fill="#6b4428" stroke="#2a120a" stroke-width="4" />
      <path d="M38 24 Q38 44 48 52" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="4" stroke-linecap="round" />
    </svg>
  );
}

function Flag({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="18" y="10" width="6" height="84" rx="3" fill="#c9ccd3" stroke="#2a120a" stroke-width="3" />
      <path d="M24 14 Q50 6 84 16 V54 Q50 44 24 52 Z" fill="#fff4dc" stroke="#2a120a" stroke-width="4" stroke-linejoin="round" />
      <path d="M24 14 Q31 12 37 12 V31 Q31 31 24 33 Z M50 12 Q57 12 63 13 V32 Q57 31 50 31 Z M37 31 Q44 31 50 31 V50 Q44 50 37 50 Z M63 32 Q73 33 84 35 V54 Q73 50 63 49 Z" fill="#2a120a" />
    </svg>
  );
}

function Title({ game }: { game: PremiumGame }) {
  return (
    <>
      <Logo />
      <div class="prem-menu">
        <div class="prem-option">
          <Trophy color="#ffc93c" size={96} />
          <b>Grand Prix</b>
          <small>Three tracks · one trophy</small>
        </div>
        <div class="prem-option">
          <Flag size={96} />
          <b>Tracks</b>
          <small>Any of {PREMIUM_TRACKS.length} tracks</small>
        </div>
      </div>
      <div class="prem-hint">👑 {game.leaderName()} picks on their phone</div>
    </>
  );
}

/** A little map of a named track. */
function TrackMap({ game, id, size }: { game: PremiumGame; id: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    // Off the render path: building a track the first time takes a few milliseconds.
    const h = window.setTimeout(() => {
      const cv = ref.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      new Minimap(game.trackFor(id), cv.width, Math.max(4, size / 28)).draw(ctx, []);
    }, 0);
    return () => clearTimeout(h);
  }, [id, size]);
  return <canvas ref={ref} class="prem-map" width={size} height={size} />;
}

function Cups({ game }: { game: PremiumGame }) {
  return (
    <>
      <Logo small />
      <h2 class="prem-head">Grand Prix</h2>
      <div class="prem-cups">
        {PREMIUM_CUPS.map((cup, i) => (
          <div class={`prem-cup ${i === game.cursor ? 'on' : ''}`} style={{ '--cup': cup.color }}>
            <Trophy color={cup.color} size={i === game.cursor ? 110 : 84} />
            <b>{cup.name}</b>
            <ol>
              {cup.tracks.map((id) => (
                <li class={game.showing === id && i === game.cursor ? 'now' : ''}>
                  <TrackMap game={game} id={id} size={64} />
                  <span>{premiumTrack(id).name}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <div class="prem-hint">👑 {game.leaderName()} picks a cup</div>
    </>
  );
}

function Tracks({ game }: { game: PremiumGame }) {
  const on = PREMIUM_TRACKS[game.cursor];
  return (
    <>
      <Logo small />
      <h2 class="prem-head">Tracks</h2>
      <div class="prem-tracks">
        {PREMIUM_TRACKS.map((t, i) => {
          const cup = cupOf(t.id);
          return (
            <div class={`prem-track ${i === game.cursor ? 'on' : ''}`} style={{ '--cup': cup.color }}>
              <TrackMap game={game} id={t.id} size={96} />
              <span class="grow">
                <b>{t.name}</b>
                <small>{cup.name}</small>
              </span>
              {isHardTrack(t) && <span class="prem-hard">Hard</span>}
            </div>
          );
        })}
      </div>
      <div class="prem-hint">
        <b>{on.name}</b> · {on.hint}
      </div>
    </>
  );
}

function Karts({ game }: { game: PremiumGame }) {
  const pickers = game.pickers();
  const { ready, total } = game.readyCounts();
  const courses = game.courseList();
  return (
    <>
      <div class="prem-karts-head">
        <h2 class="prem-head">Choose your car</h2>
        <div class="prem-event">
          {courses.length > 1 ? <Trophy color={cupOf(courses[0].id).color} size={44} /> : <Flag size={44} />}
          <span>
            <b>{game.event}</b>
            <small>{courses.map((c) => c.name).join(' · ')}</small>
          </span>
        </div>
      </div>
      <div class="prem-karts">
        {KARTS.map((k, i) => (
          <div class={`prem-kart ${pickers[i].length ? 'picked' : ''}`} style={{ '--paint': k.paint }}>
            <div class="prem-pickers">
              {pickers[i].map(({ p, ready }) => (
                <span class={`prem-chip ${ready ? 'ready' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                  <Pierogi color={colorHex(p.color)} size={36} mood={ready ? 'wow' : 'happy'} />
                  {p.name}
                  {ready && <i>✓</i>}
                </span>
              ))}
            </div>
            <div class="prem-kart-card card-paper">
              <div class="prem-kart-art">
                <KartArt kart={k.id} color={k.paint} size={150} />
              </div>
              <b>{k.name}</b>
              <small>{k.blurb}</small>
              <StatBars stats={k.stats} />
            </div>
          </div>
        ))}
      </div>
      <div class={`prem-hint ${ready === total && total > 0 ? 'go' : ''}`}>
        {ready === total && total > 0 ? 'Everyone’s ready – here we go!' : `${ready} / ${total} ready · pick your car on your phone`}
      </div>
    </>
  );
}
