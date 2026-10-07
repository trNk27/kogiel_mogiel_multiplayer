import { useEffect, useRef, useState } from 'preact/hooks';
import {
  ANSWER_STYLES,
  DIFFICULTIES,
  GAMES,
  KITCHEN_LEVELS,
  MAX_PLAYERS,
  RALLY_TRACKS,
  TOURNAMENT_CANDIDATES,
  TOURNAMENT_MAX_GAMES,
  TOURNAMENT_MIN_GAMES,
  TOURNAMENT_MIN_PLAYERS,
  gamesFor,
  rallyTrack,
  colorHex,
  difficultyName,
  gameInfo,
  playerCountProblem,
  tournamentLength,
  tournamentPool,
  tournamentProblem,
  type GameId,
  type LobbyOptions,
  type PhoneView,
} from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import { QrCode } from '../lib/qr';
import { Shape } from '../lib/shapes';
import { GameIcon } from '../host/GameIcon';
import { formatNumber } from '../../../shared/format';
import type { Me, Send } from './PhoneApp';
import { KitchenPad } from './kitchen';
import { Stars } from '../lib/stars';
import { TimeBar } from './timebar';
import { RallyPad } from './rally';
import { TyDraw, TyPick, TyResult, TySelfie, TyVote } from './toty';
import { BzDraw, BzGuess, BzLie, BzResult } from './bazgroly';
import { ForkPad, ParadePad, PedalPad } from './minigames';
import { ArenaPad } from './arenaPad';

export interface Props<V extends PhoneView['v']> {
  view: Extract<PhoneView, { v: V }>;
  me: Me;
  send: Send;
  offset: number;
}

