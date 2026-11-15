/** Wybredna Baja on the phone: build a plate (one pick per row), feed her, and see how she liked it. */
import { useState } from 'preact/hooks';
import { colorHex } from '../../../../shared/protocol';
import { Pierogi } from '../../lib/art';
import { TimeBar } from '../../phone/timebar';
import type { Props } from '../../phone/views';
import { ROWS, plateEmoji, reactionFor } from './logic';
import './baja.css';

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

const FACE = { snub: '😤', lick: '👅', spit: '💦', eat: '😍' } as const;

function History({ view }: { view: Props<'baja'>['view'] }) {
  if (!view.history.length) return null;
  return (
    <div class="bj-hist">
      {view.history.map((h, k) => {
        const stale = view.changed.length > 0 && k < 2 && view.round >= 3;
        return (
          <div class={`bj-hist-row ${stale ? 'stale' : ''}`}>
            <span class="bj-hist-n">{k + 1}</span>
            <span class="bj-hist-plate">{h.plate ? plateEmoji(h.plate).join(' ') : '💤'}</span>
            <span class="bj-hist-paws">
              {Array.from({ length: view.rows }, (_, i) => (
                <i class={i < h.hits ? 'on' : ''}>🐾</i>
              ))}
            </span>
            {h.plate && <span>{FACE[reactionFor(h.hits, view.rows)]}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function BajaPad({ view, me, send, offset }: Props<'baja'>) {
  // Start from your last plate, so you only change what you want to change.
  const [plate, setPlate] = useState<(number | null)[]>(() => {
    const last = [...view.history].reverse().find((h) => h.plate)?.plate;
    return Array.from({ length: view.rows }, (_, i) => last?.[i] ?? null);
  });
  const [sentLocal, setSentLocal] = useState(false);
  const sent = view.sent ?? (sentLocal ? (plate as number[]) : null);
  const hint = ROWS[view.hint.row].options[view.hint.opt];
  const head = (
    <div class="quiz-pad-top">
      <span>
        Craving {view.round} / {view.rounds}
        {view.phase !== 'intro' && view.phase !== 'reveal' && ` · Try ${view.tryN} / ${view.tries}`}
      </span>
      <span class="muted">{view.total.toLocaleString('en-US')} pts</span>
    </div>
  );

  if (view.phase === 'reveal' && view.answer) {
    const fed = view.fed !== null;
    return (
      <div class={`pv pv-center result-${fed ? 'good' : 'bad'}`}>
        <Pierogi color={colorHex(me.color)} size={110} mood={fed ? 'wow' : 'dead'} class="pop-in" />
        <div class="phone-huge">{fed ? `Fed on try ${view.fed}!` : 'Baja’s still hungry'}</div>
        <p class="muted">She wanted</p>
        <div class="bj-answer">{plateEmoji(view.answer).join(' ')}</div>
        {view.pts > 0 && <div class="gain-big">+{view.pts}</div>}
        <div class="stat-row">
          <div class="stat">
            <small>Total</small>
            <b>{view.total.toLocaleString('en-US')}</b>
          </div>
        </div>
      </div>
    );
  }

  if (view.phase === 'intro') {
    return (
      <div class="pv bj-pad">
        {head}
        <div class="pv-center bj-wait">
          <div class="bj-big-emoji">🐶</div>
          <div class="phone-big">Baja is hungry!</div>
          <p>
            Not today: <b>{hint.emoji} {hint.label}</b>
          </p>
          {view.rows === 4 && <p class="bj-extra">Extra picky: she wants a trick first!</p>}
          <TimeBar endsAt={view.endsAt} offset={offset} />
        </div>
      </div>
    );
  }

  if (view.fed !== null) {
    return (
      <div class="pv bj-pad">
        {head}
        <div class="pv-center bj-wait">
          <div class="bj-big-emoji">😍</div>
          <div class="phone-big">You fed Baja!</div>
          <p class="muted">Watch the others try…</p>
        </div>
        <History view={view} />
      </div>
    );
  }

  if (view.phase === 'mind') {
    const row = view.changed[view.changed.length - 1];
    return (
      <div class="pv bj-pad">
        {head}
        <div class="pv-center bj-wait">
          <div class="bj-big-emoji">🙄</div>
          <div class="phone-big">Baja changed her mind!</div>
          <p>
            Something new for <b>{ROWS[row].title.toLowerCase()}</b>. Your old tries there don't count anymore.
          </p>
        </div>
        <History view={view} />
      </div>
    );
  }

  if (view.phase === 'taste' || sent) {
    return (
      <div class="pv bj-pad">
        {head}
        <div class="pv-center bj-wait">
          {sent ? <div class="bj-answer">{plateEmoji(sent).join(' ')}</div> : <div class="bj-big-emoji">👀</div>}
          <div class="phone-big">{view.phase === 'taste' ? 'Watch Baja taste it!' : 'Served! Waiting for the others…'}</div>
        </div>
        <History view={view} />
      </div>
    );
  }

  // Build a plate.
  const ready = plate.every((v) => v !== null);
  return (
    <div class="pv bj-pad">
      {head}
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="bj-rows">
        {ROWS.slice(0, view.rows).map((row, r) => (
          <div class="bj-row">
            <div class="bj-row-title">{row.title}</div>
            <div class={`bj-opts n${row.options.length}`}>
              {row.options.map((o, i) => (
                <button
                  class={`bj-opt ${plate[r] === i ? 'on' : ''} ${view.hint.row === r && view.hint.opt === i ? 'nope' : ''}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    vibrate(8);
                    setPlate((p) => p.map((v, k) => (k === r ? i : v)));
                  }}
                >
                  <span class="bj-opt-emoji">{o.emoji}</span>
                  <span class="bj-opt-label">{o.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        class="btn btn-big btn-yolk bj-feed"
        disabled={!ready}
        onClick={() => {
          if (!ready) return;
          vibrate(30);
          setSentLocal(true);
          send({ t: 'feed', round: view.round, tryN: view.tryN, plate: plate as number[] });
        }}
      >
        Feed Baja 🐾
      </button>
      <History view={view} />
    </div>
  );
}
