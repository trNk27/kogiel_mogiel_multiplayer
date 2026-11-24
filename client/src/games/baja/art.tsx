/**
 * Baja, drawn from her photos: a little pomchi with a ginger coat, a white blaze running up between
 * her big dark eyes, a white muzzle and chest, a liver-brown nose and fluffy upright ears, wrapped
 * up to the chin in her cream sherpa blanket on the grey sofa.
 *
 * `mood` picks the face and the animation (see baja.css):
 *   idle  – blinks, breathes, big hopeful eyes
 *   sniff – leans in, nose twitching
 *   snub  – turns her head away with her eyes shut ("hmph")
 *   lick  – one lick, then looks away
 *   spit  – chews… and spits it out
 *   eat   – happy squint, tongue out, hearts
 */
import type { Reaction } from './logic';

export type Mood = 'idle' | 'sniff' | Reaction;

const FUR = '#c9772f';
const FUR_DARK = '#9c5520';
const WHITE = '#f8f1e6';
const NOSE = '#6b3a32';

/** Little curls of sherpa fleece. */
function Fleece({ id }: { id: string }) {
  return (
    <pattern id={id} width="34" height="30" patternUnits="userSpaceOnUse">
      <rect width="34" height="30" fill="#efe5d3" />
      <circle cx="8" cy="8" r="7" fill="#f7f0e3" stroke="#d8cab2" stroke-width="1.6" />
      <circle cx="25" cy="10" r="6.5" fill="#f5ecdd" stroke="#d6c7ad" stroke-width="1.6" />
      <circle cx="16" cy="22" r="7.5" fill="#f8f2e6" stroke="#d9ccb5" stroke-width="1.6" />
      <circle cx="31" cy="25" r="5.5" fill="#f3eadb" stroke="#d4c4a9" stroke-width="1.5" />
      <circle cx="2" cy="25" r="5" fill="#f4ebdc" stroke="#d4c4a9" stroke-width="1.5" />
      <path d="M5 8 q3 -3 6 0 M22 10 q3 -3 6 0 M13 22 q3 -3 6 0" stroke="#ddd0ba" stroke-width="1.2" fill="none" />
    </pattern>
  );
}

/** A fluffy edge: a wobbly outline made of many little bumps (for fur and fleece). */
function bumpy(cx: number, cy: number, rx: number, ry: number, bumps: number, depth: number, from = 0, to = Math.PI * 2): string {
  const pt = (a: number, k: number) => `${(cx + Math.cos(a) * rx * k).toFixed(1)} ${(cy + Math.sin(a) * ry * k).toFixed(1)}`;
  const step = (to - from) / bumps;
  let d = `M${pt(from, 1)}`;
  for (let i = 0; i < bumps; i++) {
    const a = from + step * i;
    // Every bump bulges out a little; vary it so the fluff looks natural.
    const k = 1 + depth * (0.7 + 0.6 * Math.abs(Math.sin(i * 2.3)));
    d += ` Q${pt(a + step / 2, k)} ${pt(a + step, 1)}`;
  }
  return d + ' Z';
}

function Eye({ cx, cy, mood }: { cx: number; cy: number; mood: Mood }) {
  if (mood === 'eat') {
    // Happy squint.
    return <path d={`M${cx - 26} ${cy + 6} Q${cx} ${cy - 22} ${cx + 26} ${cy + 6}`} fill="none" stroke="#2a1309" stroke-width="7" stroke-linecap="round" />;
  }
  if (mood === 'snub') {
    // Eyes shut, nose in the air.
    return <path d={`M${cx - 24} ${cy} Q${cx} ${cy + 14} ${cx + 24} ${cy}`} fill="none" stroke="#2a1309" stroke-width="6" stroke-linecap="round" />;
  }
  return (
    <g class="baja-eye">
      {/* The pinkish rim chihuahuas have round big eyes. */}
      <ellipse cx={cx} cy={cy + 1} rx="33" ry="32" fill="#7a3f2c" opacity=".55" />
      <ellipse cx={cx} cy={cy} rx="29" ry="29" fill="url(#baja-iris)" />
      <ellipse cx={cx} cy={cy} rx="17" ry="17" fill="#120604" />
      <ellipse cx={cx - 9} cy={cy - 11} rx="9" ry="7" fill="#fff" opacity=".92" />
      <circle cx={cx + 10} cy={cy + 10} r="3.5" fill="#fff" opacity=".7" />
      <path d={`M${cx - 22} ${cy + 18} Q${cx} ${cy + 30} ${cx + 22} ${cy + 18}`} fill="none" stroke="#fff" stroke-width="2" opacity=".18" />
      {/* Eyelid for blinking. */}
      <ellipse class="baja-lid" cx={cx} cy={cy} rx="34" ry="33" fill={FUR} />
    </g>
  );
}

