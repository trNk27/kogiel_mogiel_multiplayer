/** The landing page's orbiting game icons (see orbits.ts). Moved straight in the DOM every frame, no re-renders. */
import { useEffect, useRef } from 'preact/hooks';
import { GAMES } from '../../../shared/protocol';
import { GameIcon } from './GameIcon';
import { RINGS, orbitLayout, planetAt, type Planet } from './orbits';

const ICON = 96;

/** Where a planet starts, so the first paint already has them on their orbits. */
function poseStyle(p: Planet | undefined) {
  if (!p) return undefined;
  const pose = planetAt(p, 0);
  return { transform: `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`, opacity: pose.opacity, zIndex: pose.depth > 0 ? 300 : 100 };
}

export function Orbits() {
  const planets = useRef(orbitLayout(GAMES.length));
  const els = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    // Barely drifting for people who asked for less motion.
    const pace = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.15 : 1;
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = ((now - start) / 1000) * pace;
      planets.current.forEach((p, i) => {
        const el = els.current[i];
        if (!el) return;
        const pose = planetAt(p, t);
        // A slow wobble of its own, like a planet turning.
        const spin = Math.sin(t * 0.7 + i * 1.7) * 7;
        el.style.transform = `translate(${pose.x.toFixed(1)}px, ${pose.y.toFixed(1)}px) scale(${pose.scale.toFixed(3)}) rotate(${spin.toFixed(1)}deg)`;
        el.style.opacity = pose.opacity.toFixed(2);
        // In front of the title on the near half of the orbit, behind it on the far half.
        el.style.zIndex = String(pose.depth > 0 ? 300 + Math.round(pose.depth * 100) : 100 + Math.round(pose.depth * 100));
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div class="orbits" aria-hidden="true">
      {RINGS.map((r) => (
        <div class="orbit-ring" style={{ width: r.rx * 2, height: r.ry * 2 }} />
      ))}
      {GAMES.map((g, i) => (
        <div class="orbit-planet" ref={(el) => {
            els.current[i] = el;
          }} key={g.id} style={poseStyle(planets.current[i])}>
          <GameIcon game={g.id} size={ICON} />
        </div>
      ))}
    </div>
  );
}
