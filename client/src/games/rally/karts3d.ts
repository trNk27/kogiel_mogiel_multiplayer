/**
 * Low-poly cars for Maluch Rally and Maluch Rallye Premium: the Fiat 126p "Maluch" everybody
 * drives in the plain game, and three more PRL classics for Premium's car select.
 * About as many polygons as a PS2 would spend on a background car.
 */
import { BoxGeometry, BufferAttribute, CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, type Material } from 'three';
import type { KartId } from '../../../../shared/protocol';

export interface CarModel {
  car: Group;
  wheels: Mesh[];
  mats: Material[];
}

interface Parts {
  paint: MeshLambertMaterial;
  dark: MeshLambertMaterial;
  glass: MeshLambertMaterial;
  chrome: MeshLambertMaterial;
  lamp: MeshBasicMaterial;
  tail: MeshBasicMaterial;
}

function parts(color: string): Parts {
  return {
    paint: new MeshLambertMaterial({ color, flatShading: true }),
    dark: new MeshLambertMaterial({ color: '#1d1a22', flatShading: true }),
    glass: new MeshLambertMaterial({ color: '#2b3d55', flatShading: true }),
    chrome: new MeshLambertMaterial({ color: '#c9ccd3', flatShading: true }),
    lamp: new MeshBasicMaterial({ color: '#fff4c8' }),
    tail: new MeshBasicMaterial({ color: '#d0213a' }),
  };
}

/** A box whose top face is pulled in: `nose`/`tail` squash the top front/back, `side` the top sides. */
function taper(w: number, h: number, l: number, nose = 1, tail = 1, side = 1, shift = 0) {
  const g = new BoxGeometry(w, h, l);
  const p = g.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) <= 0) continue;
    const z = p.getZ(i);
    p.setZ(i, z * (z > 0 ? nose : tail) + shift);
    p.setX(i, p.getX(i) * side);
  }
  g.computeVertexNormals();
  return g;
}

function wheelSet(car: Group, mat: Material, r: number, width: number, x: number, zs: number[]) {
  const geo = new CylinderGeometry(r, r, width, 7);
  geo.rotateZ(Math.PI / 2);
  const wheels: Mesh[] = [];
  for (const z of zs)
    for (const sx of [-x, x]) {
      const w = new Mesh(geo, mat);
      w.position.set(sx, r, z);
      car.add(w);
      wheels.push(w);
    }
  return wheels;
}

function lights(car: Group, m: Parts, y: number, front: number, back: number, x = 0.55) {
  for (const sx of [-x, x]) {
    const l = new Mesh(new BoxGeometry(0.32, 0.2, 0.06), m.lamp);
    l.position.set(sx, y, front);
    car.add(l);
    const t = new Mesh(new BoxGeometry(0.3, 0.18, 0.06), m.tail);
    t.position.set(sx, y, back);
    car.add(t);
  }
}

