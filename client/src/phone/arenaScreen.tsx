/**
 * No-TV arena games (Grzybki, Pushy Pierogi): the arena drawn on the phone, above the joystick.
 * The host phone streams snapshots; the game's own 3D scene plays them back here.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ArenaNet, ArenaNetGame, PadView } from '../../../shared/protocol';
import type { ArenaMirror, Cue } from '../games/arena/mirror';
import { Sound } from '../lib/sound';
import { arenaBus } from './rallyBus';

const sfx = new Sound();
/** For automated tests: /join?debug exposes the arena as window.arena. */
const DEBUG = new URLSearchParams(location.search).has('debug');
const FLASH_MS = 1700;

export function ArenaScreen({ view, net, offset }: { view: PadView; net: ArenaNet; offset: number }) {
  const game = view.game as ArenaNetGame;
  const canvas = useRef<HTMLCanvasElement>(null);
  const mirror = useRef<ArenaMirror | null>(null);
  const round = useRef({ round: view.round, seed: net.seed });
  round.current = { round: view.round, seed: net.seed };
  const [glError, setGlError] = useState(false);
  const [flash, setFlash] = useState<{ text: string; color?: string; key: number } | null>(null);
  const [clock, setClock] = useState<{ text: string; low: boolean } | null>(null);
  const [count, setCount] = useState<number | null>(null);

  // One 3D scene for the whole game; rounds reset it.
  useEffect(() => {
    let alive = true;
    let m: ArenaMirror | null = null;
    let raf = 0;
    let flashTimer = 0;
    const cue = (c: Cue) => {
      if (c.sfx) sfx[c.sfx]();
      if (c.say) {
        setFlash({ ...c.say, key: performance.now() });
        clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => setFlash(null), FLASH_MS);
      }
    };
    void import('../games/arena/mirror').then(({ createMirror }) => {
      if (!alive || !canvas.current) return;
      try {
        m = createMirror(game, canvas.current, net, round.current.round, cue);
      } catch (err) {
        console.error(err);
        setGlError(true);
        return;
      }
      m.reset(round.current.round, round.current.seed);
      mirror.current = m;
      if (DEBUG) (window as unknown as { arena: ArenaMirror }).arena = m;
      let last = performance.now();
      let shown = '';
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.25, (now - last) / 1000);
        last = now;
        m!.render(dt);
        const c = m!.clock();
        const key = c ? `${c.text}${c.low}` : '';
        if (key !== shown) {
          shown = key;
          setClock(c);
        }
      };
      raf = requestAnimationFrame(loop);
    });
    sfx.unlock();
    const unlock = () => sfx.unlock();
    document.addEventListener('pointerdown', unlock, true);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
      document.removeEventListener('pointerdown', unlock, true);
      m?.dispose();
      if (mirror.current === m) mirror.current = null;
    };
  }, [game]);

  useEffect(() => {
    mirror.current?.reset(view.round, net.seed);
  }, [view.round, net.seed]);

  useEffect(
    () =>
      arenaBus.listen((m) => {
        if (m.g === game) mirror.current?.onSnapshot(m.r, m.at, m.s, m.e ?? []);
      }),
    [game],
  );

  // The countdown before each round: 3, 2, 1, GO!
  const goAt = net.goAt + offset;
  useEffect(() => {
    let t = 0;
    let lastShown: number | null = null;
    const tick = () => {
      const left = Math.ceil((goAt - Date.now()) / 1000);
      const show = left >= 1 && left <= 3 ? left : left > -1 && left <= 0 && lastShown !== null ? 0 : null;
      if (show !== lastShown) {
        if (show !== null && show > 0) sfx.count();
        if (show === 0) sfx.go();
        lastShown = show;
        setCount(show);
      }
      if (left > -1) t = window.setTimeout(tick, 100);
    };
    tick();
    return () => clearTimeout(t);
  }, [goAt]);

  return (
    <div class="ar-screen">
      <canvas ref={canvas} class="ar-canvas" width={864} height={486} />
      {clock && <div class={`ar-clock ${clock.low ? 'low' : ''}`}>{clock.text}</div>}
      {count !== null && (
        <div class="ar-count pop-in" key={count}>
          {count > 0 ? count : 'GO!'}
        </div>
      )}
      {flash && count === null && (
        <div class="ar-flash pop-in" key={flash.key} style={flash.color ? { color: flash.color } : undefined}>
          {flash.text}
        </div>
      )}
      {glError && <div class="ar-flash">This phone can’t show 3D graphics (WebGL is off).</div>}
    </div>
  );
}
