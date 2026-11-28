/**
 * The 3D flat for Spacer z Bają: Baja's minimal, sunlit, L-shaped flat, seen first-person. You come in
 * from a plain white landing, walk the long room (paintings, bookcase, sofa on the left; windows, kitchen
 * and the bathroom and bedroom doors on the right) while Baja trots towards you with her green dragon,
 * then turn left at the far end out onto the next landing. Every anomaly is a small change built in here.
 *
 * Coordinates: metres, y up. The room runs from z = 0 to z = -len along x = 0.
 */
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PMREMGenerator,
  PointLight,
  MeshStandardMaterial,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { buildBaja, type BajaModel } from "../arena/baja3d";
import type { AnomalyId } from "./logic";

export const HALF_W = 3.2;
/** The landing you walk along before turning into the flat. */
export const LEG_A = 8;
export const EYE = 1.6;
const DOOR_HALF = 1.1;

export function passageLength(a: AnomalyId | null) {
  return a === "longRoom" ? 32 : 24;
}

/** Where the walk stops for the vote: just before the far corner. */
export function walkEnd(a: AnomalyId | null) {
  return LEG_A + passageLength(a) - 1.4;
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Camera position and heading after walking `s` metres (past the end it turns the far corner). */
export function poseAt(
  s: number,
  len: number,
): { x: number; z: number; yaw: number } {
  let x: number;
  let z: number;
  if (s <= LEG_A) {
    x = LEG_A - s;
    z = 0;
  } else if (s <= LEG_A + len) {
    x = 0;
    z = -(s - LEG_A);
  } else {
    x = -(s - LEG_A - len);
    z = -len;
  }
  // Ease the heading round both corners (π/2 looks along -x, 0 along -z).
  const c1 = smooth((s - (LEG_A - 1.8)) / 3.6);
  const c2 = smooth((s - (LEG_A + len - 1.8)) / 3.6);
  const yaw = (Math.PI / 2) * (1 - c1) + (Math.PI / 2) * c2;
  return { x, z, yaw };
}

// ---- textures ----------------------------------------------------------------------

function canvasTex(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
  repeat?: [number, number],
) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

/** Seeded random so every loop's flat looks exactly the same. */
function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t * 1664525 + 1013904223) % 4294967296;
    return t / 4294967296;
  };
}

/** Oak floorboards with grain, knots and seams. */
function woodTex(repeat: [number, number]) {
  return canvasTex(
    1024,
    1024,
    (ctx) => {
      const r = rng(7);
      const plank = 1024 / 8;
      for (let i = 0; i < 8; i++) {
        const tone = 178 + Math.floor(r() * 34);
        const offs = Math.floor(r() * 1024);
        for (const x0 of [-offs, 1024 - offs]) {
          ctx.fillStyle = `rgb(${tone},${Math.round(tone * 0.72)},${Math.round(tone * 0.46)})`;
          ctx.fillRect(x0, i * plank, 1024, plank);
        }
        // Grain.
        for (let g = 0; g < 60; g++) {
          const y = i * plank + r() * plank;
          ctx.strokeStyle = `rgba(${90 + r() * 40},${55 + r() * 20},${25},${0.08 + r() * 0.12})`;
          ctx.lineWidth = 1 + r() * 2;
          ctx.beginPath();
          ctx.moveTo(0, y);
          for (let x = 0; x <= 1024; x += 64)
            ctx.lineTo(x, y + Math.sin(x * 0.01 + g) * 3 * r());
          ctx.stroke();
        }
        if (r() < 0.6) {
          ctx.fillStyle = "rgba(90,55,25,.35)";
          ctx.beginPath();
          ctx.ellipse(
            r() * 1024,
            i * plank + plank / 2,
            10 + r() * 8,
            5,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        // Seams.
        ctx.fillStyle = "rgba(60,35,15,.55)";
        ctx.fillRect(0, i * plank, 1024, 3);
        ctx.fillRect((offs + 512) % 1024, i * plank, 3, plank);
      }
    },
    repeat,
  );
}

/** Faint painted plaster. */
function plasterTex(repeat: [number, number]) {
  return canvasTex(
    256,
    256,
    (ctx) => {
      const r = rng(3);
      ctx.fillStyle = "#f6f3ed";
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1400; i++) {
        const v = 225 + Math.floor(r() * 30);
        ctx.fillStyle = `rgba(${v},${v - 3},${v - 8},.35)`;
        ctx.fillRect(r() * 256, r() * 256, 2 + r() * 3, 2 + r() * 3);
      }
    },
    repeat,
  );
}

/** Woven fabric for the sofa and cushions. */
function fabricTex(base: string, repeat: [number, number]) {
  return canvasTex(
    128,
    128,
    (ctx) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 4)
        for (let x = 0; x < 128; x += 4) {
          ctx.fillStyle =
            (x + y) % 8 ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.08)";
          ctx.fillRect(x, y, 4, 2);
        }
    },
    repeat,
  );
}

/** A patterned rug with a border. */
function rugTex(base: string) {
  return canvasTex(512, 640, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 640);
    ctx.strokeStyle = "rgba(255,240,210,.85)";
    ctx.lineWidth = 14;
    ctx.strokeRect(30, 30, 452, 580);
    ctx.lineWidth = 5;
    ctx.strokeRect(58, 58, 396, 524);
    ctx.fillStyle = "rgba(255,240,210,.5)";
    for (let y = 110; y < 560; y += 70)
      for (let x = 110; x < 420; x += 70) {
        ctx.beginPath();
        ctx.moveTo(x, y - 18);
        ctx.lineTo(x + 18, y);
        ctx.lineTo(x, y + 18);
        ctx.lineTo(x - 18, y);
        ctx.fill();
      }
  });
}

const BOOKS: [string, string, string][] = [
  ["Pan Tadeusz", "#7a1f1f", "#f2d49b"],
  ["Lalka", "#1f3f6a", "#ffffff"],
  ["Quo Vadis", "#2a2a2a", "#e8c35a"],
  ["Solaris", "#2f6fb3", "#ffffff"],
  ["Wiedźmin", "#3d3d3d", "#d63a3a"],
  ["Baja: Biografia", "#cf7328", "#ffffff"],
  ["Pierogi na 100 sposobów", "#f2c14e", "#5a2a0a"],
  ["Kogiel Mogiel", "#c0392b", "#ffffff"],
  ["Ferdydurke", "#5bb55b", "#1d1d1d"],
  ["Chłopi", "#6b4a2a", "#f4e6c8"],
  ["Jak wytresować psa", "#7b4f9d", "#ffffff"],
  ["Atlas świata", "#1d5e4a", "#f2d49b"],
  ["Ogniem i mieczem", "#4a1010", "#e8c35a"],
  ["Kuchnia polska", "#e56b4f", "#ffffff"],
  ["Mały Książę", "#9fd3f0", "#1f3f6a"],
  ["Dziady", "#1d1d1d", "#c9c2b6"],
];

