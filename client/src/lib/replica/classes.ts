/**
 * The classes a replicated object can have: every class exported from the games and the host.
 * The host TV and second screens load the same build, so a class has the same name on both (its
 * module path and export name, which minification doesn't touch).
 *
 * Built on first use, not at import: the host modules import this one, and their exports don't
 * exist yet while they're still loading.
 */
import type { ClassRegistry } from './codec';

const modules = import.meta.glob(['../../games/**/*.{ts,tsx}', '../../host/**/*.{ts,tsx}', '../sound.ts', '!../../host/main.tsx'], { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

type Ctor = abstract new (...args: never[]) => unknown;

let byCtor: Map<unknown, string> | null = null;
let byKey: Map<string, Ctor> | null = null;

function isClass(v: unknown): v is Ctor {
  return typeof v === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(v));
}

function build() {
  byCtor = new Map();
  byKey = new Map();
  for (const [path, ns] of Object.entries(modules)) {
    const mod = path.replace(/^(\.\.\/)+/, '').replace(/\.tsx?$/, '');
    for (const [name, v] of Object.entries(ns)) {
      if (!isClass(v) || byCtor.has(v)) continue;
      const key = `${mod}#${name}`;
      byCtor.set(v, key);
      byKey.set(key, v);
    }
  }
}

export const classes: ClassRegistry = {
  key(ctor) {
    if (!byCtor) build();
    return byCtor!.get(ctor);
  },
  ctor(key) {
    if (!byKey) build();
    return byKey!.get(key);
  },
};
