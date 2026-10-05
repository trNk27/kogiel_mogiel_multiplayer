# Pierogi Panic sprites

The kitchen sprites in `client/public/sprites/kitchen/` were generated with FLUX.2 [pro] from
Black Forest Labs, then cut out of their white backgrounds.

```sh
cd tools/sprites
export BFL_API_KEY=...          # never commit the key
python3 sprites.py              # generates every missing raw/<name>.png (~2 credits each)
python3 sprites.py plate-fried  # or regenerate just one
pip install pillow numpy
python3 process.py ../../client/public/sprites/kitchen
```

All prompts share one style suffix in `sprites.py`, so new sprites match the existing ones.
`process.py` flood-fills the white background from the image border, which keeps white areas
inside an outline (plates, flour) intact, then crops and saves a 192 × 192 WebP.

## Chefs and floors

```sh
python3 chef.py          # base chef candidates; save the one you like as chef/sourcream-front.png
python3 poses.py         # back and side views, edited from the front view so the character stays identical
python3 recolor.py       # recolours the dough into every player colour locally (keeps the shading, no credits)
python3 textures.py      # floor tiles per level, counter top, wall
python3 process_chefs.py ../../client/public/sprites/kitchen
```

Chef sprites share one crop and scale with the feet on the bottom edge, so the TV can swap poses
(front, back, side, mirrored side) as the chef turns. `process_chefs.py` also makes the second
terracotta tile (a darker, rotated copy of the first) and brightens or softens a few textures so
they read well at 90 px.
