/**
 * Second screens, the host's side of the data: every frame, what changed in the room (the
 * controller and everything it holds, the running game included) plus the calls the TV made to
 * draw and to play sounds, so a second screen can draw the TV itself.
 *
 * - The state goes through the replica `Encoder` (only what changed since the last frame).
 * - Drawing goes through "views" (3D scenes, the minimap) and a few drawing methods of the games.
 *   The screen makes its own views; the calls the host makes to its views are recorded here and
 *   replayed there, against the screen's copies of the same objects.
 * - Sounds are synthesized (lib/sound.ts), so they're replayed the same way: every sound the host
 *   plays, wherever from, and nothing else.
 *
 * A frame goes out right after the task that changed something (a microtask), so one game frame
 * makes one TV frame. Nothing runs while no second screen is connected.
 */
import type { TvFrame } from '../../../shared/protocol';
import { Encoder } from '../lib/replica/codec';
import { classes } from '../lib/replica/classes';
import { Sound, sound } from '../lib/sound';
import type { MirrorHost } from './mirror';
import type { HostController } from './controller';
import { VoteScene } from './vote/scene';
import { TanksScene } from '../games/tanks/scene';
import { PushyScene } from '../games/pushy/scene';
import { MushroomScene } from '../games/mushroom/scene';
import { GalleryScene } from '../games/gallery/scene';
import { GalleryGame } from '../games/gallery/GalleryGame';
import { SmokeScene } from '../games/smoke/scene';
import { RallyScene } from '../games/rally/render3d';
import { Minimap } from '../games/rally/minimap';
import { RallyGame } from '../games/rally/RallyGame';
import { TilesScene } from '../games/tiles/scene';
import { CookbookScene } from '../games/cookbook/scene';
import { Showroom } from '../games/premium/showroom';
import { KitchenGame } from '../games/kitchen/KitchenGame';
import { TrailsGame } from '../games/trails/TrailsGame';

type Ctor = abstract new (...args: any[]) => unknown;

/** Objects each side draws with its own copy: never sent; the host's calls to them are replayed. */
const VIEWS: Ctor[] = [TanksScene, PushyScene, MushroomScene, GalleryScene, SmokeScene, RallyScene, Minimap, TilesScene, CookbookScene, VoteScene, Showroom];

/** Methods of replicated objects that only draw: replayed on the screen's copy. */
const DRAWS: [Ctor, string[]][] = [
  [KitchenGame, ['draw', 'updateDom', 'paintStatic']],
  [TrailsGame, ['draw', 'paintTrail']],
  [GalleryGame, ['drawCrosshairs', 'muzzle', 'popText', 'flashCross']],
  [RallyGame, ['drawMap']],
];

/** Never replayed: the screen makes and throws away its own views, and asks them its own questions. */
const NOT_REPLAYED = new Set(['constructor', 'dispose', 'project', 'point', 'labelAt', 'actorPos', 'toStage']);
/** The sound player's internals (each effect is replayed whole). */
const SOUND_INTERNAL = new Set(['unlock', 'tone', 'noise', 'later']);

/** The address of the global sound player in a replayed call. */
export const SOUND = 's';

let installed = false;
/** Calls already being recorded: anything they call in turn happens on the screen by itself. */
let depth = 0;
let current: TvCaster | null = null;
const viewSet = new Set<unknown>(VIEWS);

/**
 * Record calls to a method. Sounds are recorded wherever they're played from (a screen plays
 * only the host's sounds, never its own); anything else only when nothing recorded is running
 * already (what a recorded call does in turn, the screen's copy does by itself).
 */
function wrap(proto: Record<string, unknown>, name: string, always = false) {
  const desc = Object.getOwnPropertyDescriptor(proto, name);
  if (!desc || typeof desc.value !== 'function') return;
  const orig = desc.value as (...a: unknown[]) => unknown;
  proto[name] = function (this: object, ...args: unknown[]) {
    if (always && current) {
      current.record(this, name, args);
      return orig.apply(this, args);
    }
    if (depth > 0 || !current) return orig.apply(this, args);
    current.record(this, name, args);
    depth++;
    try {
      return orig.apply(this, args);
    } finally {
      depth--;
    }
  };
}

function methodsOf(proto: object): string[] {
  return Object.getOwnPropertyNames(proto).filter((n) => !NOT_REPLAYED.has(n) && typeof Object.getOwnPropertyDescriptor(proto, n)?.value === 'function');
}

