/**
 * Pierogi Parade's market street, drawn on the full 1920 × 1080 TV stage: a sunset sky over a row of
 * tenement houses, a cobbled street with five lanes, and everything that gets in the way.
 * Everything moves with CSS animations whose delays are ms after the parade starts, so the TV never
 * re-renders them while they run.
 */
import { PIEROGI_PATH } from '../../lib/art';
import { mulberry32 } from '../rng';
import { PARADE_COLORS, PARADE_LANES, type Prop, type Scene, type Tram } from './logic';

export const STAGE_W = 1920;
export const HORIZON = 390;
/** The baseline pierogi of lane `i` walk on (stage px). Lane 0 is at the back. */
export const laneY = (i: number) => 480 + i * 142;
/** Lanes further back are drawn smaller. */
export const laneScale = (i: number) => 0.76 + i * 0.09;
/** Stacking: each lane gets a band of ten; things in front of lane k sit just above it. */
export const laneZ = (i: number) => 10 + i * 10;
/** The sky band where kites, birds and fireworks fly (stage px). */
const skyY = (t: number) => 230 + t * 110;

const hex = (c: number) => PARADE_COLORS[c].hex;

// ---- backdrop -------------------------------------------------------------------

interface House {
  x: number;
  w: number;
  h: number;
  color: string;
  roof: 'gable' | 'step' | 'flat';
  windows: { x: number; y: number; face: number | null }[];
}

const HOUSE_COLORS = ['#6b2f3f', '#5a3550', '#7a4a3a', '#4f3a5c', '#6e3b2c', '#5c4a2e', '#3f4a5c'];

/** The same street every time (fixed seed), so it feels like a place. */
const HOUSES: House[] = (() => {
  const rng = mulberry32(1410);
  const out: House[] = [];
  for (let x = -20; x < STAGE_W; ) {
    const w = 130 + Math.floor(rng() * 70);
    const h = 150 + Math.floor(rng() * 110);
    const windows: House['windows'] = [];
    const cols = Math.max(2, Math.floor((w - 30) / 44));
    const rows = Math.floor((h - 50) / 52);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const wx = x + 20 + c * ((w - 40) / (cols - 1 || 1)) - 11;
        const wy = HORIZON - h + 40 + r * 52;
        // A few neighbours watch the parade from their windows.
        windows.push({ x: wx, y: wy, face: rng() < 0.16 ? Math.floor(rng() * PARADE_COLORS.length) : null });
      }
    out.push({ x, w, h, color: HOUSE_COLORS[Math.floor(rng() * HOUSE_COLORS.length)], roof: (['gable', 'step', 'flat'] as const)[Math.floor(rng() * 3)], windows });
    x += w + 4;
  }
  return out;
})();

