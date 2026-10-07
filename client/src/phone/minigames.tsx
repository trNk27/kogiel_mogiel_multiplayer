import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type ForkItem } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import { isStroke, type Side } from '../games/pedal/logic';
import { Bike } from '../games/pedal/art';
import { FORK_LIMIT_MS, STAB_EARLY, STAB_FOOLED, stabAt, stabLabel } from '../games/fork/logic';
import { FORK_ITEM_NAMES, ForkThing, Plate } from '../games/fork/art';
import { TimeBar } from './timebar';
import { ordinal, type Props } from './views';

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

/** Sends the latest value at most every `ms`, and straight away when `now` is set. */
function useLatest(ms: number, send: (n: number) => void) {
  const st = useRef({ value: 0, sent: 0, timer: undefined as number | undefined });
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => () => clearTimeout(st.current.timer), []);
  const flush = () => {
    const s = st.current;
    clearTimeout(s.timer);
    s.timer = undefined;
    if (s.value !== s.sent) {
      s.sent = s.value;
      sendRef.current(s.value);
    }
  };
  return (value: number, now = false) => {
    const s = st.current;
    s.value = value;
    if (now) flush();
    else if (s.timer === undefined) s.timer = window.setTimeout(flush, ms);
  };
}

/** Whether the host-clock time `at` has arrived on this phone (re-renders when it does). */
function useAt(at: number, offset: number) {
  const local = at + offset;
  const [reached, setReached] = useState(() => Date.now() >= local);
  useEffect(() => {
    if (Date.now() >= local) return setReached(true);
    setReached(false);
    const t = window.setTimeout(() => setReached(true), local - Date.now());
    return () => clearTimeout(t);
  }, [Math.round(local / 50)]);
  return reached;
}

// ---------------------------------------------------------------------------
// Tour de Pierogi
// ---------------------------------------------------------------------------

