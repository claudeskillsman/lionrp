import * as THREE from 'three';
import type { Game } from './game';
import type { Hud } from '../ui/hud';
import { el } from '../ui/style';
import { HOLE, WATER_LEVEL } from '../world/worldgen';

/**
 * Simple, kid-friendly challenges: one clear thing to do at a time, a card at the top of the screen
 * that says what to do and which button to press, an arrow that points the way, glowing things to
 * collect, and a star for every challenge finished. Works in solo and online.
 */

type Item = 'berry' | 'feather' | 'flower';
type Kind = 'walk' | 'collect' | 'drink' | 'roar' | 'climb' | 'pounce' | 'sleep';
interface QuestDef { kind: Kind; title: string; hint: (k: Keys) => string; icon: string; item?: Item; count?: number; spread?: [number, number] }
interface Keys { touch: boolean; act: string; jump: string; crouch: string; emote: string }

const SVG: Record<string, string> = {
  paw: '<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="16" rx="5" ry="4.2"/><ellipse cx="6" cy="10" rx="2" ry="2.6"/><ellipse cx="18" cy="10" rx="2" ry="2.6"/><ellipse cx="9.3" cy="6" rx="2" ry="2.6"/><ellipse cx="14.7" cy="6" rx="2" ry="2.6"/></svg>',
  berry: '<svg viewBox="0 0 24 24"><path d="M12 6c1-2 3-3 5-3-1 2-2.5 3-5 3z" fill="#7fb35a"/><g fill="#3b1f4a"><circle cx="9" cy="10" r="3"/><circle cx="15" cy="10" r="3"/><circle cx="12" cy="14" r="3"/><circle cx="8" cy="15.5" r="3"/><circle cx="16" cy="15.5" r="3"/><circle cx="12" cy="19" r="3"/></g><g fill="#b98ad0"><circle cx="8" cy="9" r=".9"/><circle cx="14" cy="9" r=".9"/><circle cx="11" cy="13" r=".9"/></g></svg>',
  feather: '<svg viewBox="0 0 24 24"><path d="M19 3C11 4 6 9 5 17l2 0c2-5 6-9 12-14z" fill="#f2c96a"/><path d="M5 21 15 8" stroke="#8a5a1c" stroke-width="1.4"/></svg>',
  flower: '<svg viewBox="0 0 24 24"><g fill="#f08bb4"><circle cx="12" cy="6.5" r="3.6"/><circle cx="17.2" cy="10.3" r="3.6"/><circle cx="15.2" cy="16.4" r="3.6"/><circle cx="8.8" cy="16.4" r="3.6"/><circle cx="6.8" cy="10.3" r="3.6"/></g><circle cx="12" cy="12" r="3" fill="#ffd35a"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="#7cc4f0"><path d="M12 2.5C9 7 6 10.6 6 14.3A6 6 0 0 0 18 14.3C18 10.6 15 7 12 2.5z"/></svg>',
  roar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9v6h3l5 4V5L7 9z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path d="M3 9c2-4 16-4 18 0-3 2-15 2-18 0z" fill="#7fb35a"/><path d="M11 9h2v12h-2z" fill="#8a5a2c"/><path d="M12 13 8 10M12 12l4-3" stroke="#8a5a2c" stroke-width="1.5"/></svg>',
  pounce: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="#f6e2a8"><path d="M15 3a8.5 8.5 0 1 0 6 13A7 7 0 0 1 15 3z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="#ffd35a"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l7 9h-4.5v9h-5v-9H5z"/></svg>',
};

