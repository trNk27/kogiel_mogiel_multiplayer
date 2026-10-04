/** Keep the phone screen on during games (where the Screen Wake Lock API exists). */
type Sentinel = { release(): Promise<void>; released: boolean };
let sentinel: Sentinel | null = null;
let wanted = false;

async function acquire() {
  const wl = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (!wl || document.visibilityState !== 'visible') return;
  try {
    if (!sentinel || sentinel.released) sentinel = await wl.request('screen');
  } catch {
    /* denied (battery saver, no gesture yet…) – harmless */
  }
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') void acquire();
});
// iOS needs a user gesture for the first request.
document.addEventListener('touchend', () => wanted && void acquire(), { passive: true });

export function setWakeLock(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else if (sentinel) {
    void sentinel.release().catch(() => {});
    sentinel = null;
  }
}
