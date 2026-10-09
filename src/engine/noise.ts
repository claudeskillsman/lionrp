// Deterministic hash + value/gradient noise used by both CPU world generation and gameplay.
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);


// Gradient noise in [-1,1] (permutation-table Perlin, fast path for world generation)
const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337;
  for (let i = 255; i > 0; i--) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; const j = s % (i + 1); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GX = new Float32Array(16), GY = new Float32Array(16);
for (let i = 0; i < 16; i++) { GX[i] = Math.cos(i / 16 * Math.PI * 2 + 0.3); GY[i] = Math.sin(i / 16 * Math.PI * 2 + 0.3); }
export function noise2(x: number, y: number): number {
  const fx0 = Math.floor(x), fy0 = Math.floor(y);
  const ix = fx0 & 255, iy = fy0 & 255;
  const fx = x - fx0, fy = y - fy0;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = PERM[ix] + iy, b = PERM[ix + 1] + iy;
  const g00 = PERM[a] & 15, g01 = PERM[a + 1] & 15, g10 = PERM[b] & 15, g11 = PERM[b + 1] & 15;
  const n00 = GX[g00] * fx + GY[g00] * fy;
  const n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
  const n01 = GX[g01] * fx + GY[g01] * (fy - 1);
  const n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
  const nx0 = n00 + (n10 - n00) * u, nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 1.414;
}
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const g = (cx: number, cy: number, cz: number, dx: number, dy: number, dz: number) => {
    const h = hash3(cx, cy, cz);
    const th = h * 6.2831853, ph = hash3(cz, cx, cy) * 2 - 1;
    const s = Math.sqrt(1 - ph * ph);
    return Math.cos(th) * s * dx + Math.sin(th) * s * dy + ph * dz;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(g(ix, iy, iz, fx, fy, fz), g(ix + 1, iy, iz, fx - 1, fy, fz), u);
  const x10 = lerp(g(ix, iy + 1, iz, fx, fy - 1, fz), g(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), u);
  const x01 = lerp(g(ix, iy, iz + 1, fx, fy, fz - 1), g(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), u);
  const x11 = lerp(g(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), g(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 1.6;
}
export function fbm2(x: number, y: number, oct = 5, lac = 2.0, gain = 0.5): number {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += noise2(x, y) * a; n += a;
    a *= gain; const nx = x * lac + 17.3, ny = y * lac - 9.1;
    // rotate to reduce grid artifacts
    x = nx * 0.8 - ny * 0.6; y = nx * 0.6 + ny * 0.8;
  }
  return s / n;
}
export function ridge2(x: number, y: number, oct = 4): number {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += (1 - Math.abs(noise2(x, y))) * a; n += a;
    a *= 0.5; const nx = x * 2.03 + 3.1, ny = y * 2.03 - 7.7;
    x = nx * 0.8 - ny * 0.6; y = nx * 0.6 + ny * 0.8;
  }
  return s / n;
}
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const GLSL_NOISE = /* glsl */ `
float gg_hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 gg_hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float gg_hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 gg_hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz+33.33); return fract((p3.xxy + p3.yxx)*p3.zyx); }
float gg_vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(gg_hash12(i),gg_hash12(i+vec2(1,0)),u.x), mix(gg_hash12(i+vec2(0,1)),gg_hash12(i+vec2(1,1)),u.x), u.y); }
float gg_vnoise3(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.-2.*f);
  float a=gg_hash13(i), b=gg_hash13(i+vec3(1,0,0)), c=gg_hash13(i+vec3(0,1,0)), d=gg_hash13(i+vec3(1,1,0));
  float e=gg_hash13(i+vec3(0,0,1)), f2=gg_hash13(i+vec3(1,0,1)), g=gg_hash13(i+vec3(0,1,1)), h=gg_hash13(i+vec3(1,1,1));
  return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y), mix(mix(e,f2,u.x),mix(g,h,u.x),u.y), u.z); }
float gg_fbm(vec2 p){ float s=0., a=.5; mat2 m=mat2(.8,.6,-.6,.8); for(int i=0;i<5;i++){ s+=a*gg_vnoise(p); p=m*p*2.03+11.7; a*=.5;} return s; }
float gg_fbm3(vec3 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*gg_vnoise3(p); p=p*2.03+vec3(11.7,3.1,7.3); a*=.5;} return s; }
// returns (F1, F2, cellHash)
vec3 gg_worley3(vec3 p){ vec3 i=floor(p), f=fract(p); float d1=8., d2=8.; float id=0.;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec3 o=vec3(x,y,z); vec3 r=o+gg_hash33(i+o)-f; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; id=gg_hash13(i+o+.5);} else if(d<d2){ d2=d; } }
  return vec3(sqrt(d1), sqrt(d2), id); }
`;
