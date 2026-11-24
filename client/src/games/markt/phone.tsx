/** Wo ist der Pieróg? on the phone: hide, seek (walk, sniff, glühwein, shake off the watch seller), tricks, and the Krampuslauf. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex } from '../../../../shared/protocol';
import { Pierogi } from '../../lib/art';
import { TimeBar } from '../../phone/timebar';
import type { Props } from '../../phone/views';
import { CLUE_TEXT, GLUEHWEIN, LAUF_GOAL, LAUF_MS, SELLER_TAPS, SPOTS, TENT, canHide, edgeKey, looking, neighbours, simulateLauf, walkMs } from './logic';
import { WatchSeller } from './art';
import './markt.css';

type View = Props<'markt'>['view'];

function vibrate(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

/** Ticks every `ms` so cooldowns and walks animate. */
function useNow(ms = 200) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Head({ view }: { view: View }) {
  return (
    <div class="quiz-pad-top">
      <span>
        Round {view.round}/{view.rounds} · {view.role === 'hider' ? '🥷 You hide' : `🔎 Find ${view.hider}`}
      </span>
      <span class="muted">{view.total.toLocaleString('en-US')}</span>
    </div>
  );
}

/** The market as a 4×3 grid of tappable stalls. */
function MapGrid({
  view,
  cls,
  onTap,
  label,
}: {
  view: View;
  cls: (i: number) => string;
  onTap?: (i: number) => void;
  label?: (i: number) => preact.ComponentChildren;
}) {
  return (
    <div class="mkp-map">
      {SPOTS.map((s, i) => {
        const c = cls(i);
        const seekersHere = view.seekers.filter((x) => x.at === i);
        return (
          <button
            class={`mkp-spot ${c}`}
            disabled={!onTap || c.includes('off')}
            onClick={() => {
              if (!onTap) return;
              vibrate(10);
              onTap(i);
            }}
          >
            <b>{s.emoji}</b>
            {s.name.length > 12 ? s.name.slice(0, 11) + '…' : s.name}
            {label?.(i)}
            {seekersHere.length > 0 && (
              <span class="mkp-dots">
                {seekersHere.map((x) => (
                  <i style={{ background: colorHex(x.color) }} />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function MarktPad(props: Props<'markt'>) {
  const { view, me } = props;
  if (view.phase === 'lauf' && view.lauf) return <LaufPad {...props} />;
  if (view.result) {
    const r = view.result;
    return (
      <div class={`pv pv-center ${r.good ? 'result-good' : 'result-bad'}`}>
        <Pierogi color={colorHex(me.color)} size={110} mood={r.good ? 'wow' : 'dead'} class="pop-in" />
        <div class="phone-huge">{r.big}</div>
        <p class="muted">{r.text}</p>
        {r.pts > 0 && <div class="gain-big">+{r.pts}</div>}
        <div class="stat-row">
          <div class="stat">
            <small>Total</small>
            <b>{view.total.toLocaleString('en-US')}</b>
          </div>
        </div>
      </div>
    );
  }
  if (view.phase === 'intro' || view.phase === 'end' || view.phase === 'lauf') {
    return (
      <div class="pv pv-center">
        <div class="mkp-emoji">🎄</div>
        <div class="phone-big">Wo ist der Pieróg?</div>
        <p class="muted">Hide-and-seek at the Vienna Christmas market. Watch the TV!</p>
      </div>
    );
  }
  if (view.role === 'hider') return <HiderPad {...props} />;
  return <SeekerPad {...props} />;
}

function HiderPad({ view, send, offset }: Props<'markt'>) {
  const now = useNow();
  const [mode, setMode] = useState<'fake' | 'sneak' | 'seller' | null>(null);
  const hostNow = now - offset;

  if (view.phase === 'hide') {
    return (
      <div class="pv mkp">
        <Head view={view} />
        <div class="mkp-title">Pick your hiding spot 🤫</div>
        <TimeBar endsAt={view.endsAt} offset={offset} />
        <MapGrid
          view={{ ...view, seekers: [] }}
          cls={(i) => (view.hideAt === i ? 'picked' : canHide(i) ? 'can' : 'off')}
          onTap={view.hideAt === null ? (i) => canHide(i) && send({ t: 'markt', key: view.key, hide: i }) : undefined}
        />
        <div class="mkp-note">{view.hideAt === null ? 'Not the tent, and not by the entrance!' : `Hidden at ${SPOTS[view.hideAt].emoji} ${SPOTS[view.hideAt].name}. Shh…`}</div>
      </div>
    );
  }

  const ready = hostNow >= view.trickReadyAt;
  const wait = Math.ceil((view.trickReadyAt - hostNow) / 1000);
  const me = view.hideAt ?? -1;
  const cls = (i: number) => {
    if (i === me) return 'here';
    if (mode === 'fake') return i === TENT ? 'off' : 'can';
    if (mode === 'sneak') return neighbours(me).includes(i) && canHide(i) && !view.seekers.some((s) => s.at === i) ? 'can' : 'off';
    return '';
  };
  return (
    <div class="pv mkp">
      <Head view={view} />
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="mkp-title">{mode === 'fake' ? 'Where should they think you are?' : mode === 'sneak' ? 'Sneak to a stall next door' : mode === 'seller' ? 'Send the watch seller to…' : 'They are coming… 👀'}</div>
      {mode === 'seller' ? (
        <div class="mkp-btns">
          {view.seekers.map((s) => (
            <button
              class="mkp-btn"
              onClick={() => {
                send({ t: 'markt', key: view.key, seller: s.id });
                setMode(null);
                vibrate(30);
              }}
            >
              <Pierogi color={colorHex(s.color)} size={30} />
              {s.name}
            </button>
          ))}
        </div>
      ) : (
        <MapGrid
          view={view}
          cls={cls}
          onTap={
            mode
              ? (i) => {
                  if (mode === 'fake' && i !== TENT) send({ t: 'markt', key: view.key, fake: i });
                  else if (mode === 'sneak' && cls(i) === 'can') send({ t: 'markt', key: view.key, sneak: i });
                  else return;
                  setMode(null);
                  vibrate(30);
                }
              : undefined
          }
        />
      )}
      <div class="mkp-note">{ready ? 'Play a trick:' : `Next trick in ${wait}s`}</div>
      <div class="mkp-btns three">
        <button class={`mkp-btn ${mode === 'fake' ? 'on' : ''}`} disabled={!ready} onClick={() => setMode(mode === 'fake' ? null : 'fake')}>
          <span>👀</span>Fake sighting
        </button>
        <button class={`mkp-btn ${mode === 'seller' ? 'on' : ''}`} disabled={!ready || view.seekers.length === 0} onClick={() => setMode(mode === 'seller' ? null : 'seller')}>
          <span>⌚</span>Watch seller
        </button>
        <button class={`mkp-btn ${mode === 'sneak' ? 'on' : ''}`} disabled={!ready || view.sneakUsed} onClick={() => setMode(mode === 'sneak' ? null : 'sneak')}>
          <span>🏃</span>
          {view.sneakUsed ? 'Used' : 'Sneak'}
        </button>
      </div>
    </div>
  );
}

function SeekerPad({ view, send, offset, me }: Props<'markt'>) {
  const now = useNow(100);
  const hostNow = now - offset;
  const [taps, setTaps] = useState(0);

  if (view.phase === 'hide') {
    return (
      <div class="pv pv-center">
        <Head view={view} />
        {view.hiderColor && <Pierogi color={colorHex(view.hiderColor)} size={100} mood="happy" />}
        <div class="phone-big">{view.hider} is hiding…</div>
        <p class="muted">No peeking at their phone! 🙈</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }

  const walking = view.walkingTo !== null;
  const nb = neighbours(view.at);
  const sniffReady = hostNow >= view.sniffReadyAt;
  const walkLeft = Math.max(0, view.arriveAt - hostNow);
  const crowdOf = (i: number) => view.crowds[edgeKey(view.at, i)] ?? 2;
  return (
    <div class={`pv mkp ${view.boosted ? 'mkp-boosted' : ''}`}>
      <Head view={view} />
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="mkp-note">
        {walking ? `Squeezing through the crowd to ${SPOTS[view.walkingTo!].emoji}…` : `You're at ${SPOTS[view.at].emoji} ${SPOTS[view.at].name}. Tap a yellow stall to walk.`}
      </div>
      {walking && (
        <div class="mkp-walk">
          <div style={{ width: `${100 - Math.min(100, (walkLeft / walkMs(crowdOf(view.walkingTo!), view.boosted)) * 100)}%` }} />
        </div>
      )}
      <MapGrid
        view={{ ...view, seekers: view.seekers.filter((s) => s.color !== me.color) }}
        cls={(i) => (i === view.at ? 'here' : i === view.walkingTo ? 'target' : !walking && nb.includes(i) ? 'can' : 'off')}
        onTap={walking ? undefined : (i) => nb.includes(i) && send({ t: 'markt', key: view.key, walk: i })}
        label={(i) =>
          !walking && nb.includes(i) ? <span class="mkp-crowd">{'👥'.repeat(crowdOf(i))}</span> : null
        }
      />
      {view.clue && view.clue.at === view.at && !walking ? (
        <div class={`mkp-clue ${view.clue.clue}`}>{CLUE_TEXT[view.clue.clue]}</div>
      ) : (
        <div class="mkp-clue">👃 Sniff to find out if you're close</div>
      )}
      <div class="mkp-btns">
        <button class="mkp-btn" disabled={walking || !sniffReady} onClick={() => (vibrate(15), send({ t: 'markt', key: view.key, sniff: true }))}>
          <span>👃</span>
          {sniffReady ? 'Sniff' : `${Math.ceil((view.sniffReadyAt - hostNow) / 1000)}s`}
        </button>
        <button
          class="mkp-btn"
          disabled={walking || view.at !== GLUEHWEIN || view.boosted}
          onClick={() => (vibrate([30, 30, 30]), send({ t: 'markt', key: view.key, drink: true }))}
        >
          <span>🍷</span>
          {view.boosted ? 'Bold & wobbly' : view.at === GLUEHWEIN ? 'Glühwein!' : 'Glühwein stand only'}
        </button>
      </div>
      {view.seller > 0 && (
        <div class="mkp-seller">
          <WatchSeller />
          <div class="phone-big">"Psst! Genuine Rolex, only 10 €!"</div>
          <p>Get rid of him: {view.seller} more</p>
          <button
            class="mkp-nein"
            onPointerDown={(e) => {
              e.preventDefault();
              vibrate(8);
              setTaps(taps + 1);
              send({ t: 'markt', key: view.key, nein: true });
            }}
          >
            Nein, danke! ✋
          </button>
          <p class="muted">{SELLER_TAPS - view.seller} / {SELLER_TAPS}</p>
        </div>
      )}
    </div>
  );
}

/** Krampuslauf: hold to skate, let go the moment he looks. Holds are recorded here and replayed on the host. */
function LaufPad({ view, send, offset }: Props<'markt'>) {
  const lf = view.lauf!;
  const holds = useRef<[number, number | null][]>([]);
  const sent = useRef(false);
  const lastLive = useRef(0);
  const [holding, setHolding] = useState(false);
  const [t, setT] = useState(-99999);
  const hostNow = () => Date.now() - offset;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const tt = hostNow() - lf.startAt;
      setT(tt);
      if (tt > 0 && Date.now() - lastLive.current > 350 && !sent.current) {
        lastLive.current = Date.now();
        const cur = holds.current.map(([p, r]): [number, number | null] => [p, r ?? Math.min(tt, LAUF_MS)]);
        send({ t: 'markt', key: view.key, live: simulateLauf(cur, lf.schedule).dist });
      }
      if (tt >= LAUF_MS) {
        if (!sent.current) {
          sent.current = true;
          send({ t: 'markt', key: view.key, holds: holds.current });
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [view.key, lf.startAt]);

  const press = () => {
    const tt = hostNow() - lf.startAt;
    if (tt < 0 || tt > LAUF_MS || sent.current) return;
    holds.current.push([tt, null]);
    setHolding(true);
    vibrate(8);
  };
  const release = () => {
    const last = holds.current[holds.current.length - 1];
    if (last && last[1] === null) last[1] = hostNow() - lf.startAt;
    setHolding(false);
  };

  const cur = holds.current.map(([p, r]): [number, number | null] => [p, r ?? Math.max(p, Math.min(t, LAUF_MS))]);
  const sim = simulateLauf(cur, lf.schedule);
  const isLooking = t >= 0 && looking(lf.schedule, t);
  // Caught on the current hold: he saw you.
  const caughtNow = holding && isLooking;
  useEffect(() => {
    if (caughtNow) vibrate([200]);
  }, [caughtNow]);

  return (
    <div class="pv mkp">
      <div class="mkp-title">KRAMPUSLAUF! ⛸️👹</div>
      <div class="mkp-lauf">
        <div class={`mkp-krampus ${isLooking ? 'looking' : ''}`}>
          {t < 0 ? `Get ready… ${Math.ceil(-t / 1000)}` : t >= LAUF_MS ? 'Done!' : isLooking ? '👹 HE SEES YOU! FREEZE!' : '💤 He is looking away… GO!'}
        </div>
        <div class="mkp-track">
          <div style={{ width: `${(sim.dist / LAUF_GOAL) * 100}%` }} />
        </div>
        <div class="mkp-note">
          {Math.round(sim.dist)} / {LAUF_GOAL} m {sim.caught > 0 ? `· caught ${sim.caught}× 😱` : ''}
        </div>
        <button
          class={`mkp-hold ${holding ? 'holding' : ''} ${caughtNow ? 'caught' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              /* synthetic pointer */
            }
            press();
          }}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <span>{caughtNow ? '😱' : '⛸️'}</span>
          {caughtNow ? 'LET GO!' : holding ? 'Skating…' : 'HOLD to skate'}
        </button>
      </div>
    </div>
  );
}
