/**
 * Object-graph replication: the host TV's controller (lobby, players, the running game and its
 * simulation) copied to second screens as data, so they can draw the TV themselves.
 *
 * The host's `Encoder` walks everything reachable from a root object and gives each object an id.
 * It remembers what it last sent for every object, so each `diff()` carries only what changed:
 * new objects in full, changed fields, and the ids of objects nothing points to any more. The
 * screen's `Decoder` applies that to its own copy *in place*, so an object keeps its identity for
 * as long as it lives on the host (scenes that hold on to a simulation keep drawing the right one).
 *
 * Class instances keep their class: both sides share a registry of the app's classes (see
 * `classes.ts`), so methods and getters work on the copy. Functions, DOM nodes, WebGL and other
 * objects of unknown classes aren't sent. "View" objects (3D scenes, the sound player) aren't sent
 * either: the screen makes its own, and the host's calls to them are replayed (see `caster.ts`).
 */

/** Finds the shared name of a class, and the class for a name. */
export interface ClassRegistry {
  key(ctor: unknown): string | undefined;
  ctor(key: string): (abstract new (...args: never[]) => unknown) | undefined;
}

/**
 * An encoded value: a JSON primitive, or a short array.
 *   [id]               a reference to a replicated object
 *   []                 undefined
 *   ['N'|'I'|'-I']     NaN, Infinity, -Infinity
 *   ['a', [...]]       an inline array (call arguments only)
 *   ['o', {...}, cls?] an inline object
 *   ['m', [k, v, …]]   an inline Map
 *   ['s', [...]]       an inline Set
 *   ['t', name, [...]] an inline typed array
 */
export type Enc = number | string | boolean | null | Enc[] | { [k: string]: Enc };

export const enum Kind {
  Object = 0,
  Array = 1,
  Map = 2,
  Set = 3,
  Typed = 4,
  Date = 5,
}

/** A new object (or a Map, Set, typed array or Date whose contents changed): id, kind, class, contents. */
export type Create = [number, Kind, string, Enc[] | number];
/**
 * Changed fields of an object `[id, key, value, …]` (value `[]`: deleted), of an array
 * `[id, length, index, value, …]`, or of a typed array `[id, index, value, …]`.
 */
export type Update = (number | string | Enc)[];

export interface Patch {
  /** The root's id (full snapshots only). */
  r?: number;
  c?: Create[];
  u?: Update[];
  /** Objects no longer reachable. */
  d?: number[];
}

const UNDEF: Enc[] = [];
/**
 * A field that holds a view, or an object that can't be sent (a canvas, an audio node): never
 * sent, and the screen's own value is left alone.
 */
const VIEW = Symbol('view');

type Shadow =
  | { kind: Kind.Object; cls: string; vals: Map<string, Enc | typeof VIEW> }
  | { kind: Kind.Array; vals: Enc[] }
  | { kind: Kind.Map | Kind.Set; cls: string; vals: Enc[] }
  | { kind: Kind.Typed; cls: string; vals: number[]; raw: TypedArray }
  | { kind: Kind.Date; vals: number };

/** Rounding keeps patches short and stops float noise from counting as a change. */
export function num(v: number): Enc {
  if (Number.isInteger(v)) return v;
  if (Number.isNaN(v)) return ['N'];
  if (!Number.isFinite(v)) return [v > 0 ? 'I' : '-I'];
  return Math.abs(v) < 1e9 ? Math.round(v * 1e4) / 1e4 : Math.round(v);
}

function sameEnc(a: Enc | typeof VIEW | undefined, b: Enc | typeof VIEW): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const TYPED = ['Float32Array', 'Float64Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Uint8ClampedArray'] as const;
type TypedArray = Float32Array | Float64Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | Uint8ClampedArray;

function typedName(o: object): string | undefined {
  if (!ArrayBuffer.isView(o) || o instanceof DataView) return undefined;
  const name = Object.prototype.toString.call(o).slice(8, -1);
  return (TYPED as readonly string[]).includes(name) ? name : undefined;
}