const kbd = (k: string) => `<span class="gg-kbd">${k}</span>`;
const QUESTS: QuestDef[] = [
  { kind: 'walk', icon: 'paw', title: 'Go for a walk', hint: (k) => (k.touch ? 'Drag the circle in the corner to walk' : `Press ${kbd('W')}${kbd('A')}${kbd('S')}${kbd('D')} to walk. Move the mouse to look around`) },
  { kind: 'collect', icon: 'berry', item: 'berry', count: 3, spread: [14, 34], title: 'Find 3 blackberries', hint: () => 'Follow the gold arrow and walk into the berries' },
  { kind: 'drink', icon: 'drop', title: 'Have a drink', hint: (k) => `Walk to the water, then ${k.touch ? 'tap <b>Act</b>' : 'press ' + kbd(k.act)}` },
  { kind: 'roar', icon: 'roar', title: 'Give a big ROAR!', hint: (k) => (k.touch ? 'Tap the smiley button, then pick <b>Roar</b>' : `Press ${kbd('5')} to roar`) },
  { kind: 'collect', icon: 'feather', item: 'feather', count: 5, spread: [20, 55], title: 'Find 5 golden feathers', hint: () => 'They sparkle in the grass. Follow the arrow!' },
  { kind: 'climb', icon: 'tree', title: 'Climb a tree', hint: (k) => `Walk right up to a tree, then ${k.touch ? 'tap <b>Jump</b>' : 'press ' + kbd(k.jump)}` },
  { kind: 'pounce', icon: 'pounce', title: 'Pounce like a big cat', hint: (k) => (k.touch ? 'Tap <b>Crouch</b>, sneak up close to an animal, then tap <b>Act</b>' : `Hold ${kbd(k.crouch)} to sneak up close to an animal, then press ${kbd(k.act)}`) },
  { kind: 'collect', icon: 'flower', item: 'flower', count: 4, spread: [18, 50], title: 'Pick 4 flowers for your pride', hint: () => 'Follow the arrow to the pink flowers' },
  { kind: 'sleep', icon: 'moon', title: 'Take a nap', hint: (k) => (k.touch ? 'Tap the smiley button, then pick <b>Sleep</b>' : `Press ${kbd('3')} to curl up and sleep`) },
];
const BONUS: { item: Item; icon: string; title: (n: number) => string }[] = [
  { item: 'berry', icon: 'berry', title: (n) => `Find ${n} more blackberries` },
  { item: 'feather', icon: 'feather', title: (n) => `Find ${n} golden feathers` },
  { item: 'flower', icon: 'flower', title: (n) => `Pick ${n} flowers` },
];

