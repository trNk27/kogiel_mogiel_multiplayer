/**
 * A second screen's copy of the host TV. Frames from the host (host/caster.ts) are applied to a
 * replica of the host's controller, and the host's drawing and sound calls are replayed on the
 * screen's own scenes. The screen then shows the very same HostApp the host TV runs.
 *
 * Timing: frames are played back on the host's clock, a little behind it so that a frame that
 * arrives late still comes on time (a jitter buffer that adapts to the network). This page's
 * clocks (`performance.now`, `Date.now`, animation frames) are moved to match the frame on show,
 * so countdowns and animations that compare with times in the host's state work unchanged.
 */
import type { TvFrame } from '../../../shared/protocol';
import { Decoder, type Enc, type Patch } from '../lib/replica/codec';
import { classes } from '../lib/replica/classes';
import { Sound, sound } from '../lib/sound';
import type { HostController } from '../host/controller';
import { SOUND } from '../host/caster';
import { replicaMode } from '../lib/replica/mode';

const realPerf = performance.now.bind(performance);
const realRaf = window.requestAnimationFrame.bind(window);

/** Never wait longer than this for late frames. */
const MAX_DELAY_MS = 150;
/** A little on top of the worst recent lateness. */
const DELAY_MARGIN_MS = 6;
/** Frames waiting to play beyond this (some seconds' worth) are dropped for a full frame. */
const MAX_QUEUE = 600;
/** Frames to judge the network by (a couple of seconds' worth). */
const LATE_SAMPLES = 120;
/** How fast the clock may drift towards where it should be, per ms (keeps it running forwards). */
const SLEW = 0.15;

let replaying = false;
let installed = false;
/** Local perf time minus the host perf time on show. */
let shift = 0;
/** Host Date.now minus host performance.now. */
let dateMinusPerf = Date.now() - performance.now();

/** Make this page a copy of the host TV (once): its clocks move onto the host's, and its sounds come from the host. */
function install() {
  if (installed) return;
  installed = true;
  replicaMode.on = true;
  const perf = () => realPerf() - shift;
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: perf });
  Object.defineProperty(Date, 'now', { configurable: true, writable: true, value: () => Math.floor(perf() + dateMinusPerf) });
  window.requestAnimationFrame = (cb: FrameRequestCallback) => (typeof cb === 'function' ? realRaf((t) => cb(t - shift)) : realRaf(cb));
  // Sounds play only when the host played them (see `replay`), not when this page's own copy of
  // the TV would (a countdown ticking, say): the host's are replayed already.
  for (const name of Object.getOwnPropertyNames(Sound.prototype)) {
    if (name === 'constructor' || name === 'unlock' || name === 'tone' || name === 'noise' || name === 'later') continue;
    const desc = Object.getOwnPropertyDescriptor(Sound.prototype, name);
    if (!desc || typeof desc.value !== 'function') continue;
    const orig = desc.value as (...a: unknown[]) => unknown;
    (Sound.prototype as unknown as Record<string, unknown>)[name] = function (this: Sound, ...args: unknown[]) {
      if (replaying) return orig.apply(this, args);
    };
  }
}

export interface ReplicaStats {
  /** How long frames wait here beyond the fastest one, so late ones still play on time. */
  bufferMs: number;
  framesPerSec: number;
  kbps: number;
  objects: number;
}

export class Replica {
  // Fields the host doesn't send but the screen's copy needs: `static replicaInit(o)` on the class.
  private dec = new Decoder(classes, (o) => (o.constructor as { replicaInit?: (o: object) => void }).replicaInit?.(o));
  private queue: TvFrame[] = [];
  private last = -1;
  private epoch = '';
  /** Lowest (arrival time − host time) seen lately: the clock offset plus the fastest trip. */
  private off: number | null = null;
  /** How late frames have been lately, beyond the fastest. */
  private jitter = 0;
  private target = 0;
  /** How late recent frames came, beyond the fastest. */
  private lateness: number[] = [];
  private lateAt = 0;
  private raf = 0;
  private lastTick = 0;
  private warned = new Set<string>();
  private frames = 0;
  private bytes = 0;
  private statsAt = realPerf();
  /** The room as the screen sees it; null until the first full frame. */
  root: HostController | null = null;
  /** Changes when the root does (the host started over), so the page remounts the TV. */
  epochKey = 0;

  constructor(private onRoot: (root: HostController | null) => void) {
    install();
    const tick = () => {
      this.raf = realRaf(tick);
      this.play();
    };
    this.raf = realRaf(tick);
  }

  close() {
    cancelAnimationFrame(this.raf);
  }

