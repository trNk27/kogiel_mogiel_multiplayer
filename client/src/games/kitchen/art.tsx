/**
 * Pierogi Panic art. Every item is a small SVG string so the same drawing can be used as an <img>
 * on the phones and the TV tickets, and drawn onto the TV canvas.
 * Plates and bowls are Bolesławiec style: white with cobalt-blue dots.
 */
import { fillingInfo, type Filling, type KitchenItem } from '../../../../shared/protocol';

const COBALT = '#2f5fae';

function svg(body: string, vb = '0 0 100 100') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="${vb}">${body}</svg>`;
}

function dots(cx: number, cy: number, rx: number, ry: number, n: number, r: number, color = COBALT) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out += `<circle cx="${(cx + rx * Math.cos(a)).toFixed(1)}" cy="${(cy + ry * Math.sin(a)).toFixed(1)}" r="${r}" fill="${color}"/>`;
  }
  return out;
}

/** A small crimped half-moon, centred on (x, y). */
function crescent(x: number, y: number, w: number, fill: string, stroke: string, rot = 0) {
  const h = w * 0.55;
  const n = 7;
  let d = `M ${-w / 2} 0`;
  for (let k = 0; k < n; k++) {
    const a0 = Math.PI - (k * Math.PI) / n;
    const a1 = Math.PI - ((k + 1) * Math.PI) / n;
    const am = (a0 + a1) / 2;
    const p = (a: number, r: number) => `${((w / 2) * r * Math.cos(a)).toFixed(1)} ${(-h * r * Math.sin(a)).toFixed(1)}`;
    d += ` Q ${p(am, 1.18)} ${p(a1, 1)}`;
  }
  d += ` Q 0 ${(h * 0.32).toFixed(1)} ${-w / 2} 0 Z`;
  return `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round"/><path d="M ${-w * 0.36} ${(-h * 0.05).toFixed(1)} A ${w * 0.36} ${h * 0.75} 0 0 1 ${w * 0.36} ${(-h * 0.05).toFixed(1)}" fill="none" stroke="${stroke}" stroke-opacity=".45" stroke-width="1.6" stroke-dasharray="1.5 4" stroke-linecap="round"/></g>`;
}

function badge(f: Filling, x = 80, y = 22, r = 13) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#2a120a" stroke-width="2.5"/><g transform="translate(${x - r * 0.82} ${y - r * 0.82}) scale(${(r * 1.64) / 100})">${fillingBody(f)}</g>`;
}

/** The raw ingredient for each filling (used on crates, tickets and badges). */
function fillingBody(f: Filling): string {
  switch (f) {
    case 'potato':
      return [
        `<ellipse cx="40" cy="58" rx="28" ry="22" fill="#d8a45a" stroke="#8f5f27" stroke-width="4"/>`,
        `<circle cx="32" cy="52" r="2.6" fill="#8f5f27"/><circle cx="48" cy="64" r="2.6" fill="#8f5f27"/>`,
        `<path d="M54 30 L92 46 L88 74 L50 62 Z" fill="#ffd84a" stroke="#b88a00" stroke-width="4" stroke-linejoin="round"/>`,
        `<circle cx="70" cy="52" r="4.5" fill="#e8b800"/><circle cx="80" cy="64" r="3.2" fill="#e8b800"/>`,
      ].join('');
    case 'cabbage':
      return [
        `<circle cx="50" cy="54" r="38" fill="#b9dc6e" stroke="#5f8d22" stroke-width="4"/>`,
        `<path d="M50 18 Q34 50 50 92 M50 18 Q66 50 50 92 M16 46 Q50 40 84 46 M20 70 Q50 60 80 70" fill="none" stroke="#6f9f2b" stroke-width="3.5" stroke-linecap="round"/>`,
        `<path d="M24 30 Q50 6 76 30" fill="none" stroke="#e6f5b8" stroke-width="5" stroke-linecap="round" opacity=".7"/>`,
      ].join('');
    case 'meat':
      return [
        `<path d="M18 52 Q14 24 46 20 Q86 16 88 46 Q90 80 52 84 Q22 86 18 52 Z" fill="#cf5a43" stroke="#7a2617" stroke-width="4"/>`,
        `<path d="M30 46 Q44 36 58 46 T 80 44 M32 64 Q48 56 66 66" fill="none" stroke="#ffd9cf" stroke-width="4" stroke-linecap="round"/>`,
      ].join('');
    case 'berry':
      return [
        `<circle cx="34" cy="62" r="20" fill="#4a3fa3" stroke="#231a5c" stroke-width="4"/>`,
        `<circle cx="66" cy="62" r="20" fill="#5547b8" stroke="#231a5c" stroke-width="4"/>`,
        `<circle cx="50" cy="34" r="20" fill="#5e50c4" stroke="#231a5c" stroke-width="4"/>`,
        `<path d="M44 34 l6 -5 l6 5 M50 29 v8" stroke="#1d1548" stroke-width="3" fill="none" stroke-linecap="round"/>`,
        `<circle cx="27" cy="55" r="4" fill="#fff" opacity=".45"/><circle cx="59" cy="55" r="4" fill="#fff" opacity=".45"/><circle cx="43" cy="27" r="4" fill="#fff" opacity=".45"/>`,
      ].join('');
  }
}