const CSS = /* css */ `
.gg-hud .gg-toast{top:22%}
.gg-quest{position:absolute;left:50%;top:14px;transform:translateX(-50%);display:flex;align-items:center;gap:14px;padding:10px 18px 10px 10px;max-width:min(620px,calc(100% - 300px));min-width:300px;border-radius:20px;background:rgba(28,18,10,.62);border:1px solid rgba(231,183,102,.45);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 10px 30px rgba(0,0,0,.25);transition:transform .45s cubic-bezier(.2,1.4,.4,1), opacity .3s}
.gg-quest.swap{transform:translateX(-50%) scale(.85);opacity:0}
.gg-quest .qi{flex:none;width:50px;height:50px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%,#fff1cf,#e7b766 70%);color:#3a2410}
.gg-quest .qi svg{width:32px;height:32px}
.gg-quest .ql{font:700 10px var(--gg-ui);letter-spacing:.16em;color:var(--gg-gold);text-transform:uppercase}
.gg-quest .qt{font:700 19px/1.2 var(--gg-ui);color:#fff6e4;margin-top:2px}
.gg-quest .qh{font:500 13.5px/1.45 var(--gg-ui);color:var(--gg-cream-dim);margin-top:4px}
.gg-quest .qh b{color:#fff3dc}
.gg-quest .qp{display:flex;gap:6px;margin-top:7px}
.gg-quest .qp span{width:20px;height:20px;border-radius:50%;background:rgba(246,234,210,.15);display:grid;place-items:center}
.gg-quest .qp span.on{background:#e7b766;box-shadow:0 0 10px rgba(231,183,102,.8)}
.gg-quest .qp span svg{width:14px;height:14px}
.gg-quest .qs{flex:none;display:flex;align-items:center;gap:4px;font:700 16px var(--gg-ui);color:#ffe7a6;margin-left:auto;padding-left:6px}
.gg-quest .qs svg{width:22px;height:22px}
.gg-qmark{position:absolute;width:0;height:0;pointer-events:none;transition:opacity .3s}
.gg-qmark .a{position:absolute;left:-22px;top:-22px;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#e7b766;color:#3a2410;box-shadow:0 0 0 4px rgba(231,183,102,.35),0 6px 18px rgba(0,0,0,.35)}
.gg-qmark .a svg{width:26px;height:26px}
.gg-qmark .d{position:absolute;left:-40px;width:80px;top:26px;text-align:center;font:700 13px var(--gg-ui);color:#fff6e4;text-shadow:0 1px 4px rgba(0,0,0,.8)}
.gg-qmark.here{animation:gg-bob 1s ease-in-out infinite}
@keyframes gg-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.gg-cheer{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%) scale(.6);opacity:0;text-align:center;pointer-events:none;transition:transform .5s cubic-bezier(.2,1.6,.4,1), opacity .35s}
.gg-cheer.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
.gg-cheer .c1{font:600 clamp(40px,7vw,72px) var(--gg-display);color:#fff3d6;text-shadow:0 4px 30px rgba(120,60,0,.7)}
.gg-cheer .c2{display:inline-flex;align-items:center;gap:8px;margin-top:8px;padding:8px 18px;border-radius:999px;background:rgba(28,18,10,.6);font:700 18px var(--gg-ui);color:#ffe7a6}
.gg-cheer .c2 svg{width:26px;height:26px}
.gg-cheer .burst{position:absolute;left:50%;top:40%;width:0;height:0}
.gg-cheer .burst i{position:absolute;width:22px;height:22px;margin:-11px;opacity:0}
.gg-cheer.show .burst i{animation:gg-fly 1.1s ease-out forwards}
@keyframes gg-fly{0%{opacity:1;transform:translate(0,0) scale(.4) rotate(0)}100%{opacity:0;transform:translate(var(--x),var(--y)) scale(1.1) rotate(200deg)}}
.gg-howto{padding:26px 28px;width:min(640px,calc(100vw - 24px));max-height:calc(100vh - 40px);overflow:auto}
.gg-howto .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0 22px}
.gg-howto .tile{padding:14px;border-radius:16px;background:rgba(255,255,255,.05);border:1px solid var(--gg-line)}
.gg-howto .tile .k{min-height:30px;display:flex;align-items:center;flex-wrap:wrap;gap:4px}
.gg-howto .tile .k .gg-kbd{font-size:14px;padding:5px 9px;margin:0}
.gg-howto .tile .w{font:700 16px var(--gg-ui);margin-top:8px;color:#fff3dc}
.gg-howto .tile .s{font:500 13px/1.4 var(--gg-ui);color:var(--gg-cream-dim);margin-top:3px}
@media (max-width: 760px){
  .gg-quest{top:64px;max-width:calc(100% - 20px);min-width:0;width:calc(100% - 20px);padding:8px 12px 8px 8px;gap:10px}
  .gg-quest .qi{width:42px;height:42px}.gg-quest .qt{font-size:16px}.gg-quest .qh{font-size:12.5px}
  .gg-hud .gg-toast{top:30%}
}
`;

interface QSave { i: number; stars: number; bonus: number }
const HOWTO_KEY = 'goldgrass.howto.v1';

interface Pickup { obj: THREE.Group; x: number; z: number; y: number; taken: boolean; t: number }

export class Quests {
  private card: HTMLElement;
  private mark: HTMLElement;
  private cheer: HTMLElement;
  private save: QSave;
  private key: string;
  private def!: QuestDef;
  private prog = 0;
  private need = 1;
  private walked = 0;
  private lastPos = new THREE.Vector3();
  private pickups: Pickup[] = [];
  private target: THREE.Vector3 | null = null;
  private targetT = 0;
  private doneT = -1;
  private cheerT = 0;
  private group = new THREE.Group();
  private v = new THREE.Vector3();
  private time = 0;
  private static geo: Record<string, THREE.BufferGeometry> | null = null;
  private static mat: Record<string, THREE.Material> | null = null;

