import * as THREE from 'three';
import { HOLE, RIVER_PATH, WATER_LEVEL, HALF, WORLD_SIZE } from './worldgen';
import { G, ATMOS_GLSL, NOISE_GLSL } from '../engine/atmosphere';
import { skyUniforms } from './sky';
import { grassActors, MAX_ACTORS } from './grass';
import type { WorldTextures } from './terrain';

/** Water surfaces: the watering hole and the river, sharing one shader. */
export function createWater(tex: WorldTextures) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...THREE.UniformsLib.fog, ...G, ...skyUniforms, tHeight: { value: tex.tHeight }, uActors: grassActors },
    vertexShader: /* glsl */ `
varying vec3 vWP;
#include <fog_pars_vertex>
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
${NOISE_GLSL}
uniform float gTime; uniform vec4 gWind; uniform float gWet; uniform float gNight;
uniform vec3 uZenith, uHorizon, uCloudLit; uniform sampler2D tHeight; uniform vec4 uActors[${MAX_ACTORS}];
varying vec3 vWP;
#include <fog_pars_fragment>
float waves(vec2 p){
  float t = gTime;
  return gg_vnoise(p * 0.35 + vec2(t * 0.12, t * 0.05)) * 0.5 + gg_vnoise(p * 1.1 - vec2(t * 0.2, -t * 0.15)) * 0.3 + gg_vnoise(p * 3.7 + vec2(t * 0.5, t * 0.3)) * 0.2;
}
void main(){
  vec2 uv = (vWP.xz + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
  float ground = texture2D(tHeight, uv).r;
  float depth = ${WATER_LEVEL.toFixed(2)} - ground;
  if (depth < -0.05) discard;
  // normal from wave heights
  float e = 0.15;
  vec2 p = vWP.xz;
  float hC = waves(p);
  float amp = 0.06 + gWind.z * 0.05;
  // rain ripples
  float rain = 0.0;
  if (gWet > 0.05) { vec2 cell = floor(p * 2.0); vec2 f = fract(p * 2.0) - 0.5; float ph = fract(gTime * 0.9 + gg_hash12(cell) * 7.0); float r = length(f - (gg_hash22(cell) - 0.5) * 0.5); rain = sin((r - ph * 0.6) * 60.0) * smoothstep(0.3, 0.0, abs(r - ph * 0.5)) * (1.0 - ph) * gWet; }
  // ripples around wading/swimming cats
  float rip = 0.0;
  for (int i = 0; i < ${MAX_ACTORS}; i++) { vec4 a = uActors[i]; if (a.y < -500.0) continue; float d = length(p - a.xz); rip += sin(d * 9.0 - gTime * 6.0) * exp(-d * 0.9) * step(abs(a.y - ${WATER_LEVEL.toFixed(2)}), 1.5) * 0.6; }
  vec3 n = normalize(vec3((waves(p + vec2(e, 0.0)) - hC) / e * -amp + rain * 0.08 + rip * 0.08, 1.0, (waves(p + vec2(0.0, e)) - hC) / e * -amp + rip * 0.05));
  vec3 V = normalize(cameraPosition - vWP);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uHorizon, uZenith, pow(max(R.y, 0.0), 0.6));
  sky = mix(sky, uCloudLit, 0.15);
  sky += gFogSunColor * pow(max(dot(R, gSunDir), 0.0), 6.0) * 0.5;
  float spec = pow(max(dot(R, gSunDir), 0.0), 900.0) * 30.0 + pow(max(dot(R, gSunDir), 0.0), 90.0) * 1.2;
  vec3 deep = mix(vec3(0.05, 0.12, 0.10), vec3(0.03, 0.06, 0.09), gNight);
  vec3 shallow = vec3(0.28, 0.24, 0.14);
  float dz = clamp(depth / 2.2, 0.0, 1.0);
  vec3 body = mix(shallow, deep, dz) * (0.35 + 0.65 * max(gSunDir.y, 0.0) + 0.2);
  vec3 col = mix(body, sky, fres) + gSunColor * spec * smoothstep(-0.05, 0.1, gSunDir.y);
  // shoreline foam / wet edge
  float shore = smoothstep(0.35, 0.0, depth) * (0.6 + 0.4 * gg_vnoise(p * 3.0 + gTime * 0.3));
  col = mix(col, vec3(0.75, 0.68, 0.55) * (0.5 + 0.5 * max(gSunDir.y, 0.1)), shore * 0.25);
  float alpha = clamp(smoothstep(-0.05, 0.6, depth) * 0.85 + fres * 0.3, 0.0, 0.97);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    fog: true,
  });
  const group = new THREE.Group();
  const pond = new THREE.Mesh(new THREE.CircleGeometry(80, 64).rotateX(-Math.PI / 2), mat);
  pond.position.set(HOLE[0], WATER_LEVEL, HOLE[1]);
  group.add(pond);
  // river ribbon
  const pos: number[] = [], idx: number[] = [];
  const W = 45;
  for (let i = 0; i < RIVER_PATH.length; i++) {
    const a = RIVER_PATH[Math.max(0, i - 1)], b = RIVER_PATH[Math.min(RIVER_PATH.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const nx = -dz / l, nz = dx / l;
    const [x, z] = RIVER_PATH[i];
    pos.push(x + nx * W, WATER_LEVEL, z + nz * W, x - nx * W, WATER_LEVEL, z - nz * W);
    if (i < RIVER_PATH.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rg.setIndex(idx);
  rg.computeVertexNormals();
  const river = new THREE.Mesh(rg, mat);
  group.add(river);
  for (const m of [pond, river]) { m.renderOrder = 5; m.frustumCulled = false; }
  void ATMOS_GLSL;
  return { group, material: mat };
}
