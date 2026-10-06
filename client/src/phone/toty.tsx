/** To Ty! on the phone: selfie camera, voting, the doodle canvas and results. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_PHOTO_CHARS, PHOTO_SIZE, colorHex } from '../../../shared/protocol';
import { Face } from '../games/toty/art';
import { Pierogi } from '../lib/art';
import { DoodlePad } from './doodlePad';
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

export function TyDraw({ view, send, offset }: Props<'tyDraw'>) {
  const photo = usePhotos(view.ph, send);
  return (
    <DoodlePad
      prompt={view.prompt}
      endsAt={view.endsAt}
      offset={offset}
      done={view.done}
      photo={photo(view.subject.id)}
      color={view.subject.color}
      onSubmit={(strokes) => send({ t: 'doodle', strokes })}
    />
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
