/** Wesele art: Wujek Zbyszek, the hall, the band, and guests getting drunker. */
import { Pierogi } from '../../lib/art';

/** Wujek Zbyszek: bald, red-faced, big moustache, tie round his forehead, a shot glass held high. */
export function Wujek({ size = 300, dancing = false, flip = false }: { size?: number; dancing?: boolean; flip?: boolean }) {
  return (
    <svg class={`wujek ${dancing ? 'dancing' : ''}`} width={size} height={size * 1.4} viewBox="0 0 200 280" style={flip ? { transform: 'scaleX(-1)' } : undefined} aria-label="Wujek Zbyszek">
      <g class="wujek-body">
        {/* Legs and shoes. */}
        <g class="wujek-leg-l">
          <rect x="66" y="196" width="26" height="62" rx="10" fill="#3b3550" />
          <ellipse cx="74" cy="262" rx="22" ry="10" fill="#1b1414" />
        </g>
        <g class="wujek-leg-r">
          <rect x="108" y="196" width="26" height="62" rx="10" fill="#3b3550" />
          <ellipse cx="126" cy="262" rx="22" ry="10" fill="#1b1414" />
        </g>
        {/* Belly in a white shirt, braces, the shirt coming untucked. */}
        <ellipse cx="100" cy="160" rx="66" ry="62" fill="#f6f1e8" stroke="#2a120a" stroke-width="4" />
        <path d="M68 108 L76 214 M132 108 L124 214" stroke="#b5263c" stroke-width="7" />
        <path d="M92 210 q8 10 16 0" fill="#f6f1e8" stroke="#2a120a" stroke-width="3" />
        <circle cx="100" cy="140" r="3" fill="#2a120a" />
        <circle cx="100" cy="164" r="3" fill="#2a120a" />
        <circle cx="100" cy="188" r="3" fill="#2a120a" />
        {/* Arm up with the shot glass. */}
        <g class="wujek-arm">
          <path d="M150 128 Q178 100 176 62" stroke="#f6f1e8" stroke-width="22" fill="none" stroke-linecap="round" />
          <circle cx="176" cy="56" r="13" fill="#f2a98a" stroke="#2a120a" stroke-width="3" />
          <path d="M166 22 L186 22 L183 46 L169 46 Z" fill="#dff3ff" fill-opacity=".85" stroke="#2a120a" stroke-width="3" />
          <path d="M168 30 L184 30 L183 44 L169 44 Z" fill="#fff" opacity=".7" />
        </g>
        <path d="M50 128 Q24 150 34 182" stroke="#f6f1e8" stroke-width="22" fill="none" stroke-linecap="round" />
        <circle cx="35" cy="186" r="12" fill="#f2a98a" stroke="#2a120a" stroke-width="3" />
        {/* Head. */}
        <g class="wujek-head">
          <ellipse cx="100" cy="72" rx="48" ry="50" fill="#f2a98a" stroke="#2a120a" stroke-width="4" />
          <ellipse cx="76" cy="84" rx="13" ry="9" fill="#e8553f" opacity=".55" />
          <ellipse cx="124" cy="84" rx="13" ry="9" fill="#e8553f" opacity=".55" />
          <ellipse cx="100" cy="88" rx="11" ry="9" fill="#e86b56" stroke="#2a120a" stroke-width="2.5" />
          {/* Happy squinting eyes. */}
          <path d="M72 66 q8 -8 16 0 M112 66 q8 -8 16 0" stroke="#2a120a" stroke-width="4" fill="none" stroke-linecap="round" />
          {/* The moustache. */}
          <path d="M68 104 Q84 90 100 100 Q116 90 132 104 Q120 116 100 106 Q80 116 68 104 Z" fill="#5a3a24" stroke="#2a120a" stroke-width="2.5" />
          <path d="M88 112 q12 10 24 0" stroke="#2a120a" stroke-width="3" fill="#7a2030" />
          {/* Comb-over and the tie round his head. */}
          <path d="M62 52 q38 -26 76 0" stroke="#5a3a24" stroke-width="3" fill="none" />
          <path d="M54 44 Q100 26 146 44 L146 54 Q100 36 54 54 Z" fill="#c8243c" stroke="#2a120a" stroke-width="2.5" />
          <path d="M146 46 l22 -10 l-6 18 Z M146 50 l18 12 l-2 -18 Z" fill="#c8243c" stroke="#2a120a" stroke-width="2.5" />
          <path d="M70 46 l6 4 M90 40 l6 4 M110 39 l6 4 M130 42 l6 4" stroke="#ffd23f" stroke-width="3" />
        </g>
      </g>
    </svg>
  );
}

