import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World, WATER_LEVEL, biomeWeights, PLAY_LIMIT } from './worldgen';
import { patchMaterial, NOISE_GLSL, G } from '../engine/atmosphere';
import { mulberry32 } from '../engine/noise';
import { buildField, surfaceNets, cone, ell, V3, Prim } from '../cat/sdf';
import { noise3 } from '../engine/noise';

export type PreyKind = 'gazelle' | 'zebra' | 'wildebeest';
interface PreyDef { size: number; speed: number; color: string; belly: string; stripes: number; horns: number; legLen: number; neck: number; }
const DEFS: Record<PreyKind, PreyDef> = {
  gazelle: { size: 0.75, speed: 16, color: '#b9834a', belly: '#f0e6d4', stripes: 0, horns: 1, legLen: 0.62, neck: 0.85 },
  zebra: { size: 1.25, speed: 13, color: '#efe9de', belly: '#efe9de', stripes: 1, horns: 0, legLen: 0.6, neck: 1.0 },
  wildebeest: { size: 1.3, speed: 12, color: '#5c5650', belly: '#4a4440', stripes: 0, horns: 2, legLen: 0.62, neck: 0.9 },
};

/** Static meshes for body+head and one leg, built with the same SDF tools as the cats. */
function preyGeometry(kind: PreyKind) {
  const d = DEFS[kind];
  const L = d.legLen;
  const P: Prim[] = [];
  const H = L + 0.05;
  P.push(ell('b', [0, H + 0.12, 0], [0.2, 0.22, 0.48], 0.08));
  P.push(ell('b', [0, H + 0.1, -0.32], [0.19, 0.2, 0.2], 0.07));
  P.push(ell('b', [0, H + 0.12, 0.3], [0.19, 0.22, 0.2], 0.07));
  P.push(cone('b', [0, H + 0.18, 0.38], [0, H + 0.48 * d.neck, 0.62], 0.12, 0.07, 0.06));
  P.push(cone('b', [0, H + 0.5 * d.neck, 0.6], [0, H + 0.36 * d.neck, 0.86], 0.08, 0.045, 0.04));
  // ears
  P.push(ell('b', [0.07, H + 0.58 * d.neck, 0.6], [0.025, 0.06, 0.015], 0.015, 0, 0, 0, -0.7));
  P.push(ell('b', [-0.07, H + 0.58 * d.neck, 0.6], [0.025, 0.06, 0.015], 0.015, 0, 0, 0, 0.7));
  if (d.horns === 1) {
    P.push(cone('b', [0.03, H + 0.56 * d.neck, 0.64], [0.05, H + 0.82 * d.neck, 0.5], 0.018, 0.006, 0.01));
    P.push(cone('b', [-0.03, H + 0.56 * d.neck, 0.64], [-0.05, H + 0.82 * d.neck, 0.5], 0.018, 0.006, 0.01));
  } else if (d.horns === 2) {
    P.push(cone('b', [0.04, H + 0.56 * d.neck, 0.62], [0.17, H + 0.6 * d.neck, 0.62], 0.03, 0.015, 0.01));
    P.push(cone('b', [-0.04, H + 0.56 * d.neck, 0.62], [-0.17, H + 0.6 * d.neck, 0.62], 0.03, 0.015, 0.01));
    P.push(cone('b', [0.17, H + 0.6 * d.neck, 0.62], [0.16, H + 0.72 * d.neck, 0.6], 0.015, 0.005, 0.01));
    P.push(cone('b', [-0.17, H + 0.6 * d.neck, 0.62], [-0.16, H + 0.72 * d.neck, 0.6], 0.015, 0.005, 0.01));
    P.push(cone('b', [0, H + 0.3 * d.neck, 0.72], [0, H + 0.12 * d.neck, 0.7], 0.04, 0.02, 0.03)); // beard
  }
  // tail
  P.push(cone('b', [0, H + 0.2, -0.48], [0, H - 0.15, -0.56], 0.03, 0.02, 0.02));
  const f = buildField(P, 0.025, noise3);
  const body = surfaceNets(f);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(body.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(body.normals, 3));
  g.setIndex(body.indices);
  // leg: pivot at the top
  const leg = new THREE.CylinderGeometry(0.035, 0.018, L, 6, 3);
  leg.translate(0, -L / 2, 0);
  const hoof = new THREE.CylinderGeometry(0.022, 0.026, 0.05, 6); hoof.translate(0, -L + 0.02, 0);
  const legG = mergeGeometries([leg.toNonIndexed(), hoof.toNonIndexed()])!;
  return { body: g, leg: legG, H };
}