export function ViewRouter({ view, me, send, offset }: { view: PhoneView; me: Me; send: Send; offset: number }) {
  switch (view.v) {
    case 'lobby':
      return <Lobby view={view} me={me} send={send} offset={offset} />;
    case 'wait':
      return <Wait view={view} me={me} send={send} offset={offset} />;
    case 'trails':
      return <TrailsPad view={view} me={me} send={send} offset={offset} />;
    case 'quiz':
      return <QuizPad view={view} me={me} send={send} offset={offset} />;
    case 'quizResult':
      return <QuizResult view={view} me={me} send={send} offset={offset} />;
    case 'bpGuess':
      return <BpGuess view={view} me={me} send={send} offset={offset} key={view.q} />;
    case 'bpBet':
      return <BpBet view={view} me={me} send={send} offset={offset} />;
    case 'bpResult':
      return <BpResult view={view} me={me} send={send} offset={offset} />;
    case 'kitchen':
      return <KitchenPad view={view} me={me} send={send} />;
    case 'rally':
      return <RallyPad view={view} me={me} send={send} offset={offset} />;
    case 'tySelfie':
      return <TySelfie view={view} me={me} send={send} offset={offset} />;
    case 'tyVote':
      return <TyVote view={view} me={me} send={send} offset={offset} key={view.q} />;
    case 'tyDraw':
      return <TyDraw view={view} me={me} send={send} offset={offset} key={view.prompt} />;
    case 'tyPick':
      return <TyPick view={view} me={me} send={send} offset={offset} />;
    case 'tyResult':
      return <TyResult view={view} me={me} send={send} offset={offset} />;
    case 'bzDraw':
      return <BzDraw view={view} me={me} send={send} offset={offset} key={view.endsAt} />;
    case 'bzLie':
      return <BzLie view={view} me={me} send={send} offset={offset} key={view.endsAt} />;
    case 'bzGuess':
      return <BzGuess view={view} me={me} send={send} offset={offset} key={view.endsAt} />;
    case 'bzResult':
      return <BzResult view={view} me={me} send={send} offset={offset} />;
    case 'pedal':
      return <PedalPad view={view} me={me} send={send} offset={offset} key={view.heat} />;
    case 'fork':
      return <ForkPad view={view} me={me} send={send} offset={offset} key={view.round} />;
    case 'parade':
      return <ParadePad view={view} me={me} send={send} offset={offset} key={view.round} />;
    case 'pad':
      return <ArenaPad view={view} me={me} send={send} offset={offset} key={view.game} />;
    case 'results':
      return <Results view={view} me={me} send={send} offset={offset} />;
    case 'tourResults':
      return <TourResults view={view} me={me} send={send} offset={offset} />;
  }
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function Lobby({ view, me, send }: Props<'lobby'>) {
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
  if (!view.vip) {
    return (
      <div class="pv pv-center">
        <Pierogi color={colorHex(me.color)} size={170} class="bob" />
        <div class="phone-big">You’re in!</div>
        <p class="muted">
          {view.vipName ? `${view.vipName} is the VIP and will start the game.` : 'Waiting for the VIP…'}
          <br />
          {me.noTv ? 'No TV needed – the game plays right here on your phone.' : 'Look at the TV.'}
        </p>
        <div class="pill">{view.playerCount} player{view.playerCount === 1 ? '' : 's'} in the room</div>
        {me.noTv && <Invite room={me.room ?? ''} />}
      </div>
    );
  }
  const noTv = !!me.noTv;
  const tour = view.selected === 'tournament';
  const selected = view.selected === 'tournament' ? null : gameInfo(view.selected);
  const connected = view.players.filter((p) => p.connected).length;
  const problem = selected
    ? playerCountProblem(selected, connected, view.players.length, noTv)
    : tournamentProblem(connected, view.players.length, noTv, view.options.tourOff);
  const tourCount = tournamentLength(view.options.tourGames, tournamentPool(connected, view.players.length, view.options.tourOff).length);
  const canStart = problem === null;
  const max = noTv ? MAX_PLAYERS : selected?.maxPlayers;
  return (
    <div class="pv pv-lobby">
      {noTv && <Invite room={me.room ?? ''} />}
      <div class="section-label">{noTv ? 'You’re the VIP – games without a TV' : 'You’re the VIP – pick a game'}</div>
      <div class="pgames">
        {!noTv && (
          <button class={`pgame pgame-tour ${tour ? 'selected' : ''}`} onClick={() => send({ t: 'select', game: 'tournament' })}>
            <GameIcon game="tournament" size={54} />
            <span class="pgame-text">
              <b>Tournament</b>
              <small>
                {tourCount} random games in a row{view.options.tourShort ? ', short versions' : ''}. Most points wins!
              </small>
            </span>
          </button>
        )}
        {gamesFor(noTv).map((g) => (
          <button class={`pgame ${g.id === view.selected ? 'selected' : ''}`} onClick={() => send({ t: 'select', game: g.id })}>
            <GameIcon game={g.id} size={54} />
            <span class="pgame-text">
              <b>{g.title}</b>
              <small>{noTv ? g.noTv : g.tagline}</small>
            </span>
          </button>
        ))}
      </div>
      {noTv && <div class="muted small">Quiz, Trails and the rest need a shared screen – start a party from a TV or laptop to play them.</div>}
      <div class="toggles">
        {tour && <TourSettings options={view.options} connected={connected} inRoom={view.players.length} send={send} />}
        {(view.selected === 'trails' || tour) && (
          <Toggle label={tour ? 'Trails power-ups' : 'Power-ups'} hint="Speed, line size, gaps, jumps, through walls and more" on={view.options.powerups} onChange={(v) => send({ t: 'option', key: 'powerups', value: v })} />
        )}
        {view.selected === 'rally' && <TrackPicker value={view.options.track} onChange={(v) => send({ t: 'option', key: 'track', value: v })} />}
        {(view.selected === 'rally' || tour) && (
          <Toggle
            label={tour ? 'Maluch Rally items' : 'Items'}
            hint={noTv ? '? boxes on the track – tap the item button to use one' : '? boxes on the track – lift your thumb to use one'}
            on={view.options.items}
            onChange={(v) => send({ t: 'option', key: 'items', value: v })}
          />
        )}
        {view.selected === 'kitchen' && (
          <>
            <Slider
              label="Difficulty"
              hint="How fast the orders come in"
              min={1}
              max={DIFFICULTIES.length}
              value={view.options.difficulty}
              format={difficultyName}
              onChange={(v) => send({ t: 'option', key: 'difficulty', value: v })}
            />
            <div class="segmented-wrap">
              <div class="toggle-text">
                <b>Start at level</b>
                <small>{KITCHEN_LEVELS[view.options.level - 1]?.news}</small>
              </div>
              <div class="segmented">
                {KITCHEN_LEVELS.map((l, i) => (
                  <button class={view.options.level === i + 1 ? 'on' : ''} onClick={() => send({ t: 'option', key: 'level', value: i + 1 })}>
                    <b>{i + 1}</b>
                    <small>{l.name}</small>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {!noTv && <Toggle label="TV sound" on={view.options.sound} onChange={(v) => send({ t: 'option', key: 'sound', value: v })} />}
      </div>
      <button class="btn btn-big btn-yolk start-btn" disabled={!canStart} onClick={() => send({ t: 'start' })}>
        {canStart
          ? `Start ${selected ? selected.title : 'the tournament'}`
          : !selected
            ? connected < TOURNAMENT_MIN_PLAYERS
              ? `Needs ${TOURNAMENT_MIN_PLAYERS}+ players`
              : `Switch on ${TOURNAMENT_MIN_GAMES}+ games`
            : max && view.players.length > max
              ? `Max ${max} players`
              : `Needs ${selected.minPlayers}+ players`}
      </button>
      <div class="section-label">Players</div>
      <div class="plist">
        {view.players.map((p) => (
          <div class={`plist-row ${p.connected ? '' : 'offline'}`}>
            <Pierogi color={colorHex(p.color)} size={40} mood={p.connected ? 'happy' : 'sleep'} />
            <span class="grow">
              {p.name}
              {p.vip ? ' 👑' : ''}
            </span>
            {p.id !== view.players.find((x) => x.vip)?.id &&
              (confirmKick === p.id ? (
                <button
                  class="kick sure"
                  onClick={() => {
                    send({ t: 'kick', id: p.id });
                    setConfirmKick(null);
                  }}
                >
                  Remove?
                </button>
              ) : (
                <button class="kick" onClick={() => setConfirmKick(p.id)} aria-label={`Remove ${p.name}`}>
                  ✕
                </button>
              ))}
          </div>
        ))}
      </div>
      {me.vip && (
        <div class="muted small center">
          {me.hosting ? 'Keep this page open – your phone is hosting the party.' : noTv ? 'You run the show from here.' : 'Tip: the TV needs no remote – you run the show from here.'}
        </div>
      )}
    </div>
  );
}

/** Tournament: how many games, short or full versions, and which games can be drawn. */
function TourSettings({ options, connected, inRoom, send }: { options: LobbyOptions; connected: number; inRoom: number; send: Send }) {
  const off = options.tourOff;
  const pool = tournamentPool(connected, inRoom, off);
  const fits = (g: GameId) => playerCountProblem(gameInfo(g), connected, inRoom) === null;
  const count = tournamentLength(options.tourGames, pool.length);
  const setOff = (next: GameId[]) => send({ t: 'option', key: 'tourOff', value: next });
  return (
    <>
      <Slider
        label="Games"
        hint={
          count < options.tourGames
            ? `Only ${pool.length} switched-on game${pool.length === 1 ? '' : 's'} suit${pool.length === 1 ? 's' : ''} ${inRoom} players – the tournament plays ${count}.`
            : 'How many games the tournament plays'
        }
        min={TOURNAMENT_MIN_GAMES}
        max={TOURNAMENT_MAX_GAMES}
        value={options.tourGames}
        format={String}
        onChange={(v) => send({ t: 'option', key: 'tourGames', value: v })}
      />
      <Toggle
        label="Short versions"
        hint={options.tourShort ? 'Quick games: fewer rounds, questions and laps' : 'Every game is played in full – a long evening!'}
        on={options.tourShort}
        onChange={(v) => send({ t: 'option', key: 'tourShort', value: v })}
      />
      <div class="segmented-wrap">
        <div class="toggle-text">
          <b>
            Games in the draw: {TOURNAMENT_CANDIDATES.length - off.length} of {TOURNAMENT_CANDIDATES.length}
          </b>
          <small>
            Tap a game to switch it on or off.
            {pool.length < TOURNAMENT_CANDIDATES.length - off.length ? ` Faded ones don’t suit ${inRoom} players, so ${pool.length} can be drawn.` : ''}
          </small>
        </div>
        <div class="tour-picks">
          {TOURNAMENT_CANDIDATES.map((g) => {
            const on = !off.includes(g);
            return (
              <button
                class={`tour-pick ${on ? 'on' : ''} ${fits(g) ? '' : 'unfit'}`}
                aria-pressed={on}
                onClick={() => setOff(on ? [...off, g] : off.filter((x) => x !== g))}
              >
                <GameIcon game={g} size={40} />
                <small>{gameInfo(g).title}</small>
              </button>
            );
          })}
        </div>
        <div class="tour-picks-all">
          <button class="btn btn-ghost" disabled={off.length === 0} onClick={() => setOff([])}>
            All on
          </button>
          <button class="btn btn-ghost" disabled={off.length === TOURNAMENT_CANDIDATES.length} onClick={() => setOff([...TOURNAMENT_CANDIDATES])}>
            All off
          </button>
        </div>
      </div>
    </>
  );
}

/** Maluch Rally: a cup of mixed or hard tracks, or every race on one kind of track. */
function TrackPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const chosen = rallyTrack(value);
  return (
    <div class="segmented-wrap">
      <div class="toggle-text">
        <b>Tracks: {chosen.name}</b>
        <small>{chosen.cup ? chosen.hint : `All three races on a ${chosen.name} – ${chosen.hint.toLowerCase()}`}</small>
      </div>
      <div class="track-grid">
        {RALLY_TRACKS.map((t) => (
          <button class={`track-chip ${t.cup ? 'cup' : ''} ${t.hard ? 'hard' : ''} ${t.id === chosen.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
            {t.hard && <span aria-label="hard">🌶</span>}
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** No TV, so the room code and QR code live on the phones. */
function Invite({ room }: { room: string }) {
  const [big, setBig] = useState(false);
  const url = `${location.origin}/join?code=${room}`;
  return (
    <div class="invite card-paper" onClick={() => setBig(!big)}>
      <div class="invite-text">
        <small>Friends join at {location.host}/join with</small>
        <b class="invite-code">{room}</b>
        <small>{big ? 'Tap to hide the QR code' : 'Tap to show a QR code'}</small>
      </div>
      {big && (
        <div class="invite-qr">
          <QrCode text={url} size={200} />
        </div>
      )}
    </div>
  );
}

function Slider(props: { label: string; hint?: string; min: number; max: number; value: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const [local, setLocal] = useState<number | null>(null);
  const v = local ?? props.value;
  useEffect(() => setLocal(null), [props.value]);
  return (
    <label class="slider">
      <span class="toggle-text">
        <b>
          {props.label}: <span class="slider-value">{props.format(v)}</span>
        </b>
        {props.hint && <small>{props.hint}</small>}
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={v}
        style={{ '--fill': `${((v - props.min) / (props.max - props.min)) * 100}%` }}
        onInput={(e) => setLocal(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => props.onChange(Number((e.target as HTMLInputElement).value))}
      />
      <span class="slider-ends">
        <small>{props.format(props.min)}</small>
        <small>{props.format(props.max)}</small>
      </span>
    </label>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button class={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span class="toggle-text">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <span class="toggle-track">
        <span class="toggle-knob" />
      </span>
    </button>
  );
}

function Wait({ view, me }: Props<'wait'>) {
  const isGame = view.icon === 'tournament' || GAMES.some((g) => g.id === view.icon);
  return (
    <div class="pv pv-center">
      {isGame ? <GameIcon game={view.icon as GameId | 'tournament'} size={150} /> : <Pierogi color={colorHex(me.color)} size={150} mood={view.icon === 'sleep' ? 'sleep' : 'happy'} class="bob" />}
      <div class="phone-big">{view.title}</div>
      {view.text && <p class="muted">{view.text}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trails
// ---------------------------------------------------------------------------

function TrailsPad({ view, me, send }: Props<'trails'>) {
  const pad = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState({ l: false, r: false });
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    const el = pad.current!;
    let touch = { l: false, r: false };
    let mouse: 'l' | 'r' | null = null;
    const keys = { l: false, r: false };
    let last = { l: false, r: false };

    const apply = () => {
      const next = { l: touch.l || mouse === 'l' || keys.l, r: touch.r || mouse === 'r' || keys.r };
      if (next.l === last.l && next.r === last.r) return;
      if ((next.l && !last.l) || (next.r && !last.r)) {
        try {
          navigator.vibrate?.(8);
        } catch {
          /* ignore */
        }
      }
      last = next;
      setPressed(next);
      sendRef.current({ t: 'steer', l: next.l, r: next.r });
    };
    const side = (x: number) => {
      const rect = el.getBoundingClientRect();
      return x < rect.left + rect.width / 2 ? 'l' : 'r';
    };
    const onTouch = (e: TouchEvent) => {
      e.preventDefault();
      touch = { l: false, r: false };
      for (const t of Array.from(e.touches)) touch[side(t.clientX)] = true;
      apply();
    };
    const onMouseDown = (e: MouseEvent) => {
      mouse = side(e.clientX);
      apply();
    };
    const onMouseUp = () => {
      mouse = null;
      apply();
    };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.l = down;
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.r = down;
      else return;
      e.preventDefault();
      apply();
    };
    const keyDown = onKey(true);
    const keyUp = onKey(false);
    const reset = () => {
      touch = { l: false, r: false };
      mouse = null;
      keys.l = keys.r = false;
      apply();
    };
    const opts = { passive: false } as const;
    el.addEventListener('touchstart', onTouch, opts);
    el.addEventListener('touchmove', onTouch, opts);
    el.addEventListener('touchend', onTouch, opts);
    el.addEventListener('touchcancel', onTouch, opts);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      el.removeEventListener('touchstart', onTouch);
      el.removeEventListener('touchmove', onTouch);
      el.removeEventListener('touchend', onTouch);
      el.removeEventListener('touchcancel', onTouch);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);

  const dead = view.phase === 'dead';
  return (
    <div class={`pv trails-pad ${dead ? 'is-dead' : ''}`} style={{ '--me': colorHex(me.color) }}>
      <div class="trails-pad-score">
        <span>
          <b>{view.score}</b> / {view.target} pts
        </span>
        <span class="muted">Round {view.round}</span>
      </div>
      <div class="trails-pad-buttons" ref={pad}>
        <div class={`steer left ${pressed.l ? 'down' : ''}`}>
          <svg viewBox="0 0 100 100" width="40%">
            <path d="M64 16 L28 50 L64 84" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>LEFT</span>
        </div>
        <div class={`steer right ${pressed.r ? 'down' : ''}`}>
          <svg viewBox="0 0 100 100" width="40%">
            <path d="M36 16 L72 50 L36 84" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>RIGHT</span>
        </div>
      </div>
      {view.phase === 'countdown' && <div class="trails-pad-banner">Get ready! Find yourself on the TV</div>}
      {dead && (
        <div class="dead-overlay">
          <Pierogi color={colorHex(me.color)} size={140} mood="dead" />
          <div class="dead-text">DEAD</div>
          <div class="muted">Cheer on the others – a new round starts soon.</div>
        </div>
      )}
      {view.phase === 'roundOver' && (
        <div class="dead-overlay calm">
          <div class="phone-big">{view.winner ? `${view.winner} wins the round` : 'Round over'}</div>
          <div class="muted">Next round in a moment…</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

function QuizPad({ view, send, offset }: Props<'quiz'>) {
  const [local, setLocal] = useState<number | null>(null);
  useEffect(() => setLocal(null), [view.q]);
  const picked = view.picked ?? local;
  if (picked !== null) {
    return (
      <div class="pv pv-center">
        <div class="locked-shape" style={{ background: ANSWER_STYLES[picked].hex }}>
          <Shape index={picked} size={110} />
        </div>
        <div class="phone-big">Locked in!</div>
        <p class="muted">Fingers crossed…</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  return (
    <div class="pv quiz-pad">
      <div class="quiz-pad-top">
        <span>
          Question {view.q} / {view.total}
        </span>
        <span class="muted">Look at the TV</span>
      </div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="quiz-pad-grid">
        {ANSWER_STYLES.map((st, i) => (
          <button
            class="quiz-pad-btn"
            style={{ background: st.hex }}
            aria-label={st.label}
            onPointerDown={(e) => {
              e.preventDefault();
              setLocal(i);
              send({ t: 'answer', i });
            }}
          >
            <Shape index={i} size={96} />
          </button>
        ))}
      </div>
    </div>
  );
}

function QuizResult({ view, me }: Props<'quizResult'>) {
  const mood = view.correct ? 'wow' : view.correct === false ? 'dead' : 'sleep';
  return (
    <div class={`pv pv-center result-${view.correct ? 'good' : 'bad'}`}>
      <Pierogi color={colorHex(me.color)} size={150} mood={mood} class="pop-in" />
      <div class="phone-huge">{view.correct ? 'Correct!' : view.correct === false ? 'Nope!' : 'Too slow!'}</div>
      {view.points > 0 && <div class="gain-big">+{view.points}</div>}
      <div class="stat-row">
        <div class="stat">
          <small>Total</small>
          <b>{view.total.toLocaleString('en-US')}</b>
        </div>
        <div class="stat">
          <small>Place</small>
          <b>#{view.rank}</b>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ballpark
// ---------------------------------------------------------------------------

function groupDigits(raw: string): string {
  const [int, dec] = raw.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${grouped}.${dec}` : grouped;
}

function BpGuess({ view, send, offset }: Props<'bpGuess'>) {
  const [raw, setRaw] = useState('');
  const [sent, setSent] = useState(false);
  const submitted = view.submitted;
  if (submitted !== null || sent) {
    return (
      <div class="pv pv-center">
        <div class="phone-small muted">Your guess</div>
        <div class="guess-big">{submitted !== null ? formatNumber(submitted, view.unit) : groupDigits(raw)}</div>
        {view.unit && view.unit !== 'year' && <div class="muted">{view.unit}</div>}
        <p class="muted">Waiting for the others…</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  const press = (k: string) => {
    setRaw((r) => {
      if (k === 'del') return r.slice(0, -1);
      if (r.replace(/\D/g, '').length >= 12) return r;
      if (k === '.') return r.includes('.') || view.unit === 'year' ? r : (r || '0') + '.';
      if (r === '0') return k;
      return r + k;
    });
  };
  const value = raw === '' ? null : Number(raw);
  const display = raw === '' ? '0' : view.unit === 'year' ? raw : groupDigits(raw);
  return (
    <div class="pv bp-guess">
      <div class="bp-q">
        <small class="muted">
          Question {view.q} / {view.total}
        </small>
        <div>{view.question}</div>
      </div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="numpad-display">
        <span class={raw ? '' : 'placeholder'}>{display}</span>
        {view.unit && view.unit !== 'year' && <small>{view.unit}</small>}
      </div>
      <div class="numpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => (
          <button
            class={`numkey ${k === 'del' ? 'del' : ''}`}
            disabled={k === '.' && view.unit === 'year'}
            onPointerDown={(e) => {
              e.preventDefault();
              press(k);
            }}
          >
            {k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>
      <button
        class="btn btn-big btn-yolk"
        disabled={value === null || !Number.isFinite(value)}
        onClick={() => {
          if (value === null || !Number.isFinite(value)) return;
          send({ t: 'guess', value });
          setSent(true);
        }}
      >
        Lock in guess
      </button>
    </div>
  );
}

function BpBet({ view, send, offset }: Props<'bpBet'>) {
  const [local, setLocal] = useState<number | null>(null);
  const picked = view.picked ?? local;
  const label = (i: number) => {
    const s = view.slots[i];
    if (s.value === null) return `Smaller than ${view.slots[1] ? formatNumber(view.slots[1].value!, view.unit) : 'everything'}`;
    return formatNumber(s.value, view.unit);
  };
  if (picked !== null) {
    return (
      <div class="pv pv-center">
        <div class="phone-small muted">Your bet</div>
        <div class="guess-big">{label(picked)}</div>
        <div class="pill">pays {view.slots[picked]?.payout}×</div>
        <p class="muted">Watch the TV for the answer!</p>
        <TimeBar endsAt={view.endsAt} offset={offset} />
      </div>
    );
  }
  return (
    <div class="pv bp-bet">
      <div class="section-label">Which guess is closest without going over?</div>
      <TimeBar endsAt={view.endsAt} offset={offset} />
      <div class="bet-list">
        {view.slots
          .map((s, i) => ({ s, i }))
          .reverse()
          .map(({ s, i }) => (
            <button
              class={`bet-row ${s.value === null ? 'edge' : ''}`}
              onClick={() => {
                setLocal(i);
                send({ t: 'bet', slot: i });
              }}
            >
              <span class="bet-value">
                {label(i)}
                {s.guessers.length > 0 && <small>{s.guessers.join(', ')}</small>}
              </span>
              <span class="bet-payout">{s.payout}×</span>
            </button>
          ))}
      </div>
    </div>
  );
}

function BpResult({ view, me }: Props<'bpResult'>) {
  const good = view.points > 0;
  return (
    <div class={`pv pv-center result-${good ? 'good' : 'bad'}`}>
      <Pierogi color={colorHex(me.color)} size={150} mood={good ? 'wow' : 'happy'} class="pop-in" />
      <div class="phone-huge">{good ? 'Nice one!' : 'Not this time'}</div>
      {good && <div class="gain-big">+{view.points}</div>}
      <div class="result-tags">
        <span class={`tag ${view.guessWon ? 'yes' : ''}`}>{view.guessWon ? '✓' : '✗'} Best guess</span>
        <span class={`tag ${view.betWon ? 'yes' : ''}`}>{view.betWon ? '✓' : '✗'} Winning bet</span>
      </div>
      <div class="stat-row">
        <div class="stat">
          <small>Total</small>
          <b>{view.total.toLocaleString('en-US')}</b>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// End of game
// ---------------------------------------------------------------------------

function Results({ view, me, send }: Props<'results'>) {
  const medal = view.place === 1 ? '🥇' : view.place === 2 ? '🥈' : view.place === 3 ? '🥉' : '';
  return (
    <div class="pv pv-center">
      <Pierogi color={colorHex(me.color)} size={150} mood={(view.coop ? view.coop.stars >= 2 : view.place === 1) ? 'wow' : 'happy'} class="bob" />
      {view.coop ? (
        <>
          <Stars n={view.coop.stars} size={64} />
          <p class="muted">
            Team tips: {view.coop.score.toLocaleString('en-US')} · +{view.coop.stars} party point{view.coop.stars === 1 ? '' : 's'} each
          </p>
        </>
      ) : view.place > 0 ? (
        <>
          <div class="phone-huge">
            {medal} {ordinal(view.place)} place
          </div>
          <p class="muted">
            {view.score.toLocaleString('en-US')} points in {gameInfo(view.game).title}
          </p>
        </>
      ) : (
        <div class="phone-big">Game over!</div>
      )}
      {view.board && <Board board={view.board} me={me} />}
      {view.tour && (
        <div class="tour-card card-paper">
          <small>
            Tournament · game {view.tour.game} of {view.tour.games}
          </small>
          <div>
            <b>+{view.tour.gained}</b> points · {view.tour.points} in total · {ordinal(view.tour.place)}
          </div>
        </div>
      )}
      {view.vip && view.tour ? (
        <div class="vip-actions">
          <button class="btn btn-big btn-yolk" onClick={() => send({ t: 'again' })}>
            {view.tour.next ? `Next game: ${gameInfo(view.tour.next).title}` : 'Crown the champion'}
          </button>
          <button class="btn btn-big btn-ghost" onClick={() => send({ t: 'lobby' })}>
            End the tournament
          </button>
        </div>
      ) : view.vip ? (
        <div class="vip-actions">
          <button class="btn btn-big btn-yolk" onClick={() => send({ t: 'again' })}>
            Play {gameInfo(view.game).title} again
          </button>
          <button class="btn btn-big btn-ghost" onClick={() => send({ t: 'lobby' })}>
            Choose another game
          </button>
        </div>
      ) : (
        <p class="muted">The VIP decides what’s next.</p>
      )}
    </div>
  );
}

function TourResults({ view, me, send }: Props<'tourResults'>) {
  const medal = view.place === 1 ? '🏆' : view.place === 2 ? '🥈' : view.place === 3 ? '🥉' : '';
  return (
    <div class="pv pv-center">
      <Pierogi color={colorHex(me.color)} size={150} mood={view.place === 1 ? 'wow' : 'happy'} class="bob" />
      <div class="phone-huge">{view.place === 1 ? `${medal} Champion!` : `${medal} ${ordinal(view.place)} place`}</div>
      <p class="muted">{view.points} tournament points</p>
      {view.vip ? (
        <div class="vip-actions">
          <button class="btn btn-big btn-yolk" onClick={() => send({ t: 'again' })}>
            Another tournament
          </button>
          <button class="btn btn-big btn-ghost" onClick={() => send({ t: 'lobby' })}>
            Choose a game
          </button>
        </div>
      ) : (
        <p class="muted">The VIP decides what’s next.</p>
      )}
    </div>
  );
}

/** Rooms without a TV: the final scores and party standings on the phone. */
function Board({ board, me }: { board: NonNullable<Props<'results'>['view']['board']>; me: Me }) {
  const party = [...board].sort((a, b) => b.party - a.party);
  return (
    <div class="board card-dark">
      {board.map((r) => (
        <div class={`board-row ${r.name === me.name ? 'me' : ''}`}>
          <span class="board-place">{r.place}</span>
          <Pierogi color={colorHex(r.color)} size={30} />
          <span class="grow">{r.name}</span>
          <b>{r.score.toLocaleString('en-US')}</b>
        </div>
      ))}
      {board.length > 1 && (
        <>
          <div class="section-label">Party standings</div>
          {party.map((r) => (
            <div class={`board-row ${r.name === me.name ? 'me' : ''}`}>
              <Pierogi color={colorHex(r.color)} size={24} />
              <span class="grow">{r.name}</span>
              <b>{r.party}</b>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
