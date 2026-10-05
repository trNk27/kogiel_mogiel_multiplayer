/** A small top-down map of a track: road, tunnel, river and bridges, with a dot per car. */
import type { Track } from './track';

export interface MapDot {
  x: number;
  z: number;
  color: string;
  /** Drawn bigger, with a ring, on top. */
  me?: boolean;
}

export class Minimap {
  private base: HTMLCanvasElement;
  private s = 1;
  private ox = 0;
  private oz = 0;

  constructor(
    readonly track: Track,
    readonly size: number,
    /** Line width of the road, in map pixels. */
    private road = Math.max(4, size / 45),
  ) {
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = size;
    this.paint();
  }

  private paint() {
    const t = this.track;
    const W = this.size;
    const ctx = this.base.getContext('2d')!;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < t.n; i++) {
      minX = Math.min(minX, t.xs[i]);
      maxX = Math.max(maxX, t.xs[i]);
      minZ = Math.min(minZ, t.zs[i]);
      maxZ = Math.max(maxZ, t.zs[i]);
    }
    const pad = W * 0.1;
    const s = Math.min((W - 2 * pad) / (maxX - minX), (W - 2 * pad) / (maxZ - minZ));
    this.s = s;
    this.ox = W / 2 - ((minX + maxX) / 2) * s;
    this.oz = W / 2 - ((minZ + maxZ) / 2) * s;
    const X = (x: number) => this.ox + x * s;
    const Z = (z: number) => this.oz + z * s;
    ctx.clearRect(0, 0, W, W);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // The river, clipped to the map.
    const r = t.river;
    if (r) {
      ctx.strokeStyle = 'rgba(79,157,255,.75)';
      ctx.lineWidth = Math.max(3, r.half * 2 * s);
      ctx.beginPath();
      const far = 4000;
      ctx.moveTo(X(r.x0 - r.dx * far), Z(r.z0 - r.dz * far));
      ctx.lineTo(X(r.x0 + r.dx * far), Z(r.z0 + r.dz * far));
      ctx.stroke();
    }

    const path = (from = 0, len = t.n) => {
      ctx.beginPath();
      for (let k = 0; k <= len; k++) {
        const j = (from + k) % t.n;
        if (k === 0) ctx.moveTo(X(t.xs[j]), Z(t.zs[j]));
        else ctx.lineTo(X(t.xs[j]), Z(t.zs[j]));
      }
    };
    path();
    ctx.strokeStyle = 'rgba(20,6,10,.75)';
    ctx.lineWidth = this.road * 2.2;
    ctx.stroke();
    path();
    ctx.strokeStyle = '#fff4dc';
    ctx.lineWidth = this.road;
    ctx.stroke();
    // The tunnel: a dark dashed stretch under a hill.
    if (t.tunnel) {
      path(t.tunnel.from, t.tunnel.len);
      ctx.strokeStyle = 'rgba(95,140,60,.9)';
      ctx.lineWidth = this.road * 2.6;
      ctx.stroke();
      path(t.tunnel.from, t.tunnel.len);
      ctx.strokeStyle = '#3a3036';
      ctx.lineWidth = this.road;
      ctx.setLineDash([this.road, this.road * 0.8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Bridges: the raised road drawn again on top, with dark edges.
    const bridges: { from: number; len: number }[] = [];
    if (r) bridges.push(...r.bridges);
    if (t.crossing) {
      let from = t.crossing.over;
      while (t.bridge[(from - 1 + t.n) % t.n]) from = (from - 1 + t.n) % t.n;
      let len = 0;
      while (t.bridge[(from + len) % t.n] && len < t.n) len++;
      bridges.push({ from, len });
    }
    for (const b of bridges) {
      path(b.from, b.len);
      ctx.strokeStyle = '#2a120a';
      ctx.lineWidth = this.road * 2;
      ctx.lineCap = 'butt';
      ctx.stroke();
      path(b.from, b.len);
      ctx.strokeStyle = '#fff4dc';
      ctx.lineWidth = this.road;
      ctx.stroke();
      ctx.lineCap = 'round';
    }
    // Start line.
    const k = 14;
    ctx.strokeStyle = '#e8335a';
    ctx.lineWidth = Math.max(2, this.road * 0.7);
    ctx.beginPath();
    ctx.moveTo(X(t.xs[0] + t.tz[0] * k), Z(t.zs[0] - t.tx[0] * k));
    ctx.lineTo(X(t.xs[0] - t.tz[0] * k), Z(t.zs[0] + t.tx[0] * k));
    ctx.stroke();
  }

  draw(ctx: CanvasRenderingContext2D, dots: MapDot[]) {
    const W = this.size;
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(this.base, 0, 0);
    const r = Math.max(3, this.road * 0.9);
    for (const d of [...dots].sort((a, b) => Number(!!a.me) - Number(!!b.me))) {
      const x = this.ox + d.x * this.s;
      const z = this.oz + d.z * this.s;
      ctx.beginPath();
      ctx.arc(x, z, d.me ? r * 1.5 : r, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = d.me ? r * 0.6 : r * 0.45;
      ctx.strokeStyle = d.me ? '#fff4dc' : '#2a120a';
      ctx.stroke();
    }
  }
}
