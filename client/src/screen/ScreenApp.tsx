import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizeCode } from '../../../shared/protocol';
import { FolkBorder, Logo } from '../lib/art';
import { Receiver } from './receiver';
import { sound } from '../lib/sound';
import { HostApp } from '../host/HostApp';
import type { ScreenStats } from './receiver';

/**
 * /screen: a second screen. A TV or laptop in another place that shows exactly what the host TV
 * shows, drawn here from the host's game state (see replica.ts), so a second group can play in
 * the same room with their phones.
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
    // A click: the browser lets sound start now.
    sound.unlock();
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
    // For automated tests: /screen?debug exposes the connection (and through it the copy of the room).
    if (params.has('debug')) (window as unknown as { receiver: Receiver }).receiver = r;
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
            Players here join on their phones at{' '}
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
  const [needsTap, setNeedsTap] = useState(() => sound.context?.state !== 'running');
  const [muted, setMuted] = useState(false);
  const [idle, setIdle] = useState(false);
  const [showStats, setShowStats] = useState(params.has('stats'));
  const root = r.root;
  const live = r.state === 'live' && root !== null;

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
    sound.unlock();
    setNeedsTap(false);
  };

  const message =
    r.state === 'connecting'
      ? 'Connecting to the room…'
      : !r.hostOnline
        ? 'The host TV is offline. Waiting for it to come back…'
        : 'Waiting for the host TV…';

  return (
    <div class={`mirror ${idle && live ? 'idle' : ''}`} onClick={needsTap ? unmute : undefined}>
      {live ? (
        <HostApp room={root} isReplica key={r.replica.epochKey} />
      ) : (
        <div class="mirror-wait">
          <Logo size={1.1} />
          <div class="mirror-wait-card card-paper">
            <div class="eyebrow">Room</div>
            <div class="mirror-wait-code">{r.code}</div>
            <p>{message}</p>
          </div>
        </div>
      )}
      {live && !r.hostOnline && <div class="reconnecting">The host TV is offline. Waiting for it to come back…</div>}
      {showStats && live && <StatsBox receiver={r} />}
      <div class="mirror-bar">
        {needsTap && (
          <button class="btn btn-yolk" onClick={unmute}>
            🔊 Sound on
          </button>
        )}
        <span class="pill">
          {location.host}/join · <b>{r.code}</b>
        </span>
        <button
          class={`btn btn-ghost ${muted ? '' : 'on'}`}
          title="Sound on this screen"
          onClick={(e) => {
            e.stopPropagation();
            sound.unlock();
            setNeedsTap(false);
            r.replica.muted = !muted;
            setMuted(!muted);
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button
          class={`btn btn-ghost ${showStats ? 'on' : ''}`}
          title="Show how far behind the host this screen is"
          onClick={(e) => {
            e.stopPropagation();
            setShowStats(!showStats);
          }}
        >
          📊
        </button>
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

/** Live numbers: how far behind the host this screen is, and why. */
function StatsBox({ receiver: r }: { receiver: Receiver }) {
  const [s, setS] = useState<ScreenStats | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => void r.stats().then((x) => alive && setS(x));
    poll();
    const t = window.setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [r]);
  if (!s) return null;
  const ms = (v: number) => `${Math.round(v)} ms`;
  const trip = s.rttMs === null ? null : s.rttMs / 2;
  return (
    <div class="mirror-stats-box">
      <div class="mirror-stats-delay">{trip === null ? `network + ${ms(s.bufferMs)}` : `≈ ${ms(trip + s.bufferMs)}`} behind the host</div>
      <div>
        {s.route === 'direct' ? 'direct from the host TV' : 'through the server'}
        {trip !== null ? ` · network ${ms(trip)}` : ''} · buffer {ms(s.bufferMs)}
      </div>
      <div>
        {Math.round(s.framesPerSec)} frames/s · {Math.round(s.kbps)} kbit/s · {s.objects} objects
      </div>
    </div>
  );
}
