import spectra from '../../../../data/wave.json';
import { colorHex, type AskView, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { usedSet } from '../usedStore';
import { Leaderboard, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { BANDS, NO_CLUE, WAVE_CLUE_MAX, WAVE_CLUE_MS, WAVE_GUESS_MS, WaveMatch, pointsFor, type Spectrum } from './logic';
import { BAND_COLORS, dialStrokes, markerTiers, pointAt, slicePath } from './dial';
import './wave.css';

const POOL = spectra as Spectrum[];
const used = usedSet('wave');

/** "Round 2 – Kasia is the Psychic". */
const INTRO_MS = 3800;
/** The phone hands in a typed clue just before the deadline; give it time to arrive. */
const CLUE_GRACE_MS = 2000;
/** Pause after the last answer before moving on. */
const SETTLE_MS = 1000;
/** The dial opens, the markers swing in, then the points show. */
const REVEAL_MS = 9000;
const SHOW_POINTS_MS = 4200;
const SCORES_MS = 6500;
const ACCENT = '#4f9dff';

// TV dial geometry (SVG user units = px).
const W = 1100;
const H = 560;
const CX = W / 2;
const CY = 525;
const R = 490;

export class WaveGame implements Game {
  readonly id = 'wave' as const;
  private m: WaveMatch;
  private timer: number | undefined;
  private fx: number[] = [];
  private endsAt = 0;
  /** In the reveal: the points are out (phones show them, chips show gains). */
  private pointsOut = false;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.m = new WaveMatch(ids, { short: host.short, pool: POOL, used });
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, WaveGame>).wave = this;
    this.next();
  }

  dispose() {
    clearTimeout(this.timer);
    this.clearFx();
  }

  private clearFx() {
    for (const t of this.fx) clearTimeout(t);
    this.fx = [];
  }

  private after(ms: number, fn: () => void) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(fn, ms);
  }

  private later(ms: number, fn: () => void) {
    this.fx.push(window.setTimeout(fn, ms));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private name(id: string) {
    return this.host.player(id)?.name ?? '?';
  }

  private connected = (id: string) => !!this.host.player(id)?.connected;

  // ---- flow -----------------------------------------------------------------------

  /** The next round's intro, or the end. */
  private next() {
    this.clearFx();
    this.pointsOut = false;
    if (this.m.nextRound() === 'over') {
      this.finish();
      return;
    }
    sound.whoosh();
    this.endsAt = Date.now() + INTRO_MS;
    this.after(INTRO_MS, () => this.startClue());
    this.update();
  }

  private finish() {
    clearTimeout(this.timer);
    this.clearFx();
    this.ids = [...this.m.ids];
    this.host.finish({ ...this.m.scores });
  }

  private startClue() {
    if (this.m.phase !== 'intro') return;
    this.m.advance();
    this.endsAt = Date.now() + WAVE_CLUE_MS;
    sound.reveal();
    this.host.buzz(this.m.psychic, [80, 60, 80]);
    this.after(WAVE_CLUE_MS + CLUE_GRACE_MS, () => this.startGuess());
    this.update();
  }

  private startGuess() {
    if (this.m.phase !== 'clue') return;
    this.m.advance();
    this.endsAt = Date.now() + WAVE_GUESS_MS;
    sound.whoosh();
    this.after(WAVE_GUESS_MS, () => this.startReveal());
    this.update();
  }

  private startReveal() {
    if (this.m.phase !== 'guess') return;
    this.m.advance();
    const result = this.m.result!;
    sound.drumroll(1.1);
    const guessers = Object.keys(result.guesses);
    guessers.forEach((_, i) => this.later(2100 + i * 260, () => sound.plop()));
    this.later(SHOW_POINTS_MS, () => {
      this.pointsOut = true;
      const best = Math.max(0, ...guessers.map((id) => result.points[id] ?? 0));
      if (best >= 4) sound.fanfare();
      else if (best > 0) sound.correct();
      else sound.wrong();
      for (const [id, pts] of Object.entries(result.points)) if (pts > 0) this.host.buzz(id, [60, 60, 60]);
      this.update();
    });
    this.after(REVEAL_MS, () => this.showScores());
    this.update();
  }

  private showScores() {
    if (this.m.phase !== 'reveal') return;
    this.m.advance();
    this.pointsOut = true;
    sound.whoosh();
    this.after(SCORES_MS, () => this.next());
    this.update();
  }

  private maybeAdvance() {
    if (this.m.phase === 'clue' && this.m.clue !== null) this.after(SETTLE_MS, () => this.startGuess());
    else if (this.m.phase === 'guess' && this.m.allGuessed(this.connected)) this.after(SETTLE_MS, () => this.startReveal());
  }

  // ---- phones ---------------------------------------------------------------------

  onMessage(id: string, msg: PhoneMsg) {
    if (msg.t !== 'ask' || !this.m.ids.includes(id)) return;
    let res;
    if (this.m.phase === 'clue') {
      res = this.m.submitClue(id, msg.key, msg.text);
      if (res === 'rejected') {
        this.host.buzz(id, [200]);
        this.host.refresh(id);
        return;
      }
    } else if (this.m.phase === 'guess') {
      res = this.m.submitGuess(id, msg.key, msg.n);
    }
    if (res !== 'ok') return;
    sound.lockIn();
    this.update();
    this.maybeAdvance();
  }

  onConnection() {
    this.maybeAdvance();
    this.host.changed();
  }

  onRemoved(id: string) {
    const { aborted } = this.m.remove(id);
    this.ids = [...this.m.ids];
    if (this.m.ids.length < 2) {
      this.finish();
      return;
    }
    if (aborted) this.next();
    else this.onConnection();
  }

  private ask(id: string, v: Omit<AskView, 'v' | 'game' | 'key' | 'note' | 'score'>): AskView {
    return {
      v: 'ask',
      game: 'wave',
      key: this.m.key,
      note: `Round ${this.m.ri + 1} / ${this.m.rounds}`,
      score: (this.m.scores[id] ?? 0) - (this.m.phase === 'reveal' && !this.pointsOut ? this.m.result?.points[id] ?? 0 : 0),
      accent: ACCENT,
      ...v,
    };
  }

  viewFor(id: string): PhoneView {
    const m = this.m;
    if (!m.ids.includes(id)) return { v: 'wait', title: 'Watch the TV!', icon: 'wave' };
    const sp = m.spectrum;
    const ends = `${sp.left} ⟷ ${sp.right}`;
    const psychic = id === m.psychic;
    const pName = this.name(m.psychic);
    switch (m.phase) {
      case 'intro':
        return this.ask(id, psychic ? { title: 'You’re the Psychic!', text: 'Get ready to give a clue…', input: { k: 'none', mood: 'wow' } } : { title: `${pName} is the Psychic`, text: 'Get ready to read their mind…', input: { k: 'none', mood: 'happy' } });
      case 'clue':
        if (psychic)
          return this.ask(id, {
            title: `Target: ${m.target}`,
            text: `${ends} · give a clue that sits right there (no numbers!)`,
            pic: dialStrokes(m.target),
            endsAt: this.endsAt,
            input: { k: 'text', max: WAVE_CLUE_MAX, placeholder: 'e.g. Bigos on the stove', sent: m.clue, button: 'Send clue', ...(m.clueError ? { error: m.clueError } : {}) },
          });
        return this.ask(id, { title: `${pName} is thinking of a clue…`, text: ends, endsAt: this.endsAt, input: { k: 'none', mood: 'sleep' } });
      case 'guess':
        if (psychic)
          return this.ask(id, {
            title: `“${m.clue}”`,
            text: `Target ${m.target} · ${m.guesses.size} / ${m.guessers.length} locked in. No hints!`,
            endsAt: this.endsAt,
            input: { k: 'none', mood: 'wow' },
          });
        return this.ask(id, {
          title: m.clue === NO_CLUE ? `${pName} gave no clue – guess!` : `“${m.clue}”`,
          text: `Where does it sit between ${sp.left} and ${sp.right}?`,
          endsAt: this.endsAt,
          input: { k: 'slider', min: 0, max: 100, step: 1, start: 50, left: `← ${sp.left}`, right: `${sp.right} →`, sent: m.guesses.get(id) ?? null, button: 'Lock in' },
        });
      case 'reveal':
      case 'scores': {
        const r = m.result;
        if (!r || !this.pointsOut) return this.ask(id, { title: 'Look at the TV!', text: 'The dial is opening…', input: { k: 'none', mood: 'wow' } });
        const pts = r.points[id] ?? 0;
        if (psychic) {
          const n = Object.keys(r.guesses).length;
          return this.ask(id, {
            title: n ? `Your readers averaged ${pts}` : 'Nobody guessed!',
            text: `Target was ${r.target}`,
            input: { k: 'none', big: `+${pts}`, good: pts > 0, mood: pts >= 3 ? 'wow' : pts > 0 ? 'happy' : 'dead' },
          });
        }
        const g = r.guesses[id];
        if (g === undefined) return this.ask(id, { title: 'You didn’t lock in!', text: `Target was ${r.target}`, input: { k: 'none', big: '+0', good: false, mood: 'sleep' } });
        const d = Math.abs(g - r.target);
        return this.ask(id, {
          title: d === 0 ? 'Bullseye!' : `${d} off`,
          text: `You said ${g}, target was ${r.target}`,
          input: { k: 'none', big: `+${pts}`, good: pts > 0, mood: pts >= 3 ? 'wow' : pts > 0 ? 'happy' : 'dead' },
        });
      }
      case 'over':
        return { v: 'wait', title: 'That’s the last wave!', text: 'Final scores coming up.', icon: 'wave' };
    }
  }

  // ---- debug (window.wave with ?debug) --------------------------------------------

  /** Hand in a clue for the Psychic. */
  debugClue(text = 'Bigos on the stove') {
    this.onMessage(this.m.psychic, { t: 'ask', key: this.m.key, text });
  }

  /** Every guesser locks in somewhere near (or far from) the target. */
  debugGuesses(spread = 15) {
    for (const id of this.m.guessers) this.onMessage(id, { t: 'ask', key: this.m.key, n: Math.round(this.m.target + (Math.random() * 2 - 1) * spread) });
  }

  get match() {
    return this.m;
  }

  // ---- TV -------------------------------------------------------------------------

  render() {
    const m = this.m;
    const players = m.ids.map((id) => this.host.player(id)).filter((p) => !!p);
    if (m.phase === 'over') return <div class="screen wv" />;

    if (m.phase === 'scores') {
      const r = m.result;
      return (
        <div class="screen bp-scores wv-scores" key={`s${m.ri}`}>
          <h2 class="screen-title">{m.isLast ? 'Final scores' : `Scores after round ${m.ri + 1} / ${m.rounds}`}</h2>
          <Leaderboard rows={players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: m.scores[p.id] ?? 0, delta: r?.points[p.id], note: p.id === m.psychic ? 'Psychic' : '' }))} />
          {!m.isLast && <p class="wv-next">Next Psychic: {this.name(m.plan[m.ri + 1])}</p>}
        </div>
      );
    }

    const psychic = this.host.player(m.psychic);
    const pColor = colorHex(psychic?.color ?? 'yolk');

    if (m.phase === 'intro') {
      return (
        <div class="screen wv wv-intro" key={`i${m.ri}`}>
          <div class="wv-intro-card card-paper pop-in">
            <div class="wv-intro-round">
              Round {m.ri + 1} / {m.rounds}
            </div>
            <Pierogi color={pColor} size={220} mood="wow" class="bob" />
            <div class="wv-intro-name" style={{ color: pColor }}>
              {psychic?.name ?? '?'}
            </div>
            <div class="wv-intro-role">is the Psychic</div>
            <div class="wv-intro-hint">Everyone else: read their mind and find the spot</div>
          </div>
          {this.chips()}
        </div>
      );
    }

    const timer = (total: number) => <TimerRing key={`${m.phase}${m.ri}`} endsAt={this.endsAt} total={total} size={130} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />;
    const sp = m.spectrum;
    return (
      <div class={`screen wv wv-ph-${m.phase}`} key={`p${m.ri}`}>
        <div class="quiz-top">
          <div class="pill">
            Round {m.ri + 1} / {m.rounds}
          </div>
          <div class="pill wv-psy-pill" style={{ '--pc': pColor }}>
            <Pierogi color={pColor} size={44} mood="wow" /> Psychic: {psychic?.name ?? '?'}
          </div>
          <div class="grow" />
          {m.phase === 'clue' && timer(WAVE_CLUE_MS)}
          {m.phase === 'guess' && timer(WAVE_GUESS_MS)}
        </div>
        <div class="wv-clue-row">
          {m.phase === 'clue' ? (
            <div class="wv-thinking">
              <Pierogi color={pColor} size={72} mood="sleep" class="bob" />
              <span>
                {psychic?.name ?? '?'} is thinking of a clue<span class="wv-dots">…</span>
              </span>
            </div>
          ) : (
            <div class={`wv-clue card-paper pop-in ${m.clue === NO_CLUE ? 'none' : ''}`} key={`c${m.ri}`}>
              {m.clue === NO_CLUE ? 'No clue! Just guess…' : `“${m.clue}”`}
            </div>
          )}
        </div>
        <div class="wv-dial-row">
          <div class="wv-end left card-paper">
            <span class="wv-arrow">←</span>
            {sp.left}
          </div>
          {this.dial()}
          <div class="wv-end right card-paper">
            {sp.right}
            <span class="wv-arrow">→</span>
          </div>
        </div>
        {this.chips()}
      </div>
    );
  }

  private dial() {
    const m = this.m;
    const open = m.phase === 'reveal';
    const t = m.target;
    const ticks = [];
    for (let v = 0; v <= 100; v += 5) {
      const [x1, y1] = pointAt(CX, CY, R - (v % 25 === 0 ? 34 : 18), v);
      const [x2, y2] = pointAt(CX, CY, R, v);
      ticks.push(<line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2a120a" stroke-width={v % 25 === 0 ? 6 : 3} stroke-linecap="round" opacity=".7" />);
    }
    const r = m.result;
    const guessers = r ? Object.keys(r.guesses).filter((id) => m.ids.includes(id)) : [];
    const tiers = markerTiers(guessers.map((id) => r!.guesses[id]));
    const [tx, ty] = pointAt(CX, CY, R + 6, t);
    return (
      <div class={`wv-dial ${open ? 'open' : ''}`} style={{ width: `${W}px`, height: `${H}px` }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
          <defs>
            <clipPath id="wv-top">
              <rect x="0" y="0" width={W} height={CY} />
            </clipPath>
          </defs>
          {/* the base and the face */}
          <path d={`M${CX - R - 22} ${CY} A${R + 22} ${R + 22} 0 0 1 ${CX + R + 22} ${CY} Z`} fill="#2a120a" />
          <path d={`M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY} Z`} fill="#fff4dc" />
          {open && (
            <g class="wv-wedge">
              {[...BANDS].reverse().map((b, i) => (
                <path d={slicePath(CX, CY, R, t - b.d, t + b.d)} fill={BAND_COLORS[BANDS.length - 1 - i]} stroke="#2a120a" stroke-width="3" />
              ))}
              {BANDS.map((b, i) => {
                const prev = i === 0 ? 0 : BANDS[i - 1].d;
                const mids = i === 0 ? [t] : [t - (prev + b.d) / 2, t + (prev + b.d) / 2];
                return mids
                  .filter((v) => v > 1 && v < 99)
                  .map((v) => {
                    const [x, y] = pointAt(CX, CY, R - 70, v);
                    return (
                      <text x={x} y={y + 14} class="wv-band-num">
                        {b.pts}
                      </text>
                    );
                  });
              })}
            </g>
          )}
          {ticks}
          {/* the shutter: covers the face until the reveal, then swings down out of sight */}
          <g clip-path="url(#wv-top)">
            <g class="wv-shutter" style={{ transformOrigin: `${CX}px ${CY}px` }}>
              <path d={`M${CX - R + 4} ${CY} A${R - 4} ${R - 4} 0 0 1 ${CX + R - 4} ${CY} Z`} fill="#3a1e2b" />
              {[0, 1, 2, 3, 4, 5].map((k) => (
                <path d={`M${CX - R + 40 + k * 66} ${CY} A${R - 40 - k * 66} ${R - 40 - k * 66} 0 0 1 ${CX + R - 40 - k * 66} ${CY}`} fill="none" stroke="rgba(251,240,217,.08)" stroke-width="16" />
              ))}
              <text x={CX} y={CY - 150} class="wv-shutter-q">
                ?
              </text>
            </g>
          </g>
          {open && <line class="wv-needle" x1={CX} y1={CY} x2={tx} y2={ty} stroke="#2a120a" stroke-width="10" stroke-linecap="round" />}
          <rect x={CX - R - 40} y={CY} width={2 * R + 80} height={H - CY} rx="10" fill="#2a120a" />
          <circle cx={CX} cy={CY} r="34" fill="#2a120a" />
          <circle cx={CX} cy={CY} r="18" fill="#ffc93c" />
        </svg>
        {open && (
          <div class="wv-target-tag pop-in" style={{ left: `${pointAt(CX, CY, R + 46, t)[0]}px`, top: `${pointAt(CX, CY, R + 46, t)[1]}px` }}>
            {t}
          </div>
        )}
        {open &&
          guessers.map((id, i) => {
            const p = this.host.player(id);
            if (!p) return null;
            const g = r!.guesses[id];
            const pts = pointsFor(g, t);
            const len = R - 70 - Math.min(5, tiers[i]) * 72;
            return (
              <div class="wv-arm" style={{ '--rot': `${(g - 50) * 1.8}deg`, '--len': `${len}px`, '--pc': colorHex(p.color), left: `${CX}px`, top: `${CY}px`, animationDelay: `${1.9 + i * 0.26}s` }}>
                <div class="wv-arm-line" />
                <div class="wv-arm-tip" style={{ animationDelay: `${1.9 + i * 0.26}s` }}>
                  <span class="wv-arm-name">{p.name}</span>
                  <Pierogi color={colorHex(p.color)} size={74} mood={this.pointsOut ? (pts >= 3 ? 'wow' : pts > 0 ? 'happy' : 'dead') : 'happy'} />
                </div>
              </div>
            );
          })}
      </div>
    );
  }

  private chips() {
    const m = this.m;
    const r = m.result;
    return (
      <div class="wv-chips">
        {m.ids.map((id) => {
          const p = this.host.player(id);
          if (!p) return null;
          const isPsychic = id === m.psychic;
          const locked = m.guesses.has(id);
          let status = '';
          let cls = '';
          if (isPsychic) {
            status = 'Psychic';
            cls = 'psychic';
          } else if (m.phase === 'guess') {
            status = locked ? 'Locked in ✓' : 'Thinking…';
            cls = locked ? 'done' : '';
          } else if (m.phase === 'reveal' && r) {
            status = r.guesses[id] === undefined ? 'No guess' : this.pointsOut ? `${r.guesses[id]}` : '…';
          }
          const gain = m.phase === 'reveal' && this.pointsOut && r ? r.points[id] ?? 0 : null;
          // The round's points are already counted; keep them hidden until the dial has opened.
          const score = (m.scores[id] ?? 0) - (m.phase === 'reveal' && !this.pointsOut ? r?.points[id] ?? 0 : 0);
          return (
            <div class={`wv-chip ${cls} ${p.connected ? '' : 'offline'}`} style={{ '--pc': colorHex(p.color) }}>
              <Pierogi color={colorHex(p.color)} size={58} mood={!p.connected ? 'sleep' : isPsychic || locked ? 'wow' : 'happy'} />
              <span class="wv-chip-name">{p.name}</span>
              <span class="wv-chip-status">{status || ' '}</span>
              <b class="wv-chip-score">
                {score}
                {gain !== null && <i class={`wv-gain pop-in ${gain ? '' : 'zero'}`}>+{gain}</i>}
              </b>
            </div>
          );
        })}
      </div>
    );
  }
}
