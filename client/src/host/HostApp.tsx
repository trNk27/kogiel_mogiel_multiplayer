import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { GAMES, MAX_PLAYERS, colorHex, difficultyName, gameInfo, type GameId } from '../../../shared/protocol';
import { FolkBorder, Logo, Pierogi, Rosette } from '../lib/art';
import { QrCode } from '../lib/qr';
import { sound } from '../lib/sound';
import { HostController, type Standing } from './controller';
import type { CoopResult } from '../games/types';
import { Stars } from '../lib/stars';
import { GameIcon } from './GameIcon';
import { RACES } from '../games/rally/RallyGame';
import { LAPS } from '../games/rally/sim';

const controller = new HostController();
const params = new URLSearchParams(location.search);

/** Scale the fixed 1920×1080 stage to fit any screen. */
function useStageScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

function useController() {
  const [, setV] = useState(0);
  useEffect(() => controller.subscribe(() => setV(controller.getVersion())), []);
  return controller;
}

export function HostApp() {
  const c = useController();
  const scale = useStageScale();

  useEffect(() => {
    // The /dev page asks us to host straight away; a refreshed TV resumes its room.
    const saved = HostController.savedSession();
    if (saved && !params.has('new')) void c.resume(saved);
    else if (params.has('autohost')) void c.create();
  }, []);

  useEffect(() => {
    if (c.code && window.parent !== window) window.parent.postMessage({ type: 'couch-party-room', code: c.code }, location.origin);
  }, [c.code]);

  const s = c.screen;
  let body;
  switch (s.s) {
    case 'landing':
    case 'creating':
      body = <Landing busy={s.s === 'creating'} error={s.s === 'landing' ? s.error : undefined} />;
      break;
    case 'lobby':
      body = <Lobby />;
      break;
    case 'intro':
      body = <Intro game={s.game} />;
      break;
    case 'game':
      body = c.game?.render();
      break;
    case 'results':
      body = s.coop ? <CoopResults game={s.game} standings={s.standings} coop={s.coop} /> : <Results game={s.game} standings={s.standings} />;
      break;
  }

  return (
    <div class="viewport">
      <div class="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div class="stage-bg" aria-hidden="true">
          <Rosette class="bg-rosette r1" size={420} petals="#5c1a2e" inner="#6e2236" center="#4a1424" leaves="#3d1622" />
          <Rosette class="bg-rosette r2" size={360} petals="#5c1a2e" inner="#6e2236" center="#4a1424" leaves="#3d1622" />
        </div>
        <div class="safe">{body}</div>
        {c.code && s.s !== 'landing' && s.s !== 'creating' && <CornerInfo />}
        {c.status === 'connecting' && c.code && <div class="reconnecting">Reconnecting to the server…</div>}
      </div>
    </div>
  );
}

