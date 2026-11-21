/**
 * Converting between SVG and the doodle strokes the drawing games use ([colour, width, x0, y0, …]
 * in 0..DOODLE_SPACE). The AI bot draws in SVG, and "looks at" a player's drawing as SVG, because
 * the language model only reads text. No DOM: this runs in the worker as well as in tests.
 */
import { DOODLE_COLORS, DOODLE_SPACE, DOODLE_WIDTHS, MAX_DOODLE_POINTS, type Stroke } from './protocol';

// ---- strokes → SVG ------------------------------------------------------------------------

/** The drawing as a small SVG (each stroke a polyline, thinned so the text stays short). */
export function strokesToSvg(strokes: readonly Stroke[], maxPoints = 900): string {
  const total = strokes.reduce((n, s) => n + Math.max(0, (s.length - 2) / 2), 0);
  const step = Math.max(1, Math.ceil(total / maxPoints));
  const lines: string[] = [];
  for (const s of strokes) {
    const n = (s.length - 2) / 2;
    if (n < 1) continue;
    const pts: string[] = [];
    for (let i = 0; i < n; i += step) pts.push(`${Math.round(s[2 + i * 2])},${Math.round(s[3 + i * 2])}`);
    const last = `${Math.round(s[s.length - 2])},${Math.round(s[s.length - 1])}`;
    if (pts[pts.length - 1] !== last) pts.push(last);
    if (pts.length === 1) pts.push(pts[0]);
    const color = DOODLE_COLORS[s[0]] ?? DOODLE_COLORS[0];
    const width = DOODLE_WIDTHS[s[1]] ?? DOODLE_WIDTHS[1];
    lines.push(`<polyline stroke="${color}" stroke-width="${width}" points="${pts.join(' ')}"/>`);
  }
  return `<svg viewBox="0 0 ${DOODLE_SPACE} ${DOODLE_SPACE}" fill="none" stroke-linecap="round">\n${lines.join('\n')}\n</svg>`;
}

// ---- SVG → strokes ------------------------------------------------------------------------

type Pt = [number, number];

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', violet: '#ee82ee', pink: '#ffc0cb', brown: '#8b4513',
  gray: '#808080', grey: '#808080', cyan: '#00ffff', magenta: '#ff00ff', gold: '#ffd700', navy: '#000080',
  teal: '#008080', skyblue: '#87ceeb', darkgreen: '#006400', tan: '#d2b48c', beige: '#f5f5dc', silver: '#c0c0c0',
};

