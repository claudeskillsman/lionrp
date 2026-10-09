import * as THREE from 'three';
import type { Game } from './game';
import { BIOMES, BiomeKey } from '../world/worldgen';

/** A ring of stones and a pride-coloured ribbon on a bleached branch, marking a claimed den. */
export function makeDenMarker(g: Game, k: BiomeKey, color: string) {
  const d = BIOMES[k].den;
  const grp = new THREE.Group();
  grp.position.set(d[0], g.world.height(d[0], d[1]), d[1]);
  const stone = new THREE.MeshStandardMaterial({ color: '#8a7a68', roughness: 0.95 });
  const geo = new THREE.DodecahedronGeometry(0.28, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const m = new THREE.Mesh(geo, stone);
    const s = 0.8 + ((i * 37) % 10) / 20;
    m.scale.setScalar(s);
    m.position.set(Math.cos(a) * 2.6, 0.05, Math.sin(a) * 2.6); m.rotation.set(i * 1.3, i * 2.1, 0); m.castShadow = true;
    grp.add(m);
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: '#d8ccb4', roughness: 0.8 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.6, 6), poleMat);
  pole.position.y = 0.8; pole.rotation.z = 0.08; pole.castShadow = true; grp.add(pole);
  const clothMat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.7 });
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32, 6, 2), clothMat);
  cloth.position.set(0.27, 1.4, 0); cloth.castShadow = true; grp.add(cloth);
  const pos = cloth.geometry.attributes.position as THREE.BufferAttribute;
  const base = Float32Array.from(pos.array as Float32Array);
  const tick = () => { const t = performance.now() / 1000; for (let i = 0; i < pos.count; i++) { const x = base[i * 3] + 0.25; pos.setZ(i, Math.sin(t * 4 + x * 9) * 0.06 * x); } pos.needsUpdate = true; };
  g.onUi.push(tick);
  for (const m of [stone, poleMat, clothMat]) g.gw.registerMaterial(m);
  g.gw.scene.add(grp);
  return {
    group: grp,
    setColor(c: string) { clothMat.color.set(c); },
    dispose() { g.gw.scene.remove(grp); g.onUi = g.onUi.filter((f) => f !== tick); },
  };
}
export type DenMarker = ReturnType<typeof makeDenMarker>;
