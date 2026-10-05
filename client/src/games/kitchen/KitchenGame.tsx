import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { FILLINGS, colorHex, fillingInfo, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { DT_MS, KitchenSim, type KEvent, type Order } from './logic';
import { CANVAS_H, CANVAS_W, drawDynamic, drawStatic, type CookLook, type Popup } from './draw';
import { FillingIcon, ItemIcon, fillingImage, itemImage, whenLoaded } from './art';
import { CountUp } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { Stars } from '../../lib/stars';
import { sound } from '../../lib/sound';

/** How long "Service over!" stays up before the results. */
const OVER_MS = 5000;
/** Phones get fresh button hints this often (in sim ticks). */
const VIEW_EVERY = 6;

export class KitchenGame implements Game {
  readonly id = 'kitchen' as const;
  readonly sim: KitchenSim;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private ticks = 0;
  private timer: number | undefined;
  private canvas: HTMLCanvasElement | null = null;
  private staticLayer: HTMLCanvasElement;
  private popups: Popup[] = [];
  private lastCount = -1;
  private disposed = false;
  clockEl: HTMLElement | null = null;
  prepEl: HTMLElement | null = null;
  readonly ticketEls = new Map<number, HTMLElement>();

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.sim = new KitchenSim(ids, (Math.random() * 2 ** 31) | 0);
    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = CANVAS_W;
    this.staticLayer.height = CANVAS_H;
    this.paintStatic();
    // Repaint once the crate and sack drawings have decoded.
    void whenLoaded([itemImage({ k: 'flour' }), ...FILLINGS.map((f) => fillingImage(f.id))]).then(() => !this.disposed && this.paintStatic());
  }

  private paintStatic() {
    drawStatic(this.staticLayer.getContext('2d')!, this.sim);
  }

  start() {
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.host.refresh();
    this.host.changed();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
  }

  // ---- loop -------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    while (this.acc >= DT_MS) {
      this.acc -= DT_MS;
      this.sim.step();
      this.ticks++;
      this.handle(this.sim.drain(), now);
      if (this.ticks % VIEW_EVERY === 0) this.host.refresh();
    }
    this.draw(now);
    this.updateDom();
  };

  private handle(events: KEvent[], now: number) {
    let changed = false;
    for (const ev of events) {
      switch (ev.e) {
        case 'phase':
          changed = true;
          this.host.refresh();
          if (ev.phase === 'play') sound.go();
          else {
            sound.whistle();
            clearTimeout(this.timer);
            this.timer = window.setTimeout(() => this.end(), OVER_MS);
          }
          break;
        case 'order':
          sound.bell();
          changed = true;
          break;
        case 'served':
          sound.serve();
          this.popup(`+${ev.points}`, ev.x, ev.y, '#ffd23f', now);
          this.host.buzz(ev.by, [40, 40, 60]);
          changed = true;
          break;
        case 'expired':
          sound.wrong();
          changed = true;
          break;
        case 'reject':
          sound.wrong();
          this.popup('Not ordered!', ev.x, ev.y, '#ff7a93', now);
          this.host.buzz(ev.by, [150]);
          break;
        case 'pick':
        case 'drop':
          sound.plop();
          this.host.refresh(ev.by);
          break;
        case 'trash':
          sound.leave();
          this.popup('Binned', ev.x, ev.y, '#d9c8a8', now);
          this.host.refresh(ev.by);
          break;
        case 'mini':
          sound.lockIn();
          this.host.refresh(ev.by);
          break;
        case 'made':
          sound.pickup();
          this.popup('✓', ev.x, ev.y, this.colorOf(ev.by), now);
          this.host.refresh(ev.by);
          break;
        case 'mushy':
          sound.crash();
          this.popup('Mushy!', ev.x, ev.y, '#c7d97a', now);
          break;
        case 'dishes':
          sound.tick();
          break;
      }
    }
    if (changed) this.host.changed();
  }

  private popup(text: string, x: number, y: number, color: string, now: number) {
    this.popups.push({ text, x, y, color, t0: now });
  }

  private end() {
    const scores: Record<string, number> = {};
    for (const c of this.sim.cooks) scores[c.id] = c.jobs + c.served;
    this.host.finish(scores, { score: this.sim.score, stars: this.sim.stars, served: this.sim.served, missed: this.sim.expired });
  }

  private colorOf(id: string) {
    return colorHex(this.host.player(id)?.color ?? 'sourcream');
  }

  private draw(now: number) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(this.staticLayer, 0, 0);
    const looks = new Map<string, CookLook>();
    for (const c of this.sim.cooks) {
      const p = this.host.player(c.id);
      if (!p) continue;
      looks.set(c.id, { color: colorHex(p.color), name: p.name, offline: !p.connected, canAct: this.sim.hint(c.id) !== null });
    }
    drawDynamic(ctx, this.sim, looks, this.popups, now);
  }

  /** Cheap per-frame DOM updates (clock, ticket timers) without re-rendering Preact. */
  private updateDom() {
    const sim = this.sim;
    if (this.clockEl) {
      const secs = Math.ceil(sim.timeLeft / 1000);
      const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      if (this.clockEl.textContent !== text) this.clockEl.textContent = text;
      this.clockEl.classList.toggle('low', sim.phase === 'play' && secs <= 30);
    }
    if (sim.phase === 'prep') {
      const left = Math.ceil((sim.playStart - sim.t) / 1000);
      if (left !== this.lastCount) {
        this.lastCount = left;
        if (left <= 3 && left > 0) sound.count();
        if (this.prepEl) this.prepEl.textContent = String(left);
      }
    }
    for (const o of sim.orders) {
      const el = this.ticketEls.get(o.id);
      if (!el) continue;
      const k = Math.max(0, (o.born + o.ttl - sim.t) / o.ttl);
      el.style.transform = `scaleX(${k})`;
      el.dataset.level = k < 0.25 ? 'low' : k < 0.5 ? 'mid' : 'ok';
    }
  }

  // ---- input & connection ----------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    switch (m.t) {
      case 'stick': {
        const ax = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) / 100 : 0);
        this.sim.setStick(id, ax(m.x), ax(m.y));
        break;
      }
      case 'act':
        if (this.sim.act(id)) this.host.refresh(id);
        break;
      case 'mini':
        if (typeof m.id !== 'number') return;
        if (m.ev === 'prog') this.sim.miniProgress(id, m.id, Number(m.p));
        else if (m.ev === 'done') this.sim.miniDone(id, m.id);
        else if (m.ev === 'cancel') this.sim.miniCancel(id, m.id);
        this.host.refresh(id);
        break;
    }
  }

  onConnection(id: string, connected: boolean) {
    if (!connected) this.sim.pause(id);
    this.host.changed();
  }

  onRemoved(id: string) {
    this.sim.remove(id);
    this.host.changed();
    if (this.sim.cooks.length === 0) this.host.finish({});
  }

  viewFor(id: string): PhoneView {
    const st = this.sim.viewState(id);
    if (!st) return { v: 'wait', title: 'Pierogi Panic', text: 'Watch the kitchen on the TV!', icon: 'kitchen' };
    return { v: 'kitchen', phase: this.sim.phase, hold: st.hold, hint: st.hint, mini: st.mini, score: this.sim.score };
  }

  // ---- TV ---------------------------------------------------------------------

  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
  }

  render() {
    return <KitchenView game={this} />;
  }

  get crew() {
    return this.sim.cooks.map((c) => ({ c, p: this.host.player(c.id) })).filter((x) => !!x.p);
  }
}

