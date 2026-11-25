/**
 * A small label in the TV's top-left corner saying which version is running (commit and build
 * time). The TV also checks /version.json every minute; once a newer version is live it says so, and
 * tapping the label reloads (the TV goes straight back to its room).
 */
import { useEffect, useState } from 'preact/hooks';
import { isNewer, type BuildInfo } from './version';

const CHECK_MS = 60_000;

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function VersionBadge() {
  const [live, setLive] = useState<BuildInfo | null>(null);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const v = await res.json();
        if (!stopped && isNewer(v, __BUILD__)) setLive(v);
      } catch {
        // Offline for a moment: try again next time.
      }
    };
    void check();
    const timer = setInterval(check, CHECK_MS);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (live) {
    return (
      <button class="version-badge newer" onClick={() => location.reload()} title="Reload to get the new version">
        ✨ New version live ({live.commit} · {when(live.builtAt)}) – tap to reload
      </button>
    );
  }
  return (
    <div class="version-badge" title="Version running on this screen">
      v {__BUILD__.commit} · {when(__BUILD__.builtAt)}
    </div>
  );
}
