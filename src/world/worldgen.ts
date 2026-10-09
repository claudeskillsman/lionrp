import { fbm2, noise2, ridge2, smoothstep, clamp, lerp, hash2 } from '../engine/noise';

export const WORLD_SIZE = 2048;
export const HALF = WORLD_SIZE / 2;
export const HM_RES = 1024; // cells; vertices = HM_RES+1
export const CELL = WORLD_SIZE / HM_RES;
export const WATER_LEVEL = 0;
export const PLAY_LIMIT = 900;

type V2 = [number, number];
export const SPAWN: V2 = [0, 40];
export const HOLE: V2 = [70, -60];
export const KOPJE: V2 = [-200, -430];
export const OVERLOOK: V2 = [-150, -360];
export const WOOD: V2 = [520, 60];
export const HIGH: V2 = [520, -640];
export const RIVER: V2[] = [[-1150, -1100], [-820, -700], [-600, -380], [-560, -60], [-660, 260], [-610, 560], [-760, 860], [-1000, 1150]];
export const CANYON: V2[] = [[-260, 520], [-60, 600], [140, 690], [300, 640], [470, 760], [700, 860], [900, 980]];

export const BIOMES = {
  grassland: { name: 'Golden Grassland', tagline: 'The long grass', den: [-20, 110] as V2 },
  waterhole: { name: 'Watering Hole', tagline: 'Where every path meets', den: [130, -110] as V2 },
  woodland: { name: 'Acacia Woodland', tagline: 'Shade and high branches', den: [560, 120] as V2 },
  kopjes: { name: 'Sunstone Kopjes', tagline: 'Warm stone, wide views', den: [-150, -360] as V2 },
  river: { name: 'Reedwater Bank', tagline: 'Slow water, tall reeds', den: [-520, -40] as V2 },
  canyon: { name: 'Ochre Canyon', tagline: 'Red walls and echoes', den: [150, 610] as V2 },
  highland: { name: 'Mistveil Highland', tagline: 'Cool air above the clouds', den: [520, -640] as V2 },
};
export type BiomeKey = keyof typeof BIOMES;

function segDist(px: number, pz: number, a: V2, b: V2): [number, number] {
  const abx = b[0] - a[0], abz = b[1] - a[1];
  const t = clamp(((px - a[0]) * abx + (pz - a[1]) * abz) / (abx * abx + abz * abz), 0, 1);
  const dx = px - (a[0] + abx * t), dz = pz - (a[1] + abz * t);
  return [Math.sqrt(dx * dx + dz * dz), t];
}
// Catmull-Rom densified polylines for smooth rivers/canyons
function densify(pts: V2[], steps = 8): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
export const RIVER_PATH = densify(RIVER);
export const CANYON_PATH = densify(CANYON);
function pathDistExact(x: number, z: number, path: V2[]): number {
  let best = 1e9;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    // cheap reject
    const minx = Math.min(a[0], b[0]) - best, maxx = Math.max(a[0], b[0]) + best;
    if (x < minx || x > maxx) continue;
    const d = segDist(x, z, a, b)[0];
    if (d < best) best = d;
  }
  return best;
}

