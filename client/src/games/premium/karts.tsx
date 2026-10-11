/** Maluch Rallye Premium's four cars, drawn side-on for the phones and the TV, and their stat bars. */
import { KARTS, type KartId, type KartStats } from '../../../../shared/protocol';

const INK = '#2a120a';
const GLASS = '#2b3d55';
const CHROME = '#c9ccd3';

function Wheel({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={r} fill="#1d1a22" stroke={INK} stroke-width="3" />
      <circle cx={x} cy={y} r={r * 0.45} fill={CHROME} />
    </>
  );
}

/** A car seen from the side, nose to the right, in `color`. */
export function KartArt({ kart, color, size = 160 }: { kart: KartId; color: string; size?: number }) {
  const art = {
    maluch: (
      <>
        <path d="M30 70 L36 52 Q40 46 50 46 L58 32 Q62 26 72 26 H104 Q114 26 120 34 L130 46 Q142 48 146 56 L150 70 Z" fill={color} stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M62 46 L70 32 H88 V46 Z M94 46 V32 H104 Q110 32 114 38 L120 46 Z" fill={GLASS} stroke={INK} stroke-width="3" stroke-linejoin="round" />
        <rect x="26" y="66" width="128" height="8" rx="4" fill={CHROME} stroke={INK} stroke-width="3" />
        <rect x="142" y="54" width="8" height="6" rx="2" fill="#fff4c8" />
        <Wheel x={56} y={74} r={13} />
        <Wheel x={124} y={74} r={13} />
      </>
    ),
    syrenka: (
      <>
        <path d="M18 70 Q18 54 36 52 L52 50 Q58 30 78 28 H98 Q114 30 120 48 L144 52 Q160 56 160 70 Z" fill={color} stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M60 50 Q64 36 78 34 H86 V50 Z M92 50 V34 H98 Q110 36 114 50 Z" fill={GLASS} stroke={INK} stroke-width="3" stroke-linejoin="round" />
        <path d="M118 70 Q120 52 138 52 Q156 52 158 70" fill={color} stroke={INK} stroke-width="3" />
        <path d="M22 70 Q24 54 40 54 Q56 54 58 70" fill={color} stroke={INK} stroke-width="3" />
        <rect x="150" y="58" width="10" height="7" rx="3" fill="#fff4c8" stroke={INK} stroke-width="2" />
        <Wheel x={40} y={72} r={12} />
        <Wheel x={138} y={72} r={12} />
      </>
    ),
    polonez: (
      <>
        <path d="M10 68 L14 50 L46 46 L68 30 H104 L118 44 L170 50 L172 68 Z" fill={color} stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M54 46 L70 34 H90 V46 Z M96 46 V34 H102 L112 46 Z" fill={GLASS} stroke={INK} stroke-width="3" stroke-linejoin="round" />
        <path d="M12 60 H172" stroke={INK} stroke-width="5" />
        <path d="M8 46 H30" stroke={INK} stroke-width="5" stroke-linecap="round" />
        <rect x="162" y="52" width="10" height="6" rx="2" fill="#fff4c8" />
        <Wheel x={40} y={70} r={13} />
        <Wheel x={140} y={70} r={13} />
      </>
    ),
    tarpan: (
      <>
        <path d="M14 64 V42 H86 V64 Z" fill={color} stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M86 64 V20 H132 L146 40 H168 V64 Z" fill={color} stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M94 40 V26 H128 L138 40 Z" fill={GLASS} stroke={INK} stroke-width="3" stroke-linejoin="round" />
        <path d="M92 16 H134" stroke={CHROME} stroke-width="5" stroke-linecap="round" />
        <rect x="164" y="44" width="10" height="16" rx="3" fill={CHROME} stroke={INK} stroke-width="3" />
        <path d="M20 50 H80" stroke={INK} stroke-width="3" opacity=".5" />
        <Wheel x={42} y={68} r={17} />
        <Wheel x={140} y={68} r={17} />
      </>
    ),
  }[kart];
  return (
    <svg width={size} height={(size * 90) / 180} viewBox="0 0 180 90" aria-hidden="true">
      <ellipse cx="90" cy="84" rx="80" ry="5" fill="rgba(0,0,0,.3)" />
      {art}
    </svg>
  );
}

export const STAT_NAMES: readonly { k: keyof KartStats; label: string }[] = [
  { k: 'speed', label: 'Speed' },
  { k: 'accel', label: 'Accel' },
  { k: 'handling', label: 'Handling' },
  { k: 'offroad', label: 'Off-road' },
];

/** Four rows of five pips. */
export function StatBars({ stats, class: cls = '' }: { stats: KartStats; class?: string }) {
  return (
    <div class={`kart-stats ${cls}`}>
      {STAT_NAMES.map(({ k, label }) => (
        <div class="kart-stat">
          <span>{label}</span>
          <span class="kart-pips">
            {[1, 2, 3, 4, 5].map((n) => (
              <i class={n <= stats[k] ? 'on' : ''} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export const kartIndex = (id: KartId) => Math.max(0, KARTS.findIndex((k) => k.id === id));
