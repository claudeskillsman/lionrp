import * as THREE from 'three';
import { patchMaterial, NOISE_GLSL } from '../engine/atmosphere';
import { HALF, WORLD_SIZE } from './worldgen';
import type { WorldTextures } from './terrain';

export const MAX_ACTORS = 12;
export const grassActors = { value: Array.from({ length: MAX_ACTORS }, () => new THREE.Vector4(0, -999, 0, 0)) };

function tuftGeometry(blades: number, segs: number) {
  const pos: number[] = [], idx: number[] = [];
  for (let b = 0; b < blades; b++) {
    const base = pos.length / 3;
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      pos.push(-1, t, b, 1, t, b);
    }
    pos.push(0, 1, b); // tip
    for (let s = 0; s < segs - 1; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const l = base + (segs - 1) * 2;
    idx.push(l, l + 1, l + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export interface GrassLayer { spacing: number; extent: number; width: number; blades: number; segs: number; fadeIn: number; fadeOut: number; }

export class Grass {
  meshes: THREE.Mesh[] = [];
  uniforms: Record<string, THREE.IUniform>;
  constructor(tex: WorldTextures, layers: GrassLayer[]) {
    this.uniforms = { uCenter: { value: new THREE.Vector2() } };
    for (const L of layers) this.meshes.push(this.makeLayer(tex, L));
  }
  private makeLayer(tex: WorldTextures, L: GrassLayer) {
    const n = Math.ceil(L.extent / L.spacing);
    const geo = tuftGeometry(L.blades, L.segs);
    geo.instanceCount = n * n;
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
    const uCenter = this.uniforms.uCenter;
    patchMaterial(mat, (s) => {
      Object.assign(s.uniforms, { tHeight: { value: tex.tHeight }, tBiomeA: { value: tex.tBiomeA }, tBiomeB: { value: tex.tBiomeB }, uCenter, uActors: grassActors });
      s.vertexShader = s.vertexShader
        .replace('#include <common>', /* glsl */ `#include <common>
${NOISE_GLSL}
uniform sampler2D tHeight, tBiomeA, tBiomeB; uniform vec2 uCenter; uniform vec4 gWind; uniform float gTime; uniform vec4 uActors[${MAX_ACTORS}];
varying vec4 vGrass; // x: height along blade, y: color variant, z: biome dryness, w: fade
varying vec3 vBiome;
const float SP = ${L.spacing.toFixed(4)}; const float N = ${n.toFixed(1)};
const float FADE_IN = ${L.fadeIn.toFixed(2)}; const float FADE_OUT = ${L.fadeOut.toFixed(2)}; const float BW = ${L.width.toFixed(4)};
vec2 wuv(vec2 xz){ return (xz + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)}; }
`)
        .replace('#include <beginnormal_vertex>', '')
        .replace('#include <defaultnormal_vertex>', '')
        .replace('#include <begin_vertex>', /* glsl */ `
float iid = float(gl_InstanceID);
vec2 cell = vec2(mod(iid, N), floor(iid / N));
vec2 origin = floor(uCenter / SP) - floor(N * 0.5);
vec2 wc = origin + cell;
vec2 h2 = gg_hash22(wc * 1.37 + 0.17);
vec2 base = (wc + h2) * SP;
float dist = length(base - cameraPosition.xz);
// cheap per-instance culling before any texture work: out of range or well outside the view cone
vec3 camF = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
float cfl = length(camF.xz);
float cosA = dot(base - cameraPosition.xz, camF.xz) / max(1e-4, dist * cfl);
if (dist > FADE_OUT || (dist > 4.0 && cfl > 0.45 && cosA < 0.42 - 0.75 * (1.0 - cfl))) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
vec2 uv = wuv(base);
vec4 B = texture(tBiomeB, uv);
vec4 A = texture(tBiomeA, uv);
float fade = smoothstep(FADE_OUT, FADE_OUT * 0.72, dist) * smoothstep(FADE_IN * 0.8, FADE_IN, dist);
// keep blades off the lens: shrink grass right around the camera
fade *= smoothstep(0.35, 1.5, dist);
float dens = B.z;
float rnd = gg_hash12(wc * 0.731 + 3.3);
float alive = step(rnd, dens) * step(0.001, fade);
float bh = texture(tHeight, uv).r;
float bladeId = position.z;
vec2 hb = gg_hash22(wc * 2.1 + bladeId * 13.7);
// height varies with large patches; shorter in woodland/highland, sparse in canyon
float patchH = 0.55 + 0.6 * gg_fbm(base * 0.035) + 0.25 * gg_vnoise(base * 0.4);
float H = (0.42 + 0.55 * hb.x) * patchH * (1.0 - A.w * 0.45) * (1.0 - A.z * 0.3) * (1.0 + B.x * 0.25) * 1.15;
H *= alive * smoothstep(0.0, 0.35, fade + 0.15) * mix(0.55, 1.0, smoothstep(0.0, 0.5, dens));
float ang = hb.y * 6.2831 + bladeId * 2.1;
vec2 face = vec2(cos(ang), sin(ang));
vec2 lean = vec2(cos(ang * 1.7 + 1.0), sin(ang * 1.7 + 1.0)) * (0.12 + 0.2 * hb.x);
// wind: large rolling gusts + per-blade flutter
vec2 wd = normalize(gWind.xy);
float wave = gg_vnoise(base * 0.045 - wd * gTime * 0.9) ;
float gust = smoothstep(0.25, 0.9, wave) * gWind.z;
float flutter = sin(gTime * (3.0 + hb.x * 2.0) + hb.y * 30.0 + dot(base, wd) * 0.7) * 0.08 * (0.3 + gWind.z);
vec2 bend = lean + wd * (0.1 * gWind.z + gust * 0.45) + face.yx * flutter;
// actors part the grass
float flatten = 0.0;
for (int i = 0; i < ${MAX_ACTORS}; i++) {
  vec4 a = uActors[i];
  vec2 d = base - a.xz;
  float dl = length(d) + 1e-3;
  float infl = 1.0 - smoothstep(a.w * 0.5, a.w * 1.5, dl);
  infl *= step(abs(bh - a.y), 2.5);
  bend += d / dl * infl * 1.6;
  flatten = max(flatten, infl);
}
float bl = length(bend);
bend = bl > 1.4 ? bend / bl * 1.4 : bend;
float t = position.y;
float w = BW * (1.0 - pow(t, 1.6)) * (0.8 + 0.5 * hb.y);
vec3 p;
p.xz = base + face * position.x * w;
float curve = t * t;
p.xz += bend * curve * H;
p.y = bh + t * H * (1.0 - 0.45 * min(1.0, dot(bend, bend) * 0.5)) * (1.0 - flatten * 0.55) - 0.02;
vec3 transformed = p;
// rounded normal: blade face normal bent toward sky and outward across width
vec3 fn = normalize(vec3(-face.y, 0.0, face.x));
vec3 objectNormal = normalize(fn * 0.55 + vec3(face.x, 0.0, face.y) * position.x * 0.35 + vec3(0.0, 1.0, 0.0) * 0.9);
vec3 transformedNormal = normalMatrix * objectNormal;
vNormal = normalize(transformedNormal);
vGrass = vec4(t, gg_hash12(wc + 9.1 + bladeId), A.z * 0.8 + (1.0 - B.x) * 0.0, fade);
vBiome = vec3(A.x, A.w, B.x);
`)
        .replace('#include <project_vertex>', '#include <project_vertex>\nif (H < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);')
        .replace('#include <normal_vertex>', '');
      // translucency: inject into the direct lighting loop so it is shadowed correctly
      let lfb = THREE.ShaderChunk.lights_fragment_begin.split('RE_Direct( directLight,').join('GG_RE( directLight,');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
varying vec4 vGrass; varying vec3 vBiome; uniform float gWet; uniform float gNight;
vec3 ggTrans = vec3(0.0);
`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
float gt = vGrass.x; float var = vGrass.y;
vec3 root = vec3(0.12, 0.08, 0.035);
vec3 mid = mix(vec3(0.46, 0.31, 0.12), vec3(0.54, 0.38, 0.16), var);
vec3 tip = mix(vec3(0.72, 0.56, 0.30), vec3(0.62, 0.36, 0.18), step(0.82, var)); // some red-oat tips
mid = mix(mid, vec3(0.55, 0.55, 0.24), step(0.9, var) * 0.6); // the odd green blade
// biome tints
mid = mix(mid, mid * vec3(0.85, 1.0, 0.7), vBiome.x * 0.6);
mid = mix(mid, vec3(0.42, 0.46, 0.32), vBiome.y * 0.75);
tip = mix(tip, vec3(0.70, 0.70, 0.55), vBiome.y * 0.6);
mid = mix(mid, vec3(0.42, 0.52, 0.20), vBiome.z * 0.55);
vec3 gcol = mix(root, mid, smoothstep(0.0, 0.45, gt));
gcol = mix(gcol, tip, smoothstep(0.55, 1.0, gt));
gcol *= 1.0 - gWet * 0.3;
diffuseColor.rgb = gcol;
`)
        .replace('#include <lights_fragment_begin>', /* glsl */ `
#define GG_RE(dl, gp, gn, gv, gc, m, rl) RE_Direct(dl, gp, gn, gv, gc, m, rl); ggTrans += dl.color * pow(clamp(dot(gv, -dl.direction), 0.0, 1.0), 3.0) * (0.25 + 0.75 * vGrass.x);
${lfb}`)
        .replace('#include <aomap_fragment>', /* glsl */ `#include <aomap_fragment>
float gao = mix(0.25, 1.0, smoothstep(0.0, 0.7, vGrass.x));
reflectedLight.indirectDiffuse *= gao; reflectedLight.directDiffuse *= mix(0.55, 1.0, gao);
reflectedLight.directDiffuse += ggTrans * diffuseColor.rgb * 0.9 * gao;
`);
    }, 'grass' + L.spacing);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }
  update(center: THREE.Vector3) { this.uniforms.uCenter.value.set(center.x, center.z); }
}

export const GRASS_PRESETS: Record<string, GrassLayer[]> = {
  low: [
    { spacing: 0.34, extent: 44, width: 0.05, blades: 2, segs: 3, fadeIn: 0, fadeOut: 22 },
  ],
  medium: [
    { spacing: 0.21, extent: 52, width: 0.032, blades: 3, segs: 4, fadeIn: 0, fadeOut: 26 },
    { spacing: 0.6, extent: 150, width: 0.07, blades: 2, segs: 3, fadeIn: 22, fadeOut: 75 },
  ],
  high: [
    { spacing: 0.16, extent: 56, width: 0.028, blades: 3, segs: 5, fadeIn: 0, fadeOut: 28 },
    { spacing: 0.45, extent: 180, width: 0.06, blades: 3, segs: 3, fadeIn: 24, fadeOut: 90 },
  ],
  ultra: [
    { spacing: 0.12, extent: 64, width: 0.024, blades: 3, segs: 5, fadeIn: 0, fadeOut: 32 },
    { spacing: 0.36, extent: 240, width: 0.055, blades: 3, segs: 3, fadeIn: 28, fadeOut: 120 },
  ],
};
