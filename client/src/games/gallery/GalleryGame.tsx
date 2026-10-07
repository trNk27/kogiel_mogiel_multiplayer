import { useEffect, useRef } from 'preact/hooks';
import { colorHex, type PadView, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ArenaInput } from '../arena/input';
import { ARENA_SCALE } from '../arena/kit';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { GalleryScene } from './scene';
import {
  DT,
  OVER_MS,
  READY_MS,
  GallerySim,
  POINTS,
  corks,
  newShooter,
  newTally,
  resolveShots,
  roundsFor,
  scoreHit,
  secondsFor,
  stepShooter,
  tryFire,
  tryReload,
  type Cand,
  type Kind,
  type Shooter,
  type Shot,
  type Tally,
} from './logic';
import './gallery.css';

const HUD_MS = 150;

type Phase = 'ready' | 'play' | 'over';

interface Cross {
  el: HTMLDivElement;
  ring: HTMLDivElement;
  pips: HTMLDivElement;
  x: string;
  y: string;
  pipText: string;
  reloading: boolean;
}

export class GalleryGame implements Game {
  readonly id = 'gallery' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  readyEnds = 0;
  sim: GallerySim;
  shooters: Shooter[];
  /** Points over the whole game, and this round's hits and points. */
  scores: number[];
  tallies: Tally[];
  readonly removed = new Set<number>();
  glError = false;
  private input: ArenaInput;
  private seed = (Math.random() * 2 ** 31) | 0;
  private scene: GalleryScene | null = null;
  private fxLayer: HTMLDivElement | null = null;
  private crosses: Cross[] = [];
  private pending: number[];
  private reloadAt: number[];
  private overTimer: number | undefined;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private dirty = false;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = roundsFor(host.short);
    this.input = new ArenaInput(ids);
    this.shooters = ids.map((_, i) => newShooter(i, ids.length));
    this.scores = ids.map(() => 0);
    this.tallies = ids.map(() => newTally());
    this.pending = ids.map(() => 0);
    this.reloadAt = ids.map(() => 0);
    this.sim = new GallerySim(this.seed, 1, host.short, ids.length);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, GalleryGame>).gallery = this;
    this.newRound();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.overTimer);
    this.detach();
  }

  /** Called by the view once its canvas and overlay layer exist. */
  attach(canvas: HTMLCanvasElement, layer: HTMLDivElement) {
    try {
      this.scene = new GalleryScene(canvas);
    } catch (err) {
      console.error(err);
      this.glError = true;
      this.host.changed();
      return;
    }
    this.fxLayer = layer;
    this.crosses = this.ids.map((id) => {
      const p = this.host.player(id);
      const el = document.createElement('div');
      el.className = 'gallery-xh';
      el.style.setProperty('--pc', colorHex(p?.color ?? 'sourcream'));
      el.innerHTML =
        '<div class="gallery-reload"></div><div class="gallery-ring"><i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i><b></b></div>' +
        `<div class="gallery-badge"></div><div class="gallery-pips"></div>`;
      (el.querySelector('.gallery-badge') as HTMLElement).textContent = (p?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
      layer.appendChild(el);
      return { el, ring: el.querySelector('.gallery-ring') as HTMLDivElement, pips: el.querySelector('.gallery-pips') as HTMLDivElement, x: '', y: '', pipText: '', reloading: false };
    });
    this.removed.forEach((i) => (this.crosses[i].el.hidden = true));
  }

  detach() {
    this.scene?.dispose();
    this.scene = null;
    this.crosses = [];
    this.fxLayer = null;
  }

  // ---- round flow -----------------------------------------------------------------------

  private newRound() {
    this.round++;
    this.sim = new GallerySim(this.seed, this.round, this.host.short, this.ids.length);
    this.tallies = this.ids.map(() => newTally());
    this.shooters.forEach((s) => {
      s.ammo = 6;
      s.reloadEnd = 0;
      s.lastShot = -9;
    });
    this.pending = this.ids.map(() => 0);
    this.reloadAt = this.ids.map(() => 0);
    this.drainPresses();
    this.phase = 'ready';
    this.readyEnds = Date.now() + READY_MS;
    [READY_MS - 3000, READY_MS - 2000, READY_MS - 1000].forEach((ms) => window.setTimeout(() => this.phase === 'ready' && sound.count(), ms));
    this.update();
  }

  /** Forget button presses made while shooting wasn't allowed (the sticks keep their position). */
  private drainPresses() {
    for (let i = 0; i < this.ids.length; i++) {
      this.input.takePresses(i, 0);
      this.input.takePresses(i, 1);
    }
  }

  private beginPlay() {
    this.drainPresses();
    this.phase = 'play';
    this.acc = 0;
    sound.go();
    this.update();
  }

  private endRound() {
    if (this.phase !== 'play') return;
    this.phase = 'over';
    this.sim.targets = [];
    sound.fanfare();
    for (let i = 0; i < this.ids.length; i++) if (this.live(i)) this.host.buzz(this.ids[i], [80, 50, 80]);
    this.update();
    clearTimeout(this.overTimer);
    this.overTimer = window.setTimeout(() => (this.round < this.rounds ? this.newRound() : this.finish()), OVER_MS);
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => {
      if (!this.removed.has(i)) out[id] = this.scores[i];
    });
    this.host.finish(out);
  }

  private live(i: number) {
    return !this.removed.has(i);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- loop ----------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'ready' && Date.now() >= this.readyEnds) this.beginPlay();
    if (this.phase === 'play') {
      this.acc += elapsed;
      while (this.acc >= DT && this.phase === 'play') {
        this.acc -= DT;
        this.tick();
      }
    } else {
      // Crosshairs can already move before the round starts and after it ends.
      this.acc = 0;
      for (let i = 0; i < this.ids.length; i++) if (this.live(i)) stepShooter(this.shooters[i], this.phase === 'ready' ? this.input.pads[i].x : 0, this.phase === 'ready' ? this.input.pads[i].y : 0, Math.min(elapsed, 0.05), this.sim.t);
    }
    this.scene?.update(elapsed, this.sim.targets);
    this.scene?.render();
    this.drawCrosshairs();
    if (now - this.lastHud > HUD_MS || this.dirty) {
      this.lastHud = now;
      this.dirty = false;
      this.host.refresh();
      this.host.changed();
    }
  };

  private tick() {
    const sim = this.sim;
    sim.step(DT);
    const shots: Shot[] = [];
    for (let i = 0; i < this.ids.length; i++) {
      if (!this.live(i)) continue;
      const sh = this.shooters[i];
      const pad = this.input.pads[i];
      if (stepShooter(sh, pad.x, pad.y, DT, sim.t)) {
        this.reloadAt[i] = 0;
        sound.lockIn();
        this.host.refresh(this.ids[i]);
        this.dirty = true;
      }
      this.pending[i] = Math.min(2, this.pending[i] + this.input.takePresses(i, 0));
      if (this.input.takePresses(i, 1) > 0 && tryReload(sh, sim.t)) {
        this.reloadAt[i] = Math.round(Date.now() + (sh.reloadEnd - sim.t) * 1000);
        sound.whoosh();
        this.pending[i] = 0;
        this.host.refresh(this.ids[i]);
        this.dirty = true;
      }
      if (this.pending[i] > 0) {
        const r = tryFire(sh, sim.t);
        if (r === 'shot') {
          this.pending[i]--;
          shots.push({ player: i, x: sh.x, y: sh.y });
          this.tallies[i].shots++;
        } else if (r === 'dry') {
          this.pending[i] = 0;
          sound.tick();
          this.restart(this.crosses[i]?.ring, 'dry');
          this.host.refresh(this.ids[i]);
        } else if (r === 'reloading') this.pending[i] = 0;
      }
    }
    if (shots.length) this.resolve(shots);
    if (sim.done) this.endRound();
  }

  /** Decide this frame's shots against the targets as they are drawn right now. */
  private resolve(shots: Shot[]) {
    const scene = this.scene;
    const live = this.sim.hittable();
    const cands: Cand[] = scene
      ? live.map(({ target, bounds }) => ({ id: target.id, kind: target.kind, depth: target.z, rect: scene.project(target.z, bounds) }))
      : [];
    const { hits } = resolveShots(shots, cands);
    this.sim.applyHits(hits);
    for (const s of shots) {
      this.muzzle(s.x, s.y, this.ids[s.player]);
      this.restart(this.crosses[s.player]?.ring, 'fire');
    }
    sound.plop();
    let sfx: Kind | null = null;
    const byTarget = new Map<number, number>();
    for (const h of hits) {
      scoreHit(this.tallies[h.player], h.kind);
      this.scores[h.player] += POINTS[h.kind];
      const tg = this.sim.targets.find((t) => t.id === h.id);
      if (tg && scene) {
        const color = colorHex(this.host.player(this.ids[h.player])?.color ?? 'sourcream');
        const n = byTarget.get(h.id) ?? 0;
        byTarget.set(h.id, n + 1);
        scene.burst(tg.x, tg.y, tg.z, color, h.kind === 'gold' ? 46 : 26, h.kind === 'gold' ? 1.4 : 1);
        const p = scene.point(tg.x, tg.y + tg.hh * 0.6, tg.z);
        this.popText(p.x + n * 54, p.y - n * 12, h.kind, color);
      }
      this.host.buzz(this.ids[h.player], h.kind === 'babcia' ? [160, 60, 100] : h.kind === 'gold' ? [40, 30, 40, 30, 80] : [30]);
      if (!sfx || h.kind === 'babcia' || (h.kind === 'gold' && sfx !== 'babcia')) sfx = h.kind;
    }
    if (sfx === 'babcia') sound.wrong();
    else if (sfx === 'gold') sound.bell();
    else if (sfx) sound.pickup();
    for (const s of shots) this.host.refresh(this.ids[s.player]);
    this.dirty = true;
  }

  // ---- overlays (direct DOM, not part of the Preact tree) ----------------------------------

  private drawCrosshairs() {
    const t = this.phase === 'play' ? this.sim.t : 0;
    for (let i = 0; i < this.crosses.length; i++) {
      const c = this.crosses[i];
      const sh = this.shooters[i];
      const x = sh.x.toFixed(1);
      const y = sh.y.toFixed(1);
      if (x !== c.x || y !== c.y) {
        c.x = x;
        c.y = y;
        c.el.style.transform = `translate3d(${x}px,${y}px,0)`;
      }
      const reloading = sh.reloadEnd > 0;
      if (reloading) c.el.style.setProperty('--rl', String(Math.max(0, Math.min(1, 1 - (sh.reloadEnd - t) / 0.9))));
      if (reloading !== c.reloading) {
        c.reloading = reloading;
        c.el.classList.toggle('reloading', reloading);
      }
      const text = reloading ? 'reload…' : corks(sh.ammo);
      if (text !== c.pipText) {
        c.pipText = text;
        c.pips.textContent = text;
        c.pips.classList.toggle('empty', sh.ammo === 0 && !reloading);
      }
      c.el.classList.toggle('dim', this.phase === 'over');
    }
  }

  /** Restart a CSS animation class on an element. */
  private restart(el: HTMLElement | undefined, cls: string) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  private muzzle(x: number, y: number, id: string) {
    const layer = this.fxLayer;
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'gallery-muzzle';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--pc', colorHex(this.host.player(id)?.color ?? 'sourcream'));
    layer.appendChild(el);
    window.setTimeout(() => el.remove(), 320);
  }

  private popText(x: number, y: number, kind: Kind, color: string) {
    const layer = this.fxLayer;
    if (!layer) return;
    const el = document.createElement('div');
    const pts = POINTS[kind];
    el.className = `gallery-pop ${kind}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--pc', color);
    el.textContent = kind === 'babcia' ? 'Ojej! −3' : `+${pts}${kind === 'gold' ? ' ★' : ''}`;
    layer.appendChild(el);
    window.setTimeout(() => el.remove(), 1200);
  }

  // ---- phones --------------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    this.input.handle(id, m);
  }

  onConnection(id: string, connected: boolean) {
    const i = this.ids.indexOf(id);
    if (i >= 0 && !connected) {
      this.input.release(i);
      this.pending[i] = 0;
    }
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    this.removed.add(i);
    this.input.release(i);
    if (this.crosses[i]) this.crosses[i].el.hidden = true;
    if (this.ids.length - this.removed.size < 1) this.host.finish({});
    else this.host.changed();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const sh = this.shooters[i];
    const base = { v: 'pad' as const, game: 'gallery' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    if (!sh) return { ...base, phase: 'over', buttons: [] };
    const stats = [{ k: 'Corks', v: corks(sh.ammo) }];
    if (this.phase === 'over') {
      const pts = this.tallies[i].points;
      const view: PadView = {
        ...base,
        phase: 'over',
        title: 'Round over!',
        text: `${pts >= 0 ? '+' : '−'}${Math.abs(pts)} this round`,
        accent: '#ffd23f',
        buttons: [{ label: 'Fire', off: true }, { label: 'Reload', color: '#ffd23f', off: true }],
        stats,
      };
      return view;
    }
    const reloading = sh.reloadEnd > 0;
    const empty = sh.ammo === 0 && !reloading;
    const play = this.phase === 'play';
    return {
      ...base,
      phase: play ? 'play' : 'ready',
      title: !play ? 'Aim your crosshair' : empty ? 'Out of corks – reload!' : undefined,
      text: !play ? 'Shots start in a moment' : undefined,
      accent: empty ? '#ffd23f' : undefined,
      buttons: [
        { label: 'Fire', off: !play || reloading },
        reloading ? { label: 'Reload', color: '#ffd23f', readyAt: this.reloadAt[i], cool: 900 } : { label: 'Reload', color: '#ffd23f', off: !play },
      ],
      stats,
    };
  }

  // ---- TV --------------------------------------------------------------------------------------

  render() {
    return <GalleryView game={this} />;
  }

  get players() {
    return this.ids.map((id, idx) => ({ id, idx, p: this.host.player(id) })).filter((r) => r.p && !this.removed.has(r.idx));
  }

  get secondsLeft() {
    return Math.max(0, Math.ceil(secondsFor(this.host.short) - this.sim.t));
  }
}

function GalleryView({ game }: { game: GalleryGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    game.attach(canvas.current!, layer.current!);
    return () => game.detach();
  }, [game]);

  const players = game.players;
  const secs = game.secondsLeft;
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const over = game.phase === 'over';
  const ranked = [...players].sort((a, b) => game.tallies[b.idx].points - game.tallies[a.idx].points || game.scores[b.idx] - game.scores[a.idx]);
  return (
    <div class="gallery">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      <div class="gallery-fx" ref={layer} />
      <div class="gallery-top">
        <div class="pill">
          Round {game.round} / {game.rounds}
        </div>
        <div class="gallery-rules">
          Ghosts <b>1</b> · Bats <b>2</b> · Gold <b class="g">5</b> · Babcia <b class="r">−3</b>!
        </div>
        <div class={`pill gallery-time ${game.phase === 'play' && secs <= 5 ? 'low' : ''}`}>{time}</div>
      </div>
      <div class={`gallery-chips n${players.length}`}>
        {players.map((r) => {
          const color = colorHex(r.p!.color);
          return (
            <div class={`gallery-chip ${r.p!.connected ? '' : 'offline'}`} key={r.id} style={{ '--pc': color }}>
              <Pierogi color={color} size={52} mood={!r.p!.connected ? 'sleep' : 'happy'} />
              <div class="gallery-chip-text">
                <span class="gallery-chip-name">{r.p!.name}</span>
                <span class="gallery-chip-pts">{game.scores[r.idx]}</span>
              </div>
            </div>
          );
        })}
      </div>
      {game.phase === 'ready' && <BigCountdown endsAt={game.readyEnds} key={game.round} />}
      {game.phase === 'ready' && <div class="gallery-hint">Aim with the stick · Fire to shoot · Reload when you run out of corks</div>}
      {over && (
        <div class="trails-banner gallery-banner pop-in">
          <div class="trails-banner-small">
            Round {game.round} of {game.rounds}
          </div>
          <div class="trails-banner-big">{game.round === game.rounds ? 'Strzelnica closed!' : 'Round over!'}</div>
          <table class="gallery-table">
            <thead>
              <tr>
                <th />
                <th />
                <th>Hits</th>
                <th>Babcias</th>
                <th>Round</th>
                {game.rounds > 1 && <th>Total</th>}
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => {
                const t = game.tallies[r.idx];
                return (
                  <tr key={r.id} style={{ '--pc': colorHex(r.p!.color) }}>
                    <td>
                      <Pierogi color={colorHex(r.p!.color)} size={40} mood={t === game.tallies[ranked[0].idx] || t.points === game.tallies[ranked[0].idx].points ? 'wow' : 'happy'} />
                    </td>
                    <td class="n">{r.p!.name}</td>
                    <td>{t.hits}</td>
                    <td class={t.kinds.babcia ? 'bad' : ''}>{t.kinds.babcia}</td>
                    <td class="pts">
                      {t.points >= 0 ? '+' : '−'}
                      {Math.abs(t.points)}
                    </td>
                    {game.rounds > 1 && <td class="tot">{game.scores[r.idx]}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {game.glError && <div class="gallery-error">This screen can’t show 3D graphics, so the shooting gallery is closed.</div>}
    </div>
  );
}
