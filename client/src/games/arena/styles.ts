/**
 * Swappable looks for every 3D game, applied on top of the existing low-poly scenes.
 *
 * A style is up to two things:
 *  - a full-screen post-process shader: the scene is drawn into an offscreen target (colour +
 *    depth), then one quad runs the style's fragment shader onto the canvas;
 *  - an optional material patch, applied lazily to every material in the scene before it first
 *    compiles (cel-banded lighting, PS1 vertex wobble). Patching keeps the material objects, so
 *    game code that tweaks colours or emissive later still works.
 *
 * Pick one with `?style=<id>` on the page URL. No param (or `psx`) is the original look.
 */
import {
  DepthTexture,
  HalfFloatType,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';

export interface StyleDef {
  id: string;
  name: string;
  /** Offscreen resolution relative to the canvas (Game Boy draws smaller and scales up). */
  scale?: number;
  /** Fragment shader body: must define `vec4 effect(vec2 uv)` (sRGB in, sRGB out). */
  frag?: string;
  /** Patch a material's shader before it compiles. */
  patch?: (m: Material) => void;
}

// ---------------------------------------------------------------------------
// material patches
// ---------------------------------------------------------------------------

/** Cel shading: the sun's light comes in three hard bands instead of a smooth falloff. */
const toonChunk = ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) ); dotNL = dotNL > 0.55 ? 1.15 : ( dotNL > 0.2 ? 0.6 : 0.15 );',
);
function toonCompile(shader: { fragmentShader: string }) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_pars_fragment>', toonChunk);
}

/** PS1 wobble: vertices snap to a coarse screen grid, so edges jitter as things move. */
function snapCompile(shader: { vertexShader: string }) {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    `#include <project_vertex>
    { vec2 g = vec2(160.0, 90.0); gl_Position.xy = floor(gl_Position.xy / gl_Position.w * g + 0.5) / g * gl_Position.w; }`,
  );
}

const patchWith = (fn: (s: { vertexShader: string; fragmentShader: string }) => void, types: string[]) => (m: Material) => {
  if (!types.includes(m.type)) return;
  m.onBeforeCompile = fn;
  m.needsUpdate = true;
};

// ---------------------------------------------------------------------------
// post shaders
// ---------------------------------------------------------------------------

const header = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uTime;
uniform float uNear;
uniform float uFar;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform float uWorld;
varying vec2 vUv;

