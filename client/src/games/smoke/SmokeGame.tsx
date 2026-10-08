import { useEffect, useRef } from 'preact/hooks';
import { PLAYER_COLORS, colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import {
  CIG_LENGTH,
  COUGH_MS,
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
  teethColor,
  traySpeed,
  yellowness,
} from './logic';
import { Cig, Cloud, GrinPierogi } from './art';
import { BigCountdown, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
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
/** The tower at the end: the pierogi land one by one, the camera flashes, the winner gets the crown. */
const DROP_MS = 380;
const FLASH_AFTER_MS = 700;
const CROWN_AFTER_MS = 2400;
const FINALE_TAIL_MS = 4200;
/** Table geometry on the TV (SVG units around the table's centre). */
const SEAT_R = 385;
const REST_R = 326;
const TRAY_R = 178;
const MOUTH_R = 368;

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
    this.update();
  }

  dispose() {
    clearInterval(this.tick);
    for (const t of this.timers) clearTimeout(t);
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
    return this.phase === 'over' ? <Tower game={this} /> : <TableView game={this} />;
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

const deg = (a: number) => (a * 180) / Math.PI;

function TableView({ game }: { game: SmokeGame }) {
  const tray = useRef<SVGGElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  // The tray turns and the arms reach every frame, without re-rendering.
  useEffect(() => {
    let raf = 0;
    const reach = new Map<number, number>();
    const loop = () => {
      const now = Date.now();
      tray.current?.setAttribute('transform', `rotate(${deg(game.trayAt(now))})`);
      const arms = new Map<number, SVGLineElement[]>();
      for (const el of Array.from(svg.current?.querySelectorAll<SVGLineElement>('[data-arm]') ?? [])) {
        const i = Number(el.dataset.arm);
        arms.set(i, [...(arms.get(i) ?? []), el]);
      }
      for (const el of Array.from(svg.current?.querySelectorAll<SVGGElement>('[data-hand]') ?? [])) {
        const i = Number(el.dataset.hand);
        const s = game.seats[i];
        let r = REST_R;
        const t = now - s.reachAt;
        if (s.reachAt && t < REACH_MS) r = REST_R + (TRAY_R - REST_R) * Math.sin(((t / REACH_MS) * Math.PI) / 2);
        else if (s.reachAt && t < REACH_MS + RETURN_MS) r = TRAY_R + (REST_R - TRAY_R) * ((t - REACH_MS) / RETURN_MS);
        else if (s.pullAt) r = (reach.get(i) ?? REST_R) + (MOUTH_R - (reach.get(i) ?? REST_R)) * 0.25;
        else if (reach.get(i) !== undefined && reach.get(i)! > REST_R) r = reach.get(i)! + (REST_R - reach.get(i)!) * 0.2;
        reach.set(i, r);
        el.setAttribute('transform', `rotate(${deg(game.angles[i])}) translate(${r.toFixed(1)} 0)`);
        arms.get(i)?.forEach((arm) => arm.setAttribute('x2', r.toFixed(1)));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  const n = game.slots.length;
  const now = Date.now();
  const total = game.seats.reduce((a, s) => a + s.smoked, 0);
  const haze = Math.min(0.4, total / (game.seats.length * 900 + 600));
  return (
    <div class="screen smoke">
      <svg ref={svg} class="smoke-table" viewBox="-864 -486 1728 972" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="smoke-wood">
            <stop offset="0" stop-color="#9a6434" />
            <stop offset=".85" stop-color="#7d4b25" />
            <stop offset="1" stop-color="#5e3418" />
          </radialGradient>
          <radialGradient id="smoke-haze">
            <stop offset="0" stop-color="#d9d4ca" stop-opacity=".9" />
            <stop offset=".6" stop-color="#bdb7ad" stop-opacity=".55" />
            <stop offset="1" stop-color="#bdb7ad" stop-opacity="0" />
          </radialGradient>
        </defs>
        <circle r="330" fill="#3c2010" />
        <circle r="318" fill="url(#smoke-wood)" />
        {[260, 200, 140].map((r) => (
          <circle r={r} fill="none" stroke="rgba(60,30,10,.18)" stroke-width="3" />
        ))}
        <circle r="214" fill="#fbf0d9" opacity=".92" />
        <circle r="214" fill="none" stroke="#fbf0d9" stroke-width="10" stroke-dasharray="4 14" stroke-linecap="round" opacity=".92" />
        <circle r="202" fill="none" stroke="#e8335a" stroke-width="3" stroke-dasharray="12 10" opacity=".55" />
        {/* Where each player grabs from. */}
        {game.angles.map((a, i) => (
          <path d="M 236 0 l 22 -16 v 32 Z" fill={game.colorOf(i)} stroke="#2a120a" stroke-width="3" stroke-linejoin="round" transform={`rotate(${deg(a)})`} opacity={game.removed.has(i) ? 0.2 : 1} />
        ))}
        <g ref={tray} transform={`rotate(${deg(game.trayAt(now))})`}>
          <circle r={TRAY_R + 4} fill="#2a120a" opacity=".35" transform="translate(0 8)" />
          <circle r={TRAY_R} fill="#a46a3a" stroke="#2a120a" stroke-width="4" />
          <circle r={TRAY_R - 16} fill="none" stroke="rgba(42,18,10,.25)" stroke-width="3" />
          {game.slots.map((c, k) =>
            c ? (
              <g transform={`rotate(${(k * 360) / n}) translate(52 0)`} key={`${k}-${c}`} class="smoke-slot">
                <Cig color={c} len={112} w={17} />
              </g>
            ) : null,
          )}
          <circle r="40" fill="#7a4a26" stroke="#2a120a" stroke-width="4" />
          <circle r="16" fill="#c9ccd3" stroke="#2a120a" stroke-width="3" />
        </g>
        {/* Ashtrays with everyone's butts. */}
        {game.angles.map((a, i) => {
          const b = game.seats[i].butts;
          const x = 286 * Math.cos(a + 0.36);
          const y = 286 * Math.sin(a + 0.36);
          return (
            <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} opacity={game.removed.has(i) ? 0.2 : 1}>
              <circle r="27" fill="#3a4148" stroke="#2a120a" stroke-width="3" />
              <circle r="18" fill="#5b636b" />
              {Array.from({ length: Math.min(6, b) }, (_, j) => (
                <rect x="-3" y="-13" width="20" height="7" rx="2" fill="#e0a256" stroke="#2a120a" stroke-width="1.5" transform={`rotate(${j * 61 + 20})`} />
              ))}
            </g>
          );
        })}
        {/* Arms (under the pierogi) and hands. */}
        {game.angles.map((a, i) =>
          game.removed.has(i) ? null : (
            <g transform={`rotate(${deg(a)})`}>
              <line data-arm={i} x1={SEAT_R} y1="0" x2={REST_R} y2="0" stroke="#2a120a" stroke-width="26" stroke-linecap="round" />
              <line data-arm={i} x1={SEAT_R} y1="0" x2={REST_R} y2="0" stroke={game.colorOf(i)} stroke-width="18" stroke-linecap="round" />
            </g>
          ),
        )}
        {game.angles.map((a, i) => {
          const s = game.seats[i];
          const color = game.colorOf(i);
          const coughing = s.hand === 'cough';
          const x = SEAT_R * Math.cos(a);
          const y = SEAT_R * Math.sin(a);
          return (
            <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} opacity={game.removed.has(i) ? 0.2 : game.online(i) ? 1 : 0.5}>
              <g class={coughing ? 'smoke-cough' : s.pullAt ? 'smoke-pull' : ''}>
                <g transform="translate(-82 -66)">
                  <Pierogi color={color} size={164} mood={coughing ? 'dead' : s.pullAt ? 'sleep' : 'happy'} />
                </g>
              </g>
              {coughing &&
                [0, 1, 2].map((k) => (
                  <g class="smoke-khe" style={{ animationDelay: `${k * 0.45}s` }}>
                    <Cloud r={16} fill="rgba(150,160,140,.85)" />
                  </g>
                ))}
            </g>
          );
        })}
        {game.angles.map((a, i) => {
          const s = game.seats[i];
          if (game.removed.has(i)) return null;
          const color = game.colorOf(i);
          const held = s.holding && (s.hand === 'cig' || s.hand === 'cough');
          // The hand group is moved by the animation loop; the arm line before it follows.
          return (
            <g data-hand={i} transform={`rotate(${deg(a)}) translate(${REST_R} 0)`}>
                {held && (
                  <g transform="rotate(90) translate(-40 0)">
                    <g class={s.hand === 'cough' && s.after === 'empty' ? 'smoke-wrong' : ''}>
                      <Cig color={s.holding!} len={110} w={18} frac={s.hand === 'cig' ? s.left / CIG_LENGTH : 1} lit={s.hand === 'cig' || s.after === 'cig'} glow={!!s.pullAt} />
                    </g>
                  </g>
                )}
                <circle r="19" fill={color} stroke="#2a120a" stroke-width="4" />
                <path d="M -4 -12 q 10 0 12 6 M -4 12 q 10 0 12 -6" fill="none" stroke="rgba(42,18,10,.4)" stroke-width="3" stroke-linecap="round" />
            </g>
          );
        })}
        {/* Exhaled smoke drifts over the table. */}
        {game.puffs.map((p) => (
          <g transform={`rotate(${deg(game.angles[p.seat])}) translate(${MOUTH_R - 30} 0)`} key={p.id}>
            <g class="smoke-cloud" style={{ '--sz': String(0.8 + (p.amt / 25) * 2.2) }}>
              <Cloud r={34} />
            </g>
          </g>
        ))}
        <circle r="760" fill="url(#smoke-haze)" opacity={haze} pointer-events="none" />
      </svg>
      {game.phase === 'play' && (
        <div class="smoke-timer">
          <TimerRing endsAt={game.endsAt} total={game.endsAt - game.goAt} size={130} />
        </div>
      )}
      {game.phase === 'ready' && <BigCountdown endsAt={game.goAt} />}
    </div>
  );
}

function Tower({ game }: { game: SmokeGame }) {
  const rows = game.tower;
  const smoked = game.seats.map((s) => s.smoked);
  const yellow = yellowness(smoked);
  const top = Math.max(...rows.map((i) => smoked[i]));
  // The pierogi sit on each other's heads.
  const h = Math.min(170, 860 / (0.8 * Math.max(0, rows.length - 1) + 1));
  const w = h / 0.8;
  const stepY = h * 0.8;
  const flash = game.flashAfter;
  const crown = flash + CROWN_AFTER_MS;
  return (
    <div class="screen smoke-tower" style={{ '--flash': `${flash}ms`, '--crown': `${crown}ms` }}>
      <div class="smoke-stack" style={{ height: `${stepY * (rows.length - 1) + h}px` }}>
        {rows.map((i, k) => {
          const win = smoked[i] === top && top > 0;
          return (
            <div
              class={`smoke-floor ${win ? 'win' : ''}`}
              style={{ bottom: `${k * stepY}px`, zIndex: win ? 99 : rows.length - k, animationDelay: `${k * DROP_MS}ms`, '--pc': game.colorOf(i) }}
              key={game.ids[i]}
            >
              <div class="smoke-floor-name">{game.nameOf(i)}</div>
              <div class="smoke-floor-pierogi" style={{ width: `${w}px` }}>
                {win && <div class="smoke-crown">👑</div>}
                <GrinPierogi color={game.colorOf(i)} teeth={teethColor(yellow[i])} size={w} />
              </div>
              <div class="smoke-floor-score">
                <svg width="84" height="26" viewBox="-16 -10 102 20" aria-hidden="true">
                  <Cig color={game.colorOf(i)} len={80} w={14} lit />
                </svg>
                {(smoked[i] / CIG_LENGTH).toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
      <div class="smoke-flash" />
    </div>
  );
}