export interface EncoderOptions {
  registry: ClassRegistry;
  /** Objects drawn on each side by their own copy: not sent; calls to them are replayed instead. */
  isView?(o: object): boolean;
  /** Fields of this object not to send. */
  skip?(o: object): readonly string[] | undefined;
  /** Called once per unknown class met, for debugging. */
  onUnknown?(o: object, path: string): void;
  /**
   * Strings (values, Map keys and object keys alike) to send as something else: secrets that the
   * screens may see used but must not learn, like the ids phones connect with.
   */
  alias?(s: string): string | undefined;
}

export class Encoder {
  /** Ids only mean something within one encoder: a screen that sees a new epoch starts over. */
  readonly epoch = Math.random().toString(36).slice(2, 10);
  private ids = new WeakMap<object, number>();
  private next = 1;
  private shadow = new Map<number, Shadow>();
  private views = new WeakMap<object, [number, string]>();
  private rootId = 0;
  private unknown = new WeakSet<object>();

  constructor(private opts: EncoderOptions) {}

  /** The id of a replicated object (one the last `diff` reached). */
  idOf(o: object): number | undefined {
    const id = this.ids.get(o);
    return id !== undefined && this.shadow.has(id) ? id : undefined;
  }

  /** Where a view object lives: the object holding it, and the field. */
  viewAt(o: object): [number, string] | undefined {
    const at = this.views.get(o);
    return at && this.shadow.has(at[0]) ? at : undefined;
  }

  /** How many objects are replicated now. */
  get size() {
    return this.shadow.size;
  }

  /** Walk the graph from `root` and return what changed since the last call (null: nothing). */
  diff(root: object): Patch | null {
    const reached = new Set<number>();
    const creates: Create[] = [];
    const updates: Update[] = [];
    const stack: object[] = [root];
    this.rootId = this.idFor(root);
    reached.add(this.rootId);
    const ref = (v: unknown, owner: object, key: string): Enc | typeof VIEW | undefined => {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return undefined;
      if (typeof v === 'string') return this.str(v);
      if (v === null || typeof v === 'boolean') return v;
      if (typeof v === 'number') return num(v);
      const o = v as object;
      if (this.opts.isView?.(o)) {
        const ownerId = this.ids.get(owner);
        if (ownerId !== undefined) this.views.set(o, [ownerId, key]);
        return VIEW;
      }
      // Something only this side can have (a canvas, a WebGL context): the screen keeps its own.
      if (!this.supported(o, key)) return VIEW;
      const id = this.idFor(o);
      if (!reached.has(id)) {
        reached.add(id);
        stack.push(o);
      }
      return [id];
    };

    while (stack.length) {
      const o = stack.pop()!;
      const id = this.ids.get(o)!;
      const prev = this.shadow.get(id);
      if (Array.isArray(o)) {
        const vals = o.map((v, i) => {
          const e = ref(v, o, String(i));
          return e === undefined || e === VIEW ? UNDEF : e;
        });
        if (!prev || prev.kind !== Kind.Array) {
          creates.push([id, Kind.Array, '', vals]);
        } else {
          const up: Update = [id, vals.length];
          for (let i = 0; i < vals.length; i++) if (!sameEnc(prev.vals[i], vals[i])) up.push(i, vals[i]);
          if (up.length > 2 || prev.vals.length !== vals.length) updates.push(up);
        }
        this.shadow.set(id, { kind: Kind.Array, vals });
      } else if (o instanceof Map || o instanceof Set) {
        const kind = o instanceof Map ? Kind.Map : Kind.Set;
        const vals: Enc[] = [];
        if (o instanceof Map)
          for (const [k, v] of o) {
            const ek = ref(k, o, '');
            const ev = ref(v, o, '');
            if (ek === undefined || ek === VIEW) continue;
            vals.push(ek, ev === undefined || ev === VIEW ? UNDEF : ev);
          }
        else
          for (const v of o) {
            const ev = ref(v, o, '');
            if (ev !== undefined && ev !== VIEW) vals.push(ev);
          }
        if (!prev || prev.kind !== kind || prev.vals.length !== vals.length || prev.vals.some((p, i) => !sameEnc(p, vals[i]))) creates.push([id, kind, '', vals]);
        this.shadow.set(id, { kind, cls: '', vals });
      } else if (o instanceof Date) {
        const t = o.getTime();
        if (!prev || prev.kind !== Kind.Date || prev.vals !== t) creates.push([id, Kind.Date, '', t]);
        this.shadow.set(id, { kind: Kind.Date, vals: t });
      } else if (typedName(o)) {
        const cls = typedName(o)!;
        const t = o as TypedArray;
        if (!prev || prev.kind !== Kind.Typed || prev.cls !== cls || prev.vals.length !== t.length) {
          const vals = Array.from(t, (v) => num(v) as number);
          creates.push([id, Kind.Typed, cls, vals]);
          this.shadow.set(id, { kind: Kind.Typed, cls, vals, raw: t.slice() });
        } else {
          // Big grids change a few cells at a time: send just those. (Compared exactly first:
          // most of a track's numbers never change, and rounding each every frame is slow.)
          const { vals, raw } = prev;
          const up: Update = [id];
          for (let i = 0; i < t.length; i++) {
            if (t[i] === raw[i]) continue;
            raw[i] = t[i];
            const v = num(t[i]) as number;
            if (v !== vals[i]) {
              vals[i] = v;
              up.push(i, v);
            }
          }
          if (up.length > 1) updates.push(up);
        }
      } else {
        const cls = this.clsOf(o) ?? '';
        const skip = this.opts.skip?.(o);
        const fresh = !prev || prev.kind !== Kind.Object || prev.cls !== cls;
        const vals = fresh ? new Map<string, Enc | typeof VIEW>() : (prev.vals as Map<string, Enc | typeof VIEW>);
        const seen = new Set<string>();
        const data: Enc[] = [];
        const up: Update = [id];
        for (const key of Object.keys(o)) {
          if (skip?.includes(key)) continue;
          const was = vals.get(key);
          if (was === VIEW) {
            // Once a view, always a view: don't send its null when the host's own view goes away.
            seen.add(key);
            ref((o as Record<string, unknown>)[key], o, key);
            continue;
          }
          const e = ref((o as Record<string, unknown>)[key], o, key);
          if (e === undefined) continue;
          seen.add(key);
          if (e === VIEW) {
            vals.set(key, VIEW);
            continue;
          }
          if (fresh) data.push(this.str(key), e);
          else if (!sameEnc(was, e)) up.push(this.str(key), e);
          vals.set(key, e);
        }
        for (const key of [...vals.keys()])
          if (!seen.has(key)) {
            if (vals.get(key) !== VIEW) up.push(this.str(key), UNDEF);
            vals.delete(key);
          }
        if (fresh) creates.push([id, Kind.Object, cls, data]);
        else if (up.length > 1) updates.push(up);
        this.shadow.set(id, { kind: Kind.Object, cls, vals });
      }
    }

    const drops: number[] = [];
    for (const id of this.shadow.keys())
      if (!reached.has(id)) {
        drops.push(id);
        this.shadow.delete(id);
      }
    if (!creates.length && !updates.length && !drops.length) return null;
    const p: Patch = {};
    if (creates.length) p.c = creates;
    if (updates.length) p.u = updates;
    if (drops.length) p.d = drops;
    return p;
  }

