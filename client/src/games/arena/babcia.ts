/**
 * Babcia for the arena games: a big pierogi in a red polka-dot headscarf, with rosy cheeks and little
 * glasses. Grzybki puts her in a boat; Skakanka has two of them turning the rope; Babcia Mówi has her
 * calling the flags.
 */
import { Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, TorusGeometry } from 'three';
import { buildPierogi, flat, type PierogiModel } from './kit';

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** The dough colour of a babcia. */
export const BABCIA_DOUGH = '#f4d9b5';

/** Put the headscarf, cheeks and glasses on a pierogi model's body. */
export function dressBabcia(b: PierogiModel, keep: Keep, scarfColor = '#cf3a2c') {
  const scarfMat = keep(flat(scarfColor));
  // A headscarf: a thick band round the top of the dumpling, knotted under the chin.
  const scarf = new Mesh(keep(new TorusGeometry(0.8, 0.17, 5, 16, Math.PI * 0.82)), scarfMat);
  scarf.rotation.z = Math.PI / 2 - Math.PI * 0.41;
  scarf.scale.z = 1.5;
  scarf.position.set(0, 0, 0.02);
  const knot = new Mesh(keep(new SphereGeometry(0.2, 6, 4)), scarfMat);
  knot.position.set(0.62, 0.22, 0.12);
  const knot2 = knot.clone();
  knot2.position.set(-0.62, 0.22, 0.12);
  const flap = new Mesh(keep(new SphereGeometry(0.17, 5, 3)), scarfMat);
  flap.position.set(0.7, 0.05, 0.12);
  flap.scale.set(0.8, 1.4, 0.8);
  const flap2 = flap.clone();
  flap2.position.set(-0.7, 0.05, 0.12);
  const dotMat = keep(new MeshBasicMaterial({ color: '#fff0d0' }));
  const dotGeo = keep(new SphereGeometry(0.07, 5, 3));
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 - Math.PI * 0.35 + (k / 5) * Math.PI * 0.7;
    const d = new Mesh(dotGeo, dotMat);
    d.position.set(Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0.3);
    b.body.add(d);
  }
  // Rosy cheeks and little glasses.
  const cheekMat = keep(new MeshBasicMaterial({ color: '#f09a8a' }));
  const cheekGeo = keep(new SphereGeometry(0.1, 5, 3));
  for (const x of [-0.42, 0.42]) {
    const c = new Mesh(cheekGeo, cheekMat);
    c.position.set(x, 0.2, 0.3);
    c.scale.z = 0.4;
    b.body.add(c);
  }
  const glassMat = keep(new MeshBasicMaterial({ color: '#7a5a2a' }));
  const glassGeo = keep(new RingGeometry(0.15, 0.2, 10));
  for (const x of [-0.24, 0.24]) {
    const r = new Mesh(glassGeo, glassMat);
    r.position.set(x, 0.42, 0.34);
    b.body.add(r);
  }
  b.body.add(flap, flap2);
  b.body.add(scarf, knot, knot2);
}

/** A ready-dressed babcia. */
export function buildBabcia(keep: Keep, scarfColor?: string): PierogiModel {
  const b = buildPierogi(BABCIA_DOUGH);
  b.mats.forEach((m) => keep(m));
  dressBabcia(b, keep, scarfColor);
  return b;
}
