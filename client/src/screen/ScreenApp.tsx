import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizeCode } from '../../../shared/protocol';
import { FolkBorder, Logo } from '../lib/art';
import { Receiver } from './receiver';

/**
 * /screen: a second screen. A TV or laptop in another place that shows exactly what the host TV
 * shows (streamed over WebRTC), so a second group can play in the same room with their phones.
 */

const params = new URLSearchParams(location.search);
const KEY = 'cp.screen';

interface Saved {
  id: string;
  code?: string;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

function load(): Saved {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (s && typeof s.id === 'string' && s.id.length >= 8) return s;
  } catch {
    /* ignore */
  }
  return { id: randomId() };
}

function save(s: Saved) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: a reload just asks for the code again */
  }
}

export function ScreenApp() {
  const saved = useRef(load());
  const [code, setCode] = useState(() => normalizeCode(params.get('code') ?? saved.current.code ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [receiver, setReceiver] = useState<Receiver | null>(null);
  const [, setTick] = useState(0);

  const connect = (c: string) => {
    if (c.length !== 4) return;
    receiver?.close();
    setError(null);
    saved.current = { ...saved.current, code: c };
    save(saved.current);
    const r = new Receiver(
      c,
      saved.current.id,
      () => setTick((n) => n + 1),
      (reason) => {
        r.close();
        saved.current = { id: saved.current.id };
        save(saved.current);
        setReceiver(null);
        setError(reason);
      },
    );
    setReceiver(r);
  };

  // A reloaded second screen goes straight back to its room.
  useEffect(() => {
    if (saved.current.code && code === saved.current.code) connect(code);
  }, []);

  if (!receiver) {
    return (
      <div class="screen-enter">
        <FolkBorder count={9} size={52} />
        <Logo size={1.3} />
        <form
          class="screen-form card-paper"
          onSubmit={(e) => {
            e.preventDefault();
            connect(code);
          }}
        >
          <h1>Second screen</h1>
          <p>Show another room’s party on this screen, so you can play together from far away.</p>
          <label class="eyebrow" for="screen-code">
            Room code from the host TV
          </label>
          <input
            id="screen-code"
            class="screen-code-input"
            value={code}
            maxLength={4}
            autoComplete="off"
            autoCapitalize="characters"
            spellcheck={false}
            autofocus
            onInput={(e) => setCode(normalizeCode((e.target as HTMLInputElement).value))}
          />
          <button class="btn btn-big btn-yolk" type="submit" disabled={code.length !== 4}>
            Show the party
          </button>
          {error && <p class="screen-error">{error}</p>}
          <p class="screen-note">
            On the host TV, press <b>📡</b> and <b>Share this screen</b>. Players here join on their phones at{' '}
            <b>{location.host}/join</b> with the same code.
          </p>
        </form>
        <FolkBorder count={9} size={52} />
      </div>
    );
  }

  const leave = () => {
    receiver.close();
    saved.current = { id: saved.current.id };
    save(saved.current);
    setReceiver(null);
  };
  return <Mirror receiver={receiver} onLeave={leave} />;
}

function Mirror({ receiver: r, onLeave }: { receiver: Receiver; onLeave: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [idle, setIdle] = useState(false);
  const live = r.state === 'live' && r.stream;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (v.srcObject !== r.stream) v.srcObject = r.stream;
    if (!r.stream) return;
    v.muted = false;
    v.play().then(
      () => setNeedsTap(false),
      () => {
        // No click on this page yet (a reload): browsers only autoplay muted video.
        v.muted = true;
        void v.play().catch(() => {});
        setNeedsTap(true);
      },
    );
  }, [r.stream]);

  // Hide the cursor and the buttons when nobody's touching the mouse.
  useEffect(() => {
    let t: number | undefined;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  const unmute = () => {
    const v = video.current;
    if (!v) return;
    v.muted = false;
    void v.play().then(() => setNeedsTap(false), () => {});
  };

  const message =
    r.state === 'connecting'
      ? 'Connecting to the room…'
      : !r.hostOnline
        ? 'The host TV is offline. Waiting for it to come back…'
        : r.state === 'waiting'
          ? 'Waiting for the host TV to share its screen'
          : r.state === 'starting'
            ? 'Starting the picture…'
            : r.state === 'failed'
              ? 'The picture dropped. Reconnecting…'
              : null;

  return (
    <div class={`mirror ${idle && live ? 'idle' : ''}`} onClick={needsTap ? unmute : undefined}>
      <video ref={video} class={`mirror-video ${live ? 'on' : ''}`} autoplay playsInline />
      {!live && (
        <div class="mirror-wait">
          <Logo size={1.1} />
          <div class="mirror-wait-card card-paper">
            <div class="eyebrow">Room</div>
            <div class="mirror-wait-code">{r.code}</div>
            <p>{message}</p>
            {r.state === 'waiting' && r.hostOnline && (
              <p class="screen-note">
                On the host TV: press <b>📡</b> → <b>Share this screen</b>
              </p>
            )}
            {r.state === 'failed' && (
              <p class="screen-note">If it never connects, one of the two networks blocks direct video: the host can add a TURN server (see the README).</p>
            )}
          </div>
        </div>
      )}
      <div class="mirror-bar">
        {needsTap && live && (
          <button class="btn btn-yolk" onClick={unmute}>
            🔊 Sound on
          </button>
        )}
        <span class="pill">
          {location.host}/join · <b>{r.code}</b>
        </span>
        {document.fullscreenEnabled && (
          <button
            class="btn btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen().catch(() => {});
            }}
          >
            ⛶
          </button>
        )}
        <button
          class="btn btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            onLeave();
          }}
        >
          Leave
        </button>
      </div>
    </div>
  );
}