function CornerInfo() {
  const c = controller;
  const [muted, setMuted] = useState(sound.muted);
  const inLobby = c.screen.s === 'lobby';
  return (
    <div class="corner">
      {!inLobby && (
        <span class="corner-code">
          {location.host}/join · <b>{c.code}</b>
        </span>
      )}
      <button
        class="mute"
        onClick={() => {
          sound.unlock();
          sound.muted = !sound.muted;
          setMuted(sound.muted);
        }}
        title="Toggle sound"
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}

function Landing({ busy, error }: { busy: boolean; error?: string }) {
  const saved = HostController.savedSession();
  return (
    <div class="screen landing">
      <FolkBorder count={9} size={64} />
      <Logo size={2.1} />
      <p class="landing-sub">Party games for the whole sofa. One screen, everyone’s phones, zero installs.</p>
      <div class="landing-actions">
        <button class="btn btn-big btn-yolk" autofocus disabled={busy} onClick={() => controller.create()}>
          {busy ? 'Warming up the pierogi…' : 'Host a party'}
        </button>
        {saved && !busy && (
          <button class="btn btn-ghost" onClick={() => controller.resume(saved)}>
            Rejoin room {saved.code}
          </button>
        )}
      </div>
      {error && <p class="landing-error">{error}</p>}
      <div class="landing-games">
        {GAMES.map((g) => (
          <div class="landing-game">
            <GameIcon game={g.id} size={70} />
            <b>{g.title}</b>
            <span>{g.tagline}</span>
          </div>
        ))}
      </div>
      <FolkBorder count={9} size={64} />
    </div>
  );
}

function Lobby() {
  const c = controller;
  const players = c.summaries();
  const joinUrl = `${location.origin}/join?code=${c.code}`;
  const vip = players.find((p) => p.vip);
  const party = [...c.players.values()].filter((p) => p.party > 0).sort((a, b) => b.party - a.party);
  const enough = c.canStart();
  return (
    <div class="screen lobby">
      <div class="lobby-left">
        <Logo size={1.15} />
        <div class="join-card card-paper">
          <div class="join-steps">
            <div class="join-step-title">Join on your phone</div>
            <div class="join-qr">
              <QrCode text={joinUrl} size={300} />
            </div>
            <div class="join-url">
              or go to <b>{location.host}/join</b>
            </div>
          </div>
          <div class="join-code-label">Room code</div>
          <div class="join-code">
            {c.code.split('').map((ch, i) => (
              <span style={{ animationDelay: `${i * 90}ms` }}>{ch}</span>
            ))}
          </div>
        </div>
      </div>

      <div class="lobby-right">
        <div class="lobby-heading">
          <h2>
            Players <span class="muted">{players.length}/{MAX_PLAYERS}</span>
          </h2>
          {party.length > 0 && (
            <div class="party-mini">
              <span class="muted">Party standings</span>
              {party.slice(0, 4).map((p, i) => (
                <span class="party-mini-item" style={{ color: colorHex(p.color) }}>
                  {i === 0 ? '👑 ' : ''}
                  {p.name} {p.party}
                </span>
              ))}
            </div>
          )}
        </div>
        <div class="player-grid">
          {Array.from({ length: MAX_PLAYERS }, (_, i) => {
            const p = players[i];
            if (!p)
              return (
                <div class="player-slot empty" key={`e${i}`}>
                  <Pierogi color="rgba(255,244,220,.12)" size={92} mood="sleep" />
                  <span>{i === 0 ? 'First one in is the VIP!' : 'Waiting…'}</span>
                </div>
              );
            return (
              <div class={`player-slot ${p.connected ? '' : 'offline'}`} key={p.id} style={{ '--pc': colorHex(p.color) }}>
                {p.vip && <span class="vip-badge">VIP</span>}
                <Pierogi color={colorHex(p.color)} size={110} mood={p.connected ? 'happy' : 'sleep'} class="bob" />
                <span class="player-name">{p.name}</span>
                {!p.connected && <span class="player-status">reconnecting…</span>}
              </div>
            );
          })}
        </div>

        <div class="game-picker">
          {GAMES.map((g) => (
            <div class={`game-card ${g.id === c.selected ? 'selected' : ''}`} key={g.id}>
              <GameIcon game={g.id} size={84} />
              <div>
                <div class="game-card-title">{g.title}</div>
                <div class="game-card-tag">{g.tagline}</div>
                {g.maxPlayers && <div class="game-card-flag">Up to {g.maxPlayers} players</div>}
                {g.id === 'rally' && <div class="game-card-flag">{c.options.items ? 'Items on' : 'Items off'}</div>}
                {g.id === 'trails' && c.options.powerups && <div class="game-card-flag">Power-ups on</div>}
                {g.id === 'kitchen' && (
                  <div class="game-card-flag">
                    {difficultyName(c.options.difficulty)} · from level {c.options.level}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div class="lobby-hint">
          {!vip
            ? 'Scan the code to join – the first player becomes the VIP.'
            : !enough
              ? c.startProblem()
              : `${vip.name} (VIP) picks a game and presses Start on their phone.`}
        </div>
      </div>
    </div>
  );
}

const HOW_TO: Record<GameId, string[]> = {
  trails: [
    'Hold LEFT or RIGHT on your phone to steer your noodle.',
    'Hit a wall or any trail and you’re out. Slip through the little gaps!',
    'Each time someone crashes, everyone still alive gets a point.',
  ],
  quiz: [
    'Read the question on the TV.',
    'Tap the matching colour on your phone – faster answers score more.',
    'Up to 1000 points per question. 10 questions.',
  ],
  ballpark: [
    'Type your best guess for the number on your phone.',
    'Then bet on the guess you think is closest without going over.',
    'Win points for the best guess and for smart bets – edges pay more!',
  ],
  kitchen: [
    'Everyone cooks together! Walk your chef with the joystick on your phone.',
    'Press the big button to pick up, put down and use stations. Some jobs are a quick minigame on your phone.',
    'Serve the pierogi on the tickets before they run out. Three levels, up to 3 stars each!',
  ],
  rally: [
    'Hold your thumb on the pad on your phone: up is gas, down is brake, left and right steer.',
    'Drive through a ? box to grab an item, then lift your thumb for a moment to use it.',
    `${RACES} races of ${LAPS} laps on random tracks. 15 points for a win, 12 for second, and so on.`,
  ],
  toty: [
    'Take a selfie on your phone (or skip it and be a pierogi).',
    '“Who’s most likely to…?” Vote for a player. You score if you agree with the room.',
    'Twice a game, everyone doodles on the chosen player’s photo. Vote for the best one!',
  ],
};

function Intro({ game }: { game: GameId }) {
  const info = gameInfo(game);
  return (
    <div class="screen intro">
      <div class="intro-icon pop-in">
        <GameIcon game={game} size={220} />
      </div>
      <h1 class="intro-title">{info.title}</h1>
      <p class="intro-tag">{info.tagline}</p>
      <ol class="intro-steps">
        {HOW_TO[game].map((step, i) => (
          <li style={{ animationDelay: `${400 + i * 250}ms` }}>
            <span class="intro-num">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <div class="intro-bar">
        <div class="intro-bar-fill" />
      </div>
    </div>
  );
}

function Results({ game, standings }: { game: GameId; standings: Standing[] }) {
  const c = controller;
  const podium = [standings[1], standings[0], standings[2]].filter((x): x is Standing => !!x);
  const party = [...c.players.values()].sort((a, b) => b.party - a.party);
  const vip = c.summaries().find((p) => p.vip);
  return (
    <div class="screen results">
      <h1 class="results-title">{gameInfo(game).title} – final scores</h1>
      <div class="results-body">
        <div class="podium" style={{ gridTemplateColumns: `repeat(${Math.max(1, podium.length)}, minmax(0, 340px))` }}>
          {podium.map((st) => (
            <div class={`podium-col p${st.place}`} style={{ animationDelay: `${st.place === 1 ? 900 : st.place === 2 ? 400 : 0}ms` }}>
              <Pierogi color={colorHex(st.color)} size={st.place === 1 ? 170 : 130} mood="wow" class="bob" />
              <div class="podium-name">{st.name}</div>
              <div class="podium-score">{st.score.toLocaleString('en-US')}</div>
              <div class="podium-block" style={{ background: colorHex(st.color) }}>
                {st.place}
              </div>
            </div>
          ))}
        </div>
        <Confetti />
        <div class="results-side">
          {standings.length > 3 && (
            <div class="results-rest card-dark">
              {standings.slice(3).map((st) => (
                <div class="results-rest-row">
                  <span>{st.place}.</span>
                  <Pierogi color={colorHex(st.color)} size={40} />
                  <span class="grow">{st.name}</span>
                  <b>{st.score.toLocaleString('en-US')}</b>
                </div>
              ))}
            </div>
          )}
          <div class="party-table card-paper">
            <div class="party-title">Party standings</div>
            <div class="party-sub">3 points for a win, 2 for second, 1 for third</div>
            {party.map((p, i) => (
              <div class="party-row">
                <span class="party-rank">{i + 1}</span>
                <Pierogi color={colorHex(p.color)} size={44} />
                <span class="grow">{p.name}</span>
                <b>{p.party}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div class="lobby-hint">{vip ? `${vip.name} (VIP): “Play again” or pick another game on your phone.` : ''}</div>
    </div>
  );
}

const STAR_LINES = ['The kitchen is a disaster!', 'Not bad, chefs!', 'Babcia would be proud!', 'Michelin pierogi!'];

function CoopResults({ game, standings, coop }: { game: GameId; standings: Standing[]; coop: CoopResult }) {
  const c = controller;
  const party = [...c.players.values()].sort((a, b) => b.party - a.party);
  const vip = c.summaries().find((p) => p.vip);
  const crew = [...standings].sort((a, b) => b.score - a.score);
  return (
    <div class="screen results coop-results">
      <h1 class="results-title">{gameInfo(game).title} – service report</h1>
      <div class="results-body">
        <div class="coop-main">
          <Stars n={coop.stars} size={150} />
          <div class="coop-line">{STAR_LINES[coop.stars]}</div>
          <div class="coop-stats">
            <div>
              <b>{coop.score.toLocaleString('en-US')}</b>
              <small>team tips</small>
            </div>
            <div>
              <b>{coop.served}</b>
              <small>orders served</small>
            </div>
            <div>
              <b>{coop.missed}</b>
              <small>orders missed</small>
            </div>
          </div>
          {coop.levels && coop.levels.length > 1 && (
            <div class="coop-levels">
              {coop.levels.map((l) => (
                <div class="coop-level">
                  <b>{l.name}</b>
                  <Stars n={l.stars} size={34} />
                  <span class="muted">{l.score.toLocaleString('en-US')} tips</span>
                </div>
              ))}
            </div>
          )}
          <div class="coop-crew">
            {crew.map((st) => (
              <div class="coop-chef">
                <Pierogi color={colorHex(st.color)} size={86} mood={coop.stars >= 2 ? 'wow' : 'happy'} class="bob" />
                <span class="coop-chef-name">{st.name}</span>
                <span class="muted">{st.score} {st.score === 1 ? 'job' : 'jobs'}</span>
              </div>
            ))}
          </div>
        </div>
        {coop.stars > 0 && <Confetti />}
        <div class="results-side">
          <div class="party-table card-paper">
            <div class="party-title">Party standings</div>
            <div class="party-sub">Co-op: everyone gets 1 point per star (average over the levels)</div>
            {party.map((p, i) => (
              <div class="party-row">
                <span class="party-rank">{i + 1}</span>
                <Pierogi color={colorHex(p.color)} size={44} />
                <span class="grow">{p.name}</span>
                <b>{p.party}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div class="lobby-hint">{vip ? `${vip.name} (VIP): “Play again” or pick another game on your phone.` : ''}</div>
    </div>
  );
}

const CONFETTI_COLORS = ['#ff3d6e', '#ffd23f', '#2fd6a8', '#4f9dff', '#b27bff', '#ff8a2a', '#fff4dc'];
const CONFETTI = Array.from({ length: 70 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 40) / 10,
  dur: 3.5 + ((i * 29) % 30) / 10,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  size: 10 + ((i * 17) % 14),
  round: i % 3 === 0,
}));

/** Falling paper confetti for the podium. */
function Confetti() {
  return (
    <div class="confetti" aria-hidden="true">
      {CONFETTI.map((c) => (
        <i
          style={{
            left: `${c.left}%`,
            width: c.size,
            height: c.round ? c.size : c.size * 0.45,
            background: c.color,
            borderRadius: c.round ? '50%' : '2px',
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.dur}s`,
          }}
        />
      ))}
    </div>
  );
}
