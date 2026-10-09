import * as THREE from 'three';
import { GLSL_NOISE } from './noise';

/** Uniforms shared by every world material (same object references, so one update reaches all). */
export const G = {
  gTime: { value: 0 },
  gSunDir: { value: new THREE.Vector3(0.5, 0.3, -0.2).normalize() },
  gSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
  gFogColor: { value: new THREE.Color(0.8, 0.7, 0.6) },
  gFogSunColor: { value: new THREE.Color(1, 0.7, 0.4) },
  gFogDensity: { value: 0.0009 },
  gFogFalloff: { value: 0.012 },
  gFogBase: { value: 0 },
  gMist: { value: new THREE.Vector4(520, -640, 60, 0) }, // x,z, base height, strength
  gWind: { value: new THREE.Vector4(1, 0.3, 0.6, 0) }, // dir.xy, strength, gust phase
  gWet: { value: 0 },
  gNight: { value: 0 },
};

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
varying vec3 vFogWorldPos;
#endif`;
THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
vFogWorldPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
export const ATMOS_GLSL = /* glsl */ `
uniform vec3 gSunDir; uniform vec3 gFogColor; uniform vec3 gFogSunColor; uniform vec3 gSunColor;
uniform float gFogDensity; uniform float gFogFalloff; uniform float gFogBase; uniform vec4 gMist;
float gg_fogAmount(vec3 ro, vec3 rd, float dist){
  float k = gFogFalloff;
  float h0 = max(ro.y - gFogBase, -20.0);
  float dy = rd.y * dist;
  float integ = abs(dy) > 0.05 ? (1.0 - exp(-k * dy)) / (k * rd.y) : dist;
  float amt = gFogDensity * exp(-k * h0) * integ;
  // highland mist: a dense, low layer around the plateau
  if (gMist.w > 0.0) {
    vec3 mp = ro + rd * min(dist, 400.0) * 0.6;
    float m = 1.0 - smoothstep(180.0, 420.0, length(mp.xz - gMist.xy));
    float hm = exp(-max(mp.y - gMist.z, 0.0) * 0.08);
    amt += gMist.w * m * hm * min(dist, 400.0) * 0.012;
  }
  return 1.0 - exp(-amt);
}
vec3 gg_fogColor(vec3 rd){
  float s = max(dot(rd, gSunDir), 0.0);
  return mix(gFogColor, gFogSunColor, pow(s, 5.0) * 0.85 + pow(s, 40.0) * 0.4);
}
vec3 gg_applyAtmos(vec3 col, vec3 wpos){
  vec3 rd = wpos - cameraPosition; float dist = length(rd); rd /= max(dist, 1e-4);
  float f = gg_fogAmount(cameraPosition, rd, dist);
  return mix(col, gg_fogColor(rd), f);
}`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
varying vec3 vFogWorldPos;
${ATMOS_GLSL}
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
gl_FragColor.rgb = gg_applyAtmos(gl_FragColor.rgb, vFogWorldPos);
#endif`;

export const NOISE_GLSL = GLSL_NOISE;

// The fog chunks above are global, so every built-in material needs the shared uniforms; without them the fog
// math divides by zero and the NaN gets smeared over the whole frame by bloom and AO. Also sanitize the output.
const GG_GUARD = '#include <dithering_fragment>\n{ uvec4 gg_b = floatBitsToUint(gl_FragColor) & 0x7f800000u; bvec4 gg_bad = equal(gg_b, uvec4(0x7f800000u)); gl_FragColor.rgb = any(gg_bad.rgb) ? vec3(0.0) : min(gl_FragColor.rgb, vec3(3.0e4)); gl_FragColor.a = gg_bad.a ? 0.0 : gl_FragColor.a; }';
THREE.Material.prototype.onBeforeCompile = function (s: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(s.uniforms, G);
  if (!s.fragmentShader.includes('gg_bad')) s.fragmentShader = s.fragmentShader.replace('#include <dithering_fragment>', GG_GUARD);
};
/** Attach the shared uniforms to a material and chain an optional extra shader patch. */
export function patchMaterial<T extends THREE.Material>(mat: T, extra?: (s: THREE.WebGLProgramParametersWithUniforms) => void, key = ''): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (s, r) => {
    prev.call(mat, s, r);
    Object.assign(s.uniforms, G);
    extra?.(s);
  };
  const pk = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => pk() + '|gg' + key;
  return mat;
}
