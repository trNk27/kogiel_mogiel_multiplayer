/**
 * Maluch Rally phone controller (with a TV): GAS and BRAKE · DRIFT at the top, the item button
 * under them, and a steering wheel you swipe left and right below.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { RALLY_ITEMS, colorHex, type RallyEffect } from '../../../shared/protocol';
import { ItemIcon } from '../games/rally/items';
import { Pierogi } from '../lib/art';
import type { Props } from './views';
import { RallyDrive } from './rallyDrive';
import { DragPad, PedalButton, vibrate } from './steer';

const SEND_EVERY_MS = 50;

const FX_TEXT: Record<RallyEffect, string> = {
  spin: 'Spinning out!',
  rocket: 'Rocket! Hands off – it steers itself',
  boost: 'Boost!',
  shield: 'Pot lid up',
  slow: 'Caught in the storm!',
  ink: 'Beet juice on your windscreen!',
  ghost: 'Ghost mode – nothing can touch you',
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

function TvPad({ view, me, send }: Props<'rally'>) {
  const [steer, setSteer] = useState(0);
  const [gas, setGas] = useState(false);
  const [brake, setBrake] = useState(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const itemRef = useRef(view.item);
  itemRef.current = view.item;
  const want = useRef({ x: 0, y: 0 });
  const flushRef = useRef(() => {});

  // Send the stick (x steers, y is -100 gas / 100 brake) when it changes, at most 20 times a second.
  useEffect(() => {
    let sent = { x: 0, y: 0 };
    let lastSend = 0;
    let timer: number | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      const w = want.current;
      if (w.x === sent.x && w.y === sent.y) return;
      const now = performance.now();
      if (now - lastSend < SEND_EVERY_MS && (w.x || w.y)) {
        timer = window.setTimeout(flush, SEND_EVERY_MS - (now - lastSend));
        return;
      }
      lastSend = now;
      sent = { ...w };
      sendRef.current({ t: 'stick', x: sent.x, y: sent.y });
    };
    flushRef.current = flush;
    return () => {
      clearTimeout(timer);
      if (sent.x || sent.y) sendRef.current({ t: 'stick', x: 0, y: 0 });
    };
  }, []);
  useEffect(() => {
    want.current = { x: Math.round(steer * 20) * 5, y: brake ? 100 : gas ? -100 : 0 };
    flushRef.current();
  }, [steer, gas, brake]);

  const useItem = () => {
    if (!itemRef.current) return;
    vibrate(15);
    sendRef.current({ t: 'act' });
  };

  // Keyboard (for the /dev page): arrows, Shift brakes, Space uses the item.
  useEffect(() => {
    const keys = { l: false, r: false };
    const key = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.l = down;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.r = down;
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') setGas(down);
      else if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'Shift') setBrake(down);
      else if (k === ' ') {
        if (down && !e.repeat) useItem();
      } else return;
      e.preventDefault();
      setSteer((keys.r ? 1 : 0) - (keys.l ? 1 : 0));
    };
    const kd = key(true);
    const ku = key(false);
    const reset = () => {
      keys.l = keys.r = false;
      setSteer(0);
      setGas(false);
      setBrake(false);
    };
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

  const overlay =
    view.phase === 'countdown'
      ? { big: 'Get ready!', small: `Race ${view.race} of ${view.races} – find your car on the TV` }
      : view.phase === 'finished'
        ? { big: `Finished ${ordinal(view.pos)}!`, small: 'Watch the others come in…' }
        : view.phase === 'standings'
          ? { big: view.pos ? `${ordinal(view.pos)} place` : 'Race over', small: view.race < view.races ? 'Next track coming up – look at the TV' : 'Final results on the TV' }
          : null;

  const sparks = view.drift ?? 0;
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
      <div class="rally-pedals">
        <PedalButton class={`rally-pedal brake lvl-${sparks}`} label={sparks >= 2 ? 'LET GO!' : 'BRAKE · DRIFT'} down={brake} onChange={setBrake} />
        <PedalButton class="rally-pedal gas" label="GAS" down={gas} onChange={setGas} />
      </div>
      <button
        class={`rally-item-btn ${view.item ? 'has' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          useItem();
        }}
      >
        {view.item ? (
          <>
            <ItemIcon item={view.item} size={56} />
            <span>
              <b>{RALLY_ITEMS[view.item].name}</b>
              <small>Tap to use · {RALLY_ITEMS[view.item].does}</small>
            </span>
          </>
        ) : (
          <span class="muted">No item – drive through a ? box</span>
        )}
      </button>
      {view.fx && <div class={`rally-pad-fx fx-${view.fx}`}>{FX_TEXT[view.fx]}</div>}
      <DragPad class="rally-wheel" steer={steer} onSteer={setSteer} />
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
