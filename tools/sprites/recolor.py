"""Recolour the cream pierogi body of the chef sprites into each player colour, keeping the shading."""
import colorsys, sys
import numpy as np
from PIL import Image
COLORS = {'beetroot': '#ff3d6e', 'cherry': '#ff594f', 'paprika': '#ff8a2a', 'caramel': '#e2a568',
          'yolk': '#ffd23f', 'pickle': '#a3e048', 'chive': '#3bd16f', 'dill': '#2fd6a8',
          'mint': '#38e8f5', 'blueberry': '#4f9dff', 'cornflower': '#7c8cff', 'plum': '#b27bff',
          'raspberry': '#ff7ad1', 'peach': '#ffb088'}

def rgb_to_hls(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1); mn = a.min(-1); l = (mx + mn) / 2; d = mx - mn
    s = np.where(d == 0, 0, d / np.where(l > 0.5, 2 - mx - mn, mx + mn + 1e-9))
    h = np.zeros_like(l)
    m = d > 0
    rc = np.where(m, (mx - r) / (d + 1e-9), 0); gc = np.where(m, (mx - g) / (d + 1e-9), 0); bc = np.where(m, (mx - b) / (d + 1e-9), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2 + rc - bc, 4 + gc - rc))
    h = (h / 6) % 1
    return h, l, s

def hls_to_rgb(h, l, s):
    def f(n):
        k = (n + h * 12) % 12
        a = s * np.minimum(l, 1 - l)
        return l - a * np.maximum(-1, np.minimum(np.minimum(k - 3, 9 - k), 1))
    return np.stack([f(0), f(8), f(4)], -1)

def recolor(src, hexcol, out):
    raw = Image.open(src)
    has_alpha = 'A' in raw.getbands()
    im = raw.convert('RGBA')
    rgba = np.asarray(im).astype(np.float64) / 255
    a = rgba[..., :3]
    alpha = rgba[..., 3]
    h, l, s = rgb_to_hls(a)
    # The dough: yellowish, not too dark, not white.
    body = (h > 0.06) & (h < 0.17) & (s > 0.25) & (l > 0.45) & (l < 0.93)
    if has_alpha:
        body = body & (alpha > 0.05)
    tr, tg, tb = (int(hexcol[i:i + 2], 16) / 255 for i in (1, 3, 5))
    th, tl, ts = colorsys.rgb_to_hls(tr, tg, tb)
    ml = np.median(l[body])
    nl = np.clip(tl + (l - ml) * 1.1, 0.05, 0.97)
    rgb = hls_to_rgb(np.full_like(h, th), nl, np.full_like(s, min(1, ts)))
    a2 = np.where(body[..., None], rgb, a)
    out_arr = (np.dstack([a2, alpha]) * 255).round().astype(np.uint8) if has_alpha else (a2 * 255).round().astype(np.uint8)
    out_im = Image.fromarray(out_arr, 'RGBA' if has_alpha else 'RGB')
    if out.lower().endswith('.webp'):
        out_im.save(out, 'WEBP', quality=90, method=6)
    else:
        out_im.save(out)
    return int(body.sum())

if __name__ == '__main__':
    for pose in ('front', 'back', 'side'):
        for name, hexcol in COLORS.items():
            recolor(f'chef/sourcream-{pose}.png', hexcol, f'chef/{name}-{pose}.png')
    print('ok')
