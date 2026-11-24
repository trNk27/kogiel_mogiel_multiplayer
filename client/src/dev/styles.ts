/**
 * /styles – browse the three standardized art styles, reusable sprite packs, and live game previews.
 *   /styles                (defaults to the gallery of all 3 art styles & sprite packs)
 *   /styles?game=tower     (live 16-bit pixel-art Lodowa Wieża bot preview)
 *   /styles?game=tanks|mushroom|rally  (live low-poly 3D previews)
 *   &bare                  hides the top switcher bar and draws at exact 1920×1080
 *   &sudden                Czołgi: jump to the middle of sudden death
 *   &theme=0|1|2           Lodowa Wieża theme index
 */
import '@fontsource-variable/fraunces/soft.css';
import { Mesh, MeshLambertMaterial, PlaneGeometry, Vector3 } from 'three';
import { PLAYER_COLORS, type ColorId } from '../../../shared/protocol';
import { mulberry32 } from '../games/rng';
import { BajaCameo3D } from '../games/arena/baja3d';
import { ArenaStage, groundTexture } from '../games/arena/kit';
import { TanksScene } from '../games/tanks/scene';
import { DT as TANK_DT, TUNING, TanksSim } from '../games/tanks/logic';
import { MushroomScene } from '../games/mushroom/scene';
import { MushroomSim } from '../games/mushroom/logic';
import { RallyScene } from '../games/rally/render3d';
import { DT as RALLY_DT, RallySim } from '../games/rally/sim';
import { generateTrack, pointAt } from '../games/rally/track';
import { DT as TOWER_DT, FLOORS, TowerSim } from '../games/tower/logic';
import { TowerScene } from '../games/tower/scene';
import { TOWER_PACK_ID } from '../games/tower/sprites';
import { listArtStyles, resources } from '../lib/assets';

const params = new URLSearchParams(location.search);
const game = params.get('game') ?? 'gallery';
const bare = params.has('bare');
if (bare) document.body.classList.add('bare');

const TABS: readonly [string, string][] = [
  ['gallery', 'Gallery (All 3 Styles)'],
  ['baja3d', 'Baja (3D Close-Up)'],
  ['tower', 'Tower (Pixel)'],
  ['tanks', 'Tanks (3D)'],
  ['mushroom', 'Mushroom (3D)'],
  ['rally', 'Rally (3D)'],
];

const bar = document.createElement('div');
bar.className = `bar ${bare ? 'hide' : ''}`;
bar.innerHTML = TABS.map(([id, label]) => `<a class="${id === game ? 'on' : ''}" href="?game=${id}">${label}</a>`).join('');
document.body.append(bar);

const canvas = document.createElement('canvas');
document.body.append(canvas);

const NAMES = ['Babcia', 'Dziadek', 'Kasia', 'Tomek'];
const COLORS = ['#e8553a', '#3a8fe8', '#f2c230', '#4fbf5a'];
const COLOR_IDS: ColorId[] = ['beetroot', 'blueberry', 'yolk', 'pickle'];
const looks = NAMES.map((name, i) => ({ name, color: COLORS[i] }));
const rnd = mulberry32(5);

let tick: (dt: number) => void;

