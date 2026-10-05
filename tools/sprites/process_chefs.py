"""Cut the chef sprites out (one shared crop so every pose and colour lines up) and save textures.

Usage: python3 recolor.py && python3 process_chefs.py ../../client/public/sprites/kitchen
"""
import glob, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

def cutout(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    mn = a.min(axis=2); mx = a.max(axis=2)
    # Near-white and pale grey (soft floor shadows) count as background when connected to the border.
    whiteish = (mn > 205) & (mx - mn < 26)
    mask = Image.fromarray(np.where(whiteish, 255, 0).astype(np.uint8)).copy()
    w, h = mask.size
    for x in range(0, w, 8):
        for y in (0, h - 1):
            if mask.getpixel((x, y)) == 255: ImageDraw.floodfill(mask, (x, y), 128)
    for y in range(0, h, 8):
        for x in (0, w - 1):
            if mask.getpixel((x, y)) == 255: ImageDraw.floodfill(mask, (x, y), 128)
    bg = np.asarray(mask) == 128
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    return Image.fromarray(np.dstack([np.asarray(im), np.asarray(alpha)]), 'RGBA')

# One crop box per pose (union over colours is the same geometry), bottom-aligned square.
SIZE = 192
poses = {}
for pose in ('front', 'back', 'side'):
    files = sorted(glob.glob(f'chef/*-{pose}.png'))
    imgs = {os.path.basename(f).split('-')[0]: cutout(f) for f in files}
    boxes = [im.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox() for im in imgs.values()]
    poses[pose] = (imgs, (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)))
# The same scale for every pose, feet on the bottom edge.
side = max(max(b[2] - b[0], b[3] - b[1]) for _, b in poses.values())
for pose, (imgs, (x0, y0, x1, y1)) in poses.items():
    cx = (x0 + x1) // 2
    box = (cx - side // 2, y1 - side, cx - side // 2 + side, y1)
    for name, im in imgs.items():
        c = im.crop(box).convert('RGBa').resize((SIZE, SIZE), Image.LANCZOS).convert('RGBA')
        c.save(f'{OUT}/chef-{name}-{pose}.webp', 'WEBP', quality=86, method=6)
    print(pose, len(imgs), box)

# Textures: square tiles, no cut-out, with a few colour fixes so they read well at 90 px.
for f in sorted(glob.glob('tex/*.png')):
    name = os.path.splitext(os.path.basename(f))[0]
    if name == 'sheet': continue
    if name == 'floor-2b': continue  # replaced by a darker, rotated copy of floor-2a below
    im = Image.open(f).convert('RGB').resize((180, 180), Image.LANCZOS)
    if name == 'floor-1b':  # plain tile looked greyish next to the cream one
        im = ImageEnhance.Color(ImageEnhance.Brightness(im).enhance(1.07)).enhance(1.6)
    if name == 'floor-2a':
        im = ImageEnhance.Brightness(im).enhance(1.12)
    if name == 'wall':  # calm the busy pattern down
        im = ImageEnhance.Contrast(ImageEnhance.Brightness(im.filter(ImageFilter.GaussianBlur(0.9))).enhance(0.8)).enhance(0.8)
    im.save(f'{OUT}/{name}.webp', 'WEBP', quality=82, method=6)
    if name == 'floor-2a':
        dark = ImageEnhance.Color(ImageEnhance.Brightness(im).enhance(0.9)).enhance(1.12)
        dark.transpose(Image.ROTATE_90).save(f'{OUT}/floor-2b.webp', 'WEBP', quality=82, method=6)
print('ok')