function shadow(car: Group, sx = 0.75, sz = 1.25) {
  const s = new Mesh(new CircleGeometry(1.6, 10), new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
  s.rotation.x = -Math.PI / 2;
  s.scale.set(sx, sz, 1);
  s.position.y = 0.05;
  car.add(s);
}

/** The Fiat 126p: a tiny box with a sloped nose and tail. */
function maluch(m: Parts): CarModel {
  const car = new Group();
  const body = new Mesh(taper(1.7, 0.7, 3.2, 0.86, 0.86), m.paint);
  body.position.y = 0.65;
  car.add(body);
  const cabin = new Mesh(taper(1.5, 0.62, 1.75, 0.72, 0.72, 0.86, -0.1), m.glass);
  cabin.position.set(0, 1.3, -0.15);
  car.add(cabin);
  const roof = new Mesh(new BoxGeometry(1.3, 0.1, 1.22), m.paint);
  roof.position.set(0, 1.64, -0.22);
  car.add(roof);
  for (const z of [1.62, -1.62]) {
    const bumper = new Mesh(new BoxGeometry(1.8, 0.16, 0.14), m.chrome);
    bumper.position.set(0, 0.42, z);
    car.add(bumper);
  }
  lights(car, m, 0.72, 1.61, -1.61);
  const wheels = wheelSet(car, m.dark, 0.36, 0.3, 0.82, [1.05, -1.05]);
  shadow(car);
  return { car, wheels, mats: [m.paint, m.dark, m.glass, m.chrome] };
}

/** The FSO Syrenka: round fenders, a long bonnet and a little bubble cabin. */
function syrenka(m: Parts): CarModel {
  const car = new Group();
  const body = new Mesh(taper(1.6, 0.62, 3.5, 0.7, 0.8, 0.9), m.paint);
  body.position.y = 0.66;
  car.add(body);
  // Bulging front wings.
  for (const sx of [-0.78, 0.78]) {
    const wing = new Mesh(taper(0.42, 0.5, 1.3, 0.6, 0.6, 0.8), m.paint);
    wing.position.set(sx, 0.62, 1.05);
    car.add(wing);
  }
  const cabin = new Mesh(taper(1.4, 0.66, 1.6, 0.6, 0.65, 0.82, -0.05), m.glass);
  cabin.position.set(0, 1.28, -0.35);
  car.add(cabin);
  const roof = new Mesh(new BoxGeometry(1.12, 0.12, 0.95), m.paint);
  roof.position.set(0, 1.64, -0.4);
  car.add(roof);
  const grille = new Mesh(new BoxGeometry(0.9, 0.3, 0.08), m.chrome);
  grille.position.set(0, 0.62, 1.76);
  car.add(grille);
  const bumper = new Mesh(new BoxGeometry(1.7, 0.12, 0.14), m.chrome);
  bumper.position.set(0, 0.4, -1.78);
  car.add(bumper);
  lights(car, m, 0.78, 1.72, -1.76, 0.62);
  const wheels = wheelSet(car, m.dark, 0.38, 0.28, 0.78, [1.1, -1.15]);
  shadow(car, 0.72, 1.32);
  return { car, wheels, mats: [m.paint, m.dark, m.glass, m.chrome] };
}

/** The FSO Polonez: a long, low wedge with a fastback. */
function polonez(m: Parts): CarModel {
  const car = new Group();
  const body = new Mesh(taper(1.9, 0.62, 4.1, 0.8, 0.95), m.paint);
  body.position.y = 0.6;
  car.add(body);
  // Wedge nose: a sloped bonnet.
  const bonnet = new Mesh(taper(1.86, 0.22, 1.3, 0.4, 1), m.paint);
  bonnet.position.set(0, 1.02, 1.3);
  car.add(bonnet);
  const cabin = new Mesh(taper(1.7, 0.6, 2.2, 0.55, 0.35, 0.86, 0.05), m.glass);
  cabin.position.set(0, 1.21, -0.4);
  car.add(cabin);
  const roof = new Mesh(new BoxGeometry(1.42, 0.1, 1.05), m.paint);
  roof.position.set(0, 1.55, -0.35);
  car.add(roof);
  const stripe = new Mesh(new BoxGeometry(1.94, 0.12, 4.0), m.dark);
  stripe.position.set(0, 0.5, 0);
  car.add(stripe);
  // A little spoiler on the hatch: it's the sporty one.
  const spoiler = new Mesh(new BoxGeometry(1.6, 0.08, 0.3), m.dark);
  spoiler.position.set(0, 1.25, -1.9);
  car.add(spoiler);
  lights(car, m, 0.7, 2.06, -2.06, 0.62);
  const wheels = wheelSet(car, m.dark, 0.38, 0.32, 0.9, [1.35, -1.3]);
  shadow(car, 0.85, 1.55);
  return { car, wheels, mats: [m.paint, m.dark, m.glass, m.chrome] };
}

/** The Tarpan pick-up: tall, square and on big wheels, with a load bed behind the cab. */
function tarpan(m: Parts): CarModel {
  const car = new Group();
  const chassis = new Mesh(new BoxGeometry(1.9, 0.5, 3.9), m.paint);
  chassis.position.y = 0.95;
  car.add(chassis);
  const cab = new Mesh(taper(1.85, 0.95, 1.6, 0.8, 1, 0.95), m.paint);
  cab.position.set(0, 1.65, 0.75);
  car.add(cab);
  const screen = new Mesh(new BoxGeometry(1.6, 0.5, 0.08), m.glass);
  screen.position.set(0, 1.78, 1.5);
  screen.rotation.x = -0.25;
  car.add(screen);
  for (const sx of [-0.93, 0.93]) {
    const win = new Mesh(new BoxGeometry(0.05, 0.42, 0.9), m.glass);
    win.position.set(sx, 1.8, 0.7);
    car.add(win);
  }
  // Load bed: three low sides around a dark floor.
  const floor = new Mesh(new BoxGeometry(1.8, 0.06, 1.8), m.dark);
  floor.position.set(0, 1.22, -0.95);
  car.add(floor);
  for (const [x, z, w, l] of [
    [-0.9, -0.95, 0.1, 1.8],
    [0.9, -0.95, 0.1, 1.8],
    [0, -1.85, 1.9, 0.1],
  ]) {
    const side = new Mesh(new BoxGeometry(w, 0.42, l), m.paint);
    side.position.set(x, 1.42, z);
    car.add(side);
  }
  const bar = new Mesh(new BoxGeometry(1.7, 0.1, 0.1), m.chrome);
  bar.position.set(0, 2.18, 0.5);
  car.add(bar);
  const bull = new Mesh(new BoxGeometry(1.7, 0.4, 0.12), m.chrome);
  bull.position.set(0, 0.85, 2.0);
  car.add(bull);
  lights(car, m, 1.05, 1.96, -1.96, 0.66);
  const wheels = wheelSet(car, m.dark, 0.52, 0.42, 0.88, [1.25, -1.25]);
  shadow(car, 0.85, 1.5);
  return { car, wheels, mats: [m.paint, m.dark, m.glass, m.chrome] };
}

/** A car of the given kind in the given paint. */
export function buildKart(kind: KartId | undefined, color: string): CarModel {
  const m = parts(color);
  switch (kind) {
    case 'syrenka':
      return syrenka(m);
    case 'polonez':
      return polonez(m);
    case 'tarpan':
      return tarpan(m);
    default:
      return maluch(m);
  }
}