/** The front fold of the blanket, and its fluffy top edge. */
const FOLD_EDGE = 'M-10 420 Q50 330 118 334 Q150 340 160 420 Q186 486 300 494 Q414 486 440 410 Q452 312 500 300 Q566 296 612 360';
const FOLD = `${FOLD_EDGE} L620 620 L-20 620 Z`;

export function Baja({ mood, size = 640 }: { mood: Mood; size?: number }) {
  const happy = mood === 'eat';
  return (
    <svg class={`baja baja-${mood}`} width={size} height={size} viewBox="0 0 600 600" aria-label="Baja">
      <defs>
        <Fleece id="baja-fleece" />
        <radialGradient id="baja-fur" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stop-color="#e09650" />
          <stop offset="55%" stop-color={FUR} />
          <stop offset="100%" stop-color={FUR_DARK} />
        </radialGradient>
        <radialGradient id="baja-iris" cx="45%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#6b3a1c" />
          <stop offset="70%" stop-color="#3a1a0b" />
          <stop offset="100%" stop-color="#1c0b05" />
        </radialGradient>
        <radialGradient id="baja-nose" cx="40%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#9a6058" />
          <stop offset="60%" stop-color={NOSE} />
          <stop offset="100%" stop-color="#3f1f1a" />
        </radialGradient>
        <linearGradient id="baja-white" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fffaf2" />
          <stop offset="100%" stop-color="#e9dfcf" />
        </linearGradient>
        <radialGradient id="baja-shade" cx="50%" cy="20%" r="80%">
          <stop offset="60%" stop-color="#000" stop-opacity="0" />
          <stop offset="100%" stop-color="#000" stop-opacity=".22" />
        </radialGradient>
      </defs>

      {/* The blanket behind her head. */}
      <path d="M40 620 L40 380 Q60 250 170 230 Q300 200 430 230 Q545 250 565 380 L565 620 Z" fill="url(#baja-fleece)" />
      <path d="M40 620 L40 380 Q60 250 170 230 Q300 200 430 230 Q545 250 565 380 L565 620 Z" fill="url(#baja-shade)" />

      <g class="baja-head">
        {/* Ears: upright pomchi ears, broad at the base, fringed with fluff. */}
        <g class="baja-ear-l">
          <path d="M164 266 Q146 186 178 122 Q196 112 208 128 Q246 168 272 206 Z" fill={FUR} stroke={FUR_DARK} stroke-width="3" stroke-linejoin="round" />
          <path d="M184 240 Q174 186 190 146 Q224 180 250 208 Z" fill="#e7a07e" />
          <path d="M196 214 q4 -26 14 -46 M206 220 q8 -22 20 -34 M190 226 q-2 -22 4 -40" stroke="#fbeee0" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9" />
          <path d="M180 124 q-8 -10 -4 -20 M172 142 q-14 -4 -16 -14 M164 170 q-14 0 -18 -10 M160 200 q-14 4 -18 -4 M160 230 q-12 4 -16 -2" stroke={FUR} stroke-width="9" fill="none" stroke-linecap="round" />
        </g>
        <g class="baja-ear-r">
          <path d="M436 266 Q454 186 422 122 Q404 112 392 128 Q354 168 328 206 Z" fill={FUR} stroke={FUR_DARK} stroke-width="3" stroke-linejoin="round" />
          <path d="M416 240 Q426 186 410 146 Q376 180 350 208 Z" fill="#e7a07e" />
          <path d="M404 214 q-4 -26 -14 -46 M394 220 q-8 -22 -20 -34 M410 226 q2 -22 -4 -40" stroke="#fbeee0" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9" />
          <path d="M420 124 q8 -10 4 -20 M428 142 q14 -4 16 -14 M436 170 q14 0 18 -10 M440 200 q14 4 18 -4" stroke={FUR} stroke-width="9" fill="none" stroke-linecap="round" />
        </g>

        {/* Fluffy ruff and cheeks: a pomchi is mostly fluff. */}
        <path d={bumpy(300, 330, 178, 150, 52, 0.09)} fill={FUR_DARK} />
        <path d={bumpy(300, 326, 168, 142, 56, 0.07)} fill={FUR} />
        {/* Face. */}
        <path d={bumpy(300, 318, 150, 136, 48, 0.03)} fill="url(#baja-fur)" />

        {/* White blaze: a thin stripe up the forehead, widening between the eyes into the white muzzle. */}
        <path
          d="M292 184 Q300 178 310 184 Q318 236 330 290 Q350 326 382 360 Q390 420 300 448 Q210 420 218 360 Q250 326 270 290 Q282 236 292 184 Z"
          fill="url(#baja-white)"
        />

        {/* Brow tufts: she always looks a little worried. */}
        <path d="M204 262 q28 -20 58 -6" stroke="#e7ab70" stroke-width="8" fill="none" stroke-linecap="round" opacity=".85" />
        <path d="M338 258 q30 -16 58 6" stroke="#e7ab70" stroke-width="8" fill="none" stroke-linecap="round" opacity=".85" />

        <Eye cx={236} cy={304} mood={mood} />
        <Eye cx={364} cy={308} mood={mood} />

        {/* Nose. */}
        <g class="baja-nose">
          <path d="M272 362 Q300 348 328 362 Q332 382 300 394 Q268 382 272 362 Z" fill="url(#baja-nose)" />
          <ellipse cx="289" cy="375" rx="5.5" ry="4" fill="#2b1210" />
          <ellipse cx="311" cy="375" rx="5.5" ry="4" fill="#2b1210" />
          <ellipse cx="292" cy="360" rx="10" ry="4" fill="#fff" opacity=".35" />
          <path d="M300 392 v14" stroke="#8a6a5e" stroke-width="2.5" />
        </g>

        {/* Mouth, tongue, chewing jaw. */}
        <g class="baja-mouth">
          <path d="M278 410 Q290 420 300 408 Q310 420 322 410" fill="none" stroke="#8a6a5e" stroke-width="3" stroke-linecap="round" />
          <g class="baja-tongue">
            <path d="M287 410 Q300 403 313 410 Q317 442 300 448 Q283 442 287 410 Z" fill="#ef8a9a" stroke="#c8606f" stroke-width="2" />
            <path d="M300 414 v22" stroke="#c8606f" stroke-width="2" />
          </g>
        </g>

        {/* Whiskers. */}
        <g stroke="#f4e9da" stroke-width="1.6" opacity=".7" fill="none">
          <path d="M262 390 q-50 -6 -96 8 M262 398 q-46 6 -90 26 M264 384 q-44 -18 -84 -14" />
          <path d="M338 390 q50 -6 96 8 M338 398 q46 6 90 26 M336 384 q44 -18 84 -14" />
        </g>
        {happy && (
          <g class="baja-blush" opacity=".45">
            <ellipse cx="206" cy="352" rx="22" ry="12" fill="#ff8f8f" />
            <ellipse cx="394" cy="356" rx="22" ry="12" fill="#ff8f8f" />
          </g>
        )}
      </g>

      {/* The blanket wrapped round her: up both sides of her face (higher on the right, like in her photo) and under her chin. */}
      <path d={FOLD} fill="url(#baja-fleece)" />
      <path d={FOLD_EDGE} fill="none" stroke="#cdbd9f" stroke-width="26" stroke-linecap="round" stroke-dasharray="0 19" />
      <path d={FOLD_EDGE} fill="none" stroke="#f6efe2" stroke-width="22" stroke-linecap="round" stroke-dasharray="0 19" />
      <path d="M70 520 Q170 470 250 560 M540 500 Q440 470 360 560" fill="none" stroke="#d3c4a8" stroke-width="7" opacity=".55" />
    </svg>
  );
}