/** Sky, sun, hills, houses, bunting and the cobbled street. Static. */
export function Backdrop() {
  return (
    <svg class="parade-backdrop" width={STAGE_W} height={1080} viewBox="0 0 1920 1080" aria-hidden="true">
      <defs>
        <linearGradient id="pd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#241033" />
          <stop offset="0.55" stop-color="#7a3046" />
          <stop offset="1" stop-color="#e2805a" />
        </linearGradient>
        <pattern id="pd-cobble" width="64" height="40" patternUnits="userSpaceOnUse">
          <rect width="64" height="40" fill="#3a2a2c" />
          <ellipse cx="16" cy="10" rx="14" ry="8" fill="#47353a" />
          <ellipse cx="48" cy="10" rx="14" ry="8" fill="#4b3836" />
          <ellipse cx="0" cy="30" rx="14" ry="8" fill="#4a373b" />
          <ellipse cx="32" cy="30" rx="14" ry="8" fill="#45333a" />
          <ellipse cx="64" cy="30" rx="14" ry="8" fill="#4a373b" />
        </pattern>
        <linearGradient id="pd-street-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1f0a10" stop-opacity="0.55" />
          <stop offset="0.4" stop-color="#1f0a10" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect width="1920" height={HORIZON} fill="url(#pd-sky)" />
      <circle cx="1480" cy={HORIZON - 60} r="110" fill="#ffc93c" opacity="0.85" />
      <path d={`M0 ${HORIZON - 90} Q 240 ${HORIZON - 170} 520 ${HORIZON - 110} T 1100 ${HORIZON - 120} T 1920 ${HORIZON - 100} V ${HORIZON} H 0 Z`} fill="#4a1c30" />
      {HOUSES.map((h) => {
        const top = HORIZON - h.h;
        const roof =
          h.roof === 'gable'
            ? `M${h.x - 6} ${top} L${h.x + h.w / 2} ${top - 50} L${h.x + h.w + 6} ${top} Z`
            : h.roof === 'step'
              ? `M${h.x} ${top} V${top - 18} H${h.x + h.w * 0.2} V${top - 36} H${h.x + h.w * 0.4} V${top - 52} H${h.x + h.w * 0.6} V${top - 36} H${h.x + h.w * 0.8} V${top - 18} H${h.x + h.w} V${top} Z`
              : `M${h.x - 4} ${top} H${h.x + h.w + 4} V${top - 12} H${h.x - 4} Z`;
        return (
          <g>
            <path d={roof} fill="#2a1420" />
            <rect x={h.x} y={top} width={h.w} height={h.h} fill={h.color} />
            {h.windows.map((w) =>
              w.face === null ? (
                <rect x={w.x} y={w.y} width="22" height="30" rx="3" fill="#ffd98a" opacity="0.8" />
              ) : (
                <g>
                  <rect x={w.x} y={w.y} width="22" height="30" rx="3" fill="#ffe6a8" />
                  <path d={PIEROGI_PATH} transform={`translate(${w.x + 1} ${w.y + 12}) scale(0.17)`} fill={hex(w.face)} stroke="#2a120a" stroke-width="6" />
                </g>
              ),
            )}
          </g>
        );
      })}
      {/* Bunting across the street */}
      {[0, 1].map((k) => {
        const y0 = HORIZON - 190 + k * 40;
        const flags = Array.from({ length: 34 }, (_, i) => i);
        return (
          <g>
            <path d={`M0 ${y0} Q 960 ${y0 + 70} 1920 ${y0}`} fill="none" stroke="#2a120a" stroke-width="2" />
            {flags.map((i) => {
              const t = (i + 0.5) / flags.length;
              const x = t * 1920;
              const y = y0 + 70 * 2 * t * (1 - t) * 1 + 2;
              return <path d={`M${x - 14} ${y} L${x + 14} ${y} L${x} ${y + 26} Z`} fill={hex((i + k * 2) % PARADE_COLORS.length)} opacity="0.85" />;
            })}
          </g>
        );
      })}
      <rect y={HORIZON} width="1920" height="22" fill="#6b5a5a" />
      <rect y={HORIZON + 22} width="1920" height={1080 - HORIZON - 22} fill="url(#pd-cobble)" />
      <rect y={HORIZON + 22} width="1920" height={1080 - HORIZON - 22} fill="url(#pd-street-shade)" />
      {Array.from({ length: PARADE_LANES }, (_, i) => (
        <rect y={laneY(i) + 4} width="1920" height="5" fill="#fff4dc" opacity={0.05 + i * 0.015} />
      ))}
    </svg>
  );
}

// ---- things on the street ----------------------------------------------------------