/** The band on the stage: accordion, drum, keyboard. */
export function Band({ playing }: { playing: boolean }) {
  return (
    <div class={`wes-band ${playing ? 'playing' : ''}`}>
      <span>🪗</span>
      <span>🥁</span>
      <span>🎹</span>
      <span>🎺</span>
    </div>
  );
}

/** What a pierogi guest is doing. */
export type Act = 'sit' | 'drink' | 'twirl' | 'stand' | 'bang' | 'clink' | 'out';

/** A small shot glass of vodka. */
function ShotGlass({ empty }: { empty?: boolean }) {
  return (
    <svg class="pg-glass" viewBox="0 0 30 36" aria-hidden="true">
      <path d="M3 2 L27 2 L24 34 L6 34 Z" fill="#e8f6ff" fill-opacity=".55" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      {!empty && <path class="pg-vodka" d="M4.5 12 L25.5 12 L24 32 L6 32 Z" fill="#cfe9ff" />}
      <path d="M8 6 L7 28" stroke="#fff" stroke-width="2" opacity=".7" />
    </svg>
  );
}

/**
 * A pierogi wedding guest: raises the glass and knocks it back, twirls on the dance floor, bangs the
 * table for Gorzko, and slides under the table when it's all too much. Wobblier the drunker they are.
 */
export function PGuest({
  color,
  name,
  drunk,
  act,
  size = 110,
  tag,
}: {
  color: string;
  name: string;
  drunk: number;
  act: Act;
  size?: number;
  tag?: preact.ComponentChildren;
}) {
  const out = act === 'out';
  return (
    <div class={`pg act-${act} d${out ? 'x' : drunk}`} style={{ '--pc': color, '--sz': `${size}px` }}>
      <div class="pg-tag">
        <span class="pg-name">{name}</span>
        <span class="pg-meter">
          {Array.from({ length: 5 }, (_, i) => (
            <i class={i < drunk || out ? 'full' : ''} />
          ))}
        </span>
        {tag}
      </div>
      <div class="pg-body">
        <div class="pg-lean">
          <Pierogi color={color} size={size} mood={out ? 'sleep' : act === 'drink' ? 'wow' : drunk >= 3 ? 'wow' : 'happy'} />
          {drunk >= 1 && !out && <span class="pg-blush" />}
          {drunk >= 4 && !out && <span class="pg-tie" />}
          {out && <span class="pg-zzz">💤</span>}
          {drunk >= 5 && !out && <span class="pg-hic">hic!</span>}
        </div>
        {!out && act !== 'twirl' && (
          <div class="pg-hand">
            <ShotGlass empty={act === 'clink' ? false : undefined} />
          </div>
        )}
      </div>
    </div>
  );
}

