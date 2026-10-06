import type { ComponentChildren } from 'preact';
import type { ForkItem } from '../../../../shared/protocol';
import { Pierogi } from '../../lib/art';

export const FORK_ITEM_NAMES: Record<ForkItem, string> = {
  pierogi: 'Pierogi',
  sock: 'Dziadek’s sock',
  slipper: 'Babcia’s slipper',
  duck: 'Rubber duck',
};

/** What lands on the plate. The fakes are roughly pierogi-sized (and -coloured) on purpose. */
export function ForkThing({ k, size = 120 }: { k: ForkItem; size?: number }) {
  if (k === 'pierogi') return <Pierogi color="#f3cf6b" size={size} mood="wow" />;
  const h = size * 0.8;
  if (k === 'sock')
    return (
      <svg width={size} height={h} viewBox="0 0 120 96" aria-hidden="true">
        <path
          d="M40 6 H74 V52 Q74 58 80 62 L100 72 Q114 80 106 90 Q100 96 86 92 L44 78 Q34 74 36 62 Z"
          fill="#efd9ae"
          stroke="rgba(40,16,8,.6)"
          stroke-width="3"
          stroke-linejoin="round"
        />
        <path d="M40 16 H74 M40 26 H74" stroke="#e8335a" stroke-width="5" />
        <path d="M86 70 Q96 76 104 84" fill="none" stroke="rgba(40,16,8,.25)" stroke-width="3" stroke-dasharray="3 5" />
        <ellipse cx="57" cy="7" rx="17" ry="4" fill="#d9bf8e" stroke="rgba(40,16,8,.5)" stroke-width="2" />
      </svg>
    );
  if (k === 'slipper')
    return (
      <svg width={size} height={h} viewBox="0 0 120 96" aria-hidden="true">
        <path d="M10 70 Q8 50 30 46 L84 40 Q112 38 112 60 Q112 80 86 82 L30 84 Q12 84 10 70 Z" fill="#7a4b2a" stroke="rgba(40,16,8,.7)" stroke-width="3" />
        <path d="M54 44 Q84 30 104 50 Q96 70 70 70 Q56 70 54 44 Z" fill="#c0583a" stroke="rgba(40,16,8,.6)" stroke-width="3" />
        <circle cx="80" cy="54" r="7" fill="#ffd23f" stroke="rgba(40,16,8,.5)" stroke-width="2" />
        <path d="M14 76 Q60 90 110 70" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="4" />
      </svg>
    );
  return (
    <svg width={size} height={h} viewBox="0 0 120 96" aria-hidden="true">
      <path d="M14 58 Q14 86 58 86 Q104 86 106 58 Q106 46 92 48 L72 52 Q62 54 60 46 Z" fill="#ffd23f" stroke="rgba(40,16,8,.6)" stroke-width="3" />
      <circle cx="42" cy="34" r="22" fill="#ffd23f" stroke="rgba(40,16,8,.6)" stroke-width="3" />
      <path d="M16 36 Q2 40 8 46 Q16 48 24 42 Z" fill="#ff8a2a" stroke="rgba(40,16,8,.6)" stroke-width="2.5" />
      <circle cx="36" cy="28" r="4" fill="#2a120a" />
      <path d="M70 62 Q84 70 96 58" fill="none" stroke="rgba(40,16,8,.3)" stroke-width="3" />
    </svg>
  );
}

/** A dinner plate, with whatever is on it in the middle. */
export function Plate({ size = 300, children }: { size?: number; children?: ComponentChildren }) {
  return (
    <div class="fork-plate" style={{ width: size, height: size }}>
      <svg class="fork-plate-svg" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="48" fill="#fff4dc" stroke="rgba(40,16,8,.35)" stroke-width="1.5" />
        <circle cx="50" cy="50" r="36" fill="#f6e3bd" />
        <circle cx="50" cy="50" r="43" fill="none" stroke="#4f9dff" stroke-width="1.6" stroke-dasharray="2 3" />
      </svg>
      <div class="fork-plate-item">{children}</div>
    </div>
  );
}
