"""Generate base chef candidates (FLUX.2 [pro]) into chef/. We picked base-b and saved it as chef/sourcream-front.png."""
import sys, concurrent.futures as cf
from gen import gen, credits
STYLE = ("Cute cartoon video game character sprite: {}. Thick dark brown outline, flat bright colors with soft cel shading, "
         "cozy Polish kitchen style, full body, isolated in the center on a plain pure white background, lots of empty white space around it, "
         "no shadow, no text, no border.")
CHEF = ("a chubby half-moon shaped pierogi dumpling with a crimped wavy top edge as the body, the dumpling body is {color}, "
        "with big friendly eyes and rosy cheeks on the front of the dumpling, wearing a tall white chef's toque hat and a small white apron, "
        "tiny stubby arms and two small feet")
jobs = {
  'base-a': (STYLE.format(CHEF.format(color='pale cream colored')) + " Facing the viewer.", 11),
  'base-b': (STYLE.format(CHEF.format(color='pale cream colored')) + " Facing the viewer, standing.", 77),
}
c0 = credits()
def one(k):
    p, seed = jobs[k]
    gen('flux-2-pro', f'chef/{k}.png', p, extra={'seed': seed})
    return k
with cf.ThreadPoolExecutor(4) as ex:
    for k in ex.map(one, jobs): print('done', k, flush=True)
print('used', c0 - credits())