export function PedalPad({ view, me, send, offset }: Props<'pedal'>) {
  const [n, setN] = useState(0);
  const [last, setLast] = useState<Side | null>(null);
  const [slip, setSlip] = useState(0);
  const st = useRef({ n: 0, last: null as Side | null });
  const viewRef = useRef(view);
  viewRef.current = view;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const go = useAt(view.goAt, offset);
  const report = useLatest(90, (v) => send({ t: 'pedal', h: viewRef.current.heat, n: v }));

  const press = (side: Side) => {
    const v = viewRef.current;
    const s = st.current;
    if (v.phase === 'heatOver' || Date.now() < v.goAt + offsetRef.current || s.n >= v.goal) return;
    if (!isStroke(s.last, side)) {
      vibrate(40);
      setSlip((x) => x + 1);
      return;
    }
    s.last = side;
    s.n++;
    setN(s.n);
    setLast(side);
    report(s.n, s.n >= v.goal);
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') pressRef.current('l');
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') pressRef.current('r');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const frac = Math.min(1, n / view.goal);
  const racing = go && view.phase !== 'heatOver' && view.phase !== 'done' && n < view.goal;
  const pedal = (side: Side) => (
    <button
      class={`pedal-btn ${side} ${racing && last !== side ? 'next' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault();
        press(side);
      }}
    >
      <svg viewBox="0 0 100 100" width="46%">
        <rect x="18" y="38" width="64" height="24" rx="8" fill="currentColor" />
        <path d="M30 38 v24 M42 38 v24 M54 38 v24 M66 38 v24" stroke="rgba(0,0,0,.25)" stroke-width="4" />
      </svg>
      <span>{side === 'l' ? 'LEFT' : 'RIGHT'}</span>
    </button>
  );
  return (
    <div class="pv pedal-pad" style={{ '--me': colorHex(me.color) }}>
      <div class="trails-pad-score">
        <span>
          <b>{n}</b> / {view.goal}
        </span>
        <span class="muted">
          Heat {view.heat} / {view.heats}
        </span>
      </div>
      <div class="pedal-progress">
        <div class="pedal-progress-fill" style={{ width: `${frac * 100}%` }} />
        <div class="pedal-progress-bike" style={{ left: `calc(${frac} * (100% - 64px))`, '--spin': `${n * 45}deg` }}>
          <Bike color={colorHex(me.color)} size={64} />
        </div>
      </div>
      <div class="pedal-hint" key={slip}>
        {!go ? 'Get ready…' : slip > 0 && racing ? 'Other pedal!' : 'LEFT, RIGHT, LEFT, RIGHT…'}
      </div>
      <div class="pedal-btns">
        {pedal('l')}
        {pedal('r')}
      </div>
      {(view.phase === 'done' || view.phase === 'heatOver' || n >= view.goal) && (
        <div class="dead-overlay calm">
          <Pierogi color={colorHex(me.color)} size={130} mood={view.place === 1 ? 'wow' : 'happy'} class="pop-in" />
          {view.place !== null ? <div class="phone-huge">{ordinal(view.place)}!</div> : <div class="phone-big">{view.phase === 'heatOver' ? 'Heat over' : 'Across the line!'}</div>}
          {view.phase === 'heatOver' ? (
            <div class="gain-big">+{view.pts}</div>
          ) : (
            <div class="muted">Waiting for the others…</div>
          )}
          {view.phase === 'heatOver' && <div class="muted">{view.total} points in total</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fork Fight
// ---------------------------------------------------------------------------

export function ForkPad({ view, send, offset }: Props<'fork'>) {
  const [shown, setShown] = useState<ForkItem | null>(null);
  const [state, setState] = useState<'ready' | 'open' | 'gone'>('ready');
  const [mine, setMine] = useState<number | null>(null);
  const shownAt = useRef(0);
  const shownRef = useRef<ForkItem | null>(null);
  const stabbed = useRef(false);
  const open = view.startAt + offset;

  useEffect(() => {
    if (view.phase !== 'play') return;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, open + ms - Date.now())));
    at(0, () => setState('open'));
    for (const s of view.steps) {
      at(s.at, () => {
        shownRef.current = s.k;
        setShown(s.k);
        // Time the reaction from the frame the item is drawn in.
        shownAt.current = performance.now();
        requestAnimationFrame(() => (shownAt.current = performance.now()));
        if (s.k === 'pierogi') vibrate(15);
      });
      at(s.at + s.dur, () => {
        shownRef.current = null;
        setShown(null);
        if (s.k === 'pierogi') setState('gone');
      });
    }
    return () => timers.forEach(clearTimeout);
  }, [view.startAt, view.phase]);

  const stab = () => {
    if (view.phase !== 'play' || stabbed.current || Date.now() < open || state === 'gone') return;
    const k = shownRef.current;
    let ms: number;
    if (k === 'pierogi') ms = Math.max(0, Math.min(FORK_LIMIT_MS, Math.round(performance.now() - shownAt.current)));
    else if (k) ms = STAB_FOOLED;
    else {
      // Between two things: if the pierogi has been and gone, it's just too late.
      const t = Date.now() - open;
      const real = view.steps.find((s) => s.k === 'pierogi');
      if (real && t >= real.at) return;
      ms = stabAt(view.steps, t).k ? STAB_FOOLED : STAB_EARLY;
    }
    stabbed.current = true;
    setMine(ms);
    vibrate(ms >= 0 ? 30 : [120, 40, 120]);
    send({ t: 'fork', r: view.round, ms });
  };
  const stabRef = useRef(stab);
  stabRef.current = stab;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
      e.preventDefault();
      stabRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (view.phase === 'result') {
    const ms = view.stab;
    const good = ms !== null && ms >= 0;
    return (
      <div class={`pv pv-center result-${view.pts > 0 ? 'good' : 'bad'}`}>
        <ForkThing k={good ? 'pierogi' : 'sock'} size={140} />
        <div class="phone-huge">{good ? (view.place === 1 ? 'Fastest fork!' : `${ordinal(view.place ?? 0)} fastest`) : stabLabel(ms)}</div>
        {good && <div class="muted">{stabLabel(ms)}</div>}
        <div class={view.pts < 0 ? 'gain-big loss' : 'gain-big'}>{view.pts > 0 ? `+${view.pts}` : view.pts}</div>
        <div class="stat-row">
          <div class="stat">
            <small>Total</small>
            <b>{view.total}</b>
          </div>
          <div class="stat">
            <small>Round</small>
            <b>
              {view.round}/{view.rounds}
            </b>
          </div>
        </div>
      </div>
    );
  }

  const status =
    mine !== null
      ? mine >= 0
        ? `Stabbed! ${stabLabel(mine)}`
        : mine === STAB_EARLY
          ? 'Too early!'
          : 'That’s not a pierogi!'
      : state === 'ready'
        ? 'Get ready…'
        : state === 'gone'
          ? 'Too slow!'
          : shown && shown !== 'pierogi'
            ? `${FORK_ITEM_NAMES[shown]}… don’t!`
            : 'Wait for the pierogi…';
  return (
    <div
      class={`pv fork-pad ${mine !== null ? (mine >= 0 ? 'hit' : 'foul') : ''}`}
      onPointerDown={(e) => {
        e.preventDefault();
        stab();
      }}
    >
      <div class="quiz-pad-top">
        <span>
          Round {view.round} / {view.rounds}
        </span>
        <span class="muted">Tap to stab</span>
      </div>
      <div class="fork-pad-plate">
        <Plate size={280}>{shown && <div class="fork-drop">{<ForkThing k={shown} size={170} />}</div>}</Plate>
      </div>
      <div class="phone-big fork-status">{status}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pierogi Parade
// ---------------------------------------------------------------------------

export function ParadePad({ view, send, offset }: Props<'parade'>) {
  const [n, setN] = useState(0);
  const nRef = useRef(0);
  const closed = useAt(view.endsAt, offset);
  const report = useLatest(150, (v) => send({ t: 'count', r: view.round, n: v }));
  const counting = view.phase === 'count' && !closed;

  const change = (d: number) => {
    if (!counting) return;
    const next = Math.max(0, Math.min(99, nRef.current + d));
    if (next === nRef.current) return;
    nRef.current = next;
    setN(next);
    vibrate(d > 0 ? 8 : 25);
    report(next);
  };
  const changeRef = useRef(change);
  changeRef.current = change;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') changeRef.current(1);
      else if (e.key === 'Backspace' || e.key === 'ArrowDown') changeRef.current(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (view.phase === 'result' && view.res) {
    const r = view.res;
    return (
      <div class={`pv pv-center result-${r.pts > 0 ? 'good' : 'bad'}`}>
        <Pierogi color={view.color} size={130} mood={r.n === r.answer ? 'wow' : 'happy'} class="pop-in" />
        <div class="phone-huge">{r.n === r.answer ? 'Spot on!' : r.n === null ? 'No count!' : `There were ${r.answer}`}</div>
        <div class="muted">{r.n === null ? `There were ${r.answer}.` : `You counted ${r.n}${r.n === r.answer ? '' : ` – ${Math.abs(r.n - r.answer)} off`}.`}</div>
        {r.pts > 0 && <div class="gain-big">+{r.pts}</div>}
        <div class="stat-row">
          <div class="stat">
            <small>Total</small>
            <b>{r.total}</b>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="pv parade-pad" style={{ '--target': view.color }}>
      <div class="quiz-pad-top">
        <span>
          Round {view.round} / {view.rounds}
        </span>
        <span class="muted">📺</span>
      </div>
      <div class="parade-pad-ask">
        Count the <Pierogi color={view.color} size={44} /> <b style={{ color: view.color }}>{view.colorName}</b> ones
      </div>
      {view.phase === 'count' && <TimeBar endsAt={view.endsAt} offset={offset} />}
      <button
        class="parade-tap"
        disabled={!counting}
        onPointerDown={(e) => {
          e.preventDefault();
          change(1);
        }}
      >
        <span class="parade-tap-n">{n}</span>
        <span class="parade-tap-label">{view.phase === 'ready' ? 'Get ready…' : closed ? 'Locked in!' : 'TAP +1'}</span>
      </button>
      <button
        class="btn btn-ghost parade-minus"
        disabled={!counting || n === 0}
        onPointerDown={(e) => {
          e.preventDefault();
          change(-1);
        }}
      >
        Oops, −1
      </button>
    </div>
  );
}
