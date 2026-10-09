import * as THREE from 'three';
import { patchMaterial, NOISE_GLSL } from '../engine/atmosphere';
import type { CatConfig } from './catConfig';
import type { CatShape } from './catBuilder';

const NOSE: Record<string, string> = { lion: '#7a4436', lioness: '#8a5040', cheetah: '#221714', leopard: '#5a3a30', snowleopard: '#8a6a68', tiger: '#b8706a', jaguar: '#3a2820' };
const PATTERN_ID: Record<string, number> = { none: 0, spots: 1, stripes: 2, rosettes: 3 };

export function catUniforms(cfg: CatConfig, shape: CatShape) {
  const has = (a: string[], id: string) => (a.includes(id) ? 1 : 0);
  const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
  return {
    uCoat: { value: new THREE.Color(cfg.coat) },
    uUnder: { value: new THREE.Color(cfg.under) },
    uPatColor: { value: new THREE.Color(cfg.patternColor) },
    uManeColor: { value: new THREE.Color(cfg.maneColor) },
    uNoseColor: { value: new THREE.Color(NOSE[cfg.species] || '#4a3028') },
    uPattern: { value: PATTERN_ID[cfg.pattern] ?? 0 },
    uPatScale: { value: cfg.patternScale },
    uHeadC: { value: v3(shape.headC) },
    uHeadS: { value: shape.headS },
    uEyeL: { value: v3(shape.eyeL) },
    uEyeR: { value: v3(shape.eyeR) },
    uEyeRad: { value: shape.eyeR_ },
    uNose: { value: v3(shape.noseTip) },
    uSpineH: { value: shape.spineH },
    uMarks: { value: new THREE.Vector4(has(cfg.markings, 'socks'), has(cfg.markings, 'blaze'), has(cfg.markings, 'tailtip'), has(cfg.markings, 'mask')) },
    uMarks2: { value: new THREE.Vector4(has(cfg.markings, 'dapple'), has(cfg.markings, 'tearmarks'), cfg.species === 'lion' || cfg.species === 'lioness' ? 1 : 0, cfg.species === 'tiger' ? 1 : 0) },
    uScars: { value: new THREE.Vector4(has(cfg.scars, 'eye'), has(cfg.scars, 'muzzle'), has(cfg.scars, 'shoulder'), has(cfg.scars, 'flank')) },
    uGrey: { value: cfg.lifeStage === 'elder' ? 0.7 : 0 },
    uCubSpots: { value: cfg.lifeStage === 'cub' && cfg.pattern === 'none' ? 1 : cfg.lifeStage === 'adolescent' && cfg.pattern === 'none' ? 0.4 : 0 },
    uFurLen: { value: shape.furLen },
    uManeLen: { value: shape.maneLen },
    uShells: { value: 16 },
    uFurWind: { value: new THREE.Vector3() },
    uSnow: { value: cfg.species === 'snowleopard' ? 1 : 0 },
    uCheetah: { value: cfg.species === 'cheetah' ? 1 : 0 },
    uLOD: { value: 0 },
  };
}
export type CatUniforms = ReturnType<typeof catUniforms>;

