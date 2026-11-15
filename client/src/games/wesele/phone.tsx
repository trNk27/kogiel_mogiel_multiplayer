/**
 * Wesele on the phone. Everything gets harder the drunker you are (see wesele.css):
 *   1+ the screen sways · 2+ blurry · 3+ double vision, and the polka feet swap sides
 *   4+ your taps land late and the buttons wander · 5 hiccups.
 * Timed tasks are measured here on the phone (in host time) and sent once, so slow wifi doesn't matter.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex } from '../../../../shared/protocol';
import { Pierogi } from '../../lib/art';
import { TimeBar } from '../../phone/timebar';
import type { Props } from '../../phone/views';
import { MAX_DRUNK, dizzy } from './logic';
import './wesele.css';

type View = Props<'wesele'>['view'];

function vibrate(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

/** Keep getting the pointer's events even if the drunk thumb slides off the button. */
function capture(e: PointerEvent) {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* not supported, or a synthetic pointer */
  }
}

/** How far off a drunk tap lands, ms: a random wobble, plus a lag from level 4. */
function drunkSlip(drunk: number): number {
  const wobble = (Math.random() - 0.5) * 2 * drunk * 28;
  return Math.round(wobble + (drunk >= 4 ? 110 : 0));
}

function Meter({ drunk }: { drunk: number }) {
  return (
    <span class="wp-meter" aria-label={`Drunk ${drunk} of ${MAX_DRUNK}`}>
      {Array.from({ length: MAX_DRUNK }, (_, i) => (
        <i class={i < drunk ? 'full' : ''}>🥃</i>
      ))}
    </span>
  );
}

function Shell({ view, children, class: cls = '' }: { view: View; children: preact.ComponentChildren; class?: string }) {
  return (
    <div class={`pv wp-pad drunk-${view.drunk} ${cls}`}>
      <div class="quiz-pad-top">
        <span>
          🕐 {view.clock} · Song {view.song}/{view.songs}
        </span>
        <span class="muted">{view.total.toLocaleString('en-US')}</span>
      </div>
      <Meter drunk={view.drunk} />
      <div class="wp-sway">{children}</div>
      {view.drunk >= 5 && <div class="wp-hic">hic!</div>}
    </div>
  );
}

export function WeselePad(props: Props<'wesele'>) {
  const { view, me } = props;
  switch (view.phase) {
    case 'intro':
      return (
        <Shell view={view}>
          <div class="pv-center wp-center">
            <div class="wp-emoji">💒</div>
            <div class="phone-big">Welcome to the wedding!</div>
            <p class="muted">Every shot makes your phone harder to use. Survive till 3:00.</p>
          </div>
        </Shell>
      );
    case 'out':
      return (
        <Shell view={view} class="wp-out">
          <div class="pv-center wp-center">
            <Pierogi color={colorHex(me.color)} size={110} mood="sleep" />
            <div class="phone-big">You're under the table 💤</div>
            <p class="muted">You'll wake up for the next song.</p>
          </div>
        </Shell>
      );
    case 'wait':
      return (
        <Shell view={view}>
          <div class="pv-center wp-center">
            <div class="wp-emoji">👀</div>
            <div class="phone-big">{view.text ?? 'Watch the TV'}</div>
          </div>
        </Shell>
      );
    case 'result':
    case 'end': {
      const r = view.result;
      return (
        <Shell view={view}>
          <div class={`pv-center wp-center ${r ? (r.good ? 'result-good' : 'result-bad') : ''}`}>
            {view.phase === 'end' && <div class="wp-emoji">🌅</div>}
            {r ? (
              <>
                <Pierogi color={colorHex(me.color)} size={100} mood={r.good ? 'wow' : 'dead'} class="pop-in" />
                <div class="phone-big">{r.big}</div>
                {r.text && <p class="muted">{r.text}</p>}
                {r.drank > 0 && <div class="wp-drank pop-in">🥃 +1 shot</div>}
                {r.pts > 0 && <div class="gain-big">+{r.pts}</div>}
              </>
            ) : (
              <div class="phone-big">3:00. Go home!</div>
            )}
          </div>
        </Shell>
      );
    }
    case 'shot':
      return <ShotPad {...props} />;
    case 'dance':
      return <DancePad {...props} />;
    case 'pair':
      return <PairPad {...props} />;
    case 'gorzko':
      return <GorzkoPad {...props} />;
  }
}

