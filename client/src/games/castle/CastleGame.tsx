import { useEffect, useRef } from 'preact/hooks';
import { colorHex, siegeMode, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { CastleSim, DT, END_S, H, MONSTERS, W, WAVES, type CEvent } from './logic';
import { Effects, drawBackground, drawScene, type ArcherLook } from './draw';
import './castle.css';

/** How often the TV's HUD and the phones' views catch up (ms). */
const HUD_MS = 150;
const VIEW_MS = 250;

const WIN_LINES = ['', 'The wall held – just!', 'Wawel stands proud!', 'Legends of Kraków!'];

export class CastleGame implements Game {
  readonly id = 'castle' as const;
  sim: CastleSim;
  /** Host clock (Date.now) when the current break ends, for the countdown. */
  breakEndsAt = 0;
  private fx = new Effects();
  private bg: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
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
    this.updateLooks();
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, CastleGame>).castle = this;
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
    this.ctx = canvas.getContext('2d');
    const bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    drawBackground(bg.getContext('2d')!);
    this.bg = bg;
    // Repaint once the display font has loaded (the name tags use it).
    void document.fonts?.ready.then(() => this.bg && drawBackground(this.bg.getContext('2d')!));
  }

  detach() {
    this.ctx = null;
    this.bg = null;
  }

  private updateLooks() {
    this.looks = this.ids.map((id) => {
      const p = this.host.player(id);
      return { color: colorHex(p?.color ?? 'sourcream'), name: p?.name ?? '?', connected: !!p?.connected };
    });
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
    this.fx.step(elapsed);
    if (this.ctx && this.bg) drawScene(this.ctx, this.bg, this.sim, this.looks, this.fx, now / 1000);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
    if (now - this.lastView > VIEW_MS) {
      this.lastView = now;
      this.host.refresh();
    }
  };

  private handle(events: CEvent[]) {
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
        case 'hit':
          sound.plop();
          this.fx.burst(ev.x, ev.y, '#fff4dc', 6, 160);
          break;
        case 'kill': {
          const color = this.looks[ev.by]?.color ?? '#fff';
          const big = ev.kind === 'dragon';
          this.fx.burst(ev.x, ev.y, color, big ? 60 : 16, big ? 520 : 280);
          this.fx.pop(ev.x, ev.y - 30, big ? `Smok down! +${ev.pts}` : `+${ev.pts}`, color, big);
          if (big) {
            sound.fanfare();
            this.fx.shake = 24;
          } else if (ev.kind === 'fireball') sound.tick();
          else sound.pickup();
          this.host.buzz(this.ids[ev.by], big ? [80, 40, 80, 40, 160] : [30]);
          break;
        }
        case 'wall': {
          this.fx.dust(ev.x);
          if (ev.kind === 'fireball') {
            this.fx.burst(ev.x, 850, '#ff9a3c', 22, 320);
            this.fx.shake = Math.max(this.fx.shake, 14);
            sound.crash();
          } else if (performance.now() - this.lastThump > 400) {
            this.lastThump = performance.now();
            this.fx.shake = Math.max(this.fx.shake, ev.kind === 'giant' ? 12 : 4);
            sound.tick();
          }
          break;
        }
        case 'fire':
          sound.whoosh();
          break;
        case 'summon':
          this.fx.burst(ev.x, ev.y, '#6b4590', 20, 260);
          break;
        case 'won':
        case 'lost':
          if (ev.e === 'won') sound.fanfare();
          else {
            sound.wrong();
            this.fx.shake = 30;
          }
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
    if (m.t !== 'bow') return;
    const i = this.ids.indexOf(id);
    if (i < 0) return;
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
    };
    if (sim.phase === 'won') return { ...base, phase: 'won', title: 'Victory!', text: WIN_LINES[sim.stars] };
    if (sim.phase === 'lost') return { ...base, phase: 'lost', title: 'The castle has fallen!', text: '📺' };
    if (sim.phase === 'break') return { ...base, phase: 'break', title: `Wave ${sim.wave}: ${sim.current.name}`, text: sim.current.news };
    const dragon = sim.dragon;
    return { ...base, phase: 'play', ...(dragon ? { title: 'Smok Wawelski!', text: 'Shoot down his fireballs!' } : {}) };
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
  return (
    <div class="castle">
      <canvas ref={canvas} class="castle-canvas" width={W} height={H} />
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
          <span>Smok Wawelski</span>
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
          {sim.wave === 1 && <div class="castle-howto">On your phone: drag back to draw · aim · let go</div>}
        </div>
      )}
      {sim.phase === 'break' && (
        <div class="castle-count">
          <BigCountdown endsAt={game.breakEndsAt} key={`c${sim.wave}`} go="Fire!" />
        </div>
      )}
      {sim.over && (
        <div class={`trails-banner castle-banner castle-end ${sim.phase} pop-in`}>
          <div class="trails-banner-big">{sim.phase === 'won' ? 'Wawel stands!' : 'The castle has fallen!'}</div>
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