interface Animal { kind: PreyKind; pos: THREE.Vector3; yaw: number; speed: number; state: 'graze' | 'walk' | 'flee' | 'down'; t: number; phase: number; target: THREE.Vector3; head: number; alive: boolean; downT: number; idx: number; }
interface Herd { kind: PreyKind; center: THREE.Vector3; goal: THREE.Vector3; animals: Animal[]; }

export class Fauna {
  group = new THREE.Group();
  herds: Herd[] = [];
  private meshes = new Map<PreyKind, { body: THREE.InstancedMesh; legs: THREE.InstancedMesh; H: number; n: number; slot: number }>();
  private birds: THREE.InstancedMesh;
  private birdData: { c: THREE.Vector3; r: number; h: number; s: number; ph: number; vulture: boolean }[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3(1, 1, 1);
  materials: THREE.Material[] = [];
  constructor(public world: World, herdScale = 1) {
    const rnd = mulberry32(2024);
    const plan: [PreyKind, number, number][] = [['gazelle', 6, 12], ['zebra', 4, 10], ['wildebeest', 4, 14]];
    for (const [kind, herds, size] of plan) {
      const total = Math.round(herds * size * herdScale);
      const geo = preyGeometry(kind);
      const mat = this.material(kind);
      const body = new THREE.InstancedMesh(geo.body, mat, total);
      const legs = new THREE.InstancedMesh(geo.leg, mat, total * 4);
      body.castShadow = legs.castShadow = true; body.receiveShadow = true;
      body.frustumCulled = legs.frustumCulled = false;
      this.group.add(body, legs);
      this.meshes.set(kind, { body, legs, H: geo.H, n: total, slot: 0 });
      let idx = 0;
      for (let h = 0; h < herds; h++) {
        const c = this.randomGrazingSpot(rnd);
        const herd: Herd = { kind, center: c.clone(), goal: c.clone(), animals: [] };
        const n = Math.round(size * herdScale);
        for (let i = 0; i < n && idx < total; i++) {
          const p = c.clone().add(new THREE.Vector3((rnd() - 0.5) * 30, 0, (rnd() - 0.5) * 30));
          herd.animals.push({ kind, pos: p, yaw: rnd() * 6.28, speed: 0, state: 'graze', t: rnd() * 5, phase: rnd(), target: p.clone(), head: 1, alive: true, downT: 0, idx: idx++ });
        }
        this.herds.push(herd);
      }
    }
    // birds: small flocks + circling vultures
    const bw = new THREE.BufferGeometry();
    bw.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, -0.5, 0, -0.1, 0, 0, -0.15, 0, 0, 0.12, 0.5, 0, -0.1, 0, 0, -0.15], 3));
    bw.computeVertexNormals();
    const bm = new THREE.MeshStandardMaterial({ color: '#2a2622', side: THREE.DoubleSide, roughness: 0.9 });
    patchMaterial(bm, (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float gTime;').replace('#include <begin_vertex>', `#include <begin_vertex>\nfloat ph = float(gl_InstanceID) * 1.7; transformed.y += abs(position.x) * sin(gTime * (float(gl_InstanceID % 5) + 9.0) + ph) * 0.9;`);
    }, 'bird');
    const NB = 70;
    this.birds = new THREE.InstancedMesh(bw, bm, NB);
    this.birds.frustumCulled = false;
    for (let i = 0; i < NB; i++) {
      const vulture = i < 8;
      const c = this.randomGrazingSpot(rnd);
      this.birdData.push({ c, r: vulture ? 40 + rnd() * 40 : 15 + rnd() * 50, h: vulture ? 70 + rnd() * 50 : 8 + rnd() * 25, s: vulture ? 0.1 + rnd() * 0.05 : 0.25 + rnd() * 0.25, ph: rnd() * 6.28, vulture });
    }
    this.group.add(this.birds);
  }
  private randomGrazingSpot(rnd: () => number) {
    for (let k = 0; k < 200; k++) {
      const x = (rnd() - 0.5) * 1500, z = (rnd() - 0.5) * 1500;
      const b = biomeWeights(x, z);
      if (b.canyon > 0.4 || b.kopje > 0.5 || this.world.height(x, z) < 0.8 || this.world.slope(x, z) > 0.3) continue;
      return new THREE.Vector3(x, this.world.height(x, z), z);
    }
    return new THREE.Vector3(100, 2, 100);
  }
  private material(kind: PreyKind) {
    const d = DEFS[kind];
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 });
    patchMaterial(m, (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vOP; varying vec3 vON; uniform float gWet;\n${NOISE_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 base = vec3(${new THREE.Color(d.color).toArray().map((x) => x.toFixed(3)).join(',')});
vec3 belly = vec3(${new THREE.Color(d.belly).toArray().map((x) => x.toFixed(3)).join(',')});
vec3 c = mix(base, belly, smoothstep(-0.2, -0.7, vON.y));
${d.stripes ? 'float st = smoothstep(0.1, 0.3, sin((vOP.z * 9.0 + gg_vnoise3(vOP * 4.0) * 1.5 + abs(vOP.x) * 2.0) * 3.14159) ); c = mix(vec3(0.08,0.07,0.07), c, st); if (vOP.y < 0.25) c = mix(vec3(0.08,0.07,0.07), c, smoothstep(0.1,0.3,sin(vOP.y * 40.0)));' : ''}
${kind === 'gazelle' ? 'c = mix(c, vec3(0.12,0.08,0.06), smoothstep(0.04, 0.0, abs(vON.y + 0.05)) * smoothstep(0.4, 0.6, abs(vON.x)) * step(0.4, vOP.y));' : ''}
c *= 0.9 + 0.2 * gg_vnoise3(vOP * 8.0);
c *= 1.0 - gWet * 0.25;
diffuseColor.rgb *= c;`);
    }, 'prey' + kind);
    this.materials.push(m);
    return m;
  }
  /** threats: positions of cats with a 'stealth' factor (0 visible .. 1 hidden). */
  update(dt: number, cam: THREE.Vector3, threats: { pos: THREE.Vector3; stealth: number; speed: number }[]) {
    const w = this.world;
    // only animals near the camera are packed into the instance buffers, so far herds cost nothing in the main and shadow passes
    for (const [, m] of this.meshes) m.slot = 0;
    const VIEW2 = 340 * 340;
    for (const herd of this.herds) {
      // migrate slowly toward goals; pick new goals (water when far from it, otherwise grass)
      if (herd.center.distanceTo(herd.goal) < 10) {
        const a = Math.random() * 6.28, d = 60 + Math.random() * 160;
        const nx = THREE.MathUtils.clamp(herd.center.x + Math.cos(a) * d, -PLAY_LIMIT + 50, PLAY_LIMIT - 50), nz = THREE.MathUtils.clamp(herd.center.z + Math.sin(a) * d, -PLAY_LIMIT + 50, PLAY_LIMIT - 50);
        const b = biomeWeights(nx, nz);
        if (b.canyon < 0.4 && b.kopje < 0.5 && w.slope(nx, nz) < 0.3 && w.height(nx, nz) > 0.5) herd.goal.set(nx, 0, nz);
      }
      const toGoal = this.v.set(herd.goal.x - herd.center.x, 0, herd.goal.z - herd.center.z);
      const gl = toGoal.length();
      if (gl > 0.1) herd.center.addScaledVector(toGoal.normalize(), Math.min(gl, dt * 0.35));
      const mesh = this.meshes.get(herd.kind)!;
      for (const a of herd.animals) {
        if (!a.alive) continue;
        if (a.state === 'down') {
          a.downT += dt;
          if (a.downT > 25) a.alive = false;
          else if (a.pos.distanceToSquared(cam) < VIEW2) this.write(a, mesh);
          continue;
        }
        // threat check
        let flee: THREE.Vector3 | null = null;
        for (const t of threats) {
          const d = a.pos.distanceTo(t.pos);
          const detect = (a.kind === 'gazelle' ? 30 : 22) * (1 - t.stealth * 0.75) * (t.speed > 6 ? 1.4 : 1);
          if (d < detect) { flee = t.pos; break; }
        }
        if (flee) { a.state = 'flee'; a.t = 3 + Math.random() * 2; a.target.copy(a.pos).add(this.v.subVectors(a.pos, flee).setY(0).normalize().multiplyScalar(60)); }
        a.t -= dt;
        if (a.state !== 'flee' && a.t <= 0) {
          if (Math.random() < 0.6) { a.state = 'graze'; a.t = 3 + Math.random() * 8; }
          else { a.state = 'walk'; a.t = 2 + Math.random() * 4; a.target.set(herd.center.x + (Math.random() - 0.5) * 34, 0, herd.center.z + (Math.random() - 0.5) * 34); }
        }
        if (a.state === 'flee' && a.t <= 0) { a.state = 'walk'; a.t = 2; a.target.set(herd.center.x, 0, herd.center.z); }
        const want = a.state === 'flee' ? DEFS[a.kind].speed : a.state === 'walk' ? 1.3 : 0;
        a.speed += THREE.MathUtils.clamp(want - a.speed, -8 * dt, 6 * dt);
        if (a.state !== 'graze') {
          const dir = this.v.set(a.target.x - a.pos.x, 0, a.target.z - a.pos.z);
          if (dir.lengthSq() > 1) {
            const yaw = Math.atan2(dir.x, dir.z);
            let dy = yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            a.yaw += THREE.MathUtils.clamp(dy, -3 * dt, 3 * dt);
          } else if (a.state === 'walk') { a.state = 'graze'; a.t = 4; }
        }
        a.pos.x += Math.sin(a.yaw) * a.speed * dt; a.pos.z += Math.cos(a.yaw) * a.speed * dt;
        a.pos.x = THREE.MathUtils.clamp(a.pos.x, -PLAY_LIMIT, PLAY_LIMIT); a.pos.z = THREE.MathUtils.clamp(a.pos.z, -PLAY_LIMIT, PLAY_LIMIT);
        const gy = w.height(a.pos.x, a.pos.z);
        if (gy < WATER_LEVEL - 0.3) { a.yaw += Math.PI; a.pos.x += Math.sin(a.yaw) * 0.5; a.pos.z += Math.cos(a.yaw) * 0.5; }
        a.pos.y = Math.max(gy, WATER_LEVEL - 0.3);
        a.head += ((a.state === 'graze' ? 0 : 1) - a.head) * Math.min(1, dt * 3);
        a.phase = (a.phase + dt * (a.speed > 4 ? 2.6 : 1.4) * (a.speed > 0.1 ? 1 : 0)) % 1;
        if (a.pos.distanceToSquared(cam) < VIEW2) this.write(a, mesh);
      }
    }
    for (const [, m] of this.meshes) {
      m.body.count = m.slot; m.legs.count = m.slot * 4;
      m.body.instanceMatrix.needsUpdate = true; m.legs.instanceMatrix.needsUpdate = true;
    }
    // birds
    const t = G.gTime.value;
    for (let i = 0; i < this.birdData.length; i++) {
      const b = this.birdData[i];
      const a = t * b.s + b.ph;
      const p = this.v.set(b.c.x + Math.cos(a) * b.r, b.c.y + b.h + Math.sin(a * 2.3) * 3, b.c.z + Math.sin(a) * b.r);
      this.q.setFromEuler(new THREE.Euler(0, -a, b.vulture ? 0.25 : 0));
      const sc = b.vulture ? 2.2 : 0.35;
      this.m.compose(p, this.q, this.s.set(sc, sc, sc));
      this.birds.setMatrixAt(i, this.m);
    }
    this.birds.instanceMatrix.needsUpdate = true;
    this.s.set(1, 1, 1);
  }
  private write(a: Animal, mesh: { body: THREE.InstancedMesh; legs: THREE.InstancedMesh; H: number; slot: number }) {
    const idx = mesh.slot++;
    const d = DEFS[a.kind];
    const sz = d.size;
    const down = a.state === 'down' ? Math.min(1, a.downT * 2) : 0;
    const fade = a.state === 'down' ? Math.max(0, 1 - Math.max(0, a.downT - 20) / 5) : 1;
    const bob = a.speed > 4 ? Math.abs(Math.sin(a.phase * Math.PI * 2)) * 0.12 : 0;
    this.q.setFromEuler(new THREE.Euler(-(1 - a.head) * 0.08, a.yaw, down * 1.4, 'YXZ'));
    this.v.set(a.pos.x, a.pos.y + bob * sz - down * 0.45 * sz, a.pos.z);
    this.m.compose(this.v, this.q, this.s.set(sz * fade, sz * fade, sz * fade));
    mesh.body.setMatrixAt(idx, this.m);
    const L = DEFS[a.kind].legLen;
    const legs: [number, number, number][] = [[0.11, L + 0.05, 0.32], [-0.11, L + 0.05, 0.32], [0.1, L + 0.05, -0.32], [-0.1, L + 0.05, -0.32]];
    const gallop = a.speed > 4;
    for (let l = 0; l < 4; l++) {
      const off = gallop ? [0, 0.1, 0.5, 0.6][l] : [0, 0.5, 0.25, 0.75][l];
      const ph = (a.phase + off) * Math.PI * 2;
      const swing = a.speed > 0.1 ? Math.sin(ph) * (gallop ? 0.7 : 0.35) : 0;
      const lp = new THREE.Vector3(...legs[l]).multiplyScalar(sz).applyQuaternion(this.q).add(this.v);
      const lq = this.q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(swing + down * 0.5, 0, 0)));
      this.m.compose(lp, lq, this.s.set(sz * fade, sz * fade, sz * fade));
      mesh.legs.setMatrixAt(idx * 4 + l, this.m);
    }
    this.s.set(1, 1, 1);
  }
  /** Try to catch prey within reach; returns the kind caught or null. */
  tryCatch(p: THREE.Vector3, reach: number): PreyKind | null {
    for (const h of this.herds) for (const a of h.animals) {
      if (!a.alive || a.state === 'down') continue;
      if (a.pos.distanceTo(p) < reach) { a.state = 'down'; a.downT = 0; a.speed = 0; return a.kind; }
    }
    return null;
  }
  nearestPrey(p: THREE.Vector3, maxD: number) {
    let best: Animal | null = null, bd = maxD;
    for (const h of this.herds) for (const a of h.animals) { if (!a.alive || a.state === 'down') continue; const d = a.pos.distanceTo(p); if (d < bd) { bd = d; best = a; } }
    return best ? { pos: best.pos, dist: bd, kind: best.kind } : null;
  }
}
