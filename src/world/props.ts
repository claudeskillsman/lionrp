import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World, HALF, KOPJE_DOMES, OVERLOOK, CANYON_PATH, WATER_LEVEL, biomeWeights } from './worldgen';
import { patchMaterial, NOISE_GLSL } from '../engine/atmosphere';
import { mulberry32, noise3, hash2 } from '../engine/noise';

export interface Collider { x: number; z: number; r: number; top: number; kind: 'rock' | 'tree'; climbTop?: number; }

// ---------- procedural textures ----------
function leafTexture(seed: number, tint: [number, number, number]) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  g.clearRect(0, 0, S, S);
  // clusters of tiny bipinnate leaflets
  for (let k = 0; k < 70; k++) {
    const cx = S * (0.12 + rnd() * 0.76), cy = S * (0.12 + rnd() * 0.76);
    const ang = rnd() * Math.PI * 2;
    const len = 20 + rnd() * 30;
    const shade = 0.75 + rnd() * 0.4;
    g.strokeStyle = `rgba(${60 * shade},${55 * shade},${30 * shade},0.9)`;
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len); g.stroke();
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      const px = cx + Math.cos(ang) * len * t, py = cy + Math.sin(ang) * len * t;
      for (const side of [-1, 1]) {
        const a2 = ang + side * (1.1 + rnd() * 0.3);
        const l2 = 4 + rnd() * 3;
        const r = tint[0] * shade * (0.8 + rnd() * 0.4), gg = tint[1] * shade * (0.8 + rnd() * 0.4), b = tint[2] * shade * (0.8 + rnd() * 0.4);
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        g.beginPath();
        g.ellipse(px + Math.cos(a2) * l2 * 0.5, py + Math.sin(a2) * l2 * 0.5, l2 * 0.55, 1.4, a2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- acacia tree geometry ----------
function tube(points: THREE.Vector3[], r0: number, r1: number, radial = 7) {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = Math.max(4, points.length * 3);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  // taper
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const P = curve.getSpacedPoints(segs);
  for (let i = 0; i <= segs; i++) {
    const r = r0 + (r1 - r0) * (i / segs);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const v = new THREE.Vector3().fromBufferAttribute(pos, k).sub(P[i]).multiplyScalar(r).add(P[i]);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}
interface TreeParts { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; height: number; canopyR: number; canopyY: number; }
function makeAcacia(seed: number, kind: 'umbrella' | 'tall' | 'dead'): TreeParts {
  const rnd = mulberry32(seed);
  const woods: THREE.BufferGeometry[] = [];
  const cards: THREE.BufferGeometry[] = [];
  const H = kind === 'tall' ? 9 + rnd() * 4 : 5 + rnd() * 3;
  const fork = H * (0.3 + rnd() * 0.15);
  const lean = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).multiplyScalar(0.8);
  const trunkTop = new THREE.Vector3(lean.x, fork, lean.z);
  woods.push(tube([new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(lean.x * 0.3, fork * 0.5, lean.z * 0.3), trunkTop], 0.28 + rnd() * 0.08, 0.2, 8));
  const nb = 3 + Math.floor(rnd() * 3);
  const canopyY = H;
  const canopyR = kind === 'tall' ? 3 + rnd() * 1.5 : 4.5 + rnd() * 2.5;
  const tips: THREE.Vector3[] = [];
  for (let b = 0; b < nb; b++) {
    const a = (b / nb) * Math.PI * 2 + rnd() * 0.8;
    const reach = canopyR * (0.45 + rnd() * 0.4);
    const end = new THREE.Vector3(Math.cos(a) * reach + lean.x, canopyY - 0.4 - rnd() * 1.2, Math.sin(a) * reach + lean.z);
    const mid = trunkTop.clone().lerp(end, 0.5); mid.y += 0.4; mid.x *= 0.8; mid.z *= 0.8;
    woods.push(tube([trunkTop.clone(), mid, end], 0.16, 0.06, 6));
    // twigs
    for (let t = 0; t < 3; t++) {
      const a2 = a + (rnd() - 0.5) * 1.6;
      const e2 = end.clone().add(new THREE.Vector3(Math.cos(a2) * canopyR * 0.35, 0.3 + rnd() * 0.5, Math.sin(a2) * canopyR * 0.35));
      woods.push(tube([end.clone(), end.clone().lerp(e2, 0.5).add(new THREE.Vector3(0, 0.2, 0)), e2], 0.06, 0.02, 4));
      tips.push(e2);
    }
    tips.push(end);
  }
  if (kind !== 'dead') {
    // flat layered canopy: horizontal cards around branch tips, plus a few tilted ones for volume
    for (const tip of tips) {
      const n = 4 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const s = 1.6 + rnd() * 1.6;
        const p = new THREE.PlaneGeometry(s, s);
        p.rotateX(-Math.PI / 2 + (rnd() - 0.5) * 0.5);
        p.rotateY(rnd() * Math.PI * 2);
        p.translate(tip.x + (rnd() - 0.5) * 1.6, tip.y + 0.15 + (rnd() - 0.2) * 0.5, tip.z + (rnd() - 0.5) * 1.6);
        cards.push(p);
      }
    }
  }
  const wood = mergeGeometries(woods.map((g) => g.toNonIndexed()))!;
  const leaves = cards.length ? mergeGeometries(cards)! : new THREE.BufferGeometry();
  if (cards.length) {
    // canopy normals point up-ish (soft, volumetric shading) and store height for sway
    const pos = leaves.getAttribute('position') as THREE.BufferAttribute;
    const nor = leaves.getAttribute('normal') as THREE.BufferAttribute;
    const c = new THREE.Vector3(lean.x, canopyY - 1.5, lean.z);
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).sub(c).normalize();
      v.y = Math.abs(v.y) + 0.6; v.normalize();
      nor.setXYZ(i, v.x, v.y, v.z);
    }
  }
  return { wood, leaves, height: H, canopyR, canopyY };
}

