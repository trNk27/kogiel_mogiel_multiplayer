import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DT, ROLL_CD, ROUNDS, ROUNDS_SHORT, SPLAT_CD, TilesSim, placeText, type TilesEvent, type TilesInput } from './logic';
import { TilesScene } from './scene';
import './tiles.css';

const READY_MS = 3500;
const TALLY_MS = 8500;
const HUD_MS = 200;
const PHONE_MS = 1000;

type Phase = 'ready' | 'play' | 'tally';

export class TilesGame implements Game {
  readonly id = 'tiles' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim: TilesSim;
  /** Cumulative tiles over finished rounds. */
  totals: number[];
  /** Tiles per player in the round just played (while phase is 'tally'). */
  roundTiles: number[];
  /** Date.now() when the round starts. */
  goAt = 0;
  tallyAt = 0;
  toast: { text: string; until: number; n: number } = { text: '', until: 0, n: 0 };
  readonly removed = new Set<number>();
  private input: ArenaInput;
  private scene: TilesScene | null = null;
  private glError = false;
  private raf = 0;
  private timer: number | undefined;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private lastPhone = 0;
  private lastSound = { stun: 0, crack: 0, fall: 0 };
  private phoneCounts: number[];
  private rollReady: number[];
  private splatReady: number[];
  private tickedSec = -1;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? ROUNDS_SHORT : ROUNDS;
    this.input = new ArenaInput(ids);
    this.totals = ids.map(() => 0);
    this.roundTiles = ids.map(() => 0);
    this.phoneCounts = ids.map(() => 0);
    this.rollReady = ids.map(() => 0);
    this.splatReady = ids.map(() => 0);
    this.sim = new TilesSim(ids.length, { short: host.short });
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, TilesGame>).tiles = this;
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
      this.scene = new TilesScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.sim.cols,
        this.sim.rows,
      );
      this.scene.reset();
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
    const first = this.round === 1;
    if (!first) this.sim = new TilesSim(this.ids.length, { short: this.host.short });
    this.removed.forEach((i) => this.sim.remove(i));
    this.input.release();
    this.scene?.reset();
    this.rollReady = this.ids.map(() => 0);
    this.splatReady = this.ids.map(() => 0);
    this.phoneCounts = this.sim.counts.slice();
    this.phase = 'ready';
    this.acc = 0;
    this.tickedSec = -1;
    this.goAt = Date.now() + READY_MS;
    [READY_MS - 3000, READY_MS - 2000, READY_MS - 1000].forEach((ms) => window.setTimeout(() => this.phase === 'ready' && sound.count(), ms));
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.phase = 'play';
      this.acc = 0;
      sound.go();
      this.update();
    }, READY_MS);
    this.update();
  }

  private endRound() {
    if (this.phase !== 'play') return;
    this.phase = 'tally';
    this.roundTiles = this.sim.scores();
    this.roundTiles.forEach((c, i) => (this.totals[i] += this.removed.has(i) ? 0 : c));
    this.tallyAt = Date.now();
    this.phoneCounts = this.roundTiles.slice();
    sound.fanfare();
    const best = this.sim.ranking()[0];
    if (best !== undefined) this.host.buzz(this.ids[best], [120, 60, 120, 60, 240]);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.round < this.rounds ? this.newRound() : this.finish()), TALLY_MS);
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
      const press = this.ids.map((_, i) => [this.input.takePresses(i, 0) > 0, this.input.takePresses(i, 1) > 0]);
      this.acc += elapsed;
      let first = true;
      while (this.acc >= DT && this.phase === 'play') {
        this.acc -= DT;
        this.stepOnce(first ? press : null);
        first = false;
      }
    } else {
      this.ids.forEach((_, i) => {
        this.input.takePresses(i, 0);
        this.input.takePresses(i, 1);
      });
    }
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
    if (this.phase === 'play' && now - this.lastPhone > PHONE_MS) {
      this.lastPhone = now;
      const c = this.sim.counts;
      if (c.some((v, i) => v !== this.phoneCounts[i])) {
        this.phoneCounts = c.slice();
        this.host.refresh();
      }
    }
  };

  private stepOnce(press: boolean[][] | null) {
    const inputs: TilesInput[] = this.ids.map((_, i) => {
      const pad = this.input.pads[i];
      return { x: pad.x, z: pad.y, roll: press ? press[i][0] : false, splat: press ? press[i][1] : false };
    });
    const ev = this.sim.step(inputs);
    if (ev.length) {
      this.scene?.events(ev, this.sim);
      this.react(ev);
    }
    const sec = Math.ceil(this.sim.left);
    if (sec !== this.tickedSec) {
      if (sec <= 5 && sec > 0) sound.tick();
      this.tickedSec = sec;
    }
    if (this.sim.done) this.endRound();
  }

  /** Sounds, buzzes and phone cooldowns for what just happened. */
  private react(ev: TilesEvent[]) {
    const now = performance.now();
    for (const e of ev) {
      switch (e.t) {
        case 'roll':
          sound.whoosh();
          this.rollReady[e.p] = Date.now() + ROLL_CD * 1000;
          this.host.buzz(this.ids[e.p], [30]);
          this.host.refresh(this.ids[e.p]);
          break;
        case 'throw':
          sound.plop();
          this.splatReady[e.p] = Date.now() + SPLAT_CD * 1000;
          this.host.refresh(this.ids[e.p]);
          break;
        case 'land':
          sound.crash();
          this.host.buzz(this.ids[e.p], [50]);
          break;
        case 'stun':
          if (now - this.lastSound.stun > 120) {
            this.lastSound.stun = now;
            sound.crash();
          }
          this.host.buzz(this.ids[e.p], [140, 40, 100]);
          break;
        case 'fall':
          if (now - this.lastSound.fall > 150) {
            this.lastSound.fall = now;
            sound.wrong();
          }
          this.host.buzz(this.ids[e.p], [220]);
          break;
        case 'respawn':
          sound.lockIn();
          break;
        case 'crack':
          if (now - this.lastSound.crack > 400) {
            this.lastSound.crack = now;
            sound.tick();
            if (!this.toast.n) this.say('The tiles are cracking!');
            this.toast.n++;
          }
          break;
        case 'mopWarn':
          sound.whistle();
          this.say('Babcia’s mop is coming!');
          break;
        case 'mopStart':
          sound.whoosh();
          break;
        default:
          break;
      }
    }
  }

  private say(text: string) {
    this.toast = { text, until: performance.now() + 2600, n: this.toast.n };
  }

  /** For tests in the browser (/?debug): run the round forward without waiting. */
  debugAdvance(seconds: number) {
    if (this.phase !== 'play') return;
    const steps = Math.round(seconds / DT);
    const inputs = this.ids.map((_, i) => ({ x: this.input.pads[i].x, z: this.input.pads[i].y }));
    for (let k = 0; k < steps && this.phase === 'play'; k++) {
      const ev = this.sim.step(inputs);
      if (ev.length) this.scene?.events(ev, this.sim);
      if (this.sim.done) this.endRound();
    }
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
    if (this.ids.length - this.removed.size < 2) {
      clearTimeout(this.timer);
      const out: Record<string, number> = {};
      this.ids.forEach((pid, k) => {
        if (!this.removed.has(k)) out[pid] = this.totals[k] + (this.phase === 'play' ? this.sim.counts[k] : 0);
      });
      this.host.finish(out);
    } else this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.host.player(id);
    const accent = colorHex(p?.color ?? 'sourcream');
    const cool = (readyAt: number) => (readyAt > 0 ? { readyAt } : {});
    const base = {
      v: 'pad' as const,
      game: 'tiles' as const,
      round: this.round,
      rounds: this.rounds,
      accent,
      score: this.totals[i] ?? 0,
    };
    const playing = this.phase === 'play';
    const buttons = [
      { label: 'Roll', ...cool(this.rollReady[i] ?? 0), cool: ROLL_CD * 1000, ...(playing ? {} : { off: this.phase === 'tally' }) },
      { label: 'Splat', color: '#b27bff', ...cool(this.splatReady[i] ?? 0), cool: SPLAT_CD * 1000, ...(playing ? {} : { off: this.phase === 'tally' }) },
    ];
    const stats = [{ k: 'Tiles', v: String(this.phoneCounts[i] ?? 0) }];
    if (this.phase === 'ready') return { ...base, phase: 'ready', title: 'Get ready!', text: 'Walk over tiles to paint them', buttons, stats };
    if (this.phase === 'tally') {
      const place = this.sim.ranking().indexOf(i) + 1;
      return { ...base, phase: 'over', title: `${placeText(place)} · ${this.roundTiles[i] ?? 0} tiles`, text: this.round < this.rounds ? 'Next round coming up' : 'That’s the lot!', buttons, stats };
    }
    return { ...base, phase: 'play', text: 'Paint the floor!', buttons, stats };
  }

  // ---- TV -----------------------------------------------------------------------

  render() {
    return <TilesView game={this} />;
  }

  get contenders() {
    return this.ids.map((id, idx) => ({ id, idx, p: this.host.player(id) })).filter((c) => c.p && !this.removed.has(c.idx));
  }

  get glFailed() {
    return this.glError;
  }
}