// ---------------------------------------------------------------------------
// TV view
// ---------------------------------------------------------------------------

export const RECIPE: { icon: JSX.Element; text: string }[] = [
  { icon: <ItemIcon item={{ k: 'flour' }} size={54} />, text: 'Take flour to a rolling board and roll it' },
  { icon: <ItemIcon item={{ k: 'fill', f: 'potato' }} size={54} />, text: 'Dough + filling on a pierogi board, then fold' },
  { icon: <ItemIcon item={{ k: 'raw', f: 'potato' }} size={54} />, text: 'Boil the raw pierogi on the stove' },
  { icon: <ItemIcon item={{ k: 'plate', f: 'potato' }} size={54} />, text: 'Bring a plate, plate up and serve at the hatch' },
  { icon: <ItemIcon item={{ k: 'dirty', n: 1 }} size={54} />, text: 'Dirty plates come back – wash them in the sink' },
];

function KitchenView({ game }: { game: KitchenGame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    game.attach(ref.current);
    return () => game.attach(null);
  }, [game]);
  const sim = game.sim;
  const [t1, t2, t3] = sim.thresholds;
  const max = t3 * 1.15;
  return (
    <div class="screen kitchen">
      <div class="k-top">
        <div class="k-orders">
          {sim.orders.map((o) => (
            <Ticket order={o} game={game} key={o.id} />
          ))}
          {sim.phase === 'play' && sim.orders.length === 0 && <div class="k-orders-empty">All orders served – more on the way!</div>}
          {sim.phase === 'prep' && <div class="k-orders-empty">Orders appear here</div>}
        </div>
        <div class="k-clock">
          <small>Time left</small>
          <b ref={(el) => {
              game.clockEl = el;
            }}>3:00</b>
        </div>
      </div>
      <div class="k-main">
        <div class="k-arena">
          <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} class="k-canvas" />
          {sim.phase === 'prep' && (
            <div class="k-prep pop-in">
              <div class="k-prep-title">Kitchen opens in</div>
              <div class="k-prep-count" ref={(el) => {
                  game.prepEl = el;
                }} />
              <div class="k-prep-hint">Find your chef – joystick to walk, button for everything else</div>
            </div>
          )}
          {sim.phase === 'over' && (
            <div class="k-over pop-in">
              <div class="k-over-small">Service over!</div>
              <Stars n={sim.stars} size={84} />
              <div class="k-over-big">{sim.score.toLocaleString('en-US')} tips</div>
              <div class="k-over-small">
                {sim.served} served · {sim.expired} missed
              </div>
            </div>
          )}
        </div>
        <aside class="k-side">
          <div class="k-score card-paper">
            <small>Team tips</small>
            <b>
              <CountUp value={sim.score} />
            </b>
            <div class="k-meter">
              <div class="k-meter-fill" style={{ width: `${Math.min(100, (sim.score / max) * 100)}%` }} />
              {[t1, t2, t3].map((t) => (
                <span class={`k-meter-star ${sim.score >= t ? 'on' : ''}`} style={{ left: `${(t / max) * 100}%` }}>
                  ★
                </span>
              ))}
            </div>
          </div>
          <div class="k-recipe">
            <div class="k-recipe-title">How to cook</div>
            {RECIPE.map((r, i) => (
              <div class="k-recipe-row">
                <span class="k-recipe-num">{i + 1}</span>
                {r.icon}
                <span>{r.text}</span>
              </div>
            ))}
          </div>
          <div class="k-crew">
            {game.crew.map(({ c, p }) => (
              <span class={`k-crew-chip ${p!.connected ? '' : 'offline'}`} style={{ color: colorHex(p!.color) }}>
                <Pierogi color={colorHex(p!.color)} size={30} mood={p!.connected ? 'happy' : 'sleep'} />
                {c.served > 0 ? `${c.served}` : ''}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Ticket({ order, game }: { order: Order; game: KitchenGame }) {
  const info = fillingInfo(order.f);
  return (
    <div class="k-ticket" style={{ '--fc': info.hex }}>
      <div class="k-ticket-pic">
        <ItemIcon item={{ k: 'plate', f: order.f }} size={78} />
      </div>
      <div class="k-ticket-body">
        <div class="k-ticket-name">
          <FillingIcon f={order.f} size={30} />
          {info.name}
        </div>
        <div class="k-ticket-bar">
          <div
            class="k-ticket-fill"
            ref={(el) => {
              if (el) game.ticketEls.set(order.id, el);
              else game.ticketEls.delete(order.id);
            }}
          />
        </div>
      </div>
    </div>
  );
}