  /** Everything as of the last `diff`, for a screen that is just starting. */
  full(): Patch {
    const c: Create[] = [];
    for (const [id, s] of this.shadow) {
      switch (s.kind) {
        case Kind.Object: {
          const data: Enc[] = [];
          for (const [k, v] of s.vals) if (v !== VIEW) data.push(this.str(k), v);
          c.push([id, Kind.Object, s.cls, data]);
          break;
        }
        case Kind.Array:
          c.push([id, Kind.Array, '', s.vals]);
          break;
        case Kind.Map:
        case Kind.Set:
          c.push([id, s.kind, '', s.vals]);
          break;
        case Kind.Typed:
          c.push([id, Kind.Typed, s.cls, s.vals]);
          break;
        case Kind.Date:
          c.push([id, Kind.Date, '', s.vals]);
          break;
      }
    }
    return { r: this.rootId, c };
  }

  /**
   * A value as a call argument: replicated objects by reference, anything else copied inline
   * (an event list made this frame, say).
   */
  arg(v: unknown, depth = 0): Enc {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return UNDEF;
    if (typeof v === 'string') return this.str(v);
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return num(v);
    const o = v as object;
    const id = this.idOf(o);
    if (id !== undefined) return [id];
    if (depth > 8 || this.opts.isView?.(o) || !this.supported(o, 'arg')) return UNDEF;
    if (Array.isArray(o)) return ['a', o.map((x) => this.arg(x, depth + 1))];
    if (o instanceof Map) {
      const out: Enc[] = [];
      for (const [k, x] of o) out.push(this.arg(k, depth + 1), this.arg(x, depth + 1));
      return ['m', out];
    }
    if (o instanceof Set) return ['s', [...o].map((x) => this.arg(x, depth + 1))];
    if (o instanceof Date) return ['o', { t: o.getTime() }];
    const typed = typedName(o);
    if (typed) return ['t', typed, Array.from(o as TypedArray, (x) => num(x) as number)];
    const fields: Record<string, Enc> = {};
    const skip = this.opts.skip?.(o);
    for (const key of Object.keys(o)) {
      if (skip?.includes(key)) continue;
      const e = this.arg((o as Record<string, unknown>)[key], depth + 1);
      if (!(Array.isArray(e) && e.length === 0)) fields[this.str(key)] = e;
    }
    const cls = this.clsOf(o);
    return cls ? ['o', fields, cls] : ['o', fields];
  }

