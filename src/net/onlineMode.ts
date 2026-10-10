import * as THREE from 'three';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { App } from '../ui/app';
import type { Hud, TagInfo } from '../ui/hud';
import type { ModeHooks } from '../game/game';
import { CatEntity } from '../game/entity';
import type { CatConfig } from '../cat/catConfig';
import type { PoseName } from '../cat/catRig';
import type { SocialAct } from '../game/controller';
import { api, sb, Pride } from './api';
import { filterChat, filterName } from './filter';
import { el, icon } from '../ui/style';
import { BIOMES, BiomeKey, SPAWN } from '../world/worldgen';
import { makeDenMarker, DenMarker } from '../game/denMarker';
import { Quests } from '../game/quests';
import { EMBLEMS, PRIDE_COLORS, ROLE_LABEL } from '../game/solo';

interface Remote { id: string; name: string; cfg: CatConfig; e: CatEntity | null; lastMsg: number; }
interface ChatLine { from: string; name: string; text: string; kind: 'local' | 'server' | 'me' | 'system'; t: number; }

const CHAT_CSS = /* css */ `
.gg-chat{position:absolute;left:18px;bottom:18px;width:min(380px,calc(100% - 36px));display:flex;flex-direction:column;gap:6px;pointer-events:none}
.gg-chat .log{display:flex;flex-direction:column;gap:3px;max-height:34vh;overflow:hidden;justify-content:flex-end;font:500 13px/1.4 var(--gg-ui);text-shadow:0 1px 4px rgba(0,0,0,.8)}
.gg-chat .log div{transition:opacity 1s}
.gg-chat .log .n{font-weight:700;margin-right:6px}
.gg-chat .log .me{font-style:italic;color:#f0d8a8}
.gg-chat .log .sys{color:var(--gg-gold)}
.gg-chat .log .tag{font-size:10px;letter-spacing:.12em;opacity:.6;margin-right:6px}
.gg-chat .bar{display:none;gap:6px;pointer-events:auto}
.gg-chat.open .bar{display:flex}
.gg-chat.open .log div{opacity:1 !important}
@media (pointer:coarse){.gg-chat{bottom:180px}}
`;

