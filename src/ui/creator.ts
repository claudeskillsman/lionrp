import * as THREE from 'three';
import { el, icon } from './style';
import { CatConfig, SPECIES, Species, LIFE_STAGES, LifeStage, SCARS, MARKINGS, ACCESSORIES, EYE_COLORS, MANE_COLORS, ManeStyle, Pattern, defaultCat, randomCat, randomName } from '../cat/catConfig';
import { Cat } from '../cat/cat';
import type { Game } from '../game/game';
import type { PoseName } from '../cat/catRig';

/** Character creator: live 3D preview under studio lighting. */
export class Creator {
  root: HTMLElement;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.05, 100);
  cat: Cat | null = null;
  cfg: CatConfig;
  private rebuildTimer = 0;
  private dirty = false;
  private turn = 0.6;
  private drag = false;
  private lastX = 0;
  private tab = 'species';
  private panel!: HTMLElement;
  private previewPose: PoseName | null = null;
  private zoom = 1;
  constructor(private game: Game, initial: CatConfig | null, private onDone: (c: CatConfig) => void, private onCancel: () => void) {
    this.cfg = initial ? JSON.parse(JSON.stringify(initial)) : defaultCat('lion', randomName());
    this.buildStudio();
    this.root = this.buildUI();
    this.rebuild();
    game.setStudio(this.scene, this.camera, (dt) => this.render(dt));
  }
  private buildStudio() {
    const s = this.scene;
    s.background = new THREE.Color('#1a120c');
    s.fog = null;
    // warm key, cool fill, strong rim: a 'portrait' setup
    const key = new THREE.DirectionalLight('#ffe0bb', 3.4);
    key.position.set(2.5, 3.2, 2.2); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 0.5, far: 12 });
    s.add(key);
    const rim = new THREE.DirectionalLight('#ffc98a', 3.0); rim.position.set(-2.5, 2.2, -2.8); s.add(rim);
    const fill = new THREE.DirectionalLight('#9fb4e0', 0.7); fill.position.set(-3, 1, 2); s.add(fill);
    s.add(new THREE.HemisphereLight('#d8d0c8', '#4a3424', 0.7));
    // seamless cyclorama backdrop with a soft vignette gradient
    const cyc = new THREE.Mesh(new THREE.SphereGeometry(14, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y; vec3 c = mix(vec3(0.16,0.10,0.06), vec3(0.42,0.27,0.15), smoothstep(-0.1, 0.5, h)); c = mix(c, vec3(0.08,0.05,0.03), smoothstep(0.5, 1.0, h)); c *= 0.8 + 0.4 * smoothstep(-1.0, 1.0, d.z); gl_FragColor = vec4(c, 1.0); }',
    }));
    s.add(cyc);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    // a turntable disc of dry grass tufts gives context without clutter
    const tuft = new THREE.ConeGeometry(0.012, 0.22, 3);
    tuft.translate(0, 0.11, 0);
    const tm = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ color: '#b08440', roughness: 0.8 }), 900);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2, r = 1.3 + Math.random() * 3.5;
      m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), new THREE.Vector3(1, 0.6 + Math.random(), 1));
      tm.setMatrixAt(i, m);
    }
    tm.receiveShadow = true;
    s.add(tm);
    const pm = new THREE.PMREMGenerator(this.game.renderer);
    const envScene = new THREE.Scene(); envScene.add(cyc.clone());
    s.environment = pm.fromScene(envScene, 0.04).texture;
    s.environmentIntensity = 0.4;
  }
  private rebuild() {
    this.dirty = false;
    const prevPose = this.previewPose;
    if (this.cat) { this.scene.remove(this.cat.group); this.cat.dispose(); }
    const q = this.game.quality;
    this.cat = new Cat(this.cfg, { shells: Math.max(12, q.furShells), a2c: q.msaa > 0, voxel: 0.014 });
    this.cat.rig.groundFn = () => 0;
    this.cat.group.rotation.y = this.turn;
    if (prevPose) this.cat.rig.setPose(prevPose);
    this.scene.add(this.cat.group);
    this.frame();
  }
  private frame() {
    if (!this.cat) return;
    const s = this.cat.shape.scale;
    const z = this.zoom;
    const wide = innerWidth > 820;
    this.camera.position.set(0, 0.95 * s, 3.9 * s * z);
    this.camera.lookAt(0, 0.62 * s - (wide ? 0 : 0.18 * s), 0);
    this.camera.aspect = innerWidth / innerHeight;
    // centre the cat in the space left of the 420px side panel (plus its margins)
    if (wide) this.camera.setViewOffset(innerWidth, innerHeight, 228, 0, innerWidth, innerHeight);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }
  private change(fn: () => void, rebuild = true) {
    fn();
    if (rebuild) { this.dirty = true; this.rebuildTimer = 0.18; }
    this.renderPanel();
  }
  private render(dt: number) {
    if (this.dirty) { this.rebuildTimer -= dt; if (this.rebuildTimer <= 0) this.rebuild(); }
    if (!this.drag) this.turn += dt * 0.12;
    if (this.cat) { this.cat.group.rotation.y = this.turn; this.cat.update(dt); }
  }
  // ---------------- UI ----------------
  private buildUI() {
    const root = el('div', { class: 'gg-screen', style: { justifyContent: 'flex-end' } });
    const canvasCatcher = el('div', { style: { position: 'absolute', inset: '0' } });
    canvasCatcher.addEventListener('pointerdown', (e) => { this.drag = true; this.lastX = e.clientX; (e.target as HTMLElement).setPointerCapture(e.pointerId); });
    canvasCatcher.addEventListener('pointermove', (e) => { if (this.drag) { this.turn += (e.clientX - this.lastX) * 0.01; this.lastX = e.clientX; } });
    canvasCatcher.addEventListener('pointerup', () => (this.drag = false));
    canvasCatcher.addEventListener('wheel', (e) => { this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.45, 1.4); this.frame(); });
    root.append(canvasCatcher);
    const wide = innerWidth > 820;
    const side = el('div', { class: 'gg-panel interactive', style: wide
      ? { position: 'relative', width: '420px', margin: '18px', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100% - 36px)' }
      : { position: 'absolute', left: '8px', right: '8px', bottom: '8px', height: innerHeight < 500 ? '62%' : '50%', display: 'flex', flexDirection: 'column' } });
    const head = el('div', { style: { padding: wide ? '18px 20px 6px' : '10px 16px 0' } },
      el('div', { class: 'gg-row', style: { justifyContent: 'space-between' } },
        el('div', { class: 'gg-title', style: { fontSize: wide ? '28px' : '20px' } }, 'Create your cat'),
        el('button', { class: 'gg-btn small ghost', onclick: () => this.onCancel() }, 'Back')),
    );
    const tabs = el('div', { class: 'gg-tabs', style: { padding: '6px 14px' } });
    const T: [string, string][] = [['species', 'Species'], ['body', 'Body'], ['coat', 'Coat'], ['mane', 'Mane'], ['face', 'Face'], ['marks', 'Marks'], ['extras', 'Extras']];
    for (const [id, label] of T) tabs.append(el('button', { class: 'gg-tab' + (id === this.tab ? ' on' : ''), 'data-tab': id, onclick: () => { this.tab = id; tabs.querySelectorAll('.gg-tab').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === id)); this.renderPanel(); } }, label));
    this.panel = el('div', { class: 'gg-scroll', style: { padding: '8px 20px 16px', flex: '1', minHeight: '0' } });
    const foot = el('div', { class: 'gg-row', style: { padding: wide ? '14px 20px 18px' : '8px 14px 10px', borderTop: '1px solid var(--gg-line)', gap: '10px' } },
      el('button', { class: 'gg-btn small', onclick: () => { const c = randomCat(Math.random, this.cfg.species); c.id = this.cfg.id; c.name = this.cfg.name || c.name; this.change(() => (this.cfg = c)); } }, 'Randomize'),
      el('div', { style: { flex: '1' } }),
      el('button', { class: 'gg-btn primary', onclick: () => { if (!this.cfg.name.trim()) this.cfg.name = randomName(); this.onDone(this.cfg); } }, 'Save & Play'));
    side.append(head, tabs, this.panel, foot);
    root.append(side);
    // pose preview buttons
    const poses = el('div', { class: 'gg-row interactive', style: { position: 'absolute', left: wide ? '24px' : '12px', top: wide ? 'auto' : '12px', bottom: wide ? '22px' : 'auto', flexWrap: 'wrap', maxWidth: wide ? '60%' : '95%' } });
    for (const [p, l] of [[null, 'Stand'], ['sit', 'Sit'], ['lie', 'Lie'], ['roar', 'Roar'], ['groom', 'Groom'], ['playbow', 'Play-bow']] as [PoseName | null, string][]) {
      poses.append(el('button', { class: 'gg-chip', onclick: () => { this.previewPose = p; this.cat?.rig.setPose(p); if (p === 'roar') this.game.audio.call('roar', { x: 0, y: 1, z: 0 }, this.cat?.shape.scale ?? 1); } }, l));
    }
    root.append(poses);
    this.renderPanel();
    return root;
  }
  private renderPanel() {
    const p = this.panel; const c = this.cfg;
    p.innerHTML = '';
    const section = (label: string, ...kids: (HTMLElement | null)[]) => el('div', { style: { margin: '14px 0' } }, el('div', { class: 'gg-label', style: { marginBottom: '9px' } }, label), ...kids);
    const chips = <T extends string>(opts: [T, string][], cur: T, set: (v: T) => void) => el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '7px' } }, ...opts.map(([v, l]) => el('button', { class: 'gg-chip' + (v === cur ? ' on' : ''), onclick: () => this.change(() => set(v)) }, l)));
    const swatches = (opts: string[], cur: string, set: (v: string) => void, rebuild = false) => {
      const row = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '8px' } }, ...opts.map((o) => el('div', { class: 'gg-swatch' + (o.toLowerCase() === cur.toLowerCase() ? ' on' : ''), style: { background: o }, onclick: () => this.change(() => set(o), rebuild) })));
      const pick = el('input', { type: 'color', value: cur, style: { width: '30px', height: '30px', border: 'none', background: 'none', padding: '0', cursor: 'pointer' } }) as HTMLInputElement;
      pick.addEventListener('input', () => { set(pick.value); this.liveColors(); });
      pick.addEventListener('change', () => this.change(() => {}, rebuild));
      row.append(pick);
      return row;
    };
    const slider = (min: number, max: number, step: number, cur: number, set: (v: number) => void) => {
      const s = el('input', { type: 'range', class: 'gg-slider', min, max, step, value: cur }) as HTMLInputElement;
      s.addEventListener('input', () => { set(parseFloat(s.value)); this.dirty = true; this.rebuildTimer = 0.25; });
      return s;
    };
    const toggles = (opts: { id: string; label: string }[], list: string[]) => el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '7px' } }, ...opts.map((o) => el('button', { class: 'gg-chip' + (list.includes(o.id) ? ' on' : ''), onclick: () => this.change(() => { const i = list.indexOf(o.id); if (i >= 0) list.splice(i, 1); else list.push(o.id); }) }, o.label)));
    switch (this.tab) {
      case 'species': {
        const name = el('input', { class: 'gg-input', placeholder: 'Name your cat', value: c.name, maxlength: 20 }) as HTMLInputElement;
        name.addEventListener('input', () => (c.name = name.value.replace(/[^\p{L}\p{N} '\-]/gu, '').slice(0, 20)));
        p.append(section('Name', name));
        p.append(section('Species', chips(Object.entries(SPECIES).map(([k, v]) => [k as Species, v.label]), c.species, (v) => {
          const keep = { id: c.id, name: c.name, lifeStage: c.lifeStage, accessories: c.accessories, scars: c.scars };
          this.cfg = Object.assign(defaultCat(v), keep);
        })));
        p.append(section('Life stage', chips(Object.entries(LIFE_STAGES).map(([k, v]) => [k as LifeStage, v.label]), c.lifeStage, (v) => (c.lifeStage = v))));
        p.append(el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)', lineHeight: '1.5' } }, 'Life stage changes size and how your cat moves: cubs bounce, elders take their time.'));
        break;
      }
      case 'body':
        p.append(section('Size', slider(0.85, 1.15, 0.01, c.size, (v) => (c.size = v))));
        p.append(section('Build', slider(0, 1, 0.01, c.build, (v) => (c.build = v)), el('div', { class: 'gg-row', style: { justifyContent: 'space-between', fontSize: '12px', color: 'var(--gg-cream-dim)' } }, 'Lean', 'Powerful')));
        break;
      case 'coat': {
        const sp = SPECIES[c.species];
        p.append(section('Coat colour', swatches(sp.coats, c.coat, (v) => (c.coat = v))));
        p.append(section('Underside', swatches(['#f4e8d0', '#eedbb4', '#f6f2ea', '#e2c89a', '#d8c0a0', '#c8b49a'], c.under, (v) => (c.under = v))));
        p.append(section('Pattern', chips([['none', 'None'], ['spots', 'Spots'], ['stripes', 'Stripes'], ['rosettes', 'Rosettes']] as [Pattern, string][], c.pattern, (v) => (c.pattern = v))));
        if (c.pattern !== 'none') {
          p.append(section('Pattern colour', swatches(['#1e150e', '#3a2414', '#5a3a1e', '#2a2a2c', '#6a6a6c', '#8a5a30'], c.patternColor, (v) => (c.patternColor = v))));
          p.append(section('Pattern scale', slider(0.6, 1.6, 0.01, c.patternScale, (v) => (c.patternScale = v))));
        }
        break;
      }
      case 'mane':
        p.append(section('Mane style', chips([['none', 'None'], ['short', 'Short'], ['full', 'Full'], ['wild', 'Wild'], ['swept', 'Swept back']] as [ManeStyle, string][], c.mane, (v) => (c.mane = v))));
        if (c.mane !== 'none') {
          p.append(section('Mane colour', swatches(MANE_COLORS, c.maneColor, (v) => (c.maneColor = v))));
          p.append(section('Mane length', slider(0, 1, 0.01, c.maneLength, (v) => (c.maneLength = v))));
        }
        break;
      case 'face':
        p.append(section('Eye colour', swatches(EYE_COLORS, c.eyeColor, (v) => (c.eyeColor = v), true)));
        break;
      case 'marks':
        p.append(section('Markings', toggles(MARKINGS, c.markings)));
        p.append(section('Scars', toggles(SCARS, c.scars)));
        break;
      case 'extras':
        p.append(section('Accessories', toggles(ACCESSORIES, c.accessories)));
        break;
    }
  }
  /** Update colour uniforms without rebuilding geometry (for the colour picker). */
  private liveColors() {
    if (!this.cat) return;
    const u = this.cat.uniforms;
    u.uCoat.value.set(this.cfg.coat); u.uUnder.value.set(this.cfg.under); u.uPatColor.value.set(this.cfg.patternColor); u.uManeColor.value.set(this.cfg.maneColor);
  }
  dispose() {
    this.game.setStudio(null);
    if (this.cat) { this.scene.remove(this.cat.group); this.cat.dispose(); }
    this.root.remove();
  }
}
void icon;