/** Baja doing zoomies across the floor: a ginger fluff-ball with a plume of a tail. */
export function BajaRun({ size = 260 }: { size?: number }) {
  return (
    <svg class="baja-run" width={size} height={size * 0.7} viewBox="0 0 260 182" aria-hidden="true">
      <g class="baja-run-body">
        <path d={bumpy(118, 104, 78, 46, 26, 0.08)} fill={FUR} />
        <path d="M80 110 Q118 150 160 112 Q150 140 118 142 Q86 140 80 110 Z" fill={WHITE} />
        {/* Tail plume. */}
        <path d="M44 90 Q6 60 20 26 Q40 50 60 70 Z" fill={FUR} />
        <path d="M24 30 q-8 -6 -4 -16 M18 46 q-12 -2 -14 -12" stroke={FUR} stroke-width="5" fill="none" stroke-linecap="round" />
        {/* Head. */}
        <path d={bumpy(196, 74, 46, 42, 22, 0.06)} fill={FUR} />
        <path d="M188 40 Q196 70 214 104 Q240 100 238 80 Q226 70 206 40 Z" fill={WHITE} />
        <path d="M172 48 Q160 10 176 0 Q190 24 196 40 Z" fill={FUR} stroke={FUR_DARK} stroke-width="2" />
        <path d="M206 42 Q214 6 232 2 Q232 30 220 50 Z" fill={FUR} stroke={FUR_DARK} stroke-width="2" />
        <circle cx="212" cy="70" r="9" fill="#1a0905" />
        <circle cx="209" cy="66" r="3" fill="#fff" />
        <ellipse cx="240" cy="86" rx="8" ry="6" fill={NOSE} />
        <path d="M222 100 q8 18 2 26 q-10 -4 -8 -22" fill="#ef8a9a" />
        {/* Legs, blurred with speed. */}
        <g class="baja-run-legs" stroke={FUR} stroke-width="12" stroke-linecap="round">
          <path d="M90 138 l-20 26 M110 142 l12 28 M150 138 l-16 28 M166 132 l22 24" />
        </g>
      </g>
      <g stroke="#fbf0d9" stroke-width="4" stroke-linecap="round" opacity=".5">
        <path d="M2 100 h30 M8 120 h26 M14 140 h22" />
      </g>
    </svg>
  );
}

