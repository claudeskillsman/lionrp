import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { World } from '../world/worldgen';
import { Terrain, makeWorldTextures, WorldTextures } from '../world/terrain';
import { Grass, GRASS_PRESETS } from '../world/grass';
import { createSky } from '../world/sky';
import { Environment } from '../world/environment';
import { G } from '../engine/atmosphere';
import type { Quality } from '../engine/settings';

/** Everything that makes up the savanna scene, independent of mode. */
export class GameWorld {
  scene = new THREE.Scene();
  env: Environment;
  terrain: Terrain;
  grass: Grass;
  tex: WorldTextures;
  csm: CSM | null = null;
  sky: THREE.Mesh;
  shadowMaterials: THREE.Material[] = [];
  constructor(public world: World, public camera: THREE.PerspectiveCamera, public q: Quality) {
    this.scene.fog = new THREE.FogExp2(0xffffff, 0.001);
    this.env = new Environment(this.scene);
    this.tex = makeWorldTextures(world);
    this.terrain = new Terrain(world, this.tex);
    this.scene.add(this.terrain.group);
    this.grass = new Grass(this.tex, GRASS_PRESETS[q.grass]);
    for (const m of this.grass.meshes) this.scene.add(m);
    this.terrain.material.envMapIntensity = 0.5;
    this.sky = createSky();
    this.scene.add(this.sky);
    this.setupShadows();
    this.registerMaterial(this.terrain.material);
    for (const m of this.grass.meshes) this.registerMaterial(m.material as THREE.Material);
  }
  rebuildGrass() {
    for (const m of this.grass.meshes) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.grass = new Grass(this.tex, GRASS_PRESETS[this.q.grass]);
    for (const m of this.grass.meshes) this.scene.add(m);
  }
  setupShadows() {
    const q = this.q;
    this.csm = new CSM({
      maxFar: q.shadowFar, cascades: q.cascades, mode: 'practical', parent: this.scene, shadowMapSize: q.shadowSize,
      lightDirection: new THREE.Vector3(-1, -1, -1).normalize(), camera: this.camera, lightIntensity: 3, lightNear: 1, lightFar: 2000, lightMargin: 150,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) { l.shadow.bias = -0.0002; l.shadow.normalBias = 0.04; }
  }
  /** Materials must be registered so cascaded shadows get wired in (keeps our own patches). */
  registerMaterial(m: THREE.Material) {
    if (!this.csm) return;
    const prev = m.onBeforeCompile;
    this.csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = (s, r) => { prev.call(m, s, r); csmHook.call(m, s, r); };
  }
  update(dt: number, focus: THREE.Vector3) {
    this.env.update(dt);
    const env = this.env;
    if (this.csm) {
      this.csm.lightDirection.copy(env.sunLight.position).negate().normalize();
      for (const l of this.csm.lights) { l.color.copy(env.sunLight.color); l.intensity = env.sunLight.intensity; }
      this.csm.update();
    }
    this.terrain.update(this.camera.position, this.q.lodBias);
    this.grass.update(this.camera.position);
  }
}
