// Pierogi Panic's mushroom sprites: renders the SVG overlays (see mushroom-art.mjs) to PNG.
// Usage: node mushroom-build.mjs <out dir>, then python3 mushroom-compose.py <sprites dir> <out dir> <out dir>.
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { boletus, slice, cap, svg } from './mushroom-art.mjs';
const require = createRequire(import.meta.url);
// Needs Playwright: PLAYWRIGHT=/path/to/node_modules/playwright, and optionally CHROME=/path/to/chrome.
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2];

// Grass tuft for the loose mushrooms.
const grass = `<path d="M40 168 q6 -26 14 -34 q-2 18 4 34 q6 -22 16 -30 q-4 16 0 30 Z" fill="#6aa84f" stroke="#2b1a10" stroke-width="4" stroke-linejoin="round"/>`;
const sheets = {
  // The ingredient: two prawdziwki.
  'ing-mushroom': svg(`<ellipse cx="98" cy="170" rx="66" ry="12" fill="rgba(0,0,0,.18)"/>${grass}${boletus(64, 166, 0.95, -1)}${boletus(118, 170, 1.32)}`),
  // Over a bowl (fill-berry): a heap of mushroom filling with slices on top.
  'fill-mushroom.over': svg(`
    <path d="M12 66 C14 34 50 16 96 16 C142 16 178 34 180 66 A84 29 0 0 1 12 66 Z" fill="#a8763f" stroke="#2b1a10" stroke-width="5"/>
    <path d="M24 60 C30 40 60 28 96 26 C70 34 48 46 40 64 Z" fill="#c69456"/>
    ${[[52, 50, -14], [94, 40, 6], [138, 52, 18], [72, 72, -4], [118, 74, 10], [32, 74, -24], [160, 76, 22]].map(([x, y, r]) => slice(x, y, 0.62, r)).join('')}
    ${[[40, 40], [84, 60], [128, 34], [150, 64], [100, 82], [62, 30]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#5b8f3a"/>`).join('')}
  `),
  // Over a crate (crate-berry): caps packed into the crate, clipped behind its front planks.
  'crate-mushroom.over': svg(
    `<g clip-path="url(#open)">
      <path d="M12 64 L96 20 L184 62 L98 106 Z" fill="#5a3a1e"/>
      ${[[40, 60], [70, 46], [100, 34], [130, 44], [160, 58], [54, 80], [86, 70], [116, 62], [146, 76], [70, 98], [100, 90], [128, 94], [98, 112], [84, 108], [114, 110]].map(([x, y], i) => cap(x, y, 0.82, i)).join('')}
    </g>
    ${[[78, 26], [116, 24]].map(([x, y], i) => cap(x, y, 0.78, i + 1)).join('')}`,
    `<clipPath id="open"><path d="M8 62 L98 106 L186 60 L186 0 L8 0 Z"/></clipPath>`,
  ),
  // Over the sauerkraut bowl (fill-cabbage): a whole mushroom on top, so the mix reads differently.
  'fill-wigilia.over': svg(`${boletus(150, 70, 0.62)}${slice(44, 48, 0.55, -18)}${slice(104, 30, 0.5, 8)}`),
  'ing-wigilia.over': svg(boletus(134, 178, 0.98)),
};
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 192, height: 192 }, deviceScaleFactor: 1 });
for (const [name, markup] of Object.entries(sheets)) {
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  await page.screenshot({ path: `${out}/${name}.png`, omitBackground: true, clip: { x: 0, y: 0, width: 192, height: 192 } });
}
await browser.close();
