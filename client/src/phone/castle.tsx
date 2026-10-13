/**
 * Malbork Castle on the phone: the whole screen is a bow. Put a thumb down anywhere and pull back
 * (down) to draw; sideways turns the aim. Let go to loose the arrow. Hold a full draw for a moment
 * and it glows: a charged arrow goes through several monsters. The aim line shows on the TV.
 * Under the bow, the Volley button: once it has cooled down, tap it and the next shots fire three
 * arrows in a row each.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import { COOLDOWN_S, MAX_ANGLE, MIN_DRAW, VOLLEY_ARROWS, VOLLEY_SHOTS } from '../games/castle/logic';
import type { Props } from './views';

function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not supported (iOS) */
  }
}

/** Hold a full draw this long to charge the arrow. */
const CHARGE_MS = 600;
/** Aim messages at most this often. */
const SEND_MS = 60;

interface Draw {
  a: number;
  p: number;
  charged: boolean;
}

export function CastlePad({ view, me, send, offset }: Props<'castle'>) {
  const color = colorHex(me.color);
  if (view.phase === 'won' || view.phase === 'lost')
    return (
      <div class="pv pv-center">
        <Pierogi color={color} size={160} mood={view.phase === 'won' ? 'wow' : 'dead'} class="bob" />
        <div class="phone-huge">{view.title}</div>
        <p class="muted">
          {view.kills} slain · {view.score} pts
        </p>
        <div class="pill">📺</div>
      </div>
    );
  return <Bow view={view} me={me} send={send} offset={offset} />;
}

