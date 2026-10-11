/**
 * Maluch Rally phone controller (with a TV). Two ways to drive, picked on the phone:
 * - Thumb pad: hold a thumb on the pad. Left/right steers, up is gas, down brakes – or drifts
 *   while you're turning at speed. Lift your thumb to fire your item.
 * - Tilt: hold the phone like a steering wheel and turn it. The gas is always on; hold BRAKE ·
 *   DRIFT to brake or drift, and tap the item button to fire your item.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { RALLY_ITEMS, colorHex, type RallyEffect } from '../../../shared/protocol';
import { ItemIcon } from '../games/rally/items';
import { Pierogi } from '../lib/art';
import type { Props } from './views';
import { RallyDrive } from './rallyDrive';
import { keepStickInSync } from './stickSync';
import { PedalButton, SteeringWheel, vibrate } from './steer';
import { isIOS, requestTilt, screenAngle, tiltSteer } from './tilt';

type TvMode = 'pad' | 'tilt';
const TV_MODE_KEY = 'cp.tvsteer';

function loadTvMode(): TvMode {
  try {
    return localStorage.getItem(TV_MODE_KEY) === 'tilt' ? 'tilt' : 'pad';
  } catch {
    return 'pad';
  }
}

const SEND_EVERY_MS = 50;
const DEAD = 6;
const STEP = 5;

function shape(v: number) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.min(100, Math.round(a / STEP) * STEP);
}

const FX_TEXT: Record<RallyEffect, string> = {
  spin: 'Spinning out!',
  rocket: 'Rocket! Hands off – it steers itself',
  boost: 'Boost!',
  shield: 'Pot lid up',
  slow: 'Caught in the storm!',
  ink: 'Beet juice on your windscreen!',
  ghost: 'Ghost mode – nothing can touch you',
  tow: 'Lassoed on! Hang on for the slingshot',
  towed: 'Someone lassoed you – you’re dragging them!',
};

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function RallyPad(props: Props<'rally'>) {
  const { view } = props;
  // Without a TV, the phone shows the race itself.
  if (view.net) return <RallyDrive {...props} view={{ ...view, net: view.net }} />;
  return <TvPad {...props} />;
}

/** Thumb pad or tilt: the choice is remembered on the phone. */
function TvPad(props: Props<'rally'>) {
  const [mode, setMode] = useState<TvMode>(loadTvMode);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async (m: TvMode) => {
    setProblem(null);
    if (m === 'tilt') {
      const why = await requestTilt();
      if (why) {
        setProblem(`${why} Use the thumb pad instead.`);
        return;
      }
    }
    setMode(m);
    try {
      localStorage.setItem(TV_MODE_KEY, m);
    } catch {
      /* private mode */
    }
  };
  const chips = (
    <>
      <div class="drive-modes">
        <button class={`chip ${mode === 'pad' ? 'on' : ''}`} onClick={() => choose('pad')}>
          👆 Thumb pad
        </button>
        <button class={`chip ${mode === 'tilt' ? 'on' : ''}`} onClick={() => choose('tilt')}>
          📱 Tilt
        </button>
      </div>
      {problem && <div class="form-error">{problem}</div>}
    </>
  );
  const toggle = (
    <button class="chip rally-mode-chip" onClick={() => choose(mode === 'tilt' ? 'pad' : 'tilt')}>
      {mode === 'tilt' ? '👆 Pad' : '📱 Tilt'}
    </button>
  );
  if (mode === 'tilt')
    return (
      <TiltPad
        {...props}
        chips={chips}
        toggle={toggle}
        onNoReadings={() => {
          setMode('pad');
          setProblem('No tilt readings from this phone – switched to the thumb pad.');
        }}
      />
    );
  return <ThumbPad {...props} chips={chips} toggle={toggle} />;
}

type Extra = { chips: JSX.Element; toggle: JSX.Element };

function TopBar({ view, toggle }: { view: Props<'rally'>['view']; toggle: JSX.Element }) {
  return (
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
      {toggle}
    </div>
  );
}

