/** Maluch Rally phone controller: hold a finger on the pad. Up/down is gas/brake, left/right steers. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import type { Props } from './views';

const SEND_EVERY_MS = 50;
const DEAD = 6;
const STEP = 5;

function shape(v: number) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.min(100, Math.round(a / STEP) * STEP);
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function RallyPad({ view, me, send }: Props<'rally'>) {
  const pad = useRef<HTMLDivElement>(null);
  const [dot, setDot] = useState<{ x: number; y: number } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    const el = pad.current!;
    let want = { x: 0, y: 0 };
    let sent = { x: 0, y: 0 };
    let lastSend = 0;
    let timer: number | undefined;
    let pointer: number | null = null;
    const keys = { l: false, r: false, u: false, d: false };

    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (want.x === sent.x && want.y === sent.y) return;
      const now = performance.now();
      const idle = want.x === 0 && want.y === 0;
      if (!idle && now - lastSend < SEND_EVERY_MS) {
        timer = window.setTimeout(flush, SEND_EVERY_MS - (now - lastSend));
        return;
      }
      lastSend = now;
      sent = want;
      sendRef.current({ t: 'stick', x: sent.x, y: sent.y });
    };
    const fromPoint = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, ((cx - r.left) / r.width) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, ((cy - r.top) / r.height) * 2 - 1));
      setDot({ x: nx, y: ny });
      want = { x: shape(nx * 100), y: shape(ny * 100) };
      flush();
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      pointer = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      try {
        navigator.vibrate?.(8);
      } catch {
        /* not supported */
      }
      fromPoint(e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      e.preventDefault();
      fromPoint(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      setDot(null);
      want = { x: 0, y: 0 };
      flush();
    };
    const fromKeys = () => {
      want = { x: (keys.r ? 100 : 0) - (keys.l ? 100 : 0), y: (keys.d ? 100 : 0) - (keys.u ? 100 : 0) };
      setDot(want.x || want.y ? { x: want.x / 100, y: want.y / 100 } : null);
      flush();
    };
    const key = (isDown: boolean) => (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.l = isDown;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.r = isDown;
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.u = isDown;
      else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.d = isDown;
      else return;
      e.preventDefault();
      fromKeys();
    };
    const keyDown = key(true);
    const keyUp = key(false);
    const reset = () => {
      pointer = null;
      keys.l = keys.r = keys.u = keys.d = false;
      setDot(null);
      want = { x: 0, y: 0 };
      flush();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
      if (sent.x || sent.y) sendRef.current({ t: 'stick', x: 0, y: 0 });
    };
  }, []);

  const gas = dot ? Math.max(0, -dot.y) : 0;
  const brake = dot ? Math.max(0, dot.y) : 0;
  const overlay =
    view.phase === 'countdown'
      ? { big: 'Get ready!', small: `Race ${view.race} of ${view.races} – find your car on the TV` }
      : view.phase === 'finished'
        ? { big: `Finished ${ordinal(view.pos)}!`, small: 'Watch the others come in…' }
        : view.phase === 'standings'
          ? { big: view.pos ? `${ordinal(view.pos)} place` : 'Race over', small: view.race < view.races ? 'Next track coming up – look at the TV' : 'Final results on the TV' }
          : null;

  return (
    <div class="pv rally-pad-view" style={{ '--me': colorHex(me.color) }}>
      <div class="rally-pad-top">
        <span class="rally-pad-pos">
          {view.pos ? ordinal(view.pos) : '–'}
          <small> / {view.of}</small>
        </span>
        <span>
          Lap <b>{view.lap}</b>/{view.laps}
        </span>
        <span class="muted">
          Race {view.race}/{view.races}
        </span>
      </div>
      <div class="rally-pad" ref={pad}>
        <div class="rally-pad-grid" />
        <div class="rally-pad-axis h" />
        <div class="rally-pad-axis v" />
        <div class="rally-pad-label up">GAS ▲</div>
        <div class="rally-pad-label down">▼ BRAKE / REVERSE</div>
        <div class="rally-pad-label left">◀</div>
        <div class="rally-pad-label right">▶</div>
        <div class="rally-pad-gas" style={{ transform: `scaleY(${gas})` }} />
        <div class="rally-pad-brake" style={{ transform: `scaleY(${brake})` }} />
        {dot ? (
          <div class="rally-pad-dot" style={{ left: `${(dot.x + 1) * 50}%`, top: `${(dot.y + 1) * 50}%` }}>
            <Pierogi color={colorHex(me.color)} size={64} mood="wow" />
          </div>
        ) : (
          <div class="rally-pad-hint">Hold your thumb here to drive</div>
        )}
      </div>
      {overlay && (
        <div class="rally-pad-overlay">
          <Pierogi color={colorHex(me.color)} size={110} mood={view.phase === 'finished' ? 'wow' : 'happy'} class="bob" />
          <div class="phone-big">{overlay.big}</div>
          <div class="muted">{overlay.small}</div>
        </div>
      )}
    </div>
  );
}
