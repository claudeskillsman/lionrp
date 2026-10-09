import * as THREE from 'three';
import { World, HALF, HM_RES, WORLD_SIZE, heightAt } from './worldgen';
import { patchMaterial, NOISE_GLSL } from '../engine/atmosphere';

export function makeWorldTextures(world: World) {
  const N = HM_RES + 1;
  const hdata = new Uint16Array(N * N);
  for (let i = 0; i < N * N; i++) hdata[i] = THREE.DataUtils.toHalfFloat(world.heights[i]);
  const tHeight = new THREE.DataTexture(hdata, N, N, THREE.RedFormat, THREE.HalfFloatType);
  tHeight.magFilter = tHeight.minFilter = THREE.LinearFilter;
  tHeight.wrapS = tHeight.wrapT = THREE.ClampToEdgeWrapping;
  tHeight.needsUpdate = true;
  const mk = (d: Uint8Array) => {
    const t = new THREE.DataTexture(d, HM_RES, HM_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
  };
  return { tHeight, tBiomeA: mk(world.biomeA), tBiomeB: mk(world.biomeB) };
}
export type WorldTextures = ReturnType<typeof makeWorldTextures>;

export const TERRAIN_COLOR_GLSL = /* glsl */ `
uniform sampler2D tBiomeA; uniform sampler2D tBiomeB;
uniform float gWet; uniform float gTime;
vec2 worldUV(vec2 xz){ return (xz + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)}; }
vec3 terrainAlbedo(vec3 wp, vec3 n, out float rough){
  vec2 uv = worldUV(wp.xz);
  vec4 A = texture2D(tBiomeA, uv); vec4 B = texture2D(tBiomeB, uv);
  float outside = step(1.0, max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0);
  A *= 1.0 - outside; B *= 1.0 - outside;
  float n1 = gg_fbm(wp.xz * 0.05), n2 = gg_vnoise(wp.xz * 0.7), n3 = gg_fbm(wp.xz * 0.008);
  vec3 soil = mix(vec3(0.30, 0.21, 0.12), vec3(0.40, 0.29, 0.17), n1);
  vec3 straw = mix(vec3(0.50, 0.35, 0.15), vec3(0.60, 0.44, 0.22), n3) * (0.9 + 0.2 * n2);
  float grass = B.z;
  vec3 col = mix(soil, straw, smoothstep(0.1, 0.7, grass));
  // woodland: richer, a little greener
  vec3 wood = mix(vec3(0.40, 0.33, 0.18), vec3(0.50, 0.46, 0.24), n1);
  col = mix(col, mix(wood, straw * vec3(0.92, 0.98, 0.8), grass * 0.7), A.x * 0.8);
  // highland: cool grey-green with heather
  vec3 high = mix(vec3(0.30, 0.34, 0.24), vec3(0.42, 0.42, 0.30), n1);
  high = mix(high, vec3(0.38, 0.27, 0.34), smoothstep(0.62, 0.8, gg_fbm(wp.xz * 0.03 + 7.0)) * 0.6);
  col = mix(col, high, A.w);
  // canyon floor: ochre dust
  vec3 canyon = mix(vec3(0.62, 0.36, 0.20), vec3(0.72, 0.48, 0.28), n1);
  col = mix(col, canyon, A.z * (1.0 - grass * 0.6));
  // river and waterhole: dark moist earth, green fringe
  vec3 moist = mix(vec3(0.24, 0.20, 0.13), vec3(0.32, 0.34, 0.16), n1);
  float wet = B.w;
  col = mix(col, moist, max(B.x * 0.65, B.y * 0.5) * (1.0 - grass * 0.5));
  col = mix(col, vec3(0.18, 0.14, 0.10), wet * 0.85);
  // rock on steep slopes
  float slope = 1.0 - n.y;
  float rockAmt = smoothstep(0.22, 0.42, slope + (n2 - 0.5) * 0.12);
  float strata = sin(wp.y * 1.7 + gg_fbm(wp.xz * 0.02) * 6.0) * 0.5 + 0.5;
  vec3 granite = mix(vec3(0.52, 0.47, 0.42), vec3(0.66, 0.60, 0.52), n2) * (0.85 + 0.25 * gg_fbm(wp.xz * 0.3 + wp.y * 0.2));
  granite = mix(granite, vec3(0.62, 0.62, 0.42), smoothstep(0.7, 0.85, gg_fbm(wp.xz * 0.2)) * 0.35); // lichen
  vec3 sandstone = mix(vec3(0.62, 0.30, 0.16), vec3(0.80, 0.52, 0.32), strata) * (0.85 + 0.2 * n2);
  vec3 rock = mix(granite, sandstone, clamp(A.z * 1.5, 0.0, 1.0));
  rock = mix(rock, vec3(0.40, 0.42, 0.38), A.w * 0.7);
  col = mix(col, rock, rockAmt);
  rough = mix(0.95, 0.78, rockAmt);
  // rain darkens everything and adds sheen
  col *= 1.0 - gWet * 0.35;
  rough = mix(rough, 0.35, gWet * 0.8);
  return col;
}`;

function terrainMaterial(tex: WorldTextures) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  patchMaterial(mat, (s) => {
    s.uniforms.tBiomeA = { value: tex.tBiomeA };
    s.uniforms.tBiomeB = { value: tex.tBiomeB };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz; vWN = normal;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP; varying vec3 vWN;\n${NOISE_GLSL}\n${TERRAIN_COLOR_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat tRough; vec3 tAlb = terrainAlbedo(vWP, normalize(vWN), tRough); diffuseColor.rgb *= tAlb;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;');
  }, 'terrain');
  return mat;
}

const CHUNK = 128;
const LODS = [64, 32, 16, 8];
const LOD_DIST = [230, 520, 1000];

export class Terrain {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  chunks: { mesh: THREE.Mesh; cx: number; cz: number; lod: number; geos: (THREE.BufferGeometry | null)[] }[] = [];
  constructor(public world: World, tex: WorldTextures) {
    this.material = terrainMaterial(tex);
    const n = WORLD_SIZE / CHUNK;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = -HALF + (i + 0.5) * CHUNK, cz = -HALF + (j + 0.5) * CHUNK;
      const geos: (THREE.BufferGeometry | null)[] = [null, null, null, null];
      const mesh = new THREE.Mesh(undefined, this.material);
      mesh.receiveShadow = true; mesh.castShadow = true;
      const c = { mesh, cx, cz, lod: -1, geos };
      this.chunks.push(c);
      this.group.add(mesh);
    }
    this.group.add(this.buildFarRing());
  }
  private chunkGeo(cx: number, cz: number, segs: number) {
    const w = this.world;
    const verts = (segs + 1) * (segs + 1);
    const skirt = segs * 4;
    const pos = new Float32Array((verts + skirt + 4) * 3);
    const nor = new Float32Array((verts + skirt + 4) * 3);
    const step = CHUNK / segs;
    const x0 = cx - CHUNK / 2, z0 = cz - CHUNK / 2;
    const nv = { x: 0, y: 1, z: 0 };
    let k = 0;
    for (let j = 0; j <= segs; j++) for (let i = 0; i <= segs; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      pos[k * 3] = x - cx; pos[k * 3 + 1] = w.height(x, z); pos[k * 3 + 2] = z - cz;
      w.normal(x, z, nv); nor[k * 3] = nv.x; nor[k * 3 + 1] = nv.y; nor[k * 3 + 2] = nv.z;
      k++;
    }
    const idx: number[] = [];
    for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // skirts
    const edge: number[] = [];
    for (let i = 0; i <= segs; i++) edge.push(i);
    for (let j = 1; j <= segs; j++) edge.push(j * (segs + 1) + segs);
    for (let i = segs - 1; i >= 0; i--) edge.push(segs * (segs + 1) + i);
    for (let j = segs - 1; j >= 0; j--) edge.push(j * (segs + 1));
    const base = k;
    for (const e of edge) {
      pos[k * 3] = pos[e * 3]; pos[k * 3 + 1] = pos[e * 3 + 1] - 4; pos[k * 3 + 2] = pos[e * 3 + 2];
      nor[k * 3] = nor[e * 3]; nor[k * 3 + 1] = nor[e * 3 + 1]; nor[k * 3 + 2] = nor[e * 3 + 2];
      k++;
    }
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i], b = edge[i + 1], c = base + i, d = base + i + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, k * 3), 3));
    g.setIndex(idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  private buildFarRing() {
    // coarse land outside the playable square so the savanna reaches the horizon
    const R = 7000, step = 80;
    const n = Math.ceil((R * 2) / step);
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    const id = new Int32Array((n + 1) * (n + 1)).fill(-1);
    const e = 4;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = -R + i * step, z = -R + j * step;
      const inside = Math.abs(x) < HALF - step && Math.abs(z) < HALF - step;
      if (inside) continue;
      const h = heightAt(x, z) - (Math.max(Math.abs(x), Math.abs(z)) < HALF + 10 ? 1.5 : 0);
      id[j * (n + 1) + i] = pos.length / 3;
      pos.push(x, h, z);
      const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
      const l = Math.hypot(hx, 2 * e, hz); nor.push(-hx / l, 2 * e / l, -hz / l);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = id[j * (n + 1) + i], b = id[j * (n + 1) + i + 1], c = id[(j + 1) * (n + 1) + i], d = id[(j + 1) * (n + 1) + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, this.material);
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  }
  update(cam: THREE.Vector3, lodBias = 1, budget = 4) {
    let built = 0;
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(c.cx - cam.x, c.cz - cam.z) - CHUNK * 0.7) / lodBias;
      let lod = 3;
      for (let i = 0; i < 3; i++) if (d < LOD_DIST[i]) { lod = i; break; }
      if (lod === c.lod) continue;
      if (!c.geos[lod]) {
        if (built >= budget && c.lod >= 0) continue; // spread the work; keep current LOD meanwhile
        c.geos[lod] = this.chunkGeo(c.cx, c.cz, LODS[lod]);
        built++;
      }
      c.mesh.geometry = c.geos[lod]!;
      c.mesh.position.set(c.cx, 0, c.cz);
      c.lod = lod;
    }
  }
}
