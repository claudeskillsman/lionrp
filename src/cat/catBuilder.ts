import * as THREE from 'three';
import { CatConfig, SPECIES, LIFE_STAGES } from './catConfig';
import { Prim, cone, ell, TAG, V3, buildField, surfaceNets, primDist } from './sdf';
import { noise3 } from '../engine/noise';

export interface BoneDef { name: string; parent: string | null; pos: V3; }
export interface CatShape {
  bones: BoneDef[];
  prims: Prim[];
  scale: number; // overall metres scale (applied to the whole rig)
  headC: V3; headS: number; eyeL: V3; eyeR: V3; eyeR_: number; noseTip: V3; earL: V3; earR: V3;
  spineH: number; tailBones: string[];
  legLen: { front: number[]; hind: number[] };
  furLen: number; maneLen: number; hasMane: boolean;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const mir = (a: V3): V3 => [-a[0], a[1], a[2]];

/** Build skeleton + SDF primitives in unit (lion-sized) space; the rig is scaled as a whole afterwards. */
export function catShape(cfg: CatConfig): CatShape {
  const sp = SPECIES[cfg.species];
  const ls = LIFE_STAGES[cfg.lifeStage];
  const build = cfg.build; // 0..1
  const bw = 0.95 + build * 0.32; // body width factor
  const legT = 0.85 + build * 0.3; // leg thickness
  const L = sp.body * (cfg.lifeStage === 'cub' ? 0.82 : 1);
  const legs = sp.legs * ls.legs;
  const H = 0.86 * legs; // spine height
  const hs = sp.head * ls.head; // head scale
  const tail = sp.tail * (cfg.lifeStage === 'cub' ? 0.8 : 1);
  const tt = sp.tailThick;
  const paw = ls.paws;
  const elder = cfg.lifeStage === 'elder';
  const sag = elder ? 0.03 : 0;

  const bones: BoneDef[] = [];
  const B = (name: string, parent: string | null, pos: V3) => { bones.push({ name, parent, pos }); return pos; };
  B('root', null, [0, 0, 0]);
  const hips = B('hips', 'root', [0, H - 0.01, -0.46 * L]);
  const spine1 = B('spine1', 'hips', [0, H + 0.02 - sag, -0.14 * L]);
  const spine2 = B('spine2', 'spine1', [0, H + 0.03 - sag, 0.18 * L]);
  const chest = B('chest', 'spine2', [0, H + 0.03, 0.40 * L]);
  const neck = B('neck', 'chest', [0, H + 0.04 - sag, 0.55 * L]);
  const headC: V3 = [0, H + 0.1 * sp.neck - sag * 2, 0.55 * L + 0.27 * sp.neck * Math.max(0.85, hs)];
  const head = B('head', 'neck', headC);
  B('jaw', 'head', add(headC, sc([0, -0.05, -0.01], hs)));
  const earL = add(headC, sc([0.078, 0.092, -0.045], hs));
  const earR = mir(earL) as V3; earR[1] = earL[1]; earR[2] = earL[2];
  B('earL', 'head', earL); B('earR', 'head', earR);
  // tail chain
  const tailBones: string[] = [];
  let tp: V3 = [0, H + 0.02, -0.62 * L];
  let prev = 'hips';
  const tsegs = 7;
  const tlen = 0.95 * tail;
  for (let i = 0; i <= tsegs; i++) {
    const n = 'tail' + i;
    B(n, prev, tp);
    tailBones.push(n);
    prev = n;
    const t = i / tsegs;
    const dir: V3 = [0, -0.55 - t * 0.35, -0.85 + t * 0.45];
    const dl = Math.hypot(dir[1], dir[2]);
    tp = add(tp, [0, dir[1] / dl * tlen / tsegs, dir[2] / dl * tlen / tsegs]);
  }
  // legs (left = +x)
  const fl = (s: number) => {
    const S = s > 0 ? 'L' : 'R';
    const x = 0.13 * bw * s;
    const scap = B('scap' + S, 'chest', [x * 0.9, H + 0.02, 0.38 * L]);
    const shoulder = B('hum' + S, 'scap' + S, [x * 1.25, H - 0.2 * legs, 0.47 * L]);
    const elbow = B('fore' + S, 'hum' + S, [x * 1.25, H * 0.5, 0.36 * L]);
    const wrist = B('carp' + S, 'fore' + S, [x * 1.2, 0.12 * legs, 0.40 * L]);
    const pawP = B('fpaw' + S, 'carp' + S, [x * 1.2, 0.035, 0.47 * L]);
    return { scap, shoulder, elbow, wrist, pawP };
  };
  const hl = (s: number) => {
    const S = s > 0 ? 'L' : 'R';
    const x = 0.12 * bw * s;
    const hip = B('fem' + S, 'hips', [x * 1.15, H - 0.1, -0.47 * L]);
    const knee = B('tib' + S, 'fem' + S, [x * 1.3, H * 0.52, -0.30 * L]);
    const hock = B('tar' + S, 'tib' + S, [x * 1.2, 0.27 * legs, -0.62 * L]);
    const pawP = B('hpaw' + S, 'tar' + S, [x * 1.2, 0.035, -0.55 * L]);
    return { hip, knee, hock, pawP };
  };
  const FL = fl(1), FR = fl(-1), HL = hl(1), HR = hl(-1);

  // ---------- primitives ----------
  const P: Prim[] = [];
  const chestDepth = sp.chest;
  // torso
  P.push(ell('spine2', [0, H - 0.07, 0.17 * L], [0.21 * bw, 0.27 * chestDepth, 0.36 * L], 0.08));
  P.push(ell('chest', [0, H - 0.13 * chestDepth, 0.36 * L], [0.18 * bw, 0.27 * chestDepth, 0.18 * L], 0.07));
  P.push(cone('spine1', [0, H - 0.08, 0.0], [0, H - 0.04 + 0.02 * (1 - sp.waist), -0.36 * L], 0.23 * bw * (0.7 + sp.waist * 0.3), 0.19 * bw * sp.waist, 0.1));
  P.push(ell('hips', [0, H - 0.08, -0.47 * L], [0.18 * bw, 0.2, 0.19], 0.08));
  // spine ridge to keep the back line smooth
  P.push(cone('spine1', [0, H - 0.06, -0.45 * L], [0, H - 0.01 - sag, 0.1 * L], 0.12 * bw, 0.13 * bw, 0.08));
  P.push(cone('chest', [0, H - 0.01 - sag, 0.1 * L], [0, H + 0.0, 0.42 * L], 0.13 * bw, 0.15 * bw, 0.08));
  // neck
  const neckR = 0.15 * sp.neck * (0.9 + build * 0.2);
  P.push(cone('neck', [0, H - 0.06, 0.44 * L], add(headC, sc([0, -0.05, -0.06], hs)), neckR, 0.12 * hs, 0.08, TAG.NECK));
  // shoulders + front legs
  for (const [leg, s] of [[FL, 1], [FR, -1]] as const) {
    P.push(cone('scap' + (s > 0 ? 'L' : 'R'), [leg.scap[0], leg.scap[1] - 0.03, leg.scap[2] - 0.04], leg.shoulder, 0.085 * legT, 0.105 * legT, 0.07, TAG.BODY));
    P.push(cone('hum' + (s > 0 ? 'L' : 'R'), leg.shoulder, leg.elbow, 0.12 * legT, 0.085 * legT, 0.05, TAG.LEG));
    P.push(cone('fore' + (s > 0 ? 'L' : 'R'), leg.elbow, leg.wrist, 0.08 * legT, 0.052 * legT, 0.035, TAG.LEG));
    P.push(cone('carp' + (s > 0 ? 'L' : 'R'), leg.wrist, add(leg.pawP, [0, 0.01, -0.02]), 0.046 * legT, 0.044 * legT * paw, 0.03, TAG.LEG));
    const pc: V3 = add(leg.pawP, [0, 0.005, 0.02]);
    P.push(ell('fpaw' + (s > 0 ? 'L' : 'R'), pc, [0.058 * paw * legT, 0.038 * paw, 0.07 * paw], 0.025, TAG.PAW));
    for (let t = 0; t < 4; t++) {
      const ox = (t - 1.5) * 0.026 * paw * legT;
      P.push(ell('fpaw' + (s > 0 ? 'L' : 'R'), add(pc, [ox, -0.004, 0.055 * paw - Math.abs(t - 1.5) * 0.008]), [0.017 * paw, 0.022 * paw, 0.022 * paw], 0.012, TAG.PAW));
    }
  }
  // haunches + hind legs
  for (const [leg, s] of [[HL, 1], [HR, -1]] as const) {
    const S = s > 0 ? 'L' : 'R';
    P.push(ell('fem' + S, add(leg.hip, [0.0, -0.1, 0.03]), [0.11 * bw * legT, 0.21, 0.15], 0.09, TAG.BODY, 0.45));
    P.push(cone('fem' + S, leg.hip, leg.knee, 0.13 * legT, 0.062 * legT, 0.07, TAG.LEG));
    P.push(cone('tib' + S, leg.knee, leg.hock, 0.06 * legT, 0.042 * legT, 0.065, TAG.LEG));
    P.push(cone('tar' + S, leg.hock, add(leg.pawP, [0, 0.01, -0.02]), 0.038 * legT, 0.040 * legT * paw, 0.03, TAG.LEG));
    const pc: V3 = add(leg.pawP, [0, 0.004, 0.02]);
    P.push(ell('hpaw' + S, pc, [0.05 * paw * legT, 0.035 * paw, 0.062 * paw], 0.022, TAG.PAW));
    for (let t = 0; t < 4; t++) {
      const ox = (t - 1.5) * 0.022 * paw * legT;
      P.push(ell('hpaw' + S, add(pc, [ox, -0.004, 0.048 * paw - Math.abs(t - 1.5) * 0.007]), [0.015 * paw, 0.02 * paw, 0.02 * paw], 0.011, TAG.PAW));
    }
  }
  // tail stub (rest of the tail is a swept tube)
  P.push(cone('tail0', [0, H - 0.02, -0.55 * L], add(tailBonesPos(bones, 'tail1'), [0, 0, 0]), 0.075 * tt, 0.052 * tt, 0.06, TAG.TAIL));

  // head (in head space, scaled by hs). +z is the muzzle direction.
  const hp = (x: number, y: number, z: number): V3 => add(headC, sc([x, y, z], hs));
  const muz = sp.muzzle;
  const mz = (z: number) => z * muz; // muzzle length scaling for forward features
  // cranium: broad and a little flat on top
  P.push(ell('head', hp(0, 0.025, -0.04), [0.118 * hs, 0.098 * hs, 0.125 * hs], 0.05, TAG.HEAD));
  // cheeks / zygomatic arches
  P.push(ell('head', hp(0.074, -0.012, 0.035), [0.062 * hs, 0.058 * hs, 0.07 * hs], 0.045, TAG.HEAD));
  P.push(ell('head', hp(-0.074, -0.012, 0.035), [0.062 * hs, 0.058 * hs, 0.07 * hs], 0.045, TAG.HEAD));
  // brow ridges
  P.push(ell('head', hp(0.044, 0.062, 0.072), [0.04 * hs, 0.026 * hs, 0.042 * hs], 0.03, TAG.HEAD));
  P.push(ell('head', hp(-0.044, 0.062, 0.072), [0.04 * hs, 0.026 * hs, 0.042 * hs], 0.03, TAG.HEAD));
  // long flat nose bridge
  P.push(ell('head', hp(0, 0.04, mz(0.125)), [0.05 * hs, 0.034 * hs, 0.095 * hs * muz], 0.04, TAG.MUZZLE));
  // muzzle body and squared whisker pads
  P.push(cone('head', hp(0, -0.005, 0.07), hp(0, -0.015, mz(0.175)), 0.068 * hs, 0.05 * hs, 0.04, TAG.MUZZLE));
  P.push(ell('head', hp(0.034, -0.026, mz(0.18)), [0.04 * hs, 0.036 * hs, 0.046 * hs], 0.025, TAG.MUZZLE));
  P.push(ell('head', hp(-0.034, -0.026, mz(0.18)), [0.04 * hs, 0.036 * hs, 0.046 * hs], 0.025, TAG.MUZZLE));
  const noseTip = hp(0, 0.022, mz(0.222));
  P.push(ell('head', add(noseTip, sc([0, -0.004, -0.01], hs)), [0.03 * hs, 0.02 * hs, 0.02 * hs], 0.018, TAG.MUZZLE));
  // jaw / chin (on the jaw bone so the mouth can open)
  P.push(cone('jaw', hp(0, -0.065, 0.0), hp(0, -0.066, mz(0.17)), 0.05 * hs, 0.032 * hs, 0.03, TAG.MUZZLE));
  // eye sockets
  const eyeY = 0.044, eyeZ = 0.1, eyeX = 0.05;
  const eyeL = hp(eyeX, eyeY, eyeZ), eyeR = hp(-eyeX, eyeY, eyeZ);
  const eyeRad = 0.024 * hs * (cfg.lifeStage === 'cub' ? 1.15 : 1);
  for (const e of [eyeL, eyeR]) {
    const sub = ell('head', add(e, sc([0, 0, 0.008], hs)), [eyeRad * 1.05, eyeRad * 0.85, eyeRad * 0.9], 0.01, TAG.HEAD);
    sub.sub = true; P.push(sub);
  }
  // ears: rounded, cupped, slightly tilted outward
  const earSz = 0.05 * sp.ears * ls.ears * hs;
  for (const [e, s] of [[earL, 1], [earR, -1]] as const) {
    const pr = ell('ear' + (s > 0 ? 'L' : 'R'), add(e, [0.008 * s, earSz * 0.75, -0.005]), [earSz * 0.95, earSz * (1.05 + sp.earPoint), earSz * 0.32], 0.02, TAG.EAR, -0.15, 0.35 * s, -0.25 * s);
    P.push(pr);
    // cup
    const cup = ell('ear' + (s > 0 ? 'L' : 'R'), add(e, [0.012 * s, earSz * 0.85, earSz * 0.22]), [earSz * 0.65, earSz * 0.8, earSz * 0.22], 0.01, TAG.EAR, -0.15, 0.35 * s, -0.25 * s);
    cup.sub = true; P.push(cup);
  }

  // mane
  const hasMane = cfg.mane !== 'none';
  const ml = hasMane ? cfg.maneLength : 0;
  if (hasMane) {
    const style = cfg.mane;
    const big = style === 'short' ? 0.55 : style === 'wild' ? 1.15 : 1.0;
    const m = (0.6 + 0.6 * ml) * big;
    const back = style === 'swept' ? -0.04 : 0;
    // collar around the neck and behind the head
    const p1 = ell('neck', [0, H + 0.06, 0.52 * L + back], [0.24 * m * bw, 0.27 * m, 0.2 * m], 0.08, TAG.MANE);
    const p2 = ell('head', hp(0, 0.0, -0.09 + back), [0.2 * m, 0.22 * m, 0.13 * m], 0.08, TAG.MANE);
    const p3 = ell('chest', [0, H - 0.2, 0.5 * L], [0.17 * m * bw, 0.22 * m, 0.14 * m], 0.08, TAG.MANE);
    for (const p of [p1, p2, p3]) { p.noiseAmp = 0.035 * m * (style === 'wild' ? 1.6 : 1); p.noiseFreq = style === 'swept' ? 9 : 14; P.push(p); }
    // ruff under the jaw
    P.push(Object.assign(ell('neck', hp(0, -0.13, 0.02), [0.13 * m, 0.1 * m, 0.11 * m], 0.06, TAG.MANE), { noiseAmp: 0.02 * m, noiseFreq: 16 }));
    if (style !== 'short') {
      // belly fringe
      P.push(Object.assign(cone('spine2', [0, H - 0.3, 0.32 * L], [0, H - 0.27, 0.0], 0.05 * m, 0.03, 0.05, TAG.MANE), { noiseAmp: 0.015, noiseFreq: 20 }));
    }
  }
  if (cfg.species === 'tiger' || cfg.species === 'snowleopard') {
    // cheek ruffs
    P.push(Object.assign(ell('head', hp(0.09, -0.04, 0.0), [0.06 * hs, 0.07 * hs, 0.07 * hs], 0.04, TAG.HEAD), {}));
    P.push(Object.assign(ell('head', hp(-0.09, -0.04, 0.0), [0.06 * hs, 0.07 * hs, 0.07 * hs], 0.04, TAG.HEAD), {}));
  }

  const scale = sp.scale * ls.scale * cfg.size;
  return {
    bones, prims: P, scale, headC, headS: hs, eyeL, eyeR, eyeR_: eyeRad, noseTip, earL, earR, spineH: H, tailBones,
    legLen: { front: [dist(FL.shoulder, FL.elbow), dist(FL.elbow, FL.wrist), dist(FL.wrist, FL.pawP)], hind: [dist(HL.hip, HL.knee), dist(HL.knee, HL.hock), dist(HL.hock, HL.pawP)] },
    furLen: 0.012 * sp.fur * ls.fur, maneLen: hasMane ? 0.05 + 0.1 * ml : 0, hasMane,
  };
}
function tailBonesPos(bones: BoneDef[], n: string): V3 { return bones.find((b) => b.name === n)!.pos; }
function dist(a: V3, b: V3) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

export interface CatGeometryData {
  positions: Float32Array; normals: Float32Array; indices: Uint32Array;
  skinIndex: Uint16Array; skinWeight: Float32Array; mask: Float32Array; // mask: under, part, longFur, along
}

/** Mesh the SDF, add the swept tail, and compute skin weights + region masks. */
export function buildCatGeometry(shape: CatShape, voxel: number): CatGeometryData {
  const prims = shape.prims;
  const boneIndex = new Map(shape.bones.map((b, i) => [b.name, i]));
  const field = buildField(prims, voxel, noise3);
  const nets = surfaceNets(field);
  const nv = nets.positions.length / 3;

  // tail tube
  const tailPts = shape.tailBones.map((n) => shape.bones[boneIndex.get(n)!].pos);
  const tube = sweepTail(tailPts, SPECIES_TAIL_R(shape), voxel);
  const total = nv + tube.count;
  const positions = new Float32Array(total * 3), normals = new Float32Array(total * 3);
  positions.set(nets.positions); normals.set(nets.normals);
  positions.set(tube.positions, nv * 3); normals.set(tube.normals, nv * 3);
  const indices = new Uint32Array(nets.indices.length + tube.indices.length);
  indices.set(nets.indices);
  for (let i = 0; i < tube.indices.length; i++) indices[nets.indices.length + i] = tube.indices[i] + nv;

  const skinIndex = new Uint16Array(total * 4), skinWeight = new Float32Array(total * 4), mask = new Float32Array(total * 4);
  const acc = new Map<number, number>();
  const blendW = 0.022;
  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    acc.clear();
    let dmin = 1e9;
    const ds: [Prim, number][] = [];
    for (const p of prims) {
      if (p.sub) continue;
      if (x < p.bmin[0] || y < p.bmin[1] || z < p.bmin[2] || x > p.bmax[0] || y > p.bmax[1] || z > p.bmax[2]) continue;
      const d = primDist(p, x, y, z);
      ds.push([p, d]);
      if (d < dmin) dmin = d;
    }
    let mane = 0, under = 0, part = 0, partW = -1;
    for (const [p, d] of ds) {
      const w = Math.exp(-(d - dmin) / blendW);
      if (w < 0.01) continue;
      const bi = boneIndex.get(p.bone)!;
      acc.set(bi, (acc.get(bi) || 0) + w);
      if (p.tag === TAG.MANE) mane = Math.max(mane, w);
      if (w > partW) { partW = w; part = p.tag; }
    }
    writeWeights(acc, skinIndex, skinWeight, v);
    const ny = normals[v * 3 + 1];
    under = smooth(-0.15, -0.75, ny) * (part === TAG.BODY || part === TAG.NECK || part === TAG.MUZZLE || part === TAG.LEG ? 1 : 0.3);
    if (part === TAG.MUZZLE && y < shape.headC[1] - 0.02) under = 1;
    if (part === TAG.LEG && Math.abs(x) < Math.abs(positions[v * 3]) && normals[v * 3] * Math.sign(x) < -0.3) under = Math.max(under, 0.6); // inner legs
    mask[v * 4] = under; mask[v * 4 + 1] = part; mask[v * 4 + 2] = mane; mask[v * 4 + 3] = 0;
  }
  // tail weights
  for (let i = 0; i < tube.count; i++) {
    const v = nv + i;
    const t = tube.along[i] * (shape.tailBones.length - 1);
    const i0 = Math.min(Math.floor(t), shape.tailBones.length - 2), f = t - i0;
    acc.clear();
    acc.set(boneIndex.get(shape.tailBones[i0])!, 1 - f);
    acc.set(boneIndex.get(shape.tailBones[i0 + 1])!, f);
    writeWeights(acc, skinIndex, skinWeight, v);
    mask[v * 4] = smooth(-0.2, -0.8, normals[v * 3 + 1]) * 0.6; mask[v * 4 + 1] = TAG.TAIL; mask[v * 4 + 2] = 0; mask[v * 4 + 3] = tube.along[i];
  }
  return { positions, normals, indices, skinIndex, skinWeight, mask };
}
function SPECIES_TAIL_R(shape: CatShape) {
  // radius along the tail (in unit space) from the stub
  const base = shape.prims.find((p) => p.tag === TAG.TAIL)!;
  return { r0: base.rb, r1: base.rb * 0.62 };
}
function smooth(a: number, b: number, v: number) { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }
function writeWeights(acc: Map<number, number>, si: Uint16Array, sw: Float32Array, v: number) {
  const arr = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  let s = 0; for (const [, w] of arr) s += w;
  for (let k = 0; k < 4; k++) {
    if (k < arr.length) { si[v * 4 + k] = arr[k][0]; sw[v * 4 + k] = arr[k][1] / s; } else { si[v * 4 + k] = 0; sw[v * 4 + k] = 0; }
  }
}
function sweepTail(pts: V3[], R: { r0: number; r1: number }, voxel: number) {
  // Catmull-Rom through tail bone positions; start slightly inside the stub
  const samples: V3[] = [];
  const n = pts.length;
  const steps = 10;
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < steps; s++) {
    const t = s / steps;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const f = (k: number) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
    samples.push([f(0), f(1), f(2)]);
  }
  samples.push(pts[n - 1]);
  const ring = 14;
  const m = samples.length;
  const positions = new Float32Array((m * ring + 1) * 3), normals = new Float32Array((m * ring + 1) * 3), along = new Float32Array(m * ring + 1);
  const idx: number[] = [];
  let up: V3 = [1, 0, 0];
  for (let i = 0; i < m; i++) {
    const a = samples[Math.max(0, i - 1)], b = samples[Math.min(m - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    // frame
    let bx = ty * up[2] - tz * up[1], by = tz * up[0] - tx * up[2], bz = tx * up[1] - ty * up[0];
    const bl = Math.hypot(bx, by, bz); bx /= bl; by /= bl; bz /= bl;
    const nx = by * tz - bz * ty, ny = bz * tx - bx * tz, nz = bx * ty - by * tx;
    up = [nx, ny, nz];
    const t = i / (m - 1);
    let r = R.r0 + (R.r1 - R.r0) * t;
    if (t > 0.94) r *= Math.sqrt(Math.max(0, 1 - (t - 0.94) / 0.06)) * 0.9 + 0.1;
    for (let j = 0; j < ring; j++) {
      const ang = (j / ring) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const ox = bx * c + nx * s, oy = by * c + ny * s, oz = bz * c + nz * s;
      const k = i * ring + j;
      positions[k * 3] = samples[i][0] + ox * r; positions[k * 3 + 1] = samples[i][1] + oy * r; positions[k * 3 + 2] = samples[i][2] + oz * r;
      normals[k * 3] = ox; normals[k * 3 + 1] = oy; normals[k * 3 + 2] = oz;
      along[k] = t;
      if (i < m - 1) {
        const a0 = k, a1 = i * ring + ((j + 1) % ring), b0 = a0 + ring, b1 = a1 + ring;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
  }
  // tip cap
  const tip = m * ring;
  const last = samples[m - 1];
  positions[tip * 3] = last[0]; positions[tip * 3 + 1] = last[1] - 0.004; positions[tip * 3 + 2] = last[2];
  normals[tip * 3 + 1] = -1; along[tip] = 1;
  for (let j = 0; j < ring; j++) idx.push((m - 1) * ring + j, tip, (m - 1) * ring + ((j + 1) % ring));
  void voxel;
  return { positions, normals, indices: idx, along, count: m * ring + 1 };
}

export function makeSkeleton(shape: CatShape) {
  const map = new Map<string, THREE.Bone>();
  const bones: THREE.Bone[] = [];
  for (const d of shape.bones) {
    const b = new THREE.Bone();
    b.name = d.name;
    const parent = d.parent ? map.get(d.parent)! : null;
    const pp = d.parent ? shape.bones.find((x) => x.name === d.parent)!.pos : [0, 0, 0];
    b.position.set(d.pos[0] - pp[0], d.pos[1] - pp[1], d.pos[2] - pp[2]);
    if (parent) parent.add(b);
    map.set(d.name, b);
    bones.push(b);
  }
  return { bones, map, root: bones[0] };
}
