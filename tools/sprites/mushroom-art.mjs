// SVG art for the new mushroom sprites (192 × 192), in the painted sprites' cartoon style.
const INK = '#2b1a10';

/** A whole boletus (prawdziwek): bulbous stem, glossy brown cap. */
export function boletus(x, y, s, flip = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s * flip} ${s})">
    <path d="M-20 0 C-26 -26 -16 -44 -12 -52 L12 -52 C18 -40 30 -22 22 0 C14 8 -12 8 -20 0 Z" fill="#f2e3c4" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M8 -50 C14 -36 22 -20 16 -2 C12 2 8 3 4 4 C12 -14 10 -34 2 -50 Z" fill="#d8c096"/>
    <path d="M-14 -40 q4 10 0 22" stroke="#fff8e6" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M-46 -50 C-46 -84 -20 -98 0 -98 C22 -98 48 -84 48 -52 C48 -44 40 -42 30 -44 C12 -48 -12 -48 -30 -44 C-40 -42 -46 -44 -46 -50 Z" fill="#8a4a22" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M-40 -52 C-38 -70 -26 -84 -4 -88 C-24 -78 -30 -64 -30 -52 Z" fill="#b5703b"/>
    <ellipse cx="-14" cy="-80" rx="11" ry="6" fill="#e9b07a" opacity=".9" transform="rotate(-20 -14 -80)"/>
    <path d="M-30 -45 C-12 -49 12 -49 30 -45" stroke="#5a2e14" stroke-width="3" fill="none"/>
  </g>`;
}

/** A slice of boletus: the cut face, cream with a brown rim on the cap. */
export function slice(x, y, s, rot = 0) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <path d="M-30 -6 C-30 -26 -14 -34 0 -34 C14 -34 30 -26 30 -6 C30 0 22 0 16 0 C12 0 10 4 11 12 C12 22 8 28 0 28 C-8 28 -12 22 -11 12 C-10 4 -12 0 -16 0 C-22 0 -30 0 -30 -6 Z" fill="#f4e6c6" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M-25 -10 C-24 -24 -12 -30 0 -30 C12 -30 24 -24 25 -10" fill="none" stroke="#8a4a22" stroke-width="7" stroke-linecap="round"/>
    <path d="M-4 4 q-3 10 0 18" stroke="#d8c096" stroke-width="4" fill="none" stroke-linecap="round"/>
  </g>`;
}

/** Just a cap, seen from above at a slant (for a crate full of mushrooms). */
export function cap(x, y, s, tone = 0) {
  const fill = ['#8a4a22', '#9b5a2c', '#7a3f1c'][tone % 3];
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="4" rx="25" ry="17" fill="#f2e3c4" stroke="${INK}" stroke-width="5"/>
    <path d="M-26 2 C-26 -18 -12 -26 0 -26 C14 -26 26 -18 26 2 C18 8 -18 8 -26 2 Z" fill="${fill}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <ellipse cx="-8" cy="-14" rx="8" ry="4" fill="#e9b07a" opacity=".85" transform="rotate(-18 -8 -14)"/>
  </g>`;
}

export function svg(body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><defs>${defs}</defs>${body}</svg>`;
}
