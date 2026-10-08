import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import { CIG_LENGTH, HOLD_MAX_MS, HOLD_MIN_MS, PULL_GHOST_MS, PULL_IDEAL, VERDICT_LABEL, Verdict, ratePuff, teethColor } from '../games/smoke/logic';
import { Cig, GrinPierogi } from '../games/smoke/art';
import type { Props } from './views';

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

/** Fajki on the phone: GRAB, then pull the cigarette down, hold, let go. */
export function SmokePad({ view, me, send, offset }: Props<'smoke'>) {
  const color = colorHex(me.color);
  const [wasReach, setWasReach] = useState(false);
  const prevHand = useRef(view.hand);
  useEffect(() => {
    if (view.hand === 'cough') setWasReach(prevHand.current === 'reach');
    prevHand.current = view.hand;
  }, [view.hand]);

  if (view.phase === 'over')
    return (
      <div class="pv pv-center">
        <GrinPierogi color={color} teeth={teethColor(0.6)} size={190} />
        <div class="phone-huge">Cheese!</div>
        <div class="pill">📺</div>
      </div>
    );

  if (view.hand === 'cough') return <Cough view={view} me={me} send={send} offset={offset} wrong={wasReach} />;
  if (view.hand === 'cig') return <Puffer view={view} me={me} send={send} offset={offset} key={view.n} />;

  const ready = view.phase === 'play';
  const busy = view.hand === 'reach' || !ready;
  return <GrabButton color={color} busy={busy} onGrab={() => ready && view.hand === 'empty' && send({ t: 'grab' })} />;
}

