"""Composites the mushroom overlays onto the painted bowl, crate and cabbage sprites and saves 192 px WebP."""
import sys
from PIL import Image
src, spr, out = sys.argv[1], sys.argv[2], sys.argv[3]
K = lambda n: Image.open(f'{src}/{n}.webp').convert('RGBA')
O = lambda n: Image.open(f'{spr}/{n}.png').convert('RGBA')
res = {}
res['ing-mushroom'] = O('ing-mushroom')
b = K('fill-berry'); b.alpha_composite(O('fill-mushroom.over')); res['fill-mushroom'] = b
c = K('crate-berry'); c.alpha_composite(O('crate-mushroom.over')); res['crate-mushroom'] = c
w = K('fill-cabbage'); w.alpha_composite(O('fill-wigilia.over')); res['fill-wigilia'] = w
# Kraut & mushroom badge: the cabbage, a little smaller, with a boletus in front.
i = Image.new('RGBA', (192, 192)); cab = K('ing-cabbage').resize((150, 150), Image.LANCZOS); i.alpha_composite(cab, (4, 2)); i.alpha_composite(O('ing-wigilia.over')); res['ing-wigilia'] = i
for n, im in res.items(): im.save(f'{out}/{n}.webp', 'WEBP', quality=88, method=6)
sheet = Image.new('RGBA', (192 * len(res) * 2, 192 * 2), (60, 30, 40, 255))
for k, (n, im) in enumerate(res.items()): sheet.alpha_composite(im.resize((384, 384)), (k * 384, 0))
sheet.save(f'{spr}/preview.png')
