import * as THREE from 'three';
import { el, icon } from './style';
import type { Game } from '../game/game';
import { PlayerController, EMOTES, SocialAct } from '../game/controller';
import type { CatEntity } from '../game/entity';
import { BIOMES, BiomeKey } from '../world/worldgen';

const HUD_CSS = /* css */ `
.gg-hud{position:absolute;inset:0;transition:opacity .9s ease}
.gg-hud.idle .gg-idlefade{opacity:.0}
.gg-idlefade{transition:opacity 1.4s ease}
.gg-meters{position:absolute;left:22px;top:20px;display:flex;flex-direction:column;gap:9px}
.gg-meter{display:flex;align-items:center;gap:9px;font:600 11px var(--gg-ui);letter-spacing:.12em;color:var(--gg-cream-dim)}
.gg-meter .bar{width:120px;height:5px;border-radius:5px;background:rgba(246,234,210,.16);overflow:hidden}
.gg-meter .fill{height:100%;border-radius:5px;background:linear-gradient(90deg,#e7b766,#f6ead2);transition:width .4s}
.gg-meter.low .fill{background:linear-gradient(90deg,#d6563a,#f0a070)}
.gg-topright{position:absolute;right:16px;top:14px;display:flex;gap:8px}
.gg-icbtn{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--gg-line);background:var(--gg-glass);color:var(--gg-cream);cursor:pointer;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.gg-icbtn:hover{border-color:rgba(231,183,102,.6)}
.gg-prompt{position:absolute;left:50%;bottom:13%;transform:translateX(-50%);padding:10px 16px;border-radius:999px;background:var(--gg-glass);border:1px solid var(--gg-line);font:600 13px var(--gg-ui);letter-spacing:.05em;backdrop-filter:blur(12px);opacity:0;transition:opacity .25s;white-space:nowrap}
.gg-prompt.show{opacity:1}
.gg-wheel{position:absolute;left:50%;top:50%;width:360px;height:360px;margin:-180px 0 0 -180px;border-radius:50%;opacity:0;transform:scale(.9);transition:opacity .18s, transform .18s;pointer-events:none}
.gg-wheel.show{opacity:1;transform:scale(1);pointer-events:auto}
.gg-wheel .ring{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle, rgba(20,13,8,.0) 30%, rgba(20,13,8,.55) 31%, rgba(20,13,8,.55) 70%, rgba(20,13,8,0) 71%);backdrop-filter:blur(6px)}
.gg-wheel .item{position:absolute;width:86px;height:56px;margin:-28px 0 0 -43px;display:flex;align-items:center;justify-content:center;text-align:center;border-radius:14px;font:600 13px var(--gg-ui);cursor:pointer;color:var(--gg-cream);transition:background .12s, transform .12s}
.gg-wheel .item.on,.gg-wheel .item:hover{background:rgba(231,183,102,.25);transform:scale(1.08)}
.gg-wheel .center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:500 18px var(--gg-display);letter-spacing:.06em;color:var(--gg-cream-dim)}
.gg-tag{position:absolute;transform:translate(-50%,-100%);text-align:center;pointer-events:none;white-space:nowrap;text-shadow:0 1px 6px rgba(0,0,0,.7)}
.gg-tag .n{font:600 13px var(--gg-ui);letter-spacing:.03em}
.gg-tag .s{font:600 10px var(--gg-ui);letter-spacing:.14em;text-transform:uppercase;opacity:.85;margin-top:2px}
.gg-bubble{position:absolute;transform:translate(-50%,-100%);max-width:240px;padding:8px 12px;border-radius:14px;background:rgba(250,242,226,.92);color:#2a1a0e;font:500 13px/1.35 var(--gg-ui);pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.25);transition:opacity .4s}
.gg-bubble.me{background:rgba(40,26,14,.8);color:#f6ead2;font-style:italic}
.gg-joy{position:absolute;left:28px;bottom:28px;width:130px;height:130px;border-radius:50%;background:rgba(20,13,8,.28);border:1px solid var(--gg-line);touch-action:none}
.gg-joy .knob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(246,234,210,.35);border:1px solid rgba(246,234,210,.5)}
.gg-tbtns{position:absolute;right:20px;bottom:24px;display:grid;grid-template-columns:repeat(3,58px);gap:10px;touch-action:none}
.gg-tbtn{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;background:rgba(20,13,8,.35);border:1px solid var(--gg-line);color:var(--gg-cream);font:700 10px var(--gg-ui);letter-spacing:.06em}
.gg-tbtn.on{background:rgba(231,183,102,.35)}
.gg-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,6,3,.35);opacity:0;transition:opacity .25s;pointer-events:none}
.gg-modal.show{opacity:1;pointer-events:auto}
.gg-side{position:absolute;right:16px;top:68px;bottom:16px;width:min(400px,calc(100% - 32px));display:flex;flex-direction:column;transform:translateX(30px);opacity:0;transition:all .3s;pointer-events:none}
.gg-side.show{transform:none;opacity:1;pointer-events:auto}
.gg-compass{position:absolute;left:50%;top:16px;transform:translateX(-50%);font:600 11px var(--gg-ui);letter-spacing:.3em;color:var(--gg-cream-dim)}
.gg-clock{position:absolute;left:22px;top:104px;font:600 11px var(--gg-ui);letter-spacing:.14em;color:var(--gg-cream-dim)}
`;

