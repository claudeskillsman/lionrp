import * as THREE from 'three';
import type { Game, ModeHooks } from './game';
import type { Hud, TagInfo } from '../ui/hud';
import { AiCat } from './ai';
import { Saves, SoloSave, AiCatSave, JournalEntry } from './save';
import { CatConfig, randomCat, randomName, Species, LifeStage, newId } from '../cat/catConfig';
import type { PoseName } from '../cat/catRig';
import { BIOMES, BiomeKey, SPAWN } from '../world/worldgen';
import { el, icon } from '../ui/style';
import { makeDenMarker, DenMarker } from './denMarker';

export const ROLES = ['leader', 'hunter', 'healer', 'member', 'cub'] as const;
export const ROLE_LABEL: Record<string, string> = { leader: 'Leader', hunter: 'Hunter', healer: 'Healer', member: 'Member', cub: 'Cub', elder: 'Elder' };
export const EMBLEMS = ['☀', '☾', '✦', '❖', '♆', '❋', '✧', '⟁'];
export const PRIDE_COLORS = ['#e7b766', '#d9643a', '#8fbf6a', '#6aa8d8', '#c47ad8', '#e8e2d0', '#d84a5a', '#4ac0a8'];

const GOALS = [
  { id: 'pride', title: 'Grow the pride', desc: 'Lead a pride of 8 cats.', max: 8 },
  { id: 'dens', title: 'Claim every den', desc: 'Mark a den in each of the seven lands.', max: 7 },
  { id: 'drought', title: 'Survive a drought', desc: 'Keep your pride fed and watered through a dry spell.', max: 1 },
  { id: 'cub', title: 'Raise a cub', desc: 'Watch a cub born to your pride grow up.', max: 1 },
];

const DAY_PER_STAGE: Record<LifeStage, number> = { cub: 3, adolescent: 4, adult: 40, elder: 9999 };
const NEXT_STAGE: Record<LifeStage, LifeStage> = { cub: 'adolescent', adolescent: 'adult', adult: 'elder', elder: 'elder' };

interface Rival { name: string; color: string; den: BiomeKey; cats: AiCat[]; wp: THREE.Vector3; retreatT: number; warnT: number; }

function relatedSpecies(s: Species): Species { return s === 'lion' ? 'lioness' : s; }

