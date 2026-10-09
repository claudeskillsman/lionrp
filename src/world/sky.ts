import * as THREE from 'three';
import { G, ATMOS_GLSL, NOISE_GLSL } from '../engine/atmosphere';

export const skyUniforms = {
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGround: { value: new THREE.Color() },
  uCloudLit: { value: new THREE.Color() },
  uCloudShade: { value: new THREE.Color() },
  uCloudCover: { value: 0.45 },
  uStars: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunSize: { value: 1 },
};

const SKY_FRAG = /* glsl */ `
${NOISE_GLSL}
${ATMOS_GLSL}
uniform float gTime;
uniform vec3 uZenith, uHorizon, uGround, uCloudLit, uCloudShade, uMoonDir;
uniform float uCloudCover, uStars, uSunSize;
varying vec3 vDir;

float cloudField(vec2 p, float t){
  vec2 q = p + vec2(gg_fbm(p * 0.7 + t * 0.01), gg_fbm(p * 0.7 + 5.2 - t * 0.008)) * 1.6;
  float f = gg_fbm(q + t * 0.02);
  return f;
}
void main(){
  vec3 rd = normalize(vDir);
  float y = rd.y;
  float sd = max(dot(rd, gSunDir), 0.0);
  // painterly gradient: wide warm horizon band, cool zenith
  float hz = pow(1.0 - max(y, 0.0), 4.0);
  vec3 col = mix(uZenith, uHorizon, hz);
  // a second, softer band to give the 'brushed' layered look
  col = mix(col, mix(uHorizon, gFogSunColor, 0.5), pow(1.0 - abs(y), 18.0) * 0.35);
  // sun glow (mie-like)
  float sunUp = smoothstep(-0.12, 0.05, gSunDir.y);
  col += gFogSunColor * (pow(sd, 8.0) * 0.55 + pow(sd, 64.0) * 0.6) * sunUp;
  // sun disc
  float disc = smoothstep(0.99965 - 0.00025 * uSunSize, 0.99985, sd);
  col += gSunColor * disc * 22.0 * sunUp;

  // stars and moon
  if (uStars > 0.01 && y > 0.0) {
    vec3 sp = rd * 420.0;
    vec3 cell = floor(sp);
    float h = gg_hash13(cell);
    if (h > 0.985) {
      vec3 c = cell + gg_hash33(cell) ;
      float d = length(sp - c);
      float tw = 0.6 + 0.4 * sin(gTime * (2.0 + h * 9.0) + h * 40.0);
      col += vec3(0.8, 0.85, 1.0) * smoothstep(0.35, 0.0, d) * uStars * tw * (h - 0.985) * 90.0 * smoothstep(0.0, 0.25, y);
    }
    // milky band
    float band = exp(-pow(dot(rd, normalize(vec3(0.3, 0.5, 0.8))) * 4.0, 2.0));
    col += vec3(0.18, 0.2, 0.32) * band * gg_fbm(rd.xz * 8.0 / (rd.y + 0.3)) * uStars * 0.6;
    float md = dot(rd, uMoonDir);
    float moon = smoothstep(0.99955, 0.9997, md);
    float crater = gg_fbm(rd.xy * 900.0) * 0.35;
    col += vec3(0.9, 0.92, 1.0) * moon * (1.6 - crater) * uStars;
    col += vec3(0.25, 0.32, 0.5) * pow(max(md, 0.0), 200.0) * uStars * 0.6;
  }

  // clouds on a curved plane
  if (y > -0.02) {
    vec2 cp = rd.xz / (y + 0.12) * 1.4;
    float t = gTime;
    float f = cloudField(cp, t);
    float cov = uCloudCover;
    float dens = smoothstep(1.0 - cov - 0.08, 1.0 - cov + 0.25, f);
    // light marching toward the sun for silver linings
    vec2 ls = normalize(gSunDir.xz + 1e-4) * 0.25;
    float f2 = cloudField(cp + ls, t);
    float shade = clamp((f2 - f) * 4.0 + 0.5, 0.0, 1.0);
    vec3 cc = mix(uCloudLit, uCloudShade, shade);
    cc += gFogSunColor * pow(sd, 6.0) * (1.0 - dens) * 1.2 * sunUp; // rim glow
    // horizon streaks (stratus) catching low light
    float streak = smoothstep(0.55, 0.85, gg_fbm(vec2(cp.x * 0.25, cp.y * 3.0) + t * 0.005)) * smoothstep(0.35, 0.02, y);
    dens = max(dens, streak * 0.7);
    float fade = smoothstep(-0.02, 0.18, y);
    col = mix(col, cc, dens * fade * 0.92);
  }
  // below horizon: ground haze
  if (y < 0.0) col = mix(col, uGround, smoothstep(0.0, -0.2, y));
  // blend with atmospheric fog so the horizon matches distant terrain
  float f = gg_fogAmount(cameraPosition, rd, 9000.0);
  col = mix(col, gg_fogColor(rd), f * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky() {
  const geo = new THREE.SphereGeometry(1, 48, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...G, ...skyUniforms },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position * 9000.0, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (_r, _s, cam) => mesh.position.copy(cam.position);
  return mesh;
}