function TilesView({ game }: { game: TilesGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  const sim = game.sim;
  const people = game.contenders;
  const total = Math.max(1, sim.cols * sim.rows);
  const left = Math.ceil(sim.left);
  const leader = game.phase === 'play' ? sim.ranking()[0] : -1;
  const now = performance.now();
  const lead = leader >= 0 && sim.counts[leader] > 1 ? leader : -1;
  return (
    <div class="tiles-root">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      <div class="tiles-hud">
        <div class="tiles-top">
          <div class="pill">
            Round {game.round} / {game.rounds}
          </div>
          <div class={`tiles-timer ${game.phase === 'play' && left <= 10 ? 'low' : ''}`} key={game.phase === 'play' && left <= 10 ? left : 'x'}>
            {game.phase === 'ready' ? Math.round(sim.length) : left}
            <small>s</small>
          </div>
          <div class="tiles-rule">
            Walk to paint · <b>Roll</b> for a streak · <b>Splat</b> for a blob
          </div>
        </div>
        {game.toast.until > now && game.phase === 'play' && (
          <div class="tiles-toast pop-in" key={game.toast.text + game.toast.until}>
            {game.toast.text}
          </div>
        )}
        <div class={`tiles-chips n${people.length}`}>
          {people.map((c) => {
            const n = sim.counts[c.idx];
            return (
              <div class={`tiles-chip ${lead === c.idx ? 'lead' : ''} ${c.p!.connected ? '' : 'away'}`} style={{ '--pc': colorHex(c.p!.color) }} key={c.id}>
                <Pierogi color={colorHex(c.p!.color)} size={people.length > 5 ? 40 : 52} mood={!c.p!.connected ? 'sleep' : (sim.players[c.idx]?.down ?? 0) > 0 ? 'dead' : (sim.players[c.idx]?.stun ?? 0) > 0 ? 'wow' : 'happy'} />
                <div class="tiles-chip-body">
                  <div class="tiles-chip-name">{c.p!.name}</div>
                  <div class="tiles-chip-bar">
                    <i style={{ width: `${Math.min(100, (n / total) * 100 * 2.2)}%` }} />
                  </div>
                </div>
                <b class="tiles-chip-n">{n}</b>
              </div>
            );
          })}
        </div>
      </div>
      {game.phase === 'ready' && (
        <>
          <div class="tiles-intro">
            <div class="tiles-intro-small">Round {game.round} of {game.rounds}</div>
            <div class="tiles-intro-big">Paint the floor!</div>
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
function Tally({ game }: { game: TilesGame }) {
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
  const order = [...people].sort((a, b) => game.roundTiles[b.idx] - game.roundTiles[a.idx] || a.idx - b.idx);
  const max = Math.max(1, ...order.map((c) => game.roundTiles[c.idx]));
  const n = order.length;
  const last = game.round >= game.rounds;
  const overall = [...people].sort((a, b) => game.totals[b.idx] - game.totals[a.idx] || a.idx - b.idx);
  const tie = (list: typeof order, score: (i: number) => number) => list.filter((c) => score(c.idx) === score(list[0].idx));
  const roundWinners = tie(order, (i) => game.roundTiles[i]);
  const gameWinners = tie(overall, (i) => game.totals[i]);
  const winners = last && game.rounds > 1 ? gameWinners : roundWinners;
  const names = winners.map((w) => w.p!.name).join(' & ');
  const showWinner = t > 2.9;
  return (
    <div class="tiles-tally">
      <div class="tiles-tally-card">
        <div class="tiles-tally-title">
          Round {game.round} of {game.rounds}
          <small>Tiles at the final whistle</small>
        </div>
        <div class="tiles-tally-rows">
          {order.map((c, k) => {
            const tiles = game.roundTiles[c.idx];
            // The last place starts first; the winner's bar is the last to finish growing.
            const start = 0.25 + (n - 1 - k) * 0.22;
            const p = ease(Math.min(1, Math.max(0, (t - start) / 1.3)));
            const shown = Math.round(tiles * p);
            return (
              <div class={`tiles-tally-row ${showWinner && winners.includes(c) ? 'win' : ''}`} style={{ '--pc': colorHex(c.p!.color) }} key={c.id}>
                <Pierogi color={colorHex(c.p!.color)} size={46} mood={showWinner && winners.includes(c) ? 'wow' : 'happy'} />
                <span class="tiles-tally-name">{c.p!.name}</span>
                <div class="tiles-tally-track">
                  <i style={{ width: `${(tiles / max) * 100 * p}%` }} />
                </div>
                <b class="tiles-tally-n">{shown}</b>
                {game.rounds > 1 && <span class="tiles-tally-total">{game.totals[c.idx]}</span>}
              </div>
            );
          })}
        </div>
        {game.rounds > 1 && <div class="tiles-tally-legend muted">Bars: this round · right: total so far</div>}
        {showWinner && (
          <div class="tiles-tally-banner pop-in" style={{ color: colorHex(winners[0].p!.color) }}>
            {winners.length > 1 ? `${names} tie!` : last && game.rounds > 1 ? `${names} wins Kafelki!` : `${names} wins${game.rounds > 1 ? ' the round' : ''}!`}
          </div>
        )}
      </div>
    </div>
  );
}

const ease = (x: number) => 1 - Math.pow(1 - x, 3);
