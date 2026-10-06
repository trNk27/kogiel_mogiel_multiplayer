import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex } from '../../../shared/protocol';
import type { ColorId } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';

/** Circular countdown that animates itself (no host re-render needed). */
export function TimerRing({ endsAt, total, size = 120, onTick }: { endsAt: number; total: number; size?: number; onTick?: (secs: number) => void }) {
  const ring = useRef<SVGCircleElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const r = 44;
  const c = 2 * Math.PI * r;
  useEffect(() => {
    let raf = 0;
    let lastSecs = -1;
    const loop = () => {
      const left = Math.max(0, endsAt - Date.now());
      const frac = total > 0 ? left / total : 0;
      if (ring.current) {
        ring.current.style.strokeDashoffset = String(c * (1 - frac));
        ring.current.style.stroke = frac < 0.25 ? '#ff3d6e' : frac < 0.5 ? '#ffc93c' : '#2fd6a8';
      }
      const secs = Math.ceil(left / 1000);
      if (secs !== lastSecs) {
        lastSecs = secs;
        if (label.current) label.current.textContent = String(secs);
        onTick?.(secs);
      }
      if (left > 0) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [endsAt, total]);
  return (
    <div class="timer-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx="50" cy="50" r={r} fill="rgba(0,0,0,.25)" stroke="rgba(255,244,220,.15)" stroke-width="9" />
        <circle
          ref={ring}
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#2fd6a8"
          stroke-width="9"
          stroke-linecap="round"
          stroke-dasharray={String(c)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span ref={label} class="timer-ring-label" />
    </div>
  );
}

export interface BoardRow {
  id: string;
  name: string;
  color: ColorId;
  score: number;
  delta?: number;
  note?: string;
}

/** Animated leaderboard: rows slide into their new order, scores count up. */
export function Leaderboard({ rows, max }: { rows: BoardRow[]; max?: number }) {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const top = Math.max(1, max ?? sorted[0]?.score ?? 1);
  return (
    <div class="board">
      {sorted.map((r, i) => (
        <div class="board-row" key={r.id} style={{ animationDelay: `${i * 70}ms` }}>
          <div class="board-place">{1 + sorted.filter((o) => o.score > r.score).length}</div>
          <Pierogi color={colorHex(r.color)} size={64} />
          <div class="board-name">{r.name}</div>
          <div class="board-bar">
            <div class="board-fill" style={{ width: `${Math.max(2, (r.score / top) * 100)}%`, background: colorHex(r.color) }} />
          </div>
          {r.delta ? <div class="board-delta">+{r.delta}</div> : <div class="board-delta muted">{r.note ?? ''}</div>}
          <div class="board-score">
            <CountUp value={r.score} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(a + (value - a) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);
  return <>{shown.toLocaleString('en-US')}</>;
}

export function PlayerChip({ name, color, dim, mood, badge }: { name: string; color: ColorId; dim?: boolean; mood?: 'happy' | 'dead' | 'wow' | 'sleep'; badge?: string }) {
  return (
    <div class={`chip ${dim ? 'dim' : ''}`}>
      <Pierogi color={colorHex(color)} size={56} mood={mood} />
      <span class="chip-name">{name}</span>
      {badge && <span class="chip-badge">{badge}</span>}
    </div>
  );
}

/** Big "3, 2, 1, GO!" over the play area, until `endsAt` (Date.now clock). Uses the Trails countdown style. */
export function BigCountdown({ endsAt, go = 'GO!' }: { endsAt: number; go?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const left = endsAt - Date.now();
      const label = left > 0 ? String(Math.ceil(left / 1000)) : go;
      if (label !== last && ref.current) {
        last = label;
        ref.current.textContent = label;
        ref.current.classList.remove('beat');
        void ref.current.offsetWidth;
        ref.current.classList.add('beat');
      }
      if (left > -900) raf = requestAnimationFrame(loop);
      else if (ref.current) ref.current.style.display = 'none';
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [endsAt]);
  return <div class="trails-count" ref={ref} />;
}
