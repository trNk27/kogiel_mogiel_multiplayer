import { useEffect, useRef, useState } from 'preact/hooks';
import {
  CLOSE,
  MAX_NAME_LENGTH,
  PLAYER_COLORS,
  colorHex,
  normalizeCode,
  sanitizeName,
  type ColorId,
  type PhoneMsg,
  type PhoneView,
  type RoomInfoResponse,
  type ServerToPhone,
} from '../../../shared/protocol';
import { KogielGlass, Pierogi, Rosette } from '../lib/art';
import { ReconnectingSocket, wsUrl, type SocketStatus } from '../lib/socket';
import { forgetRoom, loadStored, saveStored, type Stored } from './storage';
import { setWakeLock } from './wakelock';
import { ViewRouter } from './views';
import { rallyBus, savedHostCode } from './rallyBus';
import { VipMenu } from './vipMenu';
import { putPhoto } from './photos';

const params = new URLSearchParams(location.search);
const AUTO = params.has('auto'); // used by the /dev page
/** /dev: this phone starts a no-TV party by itself. */
const AUTO_NOTV = AUTO && params.has('notv');

type Stage =
  | { s: 'form'; error?: string }
  | { s: 'connecting' }
  | { s: 'color'; taken: ColorId[]; full: boolean; inGame: boolean; error?: string }
  | { s: 'in' }
  | { s: 'gone'; title: string; text: string };

export interface Me {
  name: string;
  color: ColorId;
  vip: boolean;
  /** The room has no TV: phones show everything. */
  noTv?: boolean;
  /** This phone is the one hosting the room. */
  hosting?: boolean;
  /** Room code. */
  room?: string;
}

export type Send = (m: PhoneMsg) => void;