export const CAT_COLOR_GLSL = /* glsl */ `
uniform vec3 uCoat, uUnder, uPatColor, uManeColor, uNoseColor; uniform float uPattern, uPatScale;
uniform vec3 uHeadC, uEyeL, uEyeR, uNose; uniform float uHeadS, uEyeRad, uSpineH;
uniform vec4 uMarks, uMarks2, uScars; uniform float uGrey, uCubSpots, uSnow, uCheetah; uniform float gWet;
float segD(vec3 p, vec3 a, vec3 b){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
float spotField(vec3 p, float freq, float r){ vec3 w = gg_worley3(p * freq); return smoothstep(r, r * 0.78, w.x); }
// returns albedo; furMask: 0 = bare skin (nose, scars), 1 = full fur. longFur: extra length multiplier (tail tuft etc)
vec3 catColor(vec3 p, vec4 m, vec3 n, out float furMask, out float longFur){
  furMask = 1.0; longFur = 0.0;
  float part = m.y;
  float isHead = step(2.5, part) * step(part, 4.5) + step(6.5, part) * step(part, 7.5);
  vec3 h = (p - uHeadC) / uHeadS; // head space
  vec3 col = uCoat;
  // tonal variation: darker saddle, sun-bleached flanks, noise mottling
  float saddle = smoothstep(0.16, 0.0, abs(p.x)) * smoothstep(uSpineH - 0.12, uSpineH + 0.1, p.y) * (1.0 - isHead);
  col *= 1.0 - 0.13 * saddle;
  col *= 0.9 + 0.2 * gg_fbm3(p * 5.0 + 3.0);
  // countershading
  float under = m.x;
  col = mix(col, uUnder, clamp(under, 0.0, 1.0) * 0.85);
  // ---- patterns ----
  float sc = uPatScale;
  float pat = 0.0; vec3 patCol = uPatColor;
  float faceFade = 1.0 - isHead * 0.35;
  if (uPattern > 0.5 && uPattern < 1.5) {
    float f = (part > 0.5 && part < 1.5) || part > 5.5 ? 30.0 : 22.0;
    if (isHead > 0.5) f = 46.0;
    pat = spotField(p, f * sc, 0.33);
    if (part > 1.5 && part < 2.5) { // tail: spots -> rings toward the tip
      float rings = smoothstep(0.62, 0.75, sin(m.w * 48.0) * 0.5 + 0.5) * smoothstep(0.6, 0.75, m.w);
      pat = max(pat * (1.0 - smoothstep(0.6, 0.7, m.w)), rings);
    }
    pat *= mix(1.0, 0.55, under);
  } else if (uPattern > 2.5) {
    float f = 13.0 * sc * (uSnow > 0.5 ? 0.72 : 1.0);
    if (isHead > 0.5 || (part > 0.5 && part < 1.5) || part > 5.5) {
      pat = spotField(p, f * 2.4, 0.3); // solid spots on head and legs
    } else if (part > 1.5 && part < 2.5) {
      pat = max(spotField(p, f * 1.5, 0.3) * (1.0 - smoothstep(0.55, 0.7, m.w)), smoothstep(0.6, 0.75, sin(m.w * 40.0) * 0.5 + 0.5) * smoothstep(0.55, 0.7, m.w));
    } else {
      vec3 w = gg_worley3(p * f);
      float ring = smoothstep(0.47, 0.40, w.x) * smoothstep(0.17, 0.25, w.x);
      ring *= step(0.38, gg_vnoise3(p * f * 4.2 + w.z * 10.0));
      float inner = smoothstep(0.3, 0.2, w.x);
      col = mix(col, col * vec3(0.82, 0.72, 0.6), inner * (1.0 - under) * (1.0 - uSnow * 0.7));
      float dot_ = smoothstep(0.08, 0.05, w.x) * step(0.45, w.z) * (1.0 - uSnow);
      pat = max(ring, dot_ * 0.9);
    }
    pat *= mix(1.0, 0.5, under);
  } else if (uPattern > 1.5) {
    // stripes: vertical bands on the body, horizontal on legs, rings on the tail, classic marks on the face
    float nz = gg_fbm3(p * 3.0) - 0.5;
    float v;
    if (isHead > 0.5) {
      float a = sin((h.y * 26.0 + abs(h.x) * 10.0 + nz * 3.0) * sc);
      v = smoothstep(0.55, 0.85, a) * smoothstep(0.03, 0.08, abs(h.x)) * step(-0.02, h.y);
      v = max(v, smoothstep(0.6, 0.9, sin((h.y * 30.0 - h.z * 12.0) * sc)) * smoothstep(0.06, 0.1, abs(h.x)) * step(h.y, 0.0) * step(h.z, 0.06));
    } else if (part > 0.5 && part < 1.5 || part > 5.5) {
      v = smoothstep(0.62, 0.85, sin((p.y * 26.0 + nz * 2.5) * sc)) * smoothstep(0.0, 0.4, abs(n.x));
    } else if (part > 1.5 && part < 2.5) {
      v = smoothstep(0.45, 0.7, sin(m.w * 44.0 + nz));
    } else {
      float s = p.z * 7.2 * sc + nz * 2.2 + abs(p.x) * 1.5;
      float a = sin(s * 6.2831);
      float b = sin(s * 6.2831 * 1.93 + 1.3);
      v = smoothstep(0.62, 0.8, a + 0.25 * b);
      v *= smoothstep(uSpineH - 0.42, uSpineH - 0.18, p.y + nz * 0.12); // fade toward the belly
    }
    pat = v * mix(1.0, 0.25, under);
  }
  // cub spots (faint rosettes on lion cubs)
  if (uCubSpots > 0.0 && isHead < 0.5) pat = max(pat, spotField(p, 20.0, 0.3) * 0.35 * uCubSpots * (1.0 - under * 0.4));
  // dapple marking
  if (uMarks2.x > 0.5 && isHead < 0.5) col = mix(col, col * 0.86, spotField(p, 16.0, 0.34) * 0.8);
  col = mix(col, patCol, pat * faceFade + pat * isHead * 0.35);

  // ---- mane ----
  col = mix(col, uManeColor * (0.82 + 0.36 * gg_fbm3(p * 9.0)), smoothstep(0.15, 0.6, m.z));

  // ---- face ----
  float notMane = 1.0 - smoothstep(0.1, 0.5, m.z);
  if ((isHead > 0.5 || length(h) < 0.35) && notMane > 0.01) {
    vec3 colPre = col;
    vec3 nz = (uNose - uHeadC) / uHeadS;
    vec3 eL = (uEyeL - uHeadC) / uHeadS, eR = (uEyeR - uHeadC) / uHeadS;
    float er = uEyeRad / uHeadS;
    // light muzzle, chin and eye patches
    float muzzle = smoothstep(0.06, 0.02, length((h - vec3(0.0, -0.055, nz.z - 0.03)) / vec3(1.0, 0.75, 1.3)) - 0.03);
    float chin = smoothstep(-0.07, -0.1, h.y) * smoothstep(0.02, 0.1, h.z);
    float eyeW = 0.0;
    for (int i = 0; i < 2; i++) { vec3 e = i == 0 ? eL : eR; eyeW = max(eyeW, smoothstep(1.0, 0.5, length((h - e - vec3(0.0, -0.022, 0.0)) / vec3(0.034, 0.016, 0.03)))); }
    col = mix(col, uUnder, max(max(muzzle * 0.75, chin * 0.9), eyeW * 0.7) * (1.0 - uMarks.w * 0.6));
    // dark mask marking
    col = mix(col, col * 0.55, uMarks.w * smoothstep(0.12, 0.02, length(h.xy - vec2(0.0, 0.02))) * step(0.02, h.z));
    // blaze
    col = mix(col, uUnder * 1.05, uMarks.y * smoothstep(0.018, 0.008, abs(h.x)) * step(0.0, h.y) * step(0.06, h.z) * step(h.z, nz.z));
    // whisker dots
    vec2 wp = vec2(abs(h.x), h.y);
    if (h.z > nz.z - 0.08 && h.y < -0.02 && h.y > -0.075 && abs(h.x) > 0.012) {
      vec2 g = fract(vec2(wp.x * 90.0 + wp.y * 20.0, wp.y * 100.0)) - 0.5;
      col = mix(col, col * 0.45, smoothstep(0.22, 0.12, length(g)) * 0.7 * (uCheetah + uMarks2.z * 0.8 + 0.4));
    }
    // eye rims ('eyeliner')
    for (int i = 0; i < 2; i++) {
      vec3 e = i == 0 ? eL : eR;
      float d = length((h - e) / vec3(1.0, 0.82, 1.0)) / er;
      float rim = smoothstep(1.55, 1.1, d);
      col = mix(col, vec3(0.06, 0.045, 0.04), rim * 0.95);
      furMask *= mix(1.0, 0.0, smoothstep(1.4, 1.05, d));
      // cheetah tear mark: inner eye corner to the mouth corner
      float sx = i == 0 ? 1.0 : -1.0;
      float tm = segD(h, e + vec3(-0.012 * sx, -0.016, 0.012), vec3(0.04 * sx, -0.078, nz.z - 0.045));
      col = mix(col, vec3(0.05, 0.035, 0.03), max(uCheetah, uMarks2.y) * smoothstep(0.009, 0.004, tm));
    }
    // nose leather: broad at the top, narrowing to a point above the philtrum
    vec3 nq = h - nz - vec3(0.0, -0.004, -0.004);
    float widen = 1.0 + clamp(nq.y / 0.02, -1.0, 1.0) * 0.35;
    float nd = length(nq / vec3(0.031 * widen, 0.02, 0.026));
    float noseM = smoothstep(1.0, 0.9, nd) * step(nz.z - 0.03, h.z);
    vec3 ncol = uNoseColor * (0.75 + 0.3 * gg_vnoise3(h * 260.0));
    ncol = mix(ncol, ncol * 0.35, smoothstep(0.55, 0.95, nd)); // dark edges
    col = mix(col, ncol, noseM);
    furMask *= 1.0 - smoothstep(0.9, 1.05, 2.0 - nd);
    // philtrum and mouth line
    float phil = smoothstep(0.005, 0.0015, abs(h.x)) * step(h.y, nz.y - 0.015) * step(-0.072, h.y) * step(nz.z - 0.04, h.z);
    float lipY = -0.074 - abs(h.x) * 0.25;
    float lip = smoothstep(0.009, 0.003, abs(h.y - lipY)) * step(0.02, h.z) * step(abs(h.x), 0.07);
    col = mix(col, vec3(0.08, 0.05, 0.045), max(phil, lip));
    furMask *= 1.0 - max(phil, lip) * 0.8;
    // ears: dark backs and rims, pale fluffy insides
    if (part > 3.5 && part < 4.5) {
      float back = smoothstep(0.1, -0.4, n.z);
      vec3 earBack = mix(col * 0.35, vec3(0.08, 0.06, 0.05), uMarks2.w + uMarks2.z * 0.5);
      col = mix(col, earBack, back * 0.85);
      // tiger's white ear spot
      col = mix(col, vec3(0.9), uMarks2.w * back * smoothstep(0.03, 0.015, length(vec2(abs(h.x) - 0.1, h.y - 0.13))));
      col = mix(col, mix(uUnder, vec3(0.75, 0.55, 0.5), 0.3), (1.0 - back) * smoothstep(0.2, 0.8, n.z) * 0.8);
      longFur = (1.0 - back) * 0.6 + uSnow * 0.5;
    }
    // elder greying
    col = mix(col, vec3(0.78, 0.74, 0.68), uGrey * smoothstep(0.08, 0.0, length((h - vec3(0.0, -0.04, nz.z - 0.04)) / vec3(1.2, 1.0, 1.6)) - 0.02) * 0.8);
    // scars
    float sEye = segD(h, eL + vec3(0.006, 0.06, -0.01), eL + vec3(-0.004, -0.05, 0.012));
    float sMuz = segD(h, vec3(0.04, -0.01, nz.z - 0.07), vec3(-0.02, -0.06, nz.z - 0.01));
    float scar = uScars.x * smoothstep(0.006, 0.002, sEye) + uScars.y * smoothstep(0.005, 0.0015, sMuz);
    col = mix(col, vec3(0.62, 0.42, 0.38), scar * 0.9);
    furMask *= 1.0 - scar;
    col = mix(colPre, col, notMane);
  }
  // body scars: claw marks on the left shoulder, a long flank scar on the right
  {
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
      vec3 o = vec3(0.0, float(i) * 0.035, float(i) * 0.012);
      s = max(s, smoothstep(0.007, 0.002, segD(p, vec3(0.2, uSpineH - 0.05, 0.42) + o, vec3(0.22, uSpineH - 0.24, 0.3) + o)));
    }
    s *= uScars.z * step(0.0, p.x);
    float f = uScars.w * smoothstep(0.007, 0.002, segD(p, vec3(-0.25, uSpineH - 0.06, 0.05), vec3(-0.24, uSpineH - 0.18, -0.3))) * step(p.x, 0.0);
    s = max(s, f);
    col = mix(col, vec3(0.62, 0.44, 0.4), s * 0.9);
    furMask *= 1.0 - s;
  }
  // socks
  if (part > 0.5 && part < 1.5 || part > 5.5 && part < 6.5) col = mix(col, uUnder * 1.08, uMarks.x * smoothstep(0.26, 0.2, p.y));
  // paw pads (underside of paws)
  if (part > 5.5 && part < 6.5) { float pad = smoothstep(-0.55, -0.85, n.y); col = mix(col, vec3(0.1, 0.07, 0.06), pad); furMask *= 1.0 - pad; }
  // tail tip: lion tuft or dark-tip marking
  if (part > 1.5 && part < 2.5) {
    float tuft = smoothstep(0.86, 0.93, m.w);
    col = mix(col, mix(uManeColor * 0.5, vec3(0.06, 0.045, 0.035), 0.4), tuft * max(uMarks2.z, uMarks.z));
    longFur = max(longFur, tuft * uMarks2.z * 3.0);
    if (uSnow > 0.5) longFur = max(longFur, 1.2);
  }
  // wet fur goes darker
  col *= 1.0 - gWet * 0.3;
  return col;
}`;

