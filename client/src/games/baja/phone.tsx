/** Wybredna Baja on the phone: your secret clues, your part of the team plate, treats, and the cat vote. */
import { colorHex } from '../../../../shared/protocol';
import { Pierogi } from '../../lib/art';
import { TimeBar } from '../../phone/timebar';
import type { Props } from '../../phone/views';
import { ROWS, plateEmoji } from './logic';
import { Cat } from './art';
import './baja.css';

function vibrate(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

type View = Props<'baja'>['view'];

function Head({ view }: { view: View }) {
  return (
    <div class="quiz-pad-top">
      <span>
        Craving {view.round}/{view.rounds}
        {(view.phase === 'build' || view.phase === 'taste') && ` · Try ${view.tryN}/${view.tries}`}
      </span>
      <span class="muted">{view.total.toLocaleString('en-US')}</span>
    </div>
  );
}

function Clues({ view }: { view: View }) {
  return (
    <div class="bt-clues">
      <div class="bt-clues-title">🔒 Your secret clues</div>
      {view.clues.length ? view.clues.map((c) => <div class={`bt-clue ${c.includes('she wants') ? 'sure' : ''}`}>{c}</div>) : <div class="bt-clue muted">No clues. Ask the others!</div>}
    </div>
  );
}

function TeamPlate({ view }: { view: View }) {
  return (
    <div class="bt-team">
      {view.owners.map((o, i) => (
        <div class={`bt-team-slot ${view.mine.includes(i) ? 'mine' : ''}`} style={{ '--pc': colorHex(o.color) }}>
          <b>{plateEmoji(view.plate)[i]}</b>
          <small>{ROWS[i].title}</small>
          <small class="bt-team-who">{view.mine.includes(i) ? 'you' : o.name}</small>
        </div>
      ))}
    </div>
  );
}

export function BajaPad({ view, me, send, offset }: Props<'baja'>) {
  if (view.result) {
    const r = view.result;
    return (
      <div class={`pv pv-center ${r.good ? 'result-good' : 'result-bad'}`}>
        <Pierogi color={colorHex(me.color)} size={110} mood={r.good ? 'wow' : 'dead'} class="pop-in" />
        <div class="phone-huge">{r.big}</div>
        <p class="muted">{r.text}</p>
        {view.answer && <div class="bj-answer">{plateEmoji(view.answer).join(' ')}</div>}
        {r.pts > 0 && <div class="gain-big">+{r.pts}</div>}
      </div>
    );
  }

  if (view.phase === 'intro') {
    return (
      <div class="pv bj-pad">
        <Head view={view} />
        {view.cat ? (
          <div class="bt-catcard pop-in">
            <Cat size={130} />
            <div class="phone-big">You’re the neighbour’s cat!</div>
            <p>Keep Baja hungry. Lie about your clues, pick wrong. Just don’t get caught.</p>
          </div>
        ) : (
          <div class="pv-center bj-wait">
            <div class="bj-big-emoji">🐶</div>
            <div class="phone-big">{view.mine.length ? `You pick: ${view.mine.map((i) => ROWS[i].title).join(' + ')}` : 'You’re the clue keeper'}</div>
            {view.catRound && <p class="bj-extra">🐈 One of you is the neighbour’s cat…</p>}
          </div>
        )}
        <Clues view={view} />
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }

  if (view.phase === 'vote') {
    return (
      <div class="pv bj-pad">
        <Head view={view} />
        <div class="bt-vote-title">Who is the cat? 🐈</div>
        <TimeBar endsAt={view.endsAt} offset={offset} />
        <div class="bt-vote">
          {view.players.map((p) => (
            <button
              class={`bt-vote-btn ${view.voted === p.id ? 'on' : ''}`}
              style={{ '--pc': colorHex(p.color) }}
              onClick={() => (vibrate(20), send({ t: 'baja', key: view.key, vote: p.id }))}
            >
              <Pierogi color={colorHex(p.color)} size={44} mood={view.voted === p.id ? 'wow' : 'happy'} />
              {p.name}
            </button>
          ))}
        </div>
        {view.cat && <p class="muted">Psst, you’re the cat. Vote for someone else 😼</p>}
      </div>
    );
  }

  if (view.phase === 'taste' || view.phase === 'end') {
    return (
      <div class="pv bj-pad">
        <Head view={view} />
        <div class="pv-center bj-wait">
          <div class="bj-answer">{plateEmoji(view.plate).join(' ')}</div>
          <div class="phone-big">Watch Baja taste it!</div>
        </div>
        <History view={view} />
      </div>
    );
  }

  // Build the plate together.
  const missing = view.mine.some((i) => view.plate[i] === null);
  return (
    <div class="pv bj-pad">
      <Head view={view} />
      <TimeBar endsAt={view.endsAt} offset={offset} />
      {view.cat && <div class="bt-catbadge">🐈 You’re the cat. Shh.</div>}
      <TeamPlate view={view} />
      {view.mine.map((part) => (
        <div class="bj-row">
          <div class="bj-row-title">Your pick: {ROWS[part].title}</div>
          <div class={`bj-opts n${ROWS[part].options.length}`}>
            {ROWS[part].options.map((o, i) => (
              <button
                class={`bj-opt ${view.plate[part] === i ? 'on' : ''}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  vibrate(8);
                  send({ t: 'baja', key: view.key, part, opt: i });
                }}
              >
                <span class="bj-opt-emoji">{o.emoji}</span>
                <span class="bj-opt-label">{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <Clues view={view} />
      <div class="bt-actions">
        <button class="btn btn-big bt-treatbtn" disabled={view.treats <= 0} onClick={() => (vibrate(30), send({ t: 'baja', key: view.key, treat: true }))}>
          🦴 Treat for a sure clue ({view.treats})
        </button>
        {view.mine.length > 0 && (
          <button
            class={`btn btn-big ${view.ready ? '' : 'btn-yolk'}`}
            disabled={missing}
            onClick={() => (vibrate(20), send({ t: 'baja', key: view.key, ready: !view.ready }))}
          >
            {view.ready ? 'Ready ✓ (tap to change)' : missing ? 'Pick your part first' : 'Ready to feed 🐾'}
          </button>
        )}
      </div>
      <History view={view} />
    </div>
  );
}

function History({ view }: { view: View }) {
  if (!view.history.length) return null;
  return (
    <div class="bj-hist">
      {view.history.map((h, k) => (
        <div class="bj-hist-row">
          <span class="bj-hist-n">{k + 1}</span>
          <span class="bj-hist-plate">{plateEmoji(h.plate).join(' ')}</span>
          <span class="bj-hist-paws">
            {Array.from({ length: view.parts }, (_, i) => (
              <i class={i < h.hits ? 'on' : ''}>🐾</i>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