/** Record calls on the host (once per page). */
function install() {
  if (installed) return;
  installed = true;
  for (const C of VIEWS) for (const n of methodsOf(C.prototype)) wrap(C.prototype, n);
  for (const [C, names] of DRAWS) for (const n of names) wrap(C.prototype, n);
  for (const n of methodsOf(Sound.prototype)) if (!SOUND_INTERNAL.has(n)) wrap(Sound.prototype as unknown as Record<string, unknown>, n, true);
}

const skipOf = (o: object) => (o.constructor as { replicaSkip?: readonly string[] } | undefined)?.replicaSkip;

/** Send state at least this often, for views that read it every frame without telling the host. */
const HEARTBEAT_MS = 50;

export class TvCaster {
  private enc: Encoder | null = null;
  private calls: [object, string, unknown[]][] = [];
  private dirty = false;
  private scheduled = false;
  private seq = 0;
  private lastFlush = 0;
  private beat = 0;
  /** For the panel: how long the last frame took to build. */
  buildMs = 0;
  private warned = new Set<unknown>();
  /** Player id → what screens see instead. */
  private aliases = new Map<string, string>();

  constructor(
    private root: HostController,
    private links: MirrorHost,
  ) {}

  /** A screen needs everything (it just arrived, or it lost track): send it a full frame. */
  ready(id: string) {
    this.activate();
    this.flush();
    if (!this.enc) return;
    this.links.sendFull(id, { t: 'F', n: this.seq, p: performance.now(), d: Date.now(), x: this.enc.full(), e: this.enc.epoch });
  }

  /** The host re-rendered: tell the screens to as well. */
  changed() {
    if (!this.enc) return;
    this.dirty = true;
    this.schedule();
  }

  record(target: object, method: string, args: unknown[]) {
    const enc = this.enc;
    if (!enc) return;
    // Only objects the screens know already: what a view does while it's being made (from its
    // constructor), the screen's own copy does when it makes itself.
    if (target !== sound && enc.idOf(target) === undefined && !enc.viewAt(target)) return;
    // A runaway loop without a frame in between shouldn't eat the host's memory.
    if (this.calls.length < 10_000) this.calls.push([target, method, args]);
    this.schedule();
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  private activate() {
    if (this.enc) return;
    install();
    this.enc = new Encoder({
      registry: classes,
      isView: (o) => viewSet.has(o.constructor),
      skip: skipOf,
      // Phones connect with their ids alone: screens see them only as aliases.
      alias: (s) => this.aliases.get(s),
      onUnknown: (o) => {
        if (this.warned.has(o.constructor)) return;
        this.warned.add(o.constructor);
        if (import.meta.env.DEV) console.debug('[screens] not sent:', o.constructor?.name);
      },
    });
    current = this;
    this.calls = [];
    const tick = () => {
      if (!this.enc) return;
      this.beat = requestAnimationFrame(tick);
      if (performance.now() - this.lastFlush > HEARTBEAT_MS) this.flush();
    };
    this.beat = requestAnimationFrame(tick);
  }

  private deactivate() {
    this.enc = null;
    if (current === this) current = null;
    this.calls = [];
    cancelAnimationFrame(this.beat);
  }

  private flush() {
    this.scheduled = false;
    const enc = this.enc;
    if (!enc) return;
    if (this.links.count === 0) {
      this.deactivate();
      return;
    }
    const t0 = performance.now();
    this.lastFlush = t0;
    for (const id of this.root.players.keys()) if (!this.aliases.has(id)) this.aliases.set(id, `~${this.aliases.size + 1}`);
    let x = null;
    try {
      x = enc.diff(this.root);
    } catch (err) {
      console.error('[screens]', err);
    }
    const k: unknown[] = [];
    for (const [target, method, args] of this.calls) {
      const at = target === sound ? SOUND : (enc.idOf(target) ?? enc.viewAt(target));
      if (at === undefined) continue;
      k.push([at, method, args.map((a) => enc.arg(a))]);
    }
    this.calls = [];
    const ch = this.dirty;
    this.dirty = false;
    if (!x && !k.length && !ch) return;
    this.seq++;
    const f: TvFrame = { t: 'f', n: this.seq, p: t0, d: Date.now() };
    if (x) f.x = x;
    if (k.length) f.k = k;
    if (ch) f.ch = 1;
    this.links.broadcast(f);
    this.buildMs = performance.now() - t0;
  }
}