export function PhoneApp() {
  const [stored, setStored] = useState<Stored>(() => loadStored());
  const [code, setCode] = useState(() => normalizeCode(params.get('code') ?? stored.code ?? ''));
  const [name, setName] = useState(() => params.get('name') ?? stored.name ?? '');
  const [stage, setStage] = useState<Stage>({ s: 'form' });
  const [status, setStatus] = useState<SocketStatus>('closed');
  const [hostOnline, setHostOnline] = useState(true);
  const [view, setView] = useState<{ view: PhoneView; me: Me; offset: number } | null>(null);
  /** Code of the room this phone hosts without a TV, if any. */
  const [hosting, setHosting] = useState<string | null>(null);
  const hostingRef = useRef(hosting);
  hostingRef.current = hosting;
  const socket = useRef<ReconnectingSocket<ServerToPhone, PhoneMsg> | null>(null);
  const storedRef = useRef(stored);
  storedRef.current = stored;

  const update = (patch: Partial<Stored>) => {
    const next = { ...storedRef.current, ...patch };
    storedRef.current = next;
    saveStored(next);
    setStored(next);
  };

  const send: Send = (m) => {
    socket.current?.send(m);
  };

  const leave = (title: string, text: string, forget = true) => {
    socket.current?.close();
    socket.current = null;
    setWakeLock(false);
    if (forget) setStored(forgetRoom(storedRef.current));
    if (forget && hostingRef.current) {
      setHosting(null);
      void import('./notvHost').then((h) => h.stopHosting());
    }
    setView(null);
    setStage({ s: 'gone', title, text });
  };

  const connect = (roomCode: string) => {
    socket.current?.close();
    setStage({ s: 'connecting' });
    const s = new ReconnectingSocket<ServerToPhone, PhoneMsg>({
      url: () => wsUrl(`/ws/${roomCode}?role=player&id=${encodeURIComponent(storedRef.current.id)}`),
      onStatus: setStatus,
      onFatal: (closeCode) => {
        if (closeCode === CLOSE.kicked) leave('You were removed', 'The VIP removed you from the room.');
        else if (closeCode === CLOSE.replaced) leave('Opened elsewhere', 'This player is now playing in another tab or window.', false);
        else leave('Room closed', 'This room doesn’t exist any more. Ask the TV for the new code!');
      },
      onMessage: (m) => {
        switch (m.t) {
          case 'host':
            setHostOnline(m.online);
            break;
          case 'err':
            leave(m.code === 'no_room' ? 'Room not found' : 'Something went wrong', m.code === 'no_room' ? `There’s no room called ${roomCode}. Check the code on the TV.` : 'Please try again.');
            break;
          case 'hello': {
            setView(null);
            setStage({ s: 'color', taken: m.taken, full: m.full, inGame: m.inGame });
            // Dev phones join automatically; so does a player the TV forgot (e.g. after the TV
            // reloaded) as long as their old colour is still free.
            const st = storedRef.current;
            const mine = PLAYER_COLORS.find((c) => !m.taken.includes(c.id) && c.id === st.color);
            const rejoin = st.code === roomCode && mine && st.name;
            if ((AUTO || rejoin) && !m.full) {
              const free = mine ?? PLAYER_COLORS.find((c) => !m.taken.includes(c.id));
              const autoName = sanitizeName(st.name || name) || 'Pierogi';
              if (free) s.send({ t: 'join', name: autoName, color: free.id });
            }
            break;
          }
          case 'joinError':
            setStage({ s: 'color', taken: m.taken, full: false, inGame: false, error: m.reason });
            break;
          case 'view':
            update({ code: roomCode, at: Date.now(), color: m.me.color, name: m.me.name });
            setView({ view: m.view, me: { ...m.me, noTv: !!m.noTv, hosting: hostingRef.current === roomCode, room: roomCode }, offset: Date.now() - m.now });
            setStage({ s: 'in' });
            break;
          case 'buzz':
            try {
              navigator.vibrate?.(m.pattern);
            } catch {
              /* not supported (iOS) */
            }
            break;
          case 'rs':
          case 'rfx':
            rallyBus.emit(m);
            break;
          case 'photo':
            putPhoto(m.id, m.rev, m.data);
            break;
          case 'kicked':
            leave('You were removed', 'The VIP removed you from the room.');
            break;
        }
      },
    });
    socket.current = s;
  };

  /** Start a party without a TV: this phone hosts it in the background and joins it. */
  const startNoTv = async () => {
    const n = sanitizeName(name);
    if (!n) return setStage({ s: 'form', error: 'Please enter your name first.' });
    setStage({ s: 'connecting' });
    try {
      const { startHosting } = await import('./notvHost');
      const c = await startHosting();
      update({ name: n });
      setHosting(c);
      setCode(c);
      if (window.parent !== window) window.parent.postMessage({ type: 'couch-party-room', code: c }, location.origin);
      connect(c);
    } catch (err) {
      setStage({ s: 'form', error: `Could not start a party. ${(err as Error).message}` });
    }
  };

  // Seamless rejoin: if we were in this room recently, reconnect without asking anything.
  useEffect(() => {
    const st = storedRef.current;
    const urlCode = normalizeCode(params.get('code') ?? '');
    const recent = st.at && Date.now() - st.at < 3 * 60 * 60_000;
    const hosted = savedHostCode(params.get('dev'));
    if (hosted && (!urlCode || urlCode === hosted)) {
      // This phone was hosting a no-TV party before it reloaded: host it again, then rejoin.
      setStage({ s: 'connecting' });
      setCode(hosted);
      void import('./notvHost')
        .then((h) => h.resumeHosting())
        .then((c) => {
          if (c) {
            setHosting(c);
            connect(c);
          } else setStage({ s: 'form', error: `Room ${hosted} has expired.` });
        });
    } else if (AUTO_NOTV) {
      void startNoTv();
    } else if (st.code && recent && (!urlCode || urlCode === st.code)) {
      setCode(st.code);
      connect(st.code);
    } else if (AUTO && urlCode) {
      update({ name: sanitizeName(name) || 'Pierogi' });
      connect(urlCode);
    }
    return () => socket.current?.close();
  }, []);

  // Keep the screen awake while a game is running (and all the time on a phone hosting without a TV).
  useEffect(() => {
    const v = view?.view.v;
    setWakeLock(!!hosting || (!!v && v !== 'lobby' && v !== 'results'));
  }, [view?.view.v, hosting]);

  const submitForm = async (e: Event) => {
    e.preventDefault();
    const c = normalizeCode(code);
    const n = sanitizeName(name);
    if (c.length !== 4) return setStage({ s: 'form', error: 'Room codes have 4 letters.' });
    if (!n) return setStage({ s: 'form', error: 'Please enter your name.' });
    setStage({ s: 'connecting' });
    try {
      const res = await fetch(`/api/rooms/${c}`);
      const info = (await res.json()) as RoomInfoResponse;
      if (!info.exists) return setStage({ s: 'form', error: `There’s no room called ${c}. Check the TV!` });
    } catch {
      return setStage({ s: 'form', error: 'Can’t reach the server. Check your connection.' });
    }
    // New room → new identity, so stale slots in other rooms don't matter.
    if (storedRef.current.code && storedRef.current.code !== c) setStored(forgetRoom(storedRef.current));
    update({ name: n });
    connect(c);
  };

  const pickColor = (color: ColorId) => {
    update({ color });
    send({ t: 'join', name: sanitizeName(storedRef.current.name || name), color });
  };

  // ---- render ----------------------------------------------------------------

  if (stage.s === 'form' || stage.s === 'gone') {
    return (
      <div class="phone phone-form">
        <div class="phone-brand">
          <KogielGlass size={64} />
          <div>
            <div class="logo-small">Kogiel Mogiel</div>
            <div class="phone-brand-big">Couch Party</div>
          </div>
        </div>
        {stage.s === 'gone' && (
          <div class="notice card-paper">
            <b>{stage.title}</b>
            <span>{stage.text}</span>
          </div>
        )}
        <form class="join-form" onSubmit={submitForm}>
          <label>
            Room code
            <input
              class="input input-code"
              value={code}
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellcheck={false}
              placeholder="ABCD"
              onInput={(e) => setCode(normalizeCode((e.target as HTMLInputElement).value))}
            />
          </label>
          <label>
            Your name
            <input
              class="input"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="nickname"
              placeholder="e.g. Babcia"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
          {stage.s === 'form' && stage.error && <div class="form-error">{stage.error}</div>}
          <button class="btn btn-big btn-yolk" type="submit">
            Join the party
          </button>
        </form>
        <div class="notv-card">
          <div class="notv-title">No TV? No problem.</div>
          <p class="muted">Start a party right here – every phone shows the game itself. Friends join with the code you’ll see.</p>
          <button class="btn btn-big btn-ghost" type="button" onClick={startNoTv}>
            Play without a TV
          </button>
        </div>
        <p class="host-link">
          To host on a TV, open this same link on a laptop or TV.{' '}
          <a href="/?host">Show the TV screen on this phone</a>
        </p>
        <Rosette size={90} class="form-rosette" />
      </div>
    );
  }

  if (stage.s === 'connecting') {
    return (
      <div class="phone phone-center">
        <Pierogi color="#ffd23f" size={120} mood="wow" class="bob" />
        <div class="phone-big">Joining {code}…</div>
      </div>
    );
  }

  if (stage.s === 'color') {
    return (
      <div class="phone phone-color">
        <h1 class="phone-title">Pick your pierogi</h1>
        <p class="muted">Hi {sanitizeName(stored.name || name)}! Choose a colour – it’s you on the TV.</p>
        {stage.full ? (
          <div class="notice card-paper">
            <b>Room is full</b>
            <span>Up to 8 players can join. Wait for someone to leave.</span>
          </div>
        ) : (
          <div class="color-grid">
            {PLAYER_COLORS.map((c) => {
              const taken = stage.taken.includes(c.id);
              return (
                <button class={`color-btn ${taken ? 'taken' : ''}`} disabled={taken} onClick={() => pickColor(c.id)} style={{ '--pc': c.hex }}>
                  <Pierogi color={taken ? '#5a4040' : c.hex} size={84} mood={taken ? 'sleep' : 'happy'} />
                  <span>{taken ? 'Taken' : c.name}</span>
                </button>
              );
            })}
          </div>
        )}
        {stage.error && <div class="form-error">{stage.error}</div>}
        {stage.inGame && <p class="muted small">A game is running – you’ll join the next one.</p>}
      </div>
    );
  }

  // stage 'in'
  if (!view) return null;
  const { me } = view;
  return (
    <div class="phone phone-in" style={{ '--me': colorHex(me.color) }}>
      <header class="phone-head">
        <Pierogi color={colorHex(me.color)} size={44} />
        <span class="phone-name">{me.name}</span>
        {me.vip && <span class="vip-badge small">VIP</span>}
        <span class="grow" />
        <span class="phone-code">{code}</span>
        {me.vip && view.view.v !== 'lobby' && view.view.v !== 'results' && <VipMenu send={send} />}
      </header>
      <main class="phone-main">
        <ViewRouter view={view.view} me={me} send={send} offset={view.offset} />
      </main>
      {(!hostOnline || status === 'connecting') && (
        <div class="phone-overlay">
          <Pierogi color={colorHex(me.color)} size={100} mood="sleep" class="bob" />
          <div class="phone-big">{status === 'connecting' ? 'Reconnecting…' : me.noTv ? 'Waiting for the host’s phone…' : 'Waiting for the TV…'}</div>
          <div class="muted">Your spot and score are safe.</div>
        </div>
      )}
    </div>
  );
}