function PropArt({ kind }: { kind: Prop['kind'] }) {
  if (kind === 'lamp')
    return (
      <svg width="70" height="330" viewBox="0 0 70 330">
        <rect x="29" y="40" width="12" height="285" fill="#2b2530" />
        <rect x="20" y="312" width="30" height="18" rx="4" fill="#2b2530" />
        <path d="M14 40 H56 L48 8 H22 Z" fill="#2b2530" />
        <rect x="22" y="14" width="26" height="22" fill="#ffd98a" />
      </svg>
    );
  if (kind === 'tree')
    return (
      <svg width="240" height="360" viewBox="0 0 240 360">
        <rect x="102" y="170" width="36" height="190" rx="8" fill="#4a2e22" />
        <circle cx="120" cy="110" r="95" fill="#2f5e3a" />
        <circle cx="62" cy="150" r="58" fill="#3a7046" />
        <circle cx="178" cy="150" r="58" fill="#356a41" />
        <circle cx="120" cy="70" r="62" fill="#3f7a4c" />
      </svg>
    );
  if (kind === 'stall')
    return (
      <svg width="270" height="230" viewBox="0 0 270 230">
        <rect x="18" y="60" width="10" height="170" fill="#4a2e22" />
        <rect x="242" y="60" width="10" height="170" fill="#4a2e22" />
        <path d="M0 60 L20 0 H250 L270 60 Z" fill="#e8335a" />
        {[0, 1, 2, 3, 4].map((i) => (
          <path d={`M${20 + i * 46 + 23} 0 H${20 + i * 46 + 46} L${54 + i * 54} 60 H${27 + i * 54} Z`} fill="#fff4dc" />
        ))}
        <rect x="10" y="130" width="250" height="100" rx="6" fill="#8a5a3a" />
        <rect x="10" y="130" width="250" height="16" fill="#a8744c" />
        {[40, 75, 110, 160, 195, 230].map((x, i) => (
          <circle cx={x} cy="122" r="14" fill={['#e8335a', '#ffc93c', '#a3e048'][i % 3]} />
        ))}
      </svg>
    );
  return (
    <svg width="170" height="140" viewBox="0 0 170 140">
      {[
        [10, 62],
        [88, 62],
        [49, 0],
      ].map(([x, y]) => (
        <g transform={`translate(${x} ${y})`}>
          <rect width="72" height="78" rx="14" fill="#7a4a2e" />
          <rect y="14" width="72" height="8" fill="#3b2b2e" />
          <rect y="56" width="72" height="8" fill="#3b2b2e" />
        </g>
      ))}
    </svg>
  );
}

export function PropView({ prop }: { prop: Prop }) {
  const s = laneScale(prop.lane);
  return (
    <div
      class="parade-prop"
      style={{ left: `${prop.x * STAGE_W}px`, top: `${laneY(prop.lane) + 14}px`, zIndex: laneZ(prop.lane) + 5, transform: `translate(-50%, -100%) scale(${s})` }}
    >
      <PropArt kind={prop.kind} />
    </div>
  );
}

export function TramView({ tram }: { tram: Tram }) {
  const s = laneScale(tram.lane);
  return (
    <div
      class="parade-tram"
      style={{
        top: `${laneY(tram.lane) + 18 - 210 * s}px`,
        zIndex: laneZ(tram.lane) + 6,
        animationName: tram.dir > 0 ? 'parade-tram-ltr' : 'parade-tram-rtl',
        animationDuration: `${tram.dur}ms`,
        animationDelay: `${tram.at}ms`,
      }}
    >
      <svg width={720 * s} height={210 * s} viewBox="0 0 720 210" style={{ transform: tram.dir < 0 ? 'scaleX(-1)' : undefined }}>
        <path d="M330 30 L360 0 L390 30" fill="none" stroke="#2b2530" stroke-width="5" />
        <rect x="10" y="30" width="700" height="150" rx="26" fill="#d6283f" />
        <rect x="10" y="120" width="700" height="34" fill="#fff4dc" />
        {Array.from({ length: 9 }, (_, i) => (
          <g>
            <rect x={40 + i * 74} y="50" width="56" height="56" rx="8" fill="#ffd98a" />
            <path d={PIEROGI_PATH} transform={`translate(${46 + i * 74} 74) scale(0.36)`} fill={hex(i % PARADE_COLORS.length)} stroke="#2a120a" stroke-width="5" />
          </g>
        ))}
        <circle cx="110" cy="186" r="20" fill="#2b2530" />
        <circle cx="610" cy="186" r="20" fill="#2b2530" />
        <rect x="690" y="70" width="20" height="40" rx="6" fill="#fff4c8" />
      </svg>
    </div>
  );
}

