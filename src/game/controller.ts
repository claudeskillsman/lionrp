import * as THREE from 'three';
import type { Game } from './game';
import type { CatEntity } from './entity';
import type { PoseName } from '../cat/catRig';
import { POSE_DURATION } from '../cat/catRig';
import { WATER_LEVEL } from '../world/worldgen';

export type ContextAction =
  | { kind: 'drink' } | { kind: 'climb' } | { kind: 'descend' } | { kind: 'pounce'; dist: number }
  | { kind: 'eat' } | { kind: 'cat'; target: CatEntity } | { kind: 'drop' } | { kind: 'custom'; label: string; run: () => void } | null;

export const EMOTES: { pose: PoseName; label: string; key: string }[] = [
  { pose: 'sit', label: 'Sit', key: '1' }, { pose: 'lie', label: 'Lie down', key: '2' }, { pose: 'sleep', label: 'Sleep', key: '3' },
  { pose: 'groom', label: 'Groom', key: '4' }, { pose: 'roar', label: 'Roar', key: '5' }, { pose: 'growl', label: 'Growl', key: '6' },
  { pose: 'nuzzle', label: 'Nuzzle', key: '7' }, { pose: 'playbow', label: 'Play-bow', key: '8' }, { pose: 'stretch', label: 'Stretch', key: '9' },
];

export type SocialAct = 'groomOther' | 'nuzzle' | 'carry' | 'playfight' | 'drop';

/** Turns input into the player cat's intent, and runs context actions (drink, hunt, climb, social). */
export class PlayerController {
  context: ContextAction = null;
  eatTimer = 0;
  drinkTimer = 0;
  pounceT = -1;
  lastCatch: string | null = null;
  onEmote: ((pose: PoseName) => void) | null = null;
  onSocial: ((act: SocialAct, target: CatEntity) => void) | null = null;
  onCatch: ((kind: string) => void) | null = null;
  onDrink: (() => void) | null = null;
  onRoar: ((e: CatEntity) => void) | null = null;
  private killSpot: THREE.Vector3 | null = null;
  /** Modes can offer extra context actions (claiming a den, joining a pride...). */
  extra: (() => { label: string; run: () => void } | null) | null = null;
  constructor(private game: Game) {}
  get p() { return this.game.player!; }

  update(dt: number) {
    const g = this.game, p = g.player, inp = g.input;
    if (!p || g.state !== 'play') return;
    // ---- movement intent, camera-relative ----
    const a = inp.axes();
    const f = g.follow.forward();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const dir = new THREE.Vector3().addScaledVector(f, a.y).addScaledVector(r, a.x);
    const mag = Math.min(1, Math.hypot(a.x, a.y));
    const it = p.intent;
    it.x = dir.x; it.z = dir.z; it.mag = mag;
    it.sprint = inp.down('sprint');
    it.crouch = inp.down('crouch') || this.touchCrouch;
    it.walk = inp.down('walk');
    it.jump = inp.hit('jump');
    if (this.pounceT >= 0) { it.mag = 1; it.x = Math.sin(p.yaw); it.z = Math.cos(p.yaw); it.sprint = true; it.crouch = false; it.jump = false; }
    // ---- climbing trees: jump at a tree climbs it ----
    if (it.jump && !p.climbing && g.props.nearestTree(p.pos.x, p.pos.z, 1.4 + p.size * 0.8) && p.speed < 6) {
      if (p.tryClimb(g.props)) it.jump = false;
    }
    // ---- emote hotkeys ----
    for (const e of EMOTES) if (inp.keys.has('Digit' + e.key) && inp.pressed.has('Digit' + e.key)) this.emote(e.pose);
    // ---- timed actions ----
    if (this.drinkTimer > 0) {
      this.drinkTimer -= dt;
      p.thirst = Math.min(100, p.thirst + dt * 14);
      if (p.pose !== 'drink') this.drinkTimer = 0;
      else if (this.drinkTimer <= 0) p.setPose(null);
    }
    if (this.eatTimer > 0) {
      this.eatTimer -= dt;
      p.hunger = Math.min(100, p.hunger + dt * 10);
      if (p.pose !== 'eat') this.eatTimer = 0;
      else if (this.eatTimer <= 0) p.setPose(null);
    }
    // pounce: crouch, spring, and a reach check at the end of the leap
    if (this.pounceT >= 0) {
      this.pounceT += dt;
      if (this.pounceT > 0.18 && this.pounceT - dt <= 0.18) { p.vy = 5.5 * Math.sqrt(p.size); p.onGround = false; p.speed = Math.max(p.speed, p.sprintSpeed * 0.9); }
      if (this.pounceT > 0.35 && p.onGround) {
        const head = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(1.1 * p.size).add(p.pos);
        const kind = g.fauna.tryCatch(head, 2.4 * p.size);
        this.pounceT = -1;
        p.cat.rig.setPose(null);
        if (kind) {
          this.killSpot = head.clone();
          this.lastCatch = kind;
          this.onCatch?.(kind);
          g.audio.call('growl', p.pos, p.size);
          p.speed = 0;
          p.setPose('eat'); this.eatTimer = 7;
        }
      }
    }
    if (this.killSpot && p.pos.distanceTo(this.killSpot) > 30) this.killSpot = null;
    // carrying a cub
    p.cat.rig.carrying = !!p.carried;
    // ---- context ----
    this.context = this.findContext();
    if (inp.hit('interact') || this.touchAct) this.act();
    this.touchAct = false;
  }
  touchAct = false;
  touchCrouch = false;

