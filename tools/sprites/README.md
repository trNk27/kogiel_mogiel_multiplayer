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