vec3 tex(vec2 uv) { return sRGBTransferOETF(texture2D(tColor, uv)).rgb; }
float rawDepth(vec2 uv) { return texture2D(tDepth, uv).x; }
float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(rawDepth(uv), uNear, uFar); }
/** World position of the surface under this pixel (only valid when uWorld = 1). */
vec3 worldPos(vec2 uv) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, rawDepth(uv) * 2.0 - 1.0, 1.0);
  return (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int k = i.x + i.y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  for (int j = 0; j < 16; j++) if (j == k) return (m[j] + 0.5) / 16.0;
  return 0.5;
}
/** Depth edges: how much the distance jumps around this pixel, relative to the distance. */
float depthEdge(vec2 uv, float w) {
  vec2 px = w / uRes;
  float d = viewZ(uv);
  float s = abs(viewZ(uv + vec2(px.x, 0.)) - d) + abs(viewZ(uv - vec2(px.x, 0.)) - d)
          + abs(viewZ(uv + vec2(0., px.y)) - d) + abs(viewZ(uv - vec2(0., px.y)) - d);
  return s / max(d, 0.001);
}
/** Colour edges (Sobel on luminance). */
float colorEdge(vec2 uv, float w) {
  vec2 px = w / uRes;
  float tl = lum(tex(uv + px * vec2(-1, 1))), t = lum(tex(uv + px * vec2(0, 1))), tr = lum(tex(uv + px * vec2(1, 1)));
  float l = lum(tex(uv + px * vec2(-1, 0))), r = lum(tex(uv + px * vec2(1, 0)));
  float bl = lum(tex(uv + px * vec2(-1, -1))), b = lum(tex(uv + px * vec2(0, -1))), br = lum(tex(uv + px * vec2(1, -1)));
  float gx = -tl - 2. * l - bl + tr + 2. * r + br;
  float gy = -bl - 2. * b - br + tl + 2. * t + tr;
  return length(vec2(gx, gy));
}
vec3 saturateColor(vec3 c, float s) { return mix(vec3(lum(c)), c, s); }
/** A 5×5 average: irons out the pixel-noise textures into flat areas of colour. */
vec3 smoothTex(vec2 uv, float r) {
  vec3 s = vec3(0.0);
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) s += tex(uv + vec2(i, j) * r / uRes);
  return s / 25.0;
}
`;

/** Vaporwave: magenta/cyan split by warm vs cool, a neon floor grid, dusk sky with a striped sun. */
const vaporwave = /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 off = vec2(2.0 / uRes.x, 0.0);
  vec3 c = vec3(tex(uv + off).r, tex(uv).g, tex(uv - off).b);
  float l = smoothstep(0.1, 0.85, lum(c));
  // Warm things go hot pink → peach, cool and green things go deep violet → cyan.
  float warm = clamp((c.r - c.b) * 2.0 + 0.5 - (c.g - c.r) * 1.5, 0.0, 1.0);
  vec3 cool = mix(vec3(0.12, 0.03, 0.30), vec3(0.25, 0.95, 1.0), l);
  vec3 hot = mix(vec3(0.45, 0.04, 0.42), vec3(1.0, 0.75, 0.80), l);
  hot = mix(hot, vec3(1.0, 0.25, 0.65), 0.45 * (1.0 - abs(l - 0.5) * 2.0));
  vec3 col = mix(cool, hot, warm);
  float sky = step(0.9999, rawDepth(uv));
  // Neon grid on anything near ground level.
  if (uWorld > 0.5 && sky < 0.5) {
    vec3 wp = worldPos(uv);
    vec2 g = abs(fract(wp.xz / 2.0 + 0.5) - 0.5) / fwidth(wp.xz / 2.0);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    col = mix(col, vec3(0.3, 1.0, 1.0), line * 0.75 * step(wp.y, 0.25));
    col += line * 0.15 * step(0.25, wp.y) * vec3(1.0, 0.3, 0.9);
  }
  vec3 dusk = mix(vec3(1.0, 0.45, 0.35), vec3(0.35, 0.1, 0.55), smoothstep(0.3, 1.0, uv.y));
  vec2 sp = (uv - vec2(0.5, 0.86)) * vec2(uRes.x / uRes.y, 1.0);
  float sun = step(length(sp), 0.16) * step(0.5, fract((uv.y - 0.86) * 28.0 - uTime * 0.3) + smoothstep(0.86, 0.95, uv.y));
  dusk = mix(dusk, mix(vec3(1.0, 0.85, 0.3), vec3(1.0, 0.3, 0.6), smoothstep(0.98, 0.7, uv.y)), sun);
  col = mix(col, dusk, max(sky, smoothstep(0.6, 1.0, viewZ(uv) / 200.0)));
  col *= 0.9 + 0.1 * step(0.5, fract(uv.y * uRes.y * 0.5));
  return vec4(col, 1.0);
}`;

/** Comic book: cel bands (material patch), thick ink outlines, halftone dots in the shade. */
const comic = /* glsl */ `
vec4 effect(vec2 uv) {
  vec3 c = smoothTex(uv, 1.2);
  c = saturateColor(c, 1.5);
  c = floor(c * 4.0 + 0.5) / 4.0;
  // Halftone: rotated dot grid, the darker the area the bigger the dots.
  vec2 r = mat2(0.707, -0.707, 0.707, 0.707) * gl_FragCoord.xy / 6.0;
  float dist = length(fract(r) - 0.5);
  float l = lum(c);
  float dot_ = step(dist, (1.0 - smoothstep(0.2, 0.55, l)) * 0.6);
  c = mix(c, c * 0.35, dot_);
  // Ben-Day highlight: light areas get a faint pale dot pattern too.
  c = mix(c, c + 0.12, step(dist, 0.18) * smoothstep(0.6, 0.85, l));
  float sky = step(0.9999, rawDepth(uv));
  float e = max(step(0.07, depthEdge(uv, 1.5)), step(0.45, length(smoothTex(uv, 1.2) - smoothTex(uv + 2.0 / uRes, 1.2)) * 2.5));
  c = mix(c, vec3(0.07, 0.04, 0.06), e * (1.0 - sky));
  return vec4(c, 1.0);
}`;

