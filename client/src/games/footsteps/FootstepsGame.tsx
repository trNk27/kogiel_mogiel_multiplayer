import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DT, FootstepsSim, ROUNDS, ROUNDS_SHORT, difficultyFor, placeText, type FootEvent, type FootInput } from './logic';
import { FootstepsScene } from './scene';
import '../tiles/tiles.css';
import './footsteps.css';

const READY_MS = 3500;
/** After the last step: Babcia's trail comes back and everyone's accuracy shows, then the tally. */
const REVEAL_MS = 4200;
const TALLY_MS = 7500;
const HUD_MS = 200;

type Phase = 'ready' | 'play' | 'reveal' | 'tally';

export class FootstepsGame implements Game {
  readonly id = 'footsteps' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim: FootstepsSim;
  /** Points over finished rounds. */
  totals: number[];
  /** Accuracy per player in the round just played. */
  roundPts: number[];
  /** Shapes walked so far this game (no repeats). */
  walked: string[] = [];
  goAt = 0;
  toast: { text: string; color: string; until: number } = { text: '', color: '', until: 0 };
  readonly removed = new Set<number>();
  private input: ArenaInput;
  private scene: FootstepsScene | null = null;
  private glError = false;
  private raf = 0;
  private timer: number | undefined;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private tickedSec = -1;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? ROUNDS_SHORT : ROUNDS;
    this.input = new ArenaInput(ids);
    this.totals = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
    this.sim = this.makeSim(1);
  }

  private makeSim(round: number) {
    const sim = new FootstepsSim(this.ids.length, { difficulty: difficultyFor(round, this.rounds), skip: this.walked });
    this.walked.push(sim.shape.name);
    return sim;
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, FootstepsGame>).footsteps = this;
    this.newRound();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.detach();
  }

  /** Called by the view once its canvas exists. */
  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new FootstepsScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.sim,
      );
    } catch (err) {
      console.error(err);
      this.glError = true;
      this.host.changed();
    }
  }

  detach() {
    this.scene?.dispose();
    this.scene = null;
  }

  // ---- flow -------------------------------------------------------------------

  private newRound() {
    this.round++;
    if (this.round > 1) this.sim = this.makeSim(this.round);
    this.removed.forEach((i) => this.sim.remove(i));
    this.input.release();
    this.scene?.reset(this.sim);
    this.phase = 'ready';
    this.acc = 0;
    this.tickedSec = -1;
    this.goAt = Date.now() + READY_MS;
    [READY_MS - 3000, READY_MS - 2000, READY_MS - 1000].forEach((ms) => window.setTimeout(() => this.phase === 'ready' && sound.count(), ms));
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.phase = 'play';
      this.acc = 0;
      this.say('Watch Babcia’s trail!', '#ffd23f');
      this.update();
    }, READY_MS);
    this.update();
  }

  /** The walking's over: show Babcia's trail next to everyone's. */
  private reveal() {
    if (this.phase !== 'play') return;
    this.phase = 'reveal';
    this.roundPts = this.sim.scores();
    this.roundPts.forEach((c, i) => (this.totals[i] += this.removed.has(i) ? 0 : c));
    sound.reveal();
    const best = this.sim.ranking()[0];
    if (best !== undefined) this.host.buzz(this.ids[best], [120, 60, 120, 60, 240]);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.phase = 'tally';
      sound.fanfare();
      this.update();
      this.timer = window.setTimeout(() => (this.round < this.rounds ? this.newRound() : this.finish()), TALLY_MS);
    }, REVEAL_MS);
    this.update();
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.totals[i]));
    this.host.finish(out);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- loop -------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'play') {
      const press = this.ids.map((_, i) => this.input.takePresses(i, 0) > 0);
      this.acc += elapsed;
      let first = true;
      while (this.acc >= DT && this.phase === 'play') {
        this.acc -= DT;
        this.stepOnce(first ? press : null);
        first = false;
      }
    } else this.ids.forEach((_, i) => this.input.takePresses(i, 0));
    this.scene?.render(this.sim, elapsed, this.phase === 'reveal' || this.phase === 'tally');
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private stepOnce(press: boolean[] | null) {
    const inputs: FootInput[] = this.ids.map((_, i) => {
      const pad = this.input.pads[i];
      return { x: pad.x, z: pad.y, done: press ? press[i] : false };
    });
    const ev = this.sim.step(inputs);
    if (ev.length) {
      this.scene?.events(ev, this.sim);
      this.react(ev);
    }
    if (this.sim.phase === 'trace') {
      const sec = Math.ceil(this.sim.left);
      if (sec !== this.tickedSec) {
        if (sec <= 5 && sec > 0) sound.tick();
        this.tickedSec = sec;
      }
    }
  }

  /** Sounds, buzzes and phone updates for what just happened. */
  private react(ev: FootEvent[]) {
    for (const e of ev) {
      switch (e.t) {
        case 'walk':
          sound.whistle();
          break;
        case 'go':
          sound.go();
          this.say('Your turn – follow the berries!', '#fff4dc');
          this.ids.forEach((id) => this.host.buzz(id, [80]));
          this.update();
          break;
        case 'fade':
          sound.whoosh();
          this.say('The snow’s covering them – from memory now!', '#bfe3ff');
          this.update();
          break;
        case 'done':
          sound.lockIn();
          this.host.buzz(this.ids[e.p], [40, 30, 60]);
          this.host.refresh(this.ids[e.p]);
          break;
        case 'end':
          this.reveal();
          break;
        default:
          break;
      }
    }
  }

  private say(text: string, color: string) {
    this.toast = { text, color, until: performance.now() + 2600 };
  }

  /** For tests in the browser (/?debug): run the round forward without waiting. */
  debugAdvance(seconds: number) {
    if (this.phase !== 'play') return;
    const steps = Math.round(seconds / DT);
    for (let k = 0; k < steps && this.phase === 'play'; k++) this.stepOnce(null);
  }

  // ---- phones -----------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    this.input.handle(id, m);
  }

  onConnection(id: string, connected: boolean) {
    const i = this.ids.indexOf(id);
    if (i >= 0 && !connected) this.input.release(i);
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i)) return;
    this.removed.add(i);
    this.input.release(i);
    this.sim.remove(i);
    if (this.removed.size >= this.ids.length) {
      clearTimeout(this.timer);
      this.host.finish({});
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.sim.players[i];
    const accent = colorHex(this.host.player(id)?.color ?? 'sourcream');
    const base = {
      v: 'pad' as const,
      game: 'footsteps' as const,
      round: this.round,
      rounds: this.rounds,
      accent,
      score: this.totals[i] ?? 0,
    };
    const done = { label: 'Done', color: '#7bc96f' };
    const last = this.round > 1 || this.phase === 'reveal' || this.phase === 'tally' ? this.roundPts[i] : -1;
    const stats = last >= 0 ? [{ k: 'Last trail', v: `${last}%` }] : [];
    if (this.phase === 'ready') return { ...base, phase: 'ready', title: 'Get ready!', text: 'Watch where Babcia walks', buttons: [{ ...done, off: true }], stats };
    if (this.phase === 'reveal' || this.phase === 'tally') {
      const place = this.sim.ranking().indexOf(i) + 1;
      const pts = this.roundPts[i] ?? 0;
      return {
        ...base,
        phase: 'over',
        title: `${pts}% · ${placeText(place)}`,
        text: this.round < this.rounds ? 'Next trail coming up' : 'That’s the lot!',
        buttons: [{ ...done, off: true }],
        stats,
        noStick: true,
      };
    }
    if (this.sim.phase === 'show') return { ...base, phase: 'play', title: 'Watch Babcia…', text: 'Remember her trail – you walk it next', buttons: [{ ...done, off: true }], stats };
    if (p?.done) return { ...base, phase: 'out', title: 'Done!', text: 'Waiting for the others', buttons: [{ ...done, off: true }], stats, noStick: true };
    const memory = this.sim.trailShown() < 1;
    return {
      ...base,
      phase: 'play',
      title: memory ? 'From memory!' : 'Your turn!',
      text: 'Walk her trail · Done when you’ve finished',
      buttons: [done],
      stats,
    };
  }

  // ---- TV -----------------------------------------------------------------------

  render() {
    return <FootstepsView game={this} />;
  }

  get contenders() {
    return this.ids.map((id, idx) => ({ id, idx, p: this.host.player(id) })).filter((c) => c.p && !this.removed.has(c.idx));
  }

  get glFailed() {
    return this.glError;
  }
}

