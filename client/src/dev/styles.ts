/**
 * /styles – the real 3D scenes driven by bots, to compare looks side by side.
 *   /styles?game=tanks|mushroom|rally&style=<id>   (see STYLES in games/arena/styles.ts)
 *   &bare  hides the switcher bar (for screenshots)
 */
import '@fontsource-variable/fraunces/soft.css';
import { STYLES, styleFromUrl } from '../games/arena/styles';
import { mulberry32 } from '../games/rng';
import { TanksScene } from '../games/tanks/scene';
import { DT as TANK_DT, TanksSim } from '../games/tanks/logic';
import { MushroomScene } from '../games/mushroom/scene';
import { MushroomSim } from '../games/mushroom/logic';
import { RallyScene } from '../games/rally/render3d';
import { DT as RALLY_DT, RallySim } from '../games/rally/sim';
import { generateTrack, pointAt } from '../games/rally/track';

const params = new URLSearchParams(location.search);
const game = params.get('game') ?? 'tanks';
const style = styleFromUrl();

const bar = document.createElement('div');
bar.className = `bar ${params.has('bare') ? 'hide' : ''}`;
const link = (label: string, g: string, s: string, on: boolean) =>
  `<a class="${on ? 'on' : ''}" href="?game=${g}&style=${s}">${label}</a>`;
bar.innerHTML =
  ['tanks', 'mushroom', 'rally'].map((g) => link(g, g, style.id, g === game)).join('') +
  '<span style="width:16px"></span>' +
  STYLES.map((s) => link(s.name, game, s.id, s.id === style.id)).join('');
document.body.append(bar);

const canvas = document.createElement('canvas');
document.body.append(canvas);

const NAMES = ['Babcia', 'Dziadek', 'Kasia', 'Tomek'];
const COLORS = ['#e8553a', '#3a8fe8', '#f2c230', '#4fbf5a'];
const looks = NAMES.map((name, i) => ({ name, color: COLORS[i] }));
const rnd = mulberry32(5);

let tick: (dt: number) => void;

if (game === 'tanks') {
  const sim = new TanksSim(4, mulberry32(3));
  sim.locked = false;
  const scene = new TanksScene(canvas, looks);
  scene.setLayout(sim.layout);
  const sticks = looks.map(() => ({ x: 0, y: 0 }));
  const step = () => {
    if (rnd() < 0.02) for (const s of sticks) ((s.x = rnd() * 2 - 1), (s.y = rnd() * 2 - 1));
    const ev = sim.step(sticks.map((s) => ({ x: s.x, y: s.y, fire: rnd() < 0.03 ? 1 : 0, mortar: rnd() < 0.005 ? 1 : 0 })));
    scene.handle(ev, sim);
  };
  for (let k = 0; k < 60 * 4; k++) step();
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
} else {
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
}

let last = performance.now();
const frame = (now: number) => {
  requestAnimationFrame(frame);
  tick(Math.min(0.1, (now - last) / 1000));
  last = now;
};
requestAnimationFrame(frame);
