"""Generate floor, counter and wall textures with FLUX.2 [pro] into tex/."""
import concurrent.futures as cf
from gen import gen, credits
T = ("Seamless square game texture seen from directly above, perfectly flat and orthographic, no perspective, even soft lighting, "
     "cozy hand-painted cartoon style matching a cute cooking game. {} The texture fills the entire image edge to edge, no background, no frame, no text.")
jobs = {
  'floor-1a': "A single square glazed ceramic kitchen floor tile in warm cream, with a small hand-painted red and cobalt blue Polish folk flower in the middle and a thin light grout line along the edges.",
  'floor-1b': "A single square glazed ceramic kitchen floor tile in plain warm biscuit beige with a subtle mottled glaze and a thin light grout line along the edges.",
  'floor-2a': "A single square rustic terracotta floor tile, warm orange-brown, slightly worn, with a thin pale grout line along the edges.",
  'floor-2b': "A single square rustic terracotta floor tile, a slightly darker and redder shade, slightly worn, with a thin pale grout line along the edges.",
  'floor-3a': "A single square white glazed ceramic floor tile decorated with a Boleslawiec pottery pattern of cobalt blue dots forming a small flower in the middle, thin light grout line along the edges.",
  'floor-3b': "A single square pale blue-white glazed ceramic floor tile with a faint cobalt blue dotted border and a thin light grout line along the edges.",
  'counter': "Light oak wooden butcher-block kitchen counter top made of narrow planks running horizontally, warm honey color.",
  'wall': "Dark plum-burgundy painted wooden wall planks running vertically with a few small cream folk-painted flowers.",
}
c0 = credits()
def one(k):
    gen('flux-2-pro', f'tex/{k}.png', T.format(jobs[k]))
    return k
import os
todo = [k for k in jobs if not os.path.exists(f'tex/{k}.png')]
with cf.ThreadPoolExecutor(3) as ex:
    for k in ex.map(one, todo): print('done', k, flush=True)
print('used', c0 - credits(), 'left', credits())