if (game === 'baja3d') {
  const stage = new ArenaStage(canvas, { sky: '#a6d8f0', fog: [32, 90], fov: 36 });
  stage.lookAt(new Vector3(0.05, 0.52, 0), 5.8, 0.34);
  const keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);
  const grass = new Mesh(
    keep(new PlaneGeometry(60, 60)),
    keep(new MeshLambertMaterial({ map: keep(groundTexture('grass', 36)), color: '#e9d888' })),
  );
  grass.rotation.x = -Math.PI / 2;
  stage.add(grass);
  const baja = new BajaCameo3D(keep, {
    bagPos: [-1.15, 0.1],
    waypoints: [
      [1.1, 0.3],
      [0.15, 0.95],
      [1.35, -0.45],
    ],
    scale: 1.0,
    bagYaw: 0.45,
    initialRest: 1.8,
    seed: 12,
  });
  stage.add(baja.root);
  tick = (dt) => {
    baja.update(dt);
    stage.render();
  };
} else if (game === 'tanks') {
  const sim = new TanksSim(4, mulberry32(3));
  sim.locked = false;
  const sudden = params.has('sudden');
  if (sudden) sim.timeLeft = TUNING.sudden * 0.8;
  const scene = new TanksScene(canvas, looks);
  scene.setLayout(sim.layout);
  const sticks = looks.map(() => ({ x: 0, y: 0 }));
  const step = () => {
    if (rnd() < 0.02) for (const s of sticks) ((s.x = rnd() * 2 - 1), (s.y = rnd() * 2 - 1));
    if (sudden) sim.tanks.forEach((t, i) => (sticks[i] = { x: -t.x / 8 + (rnd() - 0.5) * 0.6, y: -t.z / 5 + (rnd() - 0.5) * 0.6 }));
    const ev = sim.step(sticks.map((s) => ({ x: s.x, y: s.y, fire: rnd() < 0.03 ? 1 : 0, mortar: rnd() < 0.005 ? 1 : 0 })));
    scene.handle(ev, sim);
  };
  for (let k = 0; k < (sudden ? 0 : 60 * 4); k++) step();
  let acc = 0;
  tick = (dt) => {
    acc += dt;
    while (acc >= TANK_DT) ((acc -= TANK_DT), step());
    scene.update(sim, dt);
  };
} else if (game === 'mushroom') {
  const sim = new MushroomSim(4, mulberry32(4));
  const scene = new MushroomScene(canvas, looks, sim);
  let t = 0;
  const step = () => {
    t += 1 / 60;
    sim.players.forEach((p, i) => p.alive && sim.setInput(i, Math.sin(t * 0.7 + i * 2), Math.cos(t * 0.5 + i)));
    for (const e of sim.step()) scene.onEvent(e);
  };
  for (let k = 0; k < 60 * 3; k++) step();
  let acc = 0;
  tick = (dt) => {
    acc += dt;
    while (acc >= 1 / 60) ((acc -= 1 / 60), step());
    scene.render(dt);
  };
} else if (game === 'tower') {
  const theme = Number(params.get('theme') ?? 1);
  let seed = 7;
  let sim = new TowerSim(4, theme, mulberry32(seed));
  sim.begin();
  const scene = new TowerScene(
    canvas,
    looks.map((l, i) => ({ ...l, colorId: COLOR_IDS[i] })),
  );
  scene.reset(sim);
  let resetTimer = 0;
  const step = () => {
    if (sim.over) {
      resetTimer += TOWER_DT;
      if (resetTimer >= 2.2) {
        resetTimer = 0;
        seed++;
        sim = new TowerSim(4, theme, mulberry32(seed));
        sim.begin();
        scene.reset(sim);
      }
      return;
    }
    for (let i = 0; i < sim.players.length; i++) {
      const p = sim.players[i];
      if (!p.alive || p.finished) continue;
      const targetFloor = Math.min(FLOORS, Math.max(1, (p.grounded ? p.standingFloor : p.bestFloor) + 1));
      const plat = sim.platforms[targetFloor];
      const tx = plat.x + plat.w / 2;
      const dx = tx - p.x;
      sim.setInput(i, Math.abs(dx) < 6 ? (rnd() < 0.5 ? 1 : -1) : Math.sign(dx));
      if (p.grounded && (Math.abs(p.vx) > 90 || Math.abs(dx) < 34) && rnd() < 0.08) sim.pressJump(i);
      else if (!p.grounded && p.wallCoyote > 0 && rnd() < 0.25) sim.pressJump(i);
    }
    for (const ev of sim.step()) scene.onEvent(ev, sim);
  };
  for (let k = 0; k < 60 * 4; k++) step();
  let acc = 0;
  tick = (dt) => {
    acc += dt;
    while (acc >= TOWER_DT) ((acc -= TOWER_DT), step());
    scene.render(sim, dt);
  };
} else if (game === 'rally') {
  const track = generateTrack(7);
  const sim = new RallySim(track, 2, 3, false, mulberry32(1));
  const scene = new RallyScene(canvas, looks.slice(0, 2));
  scene.setTrack(track);
  scene.resetCameras(sim.cars);
  const step = () => {
    for (const c of sim.cars) {
      const p = pointAt(track, Math.max(0, c.progress) + 14);
      let a = Math.atan2(p.z - c.z, p.x - c.x) - c.heading;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      c.input = { x: Math.max(-100, Math.min(100, a * 200)), y: 100 };
    }
    sim.step();
  };
  for (let k = 0; k < 60 * 9; k++) step();
  scene.resetCameras(sim.cars);
  const slots = [
    { x: 0, y: 0, w: 960, h: 1080 },
    { x: 960, y: 0, w: 960, h: 1080 },
  ];
  let acc = 0;
  tick = (dt) => {
    acc += dt;
    while (acc >= RALLY_DT) ((acc -= RALLY_DT), step());
    scene.render(sim, slots, dt);
  };
} else {
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;
  void resources.preload(['kitchen', 'swap', 'pixel-common', TOWER_PACK_ID]);
  let t = 0;
  const poses = ['pierogi-idle', 'pierogi-run', 'pierogi-jump', 'pierogi-spin', 'pierogi-win', 'pierogi-frozen'] as const;
  const kitchenSamples = ['chef-beetroot-front', 'chef-yolk-side', 'plate-boiled', 'plate-fried', 'pot-cooked', 'flour', 'crate-berry', 'bell'];
  const swapSamples = ['pickles', 'jam', 'paczek', 'kielbasa', 'babka', 'teapot', 'eggs', 'oscypek'];

  tick = (dt) => {
    t += dt;
    ctx.fillStyle = '#1d0d15';
    ctx.fillRect(0, 0, 1920, 1080);

    ctx.fillStyle = '#fbf0d9';
    ctx.font = '800 42px "Fraunces Variable", Georgia, serif';
    ctx.fillText('Kogiel Mogiel · 3 Standardized Art Styles & Sprite Resource Manager', 56, 72);

    // 1. Three Standardized Art Style Cards
    const styles = listArtStyles();
    styles.forEach((st, idx) => {
      const x = 56 + idx * 612;
      const y = 98;
      const w = 586;
      const h = 258;
      ctx.fillStyle = '#2a1520';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#ffc93c';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = '#ffc93c';
      ctx.font = '800 26px "Fraunces Variable", Georgia, serif';
      ctx.fillText(`${st.name} (${st.id})`, x + 20, y + 36);

      ctx.fillStyle = '#ead7b0';
      ctx.font = '600 17px system-ui, sans-serif';
      ctx.fillText(`${st.renderer} · ${st.baseResolution[0]}×${st.baseResolution[1]} · smooth=${st.smoothing}`, x + 20, y + 66);
      ctx.fillStyle = '#79d2ff';
      ctx.fillText(`Entry: ${st.entryPoint}`, x + 20, y + 92);

      ctx.fillStyle = 'rgba(251,240,217,0.82)';
      st.reusableAssets.slice(0, 3).forEach((line, li) => {
        ctx.fillText(`• ${line.slice(0, 62)}`, x + 20, y + 122 + li * 22);
      });

      Object.entries(st.palette).forEach(([, hex], ci) => {
        const sx = x + 20 + ci * 56;
        ctx.fillStyle = hex;
        ctx.fillRect(sx, y + 196, 42, 42);
        ctx.strokeStyle = '#120d1b';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, y + 196, 42, 42);
      });
    });

    // 2. Pixel-Common Pack (Pierogi across player colors + icons)
    ctx.fillStyle = '#2a1520';
    ctx.fillRect(56, 380, 900, 320);
    ctx.strokeStyle = '#79d2ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(56, 380, 900, 320);
    ctx.fillStyle = '#79d2ff';
    ctx.font = '800 24px "Fraunces Variable", Georgia, serif';
    ctx.fillText('Pack: pixel-common (style: pixel · dynamic player color ramps)', 76, 418);

    const step = Math.min(88, Math.floor(820 / Math.max(1, PLAYER_COLORS.length)));
    const pScale = PLAYER_COLORS.length > 8 ? 3 : 4;
    ctx.textAlign = 'center';
    PLAYER_COLORS.forEach((pc, i) => {
      const x = 98 + i * step;
      const pose = poses[i % poses.length];
      resources.draw(ctx, 'pixel-common', pose, x, 514, { scale: pScale, color: pc.id, time: t });
      ctx.fillStyle = pc.hex;
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(pc.id, x, 568);
    });
    ctx.textAlign = 'left';

    ['crown', 'star', 'flag', 'snowflake', 'sparkle', 'heart', 'skull'].forEach((ic, i) => {
      resources.draw(ctx, 'pixel-common', ic, 96 + i * 64, 636, { scale: 4, time: t });
    });

    ['baja-bag', 'baja-bag-empty', 'baja-idle', 'baja-run'].forEach((sp, i) => {
      resources.draw(ctx, 'pixel-common', sp, 588 + i * 96, 636, { scale: 4, time: t });
    });

    // 3. Tower Pack (3-slice platforms, wall blocks, torches, frost wave)
    ctx.fillStyle = '#2a1520';
    ctx.fillRect(984, 380, 880, 320);
    ctx.strokeStyle = '#79d2ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(984, 380, 880, 320);
    ctx.fillStyle = '#79d2ff';
    ctx.font = '800 24px "Fraunces Variable", Georgia, serif';
    ctx.fillText('Pack: tower (style: pixel · 3-slice ledges & tiles)', 1004, 418);

    ['plat-stone', 'plat-ice', 'plat-crumble', 'plat-moving', 'summit-plat'].forEach((pl, i) => {
      resources.drawTileRow(ctx, TOWER_PACK_ID, pl, 1012, 446 + i * 44, 240, { scale: 3 });
    });
    resources.draw(ctx, TOWER_PACK_ID, 'brick-bg', 1320, 478, { scale: 4 });
    resources.draw(ctx, TOWER_PACK_ID, 'wall-block', 1408, 478, { scale: 4 });
    resources.draw(ctx, TOWER_PACK_ID, 'window', 1504, 492, { scale: 4 });
    resources.draw(ctx, TOWER_PACK_ID, 'torch', 1604, 492, { scale: 5, time: t });
    resources.draw(ctx, TOWER_PACK_ID, 'spring', 1690, 498, { scale: 4, frame: Math.floor(t * 2) % 2 });
    resources.draw(ctx, TOWER_PACK_ID, 'pine', 1796, 500, { scale: 4 });
    for (let k = 0; k < 6; k++) resources.draw(ctx, TOWER_PACK_ID, 'frost-wave', 1330 + k * 64, 618, { scale: 4, time: t });

    // 4. Cartoon Packs (kitchen & swap)
    ctx.fillStyle = '#2a1520';
    ctx.fillRect(56, 724, 1808, 306);
    ctx.strokeStyle = '#2fd6a8';
    ctx.lineWidth = 3;
    ctx.strokeRect(56, 724, 1808, 306);
    ctx.fillStyle = '#2fd6a8';
    ctx.font = '800 24px "Fraunces Variable", Georgia, serif';
    ctx.fillText('Packs: kitchen & swap (style: cartoon · WebP sprites via resources.preload)', 76, 762);

    kitchenSamples.forEach((sp, i) => {
      resources.draw(ctx, 'kitchen', sp, 130 + i * 106, 878, { w: 86, h: 86 });
    });
    swapSamples.forEach((sp, i) => {
      resources.draw(ctx, 'swap', sp, 1020 + i * 106, 878, { w: 86, h: 86 });
    });
  };
}

let last = performance.now();
const frame = (now: number) => {
  requestAnimationFrame(frame);
  tick(Math.min(0.1, (now - last) / 1000));
  last = now;
};
requestAnimationFrame(frame);