function Bow({ view, me, send, offset }: Props<'castle'>) {
  const color = colorHex(me.color);
  const zone = useRef<HTMLDivElement>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const [draw, setDraw] = useState<Draw | null>(null);
  const [nocking, setNocking] = useState(false);

  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    let pid: number | null = null;
    let ox = 0;
    let oy = 0;
    let cur: Draw = { a: 0, p: 0, charged: false };
    let fullSince = 0;
    let lastSend = 0;
    let sent = '';
    let readyAt = 0;
    let chargeTimer = 0;
    let nockTimer = 0;
    // Keyboard on the /dev bench: ← → aim, hold Space to draw, let go to shoot, Shift for a volley.
    const keys = { l: false, r: false, space: false };
    let keyRaf = 0;
    let keyLast = 0;

    const pullPx = () => Math.max(110, Math.min(230, el.getBoundingClientRect().height * 0.36));

    const push = (force = false) => {
      const msg = `${Math.round(cur.a)}|${Math.round(cur.p * 100)}|${cur.charged}`;
      const now = performance.now();
      if (msg === sent || (!force && now - lastSend < SEND_MS)) return;
      sent = msg;
      lastSend = now;
      sendRef.current({ t: 'bow', ev: 'aim', a: Math.round(cur.a), p: Math.round(cur.p * 100), c: cur.charged || undefined });
    };

    const update = (a: number, p: number) => {
      const was = cur.charged;
      let charged = cur.charged;
      const now = performance.now();
      if (p >= 0.95) {
        if (!fullSince) fullSince = now;
        if (!charged && now - fullSince >= CHARGE_MS) charged = true;
      } else {
        fullSince = 0;
        charged = false;
      }
      cur = { a: Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, a)), p, charged };
      if (charged && !was) vibrate([25, 30, 25]);
      setDraw(cur);
      push();
      // A held full draw charges without moving: check again when it should be ready.
      clearTimeout(chargeTimer);
      if (p >= 0.95 && !charged) chargeTimer = window.setTimeout(() => pid !== null || keys.space ? update(cur.a, cur.p) : undefined, CHARGE_MS - (now - fullSince) + 5);
    };

    const release = (shoot: boolean) => {
      clearTimeout(chargeTimer);
      const d = cur;
      fullSince = 0;
      cur = { a: d.a, p: 0, charged: false };
      setDraw(null);
      sent = '';
      const now = performance.now();
      if (shoot && d.p >= MIN_DRAW && now >= readyAt) {
        sendRef.current({ t: 'bow', ev: 'fire', a: Math.round(d.a), p: Math.round(d.p * 100), c: d.charged || undefined });
        vibrate(d.charged ? [40, 20, 60] : 20);
        readyAt = now + COOLDOWN_S * 1000;
        setNocking(true);
        clearTimeout(nockTimer);
        nockTimer = window.setTimeout(() => setNocking(false), COOLDOWN_S * 1000);
      } else sendRef.current({ t: 'bow', ev: 'cancel', a: Math.round(d.a), p: 0 });
    };

    const pdown = (e: PointerEvent) => {
      e.preventDefault();
      const old = pid;
      pid = e.pointerId;
      if (old !== null && old !== pid && el.hasPointerCapture?.(old)) el.releasePointerCapture(old);
      el.setPointerCapture?.(pid);
      ox = e.clientX;
      oy = e.clientY;
      fullSince = 0;
      update(cur.a, 0);
      vibrate(6);
    };
    const pmove = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      const dx = e.clientX - ox;
      const dy = e.clientY - oy;
      const len = Math.hypot(dx, dy);
      // Pull back (down) to shoot up the field; the arrow flies away from the thumb.
      const a = len > 12 ? (Math.atan2(-dx, Math.max(dy, 1)) * 180) / Math.PI : cur.a;
      update(a, Math.min(1, len / pullPx()));
    };
    const pup = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      release(e.type === 'pointerup');
    };

    const keyLoop = (now: number) => {
      const dt = Math.min(0.05, (now - keyLast) / 1000);
      keyLast = now;
      let a = cur.a + ((keys.r ? 1 : 0) - (keys.l ? 1 : 0)) * 70 * dt;
      a = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, a));
      const p = keys.space ? Math.min(1, cur.p + dt / 0.8) : cur.p;
      if (keys.space || keys.l || keys.r) update(a, p);
      keyRaf = keys.space || keys.l || keys.r ? requestAnimationFrame(keyLoop) : 0;
    };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'shift') {
        if (down && !e.repeat) sendRef.current({ t: 'act' });
        return;
      }
      if (k === 'arrowleft' || k === 'a') keys.l = down;
      else if (k === 'arrowright' || k === 'd') keys.r = down;
      else if (k === ' ' || k === 'enter') {
        if (e.repeat) return e.preventDefault();
        keys.space = down;
        if (!down) release(true);
      } else return;
      e.preventDefault();
      if (!keyRaf && (keys.l || keys.r || keys.space)) {
        keyLast = performance.now();
        keyRaf = requestAnimationFrame(keyLoop);
      }
    };
    const keyDown = onKey(true);
    const keyUp = onKey(false);
    const reset = () => {
      keys.l = keys.r = keys.space = false;
      if (pid !== null || cur.p > 0) {
        pid = null;
        release(false);
      }
    };

    el.addEventListener('pointerdown', pdown);
    el.addEventListener('pointermove', pmove);
    el.addEventListener('pointerup', pup);
    el.addEventListener('pointercancel', pup);
    el.addEventListener('lostpointercapture', pup);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      el.removeEventListener('pointerdown', pdown);
      el.removeEventListener('pointermove', pmove);
      el.removeEventListener('pointerup', pup);
      el.removeEventListener('pointercancel', pup);
      el.removeEventListener('lostpointercapture', pup);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
      cancelAnimationFrame(keyRaf);
      clearTimeout(chargeTimer);
      clearTimeout(nockTimer);
    };
  }, []);

  const p = draw?.p ?? 0;
  const a = draw?.a ?? 0;
  const charged = !!draw?.charged;
  const weak = draw && p < MIN_DRAW;
  const wallLow = view.wall <= 30;
  return (
    <div class="pv cs-pad" style={{ '--me': color }}>
      <div class="ar-top">
        <span class="ar-score">
          <b>{view.score}</b> pts
        </span>
        <span class={`cs-wall ${wallLow ? 'low' : ''}`}>
          🏰
          <span class="cs-wall-bar">
            <i style={{ width: `${view.wall}%` }} />
          </span>
          {view.wall}%
        </span>
        <span class="muted cs-wave">
          ⚔ {view.wave}/{view.waves}
        </span>
      </div>
      {(view.title || view.text) && (
        <div class="ar-msg" key={view.title}>
          {view.title && <div class={`ar-title pop-in ${view.phase === 'play' ? 'cs-alert' : ''}`}>{view.title}</div>}
          {view.text && <div class="ar-text muted">{view.text}</div>}
        </div>
      )}
      <div class={`cs-zone ${draw ? 'active' : ''} ${charged ? 'charged' : ''}`} ref={zone}>
        <svg class="cs-bow" viewBox="-160 -220 320 340" aria-hidden="true">
          <circle r="132" cy="0" fill="none" stroke="rgba(251,240,217,.1)" stroke-width="12" />
          <circle
            r="132"
            fill="none"
            stroke={charged ? '#ffd23f' : p >= MIN_DRAW ? color : 'rgba(251,240,217,.35)'}
            stroke-width="12"
            stroke-linecap="round"
            stroke-dasharray={`${(p * 2 * Math.PI * 132).toFixed(1)} 999`}
            transform="rotate(90)"
          />
          <g transform={`rotate(${a.toFixed(1)})`}>
            {/* Limbs */}
            <path d="M-110 20 Q0 -110 110 20" fill="none" stroke="#2a120a" stroke-width="20" stroke-linecap="round" />
            <path d="M-110 20 Q0 -110 110 20" fill="none" stroke="#c98a4b" stroke-width="11" stroke-linecap="round" />
            <path d="M-12 -46 h24" stroke="#7a4a24" stroke-width="20" stroke-linecap="round" />
            {/* String */}
            <path d={`M-110 20 L0 ${(20 + p * 90).toFixed(1)} L110 20`} fill="none" stroke="#fff4dc" stroke-width="4" />
            {/* Arrow */}
            {!nocking && (
              <g transform={`translate(0 ${(p * 90).toFixed(1)})`}>
                <path d="M0 20 V-150" stroke="#2a120a" stroke-width="11" stroke-linecap="round" />
                <path d="M0 20 V-150" stroke={charged ? '#ffd23f' : '#e8d2a8'} stroke-width="6" stroke-linecap="round" />
                <path d="M0 -176 L14 -148 H-14 Z" fill="#c9ccd3" stroke="#2a120a" stroke-width="4" stroke-linejoin="round" />
                <path d="M0 0 L-14 22 L0 14 L14 22 Z" fill={color} stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
              </g>
            )}
          </g>
        </svg>
        <div class="cs-hint">
          {nocking
            ? 'Nocking…'
            : !draw
              ? view.phase === 'break'
                ? 'Practise! Pull back ↓ and let go'
                : 'Pull back ↓ · aim · let go'
              : charged
                ? 'Charged! Let go'
                : weak
                  ? 'Pull further…'
                  : p >= 0.95
                    ? 'Hold it…'
                    : `${Math.round(p * 100)}%`}
        </div>
      </div>
      <VolleyButton view={view} offset={offset} onPress={() => send({ t: 'act' })} />
    </div>
  );
}