  private str(s: string): string {
    return this.opts.alias?.(s) ?? s;
  }

  private idFor(o: object): number {
    let id = this.ids.get(o);
    if (id === undefined) {
      id = this.next++;
      this.ids.set(o, id);
    }
    return id;
  }

  private clsOf(o: object): string | undefined {
    const proto = Object.getPrototypeOf(o);
    if (proto === Object.prototype || proto === null) return undefined;
    return this.opts.registry.key(o.constructor);
  }

  private supported(o: object, path: string): boolean {
    if (Array.isArray(o) || o instanceof Map || o instanceof Set || o instanceof Date || typedName(o)) return true;
    const proto = Object.getPrototypeOf(o);
    if (proto === Object.prototype || proto === null) return true;
    if (this.opts.registry.key(o.constructor) !== undefined) return true;
    if (!this.unknown.has(o)) {
      this.unknown.add(o);
      this.opts.onUnknown?.(o, path);
    }
    return false;
  }
}

/** The screen's copy of the host's objects. */
export class Decoder {
  private objs = new Map<number, unknown>();
  private kinds = new Map<number, Kind>();
  root: unknown = null;

  constructor(
    private registry: ClassRegistry,
    /** Fields the screen sets on objects as they're made (e.g. the replica's own listeners). */
    private init?: (o: object, cls: string) => void,
  ) {}

  get size() {
    return this.objs.size;
  }

  get(id: number): unknown {
    return this.objs.get(id);
  }

  /** Forget everything (before a full snapshot). */
  reset() {
    this.objs.clear();
    this.kinds.clear();
    this.root = null;
  }

  /**
   * Apply a patch. A full snapshot (`r` set) goes onto what's here already where it can, so
   * objects the screen holds on to keep their identity; objects it doesn't mention are dropped.
   */
  apply(p: Patch) {
    if (p.r !== undefined) {
      const keep = new Set((p.c ?? []).map((c) => c[0]));
      for (const id of [...this.objs.keys()])
        if (!keep.has(id)) {
          this.objs.delete(id);
          this.kinds.delete(id);
        }
    }
    // Shells first, so references inside this patch resolve whatever the order.
    const fill: [Create, unknown][] = [];
    for (const c of p.c ?? []) {
      const [id, kind, cls] = c;
      let o = this.objs.get(id);
      if (o !== undefined && this.kinds.get(id) === kind && kind !== Kind.Typed) {
        if (kind === Kind.Object) {
          const C = cls ? this.registry.ctor(cls) : undefined;
          const proto = C ? C.prototype : Object.prototype;
          if (Object.getPrototypeOf(o) !== proto) Object.setPrototypeOf(o, proto);
        }
      } else {
        o = this.shell(kind, cls, c[3]);
        this.objs.set(id, o);
        this.kinds.set(id, kind);
      }
      fill.push([c, o]);
    }
    for (const [c, o] of fill) this.fill(c, o);
    for (const u of p.u ?? []) this.update(u);
    for (const id of p.d ?? []) {
      this.objs.delete(id);
      this.kinds.delete(id);
    }
    if (p.r !== undefined) this.root = this.objs.get(p.r) ?? null;
  }

