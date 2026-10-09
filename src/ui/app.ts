import * as THREE from 'three';
import { el, icon } from './style';
import type { Game } from '../game/game';
import { Hud } from './hud';
import { Creator } from './creator';
import { PhotoMode } from './photo';
import { settingsPanel } from './settingsPanel';
import { Saves } from '../game/save';
import { SoloMode } from '../game/solo';
import { CatEntity } from '../game/entity';
import { CatConfig, defaultCat, randomName, SPECIES, LIFE_STAGES } from '../cat/catConfig';
import { SPAWN } from '../world/worldgen';

const MENU_CSS = /* css */ `
.gg-menu{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(20px,6vw,72px);background:linear-gradient(90deg,rgba(14,8,4,.55),rgba(14,8,4,0) 55%)}
.gg-menu .logo{font-family:var(--gg-display);font-weight:500;font-size:clamp(54px,9vw,120px);letter-spacing:.04em;line-height:.9;color:#fbecd0;text-shadow:0 4px 60px rgba(120,50,0,.55)}
.gg-menu .sub{margin:14px 0 34px;font:500 13px var(--gg-ui);letter-spacing:.34em;text-transform:uppercase;color:var(--gg-cream-dim)}
.gg-menu .actions{display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.gg-menu .actions .gg-btn{min-width:240px;text-align:left;font-size:16px;padding:16px 26px}
.gg-charcard{position:absolute;right:clamp(16px,4vw,48px);bottom:clamp(16px,6vw,72px);padding:16px 20px;min-width:230px}
.gg-select{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(12,7,3,.55)}
.gg-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;max-height:56vh;overflow:auto;padding:4px}
.gg-card{border:1px solid var(--gg-line);border-radius:16px;padding:14px 16px;background:rgba(255,255,255,.04);cursor:pointer;transition:all .15s;position:relative}
.gg-card:hover{border-color:rgba(231,183,102,.55)}
.gg-card.on{border-color:var(--gg-gold);background:rgba(231,183,102,.14)}
.gg-loading{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#120c07;color:#f6ead2;font-family:'Fraunces',Georgia,serif;z-index:20;transition:opacity .8s}
@media (max-width:760px),(max-height:520px){.gg-charcard{right:12px;bottom:12px;min-width:0;padding:10px 14px}.gg-charcard .gg-title{font-size:20px!important}.gg-menu .actions .gg-btn{min-width:200px;padding:12px 20px;font-size:15px}.gg-menu .sub{margin:8px 0 18px}}
@media (max-width:560px){.gg-charcard{left:12px;right:12px;bottom:auto;top:12px}.gg-menu .logo{font-size:48px}}
`;

