import { useEffect, useRef, useState } from 'preact/hooks';
import { PLAYER_COLORS, colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import {
  CIG_LENGTH,
  COUGH_MS,
  CROWN_AFTER_MS,
  DROP_MS,
  FINALE_TAIL_MS,
  FLASH_AFTER_MS,
  MIN_PUFF_GAP_MS,
  REACH_MS,
  REFILL_MS,
  RETURN_MS,
  SMOKE_COUNTDOWN_MS,
  SMOKE_MS,
  SMOKE_MS_SHORT,
  Verdict,
  puffAmount,
  refillColor,
  slotCount,
  slotInFront,
  traySpeed,
} from './logic';
import { Cig } from './art';
import { SmokeScene } from './scene';
import { ARENA_SCALE } from '../arena/kit';
import { BigCountdown, TimerRing } from '../../host/components';
import { sound } from '../../lib/sound';
import './smoke.css';

type Phase = 'ready' | 'play' | 'over';
type Hand = 'empty' | 'reach' | 'cig' | 'cough';

interface Seat {
  hand: Hand;
  /** Date.now() when the hand set off for the tray. */
  reachAt: number;
  /** Colour (hex) of the cigarette in the hand. */
  holding: string | null;
  left: number;
  coughUntil: number;
  /** What the hand goes back to once the cough is over. */
  after: 'cig' | 'empty';
  /** Date.now() when the current pull started, 0 when not pulling. */
  pullAt: number;
  lastPuff: number;
  smoked: number;
  butts: number;
  grabs: number;
}

interface Puff {
  id: number;
  seat: number;
  amt: number;
  at: number;
}

/** Tray motion: from `t0` the speed goes from v0 to v1 over `ramp` ms. */
interface Spin {
  t0: number;
  a0: number;
  v0: number;
  v1: number;
  ramp: number;
}

const TICK_MS = 50;

export class SmokeGame implements Game {
  readonly id = 'smoke' as const;
  phase: Phase = 'ready';
  goAt = 0;
  endsAt = 0;
  finaleAt = 0;
  readonly seats: Seat[];
  /** Seat angles (radians, SVG coordinates: 0 is right, π/2 is down). */
  readonly angles: number[];
  /** Cigarette colours (hex) on the tray, null for an empty slot. */
  slots: (string | null)[];
  private refillAt: number[];
  /** Colours that can come round: everybody's, plus decoys when there are few players. */
  private readonly colors: string[];
  private spin: Spin;
  private nextSpin = 0;
  puffs: Puff[] = [];
  private puffId = 0;
  readonly removed = new Set<number>();
  /** Bottom to top, in the tower at the end. */
  tower: number[] = [];
  private readonly length: number;
  private timers: number[] = [];
  private tick: number | undefined;
  scene: SmokeScene | null = null;
  glError = false;
  private raf = 0;
  private last = 0;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.length = host.short ? SMOKE_MS_SHORT : SMOKE_MS;
    this.seats = ids.map(() => ({
      hand: 'empty',
      reachAt: 0,
      holding: null,
      left: 0,
      coughUntil: 0,
      after: 'empty',
      pullAt: 0,
      lastPuff: 0,
      smoked: 0,
      butts: 0,
      grabs: 0,
    }));
    const n = ids.length;
    this.angles = ids.map((_, i) => Math.PI / 2 + (i * 2 * Math.PI) / n);
    const mine = ids.map((id) => colorHex(host.player(id)?.color ?? 'sourcream'));
    const decoys = PLAYER_COLORS.map((c) => c.hex).filter((h) => !mine.includes(h));
    this.colors = [...mine, ...decoys.slice(0, Math.max(0, 4 - mine.length))];
    const k = slotCount(n);
    this.slots = [];
    for (let i = 0; i < k; i++) this.slots.push(refillColor(this.colors, this.slots, Math.random));
    this.refillAt = this.slots.map(() => 0);
    this.spin = { t0: Date.now(), a0: Math.random() * Math.PI * 2, v0: 0.5, v1: 0.5, ramp: 1 };
  }

  start() {
    const now = Date.now();
    this.goAt = now + SMOKE_COUNTDOWN_MS;
    this.endsAt = this.goAt + this.length;
    for (const ms of [SMOKE_COUNTDOWN_MS - 3000, SMOKE_COUNTDOWN_MS - 2000, SMOKE_COUNTDOWN_MS - 1000]) this.later(ms, () => sound.count());
    this.later(SMOKE_COUNTDOWN_MS, () => {
      this.phase = 'play';
      this.nextSpin = Date.now();
      sound.go();
      this.update();
    });
    this.tick = window.setInterval(() => this.step(), TICK_MS);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.update();
  }

  dispose() {
    clearInterval(this.tick);
    cancelAnimationFrame(this.raf);
    for (const t of this.timers) clearTimeout(t);
    this.detach();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.scene?.render(dt);
  };

  // ---- 3D view -----------------------------------------------------------------------

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new SmokeScene(
        canvas,
        this.ids.map((_, i) => ({ name: this.nameOf(i), color: this.colorOf(i) })),
        this,
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

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  /** How far the tray has turned at time t (radians). */
  trayAt(t: number): number {
    const s = this.spin;
    const dt = Math.max(0, t - s.t0) / 1000;
    const ramp = s.ramp / 1000;
    if (dt < ramp) return s.a0 + s.v0 * dt + ((s.v1 - s.v0) * dt * dt) / (2 * ramp);
    return s.a0 + s.v0 * ramp + ((s.v1 - s.v0) * ramp) / 2 + s.v1 * (dt - ramp);
  }

  private speedAt(t: number): number {
    const s = this.spin;
    const f = Math.min(1, Math.max(0, t - s.t0) / s.ramp);
    return s.v0 + (s.v1 - s.v0) * f;
  }

  private step() {
    const now = Date.now();
    if (this.phase !== 'play') return;
    if (now >= this.endsAt) return this.end();
    let dirty = false;
    if (now >= this.nextSpin) {
      const progress = (now - this.goAt) / this.length;
      this.spin = { t0: now, a0: this.trayAt(now), v0: this.speedAt(now), v1: traySpeed(progress, Math.random), ramp: 700 };
      this.nextSpin = now + 3500 + Math.random() * 4500;
    }
    this.slots.forEach((c, k) => {
      if (c === null && now >= this.refillAt[k]) {
        this.slots[k] = refillColor(this.colors, this.slots, Math.random);
        dirty = true;
      }
    });
    this.seats.forEach((s, i) => {
      if (s.hand === 'cough' && now >= s.coughUntil) {
        s.hand = s.after;
        if (s.hand === 'empty') s.holding = null;
        this.host.refresh(this.ids[i]);
        dirty = true;
      }
      // A pull that never ended (the phone went away) stops glowing.
      if (s.pullAt && now - s.pullAt > 4000) {
        s.pullAt = 0;
        dirty = true;
      }
    });
    const before = this.puffs.length;
    this.puffs = this.puffs.filter((p) => now - p.at < 3000);
    if (dirty || this.puffs.length !== before) this.host.changed();
  }

  private end() {
    this.phase = 'over';
    this.finaleAt = Date.now();
    const live = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i));
    // A random order keeps the suspense until the teeth come out.
    this.tower = live.sort(() => Math.random() - 0.5);
    this.tower.forEach((_, k) => this.later(k * DROP_MS, () => sound.plop()));
    const flash = this.tower.length * DROP_MS + FLASH_AFTER_MS;
    this.later(flash, () => sound.shutter());
    this.later(flash + CROWN_AFTER_MS, () => sound.fanfare());
    this.later(flash + CROWN_AFTER_MS + FINALE_TAIL_MS, () => this.finish());
    this.update();
  }

  /** When the camera flashes in the finale (ms after it starts). */
  get flashAfter() {
    return this.tower.length * DROP_MS + FLASH_AFTER_MS;
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.seats[i].smoked));
    this.host.finish(out);
  }

  onMessage(id: string, m: PhoneMsg) {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i) || this.phase !== 'play') return;
    const s = this.seats[i];
    const now = Date.now();
    if (m.t === 'grab') {
      if (s.hand !== 'empty') return;
      s.hand = 'reach';
      s.reachAt = now;
      s.grabs++;
      sound.whoosh();
      this.later(REACH_MS, () => this.resolveGrab(i));
      this.host.refresh(id);
      this.host.changed();
    } else if (m.t === 'puff') {
      if (s.hand !== 'cig') return;
      if (m.ev === 'pull') {
        s.pullAt = now;
        this.host.changed();
        return;
      }
      s.pullAt = 0;
      if (now - s.lastPuff < MIN_PUFF_GAP_MS) return this.host.changed();
      s.lastPuff = now;
      if (m.v === Verdict.Long) {
        this.cough(i, 'cig');
        return;
      }
      const amt = puffAmount(Number(m.q), s.left);
      s.left -= amt;
      s.smoked += amt;
      if (amt > 0) {
        this.puffs.push({ id: ++this.puffId, seat: i, amt, at: now });
        sound.puff(amt / 25);
      }
      if (s.left <= 0) {
        s.butts++;
        s.hand = 'empty';
        s.holding = null;
      }
      this.host.refresh(id);
      this.host.changed();
    }
  }

  private resolveGrab(i: number) {
    const s = this.seats[i];
    if (this.phase !== 'play' || s.hand !== 'reach') return;
    const now = Date.now();
    const k = slotInFront(this.trayAt(now), this.slots.length, this.angles[i]);
    const got = k >= 0 ? this.slots[k] : null;
    if (got === null) {
      // Nothing there: the hand comes back empty.
      this.later(RETURN_MS, () => {
        if (s.hand !== 'reach') return;
        s.hand = 'empty';
        this.host.refresh(this.ids[i]);
        this.host.changed();
      });
      return;
    }
    this.slots[k] = null;
    this.refillAt[k] = now + REFILL_MS[0] + Math.random() * (REFILL_MS[1] - REFILL_MS[0]);
    s.holding = got;
    if (got === colorHex(this.host.player(this.ids[i])?.color ?? '')) {
      s.hand = 'cig';
      s.left = CIG_LENGTH;
      sound.pickup();
      this.host.buzz(this.ids[i], [40]);
      this.host.refresh(this.ids[i]);
      this.host.changed();
    } else this.cough(i, 'empty');
  }

  private cough(i: number, after: 'cig' | 'empty') {
    const s = this.seats[i];
    s.hand = 'cough';
    s.after = after;
    s.pullAt = 0;
    s.coughUntil = Date.now() + COUGH_MS;
    sound.cough();
    this.host.buzz(this.ids[i], [200, 80, 200, 80, 300]);
    this.host.refresh(this.ids[i]);
    this.host.changed();
  }

  onConnection() {
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    this.removed.add(i);
    if (this.ids.length - this.removed.size < 1) this.host.finish({});
    else this.host.changed();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const s = this.seats[i];
    return {
      v: 'smoke',
      phase: this.phase,
      goAt: this.goAt,
      endsAt: this.endsAt,
      hand: s?.hand ?? 'empty',
      left: s?.left ?? 0,
      coughUntil: s?.coughUntil ?? 0,
      n: s?.grabs ?? 0,
    };
  }

  render() {
    return <SmokeView game={this} />;
  }

  colorOf(i: number) {
    return colorHex(this.host.player(this.ids[i])?.color ?? 'sourcream');
  }
  nameOf(i: number) {
    return this.host.player(this.ids[i])?.name ?? '';
  }
  online(i: number) {
    return !!this.host.player(this.ids[i])?.connected;
  }
}