/** Online play: Supabase Realtime for movement, chat and emotes; RPCs for prides, friends and safety. */
export class OnlineMode implements ModeHooks {
  ch: RealtimeChannel | null = null;
  me: string;
  serverId: string;
  remotes = new Map<string, Remote>();
  private sendT = 0;
  private lastSent = '';
  private hbT = 0;
  private tagT = 0;
  private denT = 0;
  private buildQueue: Remote[] = [];
  private tags: Record<string, { pride: string; name: string; color: string; emblem: string; role: string }> = {};
  private pride: Pride | null = null;
  private invites: { id: string; name: string; color: string; emblem: string }[] = [];
  private dens = new Map<string, DenMarker>();
  private chat: ChatLine[] = [];
  private chatEl!: HTMLElement;
  private logEl!: HTMLElement;
  private input!: HTMLInputElement;
  private chatScope: 'local' | 'server' = 'local';
  private scopeBtn!: HTMLElement;
  private closed = false;
  private quests: Quests;
  constructor(private app: App, private hud: Hud, private cfg: CatConfig, private info: { id: string; name: string; private: boolean; code: string | null; account: string }) {
    const g = app.game;
    this.me = info.account;
    this.serverId = info.id;
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 18;
    const p = g.spawnPlayer(cfg, SPAWN[0] + Math.cos(a) * r, SPAWN[1] + Math.sin(a) * r, Math.random() * Math.PI * 2);
    p.hunger = 90; p.thirst = 90;
    g.gw.env.timeSpeed = 0;
    hud.tags = () => this.tagList();
    hud.ctrl.extra = () => this.denAction();
    hud.ctrl.onEmote = (pose) => this.fx(pose);
    hud.ctrl.onSocial = (act, t) => this.social(act, t);
    hud.addButton('pride', 'Pride (R)', () => this.togglePride(), true);
    hud.addButton('paw', 'Players', () => this.togglePlayers(), true);
    this.quests = new Quests(g, hud, cfg.id);
    hud.addButton('chat', 'Chat (Enter)', () => this.openChat(), true);
    this.buildChat();
    let st: ReturnType<typeof setTimeout> | null = null;
    g.onSettings = () => { if (st) clearTimeout(st); st = setTimeout(() => { if (!api.account?.guest) api.saveSettings(g.settings).catch(() => {}); }, 1500); };
    addEventListener('keydown', this.onKey);
    addEventListener('pagehide', this.onHide);
    this.system(`Joined ${info.name}${info.code ? ` · invite code ${info.code}` : ''}. Press Enter to chat, /me for actions.`);
    hud.showToast(info.name, info.private ? 'Private server' : 'Online');
  }
  private onHide = () => { api.leave().catch(() => {}); };
  private get muted() { return new Set(api.account?.muted ?? []); }
  private get blocked() { return new Set(api.account?.blocked ?? []); }
  // ---------------- connection ----------------
  async connect() {
    const ch = sb().channel('gg-' + this.serverId, { config: { broadcast: { self: false, ack: false }, presence: { key: this.me } } });
    this.ch = ch;
    ch.on('broadcast', { event: 'st' }, ({ payload }) => this.onState(payload));
    ch.on('broadcast', { event: 'chat' }, ({ payload }) => this.onChat(payload));
    ch.on('broadcast', { event: 'fx' }, ({ payload }) => this.onFx(payload));
    ch.on('broadcast', { event: 'soc' }, ({ payload }) => this.onSocial(payload));
    ch.on('broadcast', { event: 'inv' }, ({ payload }) => { if (payload.to === this.me && !this.blocked.has(payload.from)) this.onInvite(payload); });
    ch.on('broadcast', { event: 'pride' }, () => { this.tagT = 0; this.denT = 0; this.refreshPride(); });
    ch.on('presence', { event: 'sync' }, () => this.syncPresence());
    await new Promise<void>((res) => {
      let done = false;
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ name: filterName(this.cfg.name), cfg: this.cfg });
          if (!done) { done = true; res(); }
        } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !this.closed) {
          this.system('Connection hiccup, reconnecting…');
          if (!done) { done = true; res(); }
        }
      });
      setTimeout(() => { if (!done) { done = true; res(); } }, 8000);
    });
    this.refreshPride();
  }
  private syncPresence() {
    if (!this.ch) return;
    const state = this.ch.presenceState() as Record<string, { name: string; cfg: CatConfig }[]>;
    const seen = new Set<string>();
    for (const [id, metas] of Object.entries(state)) {
      if (id === this.me || !metas.length) continue;
      seen.add(id);
      const m = metas[metas.length - 1];
      const cur = this.remotes.get(id);
      if (cur && JSON.stringify(cur.cfg) === JSON.stringify(m.cfg)) continue;
      if (cur?.e) this.app.game.removeEntity(cur.e);
      const r: Remote = { id, name: filterName(m.name ?? 'Cat'), cfg: m.cfg, e: null, lastMsg: performance.now() };
      this.remotes.set(id, r);
      this.buildQueue.push(r);
      if (!cur) this.system(`${r.name} arrived.`);
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) {
      if (r.e) this.app.game.removeEntity(r.e);
      this.remotes.delete(id);
      if (this.app.game.player?.carriedBy === r.e) this.app.game.player.carriedBy = null;
      this.system(`${r.name} left.`);
    }
    this.tagT = Math.min(this.tagT, 1);
  }
  private buildRemote(r: Remote) {
    if (!this.remotes.has(r.id) || r.e) return;
    const g = this.app.game, q = g.quality;
    let cfg = r.cfg;
    if (!cfg || typeof cfg !== 'object' || !cfg.species) return;
    cfg = { ...cfg, name: r.name };
    try {
      const e = new CatEntity(cfg, { shells: q.furShells, a2c: q.msaa > 0, voxel: 0.02 });
      e.remote = { id: r.id, buf: [] };
      e.place(SPAWN[0], SPAWN[1], g.world);
      e.object.visible = false;
      r.e = e;
      g.addEntity(e);
    } catch (err) { console.warn('bad remote cat', err); }
  }
  // ---------------- per frame ----------------
  update(dt: number) {
    const g = this.app.game, p = g.player;
    this.quests.update(dt);
    if (this.buildQueue.length) this.buildRemote(this.buildQueue.shift()!);
    // a shared clock: every client agrees on the time of day and the weather
    const env = g.gw.env;
    const nowS = Date.now() / 1000;
    env.setTime(((nowS / (24 * 60)) * 24 + 17) % 24);
    const slot = Math.floor(nowS / 240);
    const h = Math.abs(Math.sin(slot * 12.9898) * 43758.5453) % 1;
    env.rainTarget = h < 0.14 ? 0.6 + h * 2.5 : 0;
    env.nextWeatherCheck = 999;
    if (!p) return;
    // wriggle free when carried
    if (p.carriedBy && g.input.hit('jump')) { const c = p.carriedBy; p.carriedBy = null; c.carried = null; p.place(p.pos.x, p.pos.z, g.world, p.yaw); this.send('soc', { from: this.me, to: c.remote?.id, act: 'free' }); }
    // send our state: fast while moving, slow while still
    this.sendT -= dt;
    const st = { i: this.me, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), r: +p.yaw.toFixed(3), s: +p.speed.toFixed(2), c: p.cat.rig.crouch > 0.5 ? 1 : 0, a: p.onGround ? 0 : 1, w: p.swimming ? 1 : 0, po: p.pose };
    const key = `${st.x},${st.z},${st.y},${st.r},${st.po},${st.c},${st.w}`;
    const moving = p.speed > 0.05 || key !== this.lastSent;
    if (this.sendT <= 0 && (moving || this.sendT < -1)) {
      this.sendT = moving ? 1 / 8 : 1;
      this.lastSent = key;
      this.send('st', st);
    }
    // heartbeat: keeps the server list counts fresh and delivers kicks and bans
    this.hbT -= dt;
    if (this.hbT <= 0) {
      this.hbT = 15;
      api.heartbeat(this.serverId, this.cfg.name).then((r) => {
        if (r.banned || r.kicked) { this.app.menu(); this.app.toast(r.banned ? 'You were banned' : 'You were removed from the server', 'By a moderator'); }
      }).catch(() => {});
    }
    this.tagT -= dt;
    if (this.tagT <= 0) { this.tagT = 20; const ids = [this.me, ...this.remotes.keys()]; api.prideTags(ids).then((t) => (this.tags = t)).catch(() => {}); }
    this.denT -= dt;
    if (this.denT <= 0) { this.denT = 45; this.refreshDens(); }
    // stale remotes (tab closed without presence leave)
    const now = performance.now();
    for (const r of this.remotes.values()) if (r.e) r.e.object.visible = r.e.remote!.buf.length > 0 && now - r.lastMsg < 60000;
    this.fadeChat();
  }
  private send(event: string, payload: Record<string, unknown>) { this.ch?.send({ type: 'broadcast', event, payload }).catch(() => {}); }
  private onState(m: { i: string; x: number; y: number; z: number; r: number; s: number; c: number; a: number; w: number; po: string | null }) {
    const r = this.remotes.get(m.i);
    if (!r) return;
    r.lastMsg = performance.now();
    if (!r.e) return;
    const b = r.e.remote!.buf;
    if (!b.length) r.e.place(m.x, m.z, this.app.game.world, m.r);
    b.push({ t: performance.now(), x: m.x, y: m.y, z: m.z, yaw: m.r, s: m.s, c: m.c, a: m.a, w: m.w, po: m.po });
    if (b.length > 30) b.splice(0, b.length - 30);
  }
  // ---------------- emotes & social ----------------
  private fx(pose: PoseName) { if (pose === 'roar' || pose === 'growl') this.send('fx', { i: this.me, k: pose }); }
  private onFx(m: { i: string; k: 'roar' | 'growl' }) {
    const r = this.remotes.get(m.i);
    if (r?.e && !this.blocked.has(m.i)) this.app.game.audio.call(m.k, r.e.pos, r.e.size);
  }
  private social(act: SocialAct, t: CatEntity) {
    if (!t.remote) return;
    if (this.blocked.has(t.remote.id)) return;
    this.send('soc', { from: this.me, to: t.remote.id, act });
    if (act === 'carry') this.system(`You picked up ${t.config.name}.`);
  }
  private onSocial(m: { from: string; to: string; act: string }) {
    if (m.to !== this.me || this.blocked.has(m.from)) return;
    const g = this.app.game, p = g.player, r = this.remotes.get(m.from);
    if (!p || !r?.e) return;
    const from = r.e;
    const face = () => { p.yaw = Math.atan2(from.pos.x - p.pos.x, from.pos.z - p.pos.z); p.syncObject(); };
    switch (m.act) {
      case 'groomOther': if (!p.pose && p.speed < 0.5) p.setPose('lie', 8); this.system(`${r.name} grooms you.`); break;
      case 'nuzzle': if (p.speed < 0.5) { face(); p.setPose('nuzzle', 4); } this.system(`${r.name} nuzzles you.`); break;
      case 'playfight': if (p.speed < 0.5) { face(); p.setPose('playfight', 6); } this.system(`${r.name} wants to play-fight!`); break;
      case 'carry':
        if (p.config.lifeStage === 'cub' && from.pos.distanceTo(p.pos) < 6) { p.setPose(null); p.carriedBy = from; from.carried = p; this.system(`${r.name} picked you up. Press jump to wriggle free.`); }
        break;
      case 'drop': if (p.carriedBy === from) { p.carriedBy = null; from.carried = null; p.place(p.pos.x, p.pos.z, g.world, p.yaw); } break;
      case 'free': if (from.carriedBy === p || p.carried === from) { p.carried = null; from.carriedBy = null; } break;
    }
  }
  // ---------------- chat ----------------
  private buildChat() {
    if (!document.getElementById('gg-chat-css')) document.head.append(el('style', { id: 'gg-chat-css' }, CHAT_CSS));
    this.logEl = el('div', { class: 'log' });
    this.input = el('input', { class: 'gg-input', placeholder: 'Say something… (/me for actions)', maxlength: 160, style: { flex: '1', padding: '10px 12px', fontSize: '14px' } }) as HTMLInputElement;
    this.scopeBtn = el('button', { class: 'gg-chip', onclick: () => { this.chatScope = this.chatScope === 'local' ? 'server' : 'local'; this.scopeBtn.textContent = this.chatScope === 'local' ? 'Nearby' : 'Server'; this.input.focus(); } }, 'Nearby');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.submitChat(); }
      if (e.key === 'Escape') this.closeChat();
      if (e.key === 'Tab') { e.preventDefault(); this.scopeBtn.click(); }
    });
    this.chatEl = el('div', { class: 'gg-chat' }, this.logEl, el('div', { class: 'bar' }, this.scopeBtn, this.input));
    this.hud.root.append(this.chatEl);
  }
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (this.app.game.state !== 'play') return;
    const kb = this.app.game.settings.keybinds;
    if (e.code === kb.chat || e.code === 'Enter') { e.preventDefault(); this.openChat(); }
    if (e.code === 'Slash') { e.preventDefault(); this.openChat('/'); }
    if (e.code === kb.pride) this.togglePride();
  };
  openChat(prefill = '') {
    this.chatEl.classList.add('open'); this.input.value = prefill; this.input.focus();
    this.app.game.input.enabled = false; this.app.game.input.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closeChat() { this.chatEl.classList.remove('open'); this.input.blur(); this.app.game.input.enabled = true; }
  private submitChat() {
    let raw = this.input.value.trim();
    this.closeChat();
    if (!raw) return;
    let kind: ChatLine['kind'] = this.chatScope;
    if (/^\/me\s+/i.test(raw)) { kind = 'me'; raw = raw.replace(/^\/me\s+/i, ''); }
    else if (/^\/(s|server|g)\s+/i.test(raw)) { kind = 'server'; raw = raw.replace(/^\/\w+\s+/, ''); }
    else if (raw.startsWith('/')) { this.system('Commands: /me <action>, /s <message> for the whole server.'); return; }
    const text = filterChat(raw);
    if (!text) return;
    const p = this.app.game.player!;
    const msg = { i: this.me, n: filterName(this.cfg.name), m: text, k: kind, x: p.pos.x, z: p.pos.z };
    this.send('chat', msg);
    this.addLine({ from: this.me, name: msg.n, text, kind, t: performance.now() });
    this.hud.say(p, kind === 'me' ? text : text, kind === 'me');
  }
  private onChat(m: { i: string; n: string; m: string; k: ChatLine['kind']; x: number; z: number }) {
    if (this.muted.has(m.i) || this.blocked.has(m.i)) return;
    const text = filterChat(String(m.m ?? ''));
    const name = filterName(String(m.n ?? 'Cat'));
    const p = this.app.game.player;
    const dist = p ? Math.hypot(p.pos.x - m.x, p.pos.z - m.z) : 0;
    if ((m.k === 'local' || m.k === 'me') && dist > 60) return;
    const kind = m.k === 'server' || m.k === 'me' ? m.k : 'local';
    this.addLine({ from: m.i, name, text, kind, t: performance.now() });
    const r = this.remotes.get(m.i);
    if (r?.e && dist < 40) this.hud.say(r.e, text, kind === 'me');
  }
  private system(text: string) { this.addLine({ from: '', name: '', text, kind: 'system', t: performance.now() }); }
  private addLine(l: ChatLine) {
    this.chat.push(l);
    if (this.chat.length > 120) this.chat.shift();
    const d = el('div', { 'data-t': String(l.t) });
    if (l.kind === 'system') d.append(el('span', { class: 'sys' }, l.text));
    else if (l.kind === 'me') d.append(el('span', { class: 'me' }, `${l.name} ${l.text}`));
    else d.append(el('span', { class: 'tag' }, l.kind === 'server' ? 'SERVER' : 'NEAR'), el('span', { class: 'n' }, l.name), l.text);
    this.logEl.append(d);
    while (this.logEl.children.length > 40) this.logEl.firstChild!.remove();
  }
  private fadeChat() {
    const now = performance.now();
    for (const c of Array.from(this.logEl.children) as HTMLElement[]) { const age = (now - Number(c.dataset.t)) / 1000; c.style.opacity = age > 25 ? '0' : '1'; }
  }
  // ---------------- tags, players, safety ----------------
  private tagList(): TagInfo[] {
    const out: TagInfo[] = [];
    const g = this.app.game;
    const tag = (id: string) => { const t = this.tags[id]; return t ? { sub: `${t.emblem} ${t.name} · ${ROLE_LABEL[t.role] ?? t.role}`, color: t.color } : {}; };
    if (g.player) out.push({ e: g.player, name: this.cfg.name, ...tag(this.me) });
    for (const r of this.remotes.values()) if (r.e && !this.blocked.has(r.id)) out.push({ e: r.e, name: r.name, ...tag(r.id) });
    return out;
  }
  togglePlayers() { this.hud.toggleSide('players', () => this.playersPanel()); }
  private playersPanel(): HTMLElement {
    const acct = api.account!;
    const list = el('div', { class: 'gg-col', style: { gap: '10px' } });
    const refresh = () => this.hud.refreshSide('players', () => this.playersPanel());
    for (const r of this.remotes.values()) {
      const muted = this.muted.has(r.id), blocked = this.blocked.has(r.id);
      const toggle = (key: 'muted' | 'blocked') => async () => {
        const arr = acct[key]; const i = arr.indexOf(r.id); if (i >= 0) arr.splice(i, 1); else arr.push(r.id);
        await api.saveSettings(this.app.game.settings).catch(() => {});
        refresh();
      };
      const t = this.tags[r.id];
      list.append(el('div', { style: { padding: '10px 0', borderBottom: '1px solid var(--gg-line)' } },
        el('div', { class: 'gg-row', style: { justifyContent: 'space-between' } },
          el('div', {}, el('div', { style: { fontWeight: '600' } }, r.name), el('div', { style: { fontSize: '11px', color: t?.color ?? 'var(--gg-cream-dim)', letterSpacing: '.08em' } }, t ? `${t.emblem} ${t.name}` : `${r.cfg.species?.toUpperCase?.() ?? ''}`))),
        el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
          !acct.guest ? el('button', { class: 'gg-chip', onclick: async () => { try { await api.friendRequest(null, r.id); this.system(`Friend request sent to ${r.name}.`); } catch (e) { this.system((e as Error).message); } } }, 'Add friend') : '',
          this.pride && this.pride.leader === this.me ? el('button', { class: 'gg-chip', onclick: async () => { try { await api.prideInvite(r.id); this.send('inv', { from: this.me, to: r.id, pride: this.pride!.id, name: this.pride!.name, by: this.cfg.name }); this.system(`Invited ${r.name} to ${this.pride!.name}.`); } catch (e) { this.system((e as Error).message); } } }, 'Invite to pride') : '',
          el('button', { class: 'gg-chip' + (muted ? ' on' : ''), onclick: toggle('muted') }, muted ? 'Unmute' : 'Mute'),
          el('button', { class: 'gg-chip' + (blocked ? ' on' : ''), onclick: toggle('blocked') }, blocked ? 'Unblock' : 'Block'),
          el('button', { class: 'gg-chip', onclick: () => this.reportDialog(r) }, 'Report'))));
    }
    if (!this.remotes.size) list.append(el('div', { style: { color: 'var(--gg-cream-dim)', fontSize: '13px' } }, 'Nobody else is here yet. Share the link with a friend, or pick another server from the menu.'));
    return el('div', { class: 'gg-scroll', style: { padding: '20px 22px', height: '100%' } },
      el('div', { class: 'gg-title', style: { fontSize: '28px' } }, 'Players'),
      el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)', margin: '6px 0 14px' } }, `${this.remotes.size + 1} on ${this.info.name}${this.info.code ? ` · invite code ${this.info.code}` : ''}`),
      list);
  }
  private reportDialog(r: Remote) {
    const reasons = ['Harassment or bullying', 'Inappropriate chat', 'Asking for personal info', 'Inappropriate name or character', 'Cheating or griefing', 'Other'];
    let reason = reasons[0];
    const note = el('textarea', { class: 'gg-input', placeholder: 'What happened? (optional)', maxlength: 400, style: { height: '80px', resize: 'none', marginTop: '10px' } }) as HTMLTextAreaElement;
    const chips = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '6px' } });
    const draw = () => { chips.innerHTML = ''; for (const x of reasons) chips.append(el('button', { class: 'gg-chip' + (x === reason ? ' on' : ''), onclick: () => { reason = x; draw(); } }, x)); };
    draw();
    const box = el('div', { class: 'gg-panel', style: { padding: '22px', width: 'min(420px, calc(100% - 24px))' } },
      el('div', { class: 'gg-title', style: { fontSize: '24px', marginBottom: '14px' } }, `Report ${r.name}`), chips, note,
      el('div', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)', margin: '10px 0' } }, 'Their recent chat is attached so moderators can see what happened.'),
      el('div', { class: 'gg-row', style: { justifyContent: 'flex-end' } },
        el('button', { class: 'gg-btn small ghost', onclick: () => this.hud.closeModal() }, 'Cancel'),
        el('button', { class: 'gg-btn small primary', onclick: async () => {
          const ctx = this.chat.filter((l) => l.from === r.id).slice(-15).map((l) => ({ kind: l.kind, text: l.text }));
          try { await api.report(r.id, r.name, this.serverId, `${reason}${note.value ? ': ' + note.value : ''}`, ctx); this.system(`Report sent. Thank you.`); } catch (e) { this.system((e as Error).message); }
          this.hud.closeModal();
        } }, 'Send report')));
    this.hud.openModal(box);
  }
  // ---------------- prides ----------------
  private async refreshPride() {
    try { const r = await api.prideMine(); this.pride = r.pride; this.invites = r.invites; } catch { /* */ }
    this.hud.refreshSide('pride', () => this.pridePanel());
  }
  private onInvite(m: { pride: string; name: string; by: string }) {
    this.invites = this.invites.filter((i) => i.id !== m.pride);
    this.invites.push({ id: m.pride, name: m.name, color: '', emblem: '' });
    this.system(`${m.by} invited you to ${m.name}. Open the pride panel (R) to accept.`);
    this.hud.showToast('Pride invite', `${m.name}`, 4);
    this.hud.refreshSide('pride', () => this.pridePanel());
  }
  togglePride() { this.refreshPride(); this.hud.toggleSide('pride', () => this.pridePanel()); }
  private async prideDo(fn: () => Promise<unknown>) {
    try { const r = await fn(); if (r && typeof r === 'object' && 'members' in (r as object)) this.pride = r as Pride; else await this.refreshPride(); this.send('pride', {}); this.tagT = 0; this.denT = 0; }
    catch (e) { this.system((e as Error).message); }
    this.hud.refreshSide('pride', () => this.pridePanel());
  }
  private pridePanel(): HTMLElement {
    const wrap = el('div', { class: 'gg-scroll', style: { padding: '20px 22px', height: '100%' } }, el('div', { class: 'gg-title', style: { fontSize: '28px', marginBottom: '14px' } }, 'Pride'));
    const pr = this.pride;
    for (const inv of this.invites) wrap.append(el('div', { class: 'gg-card', style: { marginBottom: '10px' } },
      el('div', { style: { fontWeight: '600' } }, `Invite: ${inv.emblem} ${inv.name}`),
      el('div', { class: 'gg-row', style: { marginTop: '8px' } },
        el('button', { class: 'gg-btn small primary', onclick: () => this.prideDo(() => api.prideAccept(inv.id, this.cfg.name)) }, 'Join'),
        el('button', { class: 'gg-btn small ghost', onclick: () => this.prideDo(() => api.prideDecline(inv.id)) }, 'Decline'))));
    if (!pr) {
      let color = PRIDE_COLORS[0], emblem = EMBLEMS[0];
      const name = el('input', { class: 'gg-input', placeholder: 'Pride name', maxlength: 28, value: `${this.cfg.name}'s Pride` }) as HTMLInputElement;
      const colors = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '8px' } });
      const emblems = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '6px' } });
      const draw = () => {
        colors.innerHTML = ''; emblems.innerHTML = '';
        for (const c of PRIDE_COLORS) colors.append(el('div', { class: 'gg-swatch' + (c === color ? ' on' : ''), style: { background: c }, onclick: () => { color = c; draw(); } }));
        for (const e of EMBLEMS) emblems.append(el('button', { class: 'gg-chip' + (e === emblem ? ' on' : ''), style: { fontSize: '16px', minWidth: '40px' }, onclick: () => { emblem = e; draw(); } }, e));
      };
      draw();
      wrap.append(el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)', marginBottom: '14px', lineHeight: '1.5' } }, 'Found a pride and invite others from the Players list, or accept an invite.'),
        el('div', { class: 'gg-label', style: { marginBottom: '8px' } }, 'Name'), name,
        el('div', { class: 'gg-label', style: { margin: '14px 0 8px' } }, 'Colour'), colors,
        el('div', { class: 'gg-label', style: { margin: '14px 0 8px' } }, 'Emblem'), emblems,
        el('button', { class: 'gg-btn primary', style: { marginTop: '18px' }, onclick: () => this.prideDo(() => api.prideCreate(filterName(name.value) || 'New Pride', color, emblem, this.cfg.name)) }, 'Found pride'));
      return wrap;
    }
    const lead = pr.leader === this.me;
    wrap.append(el('div', { style: { fontSize: '22px', color: pr.color, fontFamily: 'var(--gg-display)' } }, `${pr.emblem} ${pr.name}`));
    if (lead) {
      const colors = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '8px', margin: '12px 0' } }, ...PRIDE_COLORS.map((c) => el('div', { class: 'gg-swatch' + (c === pr.color ? ' on' : ''), style: { background: c }, onclick: () => this.prideDo(() => api.prideUpdate(null, c, null)) })));
      const emblems = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '6px' } }, ...EMBLEMS.map((e) => el('button', { class: 'gg-chip' + (e === pr.emblem ? ' on' : ''), style: { fontSize: '16px', minWidth: '40px' }, onclick: () => this.prideDo(() => api.prideUpdate(null, null, e)) }, e)));
      wrap.append(colors, emblems);
    }
    wrap.append(el('div', { class: 'gg-label', style: { margin: '20px 0 10px' } }, `Members (${pr.members.length})`));
    for (const m of pr.members) {
      const right = el('div', { class: 'gg-row', style: { gap: '6px' } });
      if (lead && m.id !== this.me) {
        const sel = el('select', { class: 'gg-input', style: { width: '110px', padding: '6px 8px', fontSize: '13px' } }) as HTMLSelectElement;
        for (const r of ['hunter', 'healer', 'member', 'cub']) sel.append(el('option', { value: r, selected: r === m.role }, ROLE_LABEL[r]));
        sel.addEventListener('change', () => this.prideDo(() => api.prideSetRole(m.id, sel.value)));
        right.append(sel, el('button', { class: 'gg-chip', onclick: () => this.prideDo(() => api.prideKick(m.id)) }, 'Remove'));
      } else right.append(el('span', { class: 'gg-chip on' }, ROLE_LABEL[m.role] ?? m.role));
      wrap.append(el('div', { class: 'gg-row', style: { justifyContent: 'space-between', padding: '8px 0' } },
        el('div', {}, el('span', { style: { fontWeight: '600' } }, m.name), el('span', { style: { fontSize: '11px', marginLeft: '8px', color: m.online ? 'var(--gg-gold)' : 'var(--gg-cream-dim)' } }, m.online ? '● online' : 'offline')), right));
    }
    wrap.append(el('div', { class: 'gg-label', style: { margin: '20px 0 8px' } }, 'Dens'),
      el('div', { style: { fontSize: '13px', lineHeight: '1.6' } }, pr.dens.length ? pr.dens.map((d) => BIOMES[d as BiomeKey]?.name ?? d).join(', ') : 'None yet. Stand at a biome’s den spot to claim it.'),
      el('button', { class: 'gg-btn small ghost', style: { marginTop: '18px' }, onclick: () => this.prideDo(() => api.prideLeave()) }, 'Leave pride'));
    return wrap;
  }
  private async refreshDens() {
    let owners: Record<string, { name: string; color: string; emblem: string }> = {};
    try { owners = await api.denOwners(); } catch { return; }
    for (const [k, m] of this.dens) if (!owners[k]) { m.dispose(); this.dens.delete(k); }
    for (const [k, o] of Object.entries(owners)) {
      if (!(k in BIOMES)) continue;
      const m = this.dens.get(k);
      if (m) m.setColor(o.color); else this.dens.set(k, makeDenMarker(this.app.game, k as BiomeKey, o.color));
    }
    (this as any).denOwners = owners;
  }
  private denAction() {
    const p = this.app.game.player!;
    for (const [k, b] of Object.entries(BIOMES) as [BiomeKey, (typeof BIOMES)[BiomeKey]][]) {
      if (Math.hypot(p.pos.x - b.den[0], p.pos.z - b.den[1]) > 9) continue;
      const owner = ((this as any).denOwners ?? {})[k];
      if (this.pride && this.pride.dens.includes(k)) return null;
      if (!this.pride) return { label: `${b.name} den${owner ? ` · held by ${owner.name}` : ''}`, run: () => this.system('Found or join a pride to claim dens (R).') };
      return { label: owner ? `Take den from ${owner.name}` : `Claim den: ${b.name}`, run: () => { p.setPose('roar', 3); this.app.game.audio.call('roar', p.pos, p.size); this.fx('roar'); this.prideDo(() => api.prideClaimDen(k)); this.send('chat', { i: this.me, n: this.cfg.name, m: `claimed the ${b.name} den for ${this.pride!.name}.`, k: 'server', x: p.pos.x, z: p.pos.z }); this.system(`You claimed the ${b.name} den.`); } };
    }
    return null;
  }
  dispose() {
    this.closed = true;
    this.quests.dispose();
    removeEventListener('keydown', this.onKey);
    removeEventListener('pagehide', this.onHide);
    if (this.ch) { this.ch.untrack().catch(() => {}); sb().removeChannel(this.ch); this.ch = null; }
    api.leave().catch(() => {});
    for (const r of this.remotes.values()) if (r.e) this.app.game.removeEntity(r.e);
    this.remotes.clear();
    for (const d of this.dens.values()) d.dispose();
    this.app.game.input.enabled = true;
    this.app.game.onSettings = null;
  }
}
void THREE; void icon;