/** Solo mode: an AI pride you lead, rivals, migrating herds, births and aging, light goals, offline saves. */
export class SoloMode implements ModeHooks {
  save: SoloSave;
  pride: AiCat[] = [];
  rivals: Rival[] = [];
  private spawnQueue: (() => void)[] = [];
  private saveT = 0;
  private lastHour: number;
  private idleT = 0;
  private dens = new Map<string, DenMarker>();
  private droughtCheck = 0;
  private uiTime!: HTMLElement;
  constructor(private game: Game, private hud: Hud, private char: CatConfig) {
    const existing = Saves.solo(char.id);
    this.save = existing ?? this.fresh();
    const s = this.save;
    // player
    const p = game.spawnPlayer(char, s.x, s.z, s.yaw);
    p.hunger = s.hunger; p.thirst = s.thirst;
    game.gw.env.setTime(s.hour);
    game.gw.env.timeSpeed = s.timeSpeed;
    this.lastHour = s.hour;
    // pride: build gradually so the first frame shows up quickly
    for (const m of s.pride) this.spawnQueue.push(() => this.addPrideCat(m));
    this.spawnQueue.push(() => this.spawnRivals());
    for (const d of s.claimedDens) this.placeDenMarker(d as BiomeKey);
    hud.tags = () => this.tags();
    hud.ctrl.extra = () => this.contextAction();
    hud.ctrl.onEmote = (pose) => this.onPlayerEmote(pose);
    hud.ctrl.onCatch = (kind) => this.onCatch(kind);
    hud.ctrl.onRoar = () => this.onPlayerRoar();
    hud.ctrl.onSocial = (act, t) => { if (act === 'carry' && t.config.lifeStage === 'cub') this.log('pride', `${this.char.name} carried ${t.config.name} by the scruff.`); };
    hud.addButton('book', 'Journal (J)', () => this.toggleJournal(), true);
    hud.addButton('pride', 'Pride (R)', () => this.togglePride(), true);
    this.buildTimeControl();
    addEventListener('keydown', this.onKey);
    addEventListener('pagehide', this.persist);
    document.addEventListener('visibilitychange', this.onVis);
    if (!existing) {
      this.log('note', `${char.name} wakes in the long grass. A small pride waits nearby.`);
      setTimeout(() => hud.showToast(s.prideName, 'Your pride'), 600);
    }
  }
  private onVis = () => { if (document.visibilityState === 'hidden') this.persist(); };
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (this.game.state !== 'play') return;
    const kb = this.game.settings.keybinds;
    if (e.code === kb.journal) this.toggleJournal();
    if (e.code === kb.pride) this.togglePride();
  };
  private fresh(): SoloSave {
    const c = this.char;
    const rnd = Math.random;
    const sp = relatedSpecies(c.species);
    const members: AiCatSave[] = [];
    const mk = (stage: LifeStage, role: string) => {
      const cfg = randomCat(rnd, sp === 'lioness' && rnd() < 0.25 && stage === 'adult' ? 'lion' : sp);
      cfg.lifeStage = stage; cfg.accessories = rnd() < 0.3 ? [['flowers', 'bones', 'feather', 'beads'][Math.floor(rnd() * 4)]] : [];
      const a = rnd() * Math.PI * 2;
      members.push({ config: cfg, x: SPAWN[0] + Math.cos(a) * 6, z: SPAWN[1] + Math.sin(a) * 6, ageDays: stage === 'cub' ? 0 : stage === 'elder' ? 50 : 10, role });
    };
    mk('adult', 'hunter'); mk('adult', 'healer'); mk('cub', 'cub');
    return {
      version: 1, charId: c.id, x: SPAWN[0], z: SPAWN[1], yaw: Math.PI, hour: 17.4, day: 1, hunger: 80, thirst: 75,
      prideName: `${c.name}'s Pride`, prideColor: PRIDE_COLORS[0], prideEmblem: EMBLEMS[0],
      pride: members, journal: [], goals: {}, claimedDens: [], drought: { active: false, startDay: 0, survived: false },
      timeSpeed: 1, lastCubDay: 1, savedAt: Date.now(),
    };
  }
  // ---------------- pride ----------------
  private addPrideCat(m: AiCatSave) {
    const ai = new AiCat(this.game, m.config, m.role, m.x, m.z);
    (ai as any).save = m;
    this.pride.push(ai);
    this.game.addEntity(ai.e);
  }
  private saveOf(ai: AiCat): AiCatSave { return (ai as any).save; }
  private spawnRivals() {
    const defs: [string, string, BiomeKey][] = [['Ashmane', '#b8b0a8', 'kopjes'], ['Redwater', '#c0503a', 'river'], ['Thornveil', '#7a9a5a', 'woodland']];
    for (const [name, color, den] of defs) {
      if (this.save.claimedDens.includes(den)) continue;
      const d = BIOMES[den].den;
      const r: Rival = { name, color, den, cats: [], wp: new THREE.Vector3(d[0], 0, d[1]), retreatT: 0, warnT: 0 };
      const n = 3;
      for (let i = 0; i < n; i++) {
        const sp: Species = (['lion', 'lioness', 'lioness', 'leopard', 'tiger'] as Species[])[(name.length + i * 3) % 5];
        const cfg = randomCat(Math.random, sp);
        cfg.name = randomName();
        const a = (i / n) * Math.PI * 2;
        const ai = new AiCat(this.game, cfg, i === 0 ? 'leader' : 'hunter', d[0] + Math.cos(a) * 5, d[1] + Math.sin(a) * 5);
        ai.state = 'patrol';
        r.cats.push(ai);
        this.spawnQueue.push(() => this.game.addEntity(ai.e));
      }
      this.rivals.push(r);
    }
  }
  private tags(): TagInfo[] {
    const s = this.save;
    const out: TagInfo[] = [];
    const p = this.game.player;
    if (p) out.push({ e: p, name: this.char.name, sub: `${s.prideEmblem} ${s.prideName} · Leader`, color: s.prideColor });
    for (const a of this.pride) out.push({ e: a.e, name: a.e.config.name, sub: `${s.prideEmblem} ${ROLE_LABEL[a.role] ?? a.role}`, color: s.prideColor });
    for (const r of this.rivals) for (const a of r.cats) if (this.game.entities.includes(a.e)) out.push({ e: a.e, name: a.e.config.name, sub: `${r.name} pride`, color: r.color });
    return out;
  }
  // ---------------- per frame ----------------
  update(dt: number) {
    const g = this.game, p = g.player;
    if (this.spawnQueue.length) this.spawnQueue.shift()!();
    if (!p || dt === 0) return;
    // time, days, aging
    const env = g.gw.env;
    if (env.time < this.lastHour - 12) this.newDay();
    this.lastHour = env.time;
    this.save.hour = env.time;
    const night = env.time < 5.5 || env.time > 19.5;
    // drought makes thirst bite harder
    if (this.save.drought.active && g.settings.survival) p.thirst = Math.max(0, p.thirst - dt * 0.07);
    // player idle detection drives the pride's resting
    this.idleT = p.speed < 0.3 ? this.idleT + dt : 0;
    for (const ai of this.pride) this.updatePrideCat(ai, dt, night);
    for (const r of this.rivals) this.updateRival(r, dt, night);
    // goals that are checked continuously
    this.setGoal('pride', this.pride.length + 1);
    // autosave
    this.saveT += dt;
    if (this.saveT > 20) { this.saveT = 0; this.persist(); }
    this.uiTime.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.s) === (g.paused ? 0 : env.timeSpeed)));
  }
  private updatePrideCat(ai: AiCat, dt: number, night: boolean) {
    const g = this.game, p = g.player!, e = ai.e;
    if (e.carriedBy) return;
    if (ai.tickEmote(dt)) return;
    ai.t -= dt;
    const dP = e.pos.distanceTo(p.pos);
    // wild cats keep themselves fed (abstracted)
    e.hunger = Math.min(100, e.hunger + dt * 0.02);
    // hunting: join the leader when they stalk prey
    const stalking = p.cat.rig.crouch > 0.5 || this.hud.ctrl.pounceT >= 0;
    if (ai.state !== 'hunt' && ai.state !== 'eat' && e.config.lifeStage !== 'cub' && e.config.lifeStage !== 'elder' && stalking && (ai.role === 'hunter' || ai.role === 'leader' || ai.role === 'member')) {
      const prey = g.fauna.nearestPrey(p.pos, 45);
      if (prey) { ai.state = 'hunt'; ai.t = 25; ai.huntPrey = prey.pos; }
    }
    switch (ai.state) {
      case 'hunt': {
        const prey = g.fauna.nearestPrey(e.pos, 60);
        if (!prey || ai.t <= 0) { ai.state = 'follow'; break; }
        // circle to a flank, then rush
        const d = prey.dist;
        if (d > 14) {
          const flank = new THREE.Vector3().subVectors(prey.pos, p.pos).normalize();
          const side = new THREE.Vector3(-flank.z, 0, flank.x).multiplyScalar(Math.sin(ai.slot) > 0 ? 8 : -8);
          const tgt = prey.pos.clone().add(side).addScaledVector(flank, -6);
          ai.moveTo(tgt, 2, { crouch: d < 30, walk: d < 30 });
        } else {
          ai.moveTo(prey.pos, 0.5, { sprint: true });
          if (d < 2.2 * e.size) {
            const kind = g.fauna.tryCatch(e.pos, 2.4 * e.size);
            if (kind) { this.onCatch(kind, ai); }
          }
        }
        break;
      }
      case 'eat':
        if (e.pose !== 'eat' && ai.moveTo(ai.target, 1.2, { run: true }) > 1.2) { if (ai.t <= 0) ai.state = 'follow'; break; }
        ai.stop();
        if (e.pose !== 'eat') { if (ai.huntPrey) ai.faceTo(ai.huntPrey); e.setPose('eat'); }
        e.hunger = Math.min(100, e.hunger + dt * 8);
        if (ai.t <= 0) { e.setPose(null); ai.state = 'follow'; }
        break;
      case 'rest': {
        if (dP > 14 || p.speed > 2.5) { e.setPose(null); ai.state = 'follow'; break; }
        const d = ai.moveTo(ai.target, 0.6, { walk: true });
        if (d < 0.6 && !e.pose) {
          ai.stop(); e.speed = 0;
          const pose: PoseName = night ? 'sleep' : ai.restPose;
          e.setPose(pose);
        }
        if (e.pose && ai.t <= 0) {
          // small idle variety: groom, stretch, change position
          ai.t = 10 + Math.random() * 20;
          const r = Math.random();
          if (!night && r < 0.25) ai.emote('groom', 0, 6);
          else if (!night && r < 0.35) ai.emote('stretch', 0, 3.6);
          else if (r < 0.5) { e.setPose(null); ai.restPose = Math.random() < 0.5 ? 'sit' : 'lie'; ai.target.copy(this.restSpot(ai)); }
        }
        break;
      }
      case 'follow':
      default: {
        // keep a loose formation behind the leader
        const back = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        const side = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
        const idx = this.pride.indexOf(ai);
        const row = 1 + Math.floor(idx / 2), s = idx % 2 === 0 ? 1 : -1;
        const spacing = 2.4 * Math.max(1, e.size);
        const tgt = p.pos.clone().addScaledVector(back, row * spacing + 1.5).addScaledVector(side, s * (1.6 + Math.sin(ai.slot) * 0.8) * e.size);
        const far = dP > 30;
        if (dP > 140) { // teleport stragglers when the leader sprints far ahead
          const a = Math.random() * Math.PI * 2;
          e.place(p.pos.x - back.x * -20 + Math.cos(a) * 25, p.pos.z + Math.sin(a) * 25, g.world, p.yaw);
        }
        // the leader's speed sets the pace
        ai.moveTo(tgt, p.speed > 0.5 ? 0.8 : 2.5, { sprint: far || p.speed > p.runSpeed * 1.1, walk: p.speed < 2.2 && !far, crouch: p.cat.rig.crouch > 0.5 && !far });
        if (e.carried) { /* never */ }
        if (this.idleT > 7 && dP < 12) { ai.state = 'rest'; ai.t = 5 + Math.random() * 10; ai.restPose = Math.random() < 0.6 ? 'lie' : 'sit'; ai.target.copy(this.restSpot(ai)); }
        break;
      }
    }
    // cubs bounce around the adults a little
    if (e.config.lifeStage === 'cub' && ai.state === 'rest' && !e.pose && Math.random() < dt * 0.05) ai.emote('playbow', 0, 2);
  }
  private restSpot(ai: AiCat) {
    const p = this.game.player!;
    const idx = this.pride.indexOf(ai);
    const a = idx * 2.39996 + p.yaw;
    const r = 2.4 + (idx % 3) * 1.3;
    return new THREE.Vector3(p.pos.x + Math.cos(a) * r, 0, p.pos.z + Math.sin(a) * r);
  }
  private updateRival(r: Rival, dt: number, night: boolean) {
    const g = this.game, p = g.player!;
    const lead = r.cats[0];
    const d = BIOMES[r.den].den;
    const home = new THREE.Vector3(d[0], 0, d[1]);
    r.retreatT = Math.max(0, r.retreatT - dt);
    r.warnT = Math.max(0, r.warnT - dt);
    const dP = lead.e.pos.distanceTo(p.pos);
    for (let i = 0; i < r.cats.length; i++) {
      const ai = r.cats[i], e = ai.e;
      if (!g.entities.includes(e)) continue;
      if (ai.tickEmote(dt)) continue;
      if (dP > 220) { ai.stop(); if (!e.pose) e.setPose(night ? 'sleep' : 'lie'); continue; } // far away: frozen at rest, cheap
      if (r.retreatT > 0) {
        const away = new THREE.Vector3().subVectors(e.pos, p.pos).setY(0).normalize().multiplyScalar(80).add(home);
        ai.moveTo(away, 3, { run: true });
        continue;
      }
      if (dP < 28) {
        // stare down the intruder
        if (e.pose === 'lie' || e.pose === 'sleep' || e.pose === 'sit') e.setPose(null);
        ai.stop(); ai.faceTo(p.pos);
        if (r.warnT <= 0 && i === 0) {
          r.warnT = 9;
          for (const [k, c] of r.cats.entries()) c.emote(k === 0 ? 'roar' : 'growl', k * 0.4, k === 0 ? 3 : 2.5);
          this.hud.showToast(`The ${r.name} pride`, 'They warn you off their den', 3);
        }
        continue;
      }
      // patrol around the den; followers trail the leader
      if (i === 0) {
        if (ai.moveTo(r.wp, 3, { walk: true }) < 3 || ai.t <= 0) {
          ai.t = 30 + Math.random() * 30;
          const a = Math.random() * Math.PI * 2, rr = 10 + Math.random() * 35;
          r.wp.set(home.x + Math.cos(a) * rr, 0, home.z + Math.sin(a) * rr);
          if (Math.random() < 0.4) ai.emote(night ? 'sleep' : 'lie', 0, 15 + Math.random() * 20);
        }
        ai.t -= dt;
      } else {
        const L = lead.e;
        const back = new THREE.Vector3(-Math.sin(L.yaw), 0, -Math.cos(L.yaw));
        const side = new THREE.Vector3(Math.cos(L.yaw), 0, -Math.sin(L.yaw));
        const tgt = L.pos.clone().addScaledVector(back, 3).addScaledVector(side, i % 2 ? 2 : -2);
        if (L.pose && (L.pose === 'lie' || L.pose === 'sleep')) { if (!e.pose && ai.moveTo(tgt, 1.5, { walk: true }) < 1.5) e.setPose(L.pose); }
        else ai.moveTo(tgt, 1.2, { walk: L.speed < 2.2 });
      }
    }
  }
  // ---------------- events ----------------
  private onPlayerEmote(pose: PoseName) {
    const p = this.game.player!;
    const near = this.pride.filter((a) => a.e.pos.distanceTo(p.pos) < 25 && !a.e.carriedBy);
    near.sort((a, b) => a.e.pos.distanceTo(p.pos) - b.e.pos.distanceTo(p.pos));
    switch (pose) {
      case 'roar':
        // the pride answers in a chorus
        near.forEach((a, i) => { if (a.e.config.lifeStage !== 'cub') a.emote('roar', 0.8 + i * 0.5 + Math.random() * 0.4, 3); else a.emote('growl', 1 + i * 0.3, 1.5); });
        break;
      case 'playbow': {
        const c = near.find((a) => a.e.config.lifeStage !== 'elder');
        if (c) { c.faceTo(p.pos); c.emote('playbow', 0.4, 2.5); setTimeout(() => { if (c.e.pos.distanceTo(p.pos) < 5) c.emote('playfight', 0, 5); }, 2900); }
        break;
      }
      case 'sleep': case 'lie': case 'sit':
        this.idleT = 99;
        for (const a of near) { a.state = 'rest'; a.restPose = pose === 'sit' ? 'sit' : 'lie'; a.target.copy(this.restSpot(a)); a.t = 5; }
        break;
      case 'groom':
        if (near[0]) near[0].emote('groom', 1, 6);
        break;
      case 'nuzzle':
        if (near[0] && near[0].e.pos.distanceTo(p.pos) < 4) { near[0].faceTo(p.pos); near[0].emote('nuzzle', 0.3, 4); }
        break;
      case 'growl':
        for (const a of near.slice(0, 3)) a.emote('growl', 0.5 + Math.random(), 2);
        break;
      case 'stretch':
        if (near[0]) near[0].emote('stretch', 1.2, 3.6);
        break;
    }
  }
  private onPlayerRoar() {
    // roaring at rivals: with enough of your pride close by, they give ground
    const p = this.game.player!;
    for (const r of this.rivals) {
      const d = r.cats[0].e.pos.distanceTo(p.pos);
      if (d > 35) continue;
      const mine = 1 + this.pride.filter((a) => a.e.pos.distanceTo(p.pos) < 25 && a.e.config.lifeStage !== 'cub').length;
      if (mine >= r.cats.length) {
        r.retreatT = 60;
        this.hud.showToast(`The ${r.name} pride retreats`, 'Their den is open', 4);
        this.log('world', `The ${r.name} pride gave ground at ${BIOMES[r.den].name}.`);
      } else {
        for (const [k, c] of r.cats.entries()) c.emote('roar', 0.6 + k * 0.5, 3);
        this.hud.showToast(`The ${r.name} pride stands firm`, `Bring more of your pride (${mine}/${r.cats.length})`, 4);
      }
    }
  }
  private onCatch(kind: string, by?: AiCat) {
    const g = this.game, p = g.player!;
    const who = by ? by.e.config.name : this.char.name;
    this.log('pride', `${who} brought down a ${kind}.`);
    this.hud.showToast('A successful hunt', `${who} caught a ${kind}`, 3);
    const spot = by ? by.e.pos.clone() : p.pos.clone();
    for (const a of this.pride) {
      if (a.e.pos.distanceTo(spot) > 40 || a.e.carriedBy) continue;
      a.state = 'eat'; a.t = 14 + Math.random() * 4;
      const ang = Math.random() * Math.PI * 2;
      a.e.setPose(null);
      a.target.set(spot.x + Math.cos(ang) * 1.8, 0, spot.z + Math.sin(ang) * 1.8);
      a.huntPrey = spot.clone();
    }
    if (by && p.pos.distanceTo(spot) < 40) this.hud.ctrl.setKill(spot);
  }
  private newDay() {
    const s = this.save;
    s.day++;
    // aging and growing up
    for (const a of [...this.pride]) {
      const m = this.saveOf(a);
      m.ageDays++;
      const st = m.config.lifeStage;
      const born = m.bornDay ?? -999;
      const stageAge = st === 'cub' ? s.day - born : m.ageDays;
      if (st !== 'elder' && stageAge >= DAY_PER_STAGE[st] && (st !== 'adult' || m.ageDays >= 40)) {
        m.config.lifeStage = NEXT_STAGE[st];
        if (st === 'cub' && m.role === 'cub') m.role = 'member';
        if (st === 'cub' && m.bornDay !== undefined) { this.setGoal('cub', 1); }
        this.log('pride', st === 'adult' ? `${m.config.name} has grown grey around the muzzle.` : `${m.config.name} is ${NEXT_STAGE[st] === 'adult' ? 'fully grown' : 'no longer a cub'}.`);
        this.rebuildCat(a);
      }
    }
    // births: a healthy pride with two or more adults raises cubs every few days
    const adults = this.pride.filter((a) => a.e.config.lifeStage === 'adult').length + (this.char.lifeStage === 'adult' ? 1 : 0);
    if (adults >= 2 && s.day - s.lastCubDay >= 3 && this.pride.length < 11) {
      s.lastCubDay = s.day;
      const parent = this.pride.find((a) => a.e.config.lifeStage === 'adult') ?? this.pride[0];
      const cfg = randomCat(Math.random, relatedSpecies(this.char.species));
      if (parent) { cfg.coat = parent.e.config.coat; cfg.pattern = parent.e.config.pattern; cfg.eyeColor = Math.random() < 0.5 ? parent.e.config.eyeColor : this.char.eyeColor; }
      cfg.id = newId(); cfg.lifeStage = 'cub'; cfg.mane = 'none'; cfg.scars = []; cfg.accessories = [];
      const p = this.game.player!;
      const m: AiCatSave = { config: cfg, x: p.pos.x + 3, z: p.pos.z + 2, ageDays: 0, role: 'cub', bornDay: s.day };
      s.pride.push(m);
      this.addPrideCat(m);
      this.log('pride', `A cub was born: ${cfg.name}.`);
      this.hud.showToast('A cub is born', cfg.name, 5);
    }
    // drought: rare dry spell after the first few days, lasting two days
    if (s.drought.active && s.day - s.drought.startDay >= 2) {
      s.drought.active = false;
      const p = this.game.player!;
      if (p.thirst > 0) { s.drought.survived = true; this.setGoal('drought', 1); this.log('goal', 'The rains returned. The pride survived the drought.'); this.hud.showToast('The drought breaks', 'Your pride endured', 5); }
      this.game.gw.env.rainTarget = 0.8;
    } else if (!s.drought.active && s.day >= 3 && Math.random() < 0.35) {
      s.drought = { active: true, startDay: s.day, survived: s.drought.survived };
      this.game.gw.env.rainTarget = 0;
      this.log('world', 'A drought settles over the grassland. Water is scarce.');
      this.hud.showToast('Drought', 'Stay near water', 5);
    }
    this.log('note', `Day ${s.day} begins.`);
    this.persist();
  }
  private rebuildCat(a: AiCat) {
    const g = this.game;
    const m = this.saveOf(a);
    const { x, z } = a.e.pos;
    g.removeEntity(a.e);
    const n = new AiCat(g, m.config, m.role, x, z);
    (n as any).save = m;
    this.pride[this.pride.indexOf(a)] = n;
    g.addEntity(n.e);
  }
  // ---------------- dens ----------------
  private contextAction() {
    const p = this.game.player!;
    for (const [k, b] of Object.entries(BIOMES) as [BiomeKey, (typeof BIOMES)[BiomeKey]][]) {
      if (this.save.claimedDens.includes(k)) continue;
      if (Math.hypot(p.pos.x - b.den[0], p.pos.z - b.den[1]) > 9) continue;
      const rival = this.rivals.find((r) => r.den === k && r.retreatT <= 0 && r.cats[0].e.pos.distanceTo(p.pos) < 60);
      if (rival) return { label: `${rival.name} pride holds this den`, run: () => this.hud.showToast(`Drive off the ${rival.name} pride`, 'Roar at them with your pride close by', 4) };
      return { label: `Claim den: ${b.name}`, run: () => this.claimDen(k) };
    }
    return null;
  }
  private claimDen(k: BiomeKey) {
    this.save.claimedDens.push(k);
    this.placeDenMarker(k);
    this.setGoal('dens', this.save.claimedDens.length);
    const r = this.rivals.find((x) => x.den === k);
    if (r) { for (const c of r.cats) this.game.removeEntity(c.e); this.rivals.splice(this.rivals.indexOf(r), 1); }
    this.game.player!.setPose('roar', 3); this.game.audio.call('roar', this.game.player!.pos, this.game.player!.size);
    this.onPlayerEmote('roar');
    this.log('goal', `${this.save.prideName} claimed the den at ${BIOMES[k].name}.`);
    this.hud.showToast('Den claimed', BIOMES[k].name, 5);
    this.persist();
  }
  private placeDenMarker(k: BiomeKey) {
    this.dens.set(k, makeDenMarker(this.game, k, this.save.prideColor));
  }
  // ---------------- goals & journal ----------------
  private setGoal(id: string, v: number) {
    const s = this.save;
    const goal = GOALS.find((x) => x.id === id)!;
    const prev = s.goals[id] ?? 0;
    if (v <= prev) return;
    s.goals[id] = Math.min(goal.max, v);
    if (prev < goal.max && s.goals[id] >= goal.max) { this.log('goal', `Goal complete: ${goal.title}.`); this.hud.showToast('Goal complete', goal.title, 5); }
    this.hud.refreshSide('journal', () => this.journalPanel());
  }
  log(kind: JournalEntry['kind'], text: string) {
    const s = this.save;
    s.journal.push({ day: s.day, hour: this.game.gw.env.time, text, kind });
    if (s.journal.length > 200) s.journal.splice(0, s.journal.length - 200);
    this.hud.refreshSide('journal', () => this.journalPanel());
  }
  toggleJournal() { this.hud.toggleSide('journal', () => this.journalPanel()); }
  togglePride() { this.hud.toggleSide('pride', () => this.pridePanel()); }
  private journalPanel() {
    const s = this.save, p = this.game.player!;
    const goals = el('div', { class: 'gg-col', style: { gap: '12px' } }, ...GOALS.map((gl) => {
      const v = s.goals[gl.id] ?? 0; const done = v >= gl.max;
      return el('div', {},
        el('div', { class: 'gg-row', style: { justifyContent: 'space-between' } }, el('div', { style: { font: '600 14px var(--gg-ui)', color: done ? 'var(--gg-gold)' : '' } }, (done ? '✓ ' : '') + gl.title), el('div', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)' } }, `${v}/${gl.max}`)),
        el('div', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)', margin: '3px 0 6px' } }, gl.desc),
        el('div', { style: { height: '4px', borderRadius: '4px', background: 'rgba(246,234,210,.14)' } }, el('div', { style: { height: '100%', width: (v / gl.max) * 100 + '%', borderRadius: '4px', background: 'var(--gg-gold)' } })));
    }));
    const dir = (x: number, z: number) => {
      const dx = x - p.pos.x, dz = z - p.pos.z; const d = Math.hypot(dx, dz);
      const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
      const a = Math.atan2(dx, -dz); const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
      return d < 15 ? 'here' : `${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'} ${names[i]}`;
    };
    const dens = el('div', { class: 'gg-col', style: { gap: '6px' } }, ...(Object.entries(BIOMES) as [BiomeKey, (typeof BIOMES)[BiomeKey]][]).map(([k, b]) =>
      el('div', { class: 'gg-row', style: { justifyContent: 'space-between', fontSize: '13px' } }, el('span', { style: { color: s.claimedDens.includes(k) ? 'var(--gg-gold)' : '' } }, (s.claimedDens.includes(k) ? s.prideEmblem + ' ' : '') + b.name), el('span', { style: { color: 'var(--gg-cream-dim)' } }, dir(b.den[0], b.den[1])))));
    const entries = el('div', { class: 'gg-col', style: { gap: '9px' } }, ...s.journal.slice(-40).reverse().map((j) => el('div', { style: { fontSize: '13px', lineHeight: '1.45' } }, el('span', { style: { color: 'var(--gg-cream-dim)', fontSize: '11px', letterSpacing: '.1em', marginRight: '8px' } }, `DAY ${j.day}`), j.text)));
    return el('div', { class: 'gg-scroll', style: { padding: '20px 22px', height: '100%' } },
      el('div', { class: 'gg-title', style: { fontSize: '28px' } }, 'Journal'),
      el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)', margin: '6px 0 18px' } }, `Day ${s.day}${s.drought.active ? ' · Drought' : ''}`),
      el('div', { class: 'gg-label', style: { marginBottom: '10px' } }, 'Goals'), goals,
      el('div', { class: 'gg-label', style: { margin: '22px 0 10px' } }, 'Dens'), dens,
      el('div', { class: 'gg-label', style: { margin: '22px 0 10px' } }, 'Story so far'), entries);
  }
  private pridePanel(): HTMLElement {
    const s = this.save;
    const name = el('input', { class: 'gg-input', value: s.prideName, maxlength: 28 }) as HTMLInputElement;
    name.addEventListener('change', () => { s.prideName = name.value.trim().slice(0, 28) || s.prideName; this.persist(); });
    const colors = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '8px' } }, ...PRIDE_COLORS.map((c) => el('div', { class: 'gg-swatch' + (c === s.prideColor ? ' on' : ''), style: { background: c }, onclick: () => { s.prideColor = c; this.recolorDens(); this.hud.refreshSide('pride', () => this.pridePanel()); } })));
    const emblems = el('div', { class: 'gg-row', style: { flexWrap: 'wrap', gap: '6px' } }, ...EMBLEMS.map((e) => el('button', { class: 'gg-chip' + (e === s.prideEmblem ? ' on' : ''), style: { fontSize: '16px', minWidth: '40px' }, onclick: () => { s.prideEmblem = e; this.hud.refreshSide('pride', () => this.pridePanel()); } }, e)));
    const members = el('div', { class: 'gg-col', style: { gap: '10px' } },
      el('div', { class: 'gg-row', style: { justifyContent: 'space-between' } }, el('span', { style: { fontWeight: '600' } }, this.char.name + ' (you)'), el('span', { class: 'gg-chip on' }, 'Leader')),
      ...this.pride.map((a) => {
        const m = this.saveOf(a);
        const sel = el('select', { class: 'gg-input', style: { width: '120px', padding: '7px 10px', fontSize: '13px' } }) as HTMLSelectElement;
        for (const r of ROLES.slice(1)) sel.append(el('option', { value: r, selected: r === m.role }, ROLE_LABEL[r]));
        sel.addEventListener('change', () => { m.role = sel.value; a.role = sel.value; this.persist(); });
        return el('div', { class: 'gg-row', style: { justifyContent: 'space-between' } },
          el('div', {}, el('div', { style: { fontWeight: '600', fontSize: '14px' } }, m.config.name), el('div', { style: { fontSize: '11px', color: 'var(--gg-cream-dim)', letterSpacing: '.08em' } }, `${m.config.species.toUpperCase()} · ${m.config.lifeStage.toUpperCase()}`)), sel);
      }));
    return el('div', { class: 'gg-scroll', style: { padding: '20px 22px', height: '100%' } },
      el('div', { class: 'gg-title', style: { fontSize: '28px', marginBottom: '16px' } }, 'Pride'),
      el('div', { class: 'gg-label', style: { marginBottom: '8px' } }, 'Name'), name,
      el('div', { class: 'gg-label', style: { margin: '16px 0 8px' } }, 'Colour'), colors,
      el('div', { class: 'gg-label', style: { margin: '16px 0 8px' } }, 'Emblem'), emblems,
      el('div', { class: 'gg-label', style: { margin: '20px 0 10px' } }, `Members (${this.pride.length + 1})`), members,
      el('div', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)', marginTop: '16px', lineHeight: '1.5' } }, 'Your pride follows you, rests when you rest, answers your roar and joins your hunts. Crouch near a herd to start a hunt together.'));
  }
  private recolorDens() { for (const d of this.dens.values()) d.setColor(this.save.prideColor); }
  private buildTimeControl() {
    const g = this.game;
    const b = (label: string | HTMLElement, speed: number) => el('button', { class: 'gg-chip', 'data-s': speed, style: { padding: '5px 9px', fontSize: '11px' }, onclick: () => {
      if (speed === 0) g.paused = !g.paused; else { g.paused = false; g.gw.env.timeSpeed = speed; this.save.timeSpeed = speed; }
    } }, label);
    this.uiTime = el('div', { class: 'gg-row gg-idlefade', style: { position: 'absolute', left: '20px', top: g.settings.survival ? '126px' : '44px', gap: '5px' } }, b(icon('pause', 12), 0), b('1×', 1), b('4×', 4), b('16×', 16));
    this.hud.root.append(this.uiTime);
  }
  // ---------------- persistence ----------------
  persist = () => {
    const g = this.game, p = g.player, s = this.save;
    if (!p) return;
    s.x = p.pos.x; s.z = p.pos.z; s.yaw = p.yaw; s.hunger = p.hunger; s.thirst = p.thirst; s.hour = g.gw.env.time;
    for (const a of this.pride) { const m = this.saveOf(a); m.x = a.e.pos.x; m.z = a.e.pos.z; }
    Saves.saveSolo(s);
  };
  dispose() {
    this.persist();
    removeEventListener('keydown', this.onKey);
    removeEventListener('pagehide', this.persist);
    document.removeEventListener('visibilitychange', this.onVis);
    for (const a of this.pride) this.game.removeEntity(a.e);
    for (const r of this.rivals) for (const a of r.cats) if (this.game.entities.includes(a.e)) this.game.removeEntity(a.e);
    for (const d of this.dens.values()) d.dispose();
    this.uiTime.remove();
  }
}
