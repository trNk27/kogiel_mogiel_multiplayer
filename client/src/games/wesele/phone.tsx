/**
 * Wesele on the phone. Everything gets harder the drunker you are (see wesele.css):
 *   1+ the screen sways · 2+ blurry · 3+ double vision, and the duck-dance buttons swap places
 *   4+ your taps land late and the buttons wander · 5 hiccups.
 * Timed tasks are measured here on the phone (in host time) and sent once, so slow wifi doesn't matter.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex } from '../../../../shared/protocol';
import { Pierogi } from '../../lib/art';
import { TimeBar } from '../../phone/timebar';
import type { Props } from '../../phone/views';
import { CHALLENGES, MAX_DRUNK, MOVES, TOAST_PTS, dizzy, pourRate, spilled, trainError, TRAIN_MISS_MS } from './logic';
import './wesele.css';

type View = Props<'wesele'>['view'];
type Ch = NonNullable<View['ch']>;

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

/** Calls `fn` every frame with host time until it returns false. */
function useFrames(fn: (now: number) => boolean | void, deps: unknown[]) {
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (fn(Date.now()) === false) return;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, deps);
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
        <span class="muted">{view.total.toLocaleString('en-US')} pts</span>
      </div>
      <Meter drunk={view.drunk} />
      {view.drunk >= MAX_DRUNK && view.phase !== 'out' && <div class="wp-warn">⚠️ Full! One more shot and you pass out</div>}
      <div class="wp-sway">{children}</div>
      {view.drunk >= 5 && <div class="wp-hic">hic!</div>}
    </div>
  );
}

/** The challenge's name and what wins / what drinks, over every challenge pad. */
function Head({ ch, sub }: { ch: Ch; sub?: string }) {
  const info = CHALLENGES[ch.id];
  return (
    <div class="wp-head">
      <div class="wp-title">
        {info.emoji} {info.name}
      </div>
      <div class="wp-stakes">
        <span class="win">🏆 {info.win}</span>
        <span class="lose">🥃 {info.lose}</span>
      </div>
      {sub && <div class="wp-status">{sub}</div>}
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
            <ul class="wp-rules">
              <li>🏆 Most points at 3:00 wins</li>
              <li>🥃 Lose a challenge: drink</li>
              <li>🌀 Drunk = harder controls</li>
              <li>💤 Full meter + 1 = passed out</li>
            </ul>
          </div>
        </Shell>
      );
    case 'song':
      return (
        <Shell view={view}>
          <div class="pv-center wp-center">
            <div class="wp-emoji">🎤</div>
            <div class="muted">The band plays</div>
            <div class="phone-big">♪ {view.title} ♪</div>
            {view.zurek && <div class="wp-zurek pop-in">🍲 Żurek! You sober up a bit</div>}
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
      const v = r?.verdict;
      const good = v === 'win' || v === 'safe' || v === 'toast' || v === 'kompot' || v === 'end';
      return (
        <Shell view={view}>
          <div class={`pv-center wp-center wp-verdict v-${v ?? 'none'}`}>
            {view.phase === 'end' && <div class="wp-emoji">🌅</div>}
            {r ? (
              <>
                <Pierogi color={colorHex(me.color)} size={100} mood={v === 'out' ? 'sleep' : good ? 'wow' : 'dead'} class="pop-in" />
                <div class="wp-big pop-in">{r.big}</div>
                {r.text && <p class="wp-why">{r.text}</p>}
                {(v === 'drink' || v === 'toast') && <div class="wp-drank pop-in">+1 🥃 on your meter</div>}
              </>
            ) : (
              <div class="phone-big">3:00. Go home!</div>
            )}
          </div>
        </Shell>
      );
    }
    case 'toast':
      return <ToastPad {...props} />;
    case 'play':
      switch (view.ch?.id) {
        case 'twirl':
          return <TwirlPad {...props} />;
        case 'pair':
          return <PairPad {...props} />;
        case 'gorzko':
          return <GorzkoPad {...props} />;
        case 'pour':
          return <PourPad {...props} />;
        case 'kaczuchy':
          return <MovesPad {...props} />;
        case 'train':
          return <TrainPad {...props} />;
      }
      return null;
  }
}