  /** Decode a value: references to replicated objects, inline copies, or primitives. */
  value(e: Enc): unknown {
    if (!Array.isArray(e)) return e;
    if (e.length === 0) return undefined;
    const tag = e[0];
    if (typeof tag === 'number') return this.objs.get(tag);
    switch (tag) {
      case 'N':
        return NaN;
      case 'I':
        return Infinity;
      case '-I':
        return -Infinity;
      case 'a':
        return (e[1] as Enc[]).map((x) => this.value(x));
      case 'm': {
        const m = new Map();
        const kv = e[1] as Enc[];
        for (let i = 0; i < kv.length; i += 2) m.set(this.value(kv[i]), this.value(kv[i + 1]));
        return m;
      }
      case 's':
        return new Set((e[1] as Enc[]).map((x) => this.value(x)));
      case 't': {
        const C = (globalThis as unknown as Record<string, new (a: number[]) => unknown>)[e[1] as string];
        return C ? new C(e[2] as number[]) : (e[2] as number[]).slice();
      }
      case 'o': {
        const cls = e[2] as string | undefined;
        const C = cls ? this.registry.ctor(cls) : undefined;
        const o = Object.create(C ? C.prototype : Object.prototype) as Record<string, unknown>;
        for (const [k, v] of Object.entries(e[1] as Record<string, Enc>)) o[k] = this.value(v);
        return o;
      }
    }
    return undefined;
  }

  private shell(kind: Kind, cls: string, data: Enc[] | number): unknown {
    switch (kind) {
      case Kind.Object: {
        const C = cls ? this.registry.ctor(cls) : undefined;
        const o = Object.create(C ? C.prototype : Object.prototype) as object;
        this.init?.(o, cls);
        return o;
      }
      case Kind.Array:
        return [];
      case Kind.Map:
        return new Map();
      case Kind.Set:
        return new Set();
      case Kind.Typed: {
        const C = (globalThis as unknown as Record<string, new (n: number) => unknown>)[cls];
        return C ? new C((data as number[]).length) : [];
      }
      case Kind.Date:
        return new Date(data as number);
    }
  }

  private fill(c: Create, o: unknown) {
    const [, kind, , data] = c;
    switch (kind) {
      case Kind.Object: {
        const d = data as Enc[];
        const rec = o as Record<string, unknown>;
        for (let i = 0; i < d.length; i += 2) rec[d[i] as string] = this.value(d[i + 1]);
        break;
      }
      case Kind.Array: {
        const arr = o as unknown[];
        const d = data as Enc[];
        arr.length = d.length;
        for (let i = 0; i < d.length; i++) arr[i] = this.value(d[i]);
        break;
      }
      case Kind.Map: {
        const m = o as Map<unknown, unknown>;
        const d = data as Enc[];
        m.clear();
        for (let i = 0; i < d.length; i += 2) m.set(this.value(d[i]), this.value(d[i + 1]));
        break;
      }
      case Kind.Set: {
        const s = o as Set<unknown>;
        s.clear();
        for (const v of data as Enc[]) s.add(this.value(v));
        break;
      }
      case Kind.Typed: {
        const d = data as number[];
        const t = o as TypedArray | number[];
        for (let i = 0; i < d.length; i++) t[i] = d[i];
        break;
      }
      case Kind.Date:
        (o as Date).setTime(data as number);
        break;
    }
  }

  private update(u: Update) {
    const id = u[0] as number;
    const o = this.objs.get(id);
    if (o === undefined) return;
    if (this.kinds.get(id) === Kind.Typed) {
      const t = o as TypedArray;
      for (let i = 1; i < u.length; i += 2) t[u[i] as number] = u[i + 1] as number;
      return;
    }
    if (this.kinds.get(id) === Kind.Array) {
      const arr = o as unknown[];
      arr.length = u[1] as number;
      for (let i = 2; i < u.length; i += 2) arr[u[i] as number] = this.value(u[i + 1] as Enc);
      return;
    }
    const rec = o as Record<string, unknown>;
    for (let i = 1; i < u.length; i += 2) {
      const v = u[i + 1] as Enc;
      if (Array.isArray(v) && v.length === 0) delete rec[u[i] as string];
      else rec[u[i] as string] = this.value(v);
    }
  }
}