  constructor(private game: Game, private hud: Hud, charId: string) {
    if (!document.getElementById('gg-quest-css')) document.head.append(el('style', { id: 'gg-quest-css' }, CSS));
    this.key = 'goldgrass.quests.v1.' + charId;
    let s: QSave | null = null;
    try { s = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch { /* ignore */ }
    this.save = s && typeof s.i === 'number' ? s : { i: 0, stars: 0, bonus: 0 };
    this.card = el('div', { class: 'gg-quest' });
    this.mark = el('div', { class: 'gg-qmark' }, el('div', { class: 'a' }), el('div', { class: 'd' }));
    this.cheer = el('div', { class: 'gg-cheer' });
    hud.root.append(this.mark, this.card, this.cheer);
    game.gw.scene.add(this.group);
    hud.addButton('help', 'How to play', () => this.howTo(), true);
    this.begin();
    let seen = false;
    try { seen = !!localStorage.getItem(HOWTO_KEY); } catch { /* ignore */ }
    if (!seen) setTimeout(() => this.howTo(), 900);
  }

  private keys(): Keys {
    const kb = this.game.settings.keybinds, n = (c: string) => (c || '').replace(/^Key|^Digit/, '').replace('ShiftLeft', 'Shift');
    return { touch: this.game.input.isTouch, act: n(kb.interact), jump: n(kb.jump), crouch: n(kb.crouch), emote: n(kb.emote) };
  }

  // ---------------- challenge flow ----------------
  private begin() {
    const s = this.save;
    for (const p of this.pickups) this.group.remove(p.obj);
    this.pickups = [];
    this.prog = 0; this.walked = 0; this.target = null; this.targetT = 0;
    if (s.i < QUESTS.length) this.def = QUESTS[s.i];
    else {
      const b = BONUS[s.bonus % BONUS.length], n = 3 + (s.bonus % 3);
      this.def = { kind: 'collect', icon: b.icon, item: b.item, count: n, spread: [22, 60], title: b.title(n), hint: () => 'Follow the gold arrow' };
    }
    this.need = this.def.kind === 'collect' ? this.def.count! : 1;
    const p = this.game.player;
    if (p) this.lastPos.copy(p.pos);
    if (this.def.kind === 'collect' && p) this.scatter(this.def.item!, this.need, this.def.spread!);
    this.render();
  }
  private render() {
    const d = this.def, s = this.save;
    const label = s.i < QUESTS.length ? `Challenge ${s.i + 1} of ${QUESTS.length}` : 'Bonus challenge';
    const dots = this.need > 1 ? el('div', { class: 'qp' }, ...Array.from({ length: this.need }, (_, k) => { const sp = el('span', { class: k < this.prog ? 'on' : '' }); if (k < this.prog) sp.innerHTML = SVG[d.icon]; return sp; })) : null;
    const hint = el('div', { class: 'qh' }); hint.innerHTML = d.hint(this.keys());
    const ic = el('div', { class: 'qi' }); ic.innerHTML = SVG[d.icon];
    const st = el('div', { class: 'qs', title: 'Stars' }); st.innerHTML = SVG.star + `<span>${s.stars}</span>`;
    this.card.innerHTML = '';
    this.card.append(ic, el('div', { style: { minWidth: '0' } }, el('div', { class: 'ql' }, label), el('div', { class: 'qt' }, d.title + (this.need > 1 ? `  ${this.prog}/${this.need}` : '')), hint, dots), st);
  }
  private complete() {
    const s = this.save;
    s.stars++;
    if (s.i < QUESTS.length) s.i++; else s.bonus++;
    this.persist();
    this.celebrate();
    this.target = null;
    this.card.classList.add('swap');
    this.doneT = 2.6;
  }
  private celebrate() {
    const lines = ['Great job!', 'Awesome!', 'You did it!', 'Super!', 'Amazing!', 'Well done!'];
    const burst = el('div', { class: 'burst' });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2, r = 130 + (k % 3) * 40;
      const i = el('i', { style: { animationDelay: (k % 4) * 0.04 + 's' } });
      i.style.setProperty('--x', Math.cos(a) * r + 'px'); i.style.setProperty('--y', Math.sin(a) * r + 'px');
      i.innerHTML = SVG.star;
      burst.append(i);
    }
    const c2 = el('div', { class: 'c2' }); c2.innerHTML = SVG.star + '<span>+1 star</span>';
    this.cheer.innerHTML = '';
    this.cheer.append(burst, el('div', { class: 'c1' }, lines[this.save.stars % lines.length]), c2);
    this.cheer.classList.remove('show'); void this.cheer.offsetWidth; this.cheer.classList.add('show');
    this.cheerT = 2.4;
    this.hud.hideToast();
    this.game.audio.ui('success');
  }
  private persist() { try { localStorage.setItem(this.key, JSON.stringify(this.save)); } catch { /* ignore */ } }