function rgbOf(raw: string | undefined): [number, number, number] | null {
  if (!raw) return null;
  const c = raw.trim().toLowerCase();
  if (!c || c === 'none' || c === 'transparent') return null;
  const hex = NAMED[c] ?? c;
  let m = hex.match(/^#([0-9a-f]{3})$/);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = hex.match(/^#([0-9a-f]{6})/);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = hex.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

/** The nearest doodle colour to an SVG colour (black if it can't be read). */
export function nearestColor(raw: string | undefined): number {
  const rgb = rgbOf(raw);
  if (!rgb) return 0;
  let best = 0;
  let bestD = Infinity;
  DOODLE_COLORS.forEach((hex, i) => {
    const d = rgbOf(hex)!;
    const dist = (d[0] - rgb[0]) ** 2 + (d[1] - rgb[1]) ** 2 + (d[2] - rgb[2]) ** 2;
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  });
  return best;
}

function nearestWidth(w: number): number {
  if (!Number.isFinite(w) || w <= 0) return 1;
  let best = 0;
  DOODLE_WIDTHS.forEach((d, i) => {
    if (Math.abs(d - w) < Math.abs(DOODLE_WIDTHS[best] - w)) best = i;
  });
  return best;
}

function attrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  // Inline styles win over attributes, as in a browser.
  for (const decl of (out.style ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

const num = (s: string | undefined, d = 0) => {
  const v = parseFloat(s ?? '');
  return Number.isFinite(v) ? v : d;
};

function numbers(s: string): number[] {
  return (s.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Pt[] {
  const n = Math.max(12, Math.min(40, Math.round((rx + ry) / 6)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry] as Pt;
  });
}

const CURVE_STEPS = 10;

/** A path's subpaths as point lists (curves sampled, arcs drawn as straight lines). */
function pathPoints(d: string): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: Pt | null = null;
  let lastCmd = '';
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  const to = (nx: number, ny: number) => {
    if (!cur.length) cur.push([x, y]);
    x = nx;
    y = ny;
    cur.push([x, y]);
  };
  for (const m of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const cmd = m[1];
    const a = numbers(m[2]);
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = () => (rel ? x : 0);
    const oy = () => (rel ? y : 0);
    if (C === 'Z') {
      if (cur.length) to(sx, sy);
      flush();
      x = sx;
      y = sy;
      lastCtrl = null;
      lastCmd = C;
      continue;
    }
    const size = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[C] ?? 2;
    for (let i = 0; i + size <= a.length; i += size) {
      const p = a.slice(i, i + size);
      if (C === 'M' && i === 0) {
        flush();
        x = p[0] + ox();
        y = p[1] + oy();
        sx = x;
        sy = y;
        cur.push([x, y]);
        lastCtrl = null;
      } else if (C === 'M' || C === 'L' || C === 'T' || C === 'A') {
        const nx = (C === 'A' ? p[5] : p[0]) + ox();
        const ny = (C === 'A' ? p[6] : p[1]) + oy();
        if (C === 'T') {
          const c: Pt = lastCtrl && (lastCmd === 'Q' || lastCmd === 'T') ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
          quad(c, [nx, ny]);
          lastCtrl = c;
        } else {
          to(nx, ny);
          lastCtrl = null;
        }
      } else if (C === 'H') {
        to(p[0] + ox(), y);
        lastCtrl = null;
      } else if (C === 'V') {
        to(x, p[0] + oy());
        lastCtrl = null;
      } else if (C === 'C' || C === 'S') {
        const c1: Pt =
          C === 'C' ? [p[0] + ox(), p[1] + oy()] : lastCtrl && (lastCmd === 'C' || lastCmd === 'S') ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const q = C === 'C' ? p.slice(2) : p;
        const c2: Pt = [q[0] + ox(), q[1] + oy()];
        const end: Pt = [q[2] + ox(), q[3] + oy()];
        const [x0, y0] = [x, y];
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS;
          const u = 1 - t;
          to(
            u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
            u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
          );
        }
        lastCtrl = c2;
      } else if (C === 'Q') {
        const c: Pt = [p[0] + ox(), p[1] + oy()];
        quad(c, [p[2] + ox(), p[3] + oy()]);
        lastCtrl = c;
      }
      lastCmd = C;
    }
    lastCmd = C;
  }
  flush();
  return out;

  function quad(c: Pt, end: Pt) {
    const [x0, y0] = [x, y];
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS;
      const u = 1 - t;
      to(u * u * x0 + 2 * u * t * c[0] + t * t * end[0], u * u * y0 + 2 * u * t * c[1] + t * t * end[1]);
    }
  }
}

/**
 * Turn an SVG (as an AI writes it) into doodle strokes. Understands path, polyline, polygon, line,
 * circle, ellipse and rect; fills are drawn as outlines, transforms are ignored. The picture is
 * scaled from its viewBox into the doodle canvas. Returns [] if nothing drawable is found.
 */
export function svgToStrokes(svg: string): Stroke[] {
  const root = svg.match(/<svg\b([^>]*)>/i);
  const ra = attrs(root?.[1] ?? '');
  const vb = numbers(ra.viewbox ?? '');
  const [vx, vy, vw, vh] = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb : [0, 0, num(ra.width, DOODLE_SPACE) || DOODLE_SPACE, num(ra.height, DOODLE_SPACE) || DOODLE_SPACE];
  const scale = DOODLE_SPACE / Math.max(vw, vh);
  const offX = (DOODLE_SPACE - vw * scale) / 2;
  const offY = (DOODLE_SPACE - vh * scale) / 2;
  const rootStroke = ra.stroke;
  const rootWidth = ra['stroke-width'];

  const out: Stroke[] = [];
  let points = 0;
  for (const m of svg.matchAll(/<(path|polyline|polygon|line|circle|ellipse|rect)\b([^>]*?)\/?>/gi)) {
    const tag = m[1].toLowerCase();
    const a = attrs(m[2]);
    let shapes: Pt[][] = [];
    if (tag === 'path') shapes = pathPoints(a.d ?? '');
    else if (tag === 'polyline' || tag === 'polygon') {
      const n = numbers(a.points ?? '');
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      if (tag === 'polygon' && pts.length > 2) pts.push(pts[0]);
      shapes = [pts];
    } else if (tag === 'line') shapes = [[[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]]];
    else if (tag === 'circle') {
      const r = num(a.r);
      if (r > 0) shapes = [ellipse(num(a.cx), num(a.cy), r, r)];
    } else if (tag === 'ellipse') {
      const rx = num(a.rx);
      const ry = num(a.ry, rx);
      if (rx > 0 && ry > 0) shapes = [ellipse(num(a.cx), num(a.cy), rx, ry)];
    } else if (tag === 'rect') {
      const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)];
      if (w > 0 && h > 0) shapes = [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
    }
    const paint = a.stroke && a.stroke !== 'none' ? a.stroke : a.fill && a.fill !== 'none' ? a.fill : rootStroke;
    const color = nearestColor(paint);
    const width = nearestWidth(num(a['stroke-width'] ?? rootWidth, DOODLE_WIDTHS[1] / scale) * scale);
    for (const pts of shapes) {
      if (!pts.length || points >= MAX_DOODLE_POINTS) continue;
      const stroke: Stroke = [color, width];
      for (const [x, y] of pts.slice(0, MAX_DOODLE_POINTS - points)) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        stroke.push(
          Math.max(0, Math.min(DOODLE_SPACE, Math.round((x - vx) * scale + offX))),
          Math.max(0, Math.min(DOODLE_SPACE, Math.round((y - vy) * scale + offY))),
        );
      }
      if (stroke.length < 4) continue;
      points += (stroke.length - 2) / 2;
      out.push(stroke);
    }
  }
  return out;
}
