import * as THREE from 'three';
import { CatConfig } from './catConfig';
import { catShape, buildCatGeometry, makeSkeleton, CatShape } from './catBuilder';
import { catUniforms, makeCatBaseMaterial, makeCatShellMaterial, makeEyeMaterial, CatUniforms } from './catMaterial';
import { CatRig } from './catRig';
import { buildAccessories } from './accessories';

export interface CatBuildOptions { voxel?: number; shells?: number; a2c?: boolean; castShadow?: boolean; }

/** A complete renderable, animatable cat. The group's origin is on the ground between the feet. */
export class Cat {
  group = new THREE.Group();
  inner = new THREE.Group(); // scaled to the cat's size
  shape: CatShape;
  mesh: THREE.SkinnedMesh;
  shells: THREE.SkinnedMesh | null = null;
  skeleton: THREE.Skeleton;
  bones: Map<string, THREE.Bone>;
  uniforms: CatUniforms;
  rig: CatRig;
  eyes: THREE.Mesh[] = [];
  lids: THREE.Mesh[] = [];
  whiskers: THREE.LineSegments | null = null;
  accessories: THREE.Object3D[] = [];
  shellCount: number;
  constructor(public config: CatConfig, opts: CatBuildOptions = {}) {
    const shape = (this.shape = catShape(config));
    const data = buildCatGeometry(shape, opts.voxel ?? 0.016);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(data.skinWeight, 4));
    geo.setAttribute('aMask', new THREE.BufferAttribute(data.mask, 4));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    const sk = makeSkeleton(shape);
    this.bones = sk.map;
    this.skeleton = new THREE.Skeleton(sk.bones);
    this.uniforms = catUniforms(config, shape);
    this.mesh = new THREE.SkinnedMesh(geo, makeCatBaseMaterial(this.uniforms));
    this.mesh.add(sk.root);
    this.mesh.bind(this.skeleton);
    this.mesh.castShadow = opts.castShadow ?? true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.inner.add(this.mesh);
    this.shellCount = opts.shells ?? 16;
    if (this.shellCount > 0) {
      const ig = new THREE.InstancedBufferGeometry();
      for (const k of ['position', 'normal', 'skinIndex', 'skinWeight', 'aMask']) ig.setAttribute(k, geo.getAttribute(k));
      ig.setIndex(geo.getIndex());
      ig.instanceCount = this.shellCount;
      this.uniforms.uShells.value = this.shellCount;
      const sm = new THREE.SkinnedMesh(ig, makeCatShellMaterial(this.uniforms, opts.a2c ?? true));
      sm.bind(this.skeleton, this.mesh.bindMatrix);
      sm.frustumCulled = false;
      sm.castShadow = false; sm.receiveShadow = true;
      this.shells = sm;
      this.inner.add(sm);
    }
    this.inner.scale.setScalar(shape.scale);
    this.group.add(this.inner);
    this.buildFace();
    this.accessories = buildAccessories(this, config.accessories);
    this.rig = new CatRig(this);
  }
  private buildFace() {
    const s = this.shape;
    const head = this.bones.get('head')!;
    const hc = s.headC;
    const eyeMat = makeEyeMaterial(this.config.eyeColor);
    const lidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.config.coat).multiplyScalar(0.18), roughness: 0.8 });
    for (const [e, side] of [[s.eyeL, 1], [s.eyeR, -1]] as const) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(s.eyeR_, 20, 14), eyeMat);
      eye.position.set(e[0] - hc[0], e[1] - hc[1], e[2] - hc[2]);
      eye.rotation.y = side * 0.32; // eyes look forward and a little outward
      eye.rotation.x = -0.05;
      head.add(eye);
      this.eyes.push(eye);
      // upper lid: a cap that rotates down to close
      const lid = new THREE.Mesh(new THREE.SphereGeometry(s.eyeR_ * 1.04, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), lidMat);
      lid.position.copy(eye.position);
      lid.rotation.set(-1.25, side * 0.32, 0);
      head.add(lid);
      this.lids.push(lid);
    }
    // whiskers
    const pts: number[] = [];
    const n = s.noseTip;
    const hs = s.headS;
    for (const side of [1, -1]) for (let i = 0; i < 7; i++) {
      const row = i % 3, col = Math.floor(i / 3);
      const o = new THREE.Vector3(side * (0.022 + col * 0.008) * hs, (-0.035 - row * 0.008) * hs, -0.035 * hs + col * 0.004).add(new THREE.Vector3(n[0] - hc[0], n[1] - hc[1], n[2] - hc[2]));
      const len = (0.11 + Math.random() * 0.05 - row * 0.015) * hs;
      const dir = new THREE.Vector3(side * 0.9, -0.08 - row * 0.12 + Math.random() * 0.05, 0.35 - col * 0.25).normalize();
      let p = o.clone();
      for (let k = 0; k < 3; k++) {
        const q = p.clone().addScaledVector(dir, len / 3);
        dir.y -= 0.12; dir.normalize();
        pts.push(p.x, p.y, p.z, q.x, q.y, q.z);
        p = q;
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.whiskers = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xf2eee6, transparent: true, opacity: 0.55 }));
    head.add(this.whiskers);
  }
  setShellVisibility(count: number) {
    if (!this.shells) return;
    const c = Math.max(0, Math.min(this.shellCount, count));
    (this.shells.geometry as THREE.InstancedBufferGeometry).instanceCount = c;
    this.shells.visible = c > 0;
  }
  update(dt: number) { this.rig.update(dt); }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    if (this.shells) (this.shells.material as THREE.Material).dispose();
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== this.mesh && o !== this.shells) { (o as THREE.Mesh).geometry.dispose(); } });
  }
}
