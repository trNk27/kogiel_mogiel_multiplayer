/** A small Polish town along part of the track: houses, a few PRL apartment blocks, a church, a shop and street lamps. */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  SRGBColorSpace,
  type Material,
} from 'three';
import { WALL, type Track } from './track';

export interface TownContext {
  t: Track;
  /** Distance from (x, z) to the nearest centre-line sample. */
  roadDist: (x: number, z: number) => number;
  terrain: (x: number, z: number) => number;
  rnd: () => number;
  keep: <T extends BufferGeometry | Material | CanvasTexture>(x: T) => T;
  world: Group;
  /** Places the town must keep clear of (the river, the tunnel hill). */
  blocked?: (x: number, z: number, r: number) => boolean;
}

export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

const WALLS = ['#f4e3c1', '#f6d6a0', '#e9b8a0', '#cfe0c8', '#c9d7ea', '#f2c6c6', '#fff4dc', '#e8d0f0'];
const ROOFS = ['#a5462e', '#8b3a2b', '#6d4c3d', '#b85c38', '#4f5a63'];
const BLOCKS = ['#d9d4c7', '#e6cfa7', '#bcd3c6', '#c9c7dd', '#e3b7a8'];

function texture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.magFilter = t.minFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Unit gable roof: base 1 × 1 at y = 0, ridge along z at y = 1. */
function gableGeometry() {
  const a = [-0.5, 0, -0.5];
  const b = [0.5, 0, -0.5];
  const c = [0.5, 0, 0.5];
  const d = [-0.5, 0, 0.5];
  const r1 = [0, 1, -0.5];
  const r2 = [0, 1, 0.5];
  // Two roof slopes and the two gable ends, wound to face outwards.
  const tris = [
    [a, d, r2],
    [a, r2, r1],
    [c, b, r1],
    [c, r1, r2],
    [d, c, r2],
    [b, a, r1],
  ];
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((tri, i) => tri.forEach((v, j) => pos.set(v, i * 9 + j * 3)));
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildTown(ctx: TownContext): Obstacle[] {
  const { t, roadDist, terrain, rnd, keep, world } = ctx;
  const obstacles: Obstacle[] = [];
  if (!t.town) return obstacles;
  const n = t.n;
  const whole = t.town.to - t.town.from >= n;

  const houseTex = keep(
    texture(16, 16, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#d9cfc0';
      g.fillRect(0, 14, 16, 2);
      g.fillStyle = '#5b3b2a';
      g.fillRect(2, 4, 4, 4);
      g.fillRect(10, 4, 4, 4);
      g.fillStyle = '#7fb0d8';
      g.fillRect(3, 5, 2, 2);
      g.fillRect(11, 5, 2, 2);
      g.fillStyle = '#6b4428';
      g.fillRect(7, 9, 3, 7);
    }),
  );
  const blockTex = keep(
    texture(16, 32, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 16, 32);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 4; x++) {
          g.fillStyle = (x + y * 3) % 5 === 0 ? '#e8d27a' : '#4e6a86';
          g.fillRect(x * 4 + 1, y * 4 + 1, 2, 2);
        }
    }),
  );

  const MAX = 90;
  const walls = new InstancedMesh(keep(new BoxGeometry(1, 1, 1)), keep(new MeshLambertMaterial({ map: houseTex, flatShading: true })), MAX);
  const roofs = new InstancedMesh(keep(gableGeometry()), keep(new MeshLambertMaterial({ flatShading: true })), MAX);
  const blocks = new InstancedMesh(keep(new BoxGeometry(1, 1, 1)), keep(new MeshLambertMaterial({ map: blockTex, flatShading: true })), 16);
  const poleGeo = keep(new BoxGeometry(0.25, 5, 0.25));
  poleGeo.translate(0, 2.5, 0);
  const lampGeo = keep(new BoxGeometry(0.6, 0.35, 0.9));
  lampGeo.translate(0, 5, 0.3);
  const poles = new InstancedMesh(poleGeo, keep(new MeshLambertMaterial({ color: '#3b3f46', flatShading: true })), 200);
  const lamps = new InstancedMesh(lampGeo, keep(new MeshBasicMaterial({ color: '#ffe9a8' })), 200);

  const dummy = new Object3D();
  const col = new Color();
  let houses = 0;
  let nBlocks = 0;
  let nLamps = 0;
  const free = (x: number, z: number, r: number) =>
    roadDist(x, z) > WALL + 2 + r && !ctx.blocked?.(x, z, r) && obstacles.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r + 1.5);
  /** A spot `off` metres from the road at sample i (side +1 = left), facing the road. */
  const spot = (i: number, side: number, off: number) => {
    const x = t.xs[i] + t.tz[i] * off * side;
    const z = t.zs[i] - t.tx[i] * off * side;
    // Local +z faces the road.
    const face = Math.atan2(-t.tz[i] * side, t.tx[i] * side);
    return { x, z, rot: face };
  };

  const step = whole ? 8 : 7;
  const span = whole ? n : t.town.to - t.town.from;
  for (let s = 0; s < span; s += step) {
    const i = (t.town.from + s) % n;
    for (const side of [1, -1]) {
      // Street lamps along the barrier.
      if (s % (step * 2) === 0 && nLamps < 200 && t.wall[i] >= WALL) {
        const p = spot(i, side, WALL + 2.8);
        dummy.position.set(p.x, terrain(p.x, p.z) - 0.2, p.z);
        dummy.rotation.set(0, p.rot + Math.PI, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(nLamps, dummy.matrix);
        lamps.setMatrixAt(nLamps, dummy.matrix);
        nLamps++;
      }
      if (rnd() < 0.12) continue;
      const block = nBlocks < 16 && rnd() < 0.14;
      const w = block ? 22 + rnd() * 6 : 6 + rnd() * 4;
      const d = block ? 10 : 6 + rnd() * 3;
      const h = block ? 12 + Math.floor(rnd() * 3) * 3 : 3.6 + rnd() * 1.6;
      const off = WALL + (block ? 10 : 6) + d / 2 + rnd() * 3;
      const p = spot(i, side, off);
      const r = Math.hypot(w, d) / 2;
      if (!free(p.x, p.z, r)) continue;
      const base = terrain(p.x, p.z);
      dummy.rotation.set(0, p.rot, 0);
      if (block) {
        dummy.position.set(p.x, base - 2 + (h + 2) / 2, p.z);
        dummy.scale.set(w, h + 2, d);
        dummy.updateMatrix();
        blocks.setMatrixAt(nBlocks, dummy.matrix);
        blocks.setColorAt(nBlocks, col.set(BLOCKS[Math.floor(rnd() * BLOCKS.length)]));
        nBlocks++;
      } else {
        if (houses >= MAX) continue;
        // Walls start below ground so slopes never show a gap.
        dummy.position.set(p.x, base - 1.5 + (h + 1.5) / 2, p.z);
        dummy.scale.set(w, h + 1.5, d);
        dummy.updateMatrix();
        walls.setMatrixAt(houses, dummy.matrix);
        walls.setColorAt(houses, col.set(WALLS[Math.floor(rnd() * WALLS.length)]));
        // The ridge runs along the street.
        dummy.position.set(p.x, base + h, p.z);
        dummy.rotation.set(0, p.rot + Math.PI / 2, 0);
        dummy.scale.set(d + 0.8, 2.2 + rnd() * 1.5, w + 0.8);
        dummy.updateMatrix();
        roofs.setMatrixAt(houses, dummy.matrix);
        roofs.setColorAt(houses, col.set(ROOFS[Math.floor(rnd() * ROOFS.length)]));
        houses++;
      }
      obstacles.push({ x: p.x, z: p.z, r });
    }
  }
  for (const m of [walls, roofs]) m.count = houses;
  blocks.count = nBlocks;
  poles.count = lamps.count = nLamps;
  for (const m of [walls, roofs, blocks, poles, lamps]) {
    m.frustumCulled = false;
    world.add(m);
  }

  // The church, with a tall tower, near the middle of town.
  const mid = (t.town.from + Math.floor(span / 2)) % n;
  for (const side of [1, -1]) {
    const p = spot(mid, side, WALL + 22);
    if (!free(p.x, p.z, 14)) continue;
    const church = new Group();
    const white = keep(new MeshLambertMaterial({ color: '#f3efe6', flatShading: true }));
    const roofMat = keep(new MeshLambertMaterial({ color: '#7a2e24', flatShading: true }));
    const copper = keep(new MeshLambertMaterial({ color: '#3f8f7a', flatShading: true }));
    const nave = new Mesh(keep(new BoxGeometry(10, 9, 18)), white);
    nave.position.set(0, 3.5, -3);
    const navRoof = new Mesh(keep(gableGeometry()), roofMat);
    navRoof.position.set(0, 8, -3);
    navRoof.scale.set(11, 4.5, 19);
    const tower = new Mesh(keep(new BoxGeometry(5.5, 18, 5.5)), white);
    tower.position.set(0, 8, 8);
    const spire = new Mesh(keep(new ConeGeometry(3.6, 9, 4)), copper);
    spire.position.set(0, 21.5, 8);
    spire.rotation.y = Math.PI / 4;
    const crossV = new Mesh(keep(new BoxGeometry(0.3, 2.4, 0.3)), keep(new MeshBasicMaterial({ color: '#ffd23f' })));
    crossV.position.set(0, 27, 8);
    const crossH = new Mesh(keep(new BoxGeometry(1.4, 0.3, 0.3)), crossV.material);
    crossH.position.set(0, 27.4, 8);
    const door = new Mesh(keep(new BoxGeometry(2, 3.4, 0.2)), keep(new MeshLambertMaterial({ color: '#5b3b2a' })));
    door.position.set(0, 1.2, 10.8);
    church.add(nave, navRoof, tower, spire, crossV, crossH, door);
    church.position.set(p.x, terrain(p.x, p.z) - 0.5, p.z);
    church.rotation.y = p.rot;
    world.add(church);
    obstacles.push({ x: p.x, z: p.z, r: 14 });
    break;
  }

  // A corner shop with a SKLEP sign.
  for (let tries = 0; tries < 10; tries++) {
    const i = (t.town.from + Math.floor(rnd() * span)) % n;
    const side = rnd() < 0.5 ? 1 : -1;
    const p = spot(i, side, WALL + 9);
    if (!free(p.x, p.z, 6)) continue;
    const shop = new Group();
    const body = new Mesh(keep(new BoxGeometry(9, 5, 7)), keep(new MeshLambertMaterial({ map: houseTex, color: '#cfe0c8', flatShading: true })));
    body.position.y = 2;
    const sign = new Mesh(
      keep(new BoxGeometry(7, 1.4, 0.3)),
      keep(
        new MeshBasicMaterial({
          map: keep(
            texture(64, 12, (g) => {
              g.fillStyle = '#2b5fae';
              g.fillRect(0, 0, 64, 12);
              g.fillStyle = '#fff4dc';
              g.font = 'bold 10px sans-serif';
              g.textAlign = 'center';
              g.fillText('SKLEP', 32, 10);
            }),
          ),
        }),
      ),
    );
    sign.position.set(0, 5.3, 3.6);
    shop.add(body, sign);
    shop.position.set(p.x, terrain(p.x, p.z) - 0.5, p.z);
    shop.rotation.y = p.rot;
    world.add(shop);
    obstacles.push({ x: p.x, z: p.z, r: 6 });
    break;
  }
  return obstacles;
}