// Coarse precomputed distance fields (8m) so terrain generation stays fast.
const DF_EXT = 1400, DF_RES = 350, DF_CELL = (DF_EXT * 2) / DF_RES;
function buildDF(path: V2[]) {
  const f = new Float32Array((DF_RES + 1) * (DF_RES + 1));
  for (let j = 0; j <= DF_RES; j++) for (let i = 0; i <= DF_RES; i++) f[j * (DF_RES + 1) + i] = pathDistExact(-DF_EXT + i * DF_CELL, -DF_EXT + j * DF_CELL, path);
  return f;
}
let DF_R: Float32Array | null = null, DF_C: Float32Array | null = null;
function sampleDF(f: Float32Array, x: number, z: number) {
  const fx = clamp((x + DF_EXT) / DF_CELL, 0, DF_RES - 0.001), fz = clamp((z + DF_EXT) / DF_CELL, 0, DF_RES - 0.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, N = DF_RES + 1;
  const a = f[j * N + i], b = f[j * N + i + 1], c = f[(j + 1) * N + i], d = f[(j + 1) * N + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}
export function riverDist(x: number, z: number) { if (!DF_R) DF_R = buildDF(RIVER_PATH); return sampleDF(DF_R, x, z); }
export function canyonDist(x: number, z: number) { if (!DF_C) DF_C = buildDF(CANYON_PATH); return sampleDF(DF_C, x, z); }
export function pathDist(x: number, z: number, path: V2[]): number {
  if (path === RIVER_PATH) return riverDist(x, z);
  if (path === CANYON_PATH) return canyonDist(x, z);
  return pathDistExact(x, z, path);
}

export interface BiomeWeights { wood: number; kopje: number; canyon: number; high: number; river: number; hole: number; }

// Kopje domes: [x, z, radius, height, sharpness]
const DOMES: [number, number, number, number, number][] = [];
{
  const r = (i: number) => hash2(i, 77);
  for (let i = 0; i < 22; i++) {
    const a = r(i) * Math.PI * 2, d = 40 + r(i + 100) * 170;
    DOMES.push([KOPJE[0] + Math.cos(a) * d, KOPJE[1] + Math.sin(a) * d, 14 + r(i + 200) * 26, 5 + r(i + 300) * 14, 1.2 + r(i + 400)]);
  }
}
export const KOPJE_DOMES = DOMES;

export function warp(x: number, z: number, s: number, amt: number): V2 {
  return [x + noise2(x / s + 3.1, z / s) * amt, z + noise2(x / s, z / s - 7.7) * amt];
}

export function biomeWeights(x: number, z: number): BiomeWeights {
  const [wx, wz] = warp(x, z, 220, 90);
  const dW = Math.hypot(wx - WOOD[0], wz - WOOD[1]);
  const dK = Math.hypot(wx - KOPJE[0], wz - KOPJE[1]);
  const dH = Math.hypot(wx - HIGH[0], wz - HIGH[1]);
  const dHole = Math.hypot(x - HOLE[0], z - HOLE[1]) + noise2(x / 30, z / 30) * 10;
  return {
    wood: 1 - smoothstep(220, 420, dW),
    kopje: 1 - smoothstep(170, 300, dK),
    canyon: 1 - smoothstep(70, 230, pathDist(wx, wz, CANYON_PATH)),
    high: 1 - smoothstep(260, 400, dH),
    river: 1 - smoothstep(30, 140, pathDist(x + noise2(x / 60, z / 60) * 20, z, RIVER_PATH)),
    hole: 1 - smoothstep(40, 110, dHole),
  };
}

/** Analytic terrain height. The heightmap is a cache of this; the far ring uses it directly. */
export function heightAt(x: number, z: number): number {
  let h = 4 + fbm2(x / 380, z / 380, 4) * 8 + fbm2(x / 70, z / 70, 3) * 1.2;
  // gentle swells
  h += Math.sin(x / 160 + noise2(x / 400, z / 400) * 2) * 1.5;

  // highland plateau
  const [wx, wz] = warp(x, z, 200, 70);
  const dH = Math.hypot(wx - HIGH[0], wz - HIGH[1]);
  const mH = 1 - smoothstep(230, 400, dH);
  h += mH * (34 + ridge2(x / 160, z / 160) * 14 + fbm2(x / 40, z / 40, 3) * 2);

  // kopje domes
  const dK = Math.hypot(x - KOPJE[0], z - KOPJE[1]);
  if (dK < 420) {
    h += (1 - smoothstep(150, 320, dK)) * 3;
    for (const [dx, dz, r, hh, s] of DOMES) {
      const d = Math.hypot(x - dx, z - dz) / r;
      if (d < 1) h += hh * Math.pow(1 - d * d, s) * (1 + noise2(x / 9, z / 9) * 0.08);
    }
    // the overlook: a steep mesa with a jutting lip toward the south-east
    const ox = x - OVERLOOK[0], oz = z - OVERLOOK[1];
    const rot = 0.6, rx = ox * Math.cos(rot) - oz * Math.sin(rot), rz = ox * Math.sin(rot) + oz * Math.cos(rot);
    const box = Math.max(Math.abs(rx) / 26, Math.abs(rz + 4) / 40);
    const lip = Math.max(Math.abs(rx) / 9, Math.abs(rz - 38) / 14);
    const e = Math.min(box, lip) + noise2(x / 7, z / 7) * 0.05;
    const mesa = 1 - smoothstep(0.82, 1.0, e);
    // ramp on the back side so it is walkable
    const ramp = clamp(1 - (Math.abs(rx) / 9), 0, 1) * clamp(1 - (-(rz + 40)) / 70, 0, 1) * (rz < -40 ? 1 : 0);
    const top = 24 + noise2(x / 12, z / 12) * 0.6;
    h = Math.max(h, lerp(h, h * 0.2 + top, mesa), h + ramp * ramp * 22);
  }

  // canyon: elevated rim + carved stepped channel
  const dC = pathDist(wx, wz, CANYON_PATH);
  if (dC < 320) {
    const rim = 1 - smoothstep(60, 300, dC);
    h += rim * 10;
    const cut = 1 - smoothstep(16, 52 + noise2(x / 50, z / 50) * 10, dC);
    const depth = 30 * cut;
    // strata terraces
    const t = depth / 6, tf = Math.floor(t), tt = t - tf;
    const stepped = (tf + smoothstep(0.55, 1.0, tt)) * 6;
    h -= lerp(depth, stepped, 0.65);
  }

  // river channel and flood plain
  const dR = pathDist(x + noise2(x / 60, z / 60) * 20, z, RIVER_PATH);
  if (dR < 200) {
    const plain = 1 - smoothstep(40, 180, dR);
    h = lerp(h, 1.6 + fbm2(x / 50, z / 50, 2) * 0.8, plain * 0.85);
    const ch = 1 - smoothstep(9, 26, dR);
    h = lerp(h, -2.2, ch);
  }

  // watering hole
  const dHole = Math.hypot(x - HOLE[0], z - HOLE[1]) + noise2(x / 30, z / 30) * 10;
  if (dHole < 140) {
    const basin = 1 - smoothstep(30, 120, dHole);
    h = lerp(h, 1.2, basin * 0.9);
    h = lerp(h, -2.5, 1 - smoothstep(18, 48, dHole));
  }

  // boundary hills
  const e = Math.max(Math.abs(x), Math.abs(z));
  const edge = smoothstep(900, 1500, e + noise2(x / 200, z / 200) * 80);
  h += edge * (18 + ridge2(x / 260, z / 260) * 38);
  return h;
}

export class World {
  heights = new Float32Array((HM_RES + 1) * (HM_RES + 1));
  biomeA = new Uint8Array(HM_RES * HM_RES * 4); // wood, kopje, canyon, high
  biomeB = new Uint8Array(HM_RES * HM_RES * 4); // river, hole, grass density, wetness

  generate(onProgress?: (f: number) => void) {
    const N = HM_RES + 1;
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < N; i++) this.heights[j * N + i] = heightAt(-HALF + i * CELL, z);
      if (onProgress && (j & 63) === 0) onProgress(j / N * 0.7);
    }
    for (let j = 0; j < HM_RES; j++) {
      const z = -HALF + (j + 0.5) * CELL;
      for (let i = 0; i < HM_RES; i++) {
        const x = -HALF + (i + 0.5) * CELL;
        const w = biomeWeights(x, z);
        const o = (j * HM_RES + i) * 4;
        this.biomeA[o] = w.wood * 255; this.biomeA[o + 1] = w.kopje * 255; this.biomeA[o + 2] = w.canyon * 255; this.biomeA[o + 3] = w.high * 255;
        const h = this.height(x, z);
        const slope = this.slope(x, z);
        let grass = 1 - smoothstep(0.35, 0.7, slope);
        grass *= smoothstep(0.15, 0.9, h); // not under water
        grass *= 1 - w.canyon * 0.75 * smoothstep(0, -12, h - 10);
        grass *= 1 - w.hole * 0.6;
        grass *= 0.75 + 0.25 * noise2(x / 25, z / 25) + 0.15;
        // patchy bare earth
        grass *= smoothstep(-0.55, -0.2, noise2(x / 45 + 9, z / 45) + w.canyon * -0.4);
        const wet = clamp(1 - smoothstep(0.2, 3.5, h), 0, 1);
        this.biomeB[o] = w.river * 255; this.biomeB[o + 1] = w.hole * 255; this.biomeB[o + 2] = clamp(grass, 0, 1) * 255; this.biomeB[o + 3] = wet * 255;
      }
      if (onProgress && (j & 63) === 0) onProgress(0.7 + j / HM_RES * 0.3);
    }
  }
  height(x: number, z: number): number {
    const N = HM_RES + 1;
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= HM_RES || fz >= HM_RES) return heightAt(x, z);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = this.heights[j * N + i], b = this.heights[j * N + i + 1];
    const c = this.heights[(j + 1) * N + i], d = this.heights[(j + 1) * N + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  normal(x: number, z: number, out: { x: number; y: number; z: number }) {
    const e = 1.0;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    out.x = -hx / l; out.y = 2 * e / l; out.z = -hz / l;
    return out;
  }
  slope(x: number, z: number) {
    const e = 1.5;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  }
  sampleB(x: number, z: number, ch: number) {
    const i = clamp(Math.floor((x + HALF) / CELL), 0, HM_RES - 1), j = clamp(Math.floor((z + HALF) / CELL), 0, HM_RES - 1);
    return this.biomeB[(j * HM_RES + i) * 4 + ch] / 255;
  }
  sampleA(x: number, z: number, ch: number) {
    const i = clamp(Math.floor((x + HALF) / CELL), 0, HM_RES - 1), j = clamp(Math.floor((z + HALF) / CELL), 0, HM_RES - 1);
    return this.biomeA[(j * HM_RES + i) * 4 + ch] / 255;
  }
  biomeAt(x: number, z: number): BiomeKey {
    const w = biomeWeights(x, z);
    const list: [BiomeKey, number][] = [['woodland', w.wood], ['kopjes', w.kopje], ['canyon', w.canyon], ['highland', w.high], ['river', w.river], ['waterhole', w.hole]];
    list.sort((a, b) => b[1] - a[1]);
    return list[0][1] > 0.45 ? list[0][0] : 'grassland';
  }
  isWater(x: number, z: number) { return this.height(x, z) < WATER_LEVEL - 0.05 && (this.sampleB(x, z, 0) > 0.3 || this.sampleB(x, z, 1) > 0.3); }
}