function plateBody(dirty = false) {
  return [
    `<ellipse cx="50" cy="56" rx="45" ry="35" fill="#fdfaf2" stroke="#8ea6cf" stroke-width="3"/>`,
    `<ellipse cx="50" cy="56" rx="31" ry="23" fill="none" stroke="#dfe7f4" stroke-width="2"/>`,
    dots(50, 56, 38, 29, 14, 2.6),
    dirty
      ? `<path d="M30 50 q8 -8 16 0 t 14 4 q6 8 -4 12 t -18 2 q-12 -4 -8 -18 Z" fill="#8a6a3a" opacity=".75"/><circle cx="66" cy="44" r="6" fill="#8a6a3a" opacity=".6"/><circle cx="38" cy="70" r="4" fill="#6f5530" opacity=".6"/><circle cx="62" cy="68" r="3" fill="#6f5530" opacity=".6"/>`
      : '',
  ].join('');
}

const COOKED = { fill: '#f1c46a', stroke: '#b5842c' };
const RAW = { fill: '#f7ead0', stroke: '#c8ad80' };

export function itemSvg(it: KitchenItem): string {
  switch (it.k) {
    case 'flour':
      return svg(
        [
          `<path d="M26 34 Q20 64 20 86 Q50 96 80 86 Q80 64 74 34 Z" fill="#f8f2e4" stroke="#a88f63" stroke-width="3.5" stroke-linejoin="round"/>`,
          `<path d="M28 34 Q34 14 50 20 Q66 14 72 34 Q50 40 28 34 Z" fill="#efe3c6" stroke="#a88f63" stroke-width="3.5" stroke-linejoin="round"/>`,
          `<path d="M30 36 Q50 44 70 36" stroke="#d63a4f" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
          `<path d="M50 84 V54" stroke="#cf9a36" stroke-width="3.5" stroke-linecap="round"/>`,
          ...[0, 1, 2].map((i) => `<ellipse cx="44" cy="${58 + i * 9}" rx="6" ry="3.2" fill="#e2b04b" transform="rotate(-35 44 ${58 + i * 9})"/><ellipse cx="56" cy="${58 + i * 9}" rx="6" ry="3.2" fill="#e2b04b" transform="rotate(35 56 ${58 + i * 9})"/>`),
          `<ellipse cx="50" cy="50" rx="3.4" ry="6" fill="#e2b04b"/>`,
        ].join(''),
      );
    case 'dough':
      return svg(
        [
          `<ellipse cx="50" cy="56" rx="44" ry="33" fill="#f7e2b2" stroke="#cfa964" stroke-width="3.5"/>`,
          `<ellipse cx="40" cy="46" rx="20" ry="9" fill="#fff6dc" opacity=".8"/>`,
          `<circle cx="64" cy="64" r="2" fill="#fff"/><circle cx="30" cy="66" r="1.6" fill="#fff"/><circle cx="72" cy="48" r="1.6" fill="#fff"/>`,
        ].join(''),
      );
    case 'fill': {
      const c = fillingInfo(it.f).hex;
      return svg(
        [
          `<path d="M10 46 Q50 54 90 46 Q88 86 50 90 Q12 86 10 46 Z" fill="#fdfaf2" stroke="${COBALT}" stroke-width="3.5" stroke-linejoin="round"/>`,
          dots(50, 70, 26, 10, 9, 2.6),
          `<ellipse cx="50" cy="46" rx="40" ry="11" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width="2"/>`,
          `<ellipse cx="50" cy="42" rx="26" ry="9" fill="${c}"/>`,
          `<ellipse cx="42" cy="39" rx="10" ry="3.5" fill="#fff" opacity=".35"/>`,
          badge(it.f, 82, 22, 15),
        ].join(''),
      );
    }
    case 'raw':
      return svg(
        [
          crescent(30, 64, 40, RAW.fill, RAW.stroke, -8),
          crescent(68, 66, 40, RAW.fill, RAW.stroke, 10),
          crescent(48, 44, 40, RAW.fill, RAW.stroke, 0),
          `<circle cx="20" cy="40" r="1.6" fill="#fff"/><circle cx="76" cy="44" r="1.6" fill="#fff"/>`,
          badge(it.f, 82, 22, 15),
        ].join(''),
      );
    case 'plate':
      return svg(
        [
          plateBody(),
          it.f
            ? [
                crescent(34, 62, 36, COOKED.fill, COOKED.stroke, -10),
                crescent(66, 62, 36, COOKED.fill, COOKED.stroke, 12),
                crescent(50, 46, 36, COOKED.fill, COOKED.stroke, 0),
                `<circle cx="42" cy="52" r="2.4" fill="#7a4a1f"/><circle cx="58" cy="56" r="2" fill="#7a4a1f"/><circle cx="52" cy="66" r="2.2" fill="#7a4a1f"/>`,
                `<path d="M36 70 l3 -3 M62 44 l3 -2 M70 70 l-2 -3 M30 52 l3 2" stroke="#3f8f3a" stroke-width="2.4" stroke-linecap="round"/>`,
                badge(it.f, 82, 22, 15),
              ].join('')
            : '',
        ].join(''),
      );
    case 'dirty':
      return svg(plateBody(true));
  }
}

export function fillingSvg(f: Filling) {
  return svg(fillingBody(f));
}

export function svgUrl(source: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

export function itemKey(it: KitchenItem) {
  return it.k === 'fill' || it.k === 'raw' ? `${it.k}:${it.f}` : it.k === 'plate' ? `plate:${it.f ?? ''}` : it.k;
}

export function ItemIcon({ item, size = 64, class: cls }: { item: KitchenItem; size?: number; class?: string }) {
  return <img class={cls} src={svgUrl(itemSvg(item))} width={size} height={size} alt="" draggable={false} />;
}

export function FillingIcon({ f, size = 48 }: { f: Filling; size?: number }) {
  return <img src={svgUrl(fillingSvg(f))} width={size} height={size} alt="" draggable={false} />;
}

/** Image cache for drawing the SVGs onto a canvas. */
const images = new Map<string, HTMLImageElement>();

export function imageFor(key: string, source: () => string): HTMLImageElement {
  let img = images.get(key);
  if (!img) {
    img = new Image();
    img.src = svgUrl(source());
    images.set(key, img);
  }
  return img;
}

export function itemImage(it: KitchenItem) {
  return imageFor(itemKey(it), () => itemSvg(it));
}

export function fillingImage(f: Filling) {
  return imageFor(`f:${f}`, () => fillingSvg(f));
}

/** Resolves once the given images have decoded (or failed). */
export function whenLoaded(imgs: HTMLImageElement[]) {
  return Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {}))));
}
