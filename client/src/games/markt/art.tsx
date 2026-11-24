/**
 * The Vienna Christmas market at night: the Rathaus behind, fairy lights, snow, wooden stalls and the
 * big attractions (Ferris wheel, Christmas tree, heart tree, ice rink, carousel, curling, Krampus tent),
 * with crowds of pierogi squeezing between them. Plus Krampus and the dodgy watch seller.
 */
import { useEffect, useRef } from 'preact/hooks';
import { PIEROGI_PATH } from '../../lib/art';
import { resources } from '../../lib/assets';
import { COLS, ROWS, SPOTS, edgeKey, neighbours } from './logic';

/** Perspective: the back row is further away (smaller, higher), the front row close. */
const ROW_Y = [372, 568, 800];
export const ROW_SCALE = [0.7, 0.85, 1];
/** Where each stall stands on the 1728×972 TV stage (the middle of the stall), and how big it looks. */
export const SPOT_XY: [number, number][] = SPOTS.map((s) => [864 + (s.col - 1.5) * 400 * ROW_SCALE[s.row], ROW_Y[s.row]]);
export const SPOT_SCALE: number[] = SPOTS.map((s) => ROW_SCALE[s.row]);
export const ENTRANCE_XY: [number, number] = [864, 950];

/** Real snow: three depths of flakes drifting in the wind, the near ones big and soft. */
export function Snow({ count = 220, front = true }: { count?: number; front?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const W = (c.width = 1728);
    const H = (c.height = 972);
    const flakes = Array.from({ length: count }, () => {
      const z = Math.random();
      return { x: Math.random() * W, y: Math.random() * H, z, r: 1 + z * z * 5, vy: 0.4 + z * 1.6, ph: Math.random() * 6.28 };
    });
    let raf = 0;
    let t = 0;
    const loop = () => {
      t += 0.016;
      ctx.clearRect(0, 0, W, H);
      const wind = Math.sin(t * 0.3) * 0.6 + 0.4;
      for (const f of flakes) {
        f.y += f.vy;
        f.x += wind * (0.3 + f.z) + Math.sin(t * 1.3 + f.ph) * 0.4;
        if (f.y > H + 10) {
          f.y = -10;
          f.x = Math.random() * W;
        }
        if (f.x > W + 10) f.x = -10;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
        g.addColorStop(0, `rgba(255,255,255,${0.5 + f.z * 0.5})`);
        g.addColorStop(f.z > 0.85 ? 0.3 : 0.6, `rgba(255,255,255,${0.3 + f.z * 0.4})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [count]);
  return <canvas ref={ref} class={`mk-snowcanvas ${front ? 'front' : 'back'}`} />;
}

const CROWD_COLORS = ['#6d5a7a', '#5a6d7a', '#7a6a5a', '#6a7a5a', '#7a5a62', '#5a5f7a'];

function seeded(n: number) {
  const x = Math.sin(n * 999.7) * 10000;
  return x - Math.floor(x);
}

/** The whole backdrop: sky, Rathaus, lights, snow, ground, paths with crowds, and every stall. */
export function Market({ crowds }: { crowds: Record<string, number> }) {
  const edges: [number, number][] = [];
  for (let i = 0; i < SPOTS.length; i++) for (const j of neighbours(i)) if (i < j) edges.push([i, j]);
  return (
    <div class="mk-market">
      <div class="mk-sky" />
      <div class="mk-stars" />
      <Rathaus />
      <div class="mk-haze" />
      <div class="mk-ground3d">
        <div class="mk-cobbles" />
      </div>
      <Snow count={90} front={false} />
      {SPOTS.map((_, i) => (
        <div class="mk-pool" style={{ left: `${SPOT_XY[i][0]}px`, top: `${SPOT_XY[i][1] + 70 * SPOT_SCALE[i]}px`, '--s': SPOT_SCALE[i] }} />
      ))}
      <Garlands />
      {/* Paths, busier ones packed with pierogi. */}
      {edges.map(([a, b]) => {
        const [x1, y1] = SPOT_XY[a];
        const [x2, y2] = SPOT_XY[b];
        const crowd = crowds[edgeKey(a, b)] ?? 1;
        const n = crowd * 3;
        return (
          <div class={`mk-path c${crowd}`}>
            {Array.from({ length: n }, (_, k) => {
              const t = (k + 0.5) / n;
              const span = y1 === y2 ? [0.33, 0.34] : [0.38, 0.24];
              const r = seeded(a * 31 + b * 7 + k);
              const dx = y1 === y2 ? 0 : (r - 0.5) * 70;
              const dy = y1 === y2 ? (r - 0.5) * 46 : 0;
              const x = x1 + (x2 - x1) * (span[0] + t * span[1]) + dx;
              const y = y1 + (y2 - y1) * (span[0] + t * span[1]) + dy + (y1 === y2 ? 30 : 0);
              const sc = SPOT_SCALE[a] + (SPOT_SCALE[b] - SPOT_SCALE[a]) * (span[0] + t * span[1]);
              return (
                <span
                  class={`mk-blob ${r > 0.6 ? 'hat' : ''} ${r < 0.25 ? 'mug' : ''}`}
                  style={{ left: `${x}px`, top: `${y}px`, zIndex: Math.round(y), '--s': sc, '--c': CROWD_COLORS[(a + b + k) % CROWD_COLORS.length], '--d': `${(r * 1.2).toFixed(2)}s` }}
                />
              );
            })}
          </div>
        );
      })}
      {SPOTS.map((s, i) => (
        <div class={`mk-stall s-${s.id}`} style={{ left: `${SPOT_XY[i][0]}px`, top: `${SPOT_XY[i][1]}px`, zIndex: SPOT_XY[i][1], '--s': SPOT_SCALE[i] }}>
          <StallArt id={s.id} />
          <span class="mk-sign">
            {s.emoji} {s.name}
          </span>
        </div>
      ))}
      <div class="mk-arch" style={{ left: `${ENTRANCE_XY[0]}px`, top: `${ENTRANCE_XY[1]}px` }}>
        <span>✨ Christkindlmarkt ✨</span>
      </div>
      {[
        [300, 690],
        [1428, 690],
        [560, 480],
        [1168, 480],
      ].map(([x, y]) => (
        <Lamp x={x} y={y} s={y > 600 ? 0.95 : 0.8} />
      ))}
      <Snow count={170} />
      <div class="mk-vignette" />
    </div>
  );
}

/** A Viennese street lamp with a warm halo. */
function Lamp({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <div class="mk-lamp" style={{ left: `${x}px`, top: `${y}px`, zIndex: y + 60, '--s': s }}>
      <span class="mk-lamp-halo" />
      <svg viewBox="0 0 40 200" aria-hidden="true">
        <rect x="17" y="40" width="6" height="156" fill="#1c1a22" />
        <rect x="11" y="190" width="18" height="10" rx="2" fill="#1c1a22" />
        <path d="M8 40 L32 40 L28 14 L12 14 Z" fill="#ffe9a8" stroke="#1c1a22" stroke-width="3" />
        <path d="M6 14 L34 14 L20 2 Z" fill="#1c1a22" />
        <path d="M10 14 h20" stroke="#fff" stroke-width="2" opacity=".6" />
      </svg>
    </div>
  );
}

/** Strings of fairy lights criss-crossing over the market, sagging into the distance. */
function Garlands() {
  const strings: [number, number, number, number][] = [
    [0, 250, 900, 330],
    [828, 330, 1728, 250],
    [80, 470, 1648, 470],
  ];
  return (
    <svg class="mk-garlands" viewBox="0 0 1728 972" aria-hidden="true">
      {strings.map(([x1, y1, x2, y2], si) => {
        const sag = si === 2 ? 70 : 50;
        const mx = (x1 + x2) / 2;
        const my = Math.max(y1, y2) + sag;
        const n = si === 2 ? 40 : 24;
        return (
          <g>
            <path d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`} stroke="#1c2a1c" stroke-width="2" fill="none" />
            {Array.from({ length: n }, (_, i) => {
              const t = (i + 0.5) / n;
              const bx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2;
              const by = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * my + t * t * y2;
              const c = ['#ffd23f', '#ff8fb1', '#fff4c9', '#5ad0ff'][i % 4];
              return (
                <g class="mk-bulb" style={{ animationDelay: `${(i % 7) * 0.21}s` }}>
                  <circle cx={bx} cy={by + 5} r="9" fill={c} opacity=".25" />
                  <circle cx={bx} cy={by + 5} r="3.6" fill={c} />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** Vienna's neo-Gothic Rathaus, lit up behind the market. */
function Rathaus() {
  return (
    <svg class="mk-rathaus" viewBox="0 0 1728 300" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="mk-rh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3a2f5c" />
          <stop offset="100%" stop-color="#1d1836" />
        </linearGradient>
      </defs>
      <g fill="url(#mk-rh)">
        {/* Wings. */}
        <path d="M380 300 V170 l20 -24 l20 24 V150 h60 v-20 l14 -18 l14 18 v20 h60 V160 l18 -20 l18 20 V300 Z" />
        <path d="M1348 300 V170 l-20 -24 l-20 24 V150 h-60 v-20 l-14 -18 l-14 18 v20 h-60 V160 l-18 -20 l-18 20 V300 Z" />
        <rect x="610" y="150" width="508" height="150" />
        {/* The middle tower with its spire and the Rathausmann. */}
        <path d="M804 300 V90 l14 -16 V40 l18 -30 l18 30 v34 l14 16 V300 Z" />
        <path d="M836 10 l0 -18" stroke="#ffd23f" stroke-width="4" />
        {/* Side towers. */}
        <path d="M640 300 V120 l12 -14 V90 l14 -22 l14 22 v16 l12 14 V300 Z" />
        <path d="M1088 300 V120 l-12 -14 V90 l-14 -22 l-14 22 v16 l-12 14 V300 Z" />
      </g>
      {/* Lit windows. */}
      <g fill="#ffcf6b" opacity=".85">
        {Array.from({ length: 22 }, (_, i) => (
          <rect x={630 + i * 22} y={190 + (i % 2) * 40} width="9" height="16" rx="4" />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <rect x={418 + i * 32} y="200" width="9" height="16" rx="4" />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <rect x={1140 + i * 32} y="200" width="9" height="16" rx="4" />
        ))}
        <circle cx="836" cy="120" r="14" fill="#fff4c9" />
        <rect x="826" y="160" width="20" height="40" rx="10" />
      </g>
      <path d="M380 296 Q864 230 1348 296" stroke="#ffd23f" stroke-width="3" fill="none" stroke-dasharray="2 14" stroke-linecap="round" />
    </svg>
  );
}

function Hut({ steam, color = '#8a4b2a' }: { steam?: boolean; color?: string }) {
  return (
    <svg class="mk-hut" viewBox="0 0 236 170" aria-hidden="true">
      {/* The side of the hut, in shadow, so it reads as a little wooden house. */}
      <path d="M196 62 L216 74 L216 166 L196 164 Z" fill={color} stroke="#2a120a" stroke-width="3" />
      <path d="M196 62 L216 74 L216 166 L196 164 Z" fill="#000" opacity=".35" />
      <path d="M210 66 L230 78 L112 14 L110 10 Z" fill="#4a2414" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <rect x="22" y="60" width="176" height="104" rx="4" fill={color} stroke="#2a120a" stroke-width="4" />
      <path d="M30 70 v86 M60 70 v86 M90 70 v86 M120 70 v86 M150 70 v86 M180 70 v86" stroke="rgba(0,0,0,.18)" stroke-width="3" />
      {/* Glowing window and counter. */}
      <rect x="42" y="80" width="136" height="44" rx="6" fill="#ffcf6b" stroke="#2a120a" stroke-width="3" />
      <rect x="42" y="80" width="136" height="44" rx="6" fill="url(#mk-glow)" />
      <rect x="32" y="120" width="156" height="14" rx="3" fill="#c98a52" stroke="#2a120a" stroke-width="3" />
      {/* Roof with snow. */}
      <path d="M6 66 L110 10 L214 66 Z" fill="#6e3a22" stroke="#2a120a" stroke-width="4" stroke-linejoin="round" />
      <path d="M14 62 Q40 48 62 50 Q90 30 112 22 Q136 32 160 48 Q190 48 206 62 Q190 70 170 64 Q140 72 110 62 Q80 72 50 64 Q30 72 14 62 Z" fill="#fffaf2" />
      {/* Garland with lights. */}
      <path d="M22 70 Q66 88 110 70 Q154 88 198 70" stroke="#2f7a4a" stroke-width="7" fill="none" />
      {[40, 75, 110, 145, 180].map((x, i) => (
        <circle class="mk-bulb" cx={x} cy={x === 110 ? 72 : 78} r="5" fill={['#ff5c8a', '#ffd23f', '#5ad0ff', '#ffd23f', '#ff5c8a'][i]} style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
      {steam && (
        <g class="mk-steam" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55">
          <path d="M80 70 q-8 -14 0 -26 q8 -12 0 -24" />
          <path d="M140 70 q8 -14 0 -26 q-8 -12 0 -24" />
        </g>
      )}
      <defs>
        <radialGradient id="mk-glow" cx="50%" cy="60%" r="70%">
          <stop offset="0%" stop-color="#fff4c9" stop-opacity=".8" />
          <stop offset="100%" stop-color="#ff9a3c" stop-opacity=".2" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/** Cartoon mug of hot mulled wine with cinnamon stick, star anise, and thick #2a120a outline. */
export function GluehweinMug({ class: cls = 'mk-prop-svg' }: { class?: string }) {
  return (
    <svg class={cls} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M44 26 h6 q8 0 8 9 t-8 9 h-6" fill="none" stroke="#2a120a" stroke-width="7" stroke-linecap="round" />
      <path d="M44 26 h6 q8 0 8 9 t-8 9 h-6" fill="none" stroke="#f5ebdc" stroke-width="3" stroke-linecap="round" />
      <path d="M26 8 q-4 -5 0 -7 M34 9 q4 -5 0 -7" fill="none" stroke="#fff4dc" stroke-width="2.5" stroke-linecap="round" opacity=".8" />
      <rect x="29" y="10" width="5" height="15" rx="2" transform="rotate(20 31 18)" fill="#a86434" stroke="#2a120a" stroke-width="2.5" />
      <rect x="14" y="20" width="32" height="34" rx="8" fill="#a82038" stroke="#2a120a" stroke-width="3.5" />
      <ellipse cx="30" cy="21" rx="14" ry="5" fill="#4f0c18" stroke="#2a120a" stroke-width="3" />
      <ellipse cx="26" cy="21" rx="6" ry="2.2" fill="#82182b" />
      <path d="M14 44 h32 v5 q0 5 -6 5 h-20 q-6 0 -6 -5 Z" fill="#f5ebdc" stroke="#2a120a" stroke-width="3" />
      <circle cx="30" cy="35" r="3" fill="#ffd23f" />
    </svg>
  );
}

/** Paper cone overflowing with shiny roasted chestnuts. */
function MaroniCone({ class: cls = 'mk-prop-svg' }: { class?: string }) {
  return (
    <svg class={cls} viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="24" cy="22" rx="9" ry="7.5" fill="#70381e" stroke="#2a120a" stroke-width="3" />
      <ellipse cx="39" cy="21" rx="9.5" ry="7.5" fill="#854524" stroke="#2a120a" stroke-width="3" />
      <ellipse cx="31" cy="16" rx="9" ry="7" fill="#9a542d" stroke="#2a120a" stroke-width="3" />
      <circle cx="29" cy="14" r="2" fill="#e6a972" opacity=".7" />
      <circle cx="41" cy="19" r="2" fill="#e6a972" opacity=".7" />
      <path d="M14 25 L32 58 L50 25 Q32 32 14 25 Z" fill="#f5deb8" stroke="#2a120a" stroke-width="3.5" stroke-linejoin="round" />
      <path d="M21 34 h22 M25 42 h14" stroke="#d19a5a" stroke-width="2.5" stroke-linecap="round" />
    </svg>
  );
}

/** Trio of glossy painted Christmas glass baubles. */
function BaublesCluster({ class: cls = 'mk-prop-svg' }: { class?: string }) {
  return (
    <svg class={cls} viewBox="0 0 64 64" aria-hidden="true">
      {[
        { cx: 19, cy: 36, r: 12, fill: '#d62845', hi: '#ff8da1' },
        { cx: 45, cy: 36, r: 12, fill: '#3d88e8', hi: '#a3d4ff' },
        { cx: 32, cy: 25, r: 13.5, fill: '#f5be2c', hi: '#fff4a8' },
      ].map((b) => (
        <g>
          <rect x={b.cx - 3.5} y={b.cy - b.r - 4} width="7" height="5" rx="1.5" fill="#e3b13b" stroke="#2a120a" stroke-width="2" />
          <circle cx={b.cx} cy={b.cy} r={b.r} fill={b.fill} stroke="#2a120a" stroke-width="3" />
          <circle cx={b.cx - b.r * 0.35} cy={b.cy - b.r * 0.32} r={b.r * 0.24} fill={b.hi} opacity=".85" />
        </g>
      ))}
    </svg>
  );
}

/** Painted carousel pony inside the Karussell SVG roof. */
function CarouselHorse({ x, y, tint, saddle }: { x: number; y: number; tint: string; saddle: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="0" rx="13" ry="6.5" fill={tint} stroke="#2a120a" stroke-width="2.2" />
      <path d="M6 -2 L11 -13 L17 -10 L13 0 Z" fill={tint} stroke="#2a120a" stroke-width="2.2" stroke-linejoin="round" />
      <path d="M-9 5 L-12 13 M-3 6 L-4 13 M6 5 L5 13 M11 4 L15 11" stroke="#2a120a" stroke-width="2.4" stroke-linecap="round" />
      <path d="M-4 -6 Q0 1 4 -6 Z" fill={saddle} stroke="#2a120a" stroke-width="1.6" />
      <circle cx="13" cy="-10" r="1.1" fill="#2a120a" />
    </g>
  );
}

function StallArt({ id }: { id: string }) {
  switch (id) {
    case 'wheel':
      return (
        <svg class="mk-wheel" viewBox="0 0 220 200" aria-hidden="true">
          <path d="M110 100 L60 196 M110 100 L160 196" stroke="#3b2a4a" stroke-width="8" />
          <g class="mk-wheel-spin">
            <circle cx="110" cy="100" r="86" fill="none" stroke="#ffd23f" stroke-width="5" />
            <circle cx="110" cy="100" r="70" fill="none" stroke="#ff5c8a" stroke-width="3" stroke-dasharray="4 10" />
            {Array.from({ length: 10 }, (_, i) => {
              const a = (i / 10) * Math.PI * 2;
              return <path d={`M110 100 L${110 + Math.cos(a) * 86} ${100 + Math.sin(a) * 86}`} stroke="#ffd23f" stroke-width="2.5" />;
            })}
          </g>
          {Array.from({ length: 10 }, (_, i) => (
            <g class="mk-gondola" style={{ animationDelay: `${-i * 2.4}s` }}>
              <rect class="mk-gondola-up" x="186" y="100" width="20" height="16" rx="4" fill={['#c8243c', '#ffd23f', '#5ad0ff', '#2fd6a8', '#ff8fb1'][i % 5]} stroke="#2a120a" stroke-width="2" style={{ animationDelay: `${-i * 2.4}s` }} />
            </g>
          ))}
          <circle cx="110" cy="100" r="10" fill="#ffd23f" stroke="#2a120a" stroke-width="3" />
        </svg>
      );
    case 'tree':
      return (
        <svg class="mk-tree" viewBox="0 0 220 220" aria-hidden="true">
          <rect x="98" y="186" width="24" height="30" fill="#6e3a22" />
          <path d="M110 6 L196 190 L24 190 Z" fill="#1f6b3f" stroke="#0f3a22" stroke-width="4" stroke-linejoin="round" />
          <path d="M110 6 L170 130 L50 130 Z" fill="#26804b" />
          <path d="M110 6 L148 80 L72 80 Z" fill="#2f9459" />
          <path d="M56 150 Q110 176 170 140 M76 104 Q112 122 150 98 M90 62 Q112 74 132 58" stroke="#ffd23f" stroke-width="3" fill="none" stroke-dasharray="3 9" stroke-linecap="round" />
          {[
            [70, 170],
            [150, 166],
            [96, 136],
            [134, 120],
            [84, 96],
            [120, 70],
            [104, 44],
            [180, 182],
            [40, 182],
          ].map(([x, y], i) => (
            <circle class="mk-bulb" cx={x} cy={y} r="7" fill={['#ff5c8a', '#ffd23f', '#5ad0ff', '#fffaf2'][i % 4]} style={{ animationDelay: `${i * 0.17}s` }} />
          ))}
          <path class="mk-star" d="M110 -8 l6 14 l15 1 l-11 10 l4 15 l-14 -8 l-14 8 l4 -15 l-11 -10 l15 -1 Z" fill="#ffd23f" stroke="#a06d00" stroke-width="2" />
        </svg>
      );
    case 'hearts':
      return (
        <svg class="mk-hearts" viewBox="0 0 220 200" aria-hidden="true">
          <path d="M110 196 V110 M110 130 Q70 100 60 60 M110 120 Q150 96 162 54 M110 150 Q76 140 44 120 M110 146 Q150 136 180 112" stroke="#5a3a24" stroke-width="9" fill="none" stroke-linecap="round" />
          {[
            [60, 50],
            [100, 40],
            [140, 36],
            [168, 60],
            [44, 96],
            [84, 80],
            [128, 74],
            [176, 100],
            [70, 120],
            [150, 116],
            [110, 100],
          ].map(([x, y], i) => (
            <path
              class="mk-heart"
              style={{ animationDelay: `${i * 0.23}s` }}
              d={`M${x} ${y + 12} C${x - 18} ${y} ${x - 14} ${y - 12} ${x} ${y - 4} C${x + 14} ${y - 12} ${x + 18} ${y} ${x} ${y + 12} Z`}
              fill={i % 3 === 0 ? '#ff5c8a' : i % 3 === 1 ? '#c8243c' : '#ff8fb1'}
              stroke="#2a120a"
              stroke-width="2"
            />
          ))}
        </svg>
      );
    case 'rink':
    case 'curling':
      return (
        <svg class={`mk-rink ${id}`} viewBox="0 0 240 170" aria-hidden="true">
          <ellipse cx="120" cy="110" rx="114" ry="54" fill="#bfe3ff" stroke="#fffaf2" stroke-width="8" />
          <ellipse cx="120" cy="110" rx="90" ry="38" fill="none" stroke="#fff" stroke-width="2" opacity=".6" />
          <path d="M40 100 q40 -10 80 0 M120 124 q40 10 70 -4" stroke="#fff" stroke-width="3" fill="none" opacity=".7" />
          {id === 'curling' ? (
            <g>
              <circle cx="190" cy="110" r="22" fill="none" stroke="#c8243c" stroke-width="6" />
              <circle cx="190" cy="110" r="9" fill="none" stroke="#2f6bff" stroke-width="5" />
              <g class="mk-stone">
                <ellipse cx="60" cy="112" rx="16" ry="9" fill="#6b6b78" stroke="#2a120a" stroke-width="2.5" />
                <rect x="54" y="98" width="12" height="9" rx="3" fill="#c8243c" />
              </g>
              <ellipse cx="174" cy="122" rx="14" ry="8" fill="#6b6b78" stroke="#2a120a" stroke-width="2.5" />
            </g>
          ) : (
            <g class="mk-skaters">
              {[0, 1, 2].map((i) => (
                <g class="mk-iceskater" style={{ '--i': i }}>
                  <g transform="translate(-14 -11) scale(0.24)">
                    <path d={PIEROGI_PATH} fill={['#ff8fb1', '#ffd23f', '#5ad0ff'][i]} stroke="#2a120a" stroke-width="8" stroke-linejoin="round" />
                  </g>
                  <circle cx="-3.5" cy="1" r="1.4" fill="#2a120a" />
                  <circle cx="3.5" cy="1" r="1.4" fill="#2a120a" />
                </g>
              ))}
            </g>
          )}
        </svg>
      );
    case 'carousel':
      return (
        <svg class="mk-carousel" viewBox="0 0 220 200" aria-hidden="true">
          <rect x="22" y="170" width="176" height="20" rx="8" fill="#c98a52" stroke="#2a120a" stroke-width="3" />
          <rect x="106" y="40" width="8" height="132" fill="#ffd23f" />
          {[40, 80, 140, 180].map((x, i) => (
            <g class="mk-horse" style={{ animationDelay: `${i * 0.3}s` }}>
              <rect x={x - 2} y="60" width="4" height="100" fill="#ffd23f" />
              <CarouselHorse x={x} y={132} tint={['#fff6e5', '#f3cf8a', '#fff6e5', '#e8b98a'][i]} saddle={['#c8243c', '#2f6bff', '#2fd6a8', '#ff5c8a'][i]} />
            </g>
          ))}
          <path d="M6 66 L110 6 L214 66 Z" fill="#c8243c" stroke="#2a120a" stroke-width="4" stroke-linejoin="round" />
          <path d="M110 6 L60 66 M110 6 L160 66 M110 6 L110 66" stroke="#fffaf2" stroke-width="10" />
          <path d="M6 66 Q30 84 58 66 Q84 84 110 66 Q136 84 162 66 Q190 84 214 66" fill="#fffaf2" stroke="#2a120a" stroke-width="3" />
          <circle cx="110" cy="4" r="7" fill="#ffd23f" stroke="#2a120a" stroke-width="2" />
        </svg>
      );
    case 'tent':
      return (
        <svg class="mk-tent" viewBox="0 0 220 180" aria-hidden="true">
          <path d="M10 176 L110 8 L210 176 Z" fill="#c8243c" stroke="#2a120a" stroke-width="4" stroke-linejoin="round" />
          <path d="M110 8 L60 176 M110 8 L160 176 M110 8 L35 176 M110 8 L185 176" stroke="#2a1616" stroke-width="12" opacity=".55" />
          <path d="M84 176 Q110 96 136 176 Z" fill="#160a0a" />
          {/* Something glares out of the dark. */}
          <g class="mk-tent-eyes">
            <ellipse cx="102" cy="140" rx="5" ry="4" fill="#ff3b3b" />
            <ellipse cx="118" cy="140" rx="5" ry="4" fill="#ff3b3b" />
          </g>
          <path d="M88 40 q-14 -16 -6 -34 q4 16 16 22 Z M132 40 q14 -16 6 -34 q-4 16 -16 22 Z" fill="#3a2418" stroke="#2a120a" stroke-width="2" />
        </svg>
      );
    case 'gluehwein':
      return (
        <>
          <Hut steam color="#7a2a3a" />
          <GluehweinMug class="mk-prop-svg" />
        </>
      );
    case 'maroni':
      return (
        <>
          <Hut steam />
          <MaroniCone class="mk-prop-svg" />
        </>
      );
    case 'punsch':
      return (
        <>
          <Hut steam color="#2f5a7a" />
          <img class="mk-prop-img" src={resources.url('swap', 'tea') ?? ''} alt="" />
        </>
      );
    case 'lebkuchen':
      return (
        <>
          <Hut color="#9a5a2a" />
          <img class="mk-prop-img" src={resources.url('swap', 'gingerbread') ?? ''} alt="" />
        </>
      );
    default:
      return (
        <>
          <Hut color="#3a5a3a" />
          <BaublesCluster class="mk-prop-svg" />
        </>
      );
  }
}

/** Krampus: shaggy, horned, long red tongue. With his back to you, or glaring, eyes ablaze. */
export function Krampus({ looking }: { looking: boolean }) {
  return (
    <svg class={`krampus ${looking ? 'looking' : ''}`} viewBox="0 0 200 260" aria-label="Krampus">
      {/* Horns. */}
      <path d="M62 66 Q20 40 30 -2 Q48 30 82 46 Z" fill="#d9c7a3" stroke="#2a120a" stroke-width="4" stroke-linejoin="round" />
      <path d="M138 66 Q180 40 170 -2 Q152 30 118 46 Z" fill="#d9c7a3" stroke="#2a120a" stroke-width="4" stroke-linejoin="round" />
      <path d="M40 30 l12 4 M46 14 l10 8 M160 30 l-12 4 M154 14 l-10 8" stroke="#8a7a5a" stroke-width="3" />
      {/* Shaggy body. */}
      <path
        d="M30 120 Q20 70 60 54 Q100 36 140 54 Q180 70 170 120 Q190 180 176 250 L150 236 L136 256 L118 238 L100 258 L82 238 L64 256 L50 236 L24 250 Q10 180 30 120 Z"
        fill="#3a2418"
        stroke="#160a06"
        stroke-width="4"
      />
      <path d="M50 140 l-8 16 M70 170 l-6 18 M130 170 l6 18 M150 140 l8 16 M100 190 v20 M80 120 l-4 14 M120 120 l4 14" stroke="#5a3a28" stroke-width="5" stroke-linecap="round" />
      {looking ? (
        <g>
          {/* Face. */}
          <ellipse cx="100" cy="96" rx="44" ry="40" fill="#5a2a1a" stroke="#160a06" stroke-width="4" />
          <path d="M66 82 L92 92 M134 82 L108 92" stroke="#160a06" stroke-width="6" stroke-linecap="round" />
          <ellipse class="krampus-eye" cx="82" cy="98" rx="10" ry="8" fill="#ffdd33" />
          <ellipse class="krampus-eye" cx="118" cy="98" rx="10" ry="8" fill="#ffdd33" />
          <circle cx="82" cy="98" r="3.5" fill="#c8001a" />
          <circle cx="118" cy="98" r="3.5" fill="#c8001a" />
          <path d="M74 118 Q100 136 126 118 Q120 128 100 130 Q80 128 74 118 Z" fill="#160a06" />
          <path d="M80 118 l4 8 l4 -8 M112 118 l4 8 l4 -8" fill="#fffaf2" />
          <path class="krampus-tongue" d="M94 126 Q90 170 100 196 Q112 172 106 126 Z" fill="#e8314f" stroke="#7a0a1a" stroke-width="2" />
          {/* Birch switch, raised. */}
          <path d="M170 60 l26 -50 M176 54 l16 -40 M182 58 l20 -36" stroke="#8a6a4a" stroke-width="3" />
        </g>
      ) : (
        <g>
          {/* His back: just fur and the bell on his belt. */}
          <path d="M60 80 Q100 60 140 80 M56 104 Q100 84 144 104" stroke="#5a3a28" stroke-width="5" fill="none" />
          <circle cx="100" cy="170" r="12" fill="#c9a23a" stroke="#2a120a" stroke-width="3" />
          <text x="100" y="66" text-anchor="middle" font-size="22">
            💤
          </text>
        </g>
      )}
    </svg>
  );
}

/** A dodgy guy in a long coat, flashing a row of "genuine" watches. */
export function WatchSeller() {
  return (
    <svg class="mk-seller" viewBox="0 0 90 120" aria-label="Watch seller">
      <ellipse cx="45" cy="20" rx="14" ry="15" fill="#f2c9a0" stroke="#2a120a" stroke-width="2.5" />
      <path d="M26 12 Q45 -6 64 12 L68 14 L22 14 Z" fill="#2a2a32" stroke="#2a120a" stroke-width="2" />
      <path d="M38 22 h4 M48 22 h4" stroke="#2a120a" stroke-width="3" />
      <path d="M38 29 q7 4 14 0" stroke="#2a120a" stroke-width="2" fill="none" />
      <path d="M20 40 Q45 30 70 40 L78 116 L12 116 Z" fill="#6b5a3a" stroke="#2a120a" stroke-width="2.5" />
      {/* The coat flung open: watches everywhere. */}
      <path d="M12 44 L-6 108 L20 112 Z M78 44 L96 108 L70 112 Z" fill="#7d6a46" stroke="#2a120a" stroke-width="2" />
      <path d="M30 44 h30 v66 h-30 Z" fill="#c9b48a" />
      {[52, 66, 80, 94].map((y) => (
        <g>
          <circle cx="38" cy={y} r="5" fill="#ffd23f" stroke="#2a120a" stroke-width="1.5" />
          <circle cx="52" cy={y} r="5" fill="#e0e0e8" stroke="#2a120a" stroke-width="1.5" />
        </g>
      ))}
    </svg>
  );
}

export const GRID = { COLS, ROWS };