/** The toast: drink it for points, or kompot. */
function ToastPad({ view, send, offset }: Props<'wesele'>) {
  const [pick, setPick] = useState(view.toast ?? null);
  const choose = (c: 'drink' | 'kompot') => {
    if (pick) return;
    setPick(c);
    vibrate(c === 'drink' ? [40, 40, 120] : 30);
    send({ t: 'wesele', key: view.key, choice: c });
  };
  return (
    <Shell view={view}>
      <div class="wp-title">🥂 A toast to the couple!</div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      {pick ? (
        <div class="pv-center wp-center">
          <div class="wp-emoji">{pick === 'drink' ? '🥃' : '🧃'}</div>
          <div class="phone-big">{pick === 'drink' ? 'Bottoms up!' : 'Kompot it is'}</div>
          <p class="muted">Wait for the others…</p>
        </div>
      ) : (
        <div class="wp-toast">
          <button class="wp-choice drink" onClick={() => choose('drink')}>
            <span class="wp-choice-emoji">🥃</span>
            <b>Drink</b>
            <small>+{TOAST_PTS} pts · +1 shot</small>
          </button>
          <button class="wp-choice kompot" onClick={() => choose('kompot')}>
            <span class="wp-choice-emoji">🧃</span>
            <b>Kompot</b>
            <small>no points · stay sober</small>
          </button>
        </div>
      )}
    </Shell>
  );
}

/**
 * Twirl with Wujek: spin your finger round the dance floor. Only spinning one way counts (wiggling back and
 * forth gets you nowhere), and the drunker you are, the dizzier: each circle counts for less.
 */
