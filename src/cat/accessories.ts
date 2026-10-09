import * as THREE from 'three';
import type { Cat } from './cat';

function flower(color: string, r: number) {
  const g = new THREE.Group();
  const petal = new THREE.SphereGeometry(r * 0.55, 8, 6);
  petal.scale(1, 0.35, 1.5);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(petal, mat);
    const a = (i / 5) * Math.PI * 2;
    m.position.set(Math.cos(a) * r * 0.6, 0, Math.sin(a) * r * 0.6);
    m.rotation.y = -a + Math.PI / 2;
    g.add(m);
  }
  const c = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 8, 6), new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.5 }));
  c.position.y = r * 0.1;
  g.add(c);
  return g;
}

export function buildAccessories(cat: Cat, list: string[]) {
  const out: THREE.Object3D[] = [];
  const s = cat.shape, hs = s.headS;
  const head = cat.bones.get('head')!, neck = cat.bones.get('neck')!;
  const hc = s.headC;
  if (list.includes('flowers')) {
    const crown = new THREE.Group();
    const colors = ['#f4f0e8', '#f2a6b8', '#f6d24a', '#c8a0e8', '#ff8a5a'];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1 * hs, 0.006 * hs, 6, 32), new THREE.MeshStandardMaterial({ color: '#5a7a3a', roughness: 0.8 }));
    ring.rotation.x = Math.PI / 2;
    crown.add(ring);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const f = flower(colors[i % colors.length], 0.022 * hs);
      f.position.set(Math.cos(a) * 0.1 * hs, 0.006, Math.sin(a) * 0.1 * hs);
      f.rotation.z = Math.cos(a) * 0.5; f.rotation.x = -Math.sin(a) * 0.5;
      crown.add(f);
    }
    crown.position.set(0, 0.095 * hs, -0.025 * hs);
    crown.rotation.x = -0.25;
    head.add(crown); out.push(crown);
  }
  if (list.includes('bones') || list.includes('beads')) {
    const neckBone = s.bones.find((b) => b.name === 'neck')!.pos;
    const center = new THREE.Vector3((hc[0] + neckBone[0]) / 2 - neckBone[0], (hc[1] + neckBone[1]) / 2 - neckBone[1] - 0.06, (hc[2] + neckBone[2]) / 2 - neckBone[2] - 0.03);
    const R = 0.17 * (s.hasMane ? 1.35 : 1);
    const g = new THREE.Group();
    const cord = new THREE.Mesh(new THREE.TorusGeometry(R, 0.004, 5, 40), new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.9 }));
    g.add(cord);
    if (list.includes('bones')) {
      const boneGeo = new THREE.CapsuleGeometry(0.009, 0.045, 3, 6);
      const boneMat = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.55 });
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 0.5 + (i - 4) * 0.22;
        const m = new THREE.Mesh(boneGeo, boneMat);
        m.position.set(Math.cos(a) * R, Math.sin(a) * R - 0.02, 0);
        m.rotation.z = a;
        g.add(m);
      }
    }
    if (list.includes('beads')) {
      const colors = ['#c0392b', '#e8b730', '#2a7a8a', '#f2efe6'];
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshStandardMaterial({ color: colors[i % 4], roughness: 0.35 }));
        m.position.set(Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02, 0.004);
        g.add(m);
      }
    }
    // the necklace hangs around the neck: torus axis along the neck direction
    g.position.copy(center);
    g.rotation.x = -0.9;
    g.rotation.z = Math.PI;
    neck.add(g); out.push(g);
  }
  if (list.includes('feather')) {
    const ear = cat.bones.get('earL')!;
    const f = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.002, 0.14, 4), new THREE.MeshStandardMaterial({ color: '#efe8dc' }));
    shaft.position.y = 0.07; f.add(shaft);
    const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.11, 1, 6), new THREE.MeshStandardMaterial({ color: '#9a5a2a', side: THREE.DoubleSide, roughness: 0.7 }));
    const pos = vane.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setX(i, pos.getX(i) * Math.sin((y / 0.11 + 0.5) * Math.PI) ); }
    vane.position.y = 0.085; f.add(vane);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.012), new THREE.MeshStandardMaterial({ color: '#f2efe6', side: THREE.DoubleSide }));
    band.position.y = 0.11; f.add(band);
    f.position.set(0.01, 0.03, -0.01);
    f.rotation.set(-0.5, 0, -0.6);
    f.scale.setScalar(hs);
    ear.add(f); out.push(f);
  }
  return out;
}
