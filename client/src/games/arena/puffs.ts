/** A pool of little low-poly puffs (flour, dust, smoke, sparks, splashes) for the arena games. */
import { Color, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';

interface Puff {
  active: boolean;
  p: Vector3;
  v: Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
}

/** Drawn as one InstancedMesh. `gravity` pulls them down (m/s²; negative floats them up); `drag` slows them (1/s). */
export class Puffs {
  readonly mesh: InstancedMesh;
  private puffs: Puff[];
  private m = new Matrix4();
  private q = new Quaternion();
  private s = new Vector3();
  private c = new Color();
  private next = 0;

  constructor(
    count: number,
    private gravity = 2,
    private drag = 2.2,
  ) {
    const geo = new IcosahedronGeometry(0.5, 0);
    const mat = new MeshBasicMaterial({ color: '#ffffff' });
    this.mesh = new InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(35048);
    this.puffs = Array.from({ length: count }, () => ({ active: false, p: new Vector3(), v: new Vector3(), life: 0, max: 1, size: 1, grow: 0 }));
    for (let i = 0; i < count; i++) {
      this.mesh.setColorAt(i, this.c.set('#ffffff'));
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: string, grow = 1.5) {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % this.puffs.length;
    p.active = true;
    p.p.set(x, y, z);
    p.v.set(vx, vy, vz);
    p.life = p.max = life;
    p.size = size;
    p.grow = grow;
    this.mesh.setColorAt(this.puffs.indexOf(p), this.c.set(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    this.puffs.forEach((p, i) => {
      if (!p.active) return;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        return;
      }
      p.v.multiplyScalar(Math.exp(-this.drag * dt));
      p.v.y -= this.gravity * dt;
      p.p.addScaledVector(p.v, dt);
      const k = p.life / p.max;
      const sz = p.size * (1 + (1 - k) * p.grow) * Math.min(1, k * 2.2);
      this.s.set(sz, sz * 0.8, sz);
      this.m.compose(p.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