  /** A frame arrived. False: frames went missing, and the host should send everything again. */
  push(f: TvFrame, size: number): boolean {
    this.bytes += size;
    const now = realPerf();
    const o = now - f.p;
    if (this.off === null || f.t === 'F' && Math.abs(o - this.off) > 2000) {
      // First frame, or the host's clock restarted (it reloaded).
      this.off = o;
      this.jitter = 0;
      this.lateness = [];
      shift = o + DELAY_MARGIN_MS;
    } else if (o < this.off) this.off = o;
    // Creep back up slowly, so one lucky fast frame (or clocks drifting apart) doesn't stick.
    else this.off += (o - this.off) * 0.002;
    // A full frame is big and slow to parse: it says nothing about the network.
    if (f.t !== 'F') {
      this.lateness[this.lateAt++ % LATE_SAMPLES] = o - this.off;
      // Wait long enough for all but the latest few frames lately: one stray late frame is
      // better skipped over than making every frame wait for it.
      const sorted = this.lateness.slice().sort((a, b) => a - b);
      this.jitter = sorted[Math.floor((sorted.length - 1) * 0.95)];
    }
    this.target = this.off + Math.min(MAX_DELAY_MS, this.jitter + DELAY_MARGIN_MS);

    if (f.t === 'F') {
      this.queue = [f];
      this.last = f.n;
      // Show it straight away.
      this.play(true);
      return true;
    }
    if (this.last < 0 || f.n <= this.last) return true; // from before the last full frame
    // A gap, or a backlog (this tab was hidden, so nothing played): start over from a full frame.
    if (f.n !== this.last + 1 || this.queue.length > MAX_QUEUE) {
      this.last = -1;
      this.queue = [];
      return false;
    }
    this.last = f.n;
    this.queue.push(f);
    return true;
  }

  stats(): ReplicaStats {
    const now = realPerf();
    const secs = Math.max(0.001, (now - this.statsAt) / 1000);
    const s = {
      bufferMs: this.off === null ? 0 : Math.max(0, shift - this.off),
      framesPerSec: this.frames / secs,
      kbps: (this.bytes * 8) / 1000 / secs,
      objects: this.dec.size,
    };
    this.frames = 0;
    this.bytes = 0;
    this.statsAt = now;
    return s;
  }

  /** Apply the frames that are due, on the host's clock. */
  private play(now = false) {
    const t = realPerf();
    const dt = Math.min(100, t - (this.lastTick || t));
    this.lastTick = t;
    // Ease the clock towards the target, never backwards faster than time goes forwards.
    const d = this.target - shift;
    shift += Math.sign(d) * Math.min(Math.abs(d), dt * SLEW);
    let changed = false;
    while (this.queue.length) {
      const f = this.queue[0];
      if (!now && f.p > realPerf() - shift) break;
      this.queue.shift();
      changed = this.apply(f) || changed;
      now = false;
    }
    if (changed && this.root) this.root.changed();
  }

  private apply(f: TvFrame): boolean {
    this.frames++;
    dateMinusPerf = f.d - f.p;
    if (f.t === 'F') {
      if (f.e !== this.epoch) {
        this.dec.reset();
        this.epoch = f.e ?? '';
      }
      try {
        this.dec.apply(f.x as Patch);
      } catch (err) {
        console.error('[screen]', err);
      }
      const root = this.dec.root as HostController | null;
      if (root !== this.root) {
        this.root = root;
        this.epochKey++;
        this.onRoot(root);
      }
      this.mute();
      return true;
    }
    if (f.x) {
      try {
        this.dec.apply(f.x as Patch);
      } catch (err) {
        console.error('[screen]', err);
      }
      this.mute();
    }
    if (f.k) this.replay(f.k as [Enc, string, Enc[]][]);
    return !!f.ch;
  }

  /** The host's sound setting counts here too; this screen's own mute button is on top. */
  muted = false;
  private mute() {
    sound.muted = this.muted || !(this.root?.options.sound ?? true);
  }

  private replay(calls: [Enc, string, Enc[]][]) {
    try {
      for (const [at, method, args] of calls) {
        let target: unknown;
        replaying = at === SOUND;
        if (at === SOUND) target = sound;
        else if (typeof at === 'number') target = this.dec.get(at);
        else if (Array.isArray(at)) target = (this.dec.get(at[0] as number) as Record<string, unknown> | undefined)?.[at[1] as string];
        const fn = target && (target as Record<string, unknown>)[method];
        if (typeof fn !== 'function') continue;
        try {
          fn.apply(target, args.map((a) => this.dec.value(a)));
        } catch (err) {
          const key = `${method}`;
          if (!this.warned.has(key)) {
            this.warned.add(key);
            console.warn('[screen] replaying', method, err);
          }
        }
      }
    } finally {
      replaying = false;
    }
  }
}
