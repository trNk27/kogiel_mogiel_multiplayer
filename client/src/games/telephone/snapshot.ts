/**
 * A drawing as a small picture (a data: URL), so the AI bot can actually look at it. Drawn on the
 * same paper colour the TV uses, so the cream pen still works as an eraser.
 */
import { DOODLE_COLORS, DOODLE_SPACE, DOODLE_WIDTHS, type Stroke } from '../../../../shared/protocol';
import { PAPER } from '../toty/art';

/** Sides of the picture to try, in pixels: plenty for a doodle, and keeps the request small. */
const SIZES = [512, 384];
/** Most characters we send (the worker refuses bigger requests). */
const MAX_CHARS = 80_000;

/** The drawing as a PNG (or, for a busy drawing, a JPEG) data: URL, or null if it won't fit. */
export function snapshot(strokes: readonly Stroke[]): string | null {
  for (const size of SIZES) {
    const url = render(strokes, size);
    if (url) return url;
  }
  return null;
}

function render(strokes: readonly Stroke[], SIZE: number): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const k = SIZE / DOODLE_SPACE;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, SIZE, SIZE);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of strokes) {
      const color = DOODLE_COLORS[s[0]] ?? DOODLE_COLORS[0];
      const width = (DOODLE_WIDTHS[s[1]] ?? DOODLE_WIDTHS[1]) * k;
      if (s.length === 4) {
        g.fillStyle = color;
        g.beginPath();
        g.arc(s[2] * k, s[3] * k, width / 2, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(s[2] * k, s[3] * k);
      for (let i = 4; i + 1 < s.length; i += 2) g.lineTo(s[i] * k, s[i + 1] * k);
      g.stroke();
    }
    const png = canvas.toDataURL('image/png');
    if (png.length <= MAX_CHARS) return png;
    for (const quality of [0.8, 0.6]) {
      const jpg = canvas.toDataURL('image/jpeg', quality);
      if (jpg.length <= MAX_CHARS) return jpg;
    }
    return null;
  } catch {
    return null;
  }
}
