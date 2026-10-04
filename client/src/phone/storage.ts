import type { ColorId } from '../../../shared/protocol';

export interface Stored {
  id: string;
  name: string;
  color?: ColorId;
  /** Room we last joined successfully. */
  code?: string;
  at?: number;
}

const params = new URLSearchParams(location.search);
/** The /dev page runs several phones in one browser: give each its own identity. */
const KEY = `cp.player${params.get('dev') ? `.${params.get('dev')}` : ''}`;

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

export function loadStored(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (s && typeof s.id === 'string' && s.id.length >= 8) return s;
  } catch {
    /* ignore */
  }
  const fresh: Stored = { id: randomId(), name: '' };
  saveStored(fresh);
  return fresh;
}

export function saveStored(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode – we just lose seamless rejoin */
  }
}

/** Forget the room (and get a fresh id so a kicked player rejoins as someone new). */
export function forgetRoom(s: Stored): Stored {
  const next = { ...s, id: randomId(), code: undefined, at: undefined };
  saveStored(next);
  return next;
}