function makeRock(seed: number, flat = 0) {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const sx = 1 + (hash2(seed, 1) - 0.5) * 0.6, sy = (0.6 + hash2(seed, 2) * 0.5) * (1 - flat * 0.5), sz = 1 + (hash2(seed, 3) - 0.5) * 0.6;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3) * 0.22 + noise3(v.x * 3.5, v.y * 3.5 + seed, v.z * 3.5) * 0.07;
    // flattened planes like weathered granite
    let r = 1 + n;
    if (v.y > 0.55 - flat * 0.3) r *= 0.55 / Math.max(0.55, v.y) + 0.45;
    v.multiplyScalar(r);
    v.set(v.x * sx, Math.max(v.y * sy, -0.35), v.z * sz);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Split instances into a coarse spatial grid so each chunk is frustum culled on its own, in the main view and in every shadow cascade. */
function chunkedInstances(geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[], cell = 512): THREE.InstancedMesh[] {
  const bins = new Map<number, THREE.Matrix4[]>();
  const p = new THREE.Vector3();
  for (const m of ms) {
    p.setFromMatrixPosition(m);
    const k = Math.floor((p.x + HALF) / cell) * 64 + Math.floor((p.z + HALF) / cell);
    let b = bins.get(k); if (!b) bins.set(k, b = []);
    b.push(m);
  }
  const out: THREE.InstancedMesh[] = [];
  for (const [, b] of bins) {
    const im = new THREE.InstancedMesh(geo, mat, b.length);
    b.forEach((m, k) => im.setMatrixAt(k, m));
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    out.push(im);
  }
  return out;
}

