/**
 * Krampus auf dem Eis on the TV: the Rathausplatz ice rink at night in perspective, pierogi skating
 * laps (striding, leaning, scarves flying), Krampus in the middle attacking, falls and dodges.
 */
import { useEffect, useState } from 'preact/hooks';
import { colorHex } from '../../../../shared/protocol';
import { Pierogi } from '../../lib/art';
import { ATTACKS, DODGE_MS, lapsAt } from './logic';
import { Krampus, Snow } from './art';
import type { MarktGame } from './MarktGame';

/** The skating path: an ellipse on the ice, centre and radii in stage px. */
const CX = 864;
const CY = 640;
const RX = 600;
const RY = 190;

function useFrame() {
  const [, set] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      set((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

export function IceRink({ game }: { game: MarktGame }) {
  useFrame();
  const now = Date.now();
  const t = now - game.laufStart;
  const over = game.phase !== 'lauf';
  // The attack on now (shown from its start until the dodge window closes).
  const cur = game.attacks.findIndex(([a]) => t >= a && t < a + DODGE_MS);
  const atk = cur >= 0 ? ATTACKS[game.attacks[cur][1]] : null;
  const ids = [...game.laufIds].filter((id) => game.ids.includes(id));

  return (
    <div class="mk-rinkscene">
      <div class="mk-rk-sky" />
      <RinkBackdrop />
      <div class="mk-rk-ground" />
      <svg class="mk-rk-ice" viewBox="0 0 1728 972" aria-hidden="true">
        <defs>
          <radialGradient id="rk-ice" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stop-color="#f2fbff" />
            <stop offset="55%" stop-color="#cfe9fb" />
            <stop offset="100%" stop-color="#9cc8ea" />
          </radialGradient>
          <filter id="rk-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <clipPath id="rk-clip">
            <ellipse cx={CX} cy={CY} rx="720" ry="270" />
          </clipPath>
        </defs>
        {/* The boards: the side you see, then the top edge. */}
        <ellipse cx={CX} cy={CY + 26} rx="736" ry="286" fill="#7a1e2e" />
        <ellipse cx={CX} cy={CY + 14} rx="736" ry="284" fill="#fffaf2" />
        <ellipse cx={CX} cy={CY + 14} rx="736" ry="284" fill="none" stroke="#c8243c" stroke-width="10" stroke-dasharray="60 60" />
        <ellipse cx={CX} cy={CY} rx="720" ry="270" fill="url(#rk-ice)" />
        <g clip-path="url(#rk-clip)">
          {/* Lights reflected in the ice. */}
          {[
            [420, 450, '#ffd23f'],
            [700, 420, '#ff8fb1'],
            [1000, 425, '#ffd23f'],
            [1300, 455, '#5ad0ff'],
            [864, 470, '#fff4c9'],
          ].map(([x, y, c]) => (
            <ellipse cx={x as number} cy={y as number} rx="70" ry="22" fill={c as string} opacity=".35" filter="url(#rk-blur)" />
          ))}
          {/* Scratches from a thousand skates. */}
          <g fill="none" stroke="#ffffff" stroke-width="2" opacity=".55">
            <ellipse cx={CX} cy={CY} rx="600" ry="190" />
            <ellipse cx={CX} cy={CY + 6} rx="560" ry="170" opacity=".6" />
            <ellipse cx={CX} cy={CY - 4} rx="640" ry="214" opacity=".5" />
            <path d="M400 700 q80 -40 160 -10 M1100 560 q90 30 170 -10 M700 780 q60 -30 140 0 M980 520 q40 20 120 4" />
          </g>
          <ellipse cx={CX} cy={CY - 120} rx="500" ry="40" fill="#fff" opacity=".25" filter="url(#rk-blur)" />
        </g>
      </svg>

      {/* Krampus in the middle of the ice. */}
      <div class={`mk-rk-krampus ${atk ? 'attack' : ''}`} style={{ zIndex: CY }}>
        <Krampus looking />
      </div>

      {/* The attack flying across the ice. */}
      {atk && !over && (
        <div class={`mk-rk-attack a-${atk.dodge}`} key={`a${cur}`}>
          <span>{atk.emoji}</span>
        </div>
      )}

      {ids.map((id, k) => {
        const p = game.host_player(id);
        if (!p) return null;
        const d = game.dodges.get(id) ?? [];
        let ok = 0;
        let fell = 0;
        let state: 'skate' | 'fall' | 'jump' | 'duck' | 'swerve' = 'skate';
        for (let i = 0; i < game.attacks.length; i++) {
          const [a, kind] = game.attacks[i];
          const end = a + DODGE_MS;
          const r = d[i];
          if (r !== undefined && r > 0) {
            ok++;
            if (t >= a && t < end + 400) state = ATTACKS[kind].dodge;
          } else if ((r !== undefined && t >= a) || t >= end) {
            fell++;
            // Show the fall for a moment after it happens.
            const from = r !== undefined ? a : end;
            if (t >= from && t < from + 1400) state = 'fall';
          }
        }
        const laps = lapsAt(t, ok, fell);
        const theta = (k / ids.length) * Math.PI * 2 + laps * Math.PI * 2;
        const x = CX + Math.cos(theta) * RX;
        const y = CY + Math.sin(theta) * RY;
        const depth = (Math.sin(theta) + 1) / 2;
        const scale = 0.72 + depth * 0.42;
        // Going right along the front, left along the back.
        const flip = -Math.sin(theta) < 0;
        const pts = game.laufPts[id];
        return (
          <div class={`mk-rk-skater st-${state}`} style={{ left: `${x}px`, top: `${y}px`, zIndex: Math.round(y), '--s': scale, '--pc': colorHex(p.color) }}>
            <span class="mk-rk-tag">
              {p.name} {ok > 0 && <b>✅{ok}</b>}
              {over && pts !== undefined && <b class="mk-rk-pts">+{pts}</b>}
            </span>
            <div class={`mk-rk-body ${flip ? 'flip' : ''}`} style={{ animationDelay: `${-k * 0.17}s` }}>
              <span class="mk-rk-scarf" />
              <Pierogi color={colorHex(p.color)} size={92} mood={state === 'fall' ? 'dead' : state === 'skate' ? 'happy' : 'wow'} />
              <span class="mk-rk-beanie" />
              <span class="mk-rk-skates">
                <i />
                <i />
              </span>
              <span class="mk-rk-spray" />
              {state === 'fall' && <span class="mk-rk-stars">💫</span>}
            </div>
            <span class="mk-rk-shadow" />
          </div>
        );
      })}

      {/* The call, big, as it happens (the phones show it at the same moment). */}
      {!over && t < 0 && <div class="mk-rk-call count">{Math.ceil(-t / 1000)}</div>}
      {!over && atk && (
        <div class="mk-rk-call" key={`c${cur}`}>
          {atk.emoji} {atk.text} <b>{atk.dodge.toUpperCase()}!</b>
        </div>
      )}
      <Snow count={170} />
    </div>
  );
}

/** Behind the rink: the Rathaus, lit trees and the market stalls glowing in the dark. */
function RinkBackdrop() {
  return (
    <svg class="mk-rk-back" viewBox="0 0 1728 420" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="rk-rh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3d3166" />
          <stop offset="100%" stop-color="#1c1636" />
        </linearGradient>
        <radialGradient id="rk-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffcf6b" stop-opacity=".55" />
          <stop offset="100%" stop-color="#ffcf6b" stop-opacity="0" />
        </radialGradient>
      </defs>
      <g fill="url(#rk-rh)">
        <path d="M420 420 V200 l20 -26 l20 26 V180 h70 v-24 l16 -20 l16 20 v24 h70 V190 l20 -22 l20 22 V420 Z" />
        <path d="M1308 420 V200 l-20 -26 l-20 26 V180 h-70 v-24 l-16 -20 l-16 20 v24 h-70 V190 l-20 -22 l-20 22 V420 Z" />
        <rect x="640" y="170" width="448" height="250" />
        <path d="M824 420 V96 l16 -18 V40 l24 -38 l24 38 v38 l16 18 V420 Z" />
      </g>
      <g fill="#ffcf6b" opacity=".8">
        {Array.from({ length: 18 }, (_, i) => (
          <rect x={660 + i * 24} y={220 + (i % 2) * 50} width="10" height="18" rx="5" />
        ))}
        <circle cx="864" cy="130" r="16" fill="#fff4c9" />
      </g>
      {/* Lit trees and stall roofs round the rink. */}
      {[120, 300, 1430, 1610].map((x) => (
        <g>
          <path d={`M${x} 200 l70 170 h-140 Z`} fill="#123d2a" />
          {Array.from({ length: 9 }, (_, i) => (
            <circle class="mk-bulb" cx={x - 40 + ((i * 37) % 80)} cy={250 + ((i * 53) % 110)} r="4" fill={i % 2 ? '#ffd23f' : '#ff8fb1'} style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </g>
      ))}
      {[0, 240, 1250, 1490].map((x) => (
        <g>
          <ellipse cx={x + 120} cy="380" rx="130" ry="40" fill="url(#rk-glow)" />
          <path d={`M${x + 20} 370 L${x + 120} 320 L${x + 220} 370 Z`} fill="#4a2a1a" />
          <path d={`M${x + 30} 366 Q${x + 120} 320 ${x + 210} 366`} stroke="#fffaf2" stroke-width="8" fill="none" />
          <rect x={x + 40} y="370" width="160" height="50" fill="#5a3220" />
          <rect x={x + 56} y="380" width="128" height="26" rx="4" fill="#ffcf6b" />
        </g>
      ))}
      {/* Fairy lights strung over the rink. */}
      {[
        [0, 60, 864, 150],
        [864, 150, 1728, 60],
      ].map(([x1, y1, x2, y2]) => (
        <g>
          <path d={`M${x1} ${y1} Q${(x1 + x2) / 2} ${Math.max(y1, y2) + 60} ${x2} ${y2}`} stroke="#2a3a2a" stroke-width="2" fill="none" />
          {Array.from({ length: 22 }, (_, i) => {
            const tt = (i + 0.5) / 22;
            const bx = x1 + (x2 - x1) * tt;
            const by = (1 - tt) * (1 - tt) * y1 + 2 * (1 - tt) * tt * (Math.max(y1, y2) + 60) + tt * tt * y2;
            return <circle class="mk-bulb" cx={bx} cy={by + 4} r="5" fill={['#ffd23f', '#ff8fb1', '#5ad0ff'][i % 3]} style={{ animationDelay: `${i * 0.13}s` }} />;
          })}
        </g>
      ))}
    </svg>
  );
}