/** The plate being offered: the food, how it's served, and how it's given. */
export function Offering({ plate, size = 1 }: { plate: number[]; size?: number }) {
  const [food, serve, how, trick] = plate;
  const FOODS = ['🍗', '🧀', '🌭', '🥕', '🍎', '🥓'];
  const f = FOODS[food] ?? '🍗';
  const tiny = serve === 2;
  const foodEl = tiny ? (
    <span class="off-food tiny">
      <span>{f}</span>
      <span>{f}</span>
      <span>{f}</span>
    </span>
  ) : (
    <span class="off-food">{f}</span>
  );
  return (
    <div class={`offering how-${how}`} style={{ '--s': size }}>
      {trick !== undefined && <span class="off-trick">{['💃', '🐾', '🌀'][trick]}</span>}
      {serve === 0 && <span class="off-steam">♨️</span>}
      {serve === 1 && <span class="off-frost">❄️</span>}
      {how === 0 && (
        <span class="off-hand">
          {foodEl}
          <span class="off-palm">🫴</span>
        </span>
      )}
      {how === 1 && (
        <span class="off-bowl">
          {foodEl}
          <svg viewBox="0 0 200 80" class="off-bowl-svg" aria-hidden="true">
            <ellipse cx="100" cy="20" rx="92" ry="16" fill="#3b2a6b" />
            <path d="M8 20 Q14 76 100 76 Q186 76 192 20 Z" fill="#7a5cf0" stroke="#2a120a" stroke-width="4" />
            <ellipse cx="100" cy="20" rx="92" ry="16" fill="none" stroke="#2a120a" stroke-width="4" />
            <path d="M40 50 h120" stroke="#fbf0d9" stroke-width="5" stroke-dasharray="2 14" stroke-linecap="round" opacity=".7" />
          </svg>
        </span>
      )}
      {how === 2 && (
        <span class="off-floor">
          {foodEl}
          <span class="off-boards" />
        </span>
      )}
    </div>
  );
}

