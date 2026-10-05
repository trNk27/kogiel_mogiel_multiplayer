import { useEffect, useState } from 'preact/hooks';
import type { Send } from './PhoneApp';

/**
 * To Ty! photos on the phone. The host sends each photo once (they are too big to repeat in
 * every view); views only carry each player's photo version, and the phone asks for the
 * ones it is missing, e.g. after a reload.
 */
const cache = new Map<string, { rev: number; data: string }>();
const listeners = new Set<() => void>();
const asked = new Map<string, number>();
const RETRY_MS = 4000;

export function putPhoto(id: string, rev: number, data: string) {
  cache.set(id, { rev, data });
  for (const fn of listeners) fn();
}

/** Returns a lookup id → photo data URL (null = no photo, show the pierogi). */
export function usePhotos(ph: Record<string, number>, send: Send): (id: string) => string | null {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const key = JSON.stringify(ph);
  useEffect(() => {
    const ask = () => {
      const now = Date.now();
      const missing: string[] = [];
      for (const [id, rev] of Object.entries(ph)) {
        const k = `${id}:${rev}`;
        if (cache.get(id)?.rev === rev || now - (asked.get(k) ?? 0) < RETRY_MS) continue;
        asked.set(k, now);
        missing.push(id);
      }
      if (missing.length) send({ t: 'photos', ids: missing });
    };
    ask();
    const timer = setInterval(ask, RETRY_MS);
    return () => clearInterval(timer);
  }, [key]);

  return (id) => {
    const p = cache.get(id);
    return p && p.rev === ph[id] && p.data ? p.data : null;
  };
}
