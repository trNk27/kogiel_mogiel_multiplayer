/**
 * Maluch Rally without a TV: the phone is the screen. Full-screen 3D view of your own car,
 * a minimap in the corner, and a steering system made for a phone you're also looking at:
 * tilt it like a steering wheel, or drag a thumb sideways. The car accelerates by itself.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { RALLY_ITEMS, colorHex, type RallyItem, type RallyNet } from '../../../shared/protocol';
import { ItemIcon, hitLabel } from '../games/rally/items';
import type { DriveHud, DriveInput, RallyClient } from '../games/rally/client';
import { Pierogi } from '../lib/art';
import { Sound } from '../lib/sound';
import { rallyBus } from './rallyBus';
import type { Props } from './views';
import { VipMenu } from './vipMenu';
import { fullscreenSupported, standalone, toggleFullscreen, useFullscreen } from './fullscreen';
import { SHAPE_NAMES, type Shape } from '../games/rally/track';
import { isIOS, screenAngle, tiltSteer } from './tilt';

type Mode = 'touch' | 'tilt';
const MODE_KEY = 'cp.steer';
/** Drag this far (fraction of the steering pad's width) for full lock. */
const DRAG_FULL = 0.24;
const MAP_PX = 256;

const sfx = new Sound();
/** For automated tests: /join?debug exposes the race client as window.rally. */
const DEBUG = new URLSearchParams(location.search).has('debug');

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not supported (iOS) */
  }
}

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'tilt' ? 'tilt' : 'touch';
  } catch {
    return 'touch';
  }
}