  // ---------------- how to play ----------------
  howTo() {
    const k = this.keys();
    const tile = (keys: string, what: string, sub: string) => { const t = el('div', { class: 'tile' }); const kk = el('div', { class: 'k' }); kk.innerHTML = keys; const ss = el('div', { class: 's' }); ss.innerHTML = sub; t.append(kk, el('div', { class: 'w' }, what), ss); return t; };
    const tiles = k.touch ? [
      tile('<b>Circle</b>&nbsp;bottom left', 'Walk', 'Drag the circle. Drag far to run.'),
      tile('<b>Swipe</b>&nbsp;the screen', 'Look around', 'Swipe anywhere to turn the camera.'),
      tile('<b>Jump</b>', 'Jump and climb', 'Tap Jump next to a tree to climb it.'),
      tile('<b>Act</b>', 'Do things', 'Drink water, pounce, and play with other cats.'),
      tile('<b>Smiley</b>', 'Roar and more', 'Sit, sleep, roar and say hello.'),
      tile('<b>Gold card</b>&nbsp;at the top', 'Your challenge', 'It always shows what to do next.'),
    ] : [
      tile(kbd('W') + kbd('A') + kbd('S') + kbd('D'), 'Walk', 'Move the mouse to look around.'),
      tile(kbd('Shift'), 'Run', 'Hold it while you walk to run fast.'),
      tile(kbd(k.jump), 'Jump and climb', 'Press it next to a tree to climb up.'),
      tile(kbd(k.act), 'Do things', 'Drink water, pounce on prey, play with cats.'),
      tile(kbd('1') + kbd('2') + kbd('3') + kbd('5'), 'Sit, lie, sleep, roar', `Or press ${kbd(k.emote)} for all the moves.`),
      tile('<b>Gold card</b>&nbsp;at the top', 'Your challenge', 'It always shows what to do next. Follow the gold arrow!'),
    ];
    const box = el('div', { class: 'gg-panel gg-howto' },
      el('div', { class: 'gg-title', style: { fontSize: '34px' } }, 'How to play'),
      el('div', { style: { fontSize: '15px', color: 'var(--gg-cream-dim)', marginTop: '8px' } }, 'You are a big cat! Do the challenges to earn stars.'),
      el('div', { class: 'grid' }, ...tiles),
      el('button', { class: 'gg-btn primary', style: { width: '100%', fontSize: '18px', padding: '16px' }, onclick: () => { this.hud.closeModal(); this.game.audio.ui('click'); } }, "Let's play!"));
    try { localStorage.setItem(HOWTO_KEY, '1'); } catch { /* ignore */ }
    this.hud.openModal(box);
  }

