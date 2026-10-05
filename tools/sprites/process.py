"""Cut each generated sprite out of its white background and save a 192px WebP with alpha.

Usage: python3 process.py ../../client/public/sprites/kitchen   (reads raw/*.png; needs Pillow and numpy)
"""
import glob, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
SIZE = 192
SKIP = {'crate'}
for f in sorted(glob.glob('raw/*.png')):
    name = os.path.splitext(os.path.basename(f))[0]
    if name in SKIP: continue
    im = Image.open(f).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    mn = a.min(axis=2); mx = a.max(axis=2)
    whiteish = (mn > 228) & (mx - mn < 22)
    mask = Image.fromarray(np.where(whiteish, 255, 0).astype(np.uint8)).copy()
    w, h = mask.size
    # Flood the background in from every white border pixel.
    for x in range(0, w, 8):
        for y in (0, h - 1):
            if mask.getpixel((x, y)) == 255: ImageDraw.floodfill(mask, (x, y), 128)
    for y in range(0, h, 8):
        for x in (0, w - 1):
            if mask.getpixel((x, y)) == 255: ImageDraw.floodfill(mask, (x, y), 128)
    bg = np.asarray(mask) == 128
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    img = Image.fromarray(np.dstack([np.asarray(im), np.asarray(alpha)]), 'RGBA')
    bbox = img.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    img = img.crop(bbox)
    side = int(max(img.size) * 1.04)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    small = canvas.convert('RGBa').resize((SIZE, SIZE), Image.LANCZOS).convert('RGBA')
    small.save(f'{OUT}/{name}.webp', 'WEBP', quality=86, method=6)
    print(name, os.path.getsize(f'{OUT}/{name}.webp'), end=' | ')