  private findContext(): ContextAction {
    const g = this.game, p = g.player!;
    if (p.carried) return { kind: 'drop' };
    if (p.climbing) return p.climbing.perched ? { kind: 'descend' } : null;
    if (p.swimming) return null;
    const ex = this.extra?.();
    if (ex) return { kind: 'custom', ...ex };
    // other cats close by
    let best: CatEntity | null = null, bd = 2.6 * p.size;
    for (const e of g.entities) {
      if (e === p || e.carriedBy || !e.object.visible) continue;
      const d = e.pos.distanceTo(p.pos);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) return { kind: 'cat', target: best };
    if (this.killSpot && p.pos.distanceTo(this.killSpot) < 3 * p.size && p.hunger < 99) return { kind: 'eat' };
    // water ahead of the nose
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    for (const d of [0.9, 1.4, 2.0]) {
      const h = g.world.height(p.pos.x + fx * d * p.size, p.pos.z + fz * d * p.size);
      if (h < WATER_LEVEL - 0.02) return { kind: 'drink' };
    }
    // prey in range while stalking or running
    const prey = g.fauna.nearestPrey(p.pos, 11 * p.size);
    if (prey && (p.cat.rig.crouch > 0.5 || p.speed > 5)) {
      const to = new THREE.Vector3().subVectors(prey.pos, p.pos); to.y = 0;
      const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(to.x, to.z) - p.yaw), Math.cos(Math.atan2(to.x, to.z) - p.yaw)));
      if (ang < 0.7) return { kind: 'pounce', dist: prey.dist };
    }
    if (g.props.nearestTree(p.pos.x, p.pos.z, 1.4 + p.size * 0.8)) return { kind: 'climb' };
    return null;
  }

  act() {
    const g = this.game, p = g.player!, c = this.context;
    if (!c) return;
    switch (c.kind) {
      case 'drink':
        p.speed = 0; p.setPose('drink'); this.drinkTimer = 5; this.onDrink?.();
        break;
      case 'eat':
        p.setPose('eat'); this.eatTimer = 7;
        break;
      case 'climb': p.tryClimb(g.props); break;
      case 'descend': if (p.climbing) p.climbing.up = false; break;
      case 'pounce':
        if (this.pounceT < 0) { p.setPose(null); this.pounceT = 0; p.cat.rig.setPose('pounce'); }
        break;
      case 'drop': this.dropCub(); break;
      case 'custom': c.run(); break;
      case 'cat': break; // the HUD opens the social menu
    }
  }
  setKill(v: THREE.Vector3) { this.killSpot = v.clone(); }
  emote(pose: PoseName) {
    const p = this.game.player; if (!p || p.climbing) return;
    if (p.pose === pose) { p.setPose(null); return; }
    p.speed = 0;
    p.setPose(pose, POSE_DURATION[pose] ?? 0);
    if (pose === 'roar' || pose === 'growl') { this.game.audio.call(pose, p.pos, p.size); this.onRoar?.(p); }
    this.onEmote?.(pose);
  }
  social(act: SocialAct, target: CatEntity) {
    const p = this.game.player!;
    // face each other
    const yaw = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
    p.yaw = yaw; p.syncObject();
    if (act === 'carry') {
      if (target.config.lifeStage !== 'cub' || p.config.lifeStage === 'cub') return false;
      p.carried = target; target.carriedBy = p; target.setPose(null);
    } else if (act === 'playfight') {
      p.setPose('playfight', 6); target.yaw = yaw + Math.PI; target.syncObject(); target.setPose('playfight', 6);
    } else if (act === 'groomOther') {
      p.setPose('groomOther', 8); if (!target.pose) { target.setPose('lie', 8); }
    } else {
      p.setPose('nuzzle', 4); target.yaw = yaw + Math.PI; target.syncObject(); target.setPose('nuzzle', 4);
    }
    this.onSocial?.(act, target);
    return true;
  }
  dropCub() {
    const p = this.game.player!; const c = p.carried; if (!c) return;
    p.carried = null; c.carriedBy = null;
    this.onSocial?.('drop', c);
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    c.place(p.pos.x + fx * 1.2 * p.size, p.pos.z + fz * 1.2 * p.size, this.game.world, p.yaw);
  }
  promptText(): string | null {
    const c = this.context; if (!c) return null;
    switch (c.kind) {
      case 'drink': return 'Drink';
      case 'climb': return 'Climb tree';
      case 'descend': return 'Climb down';
      case 'pounce': return 'Pounce';
      case 'eat': return 'Eat';
      case 'drop': return 'Put down cub';
      case 'cat': return 'Interact with ' + c.target.config.name;
      case 'custom': return c.label;
    }
  }
}