/** Game Boy: four shades of pea-soup green, ordered dither, quarter resolution. */
const gameboy = /* glsl */ `
vec4 effect(vec2 uv) {
  float l = lum(tex(uv));
  l = clamp((l - 0.08) * 1.25, 0.0, 1.0);
  float d = bayer4(gl_FragCoord.xy) - 0.5;
  float q = clamp(floor(l * 3.0 + 0.5 + d * 0.9), 0.0, 3.0);
  vec3 pal[4] = vec3[4](vec3(0.06, 0.22, 0.06), vec3(0.19, 0.38, 0.19), vec3(0.55, 0.67, 0.06), vec3(0.61, 0.74, 0.06));
  return vec4(pal[int(q)], 1.0);
}`;

/** Arcade CRT: curved glass, RGB split, scanlines, glow and a dark rim. */
const crt = /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 cc = uv * 2.0 - 1.0;
  cc *= 1.0 + dot(cc, cc) * vec2(0.035, 0.05);
  vec2 q = cc * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 off = vec2(1.5 / uRes.x, 0.0);
  vec3 c = vec3(tex(q + off).r, tex(q).g, tex(q - off).b);
  // Cheap glow: a blurred copy added on top.
  vec3 glow = vec3(0.0);
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) glow += tex(q + vec2(i, j) * 2.5 / uRes);
  glow /= 25.0;
  c = saturateColor(c, 1.3) + max(glow - 0.45, 0.0) * 0.9;
  float line = 0.62 + 0.38 * sin(q.y * uRes.y * 3.14159);
  c *= line * 1.25;
  float mask = mod(gl_FragCoord.x, 3.0);
  c *= vec3(mask < 1.0 ? 1.1 : 0.9, mask >= 1.0 && mask < 2.0 ? 1.1 : 0.9, mask >= 2.0 ? 1.1 : 0.9);
  c *= 1.0 - dot(cc, cc) * 0.28;
  c *= 0.97 + 0.03 * sin(uTime * 50.0);
  return vec4(c, 1.0);
}`;

/** Papercraft: flat posterized colour, brown pen lines with a hand wobble, paper grain. */
const paper = /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 w = (vec2(hash(floor(uv * 70.0)), hash(floor(uv * 70.0) + 7.0)) - 0.5) * 2.0 / uRes;
  vec3 c = smoothTex(uv, 1.6);
  // Fewer, flatter colours, pulled towards a warm paper palette.
  c = floor(c * 5.0 + 0.5) / 5.0;
  c = mix(c, c * vec3(1.04, 0.97, 0.84) + vec3(0.06, 0.045, 0.02), 0.75);
  // Paper fibre: fine grain plus larger blotches.
  float grain = hash(floor(gl_FragCoord.xy)) * 0.06 + hash(floor(gl_FragCoord.xy / 5.0)) * 0.05;
  c *= 0.94 + grain;
  float sky = step(0.9999, rawDepth(uv + w));
  float e = smoothstep(0.04, 0.09, depthEdge(uv + w, 1.5));
  // Cut edges: a dark pen line with a soft drop shadow just below it.
  float sh = smoothstep(0.04, 0.09, depthEdge(uv + w + vec2(0.0, 4.0) / uRes, 1.5));
  c *= 1.0 - sh * 0.25 * (1.0 - sky);
  c = mix(c, vec3(0.24, 0.12, 0.07), e * 0.9 * (1.0 - sky));
  return vec4(c, 1.0);
}`;

/** Noir: hard black and white with film grain, only reds and player colours survive. */
const noir = /* glsl */ `
vec4 effect(vec2 uv) {
  vec3 c = tex(uv);
  float l = lum(c);
  l = smoothstep(0.12, 0.75, l);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, 0.001);
  // Keep strong saturated reds/oranges (players, flags), drop the rest.
  float keep = smoothstep(0.45, 0.7, sat) * smoothstep(0.15, 0.4, c.r - max(c.g, c.b) * 0.8);
  vec3 col = mix(vec3(l), saturateColor(c, 1.5), keep);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.12;
  vec2 cc = uv - 0.5;
  col *= 1.0 - dot(cc, cc) * 1.6;
  return vec4(col, 1.0);
}`;

/** PS1 authentic: what the original is missing — 15-bit colour, dithering and wobbly vertices. */
const ps1 = /* glsl */ `
vec4 effect(vec2 uv) {
  vec3 c = tex(uv);
  float d = bayer4(gl_FragCoord.xy) - 0.5;
  c = floor(c * 31.0 + 0.5 + d) / 31.0;
  return vec4(c, 1.0);
}`;