function FootstepsView({ game }: { game: FootstepsGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  const sim = game.sim;
  const people = game.contenders;
  const left = Math.ceil(sim.left);
  const now = performance.now();
  const over = game.phase === 'reveal' || game.phase === 'tally';
  const best = over ? Math.max(0, ...people.map((c) => game.roundPts[c.idx] ?? 0)) : -1;
  const watching = game.phase === 'ready' || sim.phase === 'show';
  return (
    <div class="tiles-root foot-root">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      <div class="tiles-hud">
        <div class="tiles-top">
          <div class="pill">
            Trail {game.round} / {game.rounds}
          </div>
          {watching ? (
            <div class="tiles-timer foot-eye">👀</div>
          ) : (
            <div class={`tiles-timer ${!over && left <= 5 ? 'low' : ''}`} key={!over && left <= 5 ? left : 'x'}>
              {over ? 0 : left}
              <small>s</small>
            </div>
          )}
          <div class="tiles-rule">{watching ? 'Watch Babcia’s trail' : over ? 'Red berries: Babcia’s trail' : <>Walk her trail · <b>Done</b> when finished</>}</div>
        </div>
        {game.toast.until > now && game.phase === 'play' && (
          <div class="tiles-toast pop-in" style={{ color: game.toast.color }} key={game.toast.text + game.toast.until}>
            {game.toast.text}
          </div>
        )}
        {game.phase === 'reveal' && (
          <div class="foot-reveal pop-in">
            <small>Babcia walked a</small>
            {sim.shape.name}
          </div>
        )}
        <div class={`tiles-chips n${people.length}`}>
          {people.map((c) => {
            const pl = sim.players[c.idx];
            const pts = game.roundPts[c.idx] ?? 0;
            return (
              <div class={`tiles-chip ${over && pts === best ? 'lead' : ''} ${c.p!.connected ? '' : 'away'}`} style={{ '--pc': colorHex(c.p!.color) }} key={c.id}>
                <Pierogi color={colorHex(c.p!.color)} size={people.length > 5 ? 40 : 52} mood={!c.p!.connected ? 'sleep' : over && pts === best ? 'wow' : 'happy'} />
                <div class="tiles-chip-body">
                  <div class="tiles-chip-name">{c.p!.name}</div>
                  <div class="foot-chip-state">{over ? 'accuracy' : pl?.done ? '✓ done' : sim.phase === 'trace' && (pl?.trail.length ?? 0) > 0 ? 'walking…' : 'watching'}</div>
                </div>
                <b class="tiles-chip-n">{over ? `${pts}%` : game.totals[c.idx]}</b>
              </div>
            );
          })}
        </div>
      </div>
      {game.phase === 'ready' && (
        <>
          <div class="tiles-intro">
            <div class="tiles-intro-small">
              Trail {game.round} of {game.rounds} · {['easy', 'trickier', 'hard'][sim.difficulty]}
            </div>
            <div class="tiles-intro-big">Watch where Babcia walks!</div>
          </div>
          <BigCountdown endsAt={game.goAt} key={game.round} />
        </>
      )}
      {game.phase === 'tally' && <Tally game={game} key={game.round} />}
      {game.glFailed && <div class="tiles-nogl">This screen can’t show 3D graphics (WebGL is off).</div>}
    </div>
  );
}

/** The end-of-round tally: bars grow from the last place to the first, then the winner is announced. */
function Tally({ game }: { game: FootstepsGame }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const s = (now - t0) / 1000;
      setT(s);
      if (s < 5) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const people = game.contenders;
  const pts = game.roundPts;
  const order = [...people].sort((a, b) => pts[b.idx] - pts[a.idx] || a.idx - b.idx);
  const n = order.length;
  const last = game.round >= game.rounds;
  const overall = [...people].sort((a, b) => game.totals[b.idx] - game.totals[a.idx] || a.idx - b.idx);
  const tie = (list: typeof order, score: (i: number) => number) => (list.length ? list.filter((c) => score(c.idx) === score(list[0].idx)) : []);
  const winners = last && game.rounds > 1 ? tie(overall, (i) => game.totals[i]) : tie(order, (i) => pts[i]);
  const names = winners.map((w) => w.p!.name).join(' & ');
  const showWinner = t > 2.9 && winners.length > 0 && people.length > 1;
  return (
    <div class="tiles-tally">
      <div class="tiles-tally-card">
        <div class="tiles-tally-title">
          Trail {game.round} of {game.rounds}: {game.sim.shape.name}
          <small>How close your trail was to Babcia’s</small>
        </div>
        <div class="tiles-tally-rows">
          {order.map((c, k) => {
            const v = pts[c.idx];
            const start = 0.25 + (n - 1 - k) * 0.22;
            const p = ease(Math.min(1, Math.max(0, (t - start) / 1.3)));
            return (
              <div class={`tiles-tally-row ${showWinner && winners.includes(c) ? 'win' : ''}`} style={{ '--pc': colorHex(c.p!.color) }} key={c.id}>
                <Pierogi color={colorHex(c.p!.color)} size={46} mood={showWinner && winners.includes(c) ? 'wow' : 'happy'} />
                <span class="tiles-tally-name">{c.p!.name}</span>
                <div class="tiles-tally-track">
                  <i style={{ width: `${v * p}%` }} />
                </div>
                <b class="tiles-tally-n">{Math.round(v * p)}%</b>
                {game.rounds > 1 && <span class="tiles-tally-total">{game.totals[c.idx]}</span>}
              </div>
            );
          })}
        </div>
        {game.rounds > 1 && <div class="tiles-tally-legend muted">Bars: this trail · right: points so far</div>}
        {showWinner && (
          <div class="tiles-tally-banner pop-in" style={{ color: colorHex(winners[0].p!.color) }}>
            {winners.length > 1
              ? `${names} tie!`
              : last && game.rounds > 1
                ? `${names} wins Śladami Babci!`
                : `${names} walked it best!`}
          </div>
        )}
      </div>
    </div>
  );
}

const ease = (x: number) => 1 - Math.pow(1 - x, 3);
