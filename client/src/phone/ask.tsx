/**
 * The generic phone screen for the word, drawing and voting games (Riposta, Szpieg, Zgodni, Fala,
 * Głuchy Telefon, Dzwonki): a title, a time bar and one kind of input – type, pick, slide, tap keys or
 * draw. See `AskView` in shared/protocol.ts. Every answer carries the view's `key`.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type AskInput, type AskView } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import { Doodle } from '../games/toty/art';
import { DoodlePad } from './doodlePad';
import { TimeBar } from './timebar';
import type { Props } from './views';

type Of<K extends AskInput['k']> = Extract<AskInput, { k: K }>;

export function AskPad({ view, me, send, offset }: Props<'ask'>) {
  const input = view.input;
  if (input.k === 'draw') {
    return (
      <DoodlePad
        note={view.note}
        prompt={input.prompt}
        endsAt={view.endsAt ?? Date.now() - offset + 90_000}
        offset={offset}
        done={input.sent}
        onSubmit={(strokes) => send({ t: 'ask', key: view.key, strokes })}
      />
    );
  }
  const center = input.k === 'none';
  return (
    <div class={`pv ask ${center ? 'pv-center' : ''} ask-${input.k} ${input.k === 'none' && input.good !== undefined ? `result-${input.good ? 'good' : 'bad'}` : ''}`} style={view.accent ? { '--ask-accent': view.accent } : undefined}>
      {(view.note || view.score !== undefined) && (
        <div class="ask-top">
          <span class="muted">{view.note}</span>
          {view.score !== undefined && (
            <span class="ask-score">
              <b>{view.score.toLocaleString('en-US')}</b> pts
            </span>
          )}
        </div>
      )}
      {input.k === 'none' && <Pierogi color={colorHex(me.color)} size={input.big ? 110 : 150} mood={input.mood ?? 'happy'} class={input.mood === 'wow' ? 'pop-in' : 'bob'} />}
      <div class="ask-title">{view.title}</div>
      {view.text && <p class="ask-text muted">{view.text}</p>}
      {view.pic && <Doodle strokes={view.pic} class="ask-pic" />}
      {view.endsAt !== undefined && <TimeBar endsAt={view.endsAt} offset={offset} />}
      {input.k === 'none' && input.big && <div class="gain-big pop-in">{input.big}</div>}
      {input.k === 'text' && <AskText view={view} input={input} send={send} offset={offset} />}
      {input.k === 'choice' && <AskChoice view={view} input={input} send={send} />}
      {input.k === 'slider' && <AskSlider view={view} input={input} send={send} />}
      {input.k === 'keys' && <AskKeys view={view} input={input} send={send} />}
    </div>
  );
}

interface InputProps<K extends AskInput['k']> {
  view: AskView;
  input: Of<K>;
  send: Props<'ask'>['send'];
}

function Waiting({ label, value }: { label: string; value: string }) {
  return (
    <div class="ask-sent">
      <div class="phone-small muted">{label}</div>
      <div class="bz-lie-big pop-in">{value}</div>
      <p class="muted">Waiting for the others…</p>
    </div>
  );
}

function AskText({ view, input, send, offset }: InputProps<'text'> & { offset: number }) {
  const [text, setText] = useState('');
  /** What was last sent: the button stays off until it's edited (in case the host turned it down). */
  const [sent, setSent] = useState<string | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  // Hand in whatever is typed just before time runs out.
  useEffect(() => {
    if (input.sent !== null || view.endsAt === undefined) return;
    const t = setTimeout(() => textRef.current.trim() && send({ t: 'ask', key: view.key, text: textRef.current }), Math.max(0, view.endsAt + offset - Date.now() - 800));
    return () => clearTimeout(t);
  }, [view.endsAt, view.key, offset, input.sent]);

  if (input.sent !== null) return <Waiting label="You said" value={input.sent} />;
  const submit = (e?: Event) => {
    e?.preventDefault();
    if (!text.trim() || text === sent) return;
    setSent(text);
    send({ t: 'ask', key: view.key, text });
  };
  return (
    <form class="ask-form" onSubmit={submit}>
      <input
        class="input bz-input"
        value={text}
        maxLength={input.max}
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="send"
        placeholder={input.placeholder}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
      />
      {input.error && <div class="form-error">{input.error}</div>}
      <button type="submit" class="btn btn-big btn-yolk" disabled={!text.trim() || text === sent}>
        {input.button ?? 'Send'}
      </button>
      {input.auto && (
        <button type="button" class="btn btn-ghost" onClick={() => send({ t: 'ask', key: view.key, auto: true })}>
          {input.auto}
        </button>
      )}
    </form>
  );
}

function AskChoice({ view, input, send }: InputProps<'choice'>) {
  const [local, setLocal] = useState<number | null>(null);
  useEffect(() => setLocal(null), [view.key]);
  const picked = input.picked ?? local;
  if (picked !== null && input.options[picked]) return <Waiting label="You picked" value={input.options[picked].label} />;
  return (
    <div class={`bz-choices ask-choices ${input.grid ? 'grid' : ''}`}>
      {input.options.map((o, i) => (
        <button
          class={`bz-choice ${o.off ? 'mine' : ''}`}
          disabled={o.off}
          style={o.color && !o.off ? { background: o.color } : undefined}
          onClick={() => {
            setLocal(i);
            send({ t: 'ask', key: view.key, i });
          }}
        >
          {o.label}
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

function AskSlider({ view, input, send }: InputProps<'slider'>) {
  const mid = input.start ?? input.min + Math.round((input.max - input.min) / 2 / input.step) * input.step;
  const [value, setValue] = useState(mid);
  useEffect(() => setValue(mid), [view.key]);
  if (input.sent !== null) return <Waiting label="You locked in" value={`${input.sent}${input.unit ?? ''}`} />;
  const share = (value - input.min) / Math.max(1e-9, input.max - input.min);
  return (
    <div class="ask-slider">
      <div class="ask-slider-value">
        {value}
        {input.unit ?? ''}
      </div>
      <input
        type="range"
        class="ask-range"
        min={input.min}
        max={input.max}
        step={input.step}
        value={value}
        style={{ '--fill': `${(share * 100).toFixed(1)}%` }}
        onInput={(e) => setValue(Number((e.target as HTMLInputElement).value))}
      />
      <div class="ask-slider-ends">
        <span>{input.left}</span>
        <span>{input.right}</span>
      </div>
      <button class="btn btn-big btn-yolk" onClick={() => send({ t: 'ask', key: view.key, n: value })}>
        {input.button ?? 'Lock in'}
      </button>
    </div>
  );
}

function AskKeys({ view, input, send }: InputProps<'keys'>) {
  const [down, setDown] = useState<number | null>(null);
  return (
    <div class={`ask-keys n${input.keys.length}`}>
      {input.keys.map((k, i) => (
        <button
          class={`ask-key ${input.off ? 'off' : ''} ${down === i || input.lit === i ? 'down' : ''}`}
          style={{ '--bc': k.color }}
          disabled={input.off}
          onPointerDown={(e) => {
            e.preventDefault();
            if (input.off) return;
            setDown(i);
            navigator.vibrate?.(15);
            send({ t: 'ask', key: view.key, i });
          }}
          onPointerUp={() => setDown(null)}
          onPointerCancel={() => setDown(null)}
          onPointerLeave={() => setDown(null)}
        >
          <span>{k.label}</span>
        </button>
      ))}
    </div>
  );
}