export const STYLES: StyleDef[] = [
  { id: 'psx', name: 'Original (PS2-ish)' },
  { id: 'ps1', name: 'PS1 authentic', frag: ps1, scale: 0.75, patch: patchWith(snapCompile, ['MeshLambertMaterial', 'MeshBasicMaterial']) },
  { id: 'vaporwave', name: 'Vaporwave', frag: vaporwave },
  { id: 'comic', name: 'Comic book', frag: comic, scale: 1.4, patch: patchWith(toonCompile, ['MeshLambertMaterial']) },
  { id: 'gameboy', name: 'Game Boy', frag: gameboy, scale: 0.5 },
  { id: 'crt', name: 'Arcade CRT', frag: crt },
  { id: 'paper', name: 'Papercraft', frag: paper, scale: 1.4, patch: patchWith(toonCompile, ['MeshLambertMaterial']) },
  { id: 'noir', name: 'Noir', frag: noir },
];

export function styleFromUrl(): StyleDef {
  const id = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('style') : null;
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

// ---------------------------------------------------------------------------
// the pass
// ---------------------------------------------------------------------------

/** Draws a scene through a style. One per renderer. */
export class StylePass {
  private target: WebGLRenderTarget | null = null;
  private quad: Mesh | null = null;
  private mat: ShaderMaterial | null = null;
  private orthoScene = new Scene();
  private ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private patched = new WeakSet<Material>();
  private size = new Vector2();
  private t0 = performance.now();

  constructor(readonly style: StyleDef = styleFromUrl()) {
    if (!style.frag) return;
    this.mat = new ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uRes: { value: new Vector2() },
        uTime: { value: 0 },
        uNear: { value: 0.5 },
        uFar: { value: 400 },
        uProjInv: { value: new Matrix4() },
        uCamWorld: { value: new Matrix4() },
        uWorld: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `${header}\n${style.frag}\nvoid main() { gl_FragColor = effect(vUv); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.orthoScene.add(this.quad);
  }

  get active() {
    return !!this.mat || !!this.style.patch;
  }

  /** Patch any materials in the scene that haven't been seen yet. */
  private patch(root: Object3D) {
    const fn = this.style.patch;
    if (!fn) return;
    root.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) {
        if (this.patched.has(x)) continue;
        this.patched.add(x);
        fn(x);
      }
    });
  }

  /** Start a frame: returns the offscreen scale; draw into the target with viewports multiplied by it. */
  begin(renderer: WebGLRenderer, scene: Scene): number {
    this.patch(scene);
    if (!this.mat) return 1;
    renderer.getDrawingBufferSize(this.size);
    const k = this.style.scale ?? 1;
    const w = Math.max(1, Math.round(this.size.x * k));
    const h = Math.max(1, Math.round(this.size.y * k));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(w, h, { type: HalfFloatType, magFilter: NearestFilter, minFilter: NearestFilter, depthTexture: new DepthTexture(w, h) });
    }
    // A target keeps its own scissor flag; copy the renderer's so split-screen viewports don't
    // clear each other.
    this.target.scissorTest = renderer.getScissorTest();
    renderer.setRenderTarget(this.target);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.clear();
    return w / this.size.x;
  }

  /**
   * Finish a frame: run the style's shader onto the canvas. `single` says the whole target was
   * drawn by this one camera, so effects can work out world positions (split screen can't).
   */
  end(renderer: WebGLRenderer, camera: Camera & { near?: number; far?: number }, single = true) {
    if (!this.mat || !this.target) return;
    const u = this.mat.uniforms;
    u.tColor.value = this.target.texture;
    u.tDepth.value = this.target.depthTexture;
    u.uRes.value.set(this.target.width, this.target.height);
    u.uTime.value = (performance.now() - this.t0) / 1000;
    u.uNear.value = camera.near ?? 0.5;
    u.uFar.value = camera.far ?? 400;
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uWorld.value = single ? 1 : 0;
    const scissor = renderer.getScissorTest();
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.x, this.size.y);
    renderer.render(this.orthoScene, this.ortho);
    renderer.setScissorTest(scissor);
  }

  /** The whole thing for a single full-screen camera. */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    if (!this.active) {
      renderer.render(scene, camera);
      return;
    }
    this.begin(renderer, scene);
    renderer.render(scene, camera);
    this.end(renderer, camera);
  }

  dispose() {
    this.target?.dispose();
    this.mat?.dispose();
    this.quad?.geometry.dispose();
  }
}
