"""Generate the Pierogi Panic sprites with FLUX.2 [pro] into raw/ (about 2 credits each).

Usage: BFL_API_KEY=... python3 sprites.py [name ...]   (only missing ones when no names are given)
"""
import sys, concurrent.futures as cf, os
from gen import gen, credits
STYLE = ("Cute cartoon video game sprite, {}. Seen from slightly above. Thick dark brown outline, flat bright colors "
         "with soft cel shading, cozy Polish kitchen style. Isolated in the center on a plain pure white background, "
         "lots of empty white space around it, no shadow, no text, no border.")
BOWL = "a round white ceramic Boleslawiec pottery bowl decorated with cobalt blue dots, filled with {}"
CRATE = "an open wooden crate made of light wooden slats, seen from above, filled to the top with {}"
S = {
  'dough': "a round flat sheet of rolled-out pale cream pierogi dough dusted with a little flour, seen from above",
  'fill-potato': BOWL.format("creamy mashed potato mixed with crumbly white farmer's cheese"),
  'fill-cabbage': BOWL.format("pale green-yellow sauerkraut with sliced brown mushrooms"),
  'fill-meat': BOWL.format("browned minced meat filling"),
  'fill-berry': BOWL.format("plump dark blueberries"),
  'raw': "three raw uncooked pale cream pierogi dumplings with crimped edges, lying together in a small pile",
  'plate': "an empty round white ceramic Boleslawiec plate decorated with cobalt blue dots around the rim, seen from above",
  'plate-boiled': "a round white Boleslawiec plate with cobalt blue dots holding three boiled soft pale-golden pierogi dumplings topped with melted butter, fried onion bits and chopped dill, seen from above",
  'plate-fried': "a round white Boleslawiec plate with cobalt blue dots holding three pan-fried crispy golden-brown pierogi dumplings with browned crunchy edges, topped with caramelized onions and a dollop of sour cream, seen from above",
  'dirty': "a round white Boleslawiec plate with cobalt blue dots that is dirty, smeared with brown sauce stains and food crumbs, seen from above",
  'ing-potato': "two brown potatoes next to a wedge of white farmer's cheese",
  'ing-cabbage': "a fresh round green cabbage head",
  'ing-meat': "a raw pink pork meat cut with a white fat edge",
  'ing-berry': "a small heap of fresh dark blueberries with a green leaf",
  'pot': "a large round stainless steel cooking pot with two handles, full of clear blue water, seen from directly above",
  'pan': "a round black cast iron frying pan with a short wooden handle pointing right, with a thin layer of golden oil, empty, seen from directly above",
  'bin': "an open round dark green metal kitchen waste bin seen from directly above, showing crumpled paper and a banana peel inside",
  'crate': "an empty open wooden fruit crate made of light wooden slats, seen from directly above",
  'pin': "a wooden rolling pin with two handles, lying horizontally",
  'bell': "a shiny golden service counter bell",
  'mushy': "a round stainless steel cooking pot seen from directly above, filled with grey-brown overcooked mushy burst dumplings and murky water with green stink clouds",
  'burnt': "a round black cast iron frying pan with a short wooden handle pointing right, seen from directly above, holding three burnt black charred dumplings with a wisp of smoke",
  'pot-raw': "a large round stainless steel cooking pot with two handles, full of clear blue water with three pale raw pierogi dumplings sunk at the bottom",
  'pot-cooked': "a large round stainless steel cooking pot with two handles, full of bubbling blue water with three plump boiled pierogi dumplings floating on top and a little steam",
  'pan-raw': "a round black cast iron frying pan with a short wooden handle pointing right, seen from directly above, holding three pale raw pierogi dumplings in a little oil",
  'crate-potato': CRATE.format("brown potatoes and a block of white farmer's cheese"),
  'crate-cabbage': CRATE.format("green cabbage heads"),
  'crate-meat': CRATE.format("raw pink pork meat cuts wrapped in brown paper"),
  'crate-berry': CRATE.format("fresh dark blueberries"),
  'fried-pan': "a round black cast iron frying pan with a short wooden handle pointing right, seen from directly above, holding three sizzling crispy golden-brown fried pierogi dumplings with onions",
}
if __name__ == '__main__':
    names = sys.argv[1:] or [k for k in S if not os.path.exists(f'raw/{k}.png')]
    c0 = credits()
    def one(k):
        gen('flux-2-pro', f'raw/{k}.png', STYLE.format(S[k]))
        return k
    with cf.ThreadPoolExecutor(6) as ex:
        for k in ex.map(one, names): print('done', k, flush=True)
    print('used', c0 - credits(), 'left', credits())
