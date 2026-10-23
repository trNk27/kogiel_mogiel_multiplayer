import { useEffect, useRef } from 'preact/hooks';
import { colorHex, siegeMode, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { CastleSim, DT, END_S, MONSTERS, SKILL_COOLDOWN_S, WAVES, type CEvent } from './logic';
import { ARENA_SCALE, CastleScene, type ArcherLook } from './scene';
import './castle.css';

/** How often the TV's HUD and the phones' views catch up (ms). */
const HUD_MS = 150;
const VIEW_MS = 250;
/** Floating points stay up this long (ms). */
const POP_MS = 1200;

const WIN_LINES = ['', 'The wall held – just!', 'Malbork stands proud!', 'Legends of Malbork!'];

interface Pop {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  big: boolean;
  until: number;
}

export class CastleGame implements Game {
  readonly id = 'castle' as const;
  sim: CastleSim;
  /** Host clock (Date.now) when the current break ends, for the countdown. */
  breakEndsAt = 0;
  /** Host clock (Date.now) when each archer's volley skill is ready again. */
  skillReadyAt: number[];
  pops: Pop[] = [];
  glError = false;
  private scene: CastleScene | null = null;
  private popId = 0;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private lastView = 0;
  private lastThump = 0;
  private endTimer: number | undefined;
  private countTimers: number[] = [];
  private looks: ArcherLook[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.sim = new CastleSim(ids.length, (Math.random() * 2 ** 31) | 0, host.options.siege);
    this.breakEndsAt = Date.now() + this.sim.breakEnds * 1000;
    this.skillReadyAt = this.sim.archers.map((a) => Date.now() + a.skillAt * 1000);
    this.updateLooks();
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, CastleGame>).castle = this;
    // The intro may have been up a while: the clocks the phones count down to start now.
    this.skillReadyAt = this.sim.archers.map((a) => Date.now() + (a.skillAt - this.sim.t) * 1000);
    this.handle(this.sim.drain());
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.update();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.endTimer);
    this.countTimers.forEach(clearTimeout);
    this.detach();
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new CastleScene(canvas, this.looks);
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

  private updateLooks() {
    this.looks = this.ids.map((id) => {
      const p = this.host.player(id);
      return { color: colorHex(p?.color ?? 'sourcream'), name: p?.name ?? '?', connected: !!p?.connected };
    });
    this.scene?.setLooks(this.looks);
  }

  private pop(at: { x: number; y: number; visible: boolean } | undefined, text: string, color: string, big = false) {
    if (!at?.visible) return;
    this.pops.push({ id: this.popId++, x: at.x, y: at.y, text, color, big, until: performance.now() + POP_MS });
    if (this.pops.length > 30) this.pops.shift();
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- loop ----------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += elapsed;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.sim.step(DT);
      this.handle(this.sim.drain());
    }
    this.scene?.update(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
    if (now - this.lastView > VIEW_MS) {
      this.lastView = now;
      this.host.refresh();
    }
  };

  /** Show what just happened in the 3D scene (second screens replay this). */
  private showEvents(events: CEvent[]) {
    this.scene?.handle(events, this.sim, (i) => this.looks[i]?.color ?? '#fff');
  }

  private handle(events: CEvent[]) {
    this.showEvents(events);
    for (const ev of events) {
      switch (ev.e) {
        case 'wave':
          this.breakEndsAt = Date.now() + (this.sim.breakEnds - this.sim.t) * 1000;
          if (ev.wave > 1) sound.fanfare();
          this.countTimers.forEach(clearTimeout);
          this.countTimers = [3000, 2000, 1000]
            .map((ms) => this.breakEndsAt - ms - Date.now())
            .filter((at) => at > 0)
            .map((at) => window.setTimeout(() => this.sim.phase === 'break' && sound.count(), at));
          this.update();
          break;
        case 'go':
          sound.go();
          this.update();
          break;
        case 'cleared':
          if (ev.wave < WAVES.length) sound.reveal();
          break;
        case 'shoot':
          sound.whoosh();
          if (ev.charged) this.host.buzz(this.ids[ev.by], [20, 30, 20]);
          break;
        case 'skill': {
          const a = this.sim.archers[ev.by];
          if (ev.on) {
            sound.pickup();
            this.host.buzz(this.ids[ev.by], [30, 30, 30, 30, 60]);
            if (a) this.pop(this.scene?.pointOverArcher(a.x), 'Volley!', '#ffd23f');
          } else if (a) this.skillReadyAt[ev.by] = Date.now() + (a.skillAt - this.sim.t) * 1000;
          this.host.refresh(this.ids[ev.by]);
          break;
        }
        case 'hit':
          sound.plop();
          break;
        case 'kill': {
          const color = this.looks[ev.by]?.color ?? '#fff';
          const big = ev.kind === 'dragon';
          this.pop(this.scene?.pointOver(ev.kind, ev.x, ev.y), big ? `Smok down! +${ev.pts}` : `+${ev.pts}`, color, big);
          if (big) sound.fanfare();
          else if (ev.kind === 'fireball') sound.tick();
          else sound.pickup();
          this.host.buzz(this.ids[ev.by], big ? [80, 40, 80, 40, 160] : [30]);
          break;
        }
        case 'wall': {
          if (ev.kind === 'fireball') sound.crash();
          else if (performance.now() - this.lastThump > 400) {
            this.lastThump = performance.now();
            sound.tick();
          }
          break;
        }
        case 'fire':
          sound.whoosh();
          break;
        case 'won':
        case 'lost':
          if (ev.e === 'won') sound.fanfare();
          else sound.wrong();
          for (const id of this.ids) this.host.buzz(id, ev.e === 'won' ? [60, 40, 60, 40, 120] : [300]);
          clearTimeout(this.endTimer);
          this.endTimer = window.setTimeout(() => this.finish(), END_S * 1000);
          this.update();
          break;
      }
    }
  }

  private finish() {
    const sim = this.sim;
    const scores: Record<string, number> = {};
    this.ids.forEach((id, i) => {
      if (sim.archers[i].active) scores[id] = sim.archers[i].points;
    });
    const won = sim.phase === 'won';
    const wavesHeld = won ? sim.waves : sim.wave - 1;
    this.host.finish(scores, {
      score: sim.score,
      stars: sim.stars,
      served: sim.kills,
      missed: Math.round(sim.leaks),
      look: {
        line: won ? WIN_LINES[sim.stars] : 'The castle has fallen!',
        stats: [
          { v: sim.kills, label: 'monsters slain' },
          { v: wavesHeld, label: `of ${sim.waves} waves held` },
          { v: Math.round((100 * sim.wall) / sim.wallMax), label: '% of the wall left' },
        ],
        unit: ['point', 'points'],
        scoreUnit: 'points',
      },
    });
  }

  // ---- phones --------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    if (m.t === 'act') {
      this.sim.skill(i);
      return;
    }
    if (m.t !== 'bow') return;
    const a = Number(m.a);
    const p = Number(m.p) / 100;
    if (!Number.isFinite(a) || !Number.isFinite(p)) return;
    if (m.ev === 'aim') this.sim.aim(i, a, p, !!m.c);
    else if (m.ev === 'fire') this.sim.fire(i, a, p, !!m.c);
    else this.sim.cancel(i);
  }

  onConnection(id: string, connected: boolean) {
    const i = this.ids.indexOf(id);
    if (i >= 0 && !connected) this.sim.cancel(i);
    this.updateLooks();
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    this.sim.remove(i);
    this.updateLooks();
    if (!this.sim.archers.some((a) => a.active)) this.host.finish({});
    else this.host.changed();
  }

  viewFor(id: string): PhoneView {
    const sim = this.sim;
    const i = this.ids.indexOf(id);
    const a = sim.archers[i];
    const base = {
      v: 'castle' as const,
      wave: sim.wave,
      waves: sim.waves,
      wall: Math.ceil((100 * sim.wall) / sim.wallMax),
      score: a?.points ?? 0,
      kills: a?.kills ?? 0,
      volley: a?.volley ?? 0,
      skillCool: SKILL_COOLDOWN_S * 1000,
      ...(a && a.volley === 0 && sim.t < a.skillAt ? { skillAt: this.skillReadyAt[i] } : {}),
    };
    if (sim.phase === 'won') return { ...base, phase: 'won', title: 'Victory!', text: WIN_LINES[sim.stars] };
    if (sim.phase === 'lost') return { ...base, phase: 'lost', title: 'The castle has fallen!', text: '📺' };
    if (sim.phase === 'break') return { ...base, phase: 'break', title: `Wave ${sim.wave}: ${sim.current.name}`, text: sim.current.news };
    const dragon = sim.dragon;
    return { ...base, phase: 'play', ...(dragon ? { title: 'Smok!', text: 'Shoot down his fireballs!' } : {}) };
  }

  // ---- TV --------------------------------------------------------------------------

  playerAt(i: number) {
    return this.host.player(this.ids[i]);
  }

  render() {
    return <CastleView game={this} />;
  }
}

