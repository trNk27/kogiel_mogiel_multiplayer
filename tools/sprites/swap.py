"""Generate the Podmianka objects with FLUX.2 [pro] into raw-swap/ (about 2 credits each).

Same style suffix as the Pierogi Panic sprites (sprites.py), so they look like one set.
Usage: BFL_API_KEY=... python3 swap.py [name ...]   (only missing ones when no names are given)
Then:  python3 process.py ../../client/public/sprites/swap raw-swap
"""
import sys, concurrent.futures as cf, os
from gen import gen, credits
from sprites import STYLE

S = {
  'pickles': "a glass jar of green pickled cucumbers with dill sprigs and garlic, closed with a red gingham cloth lid tied with string",
  'jam': "a glass jar of red strawberry jam closed with a red gingham cloth lid tied with string",
  'kompot': "a large glass jar of dark red cherry kompot drink with cherries floating inside",
  'honey': "a glass jar of golden honey with a wooden honey dipper resting on top",
  'kielbasa': "a horseshoe-shaped ring of smoked Polish kielbasa sausage tied with string",
  'bread': "a round crusty loaf of dark rye bread with a cross cut on top",
  'babka': "a tall bundt-shaped babka cake dusted with white icing sugar",
  'paczek': "a round glazed Polish paczek doughnut sprinkled with candied orange peel",
  'makowiec': "a poppy seed roll cake cut open showing the black poppy seed spiral inside, white icing on top",
  'gingerbread': "a heart-shaped Torun gingerbread cookie decorated with white icing swirls",
  'teapot': "a round white Boleslawiec pottery teapot decorated with cobalt blue dots",
  'kettle': "a red enamel tea kettle with white polka dots and a black handle",
  'tea': "a glass of amber tea in an ornate silver metal glass holder with a lemon slice",
  'spoon': "a wooden spoon and a wooden ladle crossed",
  'eggs': "a small round wicker basket full of brown eggs",
  'garlic': "two white garlic bulbs with a few loose cloves",
  'onion': "a golden brown onion next to a purple red onion",
  'beetroot': "two dark red beetroots with green and red leaves",
  'mushrooms': "three brown porcini mushrooms with thick white stems",
  'apples': "a shiny red apple next to a green apple, each with a leaf",
  'carrots': "three orange carrots with bushy green tops",
  'radishes': "a bunch of round red radishes with green leaves tied together",
  'cucumbers': "two fresh green cucumbers with small bumps",
  'plums': "three dark purple plums with a green leaf",
  'milk': "an old-fashioned glass milk bottle full of white milk with a silver foil cap",
  'oscypek': "a spindle-shaped smoked oscypek mountain cheese with a carved decorative pattern, golden brown",
  'grinder': "a vintage wooden coffee grinder box with a brass crank handle on top",
  'grater': "a four-sided stainless steel box grater with a black handle",
  'sieve': "a round metal kitchen sieve with a long handle and fine mesh",
  'whisk': "a stainless steel balloon whisk",
  'scale': "an old-fashioned cast iron kitchen balance scale with brass weights",
  'clock': "a carved wooden cuckoo clock with pine cone weights hanging below",
  'mortar': "a grey stone mortar bowl with a pestle",
  'sugar': "a white Boleslawiec sugar bowl with cobalt blue dots, filled with white sugar cubes",
  'cutlery': "a silver fork and a silver knife lying side by side",
  'cabbage-rolls': "a small white dish of three golabki cabbage rolls covered in tomato sauce",
}
if __name__ == '__main__':
    os.makedirs('raw-swap', exist_ok=True)
    names = sys.argv[1:] or [k for k in S if not os.path.exists(f'raw-swap/{k}.png')]
    c0 = credits()
    def one(k):
        gen('flux-2-pro', f'raw-swap/{k}.png', STYLE.format(S[k]))
        return k
    # The API rate-limits bursts: three at a time is safe.
    with cf.ThreadPoolExecutor(3) as ex:
        for k in ex.map(one, names): print('done', k, flush=True)
    print('used', round(c0 - credits(), 2), 'left', credits())
