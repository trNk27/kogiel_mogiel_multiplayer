import { useEffect, useState } from 'preact/hooks';
import { colorHex, gameInfo, type ColorId, type Selection } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import { GameIcon } from './GameIcon';
import { placesFor } from './standings';

/** One player's standing before and after the game that just finished. */
export interface RaceRow {
  id: string;
  name: string;
  color: ColorId;
  before: number;
  after: number;
}

/** Wait `ms`, then return true (resets when `key` changes). */
export function useAfter(ms: number, key: unknown = null) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
    const t = window.setTimeout(() => setDone(true), ms);
    return () => clearTimeout(t);
  }, [ms, key]);
  return done;
}

/** A number that counts from `from` to `to` once `go` turns true. */
function CountUp({ from, to, go, ms = 1100 }: { from: number; to: number; go: boolean; ms?: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    if (!go || from === to) {
      setV(go ? to : from);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setV(Math.round(from + (to - from) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [from, to, go]);
  return <>{v.toLocaleString('en-US')}</>;
}

const ROW_H = 74;

/**
 * The standings as a race: rows start in the old order with the old totals, then the bars
 * grow by what everyone just earned, and finally the rows slide into their new places.
 */
export function StandingsRace({ rows, title, sub }: { rows: RaceRow[]; title: string; sub?: string }) {
  // 0: as things stood · 1: points added · 2: re-ranked
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const a = window.setTimeout(() => setPhase(1), 500);
    const b = window.setTimeout(() => setPhase(2), 1900);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  const oldPlaces = placesFor(rows.map((r) => r.before));
  const newPlaces = placesFor(rows.map((r) => r.after));
  // Stable orders: by points, then by the other order so ties don't jump about.
  const order = (key: 'before' | 'after') =>
    rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r[key] - a.r[key] || b.r.before - a.r.before || a.r.name.localeCompare(b.r.name))
      .map((x) => x.i);
  const oldSlot = new Map(order('before').map((i, slot) => [i, slot]));
  const newSlot = new Map(order('after').map((i, slot) => [i, slot]));
  const max = Math.max(1, ...rows.map((r) => r.after));
  // Before anybody had a lead, everyone "shared first": no ▲▼ for the first game.
  const level = rows.every((r) => r.before === rows[0].before);

  return (
    <div class="race card-paper">
      <div class="party-title">{title}</div>
      {sub && <div class="party-sub">{sub}</div>}
      <div class="race-rows" style={{ height: rows.length * ROW_H }}>
        {rows.map((r, i) => {
          const slot = phase >= 2 ? newSlot.get(i)! : oldSlot.get(i)!;
          const value = phase >= 1 ? r.after : r.before;
          const gained = r.after - r.before;
          const move = level ? 0 : oldPlaces[i] - newPlaces[i];
          const place = phase >= 2 ? newPlaces[i] : oldPlaces[i];
          return (
            <div class={`race-row ${place === 1 && phase >= 2 ? 'lead' : ''}`} key={r.id} style={{ top: slot * ROW_H, '--pc': colorHex(r.color) }}>
              <span class="race-rank">{place}</span>
              <span class={`race-move ${phase >= 2 && move ? (move > 0 ? 'up' : 'down') : ''}`}>
                {phase >= 2 && move > 0 ? `▲${move}` : phase >= 2 && move < 0 ? `▼${-move}` : ''}
              </span>
              <Pierogi color={colorHex(r.color)} size={50} mood={phase >= 2 && move > 0 ? 'wow' : 'happy'} />
              <span class="race-main">
                <span class="race-name">{r.name}</span>
                <span class="race-track">
                  <span class="race-bar" style={{ width: `${(value / max) * 100}%` }} />
                </span>
              </span>
              <span class={`race-gain ${phase >= 1 && gained > 0 ? 'show' : ''}`}>+{gained}</span>
              <b class="race-total">
                <CountUp from={r.before} to={r.after} go={phase >= 1} />
              </b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One player's line on the chart: their total after each step (values[0] is the start). */
export interface ChartSeries {
  id: string;
  name: string;
  color: ColorId;
  values: number[];
}

const CW = 820;
const CH = 560;
const PAD = { l: 64, r: 170, t: 24, b: 92 };

/** A "nice" axis maximum and step for 3–5 gridlines. */
function niceScale(max: number) {
  const raw = Math.max(1, max) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { step, top: Math.ceil(Math.max(1, max) / step) * step };
}

/** Spread label positions apart so none are closer than `gap` (keeps their order). */
export function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const idx = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = idx.map((x) => x.y);
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap);
  // Pushed off the bottom: pull the stack back up from the end.
  if (out.length && out[out.length - 1] > hi) {
    out[out.length - 1] = hi;
    for (let k = out.length - 2; k >= 0; k--) out[k] = Math.max(lo, Math.min(out[k], out[k + 1] - gap));
  }
  const res: number[] = [];
  idx.forEach((x, k) => (res[x.i] = out[k]));
  return res;
}

/** Running totals game by game: one line per player, the games along the bottom. */
export function ScoreChart({ series, games, title }: { series: ChartSeries[]; games: Selection[]; title: string }) {
  const steps = games.length;
  const { step, top } = niceScale(Math.max(...series.flatMap((s) => s.values)));
  const iw = CW - PAD.l - PAD.r;
  const ih = CH - PAD.t - PAD.b;
  const x = (k: number) => PAD.l + (steps ? (k / steps) * iw : iw / 2);
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const grid: number[] = [];
  for (let v = 0; v <= top; v += step) grid.push(v);
  // Leaders are drawn last so their lines sit on top.
  const drawn = [...series].sort((a, b) => a.values[steps] - b.values[steps]);
  const labelYs = spread(
    series.map((s) => y(s.values[steps])),
    30,
    PAD.t,
    PAD.t + ih,
  );
  const icon = steps > 12 ? 0 : steps > 8 ? 40 : 52;

  return (
    <div class="chart card-dark">
      <div class="chart-title">{title}</div>
      <div class="chart-plot" style={{ width: CW, height: CH }}>
        <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label={title}>
          {grid.map((v) => (
            <g>
              <line class="chart-grid" x1={PAD.l} x2={PAD.l + iw} y1={y(v)} y2={y(v)} />
              <text class="chart-axis" x={PAD.l - 14} y={y(v) + 8} text-anchor="end">
                {v}
              </text>
            </g>
          ))}
          {drawn.map((s, n) => {
            const d = s.values.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
            return (
              <g style={{ '--pc': colorHex(s.color), '--delay': `${n * 120}ms` }} key={s.id}>
                <path class="chart-line" d={d} pathLength={1} />
                {s.values.map((v, k) => (
                  <circle class="chart-dot" cx={x(k)} cy={y(v)} r={k === steps ? 10 : 6} style={{ animationDelay: `${600 + n * 120 + (k / Math.max(1, steps)) * 1200}ms` }} />
                ))}
              </g>
            );
          })}
          {series.map((s, i) => (
            <g class="chart-label" style={{ '--pc': colorHex(s.color) }}>
              <line class="chart-leader" x1={x(steps) + 12} y1={y(s.values[steps])} x2={x(steps) + 26} y2={labelYs[i]} />
              <circle cx={x(steps) + 36} cy={labelYs[i]} r={8} fill={colorHex(s.color)} />
              <text x={x(steps) + 52} y={labelYs[i] + 8}>
                {s.name.length > 9 ? `${s.name.slice(0, 8)}…` : s.name}
              </text>
            </g>
          ))}
        </svg>
        <div class="chart-x" style={{ top: PAD.t + ih + 14 }}>
          <span class="chart-tick start" style={{ left: x(0) }}>
            Start
          </span>
          {games.map((g, k) => (
            <span class="chart-tick" style={{ left: x(k + 1) }} title={g === 'tournament' ? 'Tournament' : gameInfo(g).title}>
              {icon ? <GameIcon game={g} size={icon} /> : <b>{k + 1}</b>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The whole "how did we get here" screen: the race on the left, the chart on the right. */
export function ScoreStory(props: { title: string; race: RaceRow[]; raceTitle: string; raceSub?: string; series: ChartSeries[]; games: Selection[]; chartTitle: string }) {
  return (
    <div class="story">
      <h1 class="results-title">{props.title}</h1>
      <div class="story-body">
        <StandingsRace rows={props.race} title={props.raceTitle} sub={props.raceSub} />
        <ScoreChart series={props.series} games={props.games} title={props.chartTitle} />
      </div>
    </div>
  );
}
