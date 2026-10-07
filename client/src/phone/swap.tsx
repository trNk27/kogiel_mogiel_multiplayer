/** Podmianka on the phone: watch the TV, then tap the thing that's new. */
import { useState } from 'preact/hooks';
import { colorHex } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import { TimeBar } from './timebar';
import type { Props } from './views';

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

export function SwapPad({ view, me, send, offset }: Props<'swap'>) {
  const [local, setLocal] = useState<number | null>(null);
  const picked = view.picked ?? local;
  const head = (
    <div class="quiz-pad-top">
      <span>
        Round {view.round} / {view.rounds}
      </span>
      <span class="muted">Podmianka</span>
    </div>
  );

  if (view.phase === 'look' || view.phase === 'curtain') {
    const look = view.phase === 'look';
    return (
      <div class="pv swap-pad">
        {head}
        <div class="pv-center swap-wait">
          <div class={`swap-eye ${look ? '' : 'closed'}`}>{look ? '👀' : '🎭'}</div>
          <div class="phone-big">{look ? 'Look at the TV!' : 'Curtain!'}</div>
          <p class="muted">{look ? 'Remember everything on the shelves.' : 'Something is being swapped…'}</p>
          {look && <TimeBar endsAt={view.endsAt} offset={offset} />}
        </div>
      </div>
    );
  }

  if (view.phase === 'result' && view.res) {
    const r = view.res;
    return (
      <div class={`pv pv-center result-${r.correct ? 'good' : 'bad'}`}>
        <Pierogi color={colorHex(me.color)} size={120} mood={r.correct ? 'wow' : picked === null ? 'sleep' : 'dead'} class="pop-in" />
        <div class="phone-huge">{r.correct ? 'Spotted it!' : picked === null ? 'Too slow!' : 'Not that one!'}</div>
        <div class="swap-swapped">
          <img src={r.removedSrc} alt="" class="was" />
          <span>→</span>
          {view.items && <img src={view.items[r.answer]} alt="" />}
        </div>
        <p class="muted">
          Out: {r.removed} · In: {r.added}
        </p>
        {r.pts > 0 && <div class="gain-big">+{r.pts}</div>}
        <div class="stat-row">
          <div class="stat">
            <small>Total</small>
            <b>{r.total.toLocaleString('en-US')}</b>
          </div>
        </div>
      </div>
    );
  }

  // Pick.
  if (picked !== null && view.items) {
    return (
      <div class="pv pv-center">
        <div class="phone-small muted">Your pick</div>
        <img class="swap-picked pop-in" src={view.items[picked]} alt="" />
        <p class="muted">Let’s see if you’re right…</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  return (
    <div class="pv swap-pad">
      {head}
      <div class="swap-ask">Which one is new?</div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="swap-grid">
        {(view.items ?? []).map((src, i) => (
          <button
            class="swap-btn"
            onPointerDown={(e) => {
              e.preventDefault();
              if (picked !== null) return;
              setLocal(i);
              vibrate(12);
              send({ t: 'pick', i });
            }}
          >
            <img src={src} alt="" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}
