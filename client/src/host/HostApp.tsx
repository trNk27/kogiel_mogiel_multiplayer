import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { GAMES, MAX_PLAYERS, TOURNAMENT_GAMES, TOURNAMENT_POINTS, colorHex, difficultyName, gameInfo, rallyTrack, type GameId, type Selection } from '../../../shared/protocol';
import { FolkBorder, Logo, Pierogi } from '../lib/art';
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
import { howTo as tanksHowTo } from '../games/tanks/logic';
import { howTo as mushroomHowTo } from '../games/mushroom/logic';
import { howTo as pushyHowTo } from '../games/pushy/logic';
import { howTo as galleryHowTo } from '../games/gallery/logic';
import { howTo as cookbookHowTo } from '../games/cookbook/logic';
import { howTo as tilesHowTo } from '../games/tiles/logic';

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
      <FolkBorder count={9} size={52} />
      <Logo size={1.5} />
      <p class="landing-sub">One screen · everyone’s phones · no installs</p>
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
        No TV? Open <b>{location.host}</b> on a phone → <b>Play without a TV</b>
      </p>
      <div class="landing-games">
        {GAMES.map((g) => (
          <div class="landing-game">
            <GameIcon game={g.id} size={84} />
            <b>{g.title}</b>
          </div>
        ))}
      </div>
      <FolkBorder count={9} size={52} />
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
            <div class="join-step-title">Scan to join</div>
            <div class="join-qr">
              <QrCode text={joinUrl} size={300} />
            </div>
            <div class="join-url">
              <b>{location.host}/join</b>
            </div>
          </div>
          <div class="join-code-label eyebrow">Room code</div>
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
              <span class="eyebrow">Standings</span>
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
                  {i === 0 && <span>First in = VIP</span>}
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
            ? 'Scan the code to join'
            : !enough
              ? c.startProblem()
              : `${vip.name} picks on their phone`}
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
        <span>{TOURNAMENT_GAMES} random games · short versions</span>
      </div>
    );
  const g = gameInfo(sel);
  const flags: string[] = [];
  if (g.maxPlayers) flags.push(`Up to ${g.maxPlayers} players`);
  if (g.coop) flags.push('Co-op');
  if (sel === 'rally') flags.push(`${rallyTrack(o.track).name} · ${o.items ? 'items' : 'no items'}`);
  if (sel === 'trails' && o.powerups) flags.push('Power-ups');
  if (sel === 'kitchen') flags.push(`${difficultyName(o.difficulty)} · level ${o.level}`);
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

/** How to play, for the intro screen: three short lines. Tournaments play the short versions. */
function howTo(game: GameId, short: boolean): string[] {
  const n = (k: number, one: string, many: string) => (k === 1 ? one : `${k} ${many}`);
  switch (game) {
    case 'quiz':
      return ['Tap the colour of the right answer', 'Faster answers score more', `${short ? QUIZ_ROUND_LENGTH_SHORT : QUIZ_ROUND_LENGTH} questions · up to 1000 each`];
    case 'ballpark':
      return ['Guess the number', 'Bet on the closest guess – without going over', `Edges pay more · ${short ? BP_QUESTIONS_SHORT : BP_QUESTIONS_PER_GAME} questions`];
    case 'rally':
      return ['Thumb on the pad: up is gas, down is brake', 'Brake into a turn to drift, let go for a turbo', `Lift your thumb to use an item · ${n(short ? RACES_SHORT : RACES, 'one race', 'races')} of ${LAPS} laps`];
    case 'trails':
      return ['Hold LEFT or RIGHT to steer', 'Touch anything and you’re out', short ? 'Outlive the others · first to 5 per rival' : 'Outlive the others to score'];
    case 'kitchen':
      return ['Joystick to walk, big button for everything', 'Roll, fill, boil, plate, serve', 'Beat the tickets · up to ★★★ per level'];
    case 'toty': {
      const l = short ? TY_SHORT : TY_FULL;
      return ['Snap a selfie – or be a pierogi', `${l.questions} × “Who’s most likely to…?” – vote with the room`, l.doodleAfter.length === 1 ? 'Doodle on the winner, vote for the best' : 'Twice: doodle on the winner, vote for the best'];
    }
    case 'bazgroly':
      return ['Draw your secret prompt', 'Make up a fake title for every drawing', 'Spot the real one · fool the rest'];
    case 'pedal':
      return ['Tap LEFT, RIGHT, LEFT, RIGHT…', 'The same side twice doesn’t count', n(short ? PEDAL_HEATS_SHORT : PEDAL_HEATS, 'One heat – first over the line wins', `heats of ${PEDAL_GOAL} strokes`)];
    case 'fork':
      return ['A pierogi lands – stab it!', 'Sock, slipper or duck? Hands off', `${short ? FORK_ROUNDS_SHORT : FORK_ROUNDS} rounds · fastest fork wins`];
    case 'parade':
      return ['Count only the colour on your phone', 'One tap per pierogi', `Spot on = 10 points · ${n(short ? PARADE_ROUNDS_SHORT : PARADE_ROUNDS, 'one round', 'rounds')}`];
    case 'tanks':
      return tanksHowTo(short);
    case 'mushroom':
      return mushroomHowTo(short);
    case 'pushy':
      return pushyHowTo(short);
    case 'gallery':
      return galleryHowTo(short);
    case 'cookbook':
      return cookbookHowTo(short);
    case 'tiles':
      return tilesHowTo(short);
  }
}

function Intro({ game }: { game: GameId }) {
  const info = gameInfo(game);
  const t = controller.tournament;
  return (
    <div class="screen intro">
      {t && (
        <div class="intro-tour">
          🏆 {t.index + 1} / {t.games.length}
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
          <li style={{ animationDelay: `${400 + i * 200}ms` }}>
            <span class="intro-num">{i + 1}</span>
            <span>{step}</span>
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
          <span class="party-rank">{st.place}</span>
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
      <h1 class="results-title">
        <GameIcon game={game} size={88} />
        {gameInfo(game).title}
      </h1>
      <div class="results-body">
        <Podium standings={standings} />
        <Confetti />
        <div class="results-side">
          <RestOfField standings={standings} />
          <PartyTable sub="3 · 2 · 1 per game" />
        </div>
      </div>
      <div class="lobby-hint">{vip ? `${vip.name} picks what’s next` : ''}</div>
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
        {t.games.length} quick games · {TOURNAMENT_POINTS.filter((p) => p > 0).join(' · ')} points
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
      <div class="party-sub">{TOURNAMENT_POINTS.filter((p) => p > 0).join(' · ')} per game</div>
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
        <GameIcon game={game} size={88} />
        {gameInfo(game).title}
        <span class="results-count">
          {t.index + 1} / {t.games.length}
        </span>
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
        {vip ? (next ? `Next up: ${gameInfo(next).title}` : 'Time to crown the champion') : ''}
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
          <PartyTable sub="The tournament counts as one game" />
        </div>
      </div>
      <div class="lobby-hint">{vip ? `${vip.name} picks what’s next` : ''}</div>
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
      <h1 class="results-title">
        <GameIcon game={game} size={88} />
        {gameInfo(game).title}
      </h1>
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
            <div class="party-sub">1 point per ★ for everyone</div>
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
      <div class="lobby-hint">{vip ? `${vip.name} picks what’s next` : ''}</div>
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