/** The volley skill: cools down, then a tap loads three-arrow shots. `offset` turns host time into phone time. */
function VolleyButton({ view, offset, onPress }: { view: Props<'castle'>['view']; offset: number; onPress: () => void }) {
  const fill = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!view.skillAt || view.volley > 0) {
      setLeft(0);
      return;
    }
    const until = view.skillAt + offset;
    let raf = 0;
    const loop = () => {
      const ms = until - Date.now();
      const k = Math.max(0, Math.min(1, 1 - ms / view.skillCool));
      if (fill.current) fill.current.style.transform = `scaleX(${k})`;
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms > 0) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [view.skillAt, view.skillCool, view.volley, offset]);
  const on = view.volley > 0;
  const cooling = !on && left > 0;
  const ready = !on && !cooling;
  return (
    <button
      class={`cs-volley ${on ? 'on' : ''} ${cooling ? 'cooling' : ''} ${ready ? 'ready' : ''}`}
      disabled={!ready}
      onPointerDown={(e) => {
        e.preventDefault();
        if (!ready) return;
        onPress();
        vibrate([20, 20, 20]);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {cooling && <div class="cs-volley-cool" ref={fill} />}
      <span class="cs-volley-arrows" aria-hidden="true">
        {Array.from({ length: VOLLEY_ARROWS }, () => (
          <i />
        ))}
      </span>
      <span>
        {on ? (
          <>
            Volley! <b>{view.volley}</b> of {VOLLEY_SHOTS} shots left
          </>
        ) : cooling ? (
          <>Volley in {left}s</>
        ) : (
          <>Volley ready – tap!</>
        )}
      </span>
    </button>
  );
}
