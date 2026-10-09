import * as THREE from 'three';
import { World, SPAWN, WATER_LEVEL, BIOMES, BiomeKey, biomeWeights } from '../world/worldgen';
import { GameWorld } from './gameworld';
import { PostFX } from '../engine/postfx';
import { QUALITY, Settings, saveSettings } from '../engine/settings';
import { Props } from '../world/props';
import { createWater } from '../world/water';
import { Particles } from '../world/particles';
import { Fauna } from '../world/fauna';
import { grassActors, MAX_ACTORS } from '../world/grass';
import { CatEntity } from './entity';
import { FollowCamera } from './camera';
import { Input } from './input';
import type { CatConfig } from '../cat/catConfig';
import type { PoseName } from '../cat/catRig';
import { G } from '../engine/atmosphere';
import { AudioEngine } from '../audio/audio';

export interface ModeHooks {
  update(dt: number): void;
  onEmote?(pose: PoseName): void;
  dispose?(): void;
}

/** Owns the renderer, the savanna, the player and the frame loop. Modes (solo / online) plug in via hooks. */
export class Game {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  post!: PostFX;
  gw!: GameWorld;
  props!: Props;
  particles!: Particles;
  fauna!: Fauna;
  water!: ReturnType<typeof createWater>;
  input: Input;
  follow!: FollowCamera;
  player: CatEntity | null = null;
  entities: CatEntity[] = [];
  mode: ModeHooks | null = null;
  state: 'menu' | 'creator' | 'play' | 'photo' = 'menu';
  audio = new AudioEngine();
  showcase: CatEntity | null = null;
  onFrame: ((dt: number) => void)[] = [];
  /** Called every frame with real time, even while paused (UI, photo mode). */
  onUi: ((dt: number) => void)[] = [];
  paused = false;
  biome: BiomeKey = 'grassland';
  onBiome: ((b: BiomeKey) => void) | null = null;
  onPhoto: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  private last = performance.now();
  private studio: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; render: (dt: number) => void } | null = null;
  private envTimer = 0;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  fps = 60;
  private fpsAcc = 0; private fpsN = 0;
  constructor(public world: World, public settings: Settings, public container: HTMLElement) {
    const q = QUALITY[settings.quality];
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.08, 12000);
    this.input = new Input(settings, this.renderer.domElement);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.buildWorld();
    addEventListener('resize', () => this.resize());
  }
  get quality() { return QUALITY[this.settings.quality]; }
  private buildWorld() {
    const q = this.quality;
    this.gw = new GameWorld(this.world, this.camera, q);
    this.props = new Props(this.world, q.trees);
    this.gw.scene.add(this.props.group);
    for (const m of this.props.materials) this.gw.registerMaterial(m);
    this.water = createWater(this.gw.tex);
    this.gw.scene.add(this.water.group);
    this.particles = new Particles(this.renderer.getPixelRatio(), q.name === 'low' ? 0.5 : 1);
    this.gw.scene.add(this.particles.group);
    this.fauna = new Fauna(this.world, q.name === 'low' ? 0.6 : 1);
    this.gw.scene.add(this.fauna.group);
    for (const m of this.fauna.materials) this.gw.registerMaterial(m);
    this.post = new PostFX(this.renderer, this.gw.scene, this.camera, q);
    this.follow = new FollowCamera(this.camera, (x, z) => Math.max(this.world.height(x, z), WATER_LEVEL));
  }
  /** Rebuild quality-dependent systems in place. */
  applyQuality() {
    const q = this.quality;
    this.resScale = 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.post.dispose();
    // rebuild grass + shadows
    const old = this.gw;
    old.csm?.remove(); old.csm?.dispose();
    for (const m of old.grass.meshes) old.scene.remove(m);
    old.q = q;
    old.rebuildGrass();
    old.setupShadows();
    for (const m of [old.terrain.material, ...old.grass.meshes.map((g) => g.material as THREE.Material), ...this.props.materials, ...this.fauna.materials]) { old.registerMaterial(m); m.needsUpdate = true; }
    for (const e of this.entities) this.registerCat(e);
    this.post = new PostFX(this.renderer, this.studio ? this.studio.scene : this.gw.scene, this.studio ? this.studio.camera : this.camera, q);
    saveSettings(this.settings);
  }
  registerCat(e: CatEntity) {
    this.gw.registerMaterial(e.cat.mesh.material as THREE.Material);
    if (e.cat.shells) this.gw.registerMaterial(e.cat.shells.material as THREE.Material);
    for (const eye of e.cat.eyes) this.gw.registerMaterial(eye.material as THREE.Material);
  }
  addEntity(e: CatEntity) {
    this.entities.push(e);
    this.gw.scene.add(e.object);
    this.registerCat(e);
    e.onStep = (en, surface) => {
      if (en.pos.distanceTo(this.camera.position) > 40) return;
      this.audio.footstep(surface as any, en.pos, Math.min(1, en.size), Math.min(1, en.speed / 10));
      if (en.speed > 7 && surface === 'grass' && this.world.sampleB(en.pos.x, en.pos.z, 2) < 0.5) this.particles.emitDust(en.pos, 2);
      if (surface === 'water' || surface === 'mud') this.particles.emitDust(en.pos, 3, true);
    };
  }
  removeEntity(e: CatEntity) {
    this.entities = this.entities.filter((x) => x !== e);
    this.gw.scene.remove(e.object);
    e.dispose();
  }
  spawnPlayer(cfg: CatConfig, x = SPAWN[0], z = SPAWN[1], yaw = Math.PI) {
    if (this.player) this.removeEntity(this.player);
    const q = this.quality;
    const p = new CatEntity(cfg, { shells: q.furShells, a2c: q.msaa > 0 });
    p.place(x, z, this.world, yaw);
    this.addEntity(p);
    this.player = p;
    this.follow.yaw = yaw + Math.PI;
    this.follow.snap();
    return p;
  }
  // ---------------- studio (character creator) ----------------
  setStudio(scene: THREE.Scene | null, camera?: THREE.PerspectiveCamera, render?: (dt: number) => void) {
    if (scene && camera) { this.studio = { scene, camera, render: render ?? (() => {}) }; this.post.setScene(scene, camera); }
    else { this.studio = null; this.post.setScene(this.gw.scene, this.camera); }
  }
  // ---------------- frame ----------------
  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 1) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this.adaptResolution(); }
      this.frame(dt);
      (window as any).__frames = ((window as any).__frames || 0) + 1;
    };
    loop();
  }
  frame(dt: number) {
    if (this.studio) {
      G.gTime.value += dt;
      this.studio.render(dt);
      this.post.render(dt);
      this.input.endFrame();
      return;
    }
    const simDt = this.paused ? 0 : dt;
    this.mode?.update(simDt);
    for (const f of this.onFrame) f(simDt);
    for (const f of this.onUi) f(dt);
    // entities
    const cam = this.camera.position;
    for (const e of this.entities) {
      const d = e.pos.distanceTo(cam);
      if (d > 160 && e !== this.player) { e.object.visible = false; continue; }
      e.object.visible = true;
      if (e.remote) e.updateRemote(dt, this.world);
      else e.update(simDt, this.world, this.props, this.settings.survival);
      // fur LOD
      const q = this.quality;
      e.cat.setShellVisibility(d < 12 ? q.furShells : d < 30 ? Math.ceil(q.furShells * 0.5) : d < 60 ? Math.min(4, q.furShells) : 0);
    }
    // grass parting: nearest actors to the camera
    const acts = this.entities.filter((e) => e.object.visible).sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    let slot = 0;
    if (this.state === 'menu' || this.state === 'photo') { grassActors.value[0].set(cam.x, cam.y - 1.2, cam.z, 2.2); slot = 1; }
    for (let i = slot; i < MAX_ACTORS; i++) {
      const e = acts[i - slot];
      const v = grassActors.value[i];
      if (e) v.set(e.pos.x, e.pos.y, e.pos.z, (e === this.showcase ? 1.5 : e.pose === 'lie' || e.pose === 'sleep' ? 1.1 : 0.55) * e.size + Math.min(0.4, e.speed * 0.03));
      else v.set(0, -999, 0, 0);
    }
    // camera
    if (this.state === 'play' && this.player) {
      const p = this.player;
      this.follow.update(dt, p.pos, p.yaw, p.size, p.speed > 0.5, this.input, this.settings.mouseSens, this.settings.invertY);
    }
    // world systems
    this.gw.update(simDt, cam);
    if (this.state !== 'photo') { /* photo mode controls time itself */ }
    const threats = this.entities.filter((e) => !e.climbing).map((e) => ({ pos: e.pos, stealth: e.cat.rig.crouch * (e.speed < 2 ? 1 : 0.4) * (this.world.sampleB(e.pos.x, e.pos.z, 2) > 0.5 ? 1 : 0.6), speed: e.speed }));
    this.fauna.update(simDt, cam, threats);
    this.particles.update(dt, cam, (x, z) => this.world.height(x, z), this.gw.env.rain, G.gNight.value);
    // biome tracking
    const focus = this.player ? this.player.pos : cam;
    const b = this.world.biomeAt(focus.x, focus.z);
    if (b !== this.biome) { this.biome = b; this.onBiome?.(b); }
    // grading
    const g = this.gw.env.grade, u = this.post.grade.uniforms;
    u.get('warmth')!.value = g.warmth; u.get('saturation')!.value = g.saturation; u.get('contrast')!.value = g.contrast; u.get('exposure')!.value = g.exposure;
    u.get('night')!.value = G.gNight.value; u.get('time')!.value = G.gTime.value;
    const midday = THREE.MathUtils.smoothstep(this.gw.env.sunElevationDeg, 35, 60);
    u.get('shimmer')!.value = midday * (1 - this.gw.env.rain) * (this.quality.name === 'low' ? 0 : 1);
    // environment reflections refresh
    this.envTimer -= dt;
    if (this.envTimer <= 0) { this.envTimer = this.quality.name === 'low' ? 8 : 3; this.refreshEnvMap(); }
    // audio
    const wts = biomeWeights(focus.x, focus.z);
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    this.audio.update(dt, {
      listener: { x: cam.x, y: cam.y, z: cam.z, fx: fwd.x, fz: fwd.z },
      biome: { grassland: Math.max(0, 1 - wts.wood - wts.kopje - wts.canyon - wts.high - wts.river - wts.hole), woodland: wts.wood, kopjes: wts.kopje, river: wts.river, waterhole: wts.hole, canyon: wts.canyon, highland: wts.high },
      hour: this.gw.env.time, rain: this.gw.env.rain, wind: G.gWind.value.z, underwater: false, paused: this.paused,
    });
    this.post.render(dt);
    this.input.endFrame();
  }
  private envScene: THREE.Scene | null = null;
  private refreshEnvMap() {
    // capture the sky into a PMREM so fur, eyes and water pick up the right ambient tint
    if (!this.envScene) { this.envScene = new THREE.Scene(); this.envScene.add(this.gw.sky.clone()); }
    const sky = this.envScene.children[0] as THREE.Mesh;
    sky.onBeforeRender = () => {};
    sky.position.set(0, 0, 0);
    const rt = this.pmrem.fromScene(this.envScene, 0.02, 1, 2000);
    this.envRT?.dispose();
    this.envRT = rt;
    this.gw.scene.environment = rt.texture;
    this.gw.scene.environmentIntensity = 0.35;
  }
  /** Dynamic resolution: trade pixels for frame rate before anything visibly drops out. */
  resScale = 1;
  noDynRes = new URLSearchParams(location.search).has('nodyn');
  private slowSecs = 0; private fastSecs = 0;
  private adaptResolution() {
    if (document.hidden || this.state === 'photo' || this.noDynRes) return;
    if (this.fps < 50) { this.slowSecs++; this.fastSecs = 0; } else if (this.fps > 58) { this.fastSecs++; this.slowSecs = 0; } else { this.slowSecs = 0; this.fastSecs = 0; }
    let next = this.resScale;
    if (this.slowSecs >= 2) { next = Math.max(0.6, this.resScale - 0.1); this.slowSecs = 0; }
    else if (this.fastSecs >= 6) { next = Math.min(1, this.resScale + 0.1); this.fastSecs = 0; }
    if (next !== this.resScale) {
      this.resScale = next;
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality.pixelRatio) * next);
      this.resize();
    }
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.post.setSize(innerWidth, innerHeight);
    if (this.studio) { this.studio.camera.aspect = innerWidth / innerHeight; this.studio.camera.updateProjectionMatrix(); }
  }
  screenshot(): Promise<Blob | null> {
    this.post.render(0);
    return new Promise((res) => this.renderer.domElement.toBlob((b) => res(b), 'image/png'));
  }
}
export { BIOMES };
