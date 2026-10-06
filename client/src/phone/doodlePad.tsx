/** The doodle canvas used by To Ty! (drawing on a photo) and Bazgroły (drawing on a blank page). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { DOODLE_COLORS, DOODLE_SPACE, DOODLE_WIDTHS, MAX_DOODLE_POINTS, type ColorId, type Stroke } from '../../../shared/protocol';
import { Doodle } from '../games/toty/art';
import { TimeBar } from './timebar';

const CANVAS_PX = 640;
const MIN_STEP = 7;

function paint(ctx: CanvasRenderingContext2D, s: Stroke, from = 2) {
  const k = CANVAS_PX / DOODLE_SPACE;
  ctx.strokeStyle = ctx.fillStyle = DOODLE_COLORS[s[0]];
  ctx.lineWidth = DOODLE_WIDTHS[s[1]] * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.length === 4) {
    ctx.beginPath();
    ctx.arc(s[2] * k, s[3] * k, (DOODLE_WIDTHS[s[1]] * k) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  const start = Math.max(2, from - 2);
  ctx.moveTo(s[start] * k, s[start + 1] * k);
  for (let i = start + 2; i < s.length; i += 2) ctx.lineTo(s[i] * k, s[i + 1] * k);
  ctx.stroke();
}

export interface DoodlePadProps {
  prompt: string;
  /** A line above the prompt, like "Round 1 of 2". */
  note?: string;
  endsAt: number;
  offset: number;
  /** The host already has this drawing. */
  done: boolean;
  /** What to draw on: a photo, the player's pierogi (`color`), or a blank page (neither). */
  photo?: string | null;
  color?: ColorId;
  onSubmit: (strokes: Stroke[]) => void;
}

/**
 * The drawing canvas: colours, three brushes, undo and clear. Hands in the drawing on "Done"
 * or just before time runs out.
 */
export function DoodlePad({ prompt, note, endsAt, offset, done, photo: bg, color: subject, onSubmit }: DoodlePadProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const points = useRef(0);
  const sentRef = useRef(false);
  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(1);
  const [count, setCount] = useState(0);
  const [full, setFull] = useState(false);
  const [sent, setSent] = useState(false);
  const pen = useRef({ color, width });
  pen.current = { color, width };

  const submit = () => {
    if (sentRef.current) return;
    sentRef.current = true;
    setSent(true);
    onSubmit(strokes.current);
  };

  // Hand in whatever is there just before time runs out.
  useEffect(() => {
    const t = setTimeout(submit, Math.max(0, endsAt + offset - Date.now() - 800));
    return () => clearTimeout(t);
  }, [endsAt, offset]);

  const redraw = () => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    for (const s of strokes.current) paint(ctx, s);
    points.current = strokes.current.reduce((n, s) => n + (s.length - 2) / 2, 0);
    setFull(points.current >= MAX_DOODLE_POINTS);
    setCount(strokes.current.length);
  };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d')!;
    let active: Stroke | null = null;
    const at = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = Math.round(((e.clientX - r.left) / r.width) * DOODLE_SPACE);
      const y = Math.round(((e.clientY - r.top) / r.height) * DOODLE_SPACE);
      return [Math.max(0, Math.min(DOODLE_SPACE, x)), Math.max(0, Math.min(DOODLE_SPACE, y))];
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      if (points.current >= MAX_DOODLE_POINTS) return;
      el.setPointerCapture?.(e.pointerId);
      const [x, y] = at(e);
      active = [pen.current.color, pen.current.width, x, y];
      strokes.current.push(active);
      points.current++;
      paint(ctx, active);
      setCount(strokes.current.length);
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      e.preventDefault();
      const [x, y] = at(e);
      const lx = active[active.length - 2];
      const ly = active[active.length - 1];
      if (Math.hypot(x - lx, y - ly) < MIN_STEP) return;
      if (points.current >= MAX_DOODLE_POINTS) {
        setFull(true);
        return;
      }
      active.push(x, y);
      points.current++;
      paint(ctx, active, active.length - 2);
    };
    const up = () => {
      active = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [sent]);

  if (sent || done) {
    return (
      <div class="pv pv-center">
        <div class="ty-sent">
          <Doodle strokes={strokes.current} photo={bg} color={subject} />
        </div>
        <div class="phone-big">{strokes.current.length || done ? 'Masterpiece sent!' : 'Time’s up!'}</div>
        <p class="muted">Look at the TV.</p>
      </div>
    );
  }

  return (
    <div class="pv ty-draw-pad">
      <div class="ty-q">
        {note && <small class="muted">{note}</small>}
        <div>{prompt}</div>
      </div>
      <TimeBar endsAt={endsAt} offset={offset} />
      <div class="ty-canvas-wrap">
        <Doodle strokes={[]} photo={bg} color={subject} class="ty-canvas-bg" />
        <canvas ref={canvas} width={CANVAS_PX} height={CANVAS_PX} />
        {full && <div class="ty-full">Canvas full!</div>}
      </div>
      <div class="ty-palette">
        {DOODLE_COLORS.map((c, i) => (
          <button class={`ty-swatch ${i === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(i)} aria-label={`Colour ${i + 1}`} />
        ))}
      </div>
      <div class="ty-tools">
        {DOODLE_WIDTHS.map((w, i) => (
          <button class={`ty-tool ${i === width ? 'on' : ''}`} onClick={() => setWidth(i)} aria-label={`Brush ${i + 1}`}>
            <i style={{ width: 6 + w / 2.2, height: 6 + w / 2.2, background: DOODLE_COLORS[color] }} />
          </button>
        ))}
        <button
          class="ty-tool"
          disabled={!count}
          onClick={() => {
            strokes.current.pop();
            redraw();
          }}
        >
          ↶
        </button>
        <button
          class="ty-tool"
          disabled={!count}
          onClick={() => {
            strokes.current = [];
            redraw();
          }}
        >
          🗑
        </button>
        <button class="btn btn-yolk ty-done" disabled={!count} onClick={submit}>
          Done
        </button>
      </div>
    </div>
  );
}
