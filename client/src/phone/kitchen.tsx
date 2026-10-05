/** Pierogi Panic phone controller: a floating joystick, one big action button and the station minigames. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { colorHex, fillingInfo, type Filling, type KitchenMini, type PhoneView } from '../../../shared/protocol';
import { ItemIcon } from '../games/kitchen/art';
import { itemName } from '../games/kitchen/logic';
import { mulberry32 } from '../games/rng';
import { Pierogi } from '../lib/art';
import type { Me, Send } from './PhoneApp';

type View = Extract<PhoneView, { v: 'kitchen' }>;

function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not supported (iOS) */
  }
}

export function KitchenPad({ view, me, send }: { view: View; me: Me; send: Send }) {
  if (view.mini) return <Minigame mini={view.mini} send={send} key={view.mini.id} />;
  return <Controller view={view} me={me} send={send} />;
}

// ---------------------------------------------------------------------------
// Joystick + button
// ---------------------------------------------------------------------------

/** Max knob travel in px. */
const STICK_R = 62;

function Controller({ view, me, send }: { view: View; me: Me; send: Send }) {
  const zone = useRef<HTMLDivElement>(null);
  const baseEl = useRef<HTMLDivElement>(null);
  const knobEl = useRef<HTMLDivElement>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const [pressed, setPressed] = useState(false);
  const [active, setActive] = useState(false);

  const act = () => {
    vibrate(12);
    sendRef.current({ t: 'act' });
  };
  const actRef = useRef(act);
  actRef.current = act;

  useEffect(() => {
    const el = zone.current!;
    // Fingers still swiping from a just-finished minigame shouldn't start walking.
    const mountedAt = performance.now();
    let pid: number | null = null;
    let ox = 0;
    let oy = 0;
    let sent = { x: 0, y: 0 };
    let want = { x: 0, y: 0 };
    let lastSend = 0;
    let timer = 0;
    const keys = { u: false, d: false, l: false, r: false };

    const flush = () => {
      timer = 0;
      if (want.x === sent.x && want.y === sent.y) return;
      sent = want;
      lastSend = performance.now();
      sendRef.current({ t: 'stick', x: sent.x, y: sent.y });
    };
    /** Quantise (32 directions, two speeds) and throttle to ~20 messages a second. */
    const queue = (x: number, y: number) => {
      const m = Math.min(1, Math.hypot(x, y));
      let q = { x: 0, y: 0 };
      if (m > 0.2) {
        const step = Math.PI / 16;
        const a = Math.round(Math.atan2(y, x) / step) * step;
        const mag = m > 0.62 ? 100 : 55;
        q = { x: Math.round(Math.cos(a) * mag), y: Math.round(Math.sin(a) * mag) };
      }
      want = q;
      if (q.x === sent.x && q.y === sent.y) {
        clearTimeout(timer);
        timer = 0;
        return;
      }
      const since = performance.now() - lastSend;
      if ((q.x === 0 && q.y === 0) || since >= 50) {
        clearTimeout(timer);
        flush();
      } else if (!timer) timer = window.setTimeout(flush, 50 - since);
    };

    const place = (bx: number, by: number, kx: number, ky: number) => {
      if (baseEl.current) baseEl.current.style.transform = `translate(${bx}px, ${by}px)`;
      if (knobEl.current) knobEl.current.style.transform = `translate(${kx}px, ${ky}px)`;
    };
    const rest = () => {
      const r = el.getBoundingClientRect();
      place(r.width / 2, r.height / 2, 0, 0);
    };
    rest();

    const down = (e: PointerEvent) => {
      e.preventDefault();
      if (pid !== null || performance.now() - mountedAt < 500) return;
      pid = e.pointerId;
      el.setPointerCapture?.(pid);
      const r = el.getBoundingClientRect();
      ox = e.clientX;
      oy = e.clientY;
      place(ox - r.left, oy - r.top, 0, 0);
      setActive(true);
      vibrate(6);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      let dx = e.clientX - ox;
      let dy = e.clientY - oy;
      const m = Math.hypot(dx, dy);
      if (m > STICK_R) {
        // Drag the base along so reversing direction is instant.
        ox += dx * (1 - STICK_R / m);
        oy += dy * (1 - STICK_R / m);
        dx = e.clientX - ox;
        dy = e.clientY - oy;
      }
      const r = el.getBoundingClientRect();
      place(ox - r.left, oy - r.top, dx, dy);
      queue(dx / STICK_R, dy / STICK_R);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      setActive(false);
      rest();
      queue(0, 0);
    };
    const keyVec = () => queue((keys.r ? 1 : 0) - (keys.l ? 1 : 0), (keys.d ? 1 : 0) - (keys.u ? 1 : 0));
    const onKey = (isDown: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') keys.u = isDown;
      else if (k === 'arrowdown' || k === 's') keys.d = isDown;
      else if (k === 'arrowleft' || k === 'a') keys.l = isDown;
      else if (k === 'arrowright' || k === 'd') keys.r = isDown;
      else if (k === ' ' || k === 'e' || k === 'enter') {
        e.preventDefault();
        if (isDown && !e.repeat) actRef.current();
        setPressed(isDown);
        return;
      } else return;
      e.preventDefault();
      keyVec();
    };
    const keyDown = onKey(true);
    const keyUp = onKey(false);
    const reset = () => {
      pid = null;
      keys.u = keys.d = keys.l = keys.r = false;
      setActive(false);
      rest();
      queue(0, 0);
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', rest);
    document.addEventListener('visibilitychange', reset);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', rest);
      document.removeEventListener('visibilitychange', reset);
      clearTimeout(timer);
      if (sent.x !== 0 || sent.y !== 0) sendRef.current({ t: 'stick', x: 0, y: 0 });
    };
  }, []);

  const label = view.hint ?? (view.phase === 'prep' ? 'Get ready…' : view.phase === 'over' ? 'Time’s up!' : '—');
  return (
    <div class="pv k-pad" style={{ '--me': colorHex(me.color) }}>
      <div class="k-pad-top">
        <span class="k-pad-score">
          <b>{view.score}</b> tips
        </span>
        <span class="muted">Look at the TV</span>
      </div>
      <div class={`k-stick-zone ${active ? 'active' : ''}`} ref={zone}>
        <div class="k-stick-base" ref={baseEl}>
          <div class="k-stick-ring" />
          <div class="k-stick-knob" ref={knobEl}>
            <Pierogi color={colorHex(me.color)} size={58} />
          </div>
        </div>
        {!active && <div class="k-stick-label">Drag anywhere here to walk</div>}
      </div>
      <div class="k-hold">
        {view.hold ? (
          <>
            <ItemIcon item={view.hold} size={44} />
            <span>
              Holding <b>{holdText(view.hold)}</b>
            </span>
          </>
        ) : (
          <span class="muted">Hands free</span>
        )}
      </div>
      <button
        class={`k-act ${view.hint ? 'ready' : ''} ${pressed ? 'down' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          setPressed(true);
          act();
        }}
        onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
      >
        {label}
      </button>
      {view.phase === 'over' && (
        <div class="dead-overlay calm">
          <div class="phone-big">Service over!</div>
          <div class="muted">Look at the TV for your stars.</div>
        </div>
      )}
    </div>
  );
}

function holdText(it: NonNullable<View['hold']>) {
  if (it.k === 'plate' && it.f) return `${fillingInfo(it.f).name} pierogi`;
  if (it.k === 'raw') return `raw ${fillingInfo(it.f).name.toLowerCase()} pierogi`;
  if (it.k === 'dirty' && it.n > 1) return `${it.n} dirty plates`;
  return itemName(it);
}

// ---------------------------------------------------------------------------
// Minigames
// ---------------------------------------------------------------------------

const MINI_TEXT: Record<KitchenMini['kind'], { title: string; how: string }> = {
  roll: { title: 'Roll the dough', how: 'Swipe up and down to roll it thin' },
  fold: { title: 'Make pierogi', how: 'Swipe across to fold, then pinch the edge' },
  boil: { title: 'Boil the pierogi', how: 'Stir in circles until they float' },
  wash: { title: 'Wash the plate', how: 'Scrub off every spot' },
};

interface MiniProps {
  seed: number;
  f?: Filling;
  progress: (p: number) => void;
  done: () => void;
}

function Minigame({ mini, send }: { mini: KitchenMini; send: Send }) {
  const [finished, setFinished] = useState(false);
  const last = useRef({ p: 0, at: 0 });
  const text = MINI_TEXT[mini.kind];
  const [how, setHow] = useState(text.how);
  const progress = (p: number) => {
    const q = Math.round(Math.min(1, p) * 10) / 10;
    const now = performance.now();
    if (q === last.current.p || now - last.current.at < 120) return;
    last.current = { p: q, at: now };
    send({ t: 'mini', id: mini.id, ev: 'prog', p: q });
  };
  const done = () => {
    if (finished) return;
    setFinished(true);
    vibrate([30, 40, 70]);
    send({ t: 'mini', id: mini.id, ev: 'done' });
  };
  const props: MiniProps & { setHow: (s: string) => void } = { seed: mini.id, f: mini.f, progress, done, setHow };
  return (
    <div class={`pv k-mini k-mini-${mini.kind}`}>
      <div class="k-mini-head">
        <div class="k-mini-title">{text.title}</div>
        <div class="k-mini-how">{finished ? 'Done!' : how}</div>
      </div>
      <div class="k-mini-stage">
        {mini.kind === 'roll' && <RollGame {...props} />}
        {mini.kind === 'fold' && <FoldGame {...props} />}
        {mini.kind === 'boil' && <BoilGame {...props} />}
        {mini.kind === 'wash' && <WashGame {...props} />}
        {finished && <div class="k-mini-done pop-in">✓</div>}
      </div>
      <button class="btn btn-ghost k-mini-leave" onClick={() => send({ t: 'mini', id: mini.id, ev: 'cancel' })}>
        Leave station
      </button>
    </div>
  );
}

/** Pointer position in the 300×300 SVG space. */
function svgPoint(svg: SVGSVGElement, e: PointerEvent) {
  const r = svg.getBoundingClientRect();
  const s = Math.min(r.width, r.height);
  return { x: ((e.clientX - r.left - (r.width - s) / 2) / s) * 300, y: ((e.clientY - r.top - (r.height - s) / 2) / s) * 300 };
}

/** Shared drag plumbing for the minigames. */
function useDrag(onMove: (p: { x: number; y: number }, prev: { x: number; y: number } | null, down: boolean) => void) {
  const ref = useRef<SVGSVGElement>(null);
  const cb = useRef(onMove);
  cb.current = onMove;
  useEffect(() => {
    const svg = ref.current!;
    let prev: { x: number; y: number } | null = null;
    let pid: number | null = null;
    const down = (e: PointerEvent) => {
      if (pid !== null) return;
      e.preventDefault();
      pid = e.pointerId;
      svg.setPointerCapture?.(pid);
      prev = svgPoint(svg, e);
      cb.current(prev, null, true);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      const p = svgPoint(svg, e);
      cb.current(p, prev, false);
      prev = p;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      prev = null;
    };
    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    return () => {
      svg.removeEventListener('pointerdown', down);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
    };
  }, []);
  return ref;
}

const COBALT = '#2f5fae';

function plateDots(cx: number, cy: number, r: number, n: number, size: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return <circle cx={cx + r * Math.cos(a)} cy={cy + r * Math.sin(a)} r={size} fill={COBALT} />;
  });
}

// ---- Roll ------------------------------------------------------------------

const ROLL_NEED = 1500;

function RollGame({ progress, done }: MiniProps) {
  const [p, setP] = useState(0);
  const [pinY, setPinY] = useState(150);
  const acc = useRef(0);
  const ref = useDrag((pt, prev) => {
    setPinY(Math.max(70, Math.min(230, pt.y)));
    if (!prev || acc.current >= ROLL_NEED) return;
    acc.current += Math.abs(pt.y - prev.y) + Math.abs(pt.x - prev.x) * 0.3;
    const k = Math.min(1, acc.current / ROLL_NEED);
    setP(k);
    progress(k);
    if (k >= 1) done();
  });
  const rx = 62 + 78 * p;
  const ry = 48 + 52 * p;
  return (
    <svg ref={ref} viewBox="0 0 300 300" class="k-mini-svg">
      <rect x="14" y="20" width="272" height="260" rx="26" fill="#e3bf86" stroke="#9b6a32" stroke-width="5" />
      <path d="M40 60 Q150 52 260 66 M36 140 Q150 132 264 146 M40 220 Q150 214 262 226" stroke="rgba(120,70,20,.18)" stroke-width="4" fill="none" />
      <ellipse cx="150" cy="150" rx={rx} ry={ry} fill={p > 0.95 ? '#f9e9c4' : '#f3dcab'} stroke="#cfa964" stroke-width="4" />
      <ellipse cx={150 - rx * 0.25} cy={150 - ry * 0.3} rx={rx * 0.4} ry={ry * 0.18} fill="#fff8e6" opacity=".7" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle cx={70 + ((i * 53) % 160)} cy={70 + ((i * 71) % 160)} r="2.5" fill="#fff" opacity=".8" />
      ))}
      <g transform={`translate(0 ${pinY - 150})`}>
        <rect x="56" y="136" width="188" height="28" rx="14" fill="#d59a5a" stroke="#8a5424" stroke-width="4" />
        <rect x="18" y="142" width="42" height="16" rx="8" fill="#9b6230" />
        <rect x="240" y="142" width="42" height="16" rx="8" fill="#9b6230" />
        <path d="M70 144 H230" stroke="#f0c28a" stroke-width="4" stroke-linecap="round" opacity=".7" />
      </g>
      <ProgressArc p={p} />
    </svg>
  );
}

// ---- Fold ------------------------------------------------------------------

const CRIMPS = 7;

function crescentPath(cx: number, cy: number, r: number) {
  return `M ${cx - r} ${cy} A ${r} ${r * 0.9} 0 0 1 ${cx + r} ${cy} Q ${cx} ${cy + r * 0.35} ${cx - r} ${cy} Z`;
}

function FoldGame({ f, progress, done, setHow }: MiniProps & { setHow: (s: string) => void }) {
  const [folded, setFolded] = useState(false);
  const [pinched, setPinched] = useState<boolean[]>(() => Array(CRIMPS).fill(false));
  const start = useRef<{ x: number; y: number } | null>(null);
  const color = f ? fillingInfo(f).hex : '#f3cf6b';
  const dots = useMemo(
    () =>
      Array.from({ length: CRIMPS }, (_, k) => {
        const a = Math.PI - ((k + 0.5) * Math.PI) / CRIMPS;
        return { x: 150 + 118 * Math.cos(a), y: 200 - 106 * Math.sin(a) };
      }),
    [],
  );
  const ref = useDrag((pt, prev, isDown) => {
    if (!folded) {
      if (isDown) start.current = pt;
      else if (start.current && Math.hypot(pt.x - start.current.x, pt.y - start.current.y) > 70) {
        start.current = null;
        setFolded(true);
        setHow('Now pinch the edge – tap every dot');
        progress(0.3);
        vibrate(20);
      }
      return;
    }
    // Pinch any dot the finger passes over.
    const hit = dots.findIndex((d, i) => !pinched[i] && Math.hypot(d.x - pt.x, d.y - pt.y) < 34);
    if (hit < 0) return;
    const next = pinched.map((v, i) => v || i === hit);
    setPinched(next);
    vibrate(8);
    const n = next.filter(Boolean).length;
    progress(0.3 + (0.7 * n) / CRIMPS);
    if (n === CRIMPS) done();
    void prev;
  });
  return (
    <svg ref={ref} viewBox="0 0 300 300" class="k-mini-svg">
      <rect x="14" y="20" width="272" height="260" rx="26" fill="#f0dcb0" stroke="#a87a3e" stroke-width="5" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <circle cx={40 + ((i * 67) % 220)} cy={44 + ((i * 41) % 220)} r="3" fill="#fff" opacity=".8" />
      ))}
      {!folded ? (
        <g class="k-fold-open">
          <circle cx="150" cy="150" r="112" fill="#f7e2b2" stroke="#cfa964" stroke-width="5" />
          <ellipse cx="150" cy="150" rx="46" ry="38" fill={color} stroke="rgba(0,0,0,.25)" stroke-width="3" />
          <ellipse cx="138" cy="140" rx="16" ry="7" fill="#fff" opacity=".35" />
          <path d="M60 90 Q150 30 240 90" fill="none" stroke="#2a120a" stroke-opacity=".35" stroke-width="5" stroke-dasharray="10 10" stroke-linecap="round" />
          <path d="M228 76 l14 14 l-20 4" fill="none" stroke="#2a120a" stroke-opacity=".35" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
        </g>
      ) : (
        <g class="k-fold-closed">
          <path d={crescentPath(150, 200, 124)} fill="#f7e2b2" stroke="#cfa964" stroke-width="5" stroke-linejoin="round" />
          <path d={`M 70 196 Q 150 110 230 196`} fill="none" stroke={color} stroke-width="10" opacity=".35" stroke-linecap="round" />
          {dots.map((d, i) =>
            pinched[i] ? (
              <path
                d={`M ${d.x - 9} ${d.y - 4} q 4.5 8 9 0 t 9 0`}
                fill="none"
                stroke="#b58a4a"
                stroke-width="5"
                stroke-linecap="round"
                transform={`rotate(${((Math.atan2(d.y - 200, d.x - 150) * 180) / Math.PI + 90).toFixed(1)} ${d.x} ${d.y})`}
              />
            ) : (
              <circle cx={d.x} cy={d.y} r="15" fill="#2f5fae" fill-opacity=".85" stroke="#fff" stroke-width="4" class="k-pulse" />
            ),
          )}
        </g>
      )}
      <ProgressArc p={folded ? 0.3 + (0.7 * pinched.filter(Boolean).length) / CRIMPS : 0} />
    </svg>
  );
}

// ---- Boil ------------------------------------------------------------------

const STIR_NEED = Math.PI * 4;

function BoilGame({ seed, f, progress, done, setHow }: MiniProps & { setHow: (s: string) => void }) {
  const [stir, setStir] = useState(0);
  const [spoon, setSpoon] = useState<{ x: number; y: number } | null>(null);
  const [scooped, setScooped] = useState([false, false, false]);
  const floats = stir >= STIR_NEED;
  const spots = useMemo(() => {
    const rng = mulberry32(seed);
    return [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + rng() * 1.2;
      return { x: 150 + Math.cos(a) * (40 + rng() * 30), y: 150 + Math.sin(a) * (40 + rng() * 30), rot: rng() * 60 - 30 };
    });
  }, [seed]);
  const ref = useDrag((pt, prev, isDown) => {
    if (!floats) {
      setSpoon(pt);
      if (!prev) return;
      const a0 = Math.atan2(prev.y - 150, prev.x - 150);
      const a1 = Math.atan2(pt.y - 150, pt.x - 150);
      let da = a1 - a0;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      // Only real circles count, not jiggling in the middle.
      if (Math.hypot(pt.x - 150, pt.y - 150) < 30) return;
      const next = Math.min(STIR_NEED, stir + Math.abs(da));
      setStir(next);
      progress((0.6 * next) / STIR_NEED);
      if (next >= STIR_NEED) {
        setSpoon(null);
        setHow('They float! Tap each one to scoop it out');
        vibrate([20, 30, 20]);
      }
      return;
    }
    if (!isDown) return;
    const hit = spots.findIndex((s, i) => !scooped[i] && Math.hypot(s.x - pt.x, s.y - pt.y) < 44);
    if (hit < 0) return;
    const next = scooped.map((v, i) => v || i === hit);
    setScooped(next);
    vibrate(10);
    const n = next.filter(Boolean).length;
    progress(0.6 + (0.4 * n) / 3);
    if (n === 3) done();
  });
  const heat = stir / STIR_NEED;
  const color = f ? fillingInfo(f).hex : '#f3cf6b';
  return (
    <svg ref={ref} viewBox="0 0 300 300" class="k-mini-svg">
      <circle cx="150" cy="150" r="140" fill="#d9dde3" stroke="#6f7787" stroke-width="6" />
      <circle cx="150" cy="150" r="122" fill={floats ? '#7fc0e3' : `rgb(${110 + heat * 20}, ${170 + heat * 20}, ${215})`} />
      {Array.from({ length: Math.round(4 + heat * 14) }, (_, i) => {
        const rng = mulberry32(seed * 31 + i);
        return <circle cx={60 + rng() * 180} cy={60 + rng() * 180} r={3 + rng() * 5} fill="#fff" opacity=".55" class="k-bubble" style={{ animationDelay: `${(rng() * 1.2).toFixed(2)}s` }} />;
      })}
      {spots.map((s, i) =>
        scooped[i] ? null : (
          <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`} opacity={floats ? 1 : 0.35}>
            <g class={floats ? 'k-float' : ''}>
              <path d={crescentPath(0, 10, 34)} fill={floats ? '#f1c46a' : '#f7ead0'} stroke="#b5842c" stroke-width="4" stroke-linejoin="round" />
              <circle cx="0" cy="-4" r="5" fill={color} />
            </g>
          </g>
        ),
      )}
      {spoon && (
        <g transform={`translate(${spoon.x} ${spoon.y})`}>
          <ellipse rx="20" ry="14" fill="#c98a4b" stroke="#6b3a14" stroke-width="4" />
          <path d="M14 -10 L60 -60" stroke="#c98a4b" stroke-width="10" stroke-linecap="round" />
        </g>
      )}
      {!floats && !spoon && (
        <path d="M150 50 A 100 100 0 1 1 64 100" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="6" stroke-dasharray="12 12" stroke-linecap="round" />
      )}
      <ProgressArc p={floats ? 0.6 + (0.4 * scooped.filter(Boolean).length) / 3 : 0.6 * heat} />
    </svg>
  );
}