function CastleView({ game }: { game: CastleGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    game.attach(canvas.current!);
    return () => game.detach();
  }, [game]);
  const sim = game.sim;
  const wall = Math.ceil((100 * sim.wall) / sim.wallMax);
  const dragon = sim.dragon;
  const mode = siegeMode(sim.mode);
  const wave = sim.current;
  const now = performance.now();
  game.pops = game.pops.filter((p) => p.until > now);
  return (
    <div class="castle">
      <canvas ref={canvas} class="castle-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.pops.map((p) => (
        <div class={`castle-pop ${p.big ? 'big' : ''}`} key={p.id} style={{ left: p.x, top: p.y, '--pc': p.color }}>
          {p.text}
        </div>
      ))}
      {game.glError && <div class="rally-count small">This screen can’t show 3D graphics (WebGL is off).</div>}
      <div class="castle-top">
        <div class="pill castle-wave">
          Wave {sim.wave} / {sim.waves}
          <small>{mode.name}</small>
        </div>
        <div class={`castle-hp ${wall <= 30 ? 'low' : ''}`}>
          <span class="castle-hp-label">🏰 Wall</span>
          <div class="castle-hp-bar">
            <i style={{ width: `${wall}%` }} />
          </div>
          <b>{wall}%</b>
        </div>
        <div class="pill castle-score">{sim.score.toLocaleString('en-US')} pts</div>
      </div>
      {dragon && sim.phase === 'play' && (
        <div class="castle-boss pop-in">
          <span>Smok</span>
          <div class="castle-boss-bar">
            <i style={{ width: `${(100 * Math.max(0, dragon.hp)) / dragon.maxHp}%` }} />
          </div>
        </div>
      )}
      {sim.phase === 'play' && !dragon && sim.pending === 0 && sim.monsters.length > 0 && sim.monsters.length <= 3 && (
        <div class="castle-left">
          {sim.monsters.length} {sim.monsters.length === 1 ? 'monster' : 'monsters'} left!
        </div>
      )}
      {sim.phase === 'break' && (
        <div class="trails-banner castle-banner pop-in" key={sim.wave}>
          <div class="trails-banner-small">
            Wave {sim.wave} of {sim.waves}
          </div>
          <div class="trails-banner-big">{wave.name}</div>
          <div class="castle-news">{wave.news}</div>
          <div class="castle-cast">
            {[...new Set(wave.groups.map(([k]) => k))].map((k) => (
              <span class="castle-cast-chip">{MONSTERS[k].name}</span>
            ))}
          </div>
          {sim.wave === 1 && <div class="castle-howto">On your phone: drag back to draw · aim · let go · tap Volley</div>}
        </div>
      )}
      {sim.phase === 'break' && (
        <div class="castle-count">
          <BigCountdown endsAt={game.breakEndsAt} key={`c${sim.wave}`} go="Fire!" />
        </div>
      )}
      {sim.over && (
        <div class={`trails-banner castle-banner castle-end ${sim.phase} pop-in`}>
          <div class="trails-banner-big">{sim.phase === 'won' ? 'Malbork stands!' : 'The castle has fallen!'}</div>
          <div class="castle-news">
            {sim.phase === 'won' ? WIN_LINES[sim.stars] : `You held ${sim.wave - 1} of ${sim.waves} waves`} · {sim.kills} monsters slain
          </div>
          <div class="castle-crew">
            {sim.archers
              .map((a, i) => ({ a, i, p: game.playerAt(i) }))
              .filter((r) => r.p && r.a.active)
              .sort((x, y) => y.a.points - x.a.points)
              .map((r) => (
                <div class="castle-crew-row">
                  <Pierogi color={colorHex(r.p!.color)} size={44} mood={sim.phase === 'won' ? 'wow' : 'dead'} />
                  <span>{r.p!.name}</span>
                  <b>{r.a.points}</b>
                  <small>
                    {r.a.kills} slain · {r.a.shots ? Math.round((100 * r.a.hits) / r.a.shots) : 0}% hits
                  </small>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
