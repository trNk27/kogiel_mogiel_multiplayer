import type { HostToPhone } from '../../../shared/protocol';

/** No-TV Maluch Rally traffic (snapshots and car events), passed from the socket to the race view. */
export type RallyMsg = Extract<HostToPhone, { t: 'rs' } | { t: 'rfx' }>;

let listener: ((m: RallyMsg) => void) | null = null;

export const rallyBus = {
  listen(fn: (m: RallyMsg) => void) {
    listener = fn;
    return () => {
      if (listener === fn) listener = null;
    };
  },
  emit(m: RallyMsg) {
    listener?.(m);
  },
};

/** Does this tab have a no-TV room to resume hosting? (Checked without loading the host code.) */
export function savedHostCode(dev: string | null): string | null {
  try {
    const raw = sessionStorage.getItem(`cp.notvhost${dev ? `.${dev}` : ''}`);
    const s = raw ? (JSON.parse(raw) as { code?: string; savedAt?: number }) : null;
    return s?.code && s.savedAt && Date.now() - s.savedAt < 30 * 60_000 ? s.code : null;
  } catch {
    return null;
  }
}
