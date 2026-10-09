import * as THREE from 'three';
import { Cat, CatBuildOptions } from '../cat/cat';
import { CatConfig, LIFE_STAGES, SPECIES } from '../cat/catConfig';
import type { PoseName } from '../cat/catRig';
import { World, WATER_LEVEL, PLAY_LIMIT } from '../world/worldgen';
import type { Props } from '../world/props';

export interface MoveIntent { x: number; z: number; mag: number; sprint: boolean; crouch: boolean; walk: boolean; jump: boolean; }
const SPRINT: Record<string, number> = { lion: 13, lioness: 15, cheetah: 24, leopard: 15, snowleopard: 14, tiger: 14, jaguar: 13 };

/** A cat in the world: model + physics + needs. Used for the player, AI cats and remote players. */
export class CatEntity {
  cat: Cat;
  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  vy = 0;
  onGround = true;
  swimming = false;
  climbing: null | { t: number; tree: { x: number; z: number; y: number; canopyY: number }; up: boolean; perched: boolean } = null;
  intent: MoveIntent = { x: 0, z: 0, mag: 0, sprint: false, crouch: false, walk: false, jump: false };
  pose: PoseName | null = null;
  poseTimer = 0;
  hunger = 85; thirst = 85; stamina = 1;
  size: number;
  height: number;
  turnRate = 0;
  lastStep = 0;
  onStep: ((e: CatEntity, surface: string) => void) | null = null;
  footPhaseLast = 0;
  carried: CatEntity | null = null;
  carriedBy: CatEntity | null = null;
  /** Remote players: driven by network snapshots instead of physics. */
  remote: null | { id: string; buf: { t: number; x: number; y: number; z: number; yaw: number; s: number; c: number; a: number; w: number; po: string | null }[] } = null;
  constructor(public config: CatConfig, opts: CatBuildOptions = {}) {
    this.cat = new Cat(config, opts);
    this.size = this.cat.shape.scale;
    this.height = 1.0 * this.size;
  }
  get object() { return this.cat.group; }
  get walkSpeed() { return 1.45 * Math.sqrt(this.size) * LIFE_STAGES[this.config.lifeStage].energy ** 0.3; }
  get runSpeed() { return 4.6 * Math.sqrt(this.size); }
  get sprintSpeed() { const ls = LIFE_STAGES[this.config.lifeStage]; return SPRINT[this.config.species] * Math.sqrt(this.size) * (ls.energy > 1 ? 0.8 : ls.energy); }
  setPose(p: PoseName | null, duration = 0) {
    this.pose = p; this.poseTimer = duration;
    this.cat.rig.setPose(p);
  }
  place(x: number, z: number, world: World, yaw = this.yaw) {
    this.pos.set(x, world.height(x, z), z); this.yaw = yaw; this.speed = 0; this.vy = 0;
    this.syncObject();
  }
  update(dt: number, world: World, props: Props | null, survival = true) {
    const it = this.intent;
    if (this.carriedBy) {
      // dangling from a parent's jaw
      const p = this.carriedBy;
      const head = p.cat.bones.get('jaw')!;
      const v = new THREE.Vector3(0, -0.05, 0.12); head.localToWorld(v);
      this.pos.copy(v).add(new THREE.Vector3(0, -0.35 * this.size, 0));
      this.yaw = p.yaw + Math.PI / 2;
      this.syncObject();
      this.cat.rig.speed = 0; this.cat.rig.airborne = true; this.cat.rig.vy = 0;
      this.cat.update(dt);
      return;
    }
    // ---- poses: any movement input breaks them ----
    if (this.pose && (it.mag > 0.2 || it.jump)) this.setPose(null);
    if (this.pose && this.poseTimer > 0) { this.poseTimer -= dt; if (this.poseTimer <= 0) this.setPose(null); }

    // ---- climbing trees ----
    if (this.climbing) { this.updateClimb(dt, world); return; }

    // ---- locomotion ----
    const ground = world.height(this.pos.x, this.pos.z);
    const waterDepth = WATER_LEVEL - ground;
    const swimDepth = 0.55 * this.size;
    this.swimming = waterDepth > swimDepth && this.pos.y < WATER_LEVEL + 0.2;
    let target = 0;
    if (it.mag > 0.05) {
      if (this.swimming) target = 1.4 * Math.sqrt(this.size);
      else if (it.crouch) target = 1.0 * Math.sqrt(this.size) * it.mag;
      else if (it.sprint && this.stamina > 0.05) target = this.sprintSpeed;
      else if (it.walk || it.mag < 0.6) target = this.walkSpeed * Math.max(0.5, it.mag / 0.6);
      else target = this.runSpeed;
      // desired heading
      const desired = Math.atan2(it.x, it.z);
      let d = desired - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxTurn = (this.speed > 8 ? 2.2 : 4.2) * dt;
      const turn = THREE.MathUtils.clamp(d, -maxTurn, maxTurn);
      this.yaw += turn;
      this.turnRate = turn / dt;
      // slow down for sharp turns
      target *= 1 - Math.min(0.7, Math.abs(d) / Math.PI);
    } else this.turnRate *= 0.8;
    if (this.pose) target = 0;
    // slope handling: steep ground slows, very steep blocks (cats can scramble up rocks)
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const ahead = world.height(this.pos.x + fwd.x * 1.2 * this.size, this.pos.z + fwd.z * 1.2 * this.size);
    const grade = (ahead - ground) / (1.2 * this.size);
    if (grade > 0.5 && this.onGround) target *= THREE.MathUtils.clamp(1.6 - grade, 0.12, 1);
    if (grade > 2.4 && this.onGround) target = 0;
    const accel = target > this.speed ? (this.speed > 6 ? 7 : 10) : 14;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -accel * dt, accel * dt);
    // stamina
    const sprinting = it.sprint && this.speed > this.runSpeed * 1.1;
    this.stamina = THREE.MathUtils.clamp(this.stamina + (sprinting ? -dt / 9 : dt / 6), 0, 1);
    if (survival) {
      const rate = sprinting ? 3 : 1;
      this.hunger = Math.max(0, this.hunger - dt * 0.05 * rate);
      this.thirst = Math.max(0, this.thirst - dt * 0.07 * rate);
    }
    // integrate
    this.pos.x += fwd.x * this.speed * dt;
    this.pos.z += fwd.z * this.speed * dt;
    // world bounds (soft)
    const lim = PLAY_LIMIT;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);
    let gy = world.height(this.pos.x, this.pos.z);
    if (props) {
      const rockTop = props.collide(this.pos, 0.35 * this.size, this.pos.y);
      if (rockTop !== null) gy = Math.max(gy, rockTop);
      gy = Math.max(gy, world.height(this.pos.x, this.pos.z));
    }
    // jumping & gravity
    if (it.jump && this.onGround && !this.swimming && !this.pose) {
      this.vy = 5.2 * Math.sqrt(Math.max(0.5, this.size)) * (this.config.lifeStage === 'cub' ? 0.75 : 1);
      this.onGround = false;
    }
    if (this.swimming) {
      const wy = WATER_LEVEL - 0.62 * this.height;
      this.pos.y += (wy - this.pos.y) * Math.min(1, dt * 5);
      this.vy = 0; this.onGround = true;
    } else if (!this.onGround || this.pos.y > gy + 0.05) {
      this.vy -= 18 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gy) { this.pos.y = gy; this.vy = 0; this.onGround = true; }
      else this.onGround = false;
    } else {
      // follow the ground smoothly (steps up rocks)
      this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 18);
      this.onGround = true;
    }
    this.syncObject();
    const rig = this.cat.rig;
    rig.speed = this.speed;
    rig.turnRate = this.turnRate;
    rig.crouch += ((it.crouch && !this.swimming ? 1 : 0) - rig.crouch) * Math.min(1, dt * 5);
    rig.airborne = !this.onGround;
    rig.vy = this.vy;
    rig.swimming = this.swimming;
    rig.tired = Math.max(0, 0.35 - this.stamina) * 2.5;
    rig.groundFn = (x, z) => {
      let h = world.height(x, z);
      if (props) { const c = props.collide(new THREE.Vector3(x, 0, z), 0, this.pos.y + 0.3); if (c !== null) h = Math.max(h, c); }
      return h;
    };
    this.cat.update(dt);
    // footstep events from gait phase
    const ph = rig.phase;
    if (this.onGround && this.speed > 0.3 && ((ph < 0.5) !== (this.footPhaseLast < 0.5))) {
      this.onStep?.(this, this.swimming ? 'water' : waterDepth > -0.1 ? 'mud' : world.slope(this.pos.x, this.pos.z) > 0.5 ? 'rock' : 'grass');
    }
    this.footPhaseLast = ph;
  }
  private updateClimb(dt: number, world: World) {
    const c = this.climbing!;
    const tr = c.tree;
    const topY = tr.y + tr.canopyY - 1.0;
    if (c.up) {
      c.t = Math.min(1, c.t + dt / 1.6);
      const e = c.t * c.t * (3 - 2 * c.t);
      this.pos.set(tr.x + Math.sin(this.yaw) * -0.5, tr.y + (topY - tr.y) * e, tr.z + Math.cos(this.yaw) * -0.5);
      if (c.t >= 1) { c.perched = true; }
      this.cat.rig.airborne = c.t < 1; this.cat.rig.vy = 3;
      if (c.perched && this.intent.jump) { c.up = false; }
      if (c.perched && !this.pose) this.setPose('lie');
    } else {
      c.t = Math.max(0, c.t - dt / 1.0);
      const e = c.t * c.t;
      const out = 1 - c.t;
      this.pos.set(tr.x + Math.sin(this.yaw) * (out * 2.2), tr.y + (topY - tr.y) * e, tr.z + Math.cos(this.yaw) * (out * 2.2));
      if (this.pose) this.setPose(null);
      this.cat.rig.airborne = true; this.cat.rig.vy = -3;
      if (c.t <= 0) { this.climbing = null; this.pos.y = world.height(this.pos.x, this.pos.z); this.onGround = true; }
    }
    this.speed = 0;
    this.syncObject();
    this.cat.rig.speed = 0;
    this.cat.update(dt);
  }
  /** Interpolate network snapshots ~150 ms in the past and animate. */
  updateRemote(dt: number, world: World) {
    const r = this.remote!;
    const now = performance.now() - 150;
    const b = r.buf;
    while (b.length > 2 && b[1].t <= now) b.shift();
    let x, y, z, yaw, s, c, a, w, po;
    if (b.length >= 2 && b[0].t <= now) {
      const A = b[0], B = b[1];
      const f = Math.min(1.3, (now - A.t) / Math.max(1, B.t - A.t));
      x = A.x + (B.x - A.x) * f; y = A.y + (B.y - A.y) * Math.min(1, f); z = A.z + (B.z - A.z) * f;
      let dy = B.yaw - A.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yaw = A.yaw + dy * Math.min(1, f); s = B.s; c = B.c; a = B.a; w = B.w; po = f < 0.5 ? A.po : B.po;
    } else if (b.length) {
      const A = b[b.length - 1];
      x = A.x; y = A.y; z = A.z; yaw = A.yaw; s = A.s; c = A.c; a = A.a; w = A.w; po = A.po;
    } else return;
    const prevYaw = this.yaw, prevY = this.pos.y;
    // smooth toward the target to hide jitter
    const k = Math.min(1, dt * 14);
    if (this.pos.distanceToSquared(new THREE.Vector3(x, y, z)) > 100) this.pos.set(x, y, z);
    else { this.pos.x += (x - this.pos.x) * k; this.pos.y += (y - this.pos.y) * k; this.pos.z += (z - this.pos.z) * k; }
    let dyaw = yaw - this.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += dyaw * k;
    this.speed = s;
    if ((po ?? null) !== this.pose) this.setPose((po as PoseName) ?? null);
    this.syncObject();
    const rig = this.cat.rig;
    let tr = this.yaw - prevYaw; tr = Math.atan2(Math.sin(tr), Math.cos(tr));
    rig.speed = s; rig.turnRate = dt > 0 ? tr / dt : 0;
    rig.crouch += (c - rig.crouch) * Math.min(1, dt * 5);
    rig.airborne = a > 0; rig.vy = dt > 0 ? (this.pos.y - prevY) / dt : 0;
    rig.swimming = w > 0; this.swimming = w > 0;
    rig.carrying = !!this.carried;
    rig.groundFn = (gx, gz) => world.height(gx, gz);
    this.cat.update(dt);
    const ph = rig.phase;
    if (!rig.airborne && s > 0.3 && ((ph < 0.5) !== (this.footPhaseLast < 0.5))) this.onStep?.(this, w ? 'water' : world.height(this.pos.x, this.pos.z) < WATER_LEVEL + 0.1 ? 'mud' : world.slope(this.pos.x, this.pos.z) > 0.5 ? 'rock' : 'grass');
    this.footPhaseLast = ph;
  }
  tryClimb(props: Props | null) {
    if (!props || this.climbing || this.swimming) return false;
    const t = props.nearestTree(this.pos.x, this.pos.z, 1.8 + this.size);
    if (!t) return false;
    if (this.config.species === 'cheetah' && this.config.lifeStage === 'adult') { /* cheetahs can still climb low trees */ }
    this.yaw = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
    this.climbing = { t: 0, tree: t, up: true, perched: false };
    return true;
  }
  syncObject() {
    this.cat.group.position.copy(this.pos);
    this.cat.group.rotation.set(0, this.yaw, 0);
  }
  dispose() { this.cat.dispose(); }
}
export { SPECIES };