/** Kolejka: swipe the glass up to drink. */
function ShotPad({ view, send, offset }: Props<'wesele'>) {
  const [drunk, setDrunk] = useState(view.done);
  const [lift, setLift] = useState(0);
  const y0 = useRef<number | null>(null);
  const done = drunk || view.done;
  const go = () => {
    if (done) return;
    setDrunk(true);
    vibrate([40, 40, 120]);
    send({ t: 'wesele', key: view.key, drink: true });
  };
  return (
    <Shell view={view}>
      <div class="wp-title">KOLEJKA! 🥃</div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div
        class="wp-shot-area"
        onPointerDown={(e) => {
          y0.current = e.clientY;
          capture(e);
        }}
        onPointerMove={(e) => {
          if (y0.current === null || done) return;
          const d = Math.max(0, y0.current - e.clientY);
          setLift(d);
          if (d > 110) go();
        }}
        onPointerUp={() => {
          y0.current = null;
          setLift(0);
        }}
      >
        <div class={`wp-glass ${done ? 'empty' : ''}`} style={{ transform: done ? undefined : `translateY(${-lift}px) rotate(${Math.min(60, lift / 2)}deg)` }}>
          <div class="wp-vodka" />
        </div>
        <div class="phone-big">{done ? 'Do dna! Bottoms up!' : '⬆️ Swipe the glass up to drink'}</div>
      </div>
    </Shell>
  );
}

/**
 * Twirl with Wujek: spin your finger round the dance floor. Only spinning one way counts (wiggling back and
 * forth gets you nowhere), and the drunker you are, the dizzier: each circle counts for less.
 */