function SmokeView({ game }: { game: SmokeGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally smoke">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.phase === 'play' && (
        <div class="smoke-timer">
          <TimerRing endsAt={game.endsAt} total={game.endsAt - game.goAt} size={130} />
        </div>
      )}
      {game.phase === 'ready' && <BigCountdown endsAt={game.goAt} />}
      {game.phase === 'over' && <TowerLabels game={game} />}
      {game.glError && <div class="smoke-notice">This screen can’t show 3D graphics (WebGL is off).</div>}
    </div>
  );
}

/** Names beside the tower, and how many cigarettes each one smoked once the teeth are out. */
function TowerLabels({ game }: { game: SmokeGame }) {
  const layout = game.scene?.towerLayout() ?? [];
  const smoked = game.seats.map((s) => s.smoked);
  const top = Math.max(...game.tower.map((i) => smoked[i]));
  const flash = game.flashAfter;
  return (
    <div class="smoke-tower" style={{ '--flash': `${flash}ms`, '--crown': `${flash + CROWN_AFTER_MS}ms` }}>
      {layout.map((l, k) => {
        const i = game.tower[k];
        const win = smoked[i] === top && top > 0;
        return (
          <>
            <div class="smoke-floor-name" style={{ left: `${l.left.x}px`, top: `${l.left.y}px`, color: game.colorOf(i), animationDelay: `${k * DROP_MS + 400}ms` }}>
              {game.nameOf(i)}
            </div>
            <div class={`smoke-floor-score ${win ? 'win' : ''}`} style={{ left: `${l.right.x}px`, top: `${l.right.y}px` }}>
              <svg width="84" height="26" viewBox="-16 -10 102 20" aria-hidden="true">
                <Cig color={game.colorOf(i)} len={80} w={14} lit />
              </svg>
              {(smoked[i] / CIG_LENGTH).toFixed(1)}
            </div>
          </>
        );
      })}
      <div class="smoke-flash" />
    </div>
  );
}