// ---- Wash ------------------------------------------------------------------

function WashGame({ seed, progress, done }: MiniProps) {
  const spots = useMemo(() => {
    const rng = mulberry32(seed * 7 + 3);
    return Array.from({ length: 6 }, () => {
      const a = rng() * Math.PI * 2;
      const d = 20 + rng() * 70;
      return { x: 150 + Math.cos(a) * d, y: 150 + Math.sin(a) * d, r: 18 + rng() * 10 };
    });
  }, [seed]);
  const [dirt, setDirt] = useState(() => spots.map(() => 1));
  const [bubbles, setBubbles] = useState<{ x: number; y: number; id: number }[]>([]);
  const bubbleId = useRef(0);
  const ref = useDrag((pt, prev) => {
    if (!prev) return;
    const moved = Math.hypot(pt.x - prev.x, pt.y - prev.y);
    let changed = false;
    const next = dirt.map((d, i) => {
      const s = spots[i];
      if (d <= 0 || Math.hypot(s.x - pt.x, s.y - pt.y) > s.r + 16) return d;
      changed = true;
      return Math.max(0, d - moved * 0.014);
    });
    if (bubbleId.current++ % 3 === 0) setBubbles((b) => [...b.slice(-14), { x: pt.x, y: pt.y, id: bubbleId.current }]);
    if (!changed) return;
    setDirt(next);
    const left = next.reduce((a, b) => a + b, 0);
    const p = 1 - left / spots.length;
    progress(p);
    if (left <= 0) done();
  });
  const p = 1 - dirt.reduce((a, b) => a + b, 0) / spots.length;
  return (
    <svg ref={ref} viewBox="0 0 300 300" class="k-mini-svg">
      <rect x="6" y="6" width="288" height="288" rx="40" fill="#8fc6e3" />
      <circle cx="150" cy="150" r="128" fill="#fdfaf2" stroke="#8ea6cf" stroke-width="5" />
      <circle cx="150" cy="150" r="92" fill="none" stroke="#dfe7f4" stroke-width="3" />
      {plateDots(150, 150, 110, 18, 5)}
      {spots.map((s, i) => (
        <g opacity={dirt[i]}>
          <circle cx={s.x} cy={s.y} r={s.r} fill="#8a6a3a" />
          <circle cx={s.x + s.r * 0.5} cy={s.y - s.r * 0.4} r={s.r * 0.45} fill="#6f5530" />
          <circle cx={s.x - s.r * 0.6} cy={s.y + s.r * 0.3} r={s.r * 0.3} fill="#a07d45" />
        </g>
      ))}
      {bubbles.map((b) => (
        <circle cx={b.x} cy={b.y} r="9" fill="#fff" fill-opacity=".55" stroke="#bfe3f5" stroke-width="2" class="k-bubble-pop" key={b.id} />
      ))}
      <ProgressArc p={p} />
    </svg>
  );
}

function ProgressArc({ p }: { p: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <g transform="translate(266 34)">
      <circle r={r + 6} fill="rgba(42,18,10,.85)" />
      <circle r={r} fill="none" stroke="rgba(255,244,220,.2)" stroke-width="6" />
      <circle
        r={r}
        fill="none"
        stroke="var(--me, #ffd23f)"
        stroke-width="6"
        stroke-linecap="round"
        stroke-dasharray={String(c)}
        stroke-dashoffset={String(c * (1 - Math.min(1, p)))}
        transform="rotate(-90)"
      />
    </g>
  );
}