/** Countdown, finished and standings cards over the controls. The countdown offers the steering choice. */
function Overlay({ view, me, chips }: { view: Props<'rally'>['view']; me: Props<'rally'>['me']; chips: JSX.Element }) {
  const overlay =
    view.phase === 'countdown'
      ? { big: 'Get ready!', small: `Race ${view.race} / ${view.races} · find your car on the TV` }
      : view.phase === 'finished'
        ? { big: `Finished ${ordinal(view.pos)}!`, small: 'Watch the others come in…' }
        : view.phase === 'standings'
          ? { big: view.pos ? `${ordinal(view.pos)} place` : 'Race over', small: view.race < view.races ? 'Next track coming up' : 'Final results on the TV' }
          : null;
  if (!overlay) return null;
  return (
    <div class="rally-pad-overlay">
      <Pierogi color={colorHex(me.color)} size={110} mood={view.phase === 'finished' ? 'wow' : 'happy'} class="bob" />
      <div class="phone-big">{overlay.big}</div>
      <div class="muted">{overlay.small}</div>
      {view.phase === 'countdown' && (
        <div class="rally-pad-steering">
          <div class="section-label">Steering</div>
          {chips}
        </div>
      )}
    </div>
  );
}

function ThumbPad({ view, me, send, chips, toggle }: Props<'rally'> & Extra) {
  const pad = useRef<HTMLDivElement>(null);
  const [dot, setDot] = useState<{ x: number; y: number } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const hasItem = useRef(false);
  hasItem.current = !!view.item;

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
      // Letting go fires the item you're holding.
      if (hasItem.current) {
        hasItem.current = false;
        sendRef.current({ t: 'act' });
      }
    };
    const fromKeys = () => {
      want = { x: (keys.r ? 100 : 0) - (keys.l ? 100 : 0), y: (keys.d ? 100 : 0) - (keys.u ? 100 : 0) };
      setDot(want.x || want.y ? { x: want.x / 100, y: want.y / 100 } : null);
      flush();
    };
    const key = (isDown: boolean) => (e: KeyboardEvent) => {
      const k = e.key;
      if (k === ' ') {
        e.preventDefault();
        if (!isDown && hasItem.current) sendRef.current({ t: 'act' });
        return;
      }
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.l = isDown;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.r = isDown;
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.u = isDown;
      else if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'Shift') keys.d = isDown;
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
    el.addEventListener('lostpointercapture', up);
    const stopSync = keepStickInSync(() => sent, (x, y) => sendRef.current({ t: 'stick', x, y }));
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
      el.removeEventListener('lostpointercapture', up);
      stopSync();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
      if (sent.x || sent.y) sendRef.current({ t: 'stick', x: 0, y: 0 });
    };
  }, []);

  const gas = dot ? Math.max(0, -dot.y) : 0;
  const brake = dot ? Math.max(0, dot.y) : 0;

  return (
    <div class="pv rally-pad-view" style={{ '--me': colorHex(me.color) }}>
      <TopBar view={view} toggle={toggle} />
      <div class="rally-pad" ref={pad}>
        <div class="rally-pad-grid" />
        <div class="rally-pad-axis h" />
        <div class="rally-pad-axis v" />
        <div class="rally-pad-label up">GAS ▲</div>
        <div class={`rally-pad-label down lvl-${view.drift ?? 0}`}>{(view.drift ?? 0) >= 2 ? '▼ LET GO: TURBO!' : '▼ BRAKE · DRIFT'}</div>
        <div class="rally-pad-label left">◀</div>
        <div class="rally-pad-label right">▶</div>
        <div class="rally-pad-gas" style={{ transform: `scaleY(${gas})` }} />
        <div class={`rally-pad-brake lvl-${view.drift ?? 0}`} style={{ transform: `scaleY(${brake})` }} />
        {view.item && (
          <div class={`rally-pad-item ${dot ? 'armed' : ''}`} key={view.item}>
            <ItemIcon item={view.item} size={74} />
            <span>
              <b>{RALLY_ITEMS[view.item].name}</b>
              <small>{dot ? 'Let go to use it!' : RALLY_ITEMS[view.item].does}</small>
            </span>
          </div>
        )}
        {view.fx && <div class={`rally-pad-fx fx-${view.fx}`}>{FX_TEXT[view.fx]}</div>}
        {dot ? (
          <div class="rally-pad-dot" style={{ left: `${(dot.x + 1) * 50}%`, top: `${(dot.y + 1) * 50}%` }}>
            <Pierogi color={colorHex(me.color)} size={64} mood="wow" />
          </div>
        ) : (
          <div class="rally-pad-hint">Hold your thumb here to drive</div>
        )}
      </div>
      <Overlay view={view} me={me} chips={chips} />
    </div>
  );
}

