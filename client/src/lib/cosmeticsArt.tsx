/**
 * Lobby-only cartoon SVG cosmetic accessories for Pierogi avatars (9 stackable items).
 * Uses Pierogi's `120×96` coordinate system with #2a120a outlines and playful offsets so stacking works cleanly.
 */
import type { CosmeticId } from '../../../shared/cosmetics';

export const COSMETIC_LAYER_ORDER: readonly CosmeticId[] = [
  'halo',
  'tophat',
  'chef',
  'crown',
  'flower',
  'shades',
  'monocle',
  'mustache',
  'bowtie',
];

function renderLayer(id: CosmeticId) {
  switch (id) {
    case 'halo':
      return (
        <g key="halo">
          <ellipse cx="60" cy="-12" rx="26" ry="7.5" fill="none" stroke="#ffd23f" stroke-width="5.5" opacity=".45" />
          <ellipse cx="60" cy="-12" rx="26" ry="7.5" fill="none" stroke="#ffe57f" stroke-width="3" />
          <ellipse cx="52" cy="-14.5" rx="7" ry="1.8" fill="none" stroke="#fff9d6" stroke-width="1.8" stroke-linecap="round" />
        </g>
      );
    case 'tophat':
      return (
        <g key="tophat" transform="rotate(-11 45 14)">
          <ellipse cx="45" cy="14" rx="21" ry="5" fill="#231829" stroke="#2a120a" stroke-width="2.6" />
          <path d="M 31 13 L 34 -16 Q 45 -19 56 -16 L 59 13 Z" fill="#2f2238" stroke="#2a120a" stroke-width="2.6" stroke-linejoin="round" />
          <path d="M 32 4 Q 45 7 58 4 L 58.6 10 Q 45 13 31.4 10 Z" fill="#e8335a" stroke="#2a120a" stroke-width="1.8" />
          <path d="M 37 -12 L 36 1" stroke="rgba(255,255,255,.22)" stroke-width="2.5" stroke-linecap="round" />
        </g>
      );
    case 'chef':
      return (
        <g key="chef" transform="rotate(9 74 15)">
          <path
            d="M 55 12 C 47 6 47 -8 58 -10 C 62 -19 82 -19 87 -10 C 98 -8 98 6 90 12 L 88 21 Q 73 24 57 21 Z"
            fill="#fff8ea"
            stroke="#2a120a"
            stroke-width="2.6"
            stroke-linejoin="round"
          />
          <path d="M 57 14 Q 73 17 89 14" fill="none" stroke="#d9c6a3" stroke-width="2" />
          <path d="M 65 -6 L 65 8 M 73 -8 L 73 9 M 81 -6 L 81 8" stroke="#e8dcc0" stroke-width="2" stroke-linecap="round" />
        </g>
      );
    case 'crown':
      return (
        <g key="crown">
          <path
            d="M 43 22 L 40 4 L 51 12 L 60 0 L 69 12 L 80 4 L 77 22 Q 60 25 43 22 Z"
            fill="#ffd23f"
            stroke="#2a120a"
            stroke-width="2.6"
            stroke-linejoin="round"
          />
          <circle cx="40" cy="4" r="2.4" fill="#ff5a7a" stroke="#2a120a" stroke-width="1.4" />
          <circle cx="60" cy="0" r="2.8" fill="#4f9dff" stroke="#2a120a" stroke-width="1.4" />
          <circle cx="80" cy="4" r="2.4" fill="#ff5a7a" stroke="#2a120a" stroke-width="1.4" />
        </g>
      );
    case 'flower':
      return (
        <g key="flower" transform="translate(94 25)">
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <ellipse
              key={a}
              cx="0"
              cy="-8.5"
              rx="4.6"
              ry="7.5"
              fill="#ff5a8a"
              stroke="#2a120a"
              stroke-width="2"
              transform={`rotate(${a})`}
            />
          ))}
          <circle r="5" fill="#ffd23f" stroke="#2a120a" stroke-width="2" />
        </g>
      );
    case 'shades':
      return (
        <g key="shades">
          <path d="M 22 48 L 30 48 M 90 48 L 98 48" stroke="#2a120a" stroke-width="3" stroke-linecap="round" />
          <path d="M 54 48 Q 60 44 66 48" fill="none" stroke="#2a120a" stroke-width="3.2" stroke-linecap="round" />
          <rect x="29" y="42" width="26" height="17" rx="5.5" fill="#1e1726" stroke="#2a120a" stroke-width="2.6" />
          <rect x="65" y="42" width="26" height="17" rx="5.5" fill="#1e1726" stroke="#2a120a" stroke-width="2.6" />
          <path d="M 33 55 L 41 45 M 69 55 L 77 45" stroke="#fff" stroke-width="2.3" stroke-linecap="round" opacity=".7" />
        </g>
      );
    case 'monocle':
      return (
        <g key="monocle">
          <circle cx="77" cy="51" r="10.5" fill="rgba(190,235,255,.26)" stroke="#f2b705" stroke-width="3" />
          <circle cx="77" cy="51" r="11.6" fill="none" stroke="#2a120a" stroke-width="1.4" />
          <path d="M 73 45 L 78 43" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".75" />
          <path d="M 87.5 53 Q 95 66 90 78" fill="none" stroke="#f2b705" stroke-width="2" stroke-dasharray="2 3" stroke-linecap="round" />
        </g>
      );
    case 'mustache':
      return (
        <g key="mustache">
          <path
            d="M 60 59 C 54 54 44 56 38 62 C 33 66 27 63 29 58 C 33 61 36 56 42 54 C 49 52 56 54 60 58 C 64 54 71 52 78 54 C 84 56 87 61 91 58 C 93 63 87 66 82 62 C 76 56 66 54 60 59 Z"
            fill="#5a3420"
            stroke="#2a120a"
            stroke-width="2.2"
            stroke-linejoin="round"
          />
        </g>
      );
    case 'bowtie':
      return (
        <g key="bowtie">
          <path
            d="M 43 74 L 58 81 L 43 88 Q 39 81 43 74 Z M 77 74 L 62 81 L 77 88 Q 81 81 77 74 Z"
            fill="#e8335a"
            stroke="#2a120a"
            stroke-width="2.4"
            stroke-linejoin="round"
          />
          <circle cx="60" cy="81" r="4.5" fill="#ff6b8b" stroke="#2a120a" stroke-width="2.4" />
        </g>
      );
  }
}

export function PierogiCosmetics({ ids }: { ids: readonly CosmeticId[] }) {
  const active = COSMETIC_LAYER_ORDER.filter((id) => ids.includes(id));
  if (active.length === 0) return null;
  return <g aria-hidden="true">{active.map((id) => renderLayer(id))}</g>;
}

const PREVIEW_VIEWBOX: Record<CosmeticId, string> = {
  bowtie: '34 68 52 26',
  mustache: '24 47 72 24',
  flower: '72 4 44 42',
  shades: '18 35 84 32',
  chef: '42 -24 64 52',
  monocle: '60 36 42 46',
  tophat: '18 -26 56 50',
  halo: '28 -25 64 26',
  crown: '34 -6 52 36',
};

export function CosmeticPreview({ id, size = 44 }: { id: CosmeticId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={PREVIEW_VIEWBOX[id]} aria-hidden="true">
      {renderLayer(id)}
    </svg>
  );
}
