/** To Ty! on the phone: selfie camera, voting, the doodle canvas and results. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { DOODLE_COLORS, DOODLE_SPACE, DOODLE_WIDTHS, MAX_DOODLE_POINTS, MAX_PHOTO_CHARS, PHOTO_SIZE, colorHex, type Stroke } from '../../../shared/protocol';
import { Doodle, Face } from '../games/toty/art';
import { Pierogi } from '../lib/art';
import { putPhoto, usePhotos } from './photos';
import { TimeBar } from './timebar';
import type { Props } from './views';

// ---------------------------------------------------------------------------
// Selfie
// ---------------------------------------------------------------------------

/** Centre-crop to a square and shrink until the JPEG fits in one relay message. */
function encodePhoto(src: CanvasImageSource, w: number, h: number, mirror: boolean): string | null {
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !side) return null;
  for (const size of [PHOTO_SIZE, 256, 200, 160]) {
    canvas.width = canvas.height = size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (mirror) ctx.setTransform(-1, 0, 0, 1, size, 0);
    ctx.drawImage(src, sx, sy, side, side, 0, 0, size, size);
    for (const quality of [0.75, 0.6, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.startsWith('data:image/jpeg') && data.length <= MAX_PHOTO_CHARS) return data;
    }
  }
  return null;
}

function loadFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(encodePhoto(img, img.naturalWidth, img.naturalHeight, false));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function Camera({ onShot, onFail, onCancel }: { onShot: (data: string) => void; onFail: (msg: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setReady(true);
      } catch (e) {
        if (!stopped) onFail((e as Error).name === 'NotAllowedError' ? 'Camera access was blocked. Upload a photo instead?' : 'No camera here. Upload a photo instead?');
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const data = encodePhoto(v, v.videoWidth, v.videoHeight, true);
    if (data) onShot(data);
    else onFail('That photo didn’t work. Try again?');
  };
  return (
    <div class="pv ty-cam">
      <div class="ty-cam-frame">
        <video ref={video} playsInline muted autoPlay />
        {!ready && <div class="ty-cam-wait muted">Opening the camera…</div>}
      </div>
      <button class="ty-shutter" disabled={!ready} onClick={snap} aria-label="Take photo" />
      <button class="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export function TySelfie({ view, me, send, offset }: Props<'tySelfie'>) {
  const [mode, setMode] = useState<'menu' | 'camera' | 'preview'>('menu');
  const [shot, setShot] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [retake, setRetake] = useState(false);
  const [error, setError] = useState('');
  // Our own upload, once the TV confirms it, goes straight into the cache (no round trip).
  useEffect(() => {
    if (sent && view.done && view.rev !== null) putPhoto(view.id, view.rev, sent);
  }, [sent, view.done, view.rev]);
  const photo = usePhotos(view.rev !== null ? { [view.id]: view.rev } : {}, send);
  const current = view.rev !== null ? photo(view.id) ?? sent : null;

  const upload = (data: string) => {
    setSent(data);
    setShot(null);
    setMode('menu');
    setRetake(false);
    send({ t: 'selfie', data });
  };
  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const data = await loadFile(file);
    if (!data) return setError('Couldn’t read that picture. Try another one?');
    setError('');
    setShot(data);
    setMode('preview');
  };
  const fileButton = (label: string, cls: string) => (
    <label class={`btn btn-big ${cls} ty-file`}>
      {label}
      <input type="file" accept="image/*" capture="user" onChange={onFile} />
    </label>
  );

  if (mode === 'camera')
    return (
      <Camera
        onShot={(data) => {
          setShot(data);
          setMode('preview');
        }}
        onFail={(msg) => {
          setError(msg);
          setMode('menu');
        }}
        onCancel={() => setMode('menu')}
      />
    );

  if (mode === 'preview' && shot)
    return (
      <div class="pv pv-center">
        <Face color={me.color} photo={shot} size={250} class="pop-in" />
        <div class="phone-big">Looking good?</div>
        <button class="btn btn-big btn-yolk" onClick={() => upload(shot)}>
          Use this photo
        </button>
        <button class="btn btn-ghost" onClick={() => setMode('menu')}>
          Try again
        </button>
      </div>
    );

  if (view.done && !retake)
    return (
      <div class="pv pv-center">
        <Face color={me.color} photo={current} size={230} mood="wow" class="pop-in" />
        <div class="phone-big">{current ? 'That’s you!' : 'Pierogi it is!'}</div>
        <p class="muted">Waiting for the others…</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
        <button class="btn btn-ghost" onClick={() => setRetake(true)}>
          Change my photo
        </button>
      </div>
    );

  return (
    <div class="pv pv-center ty-selfie-menu">
      <Face color={me.color} photo={current} size={180} />
      <div class="phone-big">Selfie time!</div>
      <p class="muted">Pull a face – everyone will see it on the TV.</p>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      {current && (
        <button class="btn btn-big btn-yolk" onClick={() => (view.done ? setRetake(false) : send({ t: 'selfie', data: 'keep' }))}>
          Keep this photo
        </button>
      )}
      <button
        class={`btn btn-big ${current ? 'btn-ghost' : 'btn-yolk'}`}
        onClick={() => {
          setError('');
          setMode('camera');
        }}
      >
        📷 Take a selfie
      </button>
      {fileButton('Upload a photo', 'btn-ghost')}
      {error && <div class="form-error">{error}</div>}
      <button
        class="btn btn-ghost small"
        onClick={() => {
          setSent(null);
          setRetake(false);
          send({ t: 'selfie', data: '' });
        }}
      >
        Skip – I’ll be a pierogi
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Who's most likely to…
// ---------------------------------------------------------------------------

export function TyVote({ view, send, offset }: Props<'tyVote'>) {
  const photo = usePhotos(view.ph, send);
  const [local, setLocal] = useState<string | null>(null);
  const picked = view.picked ?? local;
  const pick = view.players.find((p) => p.id === picked);
  if (pick) {
    return (
      <div class="pv pv-center">
        <div class="phone-small muted">Your vote</div>
        <Face color={pick.color} photo={photo(pick.id)} size={190} class="pop-in" />
        <div class="phone-big">{pick.name}</div>
        <p class="muted">Let’s see if the room agrees…</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  const size = view.players.length > 6 ? 96 : 118;
  return (
    <div class="pv ty-vote">
      <div class="ty-q">
        <small class="muted">
          Question {view.q} / {view.total}
          {view.double && <b class="ty-double"> · double points</b>}
        </small>
        <div>{view.question}</div>
      </div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="ty-faces">
        {view.players.map((p) => (
          <button
            class="ty-face-btn"
            style={{ '--pc': colorHex(p.color) }}
            onClick={() => {
              setLocal(p.id);
              send({ t: 'vote', id: p.id });
            }}
          >
            <Face color={p.color} photo={photo(p.id)} size={size} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Doodle
// ---------------------------------------------------------------------------

const CANVAS_PX = 640;
const MIN_STEP = 7;

function paint(ctx: CanvasRenderingContext2D, s: Stroke, from = 2) {
  const k = CANVAS_PX / DOODLE_SPACE;
  ctx.strokeStyle = ctx.fillStyle = DOODLE_COLORS[s[0]];
  ctx.lineWidth = DOODLE_WIDTHS[s[1]] * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.length === 4) {
    ctx.beginPath();
    ctx.arc(s[2] * k, s[3] * k, (DOODLE_WIDTHS[s[1]] * k) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  const start = Math.max(2, from - 2);
  ctx.moveTo(s[start] * k, s[start + 1] * k);
  for (let i = start + 2; i < s.length; i += 2) ctx.lineTo(s[i] * k, s[i + 1] * k);
  ctx.stroke();
}

export function TyDraw({ view, send, offset }: Props<'tyDraw'>) {
  const photo = usePhotos(view.ph, send);
  const bg = photo(view.subject.id);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const points = useRef(0);
  const sentRef = useRef(false);
  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(1);
  const [count, setCount] = useState(0);
  const [full, setFull] = useState(false);
  const [sent, setSent] = useState(false);
  const pen = useRef({ color, width });
  pen.current = { color, width };

  const submit = () => {
    if (sentRef.current) return;
    sentRef.current = true;
    setSent(true);
    send({ t: 'doodle', strokes: strokes.current });
  };

  // Hand in whatever is there just before time runs out.
  useEffect(() => {
    const t = setTimeout(submit, Math.max(0, view.endsAt + offset - Date.now() - 800));
    return () => clearTimeout(t);
  }, [view.endsAt, offset]);

  const redraw = () => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    for (const s of strokes.current) paint(ctx, s);
    points.current = strokes.current.reduce((n, s) => n + (s.length - 2) / 2, 0);
    setFull(points.current >= MAX_DOODLE_POINTS);
    setCount(strokes.current.length);
  };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d')!;
    let active: Stroke | null = null;
    const at = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = Math.round(((e.clientX - r.left) / r.width) * DOODLE_SPACE);
      const y = Math.round(((e.clientY - r.top) / r.height) * DOODLE_SPACE);
      return [Math.max(0, Math.min(DOODLE_SPACE, x)), Math.max(0, Math.min(DOODLE_SPACE, y))];
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      if (points.current >= MAX_DOODLE_POINTS) return;
      el.setPointerCapture?.(e.pointerId);
      const [x, y] = at(e);
      active = [pen.current.color, pen.current.width, x, y];
      strokes.current.push(active);
      points.current++;
      paint(ctx, active);
      setCount(strokes.current.length);
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      e.preventDefault();
      const [x, y] = at(e);
      const lx = active[active.length - 2];
      const ly = active[active.length - 1];
      if (Math.hypot(x - lx, y - ly) < MIN_STEP) return;
      if (points.current >= MAX_DOODLE_POINTS) {
        setFull(true);
        return;
      }
      active.push(x, y);
      points.current++;
      paint(ctx, active, active.length - 2);
    };
    const up = () => {
      active = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [sent]);

  if (sent || view.done) {
    return (
      <div class="pv pv-center">
        <div class="ty-sent">
          <Doodle strokes={strokes.current} photo={bg} color={view.subject.color} />
        </div>
        <div class="phone-big">{strokes.current.length || view.done ? 'Masterpiece sent!' : 'Time’s up!'}</div>
        <p class="muted">Look at the TV.</p>
      </div>
    );
  }

  return (
    <div class="pv ty-draw-pad">
      <div class="ty-q">
        <div>{view.prompt}</div>
      </div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="ty-canvas-wrap">
        <Doodle strokes={[]} photo={bg} color={view.subject.color} class="ty-canvas-bg" />
        <canvas ref={canvas} width={CANVAS_PX} height={CANVAS_PX} />
        {full && <div class="ty-full">Canvas full!</div>}
      </div>
      <div class="ty-palette">
        {DOODLE_COLORS.map((c, i) => (
          <button class={`ty-swatch ${i === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(i)} aria-label={`Colour ${i + 1}`} />
        ))}
      </div>
      <div class="ty-tools">
        {DOODLE_WIDTHS.map((w, i) => (
          <button class={`ty-tool ${i === width ? 'on' : ''}`} onClick={() => setWidth(i)} aria-label={`Brush ${i + 1}`}>
            <i style={{ width: 6 + w / 2.2, height: 6 + w / 2.2, background: DOODLE_COLORS[color] }} />
          </button>
        ))}
        <button
          class="ty-tool"
          disabled={!count}
          onClick={() => {
            strokes.current.pop();
            redraw();
          }}
        >
          ↶
        </button>
        <button
          class="ty-tool"
          disabled={!count}
          onClick={() => {
            strokes.current = [];
            redraw();
          }}
        >
          🗑
        </button>
        <button class="btn btn-yolk ty-done" disabled={!count} onClick={submit}>
          Done
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pick the best doodle
// ---------------------------------------------------------------------------

export function TyPick({ view, send, offset }: Props<'tyPick'>) {
  const [local, setLocal] = useState<number | null>(null);
  const picked = view.picked ?? local;
  if (picked !== null) {
    return (
      <div class="pv pv-center">
        <div class="phone-small muted">Your favourite</div>
        <div class="ty-letter-big">{view.letters[picked]}</div>
        <p class="muted">Waiting for the others…</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  return (
    <div class="pv ty-pick">
      <div class="section-label">Which doodle is the best? Look at the TV!</div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="ty-letters">
        {view.letters.map((l, i) => (
          <button
            class={`ty-letter-btn ${i === view.mine ? 'mine' : ''}`}
            disabled={i === view.mine}
            onClick={() => {
              setLocal(i);
              send({ t: 'pick', i });
            }}
          >
            {l}
            {i === view.mine && <small>yours</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function TyResult({ view, me }: Props<'tyResult'>) {
  const good = view.points > 0;
  let title: string;
  let line: string;
  if (view.kind === 'vote') {
    const winners = view.winners ?? [];
    const meWon = winners.includes(me.name);
    title = meWon ? 'To ty! That’s you!' : winners.length ? `To ty, ${winners.join(' & ')}!` : 'Nobody agreed!';
    line = good ? 'You read the room!' : winners.length ? 'The room saw it differently.' : 'Everyone picked someone different.';
  } else {
    title = good ? 'Crowd favourite!' : 'Nice doodle!';
    line = view.votes ? `Your doodle got ${view.votes} vote${view.votes === 1 ? '' : 's'}.` : 'No votes for your doodle this time.';
  }
  return (
    <div class={`pv pv-center result-${good ? 'good' : 'bad'}`}>
      <Pierogi color={colorHex(me.color)} size={140} mood={good ? 'wow' : 'happy'} class="pop-in" />
      <div class="phone-huge ty-result-title">{title}</div>
      {good && <div class="gain-big">+{view.points}</div>}
      <p class="muted">{line}</p>
      {view.kind === 'vote' && view.votes > 0 && (
        <div class="pill">
          {view.votes} vote{view.votes === 1 ? '' : 's'} for you
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