function GrabButton({ color, busy, onGrab }: { color: string; busy: boolean; onGrab: () => void }) {
  const grab = useRef(onGrab);
  grab.current = onGrab;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
      e.preventDefault();
      grab.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="pv smoke-pad" style={{ '--me': color }}>
      <button
        class={`smoke-grab ${busy ? 'busy' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          vibrate(25);
          onGrab();
        }}
      >
        <svg viewBox="-80 -70 160 150" width="64%">
          <g transform="translate(-60 -38)">
            <Cig color={color} len={120} w={24} />
          </g>
          <g class="smoke-grab-hand">
            <path d="M 0 22 V 90" stroke="#2a120a" stroke-width="34" stroke-linecap="round" />
            <path d="M 0 22 V 90" stroke={color} stroke-width="24" stroke-linecap="round" />
            <circle cx="0" cy="12" r="25" fill={color} stroke="#2a120a" stroke-width="5" />
            <path d="M -14 -2 q 0 -10 7 -12 M 0 -6 q 0 -10 7 -12 M 12 0 q 2 -8 8 -9" fill="none" stroke="rgba(42,18,10,.45)" stroke-width="4" stroke-linecap="round" />
          </g>
        </svg>
        <span>GRAB</span>
      </button>
    </div>
  );
}

function Cough({ view, me, offset, wrong }: Props<'smoke'> & { wrong: boolean }) {
  const ring = useRef<SVGCircleElement>(null);
  const until = view.coughUntil + offset;
  useEffect(() => {
    let raf = 0;
    const start = Date.now();
    const total = Math.max(1, until - start);
    const loop = () => {
      const f = Math.max(0, (until - Date.now()) / total);
      ring.current?.setAttribute('stroke-dashoffset', String(302 * (1 - f)));
      if (f > 0) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [until]);
  return (
    <div class="pv pv-center smoke-coughing">
      <div class="smoke-cough-face">
        <svg class="smoke-cough-ring" viewBox="0 0 110 110" width="230" height="230">
          <circle cx="55" cy="55" r="48" fill="none" stroke="rgba(251,240,217,.12)" stroke-width="8" />
          <circle ref={ring} cx="55" cy="55" r="48" fill="none" stroke="#a3b18a" stroke-width="8" stroke-linecap="round" stroke-dasharray="302" transform="rotate(-90 55 55)" />
        </svg>
        <Pierogi color={colorHex(me.color)} size={150} mood="dead" class="smoke-shake" />
      </div>
      <div class="phone-huge">Khe khe!</div>
      {wrong && <div class="muted">Not your colour</div>}
    </div>
  );
}

const PACE = { fast: '#ff3d6e', ok: '#2fd6a8', slow: '#4f9dff' } as const;

function Puffer({ view, me, send }: Props<'smoke'>) {
  const color = colorHex(me.color);
  const track = useRef<HTMLDivElement>(null);
  const els = {
    trail: useRef<HTMLDivElement>(null),
    ghost: useRef<HTMLDivElement>(null),
    finger: useRef<HTMLDivElement>(null),
    goal: useRef<HTMLDivElement>(null),
    hold: useRef<SVGCircleElement>(null),
  };
  const [touching, setTouching] = useState(false);
  const [verdict, setVerdict] = useState<{ v: number; k: number } | null>(null);
  const st = useRef({
    down: false,
    /** Pull from the keyboard (the /dev page). */
    key: false,
    t0: 0,
    y0: 0,
    dist: 0,
    frac: 0,
    reachedAt: 0,
    done: false,
  });
  const sendRef = useRef(send);
  sendRef.current = send;

  const begin = (y: number, h: number) => {
    const s = st.current;
    s.down = true;
    s.done = false;
    s.t0 = performance.now();
    s.y0 = y;
    s.dist = Math.min(0.42 * h, Math.max(110, h - y - 18));
    s.frac = 0;
    s.reachedAt = 0;
    setTouching(true);
    sendRef.current({ t: 'puff', ev: 'pull' });
  };

  const release = () => {
    const s = st.current;
    if (!s.down) return;
    s.down = false;
    s.key = false;
    setTouching(false);
    if (s.done) return;
    s.done = true;
    const now = performance.now();
    let r;
    if (s.reachedAt) r = ratePuff(s.reachedAt - s.t0, 1, now - s.reachedAt);
    else if (s.frac < 0.08) r = { q: 0, v: Verdict.Short };
    else r = ratePuff((now - s.t0) / s.frac, s.frac, 0);
    sendRef.current({ t: 'puff', ev: 'blow', q: r.q, v: r.v });
    if (s.frac >= 0.08 || s.reachedAt) setVerdict((p) => ({ v: r.v, k: (p?.k ?? 0) + 1 }));
    vibrate(r.v === Verdict.Perfect ? [30, 30, 60] : 20);
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;

  const move = (y: number) => {
    const s = st.current;
    if (!s.down || s.done) return;
    s.frac = Math.max(s.frac, Math.min(1, (y - s.y0) / s.dist));
    if (s.frac >= 1 && !s.reachedAt) {
      s.reachedAt = performance.now();
      vibrate(15);
    }
  };

  // Ghost, trail, and the hold ring, every frame while pulling.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const s = st.current;
      const now = performance.now();
      if (s.down && !s.done) {
        const el = now - s.t0;
        if (s.key && !s.reachedAt) {
          s.frac = Math.min(1, el / PULL_GHOST_MS);
          if (s.frac >= 1) s.reachedAt = now;
        }
        const ghost = Math.min(1, el / PULL_GHOST_MS);
        // Ahead of the fastest good pace is too fast; behind the slowest is too slow.
        const pace = s.reachedAt ? 'ok' : s.frac > el / PULL_IDEAL[0] + 0.04 ? 'fast' : s.frac < el / PULL_IDEAL[1] - 0.04 ? 'slow' : 'ok';
        const set = (r: { current: HTMLElement | null }, top: number) => r.current && (r.current.style.transform = `translateY(${top.toFixed(1)}px)`);
        set(els.ghost, s.y0 + ghost * s.dist);
        set(els.finger, s.y0 + s.frac * s.dist);
        set(els.goal, s.y0 + s.dist);
        if (els.trail.current) {
          els.trail.current.style.transform = `translateY(${s.y0}px)`;
          els.trail.current.style.height = `${s.frac * s.dist}px`;
          els.trail.current.style.background = PACE[pace];
        }
        const held = s.reachedAt ? now - s.reachedAt : 0;
        if (els.hold.current) {
          const f = Math.min(1, held / HOLD_MAX_MS);
          els.hold.current.setAttribute('stroke-dashoffset', String(264 * (1 - f)));
          els.hold.current.setAttribute('stroke', held < HOLD_MIN_MS ? '#ffc93c' : held < HOLD_MAX_MS * 0.75 ? '#2fd6a8' : '#ff3d6e');
        }
        if (held > HOLD_MAX_MS) releaseRef.current();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || !(e.key === 'ArrowDown' || e.key === 's' || e.key === 'S')) return;
      e.preventDefault();
      const h = track.current?.clientHeight ?? 400;
      st.current.key = true;
      begin(h * 0.15, h);
    };
    const up = (e: KeyboardEvent) => {
      if (st.current.key && (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S')) releaseRef.current();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    if (!verdict) return;
    const t = window.setTimeout(() => setVerdict(null), 1100);
    return () => clearTimeout(t);
  }, [verdict]);

  const y = (e: PointerEvent) => e.clientY - (track.current?.getBoundingClientRect().top ?? 0);
  return (
    <div class="pv smoke-pad" style={{ '--me': color }}>
      <div class="smoke-held">
        <svg viewBox="-14 -14 248 28" width="100%" height="40">
          <Cig color={color} len={220} w={22} frac={view.left / CIG_LENGTH} lit glow={touching} />
        </svg>
      </div>
      <div
        ref={track}
        class={`smoke-track ${touching ? 'on' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          begin(y(e), (e.currentTarget as HTMLElement).clientHeight);
        }}
        onPointerMove={(e) => move(y(e))}
        onPointerUp={() => release()}
        onPointerCancel={() => release()}
      >
        {!touching && (
          <div class="smoke-arrows" aria-hidden="true">
            {[0, 1, 2].map((k) => (
              <svg viewBox="0 0 60 30" width="84" style={{ animationDelay: `${k * 0.18}s` }}>
                <path d="M6 6 L30 24 L54 6" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            ))}
          </div>
        )}
        {touching && (
          <>
            <div class="smoke-trail" ref={els.trail} />
            <div class="smoke-goal" ref={els.goal} />
            <div class="smoke-ghost" ref={els.ghost} />
            <div class="smoke-finger" ref={els.finger}>
              <svg viewBox="0 0 100 100" width="92" height="92" class="smoke-hold">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(251,240,217,.15)" stroke-width="9" />
                <circle ref={els.hold} cx="50" cy="50" r="42" fill="none" stroke="#ffc93c" stroke-width="9" stroke-linecap="round" stroke-dasharray="264" stroke-dashoffset="264" transform="rotate(-90 50 50)" />
              </svg>
            </div>
          </>
        )}
        {verdict && (
          <div class={`smoke-verdict v${verdict.v}`} key={verdict.k}>
            {VERDICT_LABEL[verdict.v]}
          </div>
        )}
        {verdict && verdict.v !== Verdict.Long && (
          <div class="smoke-exhale" key={`c${verdict.k}`} aria-hidden="true">
            💨
          </div>
        )}
      </div>
    </div>
  );
}
