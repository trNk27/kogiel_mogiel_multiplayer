import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { GAMES, MAX_PLAYERS, TOURNAMENT_GAMES, TOURNAMENT_POINTS, colorHex, difficultyName, gameInfo, rallyTrack, type GameId, type Selection } from '../../../shared/protocol';
import { FolkBorder, Logo, Pierogi, Rosette } from '../lib/art';
import { QrCode } from '../lib/qr';
import { sound } from '../lib/sound';
import { HostController, type Standing } from './controller';
import type { CoopResult } from '../games/types';
import { Stars } from '../lib/stars';
import { GameIcon } from './GameIcon';
import { RACES, RACES_SHORT } from '../games/rally/RallyGame';
import { LAPS } from '../games/rally/sim';
import { QUIZ_ROUND_LENGTH, QUIZ_ROUND_LENGTH_SHORT } from '../games/quiz/logic';
import { BP_QUESTIONS_PER_GAME, BP_QUESTIONS_SHORT } from '../games/ballpark/logic';
import { PEDAL_GOAL, PEDAL_HEATS, PEDAL_HEATS_SHORT } from '../games/pedal/logic';
import { FORK_ROUNDS, FORK_ROUNDS_SHORT } from '../games/fork/logic';
import { PARADE_ROUNDS, PARADE_ROUNDS_SHORT } from '../games/parade/logic';
import { TY_FULL, TY_SHORT } from '../games/toty/logic';

const controller = new HostController();
const params = new URLSearchParams(location.search);
// For automated tests: /?debug exposes the room (e.g. `host.finish({...})` ends the current game).
if (params.has('debug')) (window as unknown as { host: HostController }).host = controller;

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
    case 'tourIntro':
      body = <TourIntro />;
      break;
    case 'tourEnd':
      body = <TourEnd standings={s.standings} games={s.games} />;
      break;
    case 'game':
      body = c.game?.render();
      break;
    case 'results':
      body = s.coop ? (
        <CoopResults game={s.game} standings={s.standings} coop={s.coop} />
      ) : c.tournament ? (
        <TourResults game={s.game} standings={s.standings} />
      ) : (
        <Results game={s.game} standings={s.standings} />
      );
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
      <Logo size={1.75} />
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
      <p class="landing-notv">
        No TV? Open <b>{location.host}</b> on your phone and tap <b>Play without a TV</b> – every phone shows the race itself.
      </p>
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
          {(['tournament', ...GAMES.map((g) => g.id)] as Selection[]).map((id) => (
            <div class={`game-card ${id === 'tournament' ? 'tour' : ''} ${id === c.selected ? 'selected' : ''}`} key={id}>
              <GameIcon game={id} size={64} />
              <div class="game-card-title">{id === 'tournament' ? 'Tournament' : gameInfo(id).title}</div>
            </div>
          ))}
        </div>
        <SelectedGame sel={c.selected} />
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

/** The selected game's tagline and settings, under the game picker. */
function SelectedGame({ sel }: { sel: Selection }) {
  const o = controller.options;
  if (sel === 'tournament')
    return (
      <div class="game-detail">
        <b>Tournament</b>
        <span>{TOURNAMENT_GAMES} random games in a row, short versions, no co-op. Win games, collect points, take the crown.</span>
      </div>
    );
  const g = gameInfo(sel);
  const flags: string[] = [];
  if (g.maxPlayers) flags.push(`Up to ${g.maxPlayers} players`);
  if (g.coop) flags.push('Co-op');
  if (sel === 'rally') flags.push(`${rallyTrack(o.track).name} · ${o.items ? 'items on' : 'items off'}`);
  if (sel === 'trails' && o.powerups) flags.push('Power-ups on');
  if (sel === 'kitchen') flags.push(`${difficultyName(o.difficulty)} · from level ${o.level}`);
  return (
    <div class="game-detail">
      <b>{g.title}</b>
      <span>{g.tagline}</span>
      {flags.map((f) => (
        <span class="game-card-flag">{f}</span>
      ))}
    </div>
  );
}

