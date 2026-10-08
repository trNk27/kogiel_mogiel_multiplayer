/**
 * The arena pad, shared by Czołgi, Grzybki, Pushy Pierogi, Strzelnica, Babcia’s Cookbook and Kafelki:
 * a floating joystick that fills most of the screen and up to two buttons under it.
 * The game itself is on the TV; the host says what the buttons are called and when they cool down.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PadView } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import type { Me, Send } from './PhoneApp';
import { keepStickInSync } from './stickSync';

function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not supported (iOS) */
  }
}

/** Max knob travel in px. */
const STICK_R = 62;
/** Keyboard keys for the buttons on the /dev bench: Space / Enter and Shift / F. */
const BTN_KEYS = [
  [' ', 'enter', 'e'],
  ['shift', 'f', 'q'],
];

export function ArenaPad({ view, me, send, offset }: { view: PadView; me: Me; send: Send; offset: number }) {
  const zone = useRef<HTMLDivElement>(null);
  const baseEl = useRef<HTMLDivElement>(null);
  const knobEl = useRef<HTMLDivElement>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const [active, setActive] = useState(false);
  const [down, setDown] = useState<boolean[]>([false, false]);
  const downRef = useRef(down);
  downRef.current = down;
  const buttonsRef = useRef(view.buttons);
  buttonsRef.current = view.buttons;

  const press = (b: number, on: boolean) => {
    if (b >= buttonsRef.current.length || downRef.current[b] === on) return;
    if (on && buttonsRef.current[b].off) return;
    const next = [...downRef.current];
    next[b] = on;
    downRef.current = next;
    setDown(next);
    if (on) vibrate(14);
    sendRef.current({ t: 'btn', b, on });
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  useEffect(() => {
    const el = zone.current;
    if (!el) return;
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
    /** Quantise (32 directions, three speeds) and throttle to ~20 messages a second. */
    const queue = (x: number, y: number) => {
      const m = Math.min(1, Math.hypot(x, y));
      let q = { x: 0, y: 0 };
      if (m > 0.18) {
        const step = Math.PI / 16;
        const a = Math.round(Math.atan2(y, x) / step) * step;
        const mag = m > 0.75 ? 100 : m > 0.45 ? 66 : 33;
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

    const pdown = (e: PointerEvent) => {
      e.preventDefault();
      // A new touch always takes over: if the last finger's "up" never arrived (it happens on
      // iOS), refusing it would leave the stick dead.
      const old = pid;
      pid = e.pointerId;
      if (old !== null && old !== pid && el.hasPointerCapture?.(old)) el.releasePointerCapture(old);
      el.setPointerCapture?.(pid);
      const r = el.getBoundingClientRect();
      ox = e.clientX;
      oy = e.clientY;
      place(ox - r.left, oy - r.top, 0, 0);
      setActive(true);
      vibrate(6);
    };
    const pmove = (e: PointerEvent) => {
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
    const pup = (e: PointerEvent) => {
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
      else {
        const b = BTN_KEYS.findIndex((ks) => ks.includes(k));
        if (b < 0) return;
        e.preventDefault();
        if (!e.repeat) pressRef.current(b, isDown);
        return;
      }
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
      pressRef.current(0, false);
      pressRef.current(1, false);
    };

    el.addEventListener('pointerdown', pdown);
    el.addEventListener('pointermove', pmove);
    el.addEventListener('pointerup', pup);
    el.addEventListener('pointercancel', pup);
    el.addEventListener('lostpointercapture', pup);
    const stopSync = keepStickInSync(() => sent, (x, y) => sendRef.current({ t: 'stick', x, y }));
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', rest);
    document.addEventListener('visibilitychange', reset);
    return () => {
      el.removeEventListener('pointerdown', pdown);
      el.removeEventListener('pointermove', pmove);
      el.removeEventListener('pointerup', pup);
      el.removeEventListener('pointercancel', pup);
      el.removeEventListener('lostpointercapture', pup);
      stopSync();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', rest);
      document.removeEventListener('visibilitychange', reset);
      clearTimeout(timer);
      if (sent.x !== 0 || sent.y !== 0) sendRef.current({ t: 'stick', x: 0, y: 0 });
    };
  }, [view.noStick]);

  const out = view.phase === 'out';
  return (
    <div class={`pv ar-pad ${out ? 'is-out' : ''}`} style={{ '--me': colorHex(me.color) }}>
      <div class="ar-top">
        <span class="ar-score">
          <b>{view.score}</b> pts
        </span>
        {view.stats?.map((s) => (
          <span class="ar-stat">
            <small>{s.k}</small> {s.v}
          </span>
        ))}
        <span class="muted">{view.rounds > 1 ? `Round ${view.round}/${view.rounds}` : '📺'}</span>
      </div>
      {(view.title || view.text) && (
        <div class="ar-msg" key={view.title}>
          {view.title && (
            <div class="ar-title pop-in" style={view.accent ? { color: view.accent } : undefined}>
              {view.title}
            </div>
          )}
          {view.text && <div class="ar-text muted">{view.text}</div>}
        </div>
      )}
      {view.noStick ? (
        <div class="ar-idle" key="idle">
          <Pierogi color={colorHex(me.color)} size={150} mood={out ? 'sleep' : 'happy'} class="bob" />
        </div>
      ) : (
        // Keyed, so the zone survives the message above it appearing or going away (Kafelki drops its
        // title when play starts): a new element would leave the stick's listeners on the old one.
        <div class={`k-stick-zone ar-zone ${active ? 'active' : ''}`} ref={zone} key="stick">
          <div class="k-stick-base" ref={baseEl}>
            <div class="k-stick-ring" />
            <div class="k-stick-knob" ref={knobEl}>
              <Pierogi color={colorHex(me.color)} size={64} />
            </div>
          </div>
        </div>
      )}
      {view.buttons.length > 0 && (
        <div class={`ar-btns n${view.buttons.length}`}>
          {view.buttons.map((b, i) => (
            <PadBtn btn={b} down={down[i]} offset={offset} onDown={() => press(i, true)} onUp={() => press(i, false)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PadBtn({ btn, down, offset, onDown, onUp }: { btn: PadButton; down: boolean; offset: number; onDown: () => void; onUp: () => void }) {
  const fill = useRef<HTMLDivElement>(null);
  const [cooling, setCooling] = useState(false);
  // `offset` converts host time to phone time.
  useEffect(() => {
    if (!btn.readyAt) {
      setCooling(false);
      return;
    }
    const until = btn.readyAt + offset;
    const total = btn.cool ?? Math.max(1, until - Date.now());
    let raf = 0;
    const loop = () => {
      const left = until - Date.now();
      const k = Math.max(0, Math.min(1, 1 - left / total));
      if (fill.current) fill.current.style.transform = `scaleX(${k})`;
      setCooling(left > 0);
      if (left > 0) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [btn.readyAt, btn.cool, offset]);
  return (
    <button
      class={`ar-btn ${down ? 'down' : ''} ${btn.off ? 'off' : ''} ${cooling ? 'cooling' : ''}`}
      style={btn.color ? { '--bc': btn.color } : undefined}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        onDown();
      }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {btn.readyAt && <div class="ar-btn-cool" ref={fill} />}
      <span>{btn.label}</span>
    </button>
  );
}