export class Props {
  group = new THREE.Group();
  colliders: Collider[] = [];
  materials: THREE.Material[] = [];
  trees: { x: number; z: number; y: number; s: number; canopyY: number; canopyR: number }[] = [];
  constructor(public world: World, density = 1) {
    this.buildTrees(density);
    this.buildRocks();
    this.buildBushes(density);
  }
  private woodMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: '#5a4a3c', roughness: 0.92 });
    patchMaterial(m, (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vOP;\n${NOISE_GLSL}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat bark = gg_vnoise(vec2(atan(vOP.z, vOP.x) * 6.0, vOP.y * 9.0)) * 0.6 + gg_vnoise(vOP.xz * 20.0 + vOP.y * 3.0) * 0.4;\ndiffuseColor.rgb *= mix(vec3(0.62, 0.55, 0.5), vec3(1.15, 1.05, 0.95), bark);');
    }, 'wood');
    this.materials.push(m);
    return m;
  }
  private leafMaterial(tex: THREE.Texture) {
    const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
    patchMaterial(m, (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float gTime; uniform vec4 gWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 ip = instanceMatrix[3].xyz;
#else
vec3 ip = vec3(0.0);
#endif
float ph = dot(ip.xz, vec2(0.13, 0.17));
float sw = sin(gTime * 1.3 + ph + position.x * 0.3) * 0.06 + sin(gTime * 3.1 + position.z * 0.8 + ph) * 0.025;
transformed.xz += gWind.xy * sw * gWind.z * (position.y * 0.15);
transformed.y += sin(gTime * 2.3 + position.x + ph) * 0.03 * gWind.z;`);
      let lfb = THREE.ShaderChunk.lights_fragment_begin.split('RE_Direct( directLight,').join('GG_RE( directLight,');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvec3 ggTrans = vec3(0.0);')
        .replace('#include <lights_fragment_begin>', `#define GG_RE(dl, gp, gn, gv, gc, m, rl) RE_Direct(dl, gp, gn, gv, gc, m, rl); ggTrans += dl.color * pow(clamp(dot(gv, -dl.direction), 0.0, 1.0), 3.0);\n${lfb}`)
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.directDiffuse += ggTrans * diffuseColor.rgb * 0.8;');
    }, 'leaf');
    this.materials.push(m);
    return m;
  }
  private scatter(step: number, seed: number, accept: (x: number, z: number, r: () => number) => boolean, cb: (x: number, z: number, r: () => number) => void) {
    const rnd = mulberry32(seed);
    for (let z = -HALF + step; z < HALF - step; z += step) for (let x = -HALF + step; x < HALF - step; x += step) {
      const px = x + (rnd() - 0.5) * step * 0.9, pz = z + (rnd() - 0.5) * step * 0.9;
      if (Math.max(Math.abs(px), Math.abs(pz)) > 940) continue;
      if (accept(px, pz, rnd)) cb(px, pz, rnd);
    }
  }
  private buildTrees(density: number) {
    const w = this.world;
    const variants: TreeParts[] = [];
    for (let i = 0; i < 5; i++) variants.push(makeAcacia(100 + i, 'umbrella'));
    for (let i = 0; i < 2; i++) variants.push(makeAcacia(200 + i, 'tall'));
    variants.push(makeAcacia(300, 'dead'));
    const placements: { x: number; z: number; v: number; s: number; rot: number }[][] = variants.map(() => []);
    this.scatter(14 / Math.sqrt(density), 4242, (x, z, r) => {
      const h = w.height(x, z);
      if (h < WATER_LEVEL + 0.6) return false;
      if (w.slope(x, z) > 0.35) return false;
      const b = biomeWeights(x, z);
      let p = 0.012 + b.wood * 0.35 + b.river * 0.06 - b.high * 0.02 - b.canyon * 0.01 + b.hole * 0.03;
      // keep the spawn meadow open
      if (Math.hypot(x, z - 40) < 45) p = 0;
      return r() < p;
    }, (x, z, r) => {
      const b = biomeWeights(x, z);
      let v: number;
      if (b.canyon > 0.5 || (b.high > 0.5 && r() < 0.6)) v = 7;
      else if (b.river > 0.4 && r() < 0.6) v = 5 + Math.floor(r() * 2);
      else v = Math.floor(r() * 5);
      const s = 0.8 + r() * 0.45;
      placements[v].push({ x, z, v, s, rot: r() * Math.PI * 2 });
    });
    const wood = this.woodMaterial();
    const leafTex = leafTexture(7, [118, 128, 62]);
    const leaves = this.leafMaterial(leafTex);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    variants.forEach((tv, i) => {
      const list = placements[i];
      if (!list.length) return;
      const ms: THREE.Matrix4[] = [];
      list.forEach((t) => {
        const y = w.height(t.x, t.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
        sc.setScalar(t.s); p.set(t.x, y, t.z);
        m4.compose(p, q, sc);
        ms.push(m4.clone());
        this.colliders.push({ x: t.x, z: t.z, r: 0.45 * t.s, top: y + tv.canopyY * t.s, kind: 'tree', climbTop: y + (tv.canopyY - 1.2) * t.s });
        this.trees.push({ x: t.x, z: t.z, y, s: t.s, canopyY: tv.canopyY * t.s, canopyR: tv.canopyR * t.s });
      });
      for (const im of chunkedInstances(tv.wood, wood, ms)) this.group.add(im);
      if (tv.leaves.getAttribute('position')) for (const im of chunkedInstances(tv.leaves, leaves, ms)) this.group.add(im);
    });
  }
  private rockMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
    patchMaterial(m, (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPr; varying vec3 vONr;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_INSTANCING\nvWPr = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvWPr = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif\nvONr = normal;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWPr; varying vec3 vONr; uniform float gWet;\n${NOISE_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float n1 = gg_fbm3(vWPr * 0.6), n2 = gg_vnoise3(vWPr * 5.0);
vec3 granite = mix(vec3(0.46, 0.41, 0.36), vec3(0.66, 0.6, 0.52), n1) * (0.85 + 0.25 * n2);
float lichen = smoothstep(0.6, 0.75, gg_fbm3(vWPr * 1.3 + 4.0)) * smoothstep(0.2, 0.8, vONr.y);
granite = mix(granite, vec3(0.66, 0.62, 0.38), lichen * 0.5);
granite *= mix(0.65, 1.0, smoothstep(-0.6, 0.4, vONr.y)); // darker undersides
// rain: darker, puddles in hollows of flat tops
granite *= 1.0 - gWet * 0.35;
diffuseColor.rgb *= granite;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat puddle = gWet * smoothstep(0.85, 0.97, vONr.y) * smoothstep(0.45, 0.6, gg_fbm3(vWPr * 0.8));\nroughnessFactor = mix(0.85, 0.35, gWet * 0.6);\nroughnessFactor = mix(roughnessFactor, 0.04, puddle);');
    }, 'rock');
    this.materials.push(m);
    return m;
  }
  private buildRocks() {
    const w = this.world;
    const geos = [makeRock(1), makeRock(2), makeRock(3, 0.6), makeRock(4, 1)];
    const lists: THREE.Matrix4[][] = geos.map(() => []);
    const add = (x: number, z: number, s: number, flat: number, sink = 0.25, rot = 0) => {
      const y = w.height(x, z) - s * sink;
      const v = flat > 0.5 ? 3 : Math.floor(hash2(x | 0, z | 0) * 3);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot || hash2(z | 0, x | 0) * 6.28, 0)), new THREE.Vector3(s, s, s));
      lists[v].push(m);
      if (s > 0.9) this.colliders.push({ x, z, r: s * 0.95, top: y + s * 0.75, kind: 'rock' });
    };
    // kopjes: boulder piles on and around each dome
    const rnd = mulberry32(99);
    for (const [dx, dz, r, hh] of KOPJE_DOMES) {
      const n = 6 + Math.floor(rnd() * 8);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, d = r * (0.3 + rnd() * 0.9);
        const s = 1.2 + rnd() * 3.2 * (1 - d / r / 1.4);
        add(dx + Math.cos(a) * d, dz + Math.sin(a) * d, s, rnd() < 0.3 ? 1 : 0);
      }
      void hh;
    }
    // overlook: massive slabs crowning the mesa and a jutting lip
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 16;
      add(OVERLOOK[0] + Math.cos(a) * d, OVERLOOK[1] + Math.sin(a) * d, 2 + rnd() * 2.5, 1, 0.55);
    }
    // canyon: sandstone boulders along the floor
    for (let i = 0; i < CANYON_PATH.length; i++) {
      const [cx, cz] = CANYON_PATH[i];
      for (let k = 0; k < 3; k++) add(cx + (rnd() - 0.5) * 50, cz + (rnd() - 0.5) * 50, 0.8 + rnd() * 2.2, rnd() < 0.4 ? 1 : 0);
    }
    // scattered stones everywhere, more in highland/river
    this.scatter(22, 777, (x, z, r) => {
      const b = biomeWeights(x, z);
      return r() < 0.06 + b.high * 0.25 + b.river * 0.08 + b.kopje * 0.15;
    }, (x, z, r) => add(x, z, 0.3 + r() * 1.1, r() < 0.3 ? 1 : 0, 0.35));
    const mat = this.rockMaterial();
    geos.forEach((g, i) => {
      if (!lists[i].length) return;
      for (const im of chunkedInstances(g, mat, lists[i])) this.group.add(im);
    });
  }
  private buildBushes(density: number) {
    const w = this.world;
    const tex = leafTexture(11, [110, 112, 58]);
    const mat = this.leafMaterial(tex);
    const cards: THREE.BufferGeometry[] = [];
    const rnd = mulberry32(5);
    for (let i = 0; i < 14; i++) {
      const s = 0.9 + rnd() * 0.6;
      const p = new THREE.PlaneGeometry(s, s);
      p.rotateX((rnd() - 0.5) * 1.6); p.rotateY(rnd() * Math.PI);
      p.translate((rnd() - 0.5) * 1.1, 0.35 + rnd() * 0.6, (rnd() - 0.5) * 1.1);
      cards.push(p);
    }
    const geo = mergeGeometries(cards)!;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute, pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const v = new THREE.Vector3(pos.getX(i), pos.getY(i) - 0.2, pos.getZ(i)).normalize(); nor.setXYZ(i, v.x, v.y, v.z); }
    const ms: THREE.Matrix4[] = [];
    this.scatter(9 / Math.sqrt(density), 31, (x, z, r) => {
      const h = w.height(x, z);
      if (h < 0.6 || w.slope(x, z) > 0.4) return false;
      const b = biomeWeights(x, z);
      return r() < 0.03 + b.wood * 0.12 + b.river * 0.1 + b.kopje * 0.08 + b.high * 0.05;
    }, (x, z, r) => {
      const s = 0.7 + r() * 1.0;
      ms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, w.height(x, z) - 0.1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6.28, 0)), new THREE.Vector3(s, s * (0.7 + r() * 0.5), s)));
    });
    for (const im of chunkedInstances(geo, mat, ms)) this.group.add(im);
  }
  /** Push a circle out of solid props; returns ground override height when standing on a rock. */
  private grid: Map<number, Collider[]> | null = null;
  private cellOf(x: number, z: number) { return (Math.floor((x + HALF) / 16) & 0xffff) | ((Math.floor((z + HALF) / 16) & 0xffff) << 16); }
  private buildGrid() {
    this.grid = new Map();
    for (const c of this.colliders) {
      const r = c.r + 2;
      for (let x = c.x - r; x <= c.x + r + 16; x += 16) for (let z = c.z - r; z <= c.z + r + 16; z += 16) {
        if (x > c.x + r || z > c.z + r) continue;
        const k = this.cellOf(x, z);
        let l = this.grid.get(k); if (!l) this.grid.set(k, (l = []));
        if (!l.includes(c)) l.push(c);
      }
      for (const [x, z] of [[c.x - r, c.z - r], [c.x + r, c.z - r], [c.x - r, c.z + r], [c.x + r, c.z + r]]) {
        const k = this.cellOf(x, z); let l = this.grid.get(k); if (!l) this.grid.set(k, (l = [])); if (!l.includes(c)) l.push(c);
      }
    }
  }
  collide(p: THREE.Vector3, radius: number, feetY: number): number | null {
    if (!this.grid) this.buildGrid();
    let ground: number | null = null;
    const list = this.grid!.get(this.cellOf(p.x, p.z));
    if (!list) return null;
    for (const c of list) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr * rr) continue;
      if (c.kind === 'rock') {
        // walkable top: rounded cap
        const d = Math.sqrt(d2);
        const capH = c.top - (d / (c.r + 0.001)) ** 2 * c.r * 0.8;
        if (feetY > capH - 0.6) { ground = Math.max(ground ?? -1e9, Math.min(c.top, capH)); continue; }
      } else if (feetY > c.top - 0.5) continue;
      const d = Math.sqrt(d2) || 0.001;
      p.x = c.x + (dx / d) * rr; p.z = c.z + (dz / d) * rr;
    }
    return ground;
  }
  nearestTree(x: number, z: number, maxD: number) {
    let best = null as null | (typeof this.trees)[0], bd = maxD;
    for (const t of this.trees) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; best = t; } }
    return best;
  }
}