function DancePad({ view, me, send, offset }: Props<'wesele'>) {
  const d = view.dance!;
  const area = useRef<HTMLDivElement>(null);
  const last = useRef<number | null>(null);
  const sum = useRef(0);
  const sentN = useRef(0);
  const [angle, setAngle] = useState(0);
  const [n, setN] = useState(0);
  const [state, setState] = useState<'wait' | 'go' | 'done'>('wait');
  const hostNow = () => Date.now() - offset;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = hostNow();
      if (now >= d.endAt) {
        setState('done');
        send({ t: 'wesele', key: view.key, n: sentN.current });
        return;
      }
      setState(now >= d.startAt ? 'go' : 'wait');
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [view.key]);

  const angleOf = (e: PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const move = (e: PointerEvent) => {
    if (last.current === null) return;
    const now = hostNow();
    const a = angleOf(e);
    let delta = a - last.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    last.current = a;
    if (now < d.startAt || now > d.endAt) return;
    sum.current += delta;
    setAngle(sum.current);
    const twirls = Math.floor((Math.abs(sum.current) / 360) * dizzy(view.drunk));
    if (twirls > sentN.current) {
      sentN.current = twirls;
      setN(twirls);
      vibrate(twirls >= d.need ? [30, 30, 30] : 15);
      send({ t: 'wesele', key: view.key, n: twirls });
    }
  };

  return (
    <Shell view={view}>
      <div class="wp-title">{d.attempt > 1 ? 'Dance again!' : 'Twirl with Wujek!'}</div>
      <div class="wp-status">
        {state === 'wait' ? 'Get ready… put your finger on the floor' : state === 'go' ? `🌀 ${n} / ${d.need} twirls` : `${n} twirls!`}
      </div>
      <div
        ref={area}
        class={`wp-twirl ${state} ${n >= d.need ? 'made' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          capture(e);
          last.current = angleOf(e);
        }}
        onPointerMove={move}
        onPointerUp={() => (last.current = null)}
        onPointerCancel={() => (last.current = null)}
      >
        <div class="wp-twirl-ring" />
        <div class="wp-twirl-guest" style={{ transform: `rotate(${angle}deg)` }}>
          <Pierogi color={colorHex(me.color)} size={90} mood={n >= d.need ? 'wow' : 'happy'} />
        </div>
        <div class="wp-twirl-hint">{state === 'go' && n === 0 ? '↻ draw circles' : ''}</div>
      </div>
      <div class="wp-twirl-bar">
        <div style={{ width: `${Math.min(100, (n / d.need) * 100)}%` }} />
      </div>
    </Shell>
  );
}

/** Oczepiny: hold the button, let go together with your partner on NOW! */
function PairPad({ view, send, offset }: Props<'wesele'>) {
  const pr = view.pair!;
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(view.done);
  const [left, setLeft] = useState(99);
  const hostNow = () => Date.now() - offset;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setLeft(pr.nowAt - hostNow());
      if (pr.nowAt - hostNow() > -2000) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [view.key]);
  const release = () => {
    if (!holding || done) return;
    setHolding(false);
    setDone(true);
    vibrate(30);
    send({ t: 'wesele', key: view.key, at: hostNow() - pr.nowAt + drunkSlip(view.drunk) });
  };
  const count = left > 3000 ? 'Hold it…' : left > 0 ? String(Math.ceil(left / 1000)) : 'NOW!';
  return (
    <Shell view={view}>
      <div class="wp-title">{pr.title}</div>
      <div class="wp-partner">
        with{' '}
        {pr.partnerColor ? <Pierogi color={colorHex(pr.partnerColor)} size={34} /> : '👨‍🦲'} <b>{pr.partner}</b>
        {pr.attempt > 1 && <span class="muted"> · try {pr.attempt}</span>}
      </div>
      <div class={`wp-count ${count === 'NOW!' ? 'now' : ''}`}>{done ? '✓' : count}</div>
      <button
        class={`wp-hold ${holding ? 'holding' : ''} ${done ? 'done' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          if (done) return;
          capture(e);
          setHolding(true);
          vibrate(8);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <span class="wp-hold-emoji">{pr.button}</span>
        <span>{done ? 'Let go!' : holding ? 'Let go on NOW!' : 'Hold me'}</span>
      </button>
    </Shell>
  );
}

/** Gorzko: tap as fast as you can. */
function GorzkoPad({ view, send, offset }: Props<'wesele'>) {
  const g = view.gorzko!;
  const n = useRef(0);
  const sent = useRef(view.done);
  const [count, setCount] = useState(0);
  const [state, setState] = useState<'wait' | 'go' | 'done'>('wait');
  const hostNow = () => Date.now() - offset;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = hostNow();
      if (now >= g.endAt + 150) {
        setState('done');
        if (!sent.current) {
          sent.current = true;
          send({ t: 'wesele', key: view.key, n: n.current });
        }
        return;
      }
      setState(now >= g.startAt ? 'go' : 'wait');
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [view.key]);
  return (
    <Shell view={view}>
      <div class="wp-title">GORZKO! GORZKO!</div>
      <div class="wp-status">{state === 'wait' ? 'Get ready…' : state === 'go' ? 'TAP TAP TAP!' : `${count} taps!`}</div>
      <div class="wp-gorzko-area">
        <button
          class={`wp-gorzko ${state}`}
          onPointerDown={(e) => {
            e.preventDefault();
            const now = hostNow();
            if (now < g.startAt || now > g.endAt) return;
            n.current++;
            setCount(n.current);
            vibrate(5);
          }}
        >
          💋<b>{count}</b>
        </button>
      </div>
    </Shell>
  );
}
