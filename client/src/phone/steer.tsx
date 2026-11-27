/** Shared Maluch Rally controls: a steering wheel you swipe, and buttons you hold. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { trackDrag } from './drag';

/** Swipe this far (fraction of the steering pad's width) for full lock. */
const DRAG_FULL = 0.24;

export function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not supported (iOS) */
  }
}

/** Steering by swiping: put a thumb down anywhere on the pad and slide it sideways. The wheel shows how far you're turning. */
export function DragPad(props: { steer: number; onSteer: (v: number) => void; class?: string }) {
  const { steer, onSteer } = props;
  const el = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const onSteerRef = useRef(onSteer);
  onSteerRef.current = onSteer;
  useEffect(() => {
    const pad = el.current!;
    let x0 = 0;
    const drag = trackDrag(pad, {
      start: (p) => {
        x0 = p.clientX;
        const r = pad.getBoundingClientRect();
        setOrigin({ x: p.clientX - r.left, y: p.clientY - r.top });
        vibrate(6);
      },
      move: (p) => {
        const full = pad.getBoundingClientRect().width * DRAG_FULL;
        onSteerRef.current(Math.max(-1, Math.min(1, (p.clientX - x0) / full)));
      },
      end: () => {
        setOrigin(null);
        onSteerRef.current(0);
      },
    });
    return drag.stop;
  }, []);
  return (
    <div class={`drive-pad ${props.class ?? ''}`} ref={el}>
      {/* The wheel sits under your thumb while you swipe, and in the middle otherwise. */}
      <div
        class={`drive-pad-wheel ${origin ? 'held' : ''}`}
        style={{ left: origin ? origin.x : '50%', top: origin ? origin.y : '50%', transform: `translate(-50%, -50%) rotate(${steer * 90}deg)` }}
      >
        <SteeringWheel />
      </div>
      {!origin && <span class="drive-pad-hint">◀ swipe to steer ▶</span>}
    </div>
  );
}

export function PedalButton(props: { class: string; label: string; down: boolean; onChange: (down: boolean) => void }) {
  const cb = useRef(props.onChange);
  cb.current = props.onChange;
  return (
    <button
      class={`${props.class} ${props.down ? 'down' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        cb.current(true);
      }}
      onPointerUp={() => cb.current(false)}
      onPointerCancel={() => cb.current(false)}
    >
      {props.label}
    </button>
  );
}

export function SteeringWheel() {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <circle cx="50" cy="50" r="42" fill="none" stroke="#2a120a" stroke-width="14" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--me)" stroke-width="8" />
      <path d="M8 50 H36 M64 50 H92 M50 64 V92" stroke="#2a120a" stroke-width="10" stroke-linecap="round" />
      <circle cx="50" cy="50" r="13" fill="#2a120a" />
      <circle cx="50" cy="8" r="5" fill="#ffd23f" />
    </svg>
  );
}