  // ---------------- collectibles ----------------
  private static assets() {
    if (Quests.geo) return;
    const leaf = new THREE.IcosahedronGeometry(0.5, 1); leaf.scale(1.15, 0.8, 1.15);
    const fs = new THREE.Shape(); fs.moveTo(0, -0.45); fs.quadraticCurveTo(0.22, -0.1, 0.12, 0.45); fs.quadraticCurveTo(0, 0.55, -0.1, 0.4); fs.quadraticCurveTo(-0.2, 0, 0, -0.45);
    const feather = new THREE.ShapeGeometry(fs, 8);
    const beam = new THREE.CylinderGeometry(0.18, 0.5, 14, 14, 1, true); beam.translate(0, 7, 0);
    Quests.geo = { leaf, berry: new THREE.SphereGeometry(0.085, 10, 8), feather, petal: new THREE.SphereGeometry(0.11, 10, 8), center: new THREE.SphereGeometry(0.08, 10, 8), stem: new THREE.CylinderGeometry(0.02, 0.025, 0.55, 6), beam, ring: new THREE.RingGeometry(0.75, 0.95, 32) };
    // a soft vertical fade for the light pillar
    const c = document.createElement('canvas'); c.width = 4; c.height = 64;
    const x = c.getContext('2d')!; const gr = x.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    x.fillStyle = gr; x.fillRect(0, 0, 4, 64);
    const tex = new THREE.CanvasTexture(c);
    Quests.mat = {
      leaf: new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.85 }),
      berry: new THREE.MeshStandardMaterial({ color: 0x2a1236, roughness: 0.25, metalness: 0.05, emissive: 0x2a0c3a, emissiveIntensity: 0.6 }),
      feather: new THREE.MeshStandardMaterial({ color: 0xf2c96a, roughness: 0.4, metalness: 0.3, emissive: 0xb07a1a, emissiveIntensity: 0.9, side: THREE.DoubleSide }),
      petal: new THREE.MeshStandardMaterial({ color: 0xf07fb0, roughness: 0.6, emissive: 0x80304e, emissiveIntensity: 0.5 }),
      center: new THREE.MeshStandardMaterial({ color: 0xffd35a, roughness: 0.6, emissive: 0x8a6a10, emissiveIntensity: 0.6 }),
      stem: new THREE.MeshStandardMaterial({ color: 0x4f8a34, roughness: 0.8 }),
      beam: new THREE.MeshBasicMaterial({ color: 0xffd27a, map: tex, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      ring: new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    };
  }
  private makeItem(item: Item) {
    Quests.assets();
    const G = Quests.geo!, M = Quests.mat!;
    const g = new THREE.Group();
    const body = new THREE.Group(); body.name = 'body';
    if (item === 'berry') {
      const bush = new THREE.Mesh(G.leaf, M.leaf); bush.position.y = 0.35; body.add(bush);
      for (let k = 0; k < 9; k++) {
        const a = k * 2.4, h = 0.25 + (k % 3) * 0.17;
        const b = new THREE.Mesh(G.berry, M.berry); b.position.set(Math.cos(a) * 0.52, h, Math.sin(a) * 0.52); b.scale.setScalar(1 + (k % 2) * 0.3); body.add(b);
      }
    } else if (item === 'feather') {
      const f = new THREE.Mesh(G.feather, M.feather); f.scale.setScalar(1.3); f.position.y = 0.9; f.rotation.z = 0.4; body.add(f);
    } else {
      for (let n = 0; n < 3; n++) {
        const fl = new THREE.Group(); fl.position.set((n - 1) * 0.3, 0, (n % 2) * 0.25 - 0.1);
        const stem = new THREE.Mesh(G.stem, M.stem); stem.position.y = 0.27; fl.add(stem);
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; const pt = new THREE.Mesh(G.petal, M.petal); pt.scale.set(1, 0.45, 1); pt.position.set(Math.cos(a) * 0.12, 0.58, Math.sin(a) * 0.12); fl.add(pt); }
        const c = new THREE.Mesh(G.center, M.center); c.position.y = 0.6; fl.add(c);
        fl.scale.setScalar(1.2 - n * 0.12);
        body.add(fl);
      }
    }
    for (const m of body.children) m.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    const beam = new THREE.Mesh(G.beam, M.beam); beam.name = 'beam';
    const ring = new THREE.Mesh(G.ring, M.ring); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.name = 'ring';
    g.add(body, beam, ring);
    return g;
  }
  private scatter(item: Item, n: number, [r0, r1]: [number, number]) {
    const g = this.game, p = g.player!;
    const base = Math.random() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      let x = 0, z = 0, y = 0;
      for (let tries = 0; tries < 30; tries++) {
        // spread the items around in a loose arc so the next one is never far from the last
        const a = base + (k / n) * Math.PI * 1.2 + (Math.random() - 0.5) * 0.5;
        const r = r0 + (r1 - r0) * ((k + Math.random()) / n);
        x = p.pos.x + Math.cos(a) * r; z = p.pos.z + Math.sin(a) * r;
        y = g.world.height(x, z);
        if (y > WATER_LEVEL + 0.4 && !g.props.nearestTree(x, z, 2.5) && Math.abs(x) < 880 && Math.abs(z) < 880) break;
      }
      const obj = this.makeItem(item);
      obj.position.set(x, y, z);
      this.group.add(obj);
      this.pickups.push({ obj, x, z, y, taken: false, t: 0 });
    }
  }

  // ---------------- per frame ----------------
  update(dt: number) {
    const g = this.game, p = g.player;
    this.time += dt;
    if (this.cheerT > 0) { this.cheerT -= dt; if (this.cheerT <= 0) this.cheer.classList.remove('show'); }
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) { this.card.classList.remove('swap'); this.begin(); }
    }
    for (const it of this.pickups) {
      const body = it.obj.getObjectByName('body')!, beam = it.obj.getObjectByName('beam')!, ring = it.obj.getObjectByName('ring')!;
      if (it.taken) {
        it.t += dt;
        const k = Math.min(1, it.t / 0.35);
        body.scale.setScalar(1 + k * 0.6); body.position.y = k * 1.2;
        beam.scale.set(1 - k, 1, 1 - k); ring.scale.setScalar(1 + k * 2);
        if (k >= 1) it.obj.visible = false;
        continue;
      }
      body.rotation.y += dt * (this.def.item === 'feather' ? 1.6 : 0.4);
      body.position.y = this.def.item === 'feather' ? Math.sin(this.time * 2.2 + it.x) * 0.15 : 0;
      ring.scale.setScalar(1 + 0.12 * Math.sin(this.time * 3 + it.z));
    }
    if (!p || g.state !== 'play' || this.doneT > 0) { this.mark.style.opacity = '0'; return; }
    const d = this.def;
    switch (d.kind) {
      case 'walk': {
        const step = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
        if (step < 5) this.walked += step;
        this.lastPos.copy(p.pos);
        if (this.walked > 25) this.complete();
        break;
      }
      case 'collect': {
        const reach = 1.3 + p.size * 0.9;
        for (const it of this.pickups) {
          if (it.taken) continue;
          if (Math.hypot(p.pos.x - it.x, p.pos.z - it.z) < reach && Math.abs(p.pos.y - it.y) < 3) {
            it.taken = true; this.prog++;
            this.game.audio.ui(this.prog >= this.need ? 'notify' : 'click');
            this.render();
            if (this.prog >= this.need) this.complete();
          }
        }
        break;
      }
      case 'drink': if (p.pose === 'drink') this.complete(); break;
      case 'roar': if (p.pose === 'roar') this.complete(); break;
      case 'climb': if (p.climbing) this.complete(); break;
      case 'pounce': if (this.hud.ctrl.pounceT >= 0) this.complete(); break;
      case 'sleep': if (p.pose === 'sleep') this.complete(); break;
    }
    if (this.doneT > 0) { this.mark.style.opacity = '0'; return; }
    this.updateTarget(dt);
    this.updateMarker();
  }
  private updateTarget(dt: number) {
    const g = this.game, p = g.player!, d = this.def;
    this.targetT -= dt;
    if (d.kind === 'collect') {
      let best: Pickup | null = null, bd = 1e9;
      for (const it of this.pickups) { if (it.taken) continue; const dd = Math.hypot(p.pos.x - it.x, p.pos.z - it.z); if (dd < bd) { bd = dd; best = it; } }
      this.target = best ? (this.target ?? new THREE.Vector3()).set(best.x, best.y + 1.4, best.z) : null;
      return;
    }
    if (this.targetT > 0) return;
    this.targetT = 0.5;
    if (d.kind === 'drink') {
      // the near shore of the watering hole
      const dx = p.pos.x - HOLE[0], dz = p.pos.z - HOLE[1], L = Math.hypot(dx, dz) || 1;
      let x = HOLE[0], z = HOLE[1];
      for (let s = 0; s < 120; s++) { x = HOLE[0] + (dx / L) * s; z = HOLE[1] + (dz / L) * s; if (g.world.height(x, z) > WATER_LEVEL + 0.05) break; }
      this.target = new THREE.Vector3(x, Math.max(0, g.world.height(x, z)) + 1.2, z);
    } else if (d.kind === 'climb') {
      const t = g.props.nearestTree(p.pos.x, p.pos.z, 400);
      this.target = t ? new THREE.Vector3(t.x, t.y + 2, t.z) : null;
    } else if (d.kind === 'pounce') {
      const prey = g.fauna.nearestPrey(p.pos, 500);
      this.target = prey ? prey.pos.clone().setY(prey.pos.y + 1.6) : null;
    } else this.target = null;
  }
  private updateMarker() {
    const g = this.game, p = g.player!, t = this.target, m = this.mark;
    if (!t) { m.style.opacity = '0'; return; }
    const dist = Math.hypot(t.x - p.pos.x, t.z - p.pos.z);
    const close = this.def.kind === 'collect' ? 2.5 : this.def.kind === 'drink' ? 3 : this.def.kind === 'climb' ? 2.5 : 0;
    if (dist < close) { m.style.opacity = '0'; return; }
    const W = innerWidth, H = innerHeight;
    this.v.copy(t).project(g.camera);
    const behind = this.v.z > 1;
    let sx = (this.v.x * 0.5 + 0.5) * W, sy = (-this.v.y * 0.5 + 0.5) * H;
    if (behind) { sx = W - sx; sy = H - sy; }
    const pad = 70, top = W < 760 ? 170 : 120;
    const onScreen = !behind && sx > pad && sx < W - pad && sy > top && sy < H - pad;
    const a = m.children[0] as HTMLElement, dl = m.children[1] as HTMLElement;
    if (onScreen) {
      m.classList.add('here');
      a.innerHTML = SVG.arrow; a.style.transform = 'rotate(180deg)';
      m.style.left = sx + 'px'; m.style.top = sy - 34 + 'px';
    } else {
      // pin to the screen edge, pointing the way
      m.classList.remove('here');
      const cx = W / 2, cy = H / 2;
      let dx = sx - cx, dy = sy - cy;
      if (behind && Math.abs(dy) < 1) dy = 1;
      const ang = Math.atan2(dy, dx);
      const kx = (W / 2 - pad) / Math.max(1e-3, Math.abs(Math.cos(ang))), ky = (H / 2 - pad) / Math.max(1e-3, Math.abs(Math.sin(ang)));
      const r = Math.min(kx, ky);
      dx = Math.cos(ang) * r; dy = Math.sin(ang) * r;
      m.style.left = cx + dx + 'px'; m.style.top = Math.max(top, cy + dy) + 'px';
      a.innerHTML = SVG.arrow; a.style.transform = `rotate(${ang + Math.PI / 2}rad)`;
    }
    dl.textContent = dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`;
    m.style.opacity = '1';
  }
  dispose() {
    this.persist();
    this.game.gw.scene.remove(this.group);
    this.card.remove(); this.mark.remove(); this.cheer.remove();
  }
}