/** Base (skin + short fur colour) material. */
export function makeCatBaseMaterial(u: CatUniforms) {
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.78, metalness: 0, sheen: 0.6, sheenRoughness: 0.55, sheenColor: new THREE.Color(1, 0.9, 0.75) });
  patchMaterial(mat, (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMask; varying vec3 vRest; varying vec4 vMask; varying vec3 vRestN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position; vMask = aMask; vRestN = normal;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRest; varying vec4 vMask; varying vec3 vRestN;\n${NOISE_GLSL}\n${CAT_COLOR_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat fm, lf; diffuseColor.rgb = catColor(vRest, vMask, normalize(vRestN), fm, lf);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.42, 0.85, fm) * (1.0 - gWet * 0.4);');
  }, 'catbase');
  return mat;
}

/** Fur shells: one instanced draw, gl_InstanceID = shell index. */
export function makeCatShellMaterial(u: CatUniforms, a2c: boolean) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, transparent: false, alphaTest: a2c ? 0 : 0.5, alphaToCoverage: a2c });
  patchMaterial(mat, (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aMask; varying vec3 vRest; varying vec4 vMask; varying vec3 vRestN; varying float vShell;\nuniform float uFurLen, uManeLen, uShells; uniform vec3 uFurWind; uniform float gTime;\n${NOISE_GLSL}`)
      .replace('#include <skinning_vertex>', /* glsl */ `#include <skinning_vertex>
float sh = (float(gl_InstanceID) + 1.0) / uShells;
vShell = sh; vRest = position; vMask = aMask; vRestN = normal;
float part = aMask.y;
float flen = mix(uFurLen, uManeLen, smoothstep(0.1, 0.6, aMask.z));
if (part > 1.5 && part < 2.5) flen *= 1.0 + smoothstep(0.86, 0.95, aMask.w) * 3.0; // tail tuft (lion)
if (part > 6.5) flen *= 0.3; // muzzle is short
if (part > 2.5 && part < 3.5) flen *= 0.45;
if (part > 3.5 && part < 4.5) flen *= 0.6;
vec3 nn = normalize(objectNormal);
// comb direction: fur lies back along the body, down the legs
vec3 comb = vec3(0.0, -0.25, -1.0);
if (part > 0.5 && part < 1.5 || part > 5.5 && part < 6.5) comb = vec3(0.0, -1.0, 0.0);
comb = normalize(comb - nn * dot(comb, nn));
float stiff = 1.0 - smoothstep(0.2, 0.7, aMask.z) * 0.5;
vec3 off = nn * sh * flen * stiff + comb * sh * flen * 0.9;
off.y -= sh * sh * flen * (0.25 + aMask.z * 0.9);
float sway = gg_vnoise(position.xy * 6.0 + gTime * 1.3) - 0.5;
off += (uFurWind + vec3(sway, 0.0, sway) * 0.4) * sh * sh * flen * (0.3 + aMask.z * 1.6);
transformed += off;
`);
    let lfb = THREE.ShaderChunk.lights_fragment_begin.split('RE_Direct( directLight,').join('GG_RE( directLight,');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRest; varying vec4 vMask; varying vec3 vRestN; varying float vShell;\nuniform float uLOD;\n${NOISE_GLSL}\n${CAT_COLOR_GLSL}\nvec3 ggTrans = vec3(0.0);`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
float fm, lf;
vec3 cc = catColor(vRest, vMask, normalize(vRestN), fm, lf);
float isMane = smoothstep(0.15, 0.6, vMask.z);
// strands: high-frequency 3D noise thresholded by shell height (tapered)
float headish = step(2.5, vMask.y) * step(vMask.y, 4.5) + step(6.5, vMask.y);
float dens = mix(mix(560.0, 900.0, headish), 210.0, isMane);
vec3 sp = vRest * dens;
float strand = gg_vnoise3(sp) * 0.65 + gg_vnoise3(sp * 2.1 + 7.0) * 0.35;
float clump = mix(1.0, gg_vnoise3(vRest * 38.0), isMane * 0.7);
float lenVar = mix(1.0, 0.55 + 0.6 * gg_vnoise3(vRest * 55.0), isMane);
float th = vShell / lenVar * (0.9 - lf * 0.1);
float a = smoothstep(th - 0.08, th + 0.04, strand * (0.75 + 0.5 * clump));
a *= fm;
a *= 1.0 - smoothstep(0.75, 1.0, vShell) * (1.0 - isMane) * 0.6;
diffuseColor.a = a;
// self-shadowing toward the roots, lighter tips
cc *= mix(0.55, 1.12, pow(vShell, 0.8));
diffuseColor.rgb = cc;
`)
      .replace('#include <lights_fragment_begin>', /* glsl */ `
#define GG_RE(dl, gp, gn, gv, gc, m, rl) RE_Direct(dl, gp, gn, gv, gc, m, rl); ggTrans += dl.color * pow(clamp(dot(gv, -dl.direction), 0.0, 1.0), 4.0) * vShell;
${lfb}`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.directDiffuse += ggTrans * diffuseColor.rgb * 1.3;\nreflectedLight.indirectDiffuse *= mix(0.6, 1.0, vShell);');
  }, 'catshell' + (a2c ? 'a' : 't'));
  mat.side = THREE.FrontSide;
  return mat;
}

/** Eyes: glossy cornea, radial iris, round pupil that dilates at night. */
export function makeEyeMaterial(color: string) {
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, metalness: 0 });
  const u = { uIris: { value: new THREE.Color(color) }, uPupil: { value: 0.35 } };
  patchMaterial(mat, (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = normalize(position);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLocal; uniform vec3 uIris; uniform float uPupil; uniform float gNight;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
float r = length(vLocal.xy) ; // eye looks down +z
float front = step(0.0, vLocal.z);
float pupil = mix(uPupil, uPupil + 0.25, gNight);
vec3 iris = uIris * (0.65 + 0.6 * smoothstep(0.85, 0.3, r)) * (0.85 + 0.3 * gg_vnoise(vec2(atan(vLocal.y, r > 1e-4 ? vLocal.x : 1.0) * 12.0, r * 6.0)));
iris = mix(iris, iris * 0.4, smoothstep(0.72, 0.9, r));
vec3 c = mix(vec3(0.02), iris, smoothstep(pupil - 0.02, pupil + 0.02, r));
c = mix(c, vec3(0.03, 0.02, 0.02), smoothstep(0.88, 0.95, r));
diffuseColor.rgb = mix(vec3(0.03, 0.02, 0.02), c, front);
`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uIris * 0.12 * step(uPupil + 0.02, length(vLocal.xy)) * step(length(vLocal.xy), 0.85) * step(0.0, vLocal.z) * (1.0 + gNight * 2.0);');
  }, 'eye');
  return mat;
}