export interface TagInfo { e: CatEntity; name: string; sub?: string; color?: string; }

/** In-game overlay: meters, prompts, emote wheel, social menu, touch controls, tags, modals, side panels. */
export class Hud {
  root: HTMLElement;
  ctrl: PlayerController;
  private meters!: { hunger: HTMLElement; thirst: HTMLElement; stamina: HTMLElement; box: HTMLElement };
  private prompt!: HTMLElement;
  private toast!: HTMLElement;
  private wheel!: HTMLElement;
  private wheelOpen = false;
  private wheelSel = -1;
  private modal!: HTMLElement;
  private side!: HTMLElement;
  private tagLayer!: HTMLElement;
  private tagEls = new Map<CatEntity, HTMLElement>();
  private bubbles: { e: CatEntity; el: HTMLElement; t: number }[] = [];
  private idleT = 0;
  private toastTimer = 0;
  private clock!: HTMLElement;
  private topRight!: HTMLElement;
  tags: () => TagInfo[] = () => [];
  onMenu: () => void = () => {};
  sideOpen: string | null = null;
  hidden = false;
  constructor(private game: Game, parent: HTMLElement) {
    if (!document.getElementById('gg-hud-css')) document.head.append(el('style', { id: 'gg-hud-css' }, HUD_CSS));
    this.ctrl = new PlayerController(game);
    this.root = el('div', { class: 'gg-hud', style: { pointerEvents: 'none' } });
    parent.append(this.root);
    this.build();
    game.onBiome = (b) => this.showBiome(b);
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('mousemove', this.wake); addEventListener('pointerdown', this.wake);
  }
  private wake = () => { this.idleT = 0; };
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    this.idleT = 0;
    const kb = this.game.settings.keybinds;
    if (e.code === 'Escape') { if (this.closeAll()) return; this.onMenu(); }
    if (this.game.state !== 'play') return;
    if (e.code === kb.emote && !e.repeat) this.openWheel();
    if (e.code === kb.hideUi) { this.hidden = !this.hidden; this.root.style.opacity = this.hidden ? '0' : '1'; }
    if (e.code === kb.interact && this.ctrl.context?.kind === 'cat') this.openSocial(this.ctrl.context.target);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === this.game.settings.keybinds.emote && this.wheelOpen) this.closeWheel(true);
  };
  private build() {
    const g = this.game;
    // meters
    const meter = (ic: Parameters<typeof icon>[0], label: string) => {
      const fill = el('div', { class: 'fill', style: { width: '80%' } });
      const m = el('div', { class: 'gg-meter' }, icon(ic, 15), el('div', { class: 'bar' }, fill), el('span', {}, label));
      return { m, fill };
    };
    const h = meter('meat', 'HUNGER'), t = meter('drop', 'THIRST'), s = meter('run', 'STAMINA');
    const box = el('div', { class: 'gg-meters gg-idlefade' }, h.m, t.m, s.m);
    this.meters = { hunger: h.fill, thirst: t.fill, stamina: s.fill, box };
    this.clock = el('div', { class: 'gg-clock gg-idlefade' });
    this.prompt = el('div', { class: 'gg-prompt' });
    this.toast = el('div', { class: 'gg-toast' }, el('div', { class: 't1' }), el('div', { class: 't2' }));
    this.tagLayer = el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
    this.topRight = el('div', { class: 'gg-topright gg-idlefade' });
    this.addButton('smile', 'Emotes (E)', () => (this.wheelOpen ? this.closeWheel(false) : this.openWheel()));
    this.addButton('camera', 'Photo mode (P)', () => g.onPhoto?.());
    this.addButton('menu', 'Menu (Esc)', () => this.onMenu());
    // emote wheel
    this.wheel = el('div', { class: 'gg-wheel' }, el('div', { class: 'ring' }), el('div', { class: 'center' }, 'Emote'));
    EMOTES.forEach((em, i) => {
      const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
      const it = el('div', { class: 'item', style: { left: 180 + Math.cos(a) * 128 + 'px', top: 180 + Math.sin(a) * 128 + 'px' } }, em.label);
      it.addEventListener('pointerenter', () => this.selectWheel(i));
      it.addEventListener('click', () => { this.selectWheel(i); this.closeWheel(true); });
      this.wheel.append(it);
    });
    this.wheel.addEventListener('pointermove', (e) => {
      const r = this.wheel.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < 50) return this.selectWheel(-1);
      let a = Math.atan2(dy, dx) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
      this.selectWheel(Math.round(a / (Math.PI * 2) * EMOTES.length) % EMOTES.length);
    });
    this.modal = el('div', { class: 'gg-modal', onclick: (e: Event) => { if (e.target === this.modal) this.closeModal(); } });
    this.side = el('div', { class: 'gg-side gg-panel' });
    this.root.append(this.tagLayer, box, this.clock, this.topRight, this.prompt, this.toast, this.wheel, this.side, this.modal);
    if (g.input.isTouch) this.buildTouch();
    this.prompt.addEventListener('click', () => { if (this.ctrl.context?.kind === 'cat') this.openSocial(this.ctrl.context.target); else this.ctrl.touchAct = true; });
  }
  addButton(ic: Parameters<typeof icon>[0], title: string, fn: () => void, before = false) {
    const b = el('button', { class: 'gg-icbtn', title, 'aria-label': title, onclick: fn }, icon(ic, 19));
    if (before) this.topRight.prepend(b); else this.topRight.append(b);
    return b;
  }
  private buildTouch() {
    const g = this.game, inp = g.input;
    const knob = el('div', { class: 'knob' });
    const joy = el('div', { class: 'gg-joy interactive' }, knob);
    let id: number | null = null, cx = 0, cy = 0;
    joy.addEventListener('pointerdown', (e) => { id = e.pointerId; const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; joy.setPointerCapture(e.pointerId); move(e); });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      let dx = (e.clientX - cx) / 50, dy = (e.clientY - cy) / 50;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      inp.touchActive = true; inp.touchMove.x = dx; inp.touchMove.y = -dy;
      if (l > 1.25) inp.touchButtons.add('sprint'); else if (!sprintLatched) inp.touchButtons.delete('sprint');
      knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
    };
    joy.addEventListener('pointermove', move);
    const end = (e: PointerEvent) => { if (e.pointerId !== id) return; id = null; inp.touchActive = false; inp.touchMove.x = inp.touchMove.y = 0; knob.style.transform = ''; if (!sprintLatched) inp.touchButtons.delete('sprint'); };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
    let sprintLatched = false;
    const btn = (label: string, ic: Parameters<typeof icon>[0] | null, down: (b: HTMLElement) => void, up?: () => void) => {
      const b = el('div', { class: 'gg-tbtn interactive' }, ic ? icon(ic, 22) : label);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); down(b); });
      if (up) { b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); }
      return b;
    };
    const grid = el('div', { class: 'gg-tbtns' },
      btn('Emote', 'smile', () => (this.wheelOpen ? this.closeWheel(false) : this.openWheel())),
      btn('Crouch', 'crouch', (b) => { this.ctrl.touchCrouch = !this.ctrl.touchCrouch; b.classList.toggle('on', this.ctrl.touchCrouch); }),
      btn('Sprint', 'run', (b) => { sprintLatched = !sprintLatched; b.classList.toggle('on', sprintLatched); if (sprintLatched) inp.touchButtons.add('sprint'); else inp.touchButtons.delete('sprint'); }),
      el('div'),
      btn('Act', 'paw', () => { if (this.ctrl.context?.kind === 'cat') this.openSocial(this.ctrl.context.target); else this.ctrl.touchAct = true; }),
      btn('Jump', 'jump', () => { inp.touchPressed.add('jump'); }),
    );
    this.root.append(joy, grid);
  }
  // ---------- emote wheel ----------
  private selectWheel(i: number) {
    this.wheelSel = i;
    this.wheel.querySelectorAll('.item').forEach((n, j) => n.classList.toggle('on', j === i));
  }
  openWheel() {
    this.wheelOpen = true; this.wheel.classList.add('show'); this.selectWheel(-1);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closeWheel(apply: boolean) {
    this.wheelOpen = false; this.wheel.classList.remove('show');
    if (apply && this.wheelSel >= 0) this.ctrl.emote(EMOTES[this.wheelSel].pose);
  }
  // ---------- social ----------
  openSocial(target: CatEntity) {
    const p = this.game.player!;
    const acts: [SocialAct, string, boolean][] = [
      ['groomOther', 'Groom', true],
      ['nuzzle', 'Nuzzle', true],
      ['carry', 'Carry cub', target.config.lifeStage === 'cub' && p.config.lifeStage !== 'cub'],
      ['playfight', 'Play-fight', true],
    ];
    const box = el('div', { class: 'gg-panel', style: { padding: '22px', minWidth: '280px' } },
      el('div', { class: 'gg-label' }, 'With'),
      el('div', { class: 'gg-title', style: { fontSize: '28px', margin: '6px 0 16px' } }, target.config.name),
      el('div', { class: 'gg-col' }, ...acts.filter((a) => a[2]).map(([a, l]) => el('button', { class: 'gg-btn', onclick: () => { this.closeModal(); this.ctrl.social(a, target); } }, l))));
    this.openModal(box);
  }
  // ---------- modals / side panels ----------
  openModal(content: HTMLElement) {
    this.modal.innerHTML = ''; this.modal.append(content); this.modal.classList.add('show');
    this.game.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closeModal() { this.modal.classList.remove('show'); this.game.input.enabled = true; }
  get modalOpen() { return this.modal.classList.contains('show'); }
  toggleSide(id: string, build: () => HTMLElement) {
    if (this.sideOpen === id) return this.closeSide();
    this.sideOpen = id;
    this.side.innerHTML = '';
    const close = el('button', { class: 'gg-icbtn', style: { position: 'absolute', right: '12px', top: '12px', width: '34px', height: '34px' }, onclick: () => this.closeSide() }, icon('close', 16));
    this.side.append(build(), close);
    this.side.classList.add('show');
  }
  refreshSide(id: string, build: () => HTMLElement) { if (this.sideOpen === id) { this.sideOpen = null; this.toggleSide(id, build); } }
  closeSide() { this.sideOpen = null; this.side.classList.remove('show'); }
  closeAll() {
    if (this.wheelOpen) { this.closeWheel(false); return true; }
    if (this.modalOpen) { this.closeModal(); return true; }
    if (this.sideOpen) { this.closeSide(); return true; }
    return false;
  }
  // ---------- toasts ----------
  showBiome(b: BiomeKey) { const d = BIOMES[b]; this.showToast(d.name, d.tagline ?? ''); }
  showToast(t1: string, t2 = '', secs = 4) {
    (this.toast.children[0] as HTMLElement).textContent = t1;
    (this.toast.children[1] as HTMLElement).textContent = t2;
    this.toast.classList.add('show'); this.toastTimer = secs;
  }
  hideToast() { this.toast.classList.remove('show'); this.toastTimer = 0; }
  say(e: CatEntity, text: string, me = false) {
    const b = el('div', { class: 'gg-bubble' + (me ? ' me' : '') }, me ? `${e.config.name} ${text}` : text);
    this.tagLayer.append(b);
    this.bubbles.push({ e, el: b, t: Math.min(10, 4 + text.length * 0.06) });
    const mine = this.bubbles.filter((x) => x.e === e);
    if (mine.length > 2) { mine[0].el.remove(); this.bubbles.splice(this.bubbles.indexOf(mine[0]), 1); }
  }
  // ---------- per frame ----------
  update(dt: number) {
    const g = this.game, p = g.player;
    this.ctrl.update(dt);
    if (g.input.axes().x || g.input.axes().y) this.idleT = 0;
    this.idleT += dt;
    this.root.classList.toggle('idle', this.idleT > 6 && !this.wheelOpen && !this.sideOpen);
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toast.classList.remove('show'); }
    if (p) {
      const surv = g.settings.survival;
      this.meters.box.style.display = surv ? '' : 'none';
      this.meters.hunger.style.width = p.hunger + '%';
      this.meters.thirst.style.width = p.thirst + '%';
      this.meters.stamina.style.width = p.stamina * 100 + '%';
      this.meters.hunger.parentElement!.parentElement!.classList.toggle('low', p.hunger < 20);
      this.meters.thirst.parentElement!.parentElement!.classList.toggle('low', p.thirst < 20);
      const pt = this.ctrl.promptText();
      if (pt) {
        const key = g.input.isTouch ? '' : `<span class="gg-kbd">${(g.settings.keybinds.interact || 'KeyF').replace('Key', '')}</span>`;
        const html = key + pt;
        if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
      }
      this.prompt.classList.toggle('show', !!pt && !this.wheelOpen && !this.modalOpen);
      this.prompt.style.pointerEvents = pt ? 'auto' : 'none';
    }
    const hr = g.gw.env.time;
    const hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60);
    this.clock.style.top = g.settings.survival ? '104px' : '22px';
    this.clock.textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
    this.updateTags(dt);
  }
  private v = new THREE.Vector3();
  private updateTags(dt: number) {
    const g = this.game, cam = g.camera;
    const W = innerWidth, H = innerHeight;
    const list = g.settings.showNames ? this.tags() : [];
    const seen = new Set<CatEntity>();
    for (const t of list) {
      const e = t.e;
      if (!e.object.visible) continue;
      const d = e.pos.distanceTo(cam.position);
      if (d > 45) continue;
      this.v.set(e.pos.x, e.pos.y + e.height * 1.25 + 0.25, e.pos.z).project(cam);
      if (this.v.z > 1) continue;
      seen.add(e);
      let tag = this.tagEls.get(e);
      if (!tag) { tag = el('div', { class: 'gg-tag' }, el('div', { class: 'n' }), el('div', { class: 's' })); this.tagLayer.append(tag); this.tagEls.set(e, tag); }
      (tag.children[0] as HTMLElement).textContent = t.name;
      (tag.children[1] as HTMLElement).textContent = t.sub ?? '';
      (tag.children[1] as HTMLElement).style.color = t.color ?? '';
      tag.style.left = ((this.v.x * 0.5 + 0.5) * W).toFixed(1) + 'px';
      tag.style.top = ((-this.v.y * 0.5 + 0.5) * H).toFixed(1) + 'px';
      tag.style.opacity = String(THREE.MathUtils.clamp((45 - d) / 15, 0, 1));
    }
    for (const [e, tag] of this.tagEls) if (!seen.has(e)) { tag.remove(); this.tagEls.delete(e); }
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t -= dt;
      const e = b.e;
      const stack = this.bubbles.filter((x) => x.e === e);
      const k = stack.length - 1 - stack.indexOf(b);
      this.v.set(e.pos.x, e.pos.y + e.height * 1.25 + 0.25, e.pos.z).project(cam);
      const vis = this.v.z < 1 && e.pos.distanceTo(cam.position) < 40 && e.object.visible;
      b.el.style.display = vis ? '' : 'none';
      b.el.style.left = ((this.v.x * 0.5 + 0.5) * W).toFixed(1) + 'px';
      b.el.style.top = ((-this.v.y * 0.5 + 0.5) * H - 36 - k * 44).toFixed(1) + 'px';
      b.el.style.opacity = String(Math.min(1, b.t));
      if (b.t <= 0) { b.el.remove(); this.bubbles.splice(i, 1); }
    }
  }
  dispose() {
    removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKeyUp);
    removeEventListener('mousemove', this.wake); removeEventListener('pointerdown', this.wake);
    this.game.onBiome = null;
    this.root.remove();
  }
}