// ---- the sky and the air --------------------------------------------------------------

export function Balloon({ b }: { b: Scene['balloons'][number] }) {
  return (
    <div class="parade-balloon" style={{ left: `${b.x * STAGE_W}px`, animationDuration: `${b.dur}ms`, animationDelay: `${b.at}ms` }}>
      <svg width="60" height="130" viewBox="0 0 60 130">
        <path d="M30 76 Q 22 100 34 128" fill="none" stroke="rgba(255,244,220,.6)" stroke-width="2" />
        <ellipse cx="30" cy="38" rx="26" ry="34" fill={hex(b.c)} />
        <ellipse cx="21" cy="26" rx="7" ry="10" fill="#fff" opacity="0.35" />
        <path d="M26 72 L34 72 L30 78 Z" fill={hex(b.c)} />
      </svg>
    </div>
  );
}

export function Kite({ k }: { k: Scene['kites'][number] }) {
  return (
    <div class="parade-kite" style={{ left: `${k.x * STAGE_W}px`, top: `${skyY(k.y)}px`, animationDelay: `${-k.x * 3}s` }}>
      <svg width="190" height="190" viewBox="0 0 190 190">
        <path d="M60 60 Q 30 120 70 190" fill="none" stroke="rgba(255,244,220,.5)" stroke-width="2" />
        <path d="M60 60 Q 80 100 60 130 Q 40 150 60 170" fill="none" stroke="rgba(255,244,220,.75)" stroke-width="2" />
        {[100, 128, 156].map((y, i) => (
          <path d={`M${54 + (i % 2) * 8} ${y} l10 -6 l0 12 Z`} fill={hex((k.c + i + 1) % PARADE_COLORS.length)} />
        ))}
        <path d={PIEROGI_PATH} transform="translate(14 8) scale(0.85)" fill={hex(k.c)} stroke="#2a120a" stroke-width="4" />
        <path d="M44 30 l14 12 M74 30 l-14 12" stroke="#2a120a" stroke-width="3" />
      </svg>
    </div>
  );
}

export function Birds({ f }: { f: Scene['birds'][number] }) {
  return (
    <div
      class="parade-birds"
      style={{ top: `${skyY(f.y)}px`, animationName: f.dir > 0 ? 'parade-sky-ltr' : 'parade-sky-rtl', animationDuration: `${f.dur}ms`, animationDelay: `${f.at}ms` }}
    >
      {Array.from({ length: f.n }, (_, i) => (
        <svg class="parade-bird" width="40" height="20" viewBox="0 0 40 20" style={{ marginTop: `${(i % 3) * 14}px`, animationDelay: `${i * 90}ms` }}>
          <path d="M2 6 Q 11 0 20 12 Q 29 0 38 6" fill="none" stroke="#1a0a12" stroke-width="4" stroke-linecap="round" />
        </svg>
      ))}
    </div>
  );
}

export function Firework({ fw }: { fw: Scene['fireworks'][number] }) {
  return (
    <div class="parade-firework" style={{ left: `${fw.x * STAGE_W}px`, top: `${skyY(fw.y)}px` }}>
      {Array.from({ length: 14 }, (_, i) => (
        <i style={{ '--a': `${(i * 360) / 14}deg`, background: hex((fw.c + (i % 2)) % PARADE_COLORS.length), color: hex(fw.c), animationDelay: `${fw.at}ms` }} />
      ))}
    </div>
  );
}