function TwirlPad({ view, me, send, offset }: Props<'wesele'>) {
  const ch = view.ch!;
  const need = ch.need ?? 6;
  const area = useRef<HTMLDivElement>(null);
  const last = useRef<number | null>(null);
  const sum = useRef(0);
  const sentN = useRef(0);
  const [angle, setAngle] = useState(0);
  const [n, setN] = useState(0);
  const [state, setState] = useState<'wait' | 'go' | 'done'>('wait');
  const hostNow = () => Date.now() - offset;

  useFrames(() => {
    const now = hostNow();
    if (now >= ch.endAt) {
      setState('done');
      send({ t: 'wesele', key: view.key, v: sentN.current });
      return false;
    }
    setState(now >= ch.goAt ? 'go' : 'wait');
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
    if (now < ch.goAt || now > ch.endAt) return;
    sum.current += delta;
    setAngle(sum.current);
    const twirls = Math.floor((Math.abs(sum.current) / 360) * dizzy(view.drunk));
    if (twirls > sentN.current) {
      sentN.current = twirls;
      setN(twirls);
      vibrate(twirls >= need ? [30, 30, 30] : 15);
      send({ t: 'wesele', key: view.key, v: twirls, live: true });
    }
  };

  return (
    <Shell view={view}>
      <Head ch={ch} sub={state === 'wait' ? 'Get ready… finger on the floor' : state === 'go' ? `🌀 ${n} / ${need} twirls` : `${n} twirls!`} />
      <div
        ref={area}
        class={`wp-twirl ${state} ${n >= need ? 'made' : ''}`}
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
          <Pierogi color={colorHex(me.color)} size={90} mood={n >= need ? 'wow' : 'happy'} />
        </div>
        <div class="wp-twirl-hint">{state === 'go' && n === 0 ? '↻ draw circles' : ''}</div>
      </div>
      <div class="wp-bar">
        <div style={{ width: `${Math.min(100, (n / need) * 100)}%` }} />
      </div>
    </Shell>
  );
}

/** Oczepiny: hold the button, let go together with your partner on NOW! */
function PairPad({ view, send, offset }: Props<'wesele'>) {
  const ch = view.ch!;
  const pr = ch.pair!;
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(view.done);
  const [left, setLeft] = useState(99999);
  const hostNow = () => Date.now() - offset;
  useFrames(() => {
    setLeft(ch.goAt - hostNow());
    return ch.goAt - hostNow() > -2000;
  }, [view.key]);
  const release = () => {
    if (!holding || done) return;
    setHolding(false);
    setDone(true);
    vibrate(30);
    send({ t: 'wesele', key: view.key, v: hostNow() - ch.goAt + drunkSlip(view.drunk) });
  };
  const count = left > 3000 ? 'Hold it…' : left > 0 ? String(Math.ceil(left / 1000)) : 'NOW!';
  return (
    <Shell view={view}>
      <Head ch={ch} />
      <div class="wp-status">{pr.title}</div>
      <div class="wp-partner">
        with{pr.partnerColor ? <Pierogi color={colorHex(pr.partnerColor)} size={30} /> : '👨‍🦲'} <b>{pr.partner}</b>
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
  const ch = view.ch!;
  const n = useRef(0);
  const sent = useRef(view.done);
  const lastLive = useRef(0);
  const [count, setCount] = useState(0);
  const [state, setState] = useState<'wait' | 'go' | 'done'>('wait');
  const hostNow = () => Date.now() - offset;
  useFrames(() => {
    const now = hostNow();
    if (now >= ch.endAt + 150) {
      setState('done');
      if (!sent.current) {
        sent.current = true;
        send({ t: 'wesele', key: view.key, v: n.current });
      }
      return false;
    }
    setState(now >= ch.goAt ? 'go' : 'wait');
    if (now - lastLive.current > 350 && now >= ch.goAt) {
      lastLive.current = now;
      send({ t: 'wesele', key: view.key, v: n.current, live: true });
    }
  }, [view.key]);
  return (
    <Shell view={view}>
      <Head ch={ch} sub={state === 'wait' ? 'Get ready…' : state === 'go' ? 'TAP TAP TAP!' : `${count} taps!`} />
      <div class="wp-gorzko-area">
        <button
          class={`wp-gorzko ${state}`}
          onPointerDown={(e) => {
            e.preventDefault();
            const now = hostNow();
            if (now < ch.goAt || now > ch.endAt) return;
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

/** Nalewanie: hold to pour, let go at the line. The drunker you are, the more the bottle surges. */
function PourPad({ view, send, offset }: Props<'wesele'>) {
  const ch = view.ch!;
  const line = ch.line ?? 0.7;
  const [level, setLevel] = useState(0);
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(view.done);
  const [state, setState] = useState<'wait' | 'go' | 'done'>('wait');
  const lv = useRef(0);
  const hold = useRef(false);
  const fin = useRef(view.done);
  const t0 = useRef(0);
  const lastT = useRef(0);
  const lastLive = useRef(0);
  const hostNow = () => Date.now() - offset;
  const finish = () => {
    if (fin.current) return;
    fin.current = true;
    hold.current = false;
    setHolding(false);
    setDone(true);
    vibrate(spilled(lv.current, line) ? [200, 60, 200] : 40);
    send({ t: 'wesele', key: view.key, v: lv.current });
  };
  useFrames(() => {
    const now = hostNow();
    if (now >= ch.endAt) {
      setState('done');
      if (lv.current > 0) finish();
      return false;
    }
    setState(now >= ch.goAt ? 'go' : 'wait');
    const dt = Math.min(0.1, (now - lastT.current) / 1000);
    lastT.current = now;
    if (hold.current && !fin.current) {
      lv.current = Math.min(1.2, lv.current + pourRate((now - t0.current) / 1000, view.drunk) * dt);
      setLevel(lv.current);
      if (now - lastLive.current > 120) {
        lastLive.current = now;
        send({ t: 'wesele', key: view.key, v: lv.current, live: true });
      }
      if (lv.current >= 1.2) finish();
    }
  }, [view.key]);
  const spill = spilled(level, line);
  return (
    <Shell view={view}>
      <Head ch={ch} sub={state === 'wait' ? 'Get ready…' : done ? (spill ? 'Spilled! 💦' : `Stopped at ${Math.round(level * 100)}%`) : holding ? 'Pouring… let go at the line!' : 'Hold the button to pour'} />
      <div class="wp-pour">
        <div class={`wp-pour-bottle ${holding ? 'tilt' : ''}`}>🍾</div>
        <div class={`wp-pour-glass ${spill ? 'spill' : ''}`}>
          <div class="wp-pour-fill" style={{ height: `${Math.min(100, level * 100)}%` }} />
          <div class="wp-pour-line" style={{ bottom: `${line * 100}%` }}>
            <span>line</span>
          </div>
        </div>
      </div>
      <button
        class={`wp-hold wp-pour-btn ${holding ? 'holding' : ''} ${done ? 'done' : ''} ${state !== 'go' ? 'off' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          if (fin.current || hostNow() < ch.goAt) return;
          capture(e);
          hold.current = true;
          t0.current = hostNow();
          lastT.current = hostNow();
          setHolding(true);
          vibrate(8);
        }}
        onPointerUp={() => hold.current && finish()}
        onPointerCancel={() => hold.current && finish()}
      >
        <span>{done ? '✓' : holding ? 'Let go!' : 'Hold to pour'}</span>
      </button>
    </Shell>
  );
}

/** Kaczuchy: watch the moves on the TV, then tap them back in order. */
function MovesPad({ view, send, offset }: Props<'wesele'>) {
  const ch = view.ch!;
  const len = ch.len ?? 4;
  const inputAt = ch.inputAt ?? ch.goAt;
  const [got, setGot] = useState<number[]>([]);
  const [state, setState] = useState<'watch' | 'go' | 'done'>('watch');
  const [order, setOrder] = useState([0, 1, 2, 3]);
  const fin = useRef(view.done);
  const hostNow = () => Date.now() - offset;
  useFrames(() => {
    const now = hostNow();
    if (now >= ch.endAt) {
      setState('done');
      return false;
    }
    setState(fin.current ? 'done' : now >= inputAt ? 'go' : 'watch');
  }, [view.key]);
  const tap = (m: number) => {
    if (fin.current || hostNow() < inputAt) return;
    const next = [...got, m];
    setGot(next);
    vibrate(12);
    // Drunk: the buttons swap places after every tap.
    if (view.drunk >= 3) setOrder((o) => [...o.slice(1), o[0]].sort(() => (view.drunk >= 4 ? Math.random() - 0.5 : 0)));
    if (next.length >= len) {
      fin.current = true;
      setState('done');
      send({ t: 'wesele', key: view.key, v: hostNow() - inputAt, moves: next });
    } else send({ t: 'wesele', key: view.key, v: next.length, live: true });
  };
  return (
    <Shell view={view}>
      <Head ch={ch} sub={state === 'watch' ? '👀 Watch the TV! Remember the moves' : state === 'go' ? 'Your turn: tap the moves in order!' : 'Done! Did you get it right?'} />
      <div class="wp-dots">
        {Array.from({ length: len }, (_, i) => (
          <span class={i < got.length ? 'on' : ''}>{i < got.length ? MOVES[got[i]].emoji : '○'}</span>
        ))}
      </div>
      <div class={`wp-moves ${state}`}>
        {order.map((m) => (
          <button class={`wp-move m${m}`} onClick={() => tap(m)} disabled={state !== 'go'}>
            <span>{MOVES[m].emoji}</span>
            <small>{MOVES[m].name}</small>
          </button>
        ))}
      </div>
    </Shell>
  );
}

/** Pociąg: dots roll along the track; tap as each one reaches the ring. */
function TrainPad({ view, send, offset }: Props<'wesele'>) {
  const ch = view.ch!;
  const beat = ch.beat ?? 600;
  const beats = Array.from({ length: ch.beats ?? 8 }, (_, k) => ch.goAt + k * beat);
  const taps = useRef<number[]>([]);
  const sent = useRef(view.done);
  const [, setFrame] = useState(0);
  const [flash, setFlash] = useState(0);
  const [hits, setHits] = useState(0);
  const hostNow = () => Date.now() - offset;
  useFrames(() => {
    const now = hostNow();
    setFrame(now);
    if (now >= ch.endAt + 100) {
      if (!sent.current) {
        sent.current = true;
        send({ t: 'wesele', key: view.key, v: trainError(taps.current, beats).err });
      }
      return false;
    }
  }, [view.key]);
  const now = hostNow();
  const lead = 2 * beat;
  return (
    <Shell view={view}>
      <Head ch={ch} sub={now < ch.goAt - lead ? 'Get ready…' : now > ch.endAt ? `${hits} of ${beats.length} on the beat` : 'Tap when a dot hits the ring!'} />
      <div class="wp-track">
        <div class={`wp-track-ring ${now - flash < 150 ? 'hit' : ''}`} />
        {beats.map((b) => {
          const t = b - now;
          if (t > lead * 1.4 || t < -300) return null;
          return <span class="wp-track-dot" style={{ left: `calc(18% + ${(t / lead) * 70}%)`, opacity: t < 0 ? 0.3 : 1 }} />;
        })}
      </div>
      <button
        class="wp-gorzko wp-train-btn"
        onPointerDown={(e) => {
          e.preventDefault();
          const t = hostNow() + drunkSlip(view.drunk);
          if (t < ch.goAt - TRAIN_MISS_MS || t > ch.endAt) return;
          taps.current.push(t);
          setFlash(hostNow());
          vibrate(10);
          const h = trainError(taps.current, beats.filter((b) => b <= t + TRAIN_MISS_MS)).hits;
          setHits(h);
          send({ t: 'wesele', key: view.key, v: h, live: true });
        }}
      >
        🚂
      </button>
    </Shell>
  );
}
