import * as THREE from 'three';
import type { Game } from './game';
import { CatEntity } from './entity';
import type { CatConfig } from '../cat/catConfig';
import type { PoseName } from '../cat/catRig';

export type AiState = 'follow' | 'rest' | 'hunt' | 'eat' | 'emote' | 'patrol' | 'retreat' | 'wander' | 'drink';

/** Shared steering + state for computer-controlled cats (pride members and rivals). */
export class AiCat {
  e: CatEntity;
  state: AiState = 'follow';
  t = 0;
  target = new THREE.Vector3();
  slot: number;
  restPose: PoseName = 'lie';
  pendingEmote: { pose: PoseName; delay: number; dur: number } | null = null;
  huntPrey: THREE.Vector3 | null = null;
  stuckT = 0;
  private lastPos = new THREE.Vector3();
  constructor(public game: Game, cfg: CatConfig, public role: string, x: number, z: number) {
    const q = game.quality;
    this.e = new CatEntity(cfg, { shells: q.furShells, a2c: q.msaa > 0, voxel: q.name === 'ultra' ? 0.016 : 0.021 });
    this.e.place(x, z, game.world, Math.random() * Math.PI * 2);
    this.slot = Math.random() * Math.PI * 2;
    this.e.hunger = 60 + Math.random() * 40;
  }
  /** Steer toward a point. Returns distance remaining. */
  moveTo(p: THREE.Vector3, arrive = 1.5, opts: { run?: boolean; sprint?: boolean; crouch?: boolean; walk?: boolean } = {}) {
    const it = this.e.intent;
    const dx = p.x - this.e.pos.x, dz = p.z - this.e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < arrive) { it.mag = 0; it.sprint = false; it.crouch = !!opts.crouch; return d; }
    it.x = dx / d; it.z = dz / d;
    it.mag = opts.walk ? 0.45 : opts.run || opts.sprint ? 1 : THREE.MathUtils.clamp(d / 6, 0.35, 1);
    it.sprint = !!opts.sprint;
    it.crouch = !!opts.crouch;
    it.walk = !!opts.walk;
    // getting stuck on rocks or a steep bank: sidestep
    if (this.e.pos.distanceTo(this.lastPos) < 0.02 && it.mag > 0.3 && !this.e.pose) this.stuckT += 1 / 60; else this.stuckT = Math.max(0, this.stuckT - 1 / 30);
    this.lastPos.copy(this.e.pos);
    if (this.stuckT > 1.2) { const s = Math.sign(Math.sin(this.slot * 7)) || 1; it.x = -dz / d * s; it.z = dx / d * s; it.jump = this.stuckT > 1.6; if (this.stuckT > 2.2) this.stuckT = 0; }
    return d;
  }
  stop() { const it = this.e.intent; it.mag = 0; it.sprint = false; it.jump = false; it.crouch = false; }
  emote(pose: PoseName, delay = 0, dur = 0) { this.pendingEmote = { pose, delay, dur }; }
  /** Per-frame housekeeping: delayed emotes. Returns true while an emote is playing. */
  tickEmote(dt: number) {
    const pe = this.pendingEmote;
    this.e.intent.jump = false;
    if (pe) {
      pe.delay -= dt;
      if (pe.delay <= 0) {
        this.pendingEmote = null;
        this.stop();
        this.e.speed = 0;
        this.e.setPose(pe.pose, pe.dur);
        if (pe.pose === 'roar' || pe.pose === 'growl') this.game.audio.call(pe.pose, this.e.pos, this.e.size);
      }
    }
    return !!this.e.pose && this.e.poseTimer > 0;
  }
  faceTo(p: THREE.Vector3) { this.e.yaw = Math.atan2(p.x - this.e.pos.x, p.z - this.e.pos.z); this.e.syncObject(); }
}
