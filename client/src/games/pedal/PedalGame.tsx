import { useEffect, useRef } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { PEDAL_COUNTDOWN_MS, PEDAL_GOAL, PEDAL_GRACE_MS, PEDAL_HEATS, PEDAL_HEATS_SHORT, PEDAL_LIMIT_MS, acceptStrokes, heatPlaces, heatPoints } from './logic';
import { Bike } from './art';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

const HEAT_OVER_MS = 6500;
/** Once everybody still pedalling is across the line, wait this long before the results. */
const ALL_IN_MS = 1200;

type Phase = 'countdown' | 'race' | 'heatOver';

export class PedalGame implements Game {
  readonly id = 'pedal' as const;
  readonly heats: number;
  heat = 0;
  phase: Phase = 'countdown';
  /** Date.now() when pedalling starts. */
  goAt = 0;
  /** Strokes so far this heat, per player index. */
  dist: number[];
  /** ms after the start when each player crossed the line. */
  finishedAt: (number | null)[];
  places: (number | null)[];
  heatPts: number[];
  scores: number[];
  readonly removed = new Set<number>();
  private firstFinish: number | null = null;
  private timer: number | undefined;
  private watch: number | undefined;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.heats = host.short ? PEDAL_HEATS_SHORT : PEDAL_HEATS;
    this.scores = ids.map(() => 0);
    this.dist = ids.map(() => 0);
    this.finishedAt = ids.map(() => null);
    this.places = ids.map(() => null);
    this.heatPts = ids.map(() => 0);
  }

  start() {
    this.newHeat();
    this.watch = window.setInterval(() => this.checkEnd(), 250);
  }

  dispose() {
    clearTimeout(this.timer);
    clearInterval(this.watch);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private newHeat() {
    this.heat++;
    this.dist = this.ids.map(() => 0);
    this.finishedAt = this.ids.map(() => null);
    this.places = this.ids.map(() => null);
    this.heatPts = this.ids.map(() => 0);
    this.firstFinish = null;
    this.phase = 'countdown';
    this.goAt = Date.now() + PEDAL_COUNTDOWN_MS;
    for (const ms of [PEDAL_COUNTDOWN_MS - 3000, PEDAL_COUNTDOWN_MS - 2000, PEDAL_COUNTDOWN_MS - 1000]) {
      window.setTimeout(() => this.phase === 'countdown' && sound.count(), ms);
    }
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.phase = 'race';
      sound.go();
      this.update();
    }, PEDAL_COUNTDOWN_MS);
    this.update();
  }

  /** Riders who can still change the result. */
  private racing() {
    return this.ids.map((_, i) => i).filter((i) => !this.removed.has(i) && this.host.player(this.ids[i])?.connected);
  }

  private checkEnd() {
    if (this.phase !== 'race') return;
    const now = Date.now();
    const racing = this.racing();
    const allIn = racing.every((i) => this.finishedAt[i] !== null);
    if (
      now - this.goAt > PEDAL_LIMIT_MS ||
      (this.firstFinish !== null && now - this.firstFinish > (allIn ? ALL_IN_MS : PEDAL_GRACE_MS)) ||
      racing.length === 0
    )
      this.endHeat();
  }

  private endHeat() {
    if (this.phase !== 'race') return;
    this.phase = 'heatOver';
    const live = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i));
    const places = heatPlaces(live.map((i) => ({ dist: this.dist[i], time: this.finishedAt[i] })));
    live.forEach((i, k) => {
      this.places[i] = places[k];
      this.heatPts[i] = heatPoints(places[k]);
      this.scores[i] += this.heatPts[i];
      if (places[k] === 1) this.host.buzz(this.ids[i], [120, 60, 120, 60, 240]);
    });
    sound.fanfare();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.heat < this.heats ? this.newHeat() : this.finish()), HEAT_OVER_MS);
    this.update();
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.scores[i]));
    this.host.finish(out);
  }

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'pedal' || this.phase !== 'race' || m.h !== this.heat) return;
    const idx = this.ids.indexOf(id);
    if (idx < 0 || this.removed.has(idx) || this.finishedAt[idx] !== null) return;
    const now = Date.now();
    const next = acceptStrokes(this.dist[idx], m.n, now - this.goAt, PEDAL_GOAL);
    if (next === this.dist[idx]) return;
    this.dist[idx] = next;
    if (next < PEDAL_GOAL) return;
    this.finishedAt[idx] = now - this.goAt;
    if (this.firstFinish === null) {
      this.firstFinish = now;
      sound.correct();
    } else sound.lockIn();
    this.host.buzz(id, [60, 40, 60]);
    this.host.refresh(id);
    this.host.changed();
  }

  onConnection() {
    this.host.changed();
  }

  onRemoved(id: string) {
    const idx = this.ids.indexOf(id);
    if (idx < 0) return;
    this.removed.add(idx);
    if (this.ids.length - this.removed.size < 1) this.host.finish({});
    else this.host.changed();
  }

  /** Where a finished rider placed so far (finishers only). */
  private provisional(idx: number) {
    const t = this.finishedAt[idx];
    if (t === null) return null;
    return 1 + this.finishedAt.filter((o, i) => o !== null && o < t && !this.removed.has(i)).length;
  }

  viewFor(id: string): PhoneView {
    const idx = this.ids.indexOf(id);
    const base = { v: 'pedal' as const, heat: this.heat, heats: this.heats, goal: PEDAL_GOAL, goAt: this.goAt, pts: this.heatPts[idx] ?? 0, total: this.scores[idx] ?? 0 };
    if (this.phase === 'heatOver') return { ...base, phase: 'heatOver', place: this.places[idx] ?? null };
    if (this.finishedAt[idx] !== null) return { ...base, phase: 'done', place: this.provisional(idx) };
    return { ...base, phase: this.phase === 'countdown' ? 'countdown' : 'race', place: null };
  }

  render() {
    return <PedalView game={this} />;
  }

  get riders() {
    return this.ids
      .map((id, idx) => ({ id, idx, p: this.host.player(id) }))
      .filter((r) => r.p && !this.removed.has(r.idx));
  }

  placeOf(idx: number) {
    return this.phase === 'heatOver' ? this.places[idx] : this.provisional(idx);
  }
}

