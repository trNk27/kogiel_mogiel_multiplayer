"""Edit chef/sourcream-front.png into back and side views with FLUX.2 [pro] (reference-image editing)."""
import concurrent.futures as cf
from gen import gen, credits
KEEP = " Keep exactly the same character design, proportions, colors, thick dark brown outline and cartoon style. Plain pure white background, no shadow, no text."
jobs = {
  'sourcream-back': "Show this same pierogi chef character from behind (back view): we see the back of the crimped dumpling body, the back of the tall white chef's toque and the white apron strings tied in a bow at the back. No face visible." + KEEP,
  'sourcream-side': "Show this same pierogi chef character in side view facing to the right, walking with one foot forward, the face in profile looking right." + KEEP,
}
c0 = credits()
def one(k):
    gen('flux-2-pro', f'chef/{k}.png', jobs[k], refs=['chef/sourcream-front.png'])
    return k
with cf.ThreadPoolExecutor(4) as ex:
    for k in ex.map(one, jobs): print('done', k, flush=True)
print('used', c0 - credits(), 'left', credits())
