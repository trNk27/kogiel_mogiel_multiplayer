import { describe, expect, it } from 'vitest';
import { Decoder, Encoder, type ClassRegistry, type Patch } from '../client/src/lib/replica/codec';

class Vec {
  constructor(
    public x: number,
    public y: number,
  ) {}
  get len() {
    return Math.hypot(this.x, this.y);
  }
}

class Scene {
  drawn = 0;
  draw() {
    this.drawn++;
  }
}

class Secret {
  key = 'hunter2';
  shown = 1;
  static replicaSkip = ['key'];
}

const classes: Record<string, abstract new (...a: never[]) => unknown> = { Vec, Scene, Secret };
const registry: ClassRegistry = {
  key: (c) => Object.keys(classes).find((k) => classes[k] === c),
  ctor: (k) => classes[k],
};

function pair() {
  const enc = new Encoder({
    registry,
    isView: (o) => o instanceof Scene,
    skip: (o) => (o.constructor as { replicaSkip?: string[] }).replicaSkip,
  });
  const dec = new Decoder(registry);
  /** Send through JSON, as the wire does. */
  const send = (p: Patch | null) => p && dec.apply(JSON.parse(JSON.stringify(p)) as Patch);
  return { enc, dec, send };
}

describe('replica codec', () => {
  it('copies a graph with classes, maps, sets and shared references', () => {
    const { enc, dec, send } = pair();
    const shared = new Vec(3, 4);
    const root = {
      a: shared,
      b: shared,
      list: [1, 'two', null, shared],
      m: new Map<string, Vec>([['v', shared]]),
      s: new Set([1, 2]),
      f: new Float32Array([0.5, 1.5]),
      gone: undefined,
      fn: () => 1,
      inf: Infinity,
    };
    enc.diff(root);
    send(enc.full());
    const copy = dec.root as typeof root;
    expect(copy.a).toBeInstanceOf(Vec);
    expect(copy.a.len).toBe(5);
    expect(copy.a).toBe(copy.b);
    expect(copy.list[3]).toBe(copy.a);
    expect(copy.m.get('v')).toBe(copy.a);
    expect([...copy.s]).toEqual([1, 2]);
    expect(copy.f).toBeInstanceOf(Float32Array);
    expect([...copy.f]).toEqual([0.5, 1.5]);
    expect('fn' in copy).toBe(false);
    expect('gone' in copy).toBe(false);
    expect(copy.inf).toBe(Infinity);
  });

  it('sends only changes and keeps identity', () => {
    const { enc, dec, send } = pair();
    const root = { pos: new Vec(1, 2), items: [new Vec(0, 0)], score: 0 };
    enc.diff(root);
    send(enc.full());
    const copy = dec.root as typeof root;
    const pos = copy.pos;
    expect(enc.diff(root)).toBeNull();

    root.pos.x = 7;
    root.score = 1;
    const p = enc.diff(root)!;
    expect(p.c).toBeUndefined();
    expect(JSON.stringify(p).length).toBeLessThan(60);
    send(p);
    expect(copy.pos).toBe(pos);
    expect(pos.x).toBe(7);
    expect(copy.score).toBe(1);

    root.items.push(new Vec(5, 5));
    send(enc.diff(root));
    expect(copy.items.length).toBe(2);
    expect(copy.items[1].x).toBe(5);

    root.items.length = 0;
    const drop = enc.diff(root)!;
    expect(drop.d?.length).toBe(2);
    send(drop);
    expect(copy.items.length).toBe(0);
    expect(dec.size).toBe(enc.size);
  });

  it('deletes fields and handles cycles', () => {
    const { enc, dec, send } = pair();
    const root: Record<string, unknown> = { a: 1, b: 2 };
    root.self = root;
    enc.diff(root);
    send(enc.full());
    const copy = dec.root as Record<string, unknown>;
    expect(copy.self).toBe(copy);
    delete root.b;
    send(enc.diff(root));
    expect('b' in copy).toBe(false);
  });

  it('never sends views or skipped fields, and leaves the screen’s own view alone', () => {
    const { enc, dec, send } = pair();
    const game = { scene: null as Scene | null, secret: new Secret() };
    enc.diff(game);
    send(enc.full());
    const copy = dec.root as { scene: unknown; secret: Secret };
    expect(copy.secret.shown).toBe(1);
    expect('key' in copy.secret).toBe(false);

    const scene = new Scene();
    game.scene = scene;
    // The screen made its own scene meanwhile.
    const own = new Scene();
    copy.scene = own;
    send(enc.diff(game));
    expect(copy.scene).toBe(own);
    expect(enc.viewAt(scene)).toEqual([enc.idOf(game), 'scene']);
    // The host's scene goes away: the screen keeps its own.
    game.scene = null;
    send(enc.diff(game));
    expect(copy.scene).toBe(own);
  });

  it('copies call arguments by reference or inline', () => {
    const { enc, dec, send } = pair();
    const sim = { cars: [new Vec(1, 1)] };
    const root = { sim };
    enc.diff(root);
    send(enc.full());
    const args = [sim, [{ e: 'hit', at: new Vec(2, 3) }], 0.123456789].map((a) => enc.arg(a));
    const back = (JSON.parse(JSON.stringify(args)) as Parameters<Decoder['value']>[0][]).map((a) => dec.value(a)) as [unknown, { e: string; at: Vec }[], number];
    expect(back[0]).toBe((dec.root as typeof root).sim);
    expect(back[1][0].e).toBe('hit');
    expect(back[1][0].at).toBeInstanceOf(Vec);
    expect(back[2]).toBeCloseTo(0.1235, 4);
  });

  it('a full snapshot after changes rebuilds the same state', () => {
    const { enc, send } = pair();
    const root = { v: new Vec(1, 1), list: [1, 2, 3], m: new Map([[1, 'a']]) };
    enc.diff(root);
    send(enc.full());
    root.v.y = 9;
    root.list.splice(1, 1);
    root.m.set(2, 'b');
    send(enc.diff(root));
    const late = new Decoder(registry);
    late.apply(JSON.parse(JSON.stringify(enc.full())) as Patch);
    const copy = late.root as typeof root;
    expect(copy.v.y).toBe(9);
    expect(copy.list).toEqual([1, 3]);
    expect([...copy.m]).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('skips objects of unknown classes and reports them', () => {
    class Unknown {
      x = 1;
    }
    const seen: string[] = [];
    const enc = new Encoder({ registry, onUnknown: (_o, path) => seen.push(path) });
    const dec = new Decoder(registry);
    const root = { ctx: null as Unknown | null, ok: 1 };
    enc.diff(root);
    dec.apply(enc.full());
    const copy = dec.root as Record<string, unknown>;
    // The screen sets up its own.
    copy.ctx = 'mine';
    root.ctx = new Unknown();
    const p = enc.diff(root);
    if (p) dec.apply(p);
    expect(copy).toEqual({ ok: 1, ctx: 'mine' });
    expect(seen).toEqual(['ctx']);
  });

  it('sends only the changed cells of a typed array', () => {
    const { enc, dec, send } = pair();
    const root = { grid: new Uint8Array(10_000) };
    enc.diff(root);
    send(enc.full());
    root.grid[5] = 3;
    root.grid[9000] = 1;
    const p = enc.diff(root)!;
    expect(JSON.stringify(p).length).toBeLessThan(40);
    send(p);
    const copy = dec.root as typeof root;
    expect(copy.grid[5]).toBe(3);
    expect(copy.grid[9000]).toBe(1);
  });

  it('a full snapshot onto an existing copy keeps identity', () => {
    const { enc, dec, send } = pair();
    const root = { v: new Vec(1, 1), gone: new Vec(2, 2) as Vec | null };
    enc.diff(root);
    send(enc.full());
    const copy = dec.root as typeof root;
    const v = copy.v;
    root.v.x = 5;
    root.gone = null;
    enc.diff(root);
    send(enc.full());
    expect(dec.root).toBe(copy);
    expect(copy.v).toBe(v);
    expect(v.x).toBe(5);
    expect(dec.size).toBe(2);
  });

  it('sends secrets as their aliases, wherever they are', () => {
    const secret = 'k3y-of-a-phone-xyz';
    const enc = new Encoder({ registry, alias: (s) => (s === secret ? '~1' : undefined) });
    const dec = new Decoder(registry);
    const root = { ids: [secret], scores: { [secret]: 5 } as Record<string, number>, names: new Map([[secret, 'Kasia']]) };
    enc.diff(root);
    root.scores[secret] = 6;
    const p = enc.diff(root);
    const wire = JSON.stringify([enc.full(), p, enc.arg({ by: secret })]);
    expect(wire).not.toContain(secret);
    dec.apply(JSON.parse(JSON.stringify(enc.full())) as Patch);
    const copy = dec.root as typeof root;
    expect(copy.ids).toEqual(['~1']);
    expect(copy.scores['~1']).toBe(6);
    expect(copy.names.get('~1')).toBe('Kasia');
  });
});