/** How to play, for the intro screen. Tournaments play the short versions. */
function howTo(game: GameId, short: boolean): string[] {
  switch (game) {
    case 'quiz':
      return [
        'Read the question on the TV.',
        'Tap the matching colour on your phone – faster answers score more.',
        `Up to 1000 points per question. ${short ? QUIZ_ROUND_LENGTH_SHORT : QUIZ_ROUND_LENGTH} questions.`,
      ];
    case 'ballpark':
      return [
        'Type your best guess for the number on your phone.',
        'Then bet on the guess you think is closest without going over.',
        `Win points for the best guess and for smart bets – edges pay more! ${short ? BP_QUESTIONS_SHORT : BP_QUESTIONS_PER_GAME} questions.`,
      ];
    case 'rally': {
      const races = short ? RACES_SHORT : RACES;
      return [
        HOW_TO.rally[0],
        HOW_TO.rally[1],
        `${races === 1 ? 'One race' : `${races} races`} of ${LAPS} laps on ${races === 1 ? 'a random track' : 'random tracks'} with bridges and tunnels. 15 points for a win, 12 for second, and so on.`,
      ];
    }
    case 'trails':
      return short ? [...HOW_TO.trails.slice(0, 2), 'Each time someone crashes, everyone still alive gets a point. Short game: first to 5 per opponent!'] : HOW_TO.trails;
    case 'toty': {
      const l = short ? TY_SHORT : TY_FULL;
      return [
        HOW_TO.toty[0],
        `${l.questions} “Who’s most likely to…?” questions. Vote for a player – you score if you agree with the room.`,
        l.doodleAfter.length === 1 ? 'Once, everyone doodles on the chosen player’s photo. Vote for the best one!' : HOW_TO.toty[2],
      ];
    }
    case 'pedal': {
      const heats = short ? PEDAL_HEATS_SHORT : PEDAL_HEATS;
      return [
        'Your phone has two pedals. Tap LEFT, RIGHT, LEFT, RIGHT… as fast as you can.',
        `Only alternating taps count! ${PEDAL_GOAL} strokes to the finish line.`,
        heats === 1 ? 'One heat – first across the line wins.' : `${heats} heats: 10 points for a win, 8 for second, and so on.`,
      ];
    }
    case 'fork': {
      const rounds = short ? FORK_ROUNDS_SHORT : FORK_ROUNDS;
      return [
        'Watch the plate on your phone. When a pierogi lands on it, tap to stab it – fast!',
        'Socks, slippers and rubber ducks land too. Stab one (or stab too early) and you lose a point.',
        `${rounds} rounds. The fastest fork gets 3 points, then 2, then 1.`,
      ];
    }
    case 'parade': {
      const rounds = short ? PARADE_ROUNDS_SHORT : PARADE_ROUNDS;
      return [
        'Pierogi of every colour march across the TV.',
        'Tap your phone once for every pierogi of the colour you’re told to count – and ignore the rest.',
        `${rounds === 1 ? 'One round' : `${rounds} rounds, each busier than the last`}. Exactly right: 10 points, 1 off: 6, 2 off: 3, 3 off: 1.`,
      ];
    }
    default:
      return HOW_TO[game];
  }
}

const HOW_TO: Record<'trails' | 'kitchen' | 'rally' | 'toty', string[]> = {
  trails: [
    'Hold LEFT or RIGHT on your phone to steer your noodle.',
    'Hit a wall or any trail and you’re out. Slip through the little gaps!',
    'Each time someone crashes, everyone still alive gets a point.',
  ],
  kitchen: [
    'Everyone cooks together! Walk your chef with the joystick on your phone.',
    'Press the big button to pick up, put down and use stations. Some jobs are a quick minigame on your phone.',
    'Serve the pierogi on the tickets before they run out. Three levels, up to 3 stars each!',
  ],
  rally: [
    'GAS and BRAKE are at the top of your phone; swipe the wheel below left and right to steer.',
    'Hold BRAKE while turning to drift, and let go when the sparks show for a turbo. Tap the item button to use an item.',
    `${RACES} races of ${LAPS} laps on random tracks with bridges and tunnels. 15 points for a win, 12 for second, and so on.`,
  ],
  toty: [
    'Take a selfie on your phone (or skip it and be a pierogi).',
    '“Who’s most likely to…?” Vote for a player. You score if you agree with the room.',
    'Twice a game, everyone doodles on the chosen player’s photo. Vote for the best one!',
  ],
};