export function RallyDrive({ view, me, send, offset }: Props<'rally'> & { view: { net: RallyNet } }) {
  const net = view.net;
  const canvas = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const client = useRef<RallyClient | null>(null);
  const input = useRef<DriveInput>({ steer: 0, brake: false, drift: false });
  const [hud, setHud] = useState<DriveHud>({ speed: 0, ink: 0, lap: 1, finished: false, drift: 0, turbos: 0, turboLevel: 0 });
  const [drifting, setDrifting] = useState(false);
  const [mode, setMode] = useState<Mode>(loadMode);
  const [tiltProblem, setTiltProblem] = useState<string | null>(null);
  const [steerShown, setSteerShown] = useState(0);
  const [braking, setBraking] = useState(false);
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  const [glError, setGlError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const sendRef = useRef(send);
  sendRef.current = send;
  const itemRef = useRef<RallyItem | null>(null);
  itemRef.current = view.item;
  const racing = view.phase === 'race' || view.phase === 'finished';
  const fullscreen = useFullscreen();
  const [canFullscreen] = useState(fullscreenSupported);

  const say = (text: string) => setFlash({ text, key: performance.now() });

  // One 3D client per race.
  useEffect(() => {
    if (view.phase === 'standings') return;
    let alive = true;
    let c: RallyClient | null = null;
    void import('../games/rally/client').then(({ RallyClient }) => {
      if (!alive || !canvas.current || !mapRef.current) return;
      try {
        c = new RallyClient(canvas.current, mapRef.current, view.race, net, (m) => sendRef.current(m), setHud);
        c.input = input.current;
        client.current = c;
        if (DEBUG) (window as unknown as { rally: RallyClient }).rally = c;
      } catch (err) {
        console.error(err);
        setGlError(true);
      }
    });
    const onResize = () => canvas.current && client.current?.resize(canvas.current);
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      window.removeEventListener('resize', onResize);
      c?.dispose();
      if (client.current === c) client.current = null;
    };
  }, [view.race, net.seed, view.phase === 'standings']);

  useEffect(() => {
    client.current?.setDriving(racing);
  }, [racing, client.current]);

  // Snapshots and things happening to my car.
  useEffect(
    () =>
      rallyBus.listen((m) => {
        if (m.t === 'rs') {
          client.current?.onSnapshot(m);
          return;
        }
        if (m.r !== view.race) return;
        client.current?.onEvent(m);
        if (m.use) {
          say(RALLY_ITEMS[m.use].name);
          sfx.whoosh();
        }
        if (m.hit) {
          say(hitLabel(m.hit, !!m.blocked));
          if (m.blocked) sfx.tick();
          else if (m.hit === 'beet' || m.hit === 'spray') sfx.plop();
          else sfx.crash();
        }
        if (m.lost) {
          say(`${m.by} stole your ${RALLY_ITEMS[m.lost].name}!`);
          sfx.wrong();
        }
        if (m.got) {
          say(`Got ${m.got}!`);
          sfx.correct();
        }
      }),
    [view.race],
  );

  // Pickups and laps.
  const lastItem = useRef<RallyItem | null>(null);
  useEffect(() => {
    if (view.item && view.item !== lastItem.current) sfx.pickup();
    lastItem.current = view.item;
  }, [view.item]);
  // Letting go of a drift with sparks.
  const lastTurbos = useRef(0);
  useEffect(() => {
    if (hud.turbos > lastTurbos.current) {
      say(hud.turboLevel === 2 ? 'Super turbo!' : 'Mini-turbo!');
      sfx.whoosh();
      vibrate(20);
    }
    lastTurbos.current = hud.turbos;
  }, [hud.turbos]);
  const lastLap = useRef(view.lap);
  useEffect(() => {
    if (view.lap > lastLap.current) {
      say(view.lap === view.laps ? 'Final lap!' : `Lap ${view.lap}`);
      sfx.lockIn();
    }
    lastLap.current = view.lap;
  }, [view.lap]);

  // Countdown beeps and a clock for the overlays.
  const goAt = net.goAt + offset;
  useEffect(() => {
    let t = 0;
    let lastSecond = -1;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      if (view.phase === 'countdown') {
        const left = Math.ceil((goAt - n) / 1000);
        if (left !== lastSecond && left >= 1 && left <= 3) sfx.count();
        if (left !== lastSecond && left <= 0 && lastSecond > 0) sfx.go();
        lastSecond = left;
      }
      t = window.setTimeout(tick, 100);
    };
    tick();
    return () => clearTimeout(t);
  }, [view.phase, goAt]);
  useEffect(() => {
    if (view.phase === 'race') sfx.go();
  }, [view.phase === 'race']);

  // ---- steering ---------------------------------------------------------------

  const setSteer = (v: number) => {
    input.current.steer = v;
    setSteerShown(Math.round(v * 20) / 20);
  };
  const setDrift = (on: boolean) => {
    if (on && !input.current.drift) vibrate(10);
    input.current.drift = on;
    setDrifting(on);
  };
  const setBrake = (on: boolean) => {
    if (on && !input.current.brake) vibrate(8);
    input.current.brake = on;
    setBraking(on);
  };
  const useItem = () => {
    if (!itemRef.current) return;
    vibrate(15);
    sendRef.current({ t: 'act' });
  };

  const chooseMode = async (m: Mode) => {
    sfx.unlock();
    setTiltProblem(null);
    if (m === 'tilt') {
      const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
      if (!DM) {
        setTiltProblem('This phone has no tilt sensor – steer by dragging instead.');
        return;
      }
      if (typeof DM.requestPermission === 'function') {
        try {
          if ((await DM.requestPermission()) !== 'granted') {
            setTiltProblem('Motion access was declined – steer by dragging instead.');
            return;
          }
        } catch {
          setTiltProblem('Motion access needs a tap first – try again.');
          return;
        }
      }
    }
    setMode(m);
    setSteer(0);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode */
    }
  };

  // Tilt.
  useEffect(() => {
    if (mode !== 'tilt') return;
    const ios = isIOS();
    let heard = false;
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x === null || g.y === null) return;
      heard = true;
      setSteer(tiltSteer(g.x, g.y, screenAngle(), ios));
    };
    window.addEventListener('devicemotion', onMotion);
    const check = window.setTimeout(() => {
      if (!heard) {
        setTiltProblem('No tilt readings from this phone – switched to dragging.');
        setMode('touch');
      }
    }, 2500);
    return () => {
      clearTimeout(check);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [mode]);

  // Keyboard (for the /dev page and laptops).
  useEffect(() => {
    const keys = { l: false, r: false };
    const key = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.l = down;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.r = down;
      else if (k === 'ArrowDown' || k === 's' || k === 'S') setBrake(down);
      else if (k === 'Shift' || k === 'x' || k === 'X') setDrift(down);
      else if (k === ' ') {
        if (down && !e.repeat) useItem();
      } else return;
      e.preventDefault();
      setSteer((keys.r ? 1 : 0) - (keys.l ? 1 : 0));
    };
    const kd = key(true);
    const ku = key(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  // Let go of everything when the page is hidden.
  useEffect(() => {
    const reset = () => {
      setBrake(false);
      setDrift(false);
      if (mode === 'touch') setSteer(0);
    };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [mode]);

  // ---- render -------------------------------------------------------------------

  const left = Math.ceil((goAt - now) / 1000);
  const closing = net.closesAt !== null ? Math.max(0, Math.ceil((net.closesAt + offset - now) / 1000)) : null;
  const ink = Math.min(1, hud.ink / 1.2);
  return (
    <div class="drive" style={{ '--me': colorHex(me.color) }} onPointerDown={() => sfx.unlock()}>
      <canvas ref={canvas} class="drive-canvas" />
      {ink > 0 && <BeetSplash opacity={ink} />}

      <div class="drive-top">
        <div class="drive-pos">
          {view.pos ? (
            <>
              {view.pos}
              <small>{ordinal(view.pos).replace(String(view.pos), '')}</small>
            </>
          ) : (
            '–'
          )}
          <span class="drive-of">/{view.of}</span>
        </div>
        <div class="drive-lap">
          <span>
            Lap <b>{Math.min(view.laps, view.lap)}</b>/{view.laps}
          </span>
          <small>
            Race {view.race}/{view.races}
          </small>
        </div>
        <span class="grow" />
        {canFullscreen && (
          <button class="drive-fs" onClick={toggleFullscreen} aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}>
            <FullscreenIcon exit={fullscreen} />
          </button>
        )}
        {me.vip && <VipMenu send={send} />}
        <canvas ref={mapRef} class="drive-map" width={MAP_PX} height={MAP_PX} />
      </div>

      {flash && (
        <div class="drive-flash" key={flash.key} onAnimationEnd={() => setFlash(null)}>
          {flash.text}
        </div>
      )}
      {closing !== null && view.phase === 'race' && <div class="drive-closing">{closing}s left to finish!</div>}
      {view.fx && view.fx !== 'shield' && <div class={`drive-fx fx-${view.fx}`}>{FX[view.fx]}</div>}

      <div class="drive-speed">
        {Math.round(hud.speed * 3.6)}
        <small> km/h</small>
      </div>

      {hud.drift > 0 && <div class={`drive-sparks lvl-${hud.drift}`}>{hud.drift === 3 ? 'SUPER TURBO READY' : hud.drift === 2 ? 'TURBO READY' : 'DRIFT…'}</div>}

      <div class={`drive-controls mode-${mode}`}>
        {mode === 'touch' ? (
          <DragPad steer={steerShown} onSteer={setSteer} />
        ) : (
          <PedalButton class={`drive-drift big lvl-${hud.drift}`} label="DRIFT" down={drifting} onChange={setDrift} />
        )}
        <div class="drive-right">
          <button
            class={`drive-item ${view.item ? 'has' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              useItem();
            }}
            aria-label={view.item ? `Use ${RALLY_ITEMS[view.item].name}` : 'No item'}
          >
            {view.item ? <ItemIcon item={view.item} size={58} /> : <span class="drive-item-empty">?</span>}
          </button>
          <PedalButton class="drive-brake" label="BRAKE" down={braking} onChange={setBrake} />
          {mode === 'touch' && <PedalButton class={`drive-drift lvl-${hud.drift}`} label="DRIFT" down={drifting} onChange={setDrift} />}
        </div>
      </div>
      {mode === 'tilt' && (
        <div class="drive-wheel" style={{ transform: `translateX(-50%) rotate(${steerShown * 90}deg)` }}>
          <SteeringWheel />
        </div>
      )}

      {view.phase === 'countdown' && (
        <div class="drive-overlay">
          {left > 3 ? (
            <div class="drive-count-title">
              Race {view.race} of {view.races}
              <small>{SHAPE_NAMES[net.shape as Shape] ?? ''}</small>
            </div>
          ) : (
            <div class="drive-count" key={left}>
              {Math.max(1, left)}
            </div>
          )}
          <div class="drive-modes">
            <span class="muted">Steer by</span>
            <button class={`chip ${mode === 'touch' ? 'on' : ''}`} onClick={() => chooseMode('touch')}>
              👆 Dragging
            </button>
            <button class={`chip ${mode === 'tilt' ? 'on' : ''}`} onClick={() => chooseMode('tilt')}>
              📱 Tilting
            </button>
          </div>
          <div class="muted small center">
            {mode === 'tilt' ? 'Hold your phone like a steering wheel and turn it. ' : 'Drag your thumb left and right on the pad. '}
            The car speeds up by itself. Hold DRIFT while turning to slide round tight corners – let go when the sparks show for a turbo.
          </div>
          {tiltProblem && <div class="form-error">{tiltProblem}</div>}
          {canFullscreen && !fullscreen && (
            <button class="chip" onClick={toggleFullscreen}>
              ⛶ Full screen
            </button>
          )}
          {!canFullscreen && isIOS() && !standalone() && (
            <div class="muted small center">For full screen on an iPhone: Share → Add to Home Screen, then play from there.</div>
          )}
        </div>
      )}
      {view.phase === 'race' && left > -1 && <div class="drive-count go">GO!</div>}
      {view.phase === 'finished' && (
        <div class="drive-banner pop-in">
          Finished {ordinal(view.pos)}!<small>{closing !== null ? `Race closes in ${closing}s` : 'Waiting for the others…'}</small>
        </div>
      )}
      {view.phase === 'standings' && <Standings view={view} net={net} />}
      {glError && <div class="drive-overlay">This phone can’t show 3D graphics (WebGL is off).</div>}
    </div>
  );
}

const FX: Record<string, string> = {
  spin: 'Spinning out!',
  rocket: 'Rocket! It steers itself',
  boost: 'Boost!',
  slow: 'Caught in the storm!',
  ink: 'Barszcz on the windscreen!',
  ghost: 'Ghost – nothing can touch you',
};

function Standings({ view, net }: { view: Props<'rally'>['view']; net: RallyNet }) {
  const board = net.board ?? [];
  const cup = [...board].sort((a, b) => b.cup - a.cup);
  return (
    <div class="drive-overlay drive-standings">
      <div class="phone-big">
        Race {view.race} of {view.races}
      </div>
      <ol class="drive-board">
        {board.map((r, place) => {
          const c = net.cars[r.idx];
          return (
            <li class={r.idx === net.idx ? 'me' : ''}>
              <span class="db-place">{place + 1}</span>
              <Pierogi color={colorHex(c.color)} size={30} mood={place === 0 ? 'wow' : 'happy'} />
              <span class="grow">{c.name}</span>
              <span class="db-time">{r.time !== null ? formatTime(r.time) : 'DNF'}</span>
              <b>+{r.pts}</b>
            </li>
          );
        })}
      </ol>
      {cup.length > 1 && (
        <>
          <div class="section-label">Cup standings</div>
          <ol class="drive-board cup">
            {cup.map((r) => {
              const c = net.cars[r.idx];
              return (
                <li class={r.idx === net.idx ? 'me' : ''}>
                  <Pierogi color={colorHex(c.color)} size={26} />
                  <span class="grow">{c.name}</span>
                  <b>{r.cup}</b>
                </li>
              );
            })}
          </ol>
        </>
      )}
      <div class="muted">{view.race < view.races ? 'Next track coming up…' : 'That was the last race!'}</div>
    </div>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Steering by dragging: put a thumb down anywhere on the pad and slide it sideways. */
function DragPad({ steer, onSteer }: { steer: number; onSteer: (v: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const onSteerRef = useRef(onSteer);
  onSteerRef.current = onSteer;
  useEffect(() => {
    const pad = el.current!;
    let pid: number | null = null;
    let x0 = 0;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId;
      pad.setPointerCapture?.(pid);
      x0 = e.clientX;
      const r = pad.getBoundingClientRect();
      setOrigin({ x: e.clientX - r.left, y: e.clientY - r.top });
      vibrate(6);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      const full = pad.getBoundingClientRect().width * DRAG_FULL;
      onSteerRef.current(Math.max(-1, Math.min(1, (e.clientX - x0) / full)));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      setOrigin(null);
      onSteerRef.current(0);
    };
    pad.addEventListener('pointerdown', down);
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    return () => {
      pad.removeEventListener('pointerdown', down);
      pad.removeEventListener('pointermove', move);
      pad.removeEventListener('pointerup', up);
      pad.removeEventListener('pointercancel', up);
    };
  }, []);
  return (
    <div class="drive-pad" ref={el}>
      {origin ? (
        <div class="drive-pad-wheel" style={{ left: origin.x, top: origin.y, transform: `translate(-50%, -50%) rotate(${steer * 90}deg)` }}>
          <SteeringWheel />
        </div>
      ) : (
        <span class="drive-pad-hint">◀ drag to steer ▶</span>
      )}
    </div>
  );
}

function PedalButton(props: { class: string; label: string; down: boolean; onChange: (down: boolean) => void }) {
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

function FullscreenIcon({ exit }: { exit: boolean }) {
  // Four corners pointing out (go full screen) or in (leave it).
  const d = exit ? 'M9 3v6H3 M15 3v6h6 M9 21v-6H3 M15 21v-6h6' : 'M3 9V3h6 M21 9V3h-6 M3 15v6h6 M21 15v6h-6';
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function SteeringWheel() {
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

/** Barszcz sprayed over the windscreen: big blobs that run, and a mist of droplets. */
function BeetSplash({ opacity }: { opacity: number }) {
  return (
    <svg class="drive-ink" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" style={{ opacity }} aria-hidden="true">
      <rect width="100" height="100" fill="#a3123f" opacity="0.18" />
      {BLOBS.map(([x, y, r, drip]) => (
        <g>
          <circle cx={x} cy={y} r={r} fill="#a3123f" />
          <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.28} fill="#d63a6a" />
          <rect x={x - r * 0.18} y={y} width={r * 0.36} height={drip} rx={r * 0.18} fill="#a3123f" />
          <circle cx={x} cy={y + drip} r={r * 0.24} fill="#a3123f" />
        </g>
      ))}
      {DROPS.map(([x, y, r]) => (
        <circle cx={x} cy={y} r={r} fill="#a3123f" />
      ))}
    </svg>
  );
}

/** Blobs: [x, y, radius, drip length]. */
const BLOBS: [number, number, number, number][] = [
  [24, 30, 11, 22],
  [66, 22, 14, 18],
  [47, 55, 15, 26],
  [12, 68, 7, 14],
  [84, 60, 10, 20],
  [34, 82, 6, 9],
  [72, 84, 8, 10],
];

/** A spray of small droplets around the blobs (fixed, so they don't flicker). */
const DROPS: [number, number, number][] = Array.from({ length: 70 }, (_, i) => {
  const a = i * 2.39996;
  const d = 8 + ((i * 37) % 48);
  return [50 + Math.cos(a) * d, 48 + Math.sin(a) * d * 0.9, 0.6 + ((i * 13) % 10) / 6];
});