/** Top-level flow: menu ⇄ character select / creator ⇄ play (solo / online), pause and photo mode. */
export class App {
  ui: HTMLElement;
  private screen: HTMLElement | null = null;
  private hud: Hud | null = null;
  private solo: SoloMode | null = null;
  private photo: PhotoMode | null = null;
  private creator: Creator | null = null;
  private showcaseT = 0;
  private onlineFactory: ((app: App, cfg: CatConfig) => Promise<void>) | null = null;
  constructor(public game: Game) {
    document.head.append(el('style', {}, MENU_CSS));
    this.ui = el('div', { id: 'gg-ui' });
    document.body.append(this.ui);
    game.onUi.push((dt) => this.tick(dt));
    const unlock = () => { game.audio.unlock(); game.audio.setVolumes(game.settings); };
    addEventListener('pointerdown', unlock, { once: true }); addEventListener('keydown', unlock, { once: true });
    addEventListener('keydown', (e) => {
      if (e.code === game.settings.keybinds.photo && game.state === 'play' && !this.typing(e)) this.openPhoto();
    });
    game.onPhoto = () => this.openPhoto();
    game.renderer.domElement.addEventListener('click', () => {
      if (game.state === 'play' && !game.input.isTouch && !this.hud?.modalOpen && !document.pointerLockElement) game.renderer.domElement.requestPointerLock?.();
    });
  }
  setOnline(f: (app: App, cfg: CatConfig) => Promise<void>) { this.onlineFactory = f; }
  private typing(e: KeyboardEvent) { const t = e.target as HTMLElement; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); }
  show(s: HTMLElement) {
    const old = this.screen;
    if (old) { old.classList.remove('show'); setTimeout(() => old.remove(), 600); }
    this.screen = s; s.classList.add('gg-screen'); this.ui.append(s);
    requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add('show')));
  }
  get character(): CatConfig | null {
    const list = Saves.characters(); const sel = Saves.selected();
    return list.find((c) => c.id === sel) ?? list[0] ?? null;
  }
  // ---------------- main menu ----------------
  menu() {
    const g = this.game;
    this.leavePlay();
    g.state = 'menu';
    g.paused = false;
    this.setupShowcase();
    const ch = this.character;
    const card = el('div', { class: 'gg-panel gg-charcard' },
      el('div', { class: 'gg-label' }, 'Your cat'),
      el('div', { class: 'gg-title', style: { fontSize: '26px', margin: '6px 0 4px' } }, ch ? ch.name : 'No cat yet'),
      el('div', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)', letterSpacing: '.1em', marginBottom: '12px' } }, ch ? `${SPECIES[ch.species].label.toUpperCase()} · ${LIFE_STAGES[ch.lifeStage].label.toUpperCase()}` : 'Create one to begin'),
      el('div', { class: 'gg-row' },
        el('button', { class: 'gg-btn small', onclick: () => this.select() }, ch ? 'Change' : 'Choose'),
        el('button', { class: 'gg-btn small ghost', onclick: () => this.create(null, () => this.menu()) }, 'New cat')));
    const s = el('div', {},
      el('div', { class: 'gg-menu' },
        el('div', { class: 'logo' }, 'Goldgrass'),
        el('div', { class: 'sub' }, 'A big-cat roleplay savanna'),
        el('div', { class: 'actions' },
          el('button', { class: 'gg-btn primary', onclick: () => this.startSolo() }, 'Play Solo'),
          el('button', { class: 'gg-btn', onclick: () => this.startOnline() }, 'Play Online'),
          el('button', { class: 'gg-btn ghost', onclick: () => this.settingsModal() }, 'Settings'))),
      card);
    this.show(s);
  }
  private setupShowcase() {
    const g = this.game;
    g.gw.env.setTime(17.75);
    g.gw.env.timeSpeed = 0.15;
    g.gw.env.rainTarget = 0; g.gw.env.rain = 0;
    const cfg = this.character ?? Object.assign(defaultCat('lion', 'Goldgrass'), { mane: 'full', maneLength: 0.85 });
    if (g.showcase && g.showcase.config.id === cfg.id && JSON.stringify(g.showcase.config) === JSON.stringify(cfg)) return;
    if (g.showcase) g.removeEntity(g.showcase);
    const q = g.quality;
    const e = new CatEntity(cfg, { shells: q.furShells, a2c: q.msaa > 0 });
    const x = SPAWN[0] + 6, z = SPAWN[1] - 18;
    const sd = g.gw.env.sunDir;
    e.place(x, z, g.world, Math.atan2(sd.x, sd.z) + 2.2);
    g.addEntity(e);
    e.setPose('sit');
    g.showcase = e;
  }
  private tick(dt: number) {
    const g = this.game;
    if (g.state === 'menu' && g.showcase) {
      this.showcaseT += dt;
      const e = g.showcase;
      const sd = g.gw.env.sunDir;
      const sunYaw = Math.atan2(sd.x, sd.z);
      // the camera sits low in the grass looking into the sun so the mane and grass are rim-lit
      const a = sunYaw + Math.PI + 0.55 + Math.sin(this.showcaseT * 0.05) * 0.25;
      const wide = innerWidth > 760;
      const r = (wide ? 5.4 : 7.2) * e.size;
      const cx = e.pos.x + Math.sin(a) * r, cz = e.pos.z + Math.cos(a) * r;
      const cy = Math.max(g.world.height(cx, cz), 0) + 1.25 * e.size;
      g.camera.position.set(cx, cy, cz);
      const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(wide ? -1.3 * e.size : 0);
      g.camera.lookAt(e.pos.x + side.x, e.pos.y + 0.6 * e.size, e.pos.z + side.z);
      // sitting keeps the head and mane above the grass; the occasional groom or lie-down adds life
      if (Math.random() < dt * 0.05) e.setPose(Math.random() < 0.5 ? 'groom' : 'lie', 6);
      if (!e.pose) e.setPose('sit');
    }
    if (g.state === 'play') this.hud?.update(dt);
    if (g.state === 'photo') this.photo?.update(dt);
  }
  // ---------------- character select / creator ----------------
  select(after?: (c: CatConfig) => void) {
    const list = Saves.characters();
    let sel = this.character?.id ?? null;
    const cards = el('div', { class: 'gg-cards' });
    const draw = () => {
      cards.innerHTML = '';
      for (const c of Saves.characters()) {
        const del = el('button', { class: 'gg-btn small ghost', style: { position: 'absolute', right: '6px', top: '6px', padding: '4px 8px' }, title: 'Delete', onclick: (ev: Event) => {
          ev.stopPropagation();
          if (confirm(`Delete ${c.name}? Their solo save goes too.`)) { Saves.deleteCharacter(c.id); if (sel === c.id) sel = null; draw(); }
        } }, icon('close', 14));
        cards.append(el('div', { class: 'gg-card' + (c.id === sel ? ' on' : ''), onclick: () => { sel = c.id; Saves.select(c.id); draw(); }, ondblclick: () => go() },
          el('div', { style: { width: '26px', height: '26px', borderRadius: '50%', background: `radial-gradient(circle at 35% 35%, ${c.coat}, ${c.maneColor})`, marginBottom: '10px', border: '1px solid rgba(255,255,255,.2)' } }),
          el('div', { style: { font: '600 16px var(--gg-ui)' } }, c.name),
          el('div', { style: { fontSize: '11px', letterSpacing: '.1em', color: 'var(--gg-cream-dim)', marginTop: '4px' } }, `${SPECIES[c.species].label.toUpperCase()} · ${LIFE_STAGES[c.lifeStage].label.toUpperCase()}`),
          Saves.solo(c.id) ? el('div', { style: { fontSize: '11px', color: 'var(--gg-gold)', marginTop: '6px' } }, `Solo: day ${Saves.solo(c.id)!.day}`) : null, del));
      }
      cards.append(el('div', { class: 'gg-card', style: { display: 'grid', placeItems: 'center', minHeight: '96px', color: 'var(--gg-cream-dim)' }, onclick: () => this.create(null, () => this.select(after)) }, '+ New cat'));
    };
    const go = () => { const c = Saves.characters().find((x) => x.id === sel); if (!c) return; Saves.select(c.id); if (after) after(c); else this.menu(); };
    draw();
    const s = el('div', { class: 'gg-select' },
      el('div', { class: 'gg-panel', style: { width: 'min(760px, calc(100% - 24px))', padding: '24px' } },
        el('div', { class: 'gg-row', style: { justifyContent: 'space-between', marginBottom: '16px' } },
          el('div', { class: 'gg-title', style: { fontSize: '30px' } }, 'Your cats'),
          el('button', { class: 'gg-btn small ghost', onclick: () => this.menu() }, 'Back')),
        cards,
        el('div', { class: 'gg-row', style: { justifyContent: 'flex-end', marginTop: '18px', gap: '10px' } },
          el('button', { class: 'gg-btn small', onclick: () => { const c = Saves.characters().find((x) => x.id === sel); if (c) this.create(c, () => this.select(after)); } }, 'Edit'),
          el('button', { class: 'gg-btn primary', onclick: go }, after ? 'Play' : 'Select'))));
    void list;
    this.show(s);
  }
  create(initial: CatConfig | null, back: () => void, after?: (c: CatConfig) => void) {
    const g = this.game;
    g.state = 'creator';
    this.creator?.dispose();
    const cr = new Creator(g, initial, (cfg) => {
      Saves.saveCharacter(cfg); Saves.select(cfg.id);
      cr.dispose(); this.creator = null;
      if (g.showcase) { g.removeEntity(g.showcase); g.showcase = null; }
      if (after) after(cfg); else this.startSolo(cfg);
    }, () => { cr.dispose(); this.creator = null; back(); });
    this.creator = cr;
    this.show(cr.root);
  }
  // ---------------- play ----------------
  startSolo(cfg?: CatConfig) {
    const c = cfg ?? this.character;
    if (!c) {
      // first visit: go straight to the creator with a ready-made cat; one click to play
      this.create(null, () => this.menu());
      return;
    }
    this.enterPlay(c);
    this.solo = new SoloMode(this.game, this.hud!, c);
    this.game.mode = this.solo;
  }
  async startOnline(cfg?: CatConfig) {
    const c = cfg ?? this.character;
    if (!c) { this.create(null, () => this.menu(), (nc) => this.startOnline(nc)); return; }
    if (!this.onlineFactory) { this.toast('Online is getting ready', 'Try Solo for now'); return; }
    await this.onlineFactory(this, c);
  }
  enterPlay(c: CatConfig) {
    const g = this.game;
    this.leavePlay();
    if (g.showcase) { g.removeEntity(g.showcase); g.showcase = null; }
    g.state = 'play';
    g.paused = false;
    const s = el('div', { style: { pointerEvents: 'none' } });
    this.show(s);
    this.hud = new Hud(g, s);
    this.hud.onMenu = () => this.pauseMenu();
    void c;
    return this.hud;
  }
  get currentHud() { return this.hud; }
  leavePlay() {
    const g = this.game;
    if (this.photo) { this.photo.exit(); this.photo = null; }
    if (g.mode) { g.mode.dispose?.(); g.mode = null; }
    this.solo = null;
    if (this.hud) { this.hud.dispose(); this.hud = null; }
    if (g.player) { g.removeEntity(g.player); g.player = null; }
    if (document.pointerLockElement) document.exitPointerLock();
  }
  pauseMenu() {
    const g = this.game, hud = this.hud; if (!hud) return;
    const wasPaused = g.paused;
    if (this.solo) g.paused = true;
    const close = () => { hud.closeModal(); g.paused = wasPaused; };
    const box = el('div', { class: 'gg-panel', style: { padding: '26px', minWidth: '300px' } },
      el('div', { class: 'gg-title', style: { fontSize: '34px', marginBottom: '18px' } }, this.solo ? 'Paused' : 'Menu'),
      el('div', { class: 'gg-col' },
        el('button', { class: 'gg-btn primary', onclick: close }, 'Resume'),
        el('button', { class: 'gg-btn', onclick: () => { close(); this.openPhoto(); } }, 'Photo mode'),
        el('button', { class: 'gg-btn', onclick: () => { hud.closeModal(); g.paused = wasPaused; hud.toggleSide('settings', () => settingsPanel(g)); } }, 'Settings'),
        el('button', { class: 'gg-btn ghost', onclick: () => { hud.closeModal(); this.menu(); } }, this.solo ? 'Save & quit to menu' : 'Leave server')));
    hud.openModal(box);
  }
  openPhoto() {
    const g = this.game;
    if (g.state !== 'play' || !g.player) return;
    if (this.hud) this.hud.root.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
    this.photo = new PhotoMode(g, this.ui, () => { this.photo = null; if (this.hud) this.hud.root.style.display = ''; });
  }
  settingsModal() {
    const box = el('div', { class: 'gg-panel', style: { width: 'min(460px, calc(100% - 24px))', height: 'min(640px, calc(100% - 40px))', position: 'relative' } }, settingsPanel(this.game));
    const wrap = el('div', { class: 'gg-select', onclick: (e: Event) => { if (e.target === wrap) wrap.remove(); } }, box);
    box.append(el('button', { class: 'gg-icbtn', style: { position: 'absolute', right: '12px', top: '12px', width: '34px', height: '34px' }, onclick: () => wrap.remove() }, icon('close', 16)));
    this.ui.append(wrap);
    wrap.style.pointerEvents = 'auto';
  }
  /** Key-art scene (?keyart): a maned lion in golden-hour grass, rim-lit, shallow depth of field. */
  /** Staged cinematic shot for key art and trailers. Params: sp, ls, x, z, t, face, pose, ca, cd, fov, ch, ty, rain, bokeh, nodof,
   *  extra=sp:dx:dz:pose:ls:yaw;... companions placed relative to the hero. */
  keyArt(params: URLSearchParams) {
    const g = this.game;
    const num = (k: string, d: number) => (params.has(k) ? parseFloat(params.get(k)!) : d);
    const mk = (sp: string, ls?: string) => {
      const c = defaultCat((sp || 'lion') as any, 'Goldgrass') as CatConfig;
      if (c.species === 'lion') Object.assign(c, { mane: 'full', maneLength: 0.9, build: 0.7, size: 1.08 });
      if (ls) c.lifeStage = ls as any;
      return c;
    };
    const cfg = mk(params.get('sp') || 'lion', params.get('ls') || undefined);
    this.enterPlay(cfg);
    this.hud!.root.style.display = 'none';
    const x = num('x', SPAWN[0] + 30), z = num('z', SPAWN[1] - 30);
    g.gw.env.setTime(num('t', 17.85));
    const rain = num('rain', 0);
    g.gw.env.timeSpeed = 0; g.gw.env.rain = rain; g.gw.env.rainTarget = rain; g.gw.env.nextWeatherCheck = 1e9;
    const sd = g.gw.env.sunDir;
    const sunYaw = Math.atan2(sd.x, sd.z);
    const yaw = sunYaw + num('face', 2.0);
    const p = g.spawnPlayer(cfg, x, z, yaw);
    const pose = params.get('pose');
    if (pose) p.setPose(pose as any);
    for (const spec of (params.get('extra') || '').split(';').filter(Boolean)) {
      const [sp, dx, dz, ps, ls, yw] = spec.split(':');
      const e = new CatEntity(mk(sp, ls || undefined), { shells: g.quality.furShells, a2c: g.quality.msaa > 0 });
      e.place(x + parseFloat(dx || '0'), z + parseFloat(dz || '0'), g.world, yaw + parseFloat(yw || '0'));
      g.addEntity(e);
      if (ps) e.setPose(ps as any);
    }
    g.state = 'photo';
    const camA = sunYaw + Math.PI + num('ca', 0.5);
    const dist = num('cd', 4.6);
    const ty = num('ty', 0.95) * p.size;
    const cx = p.pos.x + Math.sin(camA) * dist, cz = p.pos.z + Math.cos(camA) * dist;
    g.camera.fov = num('fov', 32); g.camera.updateProjectionMatrix();
    g.camera.position.set(cx, Math.max(g.world.height(cx, cz), 0) + num('ch', 1.05), cz);
    g.camera.lookAt(p.pos.x, p.pos.y + ty, p.pos.z);
    if (!params.has('nodof')) g.post.enableDOF(true, dist, num('bokeh', 2.5));
    g.onUi.push(() => { g.camera.lookAt(p.pos.x, p.pos.y + ty, p.pos.z); });
  }
  toast(t1: string, t2 = '') {
    const t = el('div', { class: 'gg-toast show' }, el('div', { class: 't1' }, t1), el('div', { class: 't2' }, t2));
    this.ui.append(t); setTimeout(() => t.classList.remove('show'), 2600); setTimeout(() => t.remove(), 4000);
  }
}
void randomName;