/** A round guest table with a white cloth, plates, a bottle of vodka and a bowl of pierogi. */
export function RoundTable() {
  return (
    <svg class="wes-table" viewBox="0 0 440 200" aria-hidden="true">
      <ellipse cx="220" cy="186" rx="170" ry="12" fill="#000" opacity=".25" />
      {/* Cloth hanging down. */}
      <path d="M14 78 Q14 170 50 176 L390 176 Q426 170 426 78 Z" fill="#f4eee4" stroke="#2a120a" stroke-width="3" />
      <path d="M60 110 v62 M120 118 v58 M180 122 v54 M240 122 v54 M300 118 v58 M360 110 v62" stroke="#ddd3c2" stroke-width="3" />
      <path d="M14 96 Q60 130 110 104 Q160 132 220 106 Q280 132 330 104 Q380 130 426 96" fill="none" stroke="#e7c35a" stroke-width="5" />
      {/* Top. */}
      <ellipse cx="220" cy="78" rx="206" ry="62" fill="#fffaf2" stroke="#2a120a" stroke-width="3" />
      {/* Plates. */}
      {[
        [96, 74],
        [168, 50],
        [272, 50],
        [344, 74],
        [220, 112],
      ].map(([x, y]) => (
        <g>
          <ellipse cx={x} cy={y} rx="30" ry="11" fill="#fff" stroke="#c9c1b2" stroke-width="2" />
          <ellipse cx={x} cy={y} rx="18" ry="6" fill="#f3e9d6" />
        </g>
      ))}
      {/* A bowl of pierogi. */}
      <ellipse cx="160" cy="92" rx="30" ry="12" fill="#7a5cf0" stroke="#2a120a" stroke-width="2.5" />
      <path d="M140 88 q8 -12 16 0 M156 86 q8 -12 16 0 M168 90 q8 -10 14 0" fill="#f3cf6b" stroke="#2a120a" stroke-width="1.5" />
      {/* Vodka bottle and glasses. */}
      <g transform="translate(250 34)">
        <rect x="0" y="16" width="26" height="50" rx="7" fill="#e8f6ff" fill-opacity=".85" stroke="#2a120a" stroke-width="2.5" />
        <rect x="8" y="0" width="10" height="20" rx="3" fill="#e8f6ff" stroke="#2a120a" stroke-width="2.5" />
        <rect x="0" y="34" width="26" height="16" fill="#c8243c" />
        <rect x="8" y="-4" width="10" height="6" rx="2" fill="#c8243c" />
      </g>
      <path d="M294 80 l14 0 l-2 16 l-10 0 Z M118 66 l14 0 l-2 16 l-10 0 Z" fill="#e8f6ff" stroke="#2a120a" stroke-width="2" />
      {/* Flowers. */}
      <circle cx="206" cy="70" r="8" fill="#ff8fb1" />
      <circle cx="218" cy="64" r="7" fill="#fbf0d9" />
      <circle cx="228" cy="72" r="7" fill="#ff8fb1" />
    </svg>
  );
}

/** The head table, with the pierogi bride (veil and bouquet) and groom (bow tie). */
export function HeadTable({ kiss }: { kiss: boolean }) {
  return (
    <div class={`wes-head ${kiss ? 'kiss' : ''}`}>
      <div class="wes-couple">
        <div class="wes-bride">
          <svg class="wes-veil" viewBox="0 0 120 120" aria-hidden="true">
            <path d="M20 40 Q60 -4 100 40 Q112 90 96 116 L60 70 L24 116 Q8 90 20 40 Z" fill="#fff" fill-opacity=".75" stroke="#d8d0c4" stroke-width="2" />
            <circle cx="40" cy="28" r="6" fill="#ff8fb1" />
            <circle cx="60" cy="20" r="6" fill="#fff" stroke="#e7c35a" stroke-width="2" />
            <circle cx="80" cy="28" r="6" fill="#ff8fb1" />
          </svg>
          <Pierogi color="#fff4e6" size={120} mood="happy" />
          <span class="wes-bouquet">💐</span>
        </div>
        <span class="wes-heart">❤️</span>
        <div class="wes-groom">
          <Pierogi color="#f3cf6b" size={120} mood="happy" />
          <svg class="wes-bow" viewBox="0 0 40 20" aria-hidden="true">
            <path d="M2 2 L18 10 L2 18 Z M38 2 L22 10 L38 18 Z" fill="#241015" />
            <circle cx="20" cy="10" r="4" fill="#241015" />
          </svg>
        </div>
      </div>
      <svg class="wes-headtable" viewBox="0 0 700 110" aria-hidden="true">
        <rect x="6" y="10" width="688" height="96" rx="8" fill="#f4eee4" stroke="#2a120a" stroke-width="3" />
        <path d="M6 30 Q60 64 120 30 Q180 64 240 30 Q300 64 360 30 Q420 64 480 30 Q540 64 600 30 Q650 60 694 30" fill="none" stroke="#e7c35a" stroke-width="6" />
        {[60, 180, 300, 400, 520, 640].map((x) => (
          <g>
            <circle cx={x} cy="34" r="12" fill="#ff8fb1" />
            <circle cx={x + 14} cy="40" r="10" fill="#fffaf2" stroke="#e7c35a" stroke-width="2" />
            <circle cx={x - 12} cy="42" r="9" fill="#ff5c8a" />
          </g>
        ))}
        <rect x="6" y="6" width="688" height="12" rx="4" fill="#fffaf2" stroke="#2a120a" stroke-width="3" />
      </svg>
    </div>
  );
}