/** The neighbour's cat: a smug grey tabby with a sly grin and a crooked tail. */
export function Cat({ size = 260 }: { size?: number }) {
  return (
    <svg class="bt-cat" width={size} height={size} viewBox="0 0 200 200" aria-label="The neighbour's cat">
      {/* Tail, flicking. */}
      <path class="bt-cat-tail" d="M150 160 Q196 150 186 100 Q180 76 192 60" fill="none" stroke="#2a120a" stroke-width="20" stroke-linecap="round" />
      <path class="bt-cat-tail" d="M150 160 Q196 150 186 100 Q180 76 192 60" fill="none" stroke="#8a8f99" stroke-width="13" stroke-linecap="round" />
      {/* Body. */}
      <ellipse cx="100" cy="150" rx="58" ry="42" fill="#8a8f99" stroke="#2a120a" stroke-width="5" />
      <ellipse cx="100" cy="160" rx="30" ry="24" fill="#d9dce2" />
      <path d="M62 132 q10 6 6 18 M138 132 q-10 6 -6 18" stroke="#5f646d" stroke-width="5" fill="none" stroke-linecap="round" />
      {/* Ears. */}
      <path d="M52 62 L58 14 L92 44 Z" fill="#8a8f99" stroke="#2a120a" stroke-width="5" stroke-linejoin="round" />
      <path d="M148 62 L142 14 L108 44 Z" fill="#8a8f99" stroke="#2a120a" stroke-width="5" stroke-linejoin="round" />
      <path d="M60 52 L63 28 L80 44 Z M140 52 L137 28 L120 44 Z" fill="#f0a4b4" />
      {/* Head. */}
      <ellipse cx="100" cy="80" rx="56" ry="48" fill="#8a8f99" stroke="#2a120a" stroke-width="5" />
      <path d="M86 38 l4 16 M100 34 v18 M114 38 l-4 16" stroke="#5f646d" stroke-width="5" stroke-linecap="round" />
      {/* Half-closed, scheming eyes. */}
      <ellipse cx="78" cy="78" rx="13" ry="10" fill="#c8e34a" stroke="#2a120a" stroke-width="3" />
      <ellipse cx="122" cy="78" rx="13" ry="10" fill="#c8e34a" stroke="#2a120a" stroke-width="3" />
      <ellipse cx="80" cy="79" rx="3" ry="8" fill="#2a120a" />
      <ellipse cx="124" cy="79" rx="3" ry="8" fill="#2a120a" />
      <path d="M64 72 Q78 64 92 72 L92 70 Q78 60 64 70 Z M108 72 Q122 64 136 72 L136 70 Q122 60 108 70 Z" fill="#5f646d" stroke="#2a120a" stroke-width="3" />
      {/* Nose and the smug grin. */}
      <path d="M94 94 h12 l-6 7 Z" fill="#f08aa0" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M78 104 Q90 116 100 104 Q110 116 124 102" fill="none" stroke="#2a120a" stroke-width="4" stroke-linecap="round" />
      <path d="M58 96 h-30 M60 104 l-28 6 M142 96 h30 M140 104 l28 6" stroke="#2a120a" stroke-width="2.5" stroke-linecap="round" />
      {/* Paws. */}
      <ellipse cx="80" cy="190" rx="16" ry="9" fill="#d9dce2" stroke="#2a120a" stroke-width="4" />
      <ellipse cx="120" cy="190" rx="16" ry="9" fill="#d9dce2" stroke="#2a120a" stroke-width="4" />
    </svg>
  );
}
