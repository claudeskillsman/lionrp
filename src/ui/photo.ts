import * as THREE from 'three';
import { el, icon } from './style';
import type { Game } from '../game/game';
import { EMOTES } from '../game/controller';
import type { PoseName } from '../cat/catRig';

/** Photo mode: free camera, poses, time of day, filters, depth of field, screenshot. */
export class PhotoMode {
  root: HTMLElement;
  private yaw = 0; private pitch = -0.1;
  private pos = new THREE.Vector3();
  private savedTime: number;
  private savedPaused: boolean;
  private focus = 6; private bokeh = 3; private dof = true; private fov = 40;
  private filter = 0;
  private panel: HTMLElement;
  private uiHidden = false;
  constructor(private game: Game, parent: HTMLElement, private onExit: () => void) {
    const cam = game.camera;
    this.pos.copy(cam.position);
    const d = new THREE.Vector3(); cam.getWorldDirection(d);
    this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    this.savedTime = game.gw.env.time;
    this.savedPaused = game.paused;
    game.paused = true;
    game.state = 'photo';
    if (game.player) this.focus = game.player.pos.distanceTo(cam.position);
    this.panel = this.buildPanel();
    this.root = el('div', { class: 'gg-screen show', style: { pointerEvents: 'none' } }, this.panel,
      el('div', { style: { position: 'absolute', left: '50%', bottom: '18px', transform: 'translateX(-50%)', fontSize: '12px', color: 'var(--gg-cream-dim)', letterSpacing: '.08em', textShadow: '0 1px 4px #000' } },
        game.input.isTouch ? 'Drag to look, use the joystick to fly' : 'WASD to fly · Q/E down/up · drag to look · H hides the panel'));
    parent.append(this.root);
    this.apply();
    addEventListener('keydown', this.key);
  }
  private key = (e: KeyboardEvent) => {
    if (e.code === 'KeyH') { this.uiHidden = !this.uiHidden; this.panel.style.opacity = this.uiHidden ? '0' : '1'; this.panel.style.pointerEvents = this.uiHidden ? 'none' : 'auto'; }
    if (e.code === 'Escape' || e.code === this.game.settings.keybinds.photo) this.exit();
  };
  private apply() {
    const g = this.game;
    g.post.enableDOF(this.dof, this.focus, this.bokeh);
    g.post.grade.uniforms.get('filterMode')!.value = this.filter;
    g.camera.fov = this.fov; g.camera.updateProjectionMatrix();
  }
  private buildPanel() {
    const g = this.game;
    const sl = (label: string, min: number, max: number, step: number, v: number, set: (n: number) => void, fmt?: (n: number) => string) => {
      const out = el('span', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)' } }, fmt ? fmt(v) : '');
      const i = el('input', { type: 'range', class: 'gg-slider', min, max, step, value: v }) as HTMLInputElement;
      i.addEventListener('input', () => { const n = parseFloat(i.value); set(n); if (fmt) out.textContent = fmt(n); this.apply(); });
      return el('div', { style: { margin: '12px 0' } }, el('div', { class: 'gg-row', style: { justifyContent: 'space-between', marginBottom: '6px' } }, el('span', { class: 'gg-label' }, label), out), i);
    };
    const hour = (n: number) => { const h = Math.floor(n), m = Math.floor((n - h) * 60); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
    const filters = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '6px' } });
    const drawF = () => { filters.innerHTML = ''; ['None', 'Mono', 'Film', 'Warm', 'Cool'].forEach((n, i) => filters.append(el('button', { class: 'gg-chip' + (this.filter === i ? ' on' : ''), onclick: () => { this.filter = i; drawF(); this.apply(); } }, n))); };
    drawF();
    const poses = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '6px' } });
    const setPose = (p: PoseName | null) => { const pl = g.player; if (!pl) return; pl.setPose(p); };
    poses.append(el('button', { class: 'gg-chip', onclick: () => setPose(null) }, 'Stand'));
    for (const e of EMOTES) poses.append(el('button', { class: 'gg-chip', onclick: () => setPose(e.pose) }, e.label));
    const dofT = el('button', { class: 'gg-chip on', onclick: () => { this.dof = !this.dof; dofT.classList.toggle('on', this.dof); this.apply(); } }, 'Depth of field');
    const shot = el('button', { class: 'gg-btn primary', style: { width: '100%', marginTop: '10px' }, onclick: () => this.shoot() }, icon('camera', 16), ' Take photo');
    shot.style.display = 'flex'; shot.style.justifyContent = 'center'; shot.style.gap = '8px';
    return el('div', { class: 'gg-panel gg-scroll interactive', style: { position: 'absolute', right: '14px', top: '14px', width: '300px', maxHeight: 'calc(100% - 28px)', padding: '16px 18px', pointerEvents: 'auto', transition: 'opacity .3s' } },
      el('div', { class: 'gg-row', style: { justifyContent: 'space-between' } }, el('div', { class: 'gg-title', style: { fontSize: '22px' } }, 'Photo mode'), el('button', { class: 'gg-btn small ghost', onclick: () => this.exit() }, 'Done')),
      sl('Time of day', 0, 24, 0.05, g.gw.env.time, (n) => g.gw.env.setTime(n), hour),
      sl('Field of view', 15, 80, 1, this.fov, (n) => (this.fov = n), (n) => n + '°'),
      el('div', { class: 'gg-row', style: { margin: '10px 0' } }, dofT),
      sl('Focus distance', 0.5, 60, 0.1, this.focus, (n) => (this.focus = n), (n) => n.toFixed(1) + ' m'),
      sl('Blur', 0.5, 8, 0.1, this.bokeh, (n) => (this.bokeh = n), (n) => n.toFixed(1)),
      el('div', { class: 'gg-label', style: { margin: '14px 0 8px' } }, 'Filter'), filters,
      el('div', { class: 'gg-label', style: { margin: '14px 0 8px' } }, 'Pose'), poses,
      shot);
  }
  async shoot() {
    const g = this.game;
    const prev = this.panel.style.opacity;
    this.panel.style.opacity = '0';
    const blob = await g.screenshot();
    this.panel.style.opacity = prev;
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `goldgrass-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    const flash = el('div', { style: { position: 'fixed', inset: '0', background: '#fff', opacity: '0.7', transition: 'opacity .5s', pointerEvents: 'none' } });
    document.body.append(flash); requestAnimationFrame(() => (flash.style.opacity = '0')); setTimeout(() => flash.remove(), 600);
  }
  update(dt: number) {
    const g = this.game, inp = g.input, cam = g.camera;
    this.yaw -= inp.mouseDX * 0.0035; this.pitch = THREE.MathUtils.clamp(this.pitch - inp.mouseDY * 0.0035, -1.45, 1.45);
    const a = inp.axes();
    const f = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const sp = (inp.down('sprint') ? 12 : 3.5) * dt;
    this.pos.addScaledVector(f, a.y * sp).addScaledVector(r, a.x * sp);
    if (inp.keys.has('KeyE') || inp.keys.has('Space')) this.pos.y += sp;
    if (inp.keys.has('KeyQ') || inp.keys.has('ControlLeft')) this.pos.y -= sp;
    // keep it near the cat and above ground
    const p = g.player;
    if (p) { const off = this.pos.clone().sub(p.pos); if (off.length() > 40) this.pos.copy(p.pos).add(off.setLength(40)); }
    this.pos.y = Math.max(this.pos.y, Math.max(g.world.height(this.pos.x, this.pos.z), 0) + 0.15);
    cam.position.copy(this.pos);
    cam.lookAt(this.pos.clone().add(f));
    // advance animation even while the world clock is paused so poses settle
    if (p) p.cat.update(dt);
  }
  exit() {
    const g = this.game;
    removeEventListener('keydown', this.key);
    g.post.enableDOF(false);
    g.post.grade.uniforms.get('filterMode')!.value = 0;
    g.camera.fov = 50; g.camera.updateProjectionMatrix();
    g.paused = this.savedPaused;
    g.state = 'play';
    g.follow.snap();
    this.root.remove();
    this.onExit();
  }
}