function PedalView({ game }: { game: PedalGame }) {
  const lanes = useRef<HTMLDivElement>(null);
  // Bikes glide towards the latest stroke counts, and their wheels turn with the distance.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const shown = new Map<number, number>();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const el of Array.from(lanes.current?.querySelectorAll<HTMLElement>('.pedal-lane') ?? [])) {
        const idx = Number(el.dataset.idx);
        const target = game.dist[idx] ?? 0;
        const cur = shown.get(idx) ?? 0;
        const next = target < cur ? target : cur + (target - cur) * Math.min(1, dt * 8);
        shown.set(idx, next);
        el.style.setProperty('--p', String(next / PEDAL_GOAL));
        el.style.setProperty('--spin', `${next * 45}deg`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  const riders = game.riders;
  const over = game.phase === 'heatOver';
  const winner = over ? riders.find((r) => game.places[r.idx] === 1) : null;
  return (
    <div class="screen pedal">
      <div class="pedal-top">
        <div class="pill">
          Heat {game.heat} / {game.heats}
        </div>
        <div class="pedal-how">
          <b>LEFT</b>, <b>RIGHT</b>, <b>LEFT</b>… · {PEDAL_GOAL} strokes
        </div>
      </div>
      <div class={`pedal-lanes n${riders.length}`} ref={lanes}>
        {riders.map((r) => {
          const color = colorHex(r.p!.color);
          const place = game.placeOf(r.idx);
          return (
            <div class={`pedal-lane ${r.p!.connected ? '' : 'offline'}`} data-idx={r.idx} key={r.id} style={{ '--pc': color }}>
              <div class="pedal-name">{r.p!.name}</div>
              <div class="pedal-road">
                <div class="pedal-finish" />
                <div class="pedal-rider">
                  <Bike color={color} size={150} mood={!r.p!.connected ? 'sleep' : place === 1 ? 'wow' : 'happy'} />
                </div>
              </div>
              <div class="pedal-result">
                {place !== null && <span class={`pedal-place p${place}`}>{place}</span>}
                {over ? <b>+{game.heatPts[r.idx]}</b> : <span class="muted">{game.scores[r.idx]} pts</span>}
              </div>
            </div>
          );
        })}
      </div>
      {game.phase !== 'heatOver' && <BigCountdown endsAt={game.goAt} key={game.heat} />}
      {winner && (
        <div class="trails-banner pop-in">
          <div class="trails-banner-small">
            Heat {game.heat} of {game.heats}
          </div>
          <div class="trails-banner-big" style={{ color: colorHex(winner.p!.color) }}>
            {winner.p!.name} wins the heat!
          </div>
          <div class="pedal-banner-crowd">
            {riders
              .filter((r) => game.places[r.idx] !== null)
              .sort((a, b) => game.places[a.idx]! - game.places[b.idx]!)
              .map((r) => (
                <span>
                  <Pierogi color={colorHex(r.p!.color)} size={44} mood={game.places[r.idx] === 1 ? 'wow' : 'happy'} /> {game.places[r.idx]}.
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