/** A book spine with its title, read bottom to top. */
function spineTex(title: string, bg: string, fg: string) {
  return canvasTex(96, 512, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 96, 512);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(0, 0, 18, 512);
    ctx.fillStyle = fg;
    ctx.fillRect(0, 40, 96, 6);
    ctx.fillRect(0, 466, 96, 6);
    ctx.save();
    ctx.translate(52, 256);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `700 ${title.length > 16 ? 30 : 40}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, 0, 0, 400);
    ctx.restore();
  });
}

function textTex(
  text: string,
  w: number,
  h: number,
  bg: string,
  fg: string,
  font: string,
  border?: string,
) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = h * 0.08;
      ctx.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08);
    }
    ctx.fillStyle = fg;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + h * 0.04);
  });
}

type PaintingKind =
  "landscape" | "portrait" | "empty" | "abstract" | "baja" | "flowers";

function paintingTex(kind: PaintingKind, pupils = true) {
  return canvasTex(300, 380, (ctx) => {
    if (kind === "landscape") {
      const g = ctx.createLinearGradient(0, 0, 0, 380);
      g.addColorStop(0, "#8fd0f0");
      g.addColorStop(1, "#e8f6ff");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 300, 380);
      ctx.fillStyle = "#ffd54a";
      ctx.beginPath();
      ctx.arc(220, 90, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6aa84f";
      ctx.beginPath();
      ctx.moveTo(0, 260);
      ctx.quadraticCurveTo(90, 170, 170, 250);
      ctx.quadraticCurveTo(240, 200, 300, 240);
      ctx.lineTo(300, 380);
      ctx.lineTo(0, 380);
      ctx.fill();
      ctx.fillStyle = "#3d7a34";
      ctx.fillRect(60, 220, 10, 50);
      ctx.beginPath();
      ctx.arc(65, 210, 26, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "portrait" || kind === "empty") {
      ctx.fillStyle = "#5b3a5e";
      ctx.fillRect(0, 0, 300, 380);
      ctx.fillStyle = "#7b5a7e";
      ctx.fillRect(20, 20, 260, 340);
      if (kind === "portrait") {
        // Babcia Pierogi in a headscarf.
        ctx.fillStyle = "#c0392b";
        ctx.beginPath();
        ctx.ellipse(150, 170, 92, 100, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = "#f2d49b";
        ctx.beginPath();
        ctx.ellipse(150, 200, 78, 86, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(120, 192, 16, 0, Math.PI * 2);
        ctx.arc(180, 192, 16, 0, Math.PI * 2);
        ctx.fill();
        if (pupils) {
          ctx.fillStyle = "#1a0905";
          ctx.beginPath();
          ctx.arc(120, 195, 8, 0, Math.PI * 2);
          ctx.arc(180, 195, 8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "#7a3a1a";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(150, 228, 22, 0.2, Math.PI - 0.2);
        ctx.stroke();
        ctx.fillStyle = "#2f5d8a";
        ctx.fillRect(70, 290, 160, 70);
      }
    } else if (kind === "abstract") {
      ctx.fillStyle = "#f4efe6";
      ctx.fillRect(0, 0, 300, 380);
      ctx.fillStyle = "#e8a33a";
      ctx.fillRect(30, 40, 140, 160);
      ctx.fillStyle = "#2f6fb3";
      ctx.fillRect(130, 160, 140, 180);
      ctx.fillStyle = "#d63a3a";
      ctx.beginPath();
      ctx.arc(90, 280, 50, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "flowers") {
      ctx.fillStyle = "#eef5e8";
      ctx.fillRect(0, 0, 300, 380);
      ctx.fillStyle = "#6aa84f";
      ctx.fillRect(146, 150, 8, 200);
      for (const [x, y, c] of [
        [150, 140, "#ff5c8a"],
        [100, 200, "#ffd23f"],
        [200, 190, "#b779d9"],
      ] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 34, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Baja's portrait.
      ctx.fillStyle = "#9fd3f0";
      ctx.fillRect(0, 0, 300, 380);
      ctx.fillStyle = "#cf7328";
      ctx.beginPath();
      ctx.moveTo(70, 160);
      ctx.lineTo(90, 60);
      ctx.lineTo(130, 130);
      ctx.moveTo(230, 160);
      ctx.lineTo(210, 60);
      ctx.lineTo(170, 130);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(150, 200, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff9f0";
      ctx.beginPath();
      ctx.ellipse(150, 238, 48, 42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(140, 120, 20, 100);
      ctx.fillStyle = "#1a0905";
      ctx.beginPath();
      ctx.arc(115, 190, 12, 0, Math.PI * 2);
      ctx.arc(185, 190, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(150, 228, 14, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function windowTex(night: boolean, shadow: boolean) {
  return canvasTex(256, 320, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 320);
    if (night) {
      g.addColorStop(0, "#0b1030");
      g.addColorStop(1, "#1d2550");
    } else {
      g.addColorStop(0, "#7cc6f2");
      g.addColorStop(1, "#d8f0ff");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 320);
    if (night) {
      ctx.fillStyle = "#f4f1d0";
      ctx.beginPath();
      ctx.arc(190, 70, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      for (let i = 0; i < 20; i++)
        ctx.fillRect((i * 53) % 256, (i * 37) % 200, 2, 2);
    } else {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(70, 80, 50, 18, 0, 0, Math.PI * 2);
      ctx.ellipse(110, 70, 40, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // A tree and the block across the road.
    ctx.fillStyle = night ? "#1b2a20" : "#5b9a4a";
    ctx.beginPath();
    ctx.arc(60, 250, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = night ? "#252a3a" : "#e7d7c0";
    ctx.fillRect(140, 190, 116, 130);
    ctx.fillStyle = night ? "#ffd27a" : "#9fc6e0";
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        ctx.fillRect(152 + c * 34, 204 + r * 36, 20, 22);
    if (shadow) {
      ctx.fillStyle = "rgba(10,10,14,.92)";
      ctx.beginPath();
      ctx.arc(128, 120, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(70, 320);
      ctx.quadraticCurveTo(80, 160, 128, 156);
      ctx.quadraticCurveTo(176, 160, 186, 320);
      ctx.fill();
    }
  });
}

function handprintTex() {
  return canvasTex(256, 320, (ctx) => {
    ctx.clearRect(0, 0, 256, 320);
    ctx.fillStyle = "rgba(120,90,80,.55)";
    for (const [x, y, r] of [
      [70, 120, -0.3],
      [170, 150, 0.2],
      [110, 230, 0.1],
    ] as const) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r);
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let f = 0; f < 5; f++) {
        ctx.beginPath();
        ctx.ellipse(
          -20 + f * 10,
          -36 - (f === 2 ? 6 : 0),
          4.5,
          13,
          (f - 2) * 0.15,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  });
}

function writingTex() {
  return canvasTex(512, 220, (ctx) => {
    ctx.clearRect(0, 0, 512, 220);
    ctx.translate(256, 120);
    ctx.rotate(-0.08);
    ctx.font = '900 150px "Comic Sans MS", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#9b111e";
    ctx.fillText("WRÓĆ", 0, 0);
    ctx.fillRect(-150, 50, 6, 60);
    ctx.fillRect(40, 54, 5, 46);
    ctx.fillRect(150, 48, 6, 70);
  });
}

function clockTex() {
  return canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.fillStyle = "#2a2a2a";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillRect(
        128 + Math.sin(a) * 100 - 4,
        128 - Math.cos(a) * 100 - 4,
        8,
        8,
      );
    }
  });
}

// ---- models -------------------------------------------------------------------

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** Baja's green plush dragon. At `scale` 1 it's about 0.5 m long (the toy); bigger, it walks. */
function buildDragon(k: Keep, scale = 1) {
  const root = new Group();
  const body = new Group();
  const green = k(new MeshLambertMaterial({ color: "#43b047" }));
  const belly = k(new MeshLambertMaterial({ color: "#c6ec7a" }));
  const spike = k(new MeshLambertMaterial({ color: "#ffd23f" }));
  const eye = k(new MeshBasicMaterial({ color: "#111" }));
  const torso = new Mesh(k(new SphereGeometry(0.16, 12, 10)), green);
  torso.scale.set(0.9, 0.85, 1.35);
  torso.position.y = 0.2;
  const tummy = new Mesh(k(new SphereGeometry(0.12, 10, 8)), belly);
  tummy.scale.set(0.8, 0.8, 1.2);
  tummy.position.set(0, 0.16, 0.06);
  const head = new Group();
  head.position.set(0, 0.34, 0.2);
  head.add(new Mesh(k(new SphereGeometry(0.11, 12, 10)), green));
  const snout = new Mesh(k(new SphereGeometry(0.07, 10, 8)), belly);
  snout.position.set(0, -0.03, 0.09);
  head.add(snout);
  for (const sx of [-1, 1]) {
    const e = new Mesh(k(new SphereGeometry(0.02, 6, 6)), eye);
    e.position.set(sx * 0.05, 0.03, 0.09);
    head.add(e);
    const horn = new Mesh(k(new ConeGeometry(0.025, 0.08, 6)), spike);
    horn.position.set(sx * 0.05, 0.11, -0.02);
    head.add(horn);
    const wing = new Mesh(k(new ConeGeometry(0.08, 0.16, 3)), green);
    wing.position.set(sx * 0.14, 0.3, -0.02);
    wing.rotation.z = sx * -1.1;
    body.add(wing);
  }
  for (let i = 0; i < 4; i++) {
    const sp = new Mesh(k(new ConeGeometry(0.03, 0.07, 5)), spike);
    sp.position.set(0, 0.34 - i * 0.03, 0.04 - i * 0.09);
    body.add(sp);
  }
  const tail = new Mesh(k(new ConeGeometry(0.07, 0.3, 8)), green);
  tail.rotation.x = -Math.PI / 2 - 0.3;
  tail.position.set(0, 0.16, -0.32);
  const legs: Mesh[] = [];
  for (const [lx, lz] of [
    [-0.09, 0.1],
    [0.09, 0.1],
    [-0.09, -0.12],
    [0.09, -0.12],
  ]) {
    const leg = new Mesh(k(new CylinderGeometry(0.04, 0.045, 0.12, 6)), green);
    leg.position.set(lx, 0.06, lz);
    body.add(leg);
    legs.push(leg);
  }
  body.add(torso, tummy, head, tail);
  root.add(body);
  root.scale.setScalar(scale);
  return { root, body, head, legs };
}

/** A tall, dark, thin figure with pale eyes. */
function buildFigure(k: Keep, scale = 1) {
  const root = new Group();
  const black = k(new MeshLambertMaterial({ color: "#0c0b10" }));
  const eye = k(new MeshBasicMaterial({ color: "#e8f0ff" }));
  const torso = new Mesh(k(new CylinderGeometry(0.17, 0.24, 1.25, 10)), black);
  torso.position.y = 1.25;
  const head = new Mesh(k(new SphereGeometry(0.17, 12, 10)), black);
  head.scale.set(0.9, 1.2, 0.9);
  head.position.y = 2.05;
  for (const sx of [-1, 1]) {
    const e = new Mesh(k(new SphereGeometry(0.025, 6, 6)), eye);
    e.position.set(sx * 0.06, 2.08, 0.14);
    root.add(e);
    const arm = new Mesh(k(new CylinderGeometry(0.04, 0.035, 1.1, 6)), black);
    arm.position.set(sx * 0.26, 1.2, 0);
    arm.rotation.z = sx * 0.08;
    root.add(arm);
    const leg = new Mesh(k(new CylinderGeometry(0.06, 0.05, 0.7, 6)), black);
    leg.position.set(sx * 0.1, 0.35, 0);
    root.add(leg);
  }
  root.add(torso, head);
  root.scale.setScalar(scale);
  return root;
}

// ---- the scene ---------------------------------------------------------------------

interface Walker {
  root: Object3D;
  body: Object3D;
  head: Object3D;
  legs: Object3D[];
  tail?: Object3D;
  ears?: Object3D[];
  offset: number;
}

export class Flat {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly len: number;
  readonly height: number;
  private disposables: { dispose(): void }[] = [];
  private keep: Keep = (x) => {
    this.disposables.push(x);
    return x;
  };
  private bulbs: MeshBasicMaterial[] = [];
  private ambient!: AmbientLight;
  private hemi!: HemisphereLight;
  private walkers: Walker[] = [];
  private dogZ = 0;
  private started = false;
  private pupils: Mesh[] = [];
  private pupilZ = 0;
  private swing: Object3D | null = null;
  private second: Object3D | null = null;
  private t = 0;
  private composer: EffectComposer | null = null;
  private lamps: PointLight[] = [];
  private slow = 0;

  constructor(
    canvas: HTMLCanvasElement,
    readonly a: AnomalyId | null,
    readonly level: number,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(1440, 810, false);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.len = passageLength(a);
    this.height = a === "ceilingLow" ? 2.3 : 2.9;
    this.scene.background = new Color("#f6f3ee");
    // Soft light bouncing round a white room, for realistic shading and reflections.
    const pmrem = new PMREMGenerator(this.renderer);
    const env = this.keep(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
    pmrem.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = a === "lightsOut" ? 0.12 : 0.75;
    this.camera = new PerspectiveCamera(68, 16 / 9, 0.05, 120);
    this.build();
    this.realistic();
    // Ambient occlusion: soft dark corners where things meet the floor and walls.
    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setSize(1440, 810);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const ao = new GTAOPass(this.scene, this.camera, 1440, 810);
      ao.updateGtaoMaterial({
        radius: 0.5,
        distanceExponent: 1.5,
        thickness: 1,
        scale: 1.2,
      });
      ao.blendIntensity = 0.9;
      this.composer.addPass(ao);
      this.composer.addPass(new OutputPass());
    } catch {
      this.composer = null;
    }
  }

  dispose() {
    this.composer?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.dispose();
  }

  private mesh(
    geo: ConstructorParameters<typeof Mesh>[0],
    mat: Material,
    x: number,
    y: number,
    z: number,
    parent: Object3D = this.scene,
  ) {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private lambert(c: string) {
    return this.keep(new MeshLambertMaterial({ color: c }));
  }

  /** A flat wall from (x1,z1) to (x2,z2). */
  private wall(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    mat: Material,
    y0 = 0,
    y1 = this.height,
  ) {
    const w = Math.hypot(x2 - x1, z2 - z1);
    const m = new Mesh(this.keep(new PlaneGeometry(w, y1 - y0)), mat);
    m.position.set((x1 + x2) / 2, (y0 + y1) / 2, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
    this.scene.add(m);
    return m;
  }

  /** A flat thing hung on the left wall (x = -W) facing into the room, or the right wall facing in. */
  private onWall(
    side: "left" | "right",
    z: number,
    y: number,
    w: number,
    h: number,
    mat: Material,
    out = 0.02,
  ) {
    const W = HALF_W;
    const m = this.mesh(
      this.keep(new PlaneGeometry(w, h)),
      mat,
      side === "left" ? -W + out : W - out,
      y,
      z,
    );
    m.rotation.y = side === "left" ? Math.PI / 2 : -Math.PI / 2;
    return m;
  }

  private build() {
    const a = this.a;
    const H = this.height;
    const L = this.len;
    const W = HALF_W;
    const k = this.keep;
    const dim = a === "lightsOut";

    // Daylight: sun streaming in from the window side, soft fill from the room around it.
    this.ambient = new AmbientLight("#ffffff", dim ? 0.05 : 0.25);
    this.hemi = new HemisphereLight("#fffaf0", "#c9b9a0", dim ? 0.05 : 0.55);
    const sun = new DirectionalLight("#fff0d0", dim ? 0.1 : 2.4);
    sun.position.set(9, 11, -6);
    sun.target.position.set(0, 0, -L / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -L / 2 - 6;
    sun.shadow.camera.right = L / 2 + 6;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 4;
    this.scene.add(this.ambient, this.hemi, sun, sun.target);
    if (dim) this.scene.background = new Color("#2a2730");

    const white = k(new MeshLambertMaterial({ map: k(plasterTex([6, 2])) }));
    const landingWall = this.lambert("#eef0f2");
    const base = this.lambert("#d9d2c6");

    // Floors: warm wood in the flat, grey on the landings.
    const floorMat = k(
      new MeshLambertMaterial({
        map: k(woodTex([(2 * W) / 2.6, (L + 2 * W) / 2.6])),
      }),
    );
    floorMat.userData.rough = 0.42;
    const wood = this.mesh(
      k(new PlaneGeometry(2 * W, L + 2 * W)),
      floorMat,
      0,
      0,
      -L / 2,
    );
    wood.rotation.x = -Math.PI / 2;
    const grey = this.lambert("#c9c7c2");
    for (const [x, z] of [
      [W + 4, 0],
      [-W - 4, -L],
    ]) {
      const f = this.mesh(
        k(new PlaneGeometry(8, 2 * DOOR_HALF)),
        grey,
        x,
        0,
        z,
      );
      f.rotation.x = -Math.PI / 2;
      const c = this.mesh(
        k(new PlaneGeometry(8, 2 * DOOR_HALF)),
        k(new MeshBasicMaterial({ color: "#f2f2f2" })),
        x,
        H,
        z,
      );
      c.rotation.x = Math.PI / 2;
    }
    const ceil = this.mesh(
      k(new PlaneGeometry(2 * W, L + 2 * W)),
      k(new MeshBasicMaterial({ color: dim ? "#3a3640" : "#f4f1ea" })),
      0,
      H,
      -L / 2,
    );
    ceil.rotation.x = Math.PI / 2;

    // The flat's walls, with a doorway in from the first landing and out to the next one.
    this.wall(-W, W, W, W, white); // behind you
    this.wall(W, W, W, DOOR_HALF, white);
    this.wall(W, -DOOR_HALF, W, -L - W, white); // right wall
    this.wall(-W, W, -W, -L + DOOR_HALF, white); // left wall
    this.wall(-W, -L - DOOR_HALF, -W, -L - W, white);
    this.wall(-W, -L - W, W, -L - W, white); // the far wall
    // Landings: plain, empty, slightly cooler white.
    this.wall(W, DOOR_HALF, W + 8, DOOR_HALF, landingWall);
    this.wall(W, -DOOR_HALF, W + 8, -DOOR_HALF, landingWall);
    this.wall(W + 8, -DOOR_HALF, W + 8, DOOR_HALF, landingWall);
    this.wall(-W - 8, -L + DOOR_HALF, -W, -L + DOOR_HALF, landingWall);
    this.wall(-W - 8, -L - DOOR_HALF, -W, -L - DOOR_HALF, landingWall);
    this.wall(-W - 8, -L - DOOR_HALF, -W - 8, -L + DOOR_HALF, landingWall);
    // Skirting boards.
    for (const x of [-W + 0.01, W - 0.01]) {
      const s = this.mesh(
        k(new PlaneGeometry(L + 2 * W, 0.1)),
        base,
        x,
        0.05,
        -L / 2,
      );
      s.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    // The yellow sign you see from the landing, across the room: which exit you're on.
    this.onWall(
      "left",
      0,
      2.05,
      1.8,
      0.58,
      k(
        new MeshBasicMaterial({
          map: k(
            textTex(
              `WYJŚCIE ${this.level}`,
              512,
              166,
              "#ffd21f",
              "#1d1d1d",
              "900 92px system-ui, sans-serif",
              "#1d1d1d",
            ),
          ),
        }),
      ),
    );

    this.buildLeft();
    this.buildRight();
    this.buildCeiling();
    this.buildBack();
    this.buildBaja();
  }

  private buildCeiling() {
    const a = this.a;
    const H = this.height;
    const k = this.keep;
    const dim = a === "lightsOut";
    [-5, -11.5, -18].forEach((z, i) => {
      const g = new Group();
      g.position.set(0, H, z);
      this.mesh(
        k(new CylinderGeometry(0.01, 0.01, 0.6, 4)),
        this.lambert("#333"),
        0,
        -0.3,
        0,
        g,
      );
      const shade = this.mesh(
        k(new ConeGeometry(0.3, 0.26, 20, 1, true)),
        k(new MeshLambertMaterial({ color: "#1f1f22", side: 2 })),
        0,
        -0.68,
        0,
        g,
      );
      shade.rotation.x = 0;
      const bulbMat = k(
        new MeshBasicMaterial({ color: dim ? "#4a4844" : "#fff7dc" }),
      );
      this.bulbs.push(bulbMat);
      const bulb = this.mesh(
        k(new CircleGeometry(0.27, 20)),
        bulbMat,
        0,
        -0.8,
        0,
        g,
      );
      bulb.rotation.x = Math.PI / 2;
      const glow = new PointLight("#ffe2b0", dim ? 0 : 3.5, 9, 1.6);
      glow.position.set(0, -0.95, 0);
      g.add(glow);
      this.lamps.push(glow);
      this.scene.add(g);
      if (a === "pendantSwing" && i === 1) this.swing = g;
    });
  }

  private buildLeft() {
    const a = this.a;
    const k = this.keep;
    const W = HALF_W;
    const frame = this.lambert("#2a2420");
    const hang = (
      z: number,
      kind: PaintingKind,
      w = 1.0,
      h = 1.26,
      upside = false,
      pupils = true,
    ) => {
      this.mesh(
        k(new BoxGeometry(0.04, h + 0.12, w + 0.12)),
        frame,
        -W + 0.02,
        1.65,
        z,
      );
      const p = this.onWall(
        "left",
        z,
        1.65,
        w,
        h,
        k(new MeshLambertMaterial({ map: k(paintingTex(kind, pupils)) })),
        0.042,
      );
      if (upside) p.rotation.z = Math.PI;
      return p;
    };
    hang(
      -3.5,
      a === "paintingBaja" ? "baja" : "landscape",
      1.2,
      0.9,
      a === "paintingUpside",
    );
    hang(
      -7,
      a === "emptyPortrait" ? "empty" : "portrait",
      0.9,
      1.15,
      false,
      a !== "portraitEyes",
    );
    hang(-10.5, "abstract", 1.0, 1.26);
    if (a === "extraPainting") hang(-12.4, "flowers", 0.6, 0.76);
    if (a === "portraitEyes") {
      this.pupilZ = -7;
      for (const dz of [-1, 1]) {
        const pu = this.mesh(
          k(new SphereGeometry(0.03, 10, 8)),
          k(new MeshBasicMaterial({ color: "#1a0905" })),
          -W + 0.06,
          1.65 + 1.15 * (0.5 - 195 / 380),
          -7 + dz * 0.18,
        );
        this.pupils.push(pu);
      }
    }
    if (a === "wallWriting")
      this.onWall(
        "left",
        -5.25,
        1.3,
        1.6,
        0.7,
        k(new MeshBasicMaterial({ map: k(writingTex()), transparent: true })),
        0.03,
      );

    // Bookcase.
    const bz = -14.8;
    const wood = this.lambert("#b58a5a");
    const bc = new Group();
    const spines = new Map<string, CanvasTexture>();
    const spineMap = (title: string, bg: string, fg: string) => {
      let t = spines.get(title);
      if (!t) {
        t = k(spineTex(title, bg, fg));
        spines.set(title, t);
      }
      return t;
    };
    bc.position.set(-W + 0.22, 0, bz);
    // An open-fronted case: back, sides and top, with shelves of books.
    this.mesh(
      k(new BoxGeometry(0.03, 2.1, 2.4)),
      this.lambert("#8a6a45"),
      -0.19,
      1.05,
      0,
      bc,
    );
    for (const dz of [-1.18, 1.18])
      this.mesh(k(new BoxGeometry(0.42, 2.1, 0.04)), wood, 0, 1.05, dz, bc);
    this.mesh(k(new BoxGeometry(0.42, 0.04, 2.4)), wood, 0, 2.08, 0, bc);
    const colors = [
      "#c0392b",
      "#2f6fb3",
      "#e8a33a",
      "#5bb55b",
      "#7b4f9d",
      "#e56b4f",
      "#2a2a2a",
      "#f2d49b",
    ];
    for (let row = 0; row < 5; row++) {
      this.mesh(
        k(new BoxGeometry(0.42, 0.04, 2.24)),
        wood,
        0.015,
        0.12 + row * 0.42,
        0,
        bc,
      );
      let z = -1.05;
      let i = 0;
      while (z < 1.0) {
        const w = 0.075 + ((i * 7 + row * 3) % 4) * 0.018;
        const h = 0.26 + ((i * 5 + row) % 3) * 0.04;
        const gapForEyes = a === "bookEyes" && row === 2 && z > -0.1 && z < 0.3;
        const fallen = a === "booksFallen" && row === 3 && z > -0.6 && z < 0.4;
        if (!gapForEyes && !fallen) {
          const [title, bg, fg] = BOOKS[(i * 5 + row * 7) % BOOKS.length];
          const cover = this.lambert(bg);
          const spine = k(
            new MeshLambertMaterial({ map: spineMap(title, bg, fg) }),
          );
          const pages = this.lambert("#f1e9d6");
          const b = new Mesh(k(new BoxGeometry(0.28, h, w)), [
            spine,
            pages,
            pages,
            pages,
            cover,
            cover,
          ]);
          b.position.set(0.06, 0.14 + row * 0.42 + h / 2, z + w / 2);
          bc.add(b);
          if (a === "bookOut" && row === 1 && i === 6) b.position.x += 0.18;
        }
        z += w + 0.006;
        i++;
      }
    }
    if (a === "bookEyes") {
      this.mesh(
        k(new BoxGeometry(0.05, 0.36, 0.4)),
        k(new MeshBasicMaterial({ color: "#050507" })),
        0.05,
        0.14 + 2 * 0.42 + 0.18,
        0.1,
        bc,
      );
      for (const dz of [-0.07, 0.07])
        this.mesh(
          k(new SphereGeometry(0.025, 8, 6)),
          k(new MeshBasicMaterial({ color: "#ffe14a" })),
          0.1,
          0.14 + 2 * 0.42 + 0.2,
          0.1 + dz,
          bc,
        );
    }
    if (a === "booksFallen")
      for (let i = 0; i < 7; i++) {
        const b = this.mesh(
          k(new BoxGeometry(0.28, 0.05, 0.2)),
          this.lambert(colors[i % colors.length]),
          -W + 0.9 + (i % 3) * 0.3,
          0.03 + Math.floor(i / 3) * 0.05,
          bz - 0.6 + i * 0.2,
        );
        b.rotation.y = i * 0.7;
      }
    this.scene.add(bc);

    // Rug, sofa and floor lamp.
    const rug = this.mesh(
      k(new PlaneGeometry(2.6, 3.2)),
      k(
        new MeshLambertMaterial({
          map: k(rugTex(a === "rugColour" ? "#2f5f9a" : "#a8432e")),
        }),
      ),
      -1.0,
      0.006,
      -19,
    );
    rug.rotation.x = -Math.PI / 2;
    const sofa = new Group();
    const fabric = k(
      new MeshLambertMaterial({ map: k(fabricTex("#5f84a8", [3, 3])) }),
    );
    fabric.userData.rough = 1;
    const soft = (w: number, h: number, d: number, r: number) =>
      k(new RoundedBoxGeometry(w, h, d, 5, r));
    // Base, back and arms, all rounded and padded.
    this.mesh(soft(0.92, 0.3, 2.4, 0.08), fabric, 0, 0.2, 0, sofa);
    this.mesh(soft(0.26, 0.82, 2.4, 0.1), fabric, -0.33, 0.52, 0, sofa);
    for (const dz of [-1.12, 1.12])
      this.mesh(soft(0.92, 0.62, 0.22, 0.1), fabric, 0, 0.31, dz, sofa);
    // Two puffy seat cushions and two back cushions.
    for (const dz of [-0.5, 0.5]) {
      const seat = this.mesh(
        soft(0.7, 0.2, 0.98, 0.09),
        fabric,
        0.06,
        0.44,
        dz,
        sofa,
      );
      seat.scale.y = 1;
      this.mesh(
        soft(0.24, 0.5, 0.96, 0.11),
        fabric,
        -0.15,
        0.72,
        dz,
        sofa,
      ).rotation.z = -0.12;
    }
    // Throw pillows: soft, rounded, tilted.
    const pillow = k(
      new MeshLambertMaterial({ map: k(fabricTex("#f0b840", [2, 2])) }),
    );
    pillow.userData.rough = 1;
    for (const [dz, rz] of [
      [-0.78, 0.35],
      [0.78, -0.35],
    ] as const) {
      const p = this.mesh(
        soft(0.16, 0.4, 0.4, 0.075),
        pillow,
        0.0,
        0.73,
        dz,
        sofa,
      );
      p.rotation.set(rz * 0.3, 0, -0.2);
      p.scale.set(1, 1, 1);
    }
    sofa.position.set(-W + 0.5, 0, -19);
    if (a === "sofaMoved") {
      sofa.rotation.y = Math.PI;
      sofa.position.x += 0.4;
    }
    this.scene.add(sofa);
    if (a === "sofaFigure") {
      const f = buildFigure(k, 0.8);
      f.position.set(-W + 0.6, -0.15, -19.3);
      f.rotation.y = Math.PI / 2;
      this.scene.add(f);
    }
    const lamp = new Group();
    this.mesh(
      k(new CylinderGeometry(0.16, 0.18, 0.04, 16)),
      this.lambert("#2a2a2a"),
      0,
      0.02,
      0,
      lamp,
    );
    this.mesh(
      k(new CylinderGeometry(0.015, 0.015, 1.5, 6)),
      this.lambert("#2a2a2a"),
      0,
      0.77,
      0,
      lamp,
    );
    this.mesh(
      k(new CylinderGeometry(0.17, 0.25, 0.32, 18, 1, true)),
      a === "lampOff" || a === "lightsOut"
        ? this.lambert("#8a8478")
        : k(new MeshBasicMaterial({ color: "#fff3cf", side: 2 })),
      0,
      1.6,
      0,
      lamp,
    );
    lamp.position.set(-W + 0.4, 0, -21.3);
    this.scene.add(lamp);
  }

  private buildRight() {
    const a = this.a;
    const k = this.keep;
    const W = HALF_W;
    const night = a === "nightWindow";
    // Two big windows with curtains, and sun on the floor.
    for (const z of [-3.6, -6.8]) {
      this.onWall("right", z, 1.6, 2.1, 1.85, this.lambert("#ffffff"), 0.01);
      this.onWall(
        "right",
        z,
        1.6,
        1.9,
        1.65,
        k(
          new MeshBasicMaterial({
            map: k(
              windowTex(
                night || a === "lightsOut",
                a === "windowShadow" && z === -6.8,
              ),
            ),
          }),
        ),
        0.02,
      );
      this.onWall("right", z, 1.6, 0.06, 1.65, this.lambert("#ffffff"), 0.03);
      if (a === "handprints" && z === -3.6)
        this.onWall(
          "right",
          z,
          1.6,
          1.9,
          1.65,
          k(
            new MeshBasicMaterial({
              map: k(handprintTex()),
              transparent: true,
            }),
          ),
          0.035,
        );
      const curtain = this.lambert("#e9dcc4");
      if (a === "curtainsClosed")
        this.onWall("right", z, 1.55, 2.2, 2.0, curtain, 0.08);
      else
        for (const dz of [-1.2, 1.2]) {
          const c = this.onWall("right", z + dz, 1.55, 0.4, 2.0, curtain, 0.08);
          c.scale.x = 1;
        }
      if (!night && a !== "curtainsClosed" && a !== "lightsOut") {
        const sunPatch = this.mesh(
          k(new PlaneGeometry(1.8, 2.0)),
          k(
            new MeshBasicMaterial({
              color: "#fff2b8",
              transparent: true,
              opacity: 0.45,
            }),
          ),
          W - 1.4,
          0.008,
          z - 0.3,
        );
        sunPatch.rotation.x = -Math.PI / 2;
        sunPatch.rotation.z = 0.25;
      }
    }

    // Kitchen: counter, stools, fridge, clock.
    const counter = this.lambert("#ffffff");
    counter.userData.rough = 0.35;
    const top = this.lambert("#4f4a46");
    top.userData.rough = 0.25;
    this.mesh(
      k(new BoxGeometry(0.65, 0.88, 3.6)),
      counter,
      W - 0.33,
      0.44,
      -11.2,
    );
    this.mesh(k(new BoxGeometry(0.7, 0.05, 3.7)), top, W - 0.35, 0.9, -11.2);
    for (let i = 0; i < 6; i++)
      this.mesh(
        k(new BoxGeometry(0.01, 0.7, 0.02)),
        this.lambert("#c9c2b6"),
        W - 0.655,
        0.45,
        -9.5 - i * 0.6,
      );
    this.mesh(
      k(new CylinderGeometry(0.03, 0.03, 0.3, 8)),
      this.lambert("#c0c0c0"),
      W - 0.4,
      1.07,
      -11.2,
    );
    // A fruit bowl on the counter.
    for (const [dz, c] of [
      [0, "#e8a33a"],
      [0.12, "#c0392b"],
      [-0.1, "#9be15d"],
    ] as const)
      this.mesh(
        k(new SphereGeometry(0.07, 10, 8)),
        this.lambert(c),
        W - 0.35,
        0.99,
        -10.2 + dz,
      );
    [-10.6, -11.8].forEach((z, i) => {
      const stool = new Group();
      this.mesh(
        k(new CylinderGeometry(0.19, 0.19, 0.06, 16)),
        this.lambert("#2f6fb3"),
        0,
        0.68,
        0,
        stool,
      );
      for (const [dx, dz] of [
        [-0.12, -0.12],
        [0.12, -0.12],
        [-0.12, 0.12],
        [0.12, 0.12],
      ])
        this.mesh(
          k(new CylinderGeometry(0.015, 0.015, 0.66, 5)),
          this.lambert("#2a2a2a"),
          dx,
          0.33,
          dz,
          stool,
        );
      stool.position.set(W - 1.0, 0, z);
      if (a === "stoolUpside" && i === 1) {
        stool.rotation.x = Math.PI;
        stool.position.y = 0.71;
      }
      this.scene.add(stool);
    });
    // Fridge.
    const fz = -13.6;
    this.mesh(
      k(new BoxGeometry(0.7, 1.9, 0.75)),
      this.lambert("#eef2f5"),
      W - 0.36,
      0.95,
      fz,
    );
    if (a === "fridgeOpen") {
      this.mesh(
        k(new BoxGeometry(0.02, 1.8, 0.7)),
        k(new MeshBasicMaterial({ color: "#fffbe0" })),
        W - 0.72,
        0.95,
        fz,
      );
      const door = this.mesh(
        k(new BoxGeometry(0.72, 1.86, 0.04)),
        this.lambert("#e4e9ee"),
        W - 1.05,
        0.95,
        fz + 0.36,
      );
      door.rotation.y = 0.15;
      for (const [y, c] of [
        [0.6, "#c0392b"],
        [1.0, "#f2c14e"],
        [1.4, "#5bb55b"],
      ] as const)
        this.mesh(
          k(new BoxGeometry(0.1, 0.18, 0.12)),
          this.lambert(c),
          W - 0.75,
          y,
          fz - 0.15,
        );
    } else {
      this.mesh(
        k(new BoxGeometry(0.01, 0.5, 0.03)),
        this.lambert("#a0a0a0"),
        W - 0.72,
        1.25,
        fz + 0.3,
      );
    }
    // Clock above the counter.
    const clock = this.onWall(
      "right",
      -11.2,
      2.15,
      0.5,
      0.5,
      k(new MeshBasicMaterial({ map: k(clockTex()), transparent: true })),
      0.02,
    );
    clock.renderOrder = 1;
    const hands = new Group();
    hands.position.set(W - 0.035, 2.15, -11.2);
    hands.rotation.y = -Math.PI / 2;
    this.mesh(
      k(new BoxGeometry(0.018, 0.16, 0.005)),
      this.lambert("#1d1d1d"),
      0,
      0.07,
      0,
      hands,
    ).rotation.z = -0.6;
    const second = new Group();
    this.mesh(
      k(new BoxGeometry(0.008, 0.21, 0.005)),
      this.lambert("#c0392b"),
      0,
      0.1,
      0.004,
      second,
    );
    hands.add(second);
    this.second = second;
    this.scene.add(hands);
    // Baja's bowl.
    this.mesh(
      k(new CylinderGeometry(0.2, 0.15, 0.1, 20)),
      this.lambert("#d63a3a"),
      W - 0.45,
      0.05,
      -14.6,
    );
    const kib = this.lambert("#8a5225");
    if (a === "bowlOverflow") {
      this.mesh(k(new ConeGeometry(0.4, 0.42, 18)), kib, W - 0.45, 0.28, -14.6);
      for (let i = 0; i < 24; i++)
        this.mesh(
          k(new SphereGeometry(0.028, 5, 4)),
          kib,
          W - 0.45 + Math.cos(i) * (0.32 + (i % 5) * 0.07),
          0.03,
          -14.6 + Math.sin(i * 1.7) * (0.32 + (i % 4) * 0.07),
        );
    } else
      this.mesh(
        k(new CylinderGeometry(0.17, 0.17, 0.02, 18)),
        kib,
        W - 0.45,
        0.09,
        -14.6,
      );

    // The bathroom and bedroom doors, beside the kitchen.
    const doorMat = this.lambert("#ffffff");
    const trim = this.lambert("#ddd6ca");
    for (const [z, open] of [
      [-16.4, false],
      [-19.4, a === "doorDark"],
    ] as const) {
      this.onWall("right", z, 1.05, 1.06, 2.16, trim, 0.008);
      this.onWall(
        "right",
        z,
        1.03,
        0.9,
        2.06,
        k(new MeshBasicMaterial({ color: "#08080b" })),
        0.012,
      );
      const door = new Group();
      door.position.set(W - 0.03, 0, z - 0.45);
      this.mesh(
        k(new BoxGeometry(0.04, 2.04, 0.9)),
        doorMat,
        0,
        1.02,
        0.45,
        door,
      );
      this.mesh(
        k(new SphereGeometry(0.035, 8, 6)),
        this.lambert("#c8a24a"),
        -0.04,
        1.0,
        0.8,
        door,
      );
      if (open) {
        door.rotation.y = 1.0;
        for (const dz of [-0.07, 0.07])
          this.mesh(
            k(new SphereGeometry(0.022, 8, 6)),
            k(new MeshBasicMaterial({ color: "#ff3b3b" })),
            W - 0.02,
            1.62,
            z + dz,
          );
      }
      this.scene.add(door);
    }

    // A plant in the corner.
    const plant = new Group();
    this.mesh(
      k(new CylinderGeometry(0.22, 0.17, 0.4, 14)),
      this.lambert("#d9cfc0"),
      0,
      0.2,
      0,
      plant,
    );
    const dead = a === "plantDead";
    const leaf = this.lambert(dead ? "#7a5a30" : "#4f9a3c");
    for (let i = 0; i < 7; i++) {
      const l = this.mesh(
        k(new ConeGeometry(0.09, 0.7, 6)),
        leaf,
        Math.cos(i) * 0.08,
        0.7,
        Math.sin(i) * 0.08,
        plant,
      );
      l.rotation.set(
        Math.sin(i * 2) * (dead ? 2.3 : 0.45),
        0,
        Math.cos(i * 2) * (dead ? 2.3 : 0.45),
      );
      if (dead) l.position.y = 0.42;
    }
    plant.position.set(W - 0.5, 0, -22);
    this.scene.add(plant);
  }

  private buildBack() {
    const a = this.a;
    const k = this.keep;
    const L = this.len;
    const W = HALF_W;
    // A shelf with a framed photo on the far wall, the thing you walk towards.
    this.mesh(
      k(new BoxGeometry(1.6, 0.05, 0.25)),
      this.lambert("#b58a5a"),
      0.8,
      1.2,
      -L - W + 0.13,
    );
    this.mesh(
      k(new BoxGeometry(0.34, 0.42, 0.03)),
      this.lambert("#2a2420"),
      0.6,
      1.44,
      -L - W + 0.12,
    );
    this.mesh(
      k(new PlaneGeometry(0.28, 0.36)),
      k(new MeshLambertMaterial({ map: k(paintingTex("baja")) })),
      0.6,
      1.44,
      -L - W + 0.14,
    );
    this.mesh(
      k(new CylinderGeometry(0.06, 0.07, 0.24, 12)),
      this.lambert("#e8e2d6"),
      1.2,
      1.35,
      -L - W + 0.13,
    );
    if (a === "figure") {
      const f = buildFigure(k, 1.0);
      f.position.set(-0.6, 0, -L - W + 0.08);
      this.scene.add(f);
    }
  }

  private buildBaja() {
    const a = this.a;
    if (a === "noBaja") return;
    const k = this.keep;
    const make = (offset: number) => {
      if (a === "dragonSwap") {
        // A big green dragon walking towards you, with Baja (small) in its mouth.
        const d = buildDragon(k, 3.0);
        const pup = buildBaja(k, 0.22);
        pup.root.position.set(0, -0.08, 0.14);
        pup.root.rotation.set(0, Math.PI / 2, 0.2);
        d.head.add(pup.root);
        this.scene.add(d.root);
        this.walkers.push({
          root: d.root,
          body: d.body,
          head: d.head,
          legs: d.legs,
          offset,
        });
        return;
      }
      const m: BajaModel = buildBaja(k, a === "huge" ? 1.5 : 0.6);
      if (a === "blackBaja")
        m.root.traverse((o) => {
          const mat = (o as Mesh).material as MeshLambertMaterial | undefined;
          if (mat?.type === "MeshLambertMaterial") mat.color.set("#1c1a1f");
        });
      if (a === "glowEyes")
        m.head.traverse((o) => {
          const mat = (o as Mesh).material as MeshBasicMaterial | undefined;
          if (
            mat?.type === "MeshBasicMaterial" &&
            mat.color.getHexString() === "140a08"
          ) {
            mat.color.set("#ff1a1a");
            (o as Mesh).scale.multiplyScalar(1.6);
          }
        });
      if (a !== "noToy") {
        // Her green dragon, carried in her mouth.
        const toy = buildDragon(k, 0.9);
        toy.root.position.set(0, -0.32, 0.38);
        toy.root.rotation.set(0, Math.PI / 2, 0);
        m.head.add(toy.root);
      }
      this.scene.add(m.root);
      this.walkers.push({
        root: m.root,
        body: m.body,
        head: m.head,
        legs: m.legs,
        tail: m.tail,
        ears: m.ears,
        offset,
      });
    };
    make(0);
    if (a === "twoBajas") make(1.3);
    this.dogZ = a === "withYou" ? -5 : -(this.len - 2);
    for (const w of this.walkers)
      w.root.position.set(
        a === "withYou" ? 0.5 : 0.9 - w.offset * 0.5,
        0,
        this.dogZ - w.offset,
      );
  }

  /**
   * Move the camera and the living things. `s` is how far the walk has got; `turn` is 0…1 for the
   * about-turn when the group goes back.
   */
  update(dt: number, s: number, turn = 0) {
    this.t += dt;
    // On a slow TV laptop, drop the ambient-occlusion pass rather than stutter.
    if (this.composer && this.t > 1) {
      this.slow = this.slow * 0.95 + (dt > 0.045 ? 0.05 : 0);
      if (this.slow > 0.6) {
        this.composer.dispose();
        this.composer = null;
      }
    }
    const p = poseAt(s, this.len);
    this.camera.position.set(p.x, EYE + Math.sin(s * 3.2) * 0.02, p.z);
    this.camera.rotation.set(0, p.yaw + turn * Math.PI, 0, "YXZ");
    const a = this.a;

    if (a === "flicker") {
      const on = Math.sin(this.t * 37) + Math.sin(this.t * 13.7) > -0.6;
      for (const b of this.bulbs) b.color.set(on ? "#fff7dc" : "#4a4844");
      this.ambient.intensity = on ? 0.25 : 0.05;
      this.hemi.intensity = on ? 0.55 : 0.1;
      this.scene.environmentIntensity = on ? 0.75 : 0.2;
      for (const l of this.lamps) l.intensity = on ? 3.5 : 0;
    }
    if (this.swing) this.swing.rotation.z = Math.sin(this.t * 1.8) * 0.35;
    // The clock's second hand ticks round (backwards in the anomaly).
    if (this.second)
      this.second.rotation.z =
        (a === "clockBackwards" ? 1 : -1) *
        Math.floor(this.t) *
        ((Math.PI * 2) / 60);

    // Baja (and her dragon) start trotting once you're in the flat.
    if (!this.started && s > LEG_A - 0.5) this.started = true;
    if (this.started && this.walkers.length) {
      const camZ = p.z;
      let speed = a === "zoomies" ? 7 : a === "dragonSwap" ? 1.0 : 1.2;
      let dir = 1;
      if (a === "withYou") {
        dir = -1;
        speed = 1.4;
      }
      const stopped = a === "stare" && this.dogZ > camZ - 3.2;
      if (!stopped) this.dogZ += dir * speed * dt;
      if (a === "withYou") this.dogZ = Math.max(this.dogZ, -this.len + 2);
      for (const w of this.walkers) {
        const z = this.dogZ - w.offset;
        w.root.position.z = z;
        let yaw = dir > 0 ? 0 : Math.PI;
        if (a === "backwards") yaw = Math.PI;
        if (stopped) yaw = Math.atan2(p.x - w.root.position.x, camZ - z);
        w.root.rotation.y = yaw;
        const stride =
          this.t * (a === "zoomies" ? 30 : a === "dragonSwap" ? 7 : 12);
        if (stopped) {
          w.body.position.y = 0;
          w.body.rotation.set(-0.25, 0, 0);
          w.head.rotation.set(-0.15, 0, Math.sin(this.t * 1.5) * 0.15);
          for (const leg of w.legs) leg.rotation.x = 0;
        } else {
          w.body.position.y =
            Math.abs(Math.sin(stride)) * 0.05 + (a === "hindLegs" ? 0.32 : 0);
          w.body.rotation.set(
            a === "hindLegs" ? -1.25 : 0.05,
            0,
            Math.sin(stride) * 0.06,
          );
          w.head.rotation.set(
            a === "hindLegs" ? 1.0 : -0.05,
            Math.sin(stride * 0.5) * 0.05,
            0,
          );
          const sw = Math.sin(stride) * 0.7;
          w.legs[0].rotation.x = sw;
          w.legs[3].rotation.x = sw;
          w.legs[1].rotation.x = -sw;
          w.legs[2].rotation.x = -sw;
        }
        w.tail?.rotation.set(0.15, 0, Math.sin(this.t * 14) * 0.45);
        w.ears?.forEach(
          (e, i) => (e.rotation.x = Math.sin(this.t * 7 + i) * 0.07),
        );
      }
    }

    // The portrait's pupils follow you.
    if (this.pupils.length) {
      const dz = Math.max(-0.03, Math.min(0.03, (p.z - this.pupilZ) * 0.006));
      this.pupils.forEach(
        (pu, i) =>
          (pu.position.z = this.pupilZ + (i ? 0.18 : -0.18) * 0.5 + dz),
      );
    }
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Swap every plain material for a physically based one, and switch on shadows. */
  private realistic() {
    const swapped = new Map<Material, Material>();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const old = m.material as Material;
      if (old.type === "MeshLambertMaterial") {
        let next = swapped.get(old);
        if (!next) {
          const l = old as MeshLambertMaterial;
          next = this.keep(
            new MeshStandardMaterial({
              color: l.color,
              map: l.map,
              transparent: l.transparent,
              opacity: l.opacity,
              side: l.side,
              roughness: (l.userData.rough as number | undefined) ?? 0.85,
              metalness: (l.userData.metal as number | undefined) ?? 0,
            }),
          );
          swapped.set(old, next);
        }
        m.material = next;
      }
      const basic = (m.material as Material).type === "MeshBasicMaterial";
      m.castShadow = !basic && !(m.material as Material).transparent;
      m.receiveShadow = !basic;
    });
  }
}