function Intro({ game }: { game: GameId }) {
  const info = gameInfo(game);
  const t = controller.tournament;
  return (
    <div class="screen intro">
      {t && (
        <div class="intro-tour">
          🏆 Tournament · game {t.index + 1} of {t.games.length} · short version
        </div>
      )}
      <div class="intro-icon pop-in">
        <GameIcon game={game} size={220} />
      </div>
      <h1 class="intro-title">{info.title}</h1>
      {/* Taglines name the full game's length; in a tournament the steps say how long it is. */}
      {!t && <p class="intro-tag">{info.tagline}</p>}
      <ol class={`intro-steps ${t ? 'short' : ''}`}>
        {howTo(game, !!t).map((step, i) => (
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

function Podium({ standings, unit = '' }: { standings: Standing[]; unit?: string }) {
  const podium = [standings[1], standings[0], standings[2]].filter((x): x is Standing => !!x);
  return (
    <div class="podium" style={{ gridTemplateColumns: `repeat(${Math.max(1, podium.length)}, minmax(0, 340px))` }}>
      {podium.map((st) => (
        <div class={`podium-col p${st.place}`} style={{ animationDelay: `${st.place === 1 ? 900 : st.place === 2 ? 400 : 0}ms` }}>
          <Pierogi color={colorHex(st.color)} size={st.place === 1 ? 170 : 130} mood="wow" class="bob" />
          <div class="podium-name">{st.name}</div>
          <div class="podium-score">
            {st.score.toLocaleString('en-US')}
            {unit}
          </div>
          <div class="podium-block" style={{ background: colorHex(st.color) }}>
            {st.place}
          </div>
        </div>
      ))}
    </div>
  );
}

function RestOfField({ standings, unit = '' }: { standings: Standing[]; unit?: string }) {
  if (standings.length <= 3) return null;
  return (
    <div class="results-rest card-dark">
      {standings.slice(3).map((st) => (
        <div class="results-rest-row">
          <span>{st.place}.</span>
          <Pierogi color={colorHex(st.color)} size={40} />
          <span class="grow">{st.name}</span>
          <b>
            {st.score.toLocaleString('en-US')}
            {unit}
          </b>
        </div>
      ))}
    </div>
  );
}

function PartyTable({ sub }: { sub: string }) {
  const party = [...controller.players.values()].sort((a, b) => b.party - a.party);
  return (
    <div class="party-table card-paper">
      <div class="party-title">Party standings</div>
      <div class="party-sub">{sub}</div>
      {party.map((p, i) => (
        <div class="party-row">
          <span class="party-rank">{i + 1}</span>
          <Pierogi color={colorHex(p.color)} size={44} />
          <span class="grow">{p.name}</span>
          <b>{p.party}</b>
        </div>
      ))}
    </div>
  );
}

function Results({ game, standings }: { game: GameId; standings: Standing[] }) {
  const vip = controller.summaries().find((p) => p.vip);
  return (
    <div class="screen results">
      <h1 class="results-title">{gameInfo(game).title} – final scores</h1>
      <div class="results-body">
        <Podium standings={standings} />
        <Confetti />
        <div class="results-side">
          <RestOfField standings={standings} />
          <PartyTable sub="3 points for a win, 2 for second, 1 for third" />
        </div>
      </div>
      <div class="lobby-hint">{vip ? `${vip.name} (VIP): “Play again” or pick another game on your phone.` : ''}</div>
    </div>
  );
}

// ---- Tournament ---------------------------------------------------------------

/** The tournament's games in a row: played ones ticked, the current one highlighted. */
function Lineup({ games, current, done, compact }: { games: GameId[]; current: number; done: number; compact?: boolean }) {
  return (
    <div class={`tour-lineup ${compact ? 'compact' : ''}`}>
      {games.map((g, i) => (
        <div class={`tour-slot ${i < done ? 'done' : ''} ${i === current ? 'now' : ''}`} style={{ animationDelay: `${compact ? 0 : 300 + i * 450}ms` }}>
          <span class="tour-slot-num">{i < done && i !== current ? '✓' : i + 1}</span>
          <GameIcon game={g} size={compact ? 40 : i === current ? 96 : 76} />
          <b>{gameInfo(g).title}</b>
        </div>
      ))}
    </div>
  );
}

function TourIntro() {
  const t = controller.tournament;
  if (!t) return null;
  return (
    <div class="screen intro tour-intro">
      <div class="intro-icon pop-in">
        <GameIcon game="tournament" size={180} />
      </div>
      <h1 class="intro-title">Tournament!</h1>
      <p class="intro-tag">
        {t.games.length} quick games. Points for every game: {TOURNAMENT_POINTS.filter((p) => p > 0).join(' / ')} for 1st, 2nd, 3rd…
      </p>
      <Lineup games={t.games} current={-1} done={0} />
      <div class="intro-bar">
        <div class="intro-bar-fill" style={{ animationDuration: '9s' }} />
      </div>
    </div>
  );
}

/** The tournament points table, with what each player just earned. */
function TourTable({ title }: { title: string }) {
  const t = controller.tournament;
  if (!t) return null;
  const rows = [...controller.players.values()].map((p) => ({ p, pts: t.points[p.id] ?? 0, gained: t.gained[p.id] ?? 0 })).sort((a, b) => b.pts - a.pts);
  return (
    <div class="party-table card-paper">
      <div class="party-title">{title}</div>
      <div class="party-sub">
        {TOURNAMENT_POINTS.filter((p) => p > 0).join(' / ')} points for 1st, 2nd, 3rd… in each game
      </div>
      {rows.map(({ p, pts, gained }) => (
        <div class="party-row">
          <span class="party-rank">{1 + rows.filter((o) => o.pts > pts).length}</span>
          <Pierogi color={colorHex(p.color)} size={44} />
          <span class="grow">{p.name}</span>
          {gained > 0 && <span class="tour-gain">+{gained}</span>}
          <b>{pts}</b>
        </div>
      ))}
    </div>
  );
}

function TourResults({ game, standings }: { game: GameId; standings: Standing[] }) {
  const t = controller.tournament!;
  const vip = controller.summaries().find((p) => p.vip);
  const next = t.games[t.index + 1];
  return (
    <div class="screen results tour-results">
      <h1 class="results-title">
        {gameInfo(game).title} – game {t.index + 1} of {t.games.length}
      </h1>
      <Lineup games={t.games} current={t.index} done={t.index + 1} compact />
      <div class="results-body">
        <Podium standings={standings} />
        <Confetti />
        <div class="results-side">
          <RestOfField standings={standings} />
          <TourTable title="Tournament" />
        </div>
      </div>
      <div class="lobby-hint">
        {vip ? (next ? `${vip.name} (VIP): press “Next game” for ${gameInfo(next).title}.` : `${vip.name} (VIP): press “Crown the champion”!`) : ''}
      </div>
    </div>
  );
}

function TourEnd({ standings, games }: { standings: Standing[]; games: GameId[] }) {
  const vip = controller.summaries().find((p) => p.vip);
  const champs = standings.filter((st) => st.place === 1);
  return (
    <div class="screen results tour-end">
      <h1 class="results-title">
        🏆 {champs.map((c) => c.name).join(' & ')} {champs.length > 1 ? 'share' : 'wins'} the tournament!
      </h1>
      <Lineup games={games} current={-1} done={games.length} compact />
      <div class="results-body">
        <Podium standings={standings} unit=" pts" />
        <Confetti />
        <div class="results-side">
          <RestOfField standings={standings} unit=" pts" />
          <PartyTable sub="The tournament counts as one game: 3 / 2 / 1 party points" />
        </div>
      </div>
      <div class="lobby-hint">{vip ? `${vip.name} (VIP): another tournament, or pick a game on your phone.` : ''}</div>
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