/**
 * Tilt steering with a TV: turn the phone like a wheel. The gas is always on; BRAKE · DRIFT brakes,
 * or drifts while you're turning at speed. The phone sends the same stick as the thumb pad.
 */
function TiltPad({ view, me, send, chips, toggle, onNoReadings }: Props<'rally'> & Extra & { onNoReadings: () => void }) {
  const [steer, setSteer] = useState(0);
  const [braking, setBraking] = useState(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const noReadings = useRef(onNoReadings);
  noReadings.current = onNoReadings;
  /** Arrow keys (the /dev page) override the tilt while held. */
  const [keySteer, setKeySteer] = useState<number | null>(null);
  const want = useRef({ x: 0, y: -100 });
  const sent = useRef({ x: 0, y: 0 });
  const lastSend = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const w = want.current;
    if (w.x === sent.current.x && w.y === sent.current.y) return;
    const now = performance.now();
    if (now - lastSend.current < SEND_EVERY_MS) {
      timer.current = window.setTimeout(flush, SEND_EVERY_MS - (now - lastSend.current));
      return;
    }
    lastSend.current = now;
    sent.current = w;
    sendRef.current({ t: 'stick', x: w.x, y: w.y });
  };
  const steerShown = keySteer ?? steer;
  want.current = { x: shape(steerShown * 100), y: braking ? 100 : -100 };
  useEffect(flush, [steerShown, braking]);

  // The tilt sensor.
  useEffect(() => {
    const ios = isIOS();
    let heard = false;
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x === null || g.y === null) return;
      heard = true;
      setSteer(tiltSteer(g.x, g.y, screenAngle(), ios));
    };
    window.addEventListener('devicemotion', onMotion);
    // Laptops on the /dev page have no sensor: keep tilt mode there (the arrow keys steer).
    const check = window.setTimeout(() => !heard && 'ontouchstart' in window && noReadings.current(), 2500);
    const stopSync = keepStickInSync(() => sent.current, (x, y) => sendRef.current({ t: 'stick', x, y }));
    return () => {
      clearTimeout(check);
      clearTimeout(timer.current);
      stopSync();
      window.removeEventListener('devicemotion', onMotion);
      sendRef.current({ t: 'stick', x: 0, y: 0 });
    };
  }, []);

  const useItem = () => {
    if (!view.item) return;
    vibrate(15);
    sendRef.current({ t: 'act' });
  };
  const itemRef = useRef(useItem);
  itemRef.current = useItem;

  // Keyboard (the /dev page): arrows steer, ↓ brakes, space fires the item.
  useEffect(() => {
    const k = { l: false, r: false };
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') k.l = down;
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') k.r = down;
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' || e.key === 'Shift') setBraking(down);
      else if (e.key === ' ') {
        if (down && !e.repeat) itemRef.current();
      } else return;
      e.preventDefault();
      setKeySteer(k.l || k.r ? (k.r ? 1 : 0) - (k.l ? 1 : 0) : null);
    };
    const kd = key(true);
    const ku = key(false);
    const reset = () => setBraking(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);

  const drift = view.drift ?? 0;
  return (
    <div class="pv rally-pad-view rally-tilt" style={{ '--me': colorHex(me.color) }}>
      <TopBar view={view} toggle={toggle} />
      <div class="rally-tilt-wheel" style={{ transform: `rotate(${steerShown * 90}deg)` }}>
        <SteeringWheel />
      </div>
      <div class="rally-tilt-hint muted">Turn the phone like a wheel · the gas is on</div>
      {view.fx && <div class={`rally-pad-fx fx-${view.fx}`}>{FX_TEXT[view.fx]}</div>}
      <div class="rally-tilt-controls">
        <button
          class={`rally-tilt-item ${view.item ? 'has' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            useItem();
          }}
          aria-label={view.item ? `Use ${RALLY_ITEMS[view.item].name}` : 'No item'}
        >
          {view.item ? <ItemIcon item={view.item} size={64} /> : <span>?</span>}
          {view.item && <small>{RALLY_ITEMS[view.item].name}</small>}
        </button>
        <PedalButton class={`rally-tilt-brake lvl-${drift}`} label={drift >= 2 ? 'LET GO: TURBO!' : 'BRAKE · DRIFT'} down={braking} onChange={setBraking} />
      </div>
      <Overlay view={view} me={me} chips={chips} />
    </div>
  );
}
