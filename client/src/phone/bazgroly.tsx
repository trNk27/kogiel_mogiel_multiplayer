/** Bazgroły on the phone: draw your prompt, write a fake title, spot the real one. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_TITLE_LENGTH, colorHex } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import { DoodlePad } from './doodlePad';
import { TimeBar } from './timebar';
import type { Props } from './views';

export function BzDraw({ view, send, offset }: Props<'bzDraw'>) {
  return (
    <DoodlePad
      note={`Round ${view.round} / ${view.rounds} · your secret prompt (shh!)`}
      prompt={view.prompt}
      endsAt={view.endsAt}
      offset={offset}
      done={view.done}
      onSubmit={(strokes) => send({ t: 'doodle', strokes })}
    />
  );
}

export function BzLie({ view, me, send, offset }: Props<'bzLie'>) {
  const [text, setText] = useState('');
  /** What was last sent: the button stays off until it's edited (the host turned it down). */
  const [sent, setSent] = useState<string | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  // Hand in whatever is typed just before time runs out.
  useEffect(() => {
    if (view.yours || view.lie !== null) return;
    const t = setTimeout(() => textRef.current.trim() && send({ t: 'lie', text: textRef.current }), Math.max(0, view.endsAt + offset - Date.now() - 800));
    return () => clearTimeout(t);
  }, [view.endsAt, offset, view.yours, view.lie]);

  if (view.yours) {
    return (
      <div class="pv pv-center">
        <Pierogi color={colorHex(me.color)} size={150} mood="happy" class="bob" />
        <div class="phone-big">That’s your drawing!</div>
        <p class="muted">The others are making up titles for it. Keep a straight face…</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  if (view.lie !== null) {
    return (
      <div class="pv pv-center">
        <div class="phone-small muted">Your lie</div>
        <div class="bz-lie-big pop-in">{view.lie}</div>
        <p class="muted">Waiting for the others…</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  const submit = (e?: Event) => {
    e?.preventDefault();
    if (!text.trim() || text === sent) return;
    setSent(text);
    send({ t: 'lie', text });
  };
  return (
    <form class="pv bz-lie" onSubmit={submit}>
      <div class="ty-q">
        <small class="muted">
          Drawing {view.n} / {view.of} · by {view.artist}
        </small>
        <div>Look at the TV. What could it be?</div>
      </div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <p class="muted">Write a fake title that sounds real. Every player who falls for it earns you points!</p>
      <input
        class="input bz-input"
        value={text}
        maxLength={MAX_TITLE_LENGTH}
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="send"
        placeholder="e.g. A sad cowboy"
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
      />
      {view.error && <div class="form-error">{view.error}</div>}
      <button type="submit" class="btn btn-big btn-yolk" disabled={!text.trim() || text === sent}>
        Fool them!
      </button>
      <button type="button" class="btn btn-ghost" onClick={() => send({ t: 'lie', text: '', auto: true })}>
        🎲 Lie for me
      </button>
    </form>
  );
}

export function BzGuess({ view, send, offset }: Props<'bzGuess'>) {
  const [local, setLocal] = useState<number | null>(null);
  const picked = view.picked ?? local;
  if (view.yours) {
    return (
      <div class="pv pv-center">
        <div class="phone-big">Your drawing!</div>
        <p class="muted">Sit back and see if they can find your prompt. You score for everyone who does.</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  if (picked !== null) {
    return (
      <div class="pv pv-center">
        <div class="phone-small muted">You picked</div>
        <div class="bz-lie-big pop-in">{view.options[picked]}</div>
        <p class="muted">Waiting for the others…</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  return (
    <div class="pv bz-guess">
      <div class="section-label">Which is the real title of {view.artist}’s drawing?</div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="bz-choices">
        {view.options.map((o, i) => {
          const own = view.own.includes(i);
          return (
            <button
              class={`bz-choice ${own ? 'mine' : ''}`}
              disabled={own}
              onClick={() => {
                setLocal(i);
                send({ t: 'pick', i });
              }}
            >
              {o}
              {own && <small>your lie</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BzResult({ view, me }: Props<'bzResult'>) {
  const good = view.points > 0;
  let title: string;
  let line: string;
  if (view.yours) {
    title = view.found ? 'They got it!' : 'Nobody got it!';
    line = view.found ? `${view.found} player${view.found === 1 ? '' : 's'} found “${view.truth}”.` : `Nobody saw “${view.truth}” in your drawing.`;
  } else if (view.correct) {
    title = 'You found it!';
    line = `It really was “${view.truth}”.`;
  } else if (view.fooledBy !== null) {
    title = 'Fooled!';
    line = view.fooledBy ? `You fell for ${view.fooledBy}’s lie. It was “${view.truth}”.` : `That was our decoy. It was “${view.truth}”.`;
  } else {
    title = 'No pick?';
    line = `It was “${view.truth}”.`;
  }
  return (
    <div class={`pv pv-center result-${good ? 'good' : 'bad'}`}>
      <Pierogi color={colorHex(me.color)} size={130} mood={good ? 'wow' : 'happy'} class="pop-in" />
      <div class="phone-huge ty-result-title">{title}</div>
      {good && <div class="gain-big">+{view.points.toLocaleString('en-US')}</div>}
      <p class="muted">{line}</p>
      {view.fooled > 0 && (
        <div class="pill">
          Your lie fooled {view.fooled} player{view.fooled === 1 ? '' : 's'}
        </div>
      )}
      <div class="stat-row">
        <div class="stat">
          <small>Total</small>
          <b>{view.total.toLocaleString('en-US')}</b>
        </div>
      </div>
    </div>
  );
}
