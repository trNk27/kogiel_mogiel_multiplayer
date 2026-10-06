import { useEffect, useState } from 'preact/hooks';

/** Vendor-prefixed bits of the Fullscreen API (older Safari on iPad, some Android browsers). */
type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const doc = document as FsDoc;

/** Can this browser put a page in full screen? (iPhones can't – only videos.) */
export const fullscreenSupported = () => !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

/** Opened from the home screen, so there's no browser bar anyway. */
export const standalone = () =>
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const current = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

export function toggleFullscreen() {
  try {
    if (current()) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    const el = document.documentElement as FsEl;
    if (el.requestFullscreen) void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    /* not allowed here */
  }
}

/** Whether the page is in full screen right now. */
export function useFullscreen() {
  const [on, setOn] = useState(() => !!current());
  useEffect(() => {
    const update = () => setOn(!!current());
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
    };
  }, []);
  return on;
}
