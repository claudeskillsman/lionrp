import * as THREE from 'three';
import type { Cat } from './cat';
import { LIFE_STAGES } from './catConfig';

export type PoseName = 'sit' | 'lie' | 'sleep' | 'groom' | 'roar' | 'growl' | 'nuzzle' | 'playbow' | 'stretch' | 'pounce' | 'drink' | 'eat' | 'carry' | 'playfight' | 'groomOther';
export const POSE_DURATION: Partial<Record<PoseName, number>> = { roar: 3.0, stretch: 3.6, pounce: 1.1, playfight: 0 };

interface Params {
  hipsY: number; hipsZ: number; hipsPitch: number; hipsRoll: number; hipsYaw: number;
  spinePitch: number; spineYaw: number; spineRoll: number;
  neckPitch: number; neckYaw: number; headPitch: number; headYaw: number; headRoll: number;
  jaw: number; earsBack: number; earsUp: number; tailLift: number; tailCurl: number; tailWag: number; tailWagF: number;
  eyes: number; scap: number; breath: number;
}
const ZERO = (): Params => ({ hipsY: 0, hipsZ: 0, hipsPitch: 0, hipsRoll: 0, hipsYaw: 0, spinePitch: 0, spineYaw: 0, spineRoll: 0, neckPitch: 0, neckYaw: 0, headPitch: 0, headYaw: 0, headRoll: 0, jaw: 0, earsBack: 0, earsUp: 0, tailLift: 0, tailCurl: 0, tailWag: 0, tailWagF: 1, eyes: 0, scap: 0, breath: 1 });
function lerpP(a: Params, b: Params, t: number, out: Params) {
  for (const k in a) (out as any)[k] = (a as any)[k] + ((b as any)[k] - (a as any)[k]) * t;
  return out;
}
type FootMode = 'stand' | 'flat' | 'hockDown' | 'free';
interface FootTarget { p: THREE.Vector3; mode: FootMode; ground: boolean; lift: number; }

const LEGS = [
  { name: 'FL', front: true, side: 1, chain: ['scapL', 'humL', 'foreL', 'carpL', 'fpawL'] },
  { name: 'FR', front: true, side: -1, chain: ['scapR', 'humR', 'foreR', 'carpR', 'fpawR'] },
  { name: 'HL', front: false, side: 1, chain: ['femL', 'tibL', 'tarL', 'hpawL'] },
  { name: 'HR', front: false, side: -1, chain: ['femR', 'tibR', 'tarR', 'hpawR'] },
] as const;

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();

export class CatRig {
  // inputs
  speed = 0; // world m/s, forward
  turnRate = 0; // rad/s
  crouch = 0;
  airborne = false; vy = 0;
  swimming = false;
  sprinting = false;
  pose: PoseName | null = null;
  poseTime = 0;
  poseWeight = 0;
  lookYaw = 0; lookPitch = 0;
  groundFn: ((x: number, z: number) => number) | null = null;
  tired = 0;
  carrying = false;
  // state
  phase = 0;
  time = Math.random() * 100;
  private names: string[];
  private idx = new Map<string, number>();
  private parent: number[] = [];
  private restLocal: THREE.Vector3[] = [];
  private restModel: THREE.Vector3[] = [];
  private localQ: THREE.Quaternion[] = [];
  private worldQ: THREE.Quaternion[] = [];
  private worldP: THREE.Vector3[] = [];
  private offset: THREE.Vector3[] = [];
  private bones: THREE.Bone[];
  private p: Params = ZERO();
  private loco: Params = ZERO();
  private poseP: Params = ZERO();
  private blink = 0; private blinkT = 2;
  private earT = [1, 2]; private earFlick = [0, 0];
  private tailState: { yaw: number; vel: number }[] = [];
  private footW: THREE.Vector3[] = [v3(), v3(), v3(), v3()];
  private footPrev: THREE.Vector3[] = [v3(), v3(), v3(), v3()];
  private gaitW = { walk: 1, trot: 0, gallop: 0 };
  private bob = 0;
  private energy: number;
  private smoothedSpeed = 0;
  private prevPose: PoseName | null = null;
  private poseFeet: (FootTarget | null)[] = [null, null, null, null];
  private hockTargets: (THREE.Vector3 | null)[] = [null, null, null, null];
  private pawRot: number[] = [0, 0, 0, 0];
  private L: number;
  private H: number;
  private scale: number;
  constructor(public cat: Cat) {
    const shape = cat.shape;
    this.bones = shape.bones.map((b) => cat.bones.get(b.name)!);
    this.names = shape.bones.map((b) => b.name);
    shape.bones.forEach((b, i) => {
      this.idx.set(b.name, i);
      this.parent.push(b.parent ? shape.bones.findIndex((x) => x.name === b.parent) : -1);
      this.restModel.push(new THREE.Vector3(...b.pos));
      this.restLocal.push(this.bones[i].position.clone());
      this.localQ.push(new THREE.Quaternion());
      this.worldQ.push(new THREE.Quaternion());
      this.worldP.push(new THREE.Vector3());
      this.offset.push(new THREE.Vector3());
    });
    for (let i = 0; i < shape.tailBones.length; i++) this.tailState.push({ yaw: 0, vel: 0 });
    this.L = Math.abs(this.restModel[this.i('fpawL')].z - this.restModel[this.i('hpawL')].z);
    this.H = shape.spineH;
    this.scale = shape.scale;
    this.energy = LIFE_STAGES[cat.config.lifeStage].energy;
  }
  private i(n: string) { return this.idx.get(n)!; }

  setPose(p: PoseName | null) {
    if (p === this.pose) return;
    this.prevPose = this.pose;
    this.pose = p;
    this.poseTime = 0;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const t = this.time;
    const sc = this.scale;
    const uSpeed = this.speed / sc; // speed in rig units
    this.smoothedSpeed += (uSpeed - this.smoothedSpeed) * Math.min(1, dt * 6);
    const v = this.smoothedSpeed;
    const av = Math.abs(v);
    const turn = this.turnRate;

    // --- gait selection (continuous) ---
    const targetW = av < 1.7 ? { walk: 1, trot: 0, gallop: 0 } : av < 4.2 ? { walk: 0, trot: 1, gallop: 0 } : { walk: 0, trot: 0, gallop: 1 };
    const k = Math.min(1, dt * 4);
    this.gaitW.walk += (targetW.walk - this.gaitW.walk) * k;
    this.gaitW.trot += (targetW.trot - this.gaitW.trot) * k;
    this.gaitW.gallop += (targetW.gallop - this.gaitW.gallop) * k;
    const gw = this.gaitW;
    const en = this.energy;
    const freq = (gw.walk * (0.55 + 0.32 * av) + gw.trot * (1.15 + 0.12 * av) + gw.gallop * (1.75 + 0.05 * av)) * (0.85 + 0.15 * en) * (1 - this.crouch * 0.35);
    const moving = av > 0.05 || Math.abs(turn) > 0.25;
    const stepAmt = Math.min(1, Math.max(av / 0.4, Math.abs(turn) / 0.8));
    if (moving) this.phase = (this.phase + dt * Math.max(freq, Math.abs(turn) * 0.7)) % 1;
    const duty = gw.walk * 0.66 + gw.trot * 0.5 + gw.gallop * 0.36;
    const period = 1 / Math.max(0.3, freq);
    let stride = Math.max(av * period * duty, Math.abs(turn) * 0.18);
    stride = Math.min(stride, this.L * 1.4);
    const lift = (gw.walk * 0.07 + gw.trot * 0.12 + gw.gallop * 0.2) * (1 - this.crouch * 0.4) * stepAmt;
    // phase offsets [FL, FR, HL, HR] blended walk -> trot -> rotary gallop
    const off = [
      gw.walk * 0.25 + gw.trot * 0.5 + gw.gallop * 0.62,
      gw.walk * 0.75 + gw.trot * 1.0 + gw.gallop * 1.5,
      0,
      gw.walk * 0.5 + gw.trot * 0.5 + gw.gallop * 0.12,
    ];

    // --- locomotion params ---
    const P = this.loco;
    Object.assign(P, ZERO());
    const ph = this.phase * Math.PI * 2;
    const bobAmp = (gw.walk * 0.012 + gw.trot * 0.03 + gw.gallop * 0.05) * stepAmt * (0.8 + 0.4 * en);
    P.hipsY = -Math.abs(Math.sin(ph)) * bobAmp * 2 + bobAmp - this.crouch * this.H * 0.3;
    P.hipsPitch = gw.gallop * Math.sin(ph) * 0.12 * stepAmt + this.crouch * 0.06;
    P.spinePitch = gw.gallop * Math.sin(ph + 0.6) * 0.22 * stepAmt; // flexion/extension
    P.hipsRoll = gw.walk * Math.sin(ph) * 0.03 * stepAmt;
    P.spineYaw = THREE.MathUtils.clamp(turn * 0.12, -0.3, 0.3);
    P.spineRoll = -THREE.MathUtils.clamp(turn * av * 0.03, -0.2, 0.2);
    P.neckPitch = 0.05 + this.crouch * 0.35 + gw.gallop * 0.1 * stepAmt - (1 - stepAmt) * 0.05;
    P.headPitch = -P.neckPitch * 0.7 - P.hipsPitch + this.crouch * 0.1;
    P.neckYaw = THREE.MathUtils.clamp(this.lookYaw * 0.4 + turn * 0.1, -0.5, 0.5);
    P.headYaw = THREE.MathUtils.clamp(this.lookYaw * 0.5, -0.6, 0.6);
    P.headPitch += this.lookPitch;
    if (this.cat.config.lifeStage === 'elder') { P.neckPitch += 0.12; P.headPitch -= 0.06; }
    P.tailLift = gw.gallop * 0.35 * stepAmt + gw.trot * 0.15 - this.crouch * 0.1;
    P.tailCurl = 0.35 - gw.gallop * 0.3 + (1 - stepAmt) * 0.25;
    P.tailWag = 0.08 + this.crouch * 0.05;
    P.tailWagF = 0.5;
    P.scap = this.crouch;
    P.earsUp = this.crouch * 0.6;
    P.breath = 1 + gw.gallop * 1.5 + this.tired * 2;
    P.jaw = this.tired * (0.25 + 0.1 * Math.sin(t * 9));
    if (this.carrying) { P.jaw = 0.22; P.neckPitch -= 0.12; P.headPitch += 0.05; }
    if (this.airborne) {
      P.hipsPitch = THREE.MathUtils.clamp(-this.vy * 0.06, -0.4, 0.4);
      P.tailLift = 0.4; P.tailCurl = -0.1;
    }
    if (this.swimming) {
      P.hipsPitch = -0.18; P.neckPitch = -0.35; P.headPitch = 0.3; P.tailLift = 0.25; P.tailCurl = -0.2; P.hipsY = 0;
    }

    // --- pose params ---
    if (this.pose) { this.poseTime += dt; this.poseWeight = Math.min(1, this.poseWeight + dt * 2.2); }
    else this.poseWeight = Math.max(0, this.poseWeight - dt * 2.5);
    const activePose = this.pose ?? this.prevPose;
    for (let i = 0; i < 4; i++) { this.poseFeet[i] = null; this.hockTargets[i] = null; this.pawRot[i] = 0; }
    if (activePose && this.poseWeight > 0) this.computePose(activePose, this.poseP);
    const w = this.poseWeight > 0 && activePose ? smooth(this.poseWeight) : 0;
    lerpP(P, this.poseP, w, this.p);
    const p = this.p;

    // --- blinking, ears ---
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 1; this.blinkT = 1.8 + Math.random() * 4.5; }
    this.blink = Math.max(0, this.blink - dt * 7);
    for (let e = 0; e < 2; e++) {
      this.earT[e] -= dt;
      if (this.earT[e] <= 0) { this.earFlick[e] = 1; this.earT[e] = 2 + Math.random() * 7; }
      this.earFlick[e] = Math.max(0, this.earFlick[e] - dt * 5);
    }

    // --- apply to local rotations ---
    for (const q of this.localQ) q.identity();
    for (const o of this.offset) o.set(0, 0, 0);
    const breathe = Math.sin(t * Math.PI * 2 * 0.25 * p.breath) * 0.012;
    this.setLocal('hips', p.hipsPitch, p.hipsYaw + p.spineYaw * 0.3, p.hipsRoll);
    this.offset[this.i('hips')].set(0, p.hipsY, p.hipsZ);
    this.setLocal('spine1', p.spinePitch * 0.5 - breathe * 0.3, p.spineYaw * 0.5, p.spineRoll * 0.5);
    this.setLocal('spine2', p.spinePitch * 0.3 + breathe, p.spineYaw * 0.5, p.spineRoll * 0.5);
    this.setLocal('chest', p.spinePitch * 0.2 - breathe * 0.5, p.spineYaw * 0.3, 0);
    // neck & head: keep the head steady against body motion
    this.setLocal('neck', p.neckPitch - p.spinePitch * 0.6, p.neckYaw - p.spineYaw * 0.8, 0);
    this.setLocal('head', p.headPitch - p.hipsPitch * 0.3, p.headYaw, p.headRoll);
    this.setLocal('jaw', THREE.MathUtils.clamp(p.jaw, 0, 1) * 0.55, 0, 0);
    // ears: up/forward when alert, flat back when angry, random flicks
    for (const [e, s] of [['earL', 1], ['earR', -1]] as const) {
      const fl = this.earFlick[e === 'earL' ? 0 : 1];
      this.setLocal(e, p.earsBack * 0.9 - p.earsUp * 0.2 - fl * 0.5, s * (p.earsBack * 0.6 + fl * 0.4), s * p.earsBack * 0.3);
    }
    // tail
    const tb = this.cat.shape.tailBones;
    const bodyYawVel = turn;
    for (let j = 0; j < tb.length; j++) {
      const f = j / (tb.length - 1);
      const st = this.tailState[j];
      // spring lag
      const target = -bodyYawVel * 0.05 * (1 + f) + Math.sin(t * Math.PI * 2 * p.tailWagF * 0.5 - j * 0.55) * p.tailWag * (0.3 + f) + Math.sin(t * 0.7 + j * 0.3) * 0.03;
      st.vel += (target - st.yaw) * 60 * dt - st.vel * 9 * dt;
      st.yaw += st.vel * dt;
      const pitch = j === 0 ? -p.tailLift * 1.2 : -p.tailLift * 0.12 + p.tailCurl * f * f * 0.9 - 0.04;
      this.setLocal(tb[j], pitch, st.yaw, 0);
    }
    // shoulder blades: roll with the stride, rise when stalking
    for (let l = 0; l < 2; l++) {
      const leg = LEGS[l];
      const lp = (this.phase + off[l]) % 1;
      const stance = lp < duty ? Math.sin((lp / duty) * Math.PI) : 0;
      this.offset[this.i(leg.chain[0])].set(0, p.scap * 0.05 + stance * 0.02 * stepAmt + p.scap * stance * 0.035, 0);
      this.setLocal(leg.chain[0], (lp < duty ? (lp / duty - 0.5) * 0.3 : -(((lp - duty) / (1 - duty)) - 0.5) * 0.3) * stepAmt, 0, 0);
    }

    // --- forward kinematics for the trunk ---
    this.fk();

    // --- feet ---
    this.cat.inner.updateMatrixWorld(true);
    const toWorld = this.cat.inner.matrixWorld;
    _m.copy(toWorld).invert();
    const ground = (x: number, z: number) => {
      if (!this.groundFn) return 0;
      _v.set(x, 0, z).applyMatrix4(toWorld);
      const gy = this.groundFn(_v.x, _v.z);
      _v.y = gy;
      _v.applyMatrix4(_m);
      return _v.y;
    };
    for (let l = 0; l < 4; l++) {
      const leg = LEGS[l];
      const pawName = leg.chain[leg.chain.length - 1];
      const rest = this.restModel[this.i(pawName)];
      const lp = (this.phase + off[l]) % 1;
      const target = v3();
      let mode: FootMode = 'stand';
      let swingAmt = 0;
      target.set(rest.x * (1 - this.crouch * -0.15), 0, rest.z + (leg.front ? -0.02 : 0.02) * this.crouch);
      // shift feet under the body when the hips move
      if (moving) {
        if (lp < duty) {
          const s = lp / duty;
          target.z += (0.5 - s) * stride;
        } else {
          const s = (lp - duty) / (1 - duty);
          const e = s * s * (3 - 2 * s);
          target.z += (-0.5 + e) * stride;
          swingAmt = Math.sin(s * Math.PI);
        }
        target.z += turn * 0 ;
        target.x += (leg.front ? 1 : -1) * turn * 0.05 * (lp < duty ? (0.5 - lp / duty) : 0) * stepAmt;
      }
      if (this.airborne) {
        target.set(rest.x, (leg.front ? 0.25 : 0.2) * this.H, rest.z + (leg.front ? 0.25 : -0.2));
        mode = 'free';
      } else if (this.swimming) {
        const sp = (this.phase * 1.2 + off[l]) % 1 * Math.PI * 2;
        target.set(rest.x, 0.35 * this.H + Math.sin(sp) * 0.12, rest.z + Math.cos(sp) * 0.18);
        mode = 'free';
      }
      const gy = ground(target.x, target.z);
      if (mode === 'stand') target.y = gy + 0.035 + swingAmt * lift;
      // pose overrides
      const pf = this.poseFeet[l];
      if (pf && w > 0) {
        const py = pf.ground ? ground(pf.p.x, pf.p.z) + pf.p.y : pf.p.y;
        _v2.set(pf.p.x, py, pf.p.z);
        target.lerp(_v2, w);
        if (w > 0.5) mode = pf.mode;
      }
      this.footW[l].copy(target);
    }
    // body height & pitch follow the terrain under the feet
    const fy = (this.footW[0].y + this.footW[1].y) / 2, hy = (this.footW[2].y + this.footW[3].y) / 2;
    const fG = (ground(this.footW[0].x, this.footW[0].z) + ground(this.footW[1].x, this.footW[1].z)) / 2;
    const hG = (ground(this.footW[2].x, this.footW[2].z) + ground(this.footW[3].x, this.footW[3].z)) / 2;
    void fy; void hy;
    if (!this.airborne && !this.swimming) {
      const slope = Math.atan2(fG - hG, this.L);
      const hipsQ = this.localQ[this.i('hips')];
      _q.setFromEuler(_e.set(-slope * (1 - w * 0.5), 0, 0));
      hipsQ.premultiply(_q);
      this.offset[this.i('hips')].y += (fG + hG) / 2 * 0.95 - Math.abs(slope) * 0.05;
      this.fk();
    }

    // --- leg IK ---
    for (let l = 0; l < 4; l++) this.solveLeg(l, this.footW[l]);

    // --- write bones ---
    for (let b = 0; b < this.bones.length; b++) {
      this.bones[b].quaternion.copy(this.localQ[b]);
      this.bones[b].position.copy(this.restLocal[b]).add(this.offset[b]);
    }
    // eyelids
    const closed = Math.max(this.blink, p.eyes);
    const lids = this.cat.lids;
    for (let e = 0; e < lids.length; e++) lids[e].rotation.x = -1.25 + closed * 1.15;
    // fur sway from motion
    this.cat.uniforms.uFurWind.value.set(Math.sin(t * 2.1) * 0.15, 0, -v * 0.06 - 0.05);
  }

  private setLocal(name: string, pitch: number, yaw: number, roll: number) {
    const q = this.localQ[this.i(name)];
    _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    q.multiply(_q);
  }
  private fk() {
    for (let b = 0; b < this.names.length; b++) {
      const pi = this.parent[b];
      if (pi < 0) { this.worldQ[b].copy(this.localQ[b]); this.worldP[b].copy(this.restLocal[b]).add(this.offset[b]); continue; }
      this.worldQ[b].copy(this.worldQ[pi]).multiply(this.localQ[b]);
      this.worldP[b].copy(this.restLocal[b]).add(this.offset[b]).applyQuaternion(this.worldQ[pi]).add(this.worldP[pi]);
    }
  }
  /** Rotate bone so its rest direction (toward child) points along dir, given parent's world rotation. */
  private aim(b: number, child: number, dir: THREE.Vector3, extraRoll = 0) {
    const pi = this.parent[b];
    _v.copy(this.restModel[child]).sub(this.restModel[b]).normalize();
    _q.setFromUnitVectors(_v, _v2.copy(dir).normalize());
    if (extraRoll) { _q2.setFromAxisAngle(_v2, extraRoll); _q.premultiply(_q2); }
    this.worldQ[b].copy(_q);
    this.localQ[b].copy(this.worldQ[pi]).invert().multiply(_q);
    // child position
    this.worldP[child].copy(this.restLocal[child]).applyQuaternion(this.worldQ[b]).add(this.worldP[b]);
  }
  private solveLeg(l: number, foot: THREE.Vector3) {
    const leg = LEGS[l];
    const ch = leg.chain.map((n) => this.i(n));
    // joint indices: front: scap(0) -> hum(1) shoulder joint, fore(2) elbow, carp(3) wrist, paw(4)
    // hind: fem(0) hip joint, tib(1) knee, tar(2) hock, paw(3)
    const front = leg.front;
    const a = front ? ch[1] : ch[0];
    const kn = front ? ch[2] : ch[1];
    const lo = front ? ch[3] : ch[2];
    const paw = front ? ch[4] : ch[3];
    if (front) {
      // update shoulder joint world pos from scapula
      this.worldP[a].copy(this.restLocal[a]).add(this.offset[a]).applyQuaternion(this.worldQ[ch[0]]).add(this.worldP[ch[0]]);
      this.worldQ[a].copy(this.worldQ[ch[0]]);
    }
    const A = this.worldP[a];
    const l1 = this.restModel[kn].distanceTo(this.restModel[a]);
    const l2 = this.restModel[lo].distanceTo(this.restModel[kn]);
    const l3 = this.restModel[paw].distanceTo(this.restModel[lo]);
    const mode = this.poseFeet[l]?.mode && this.poseWeight > 0.5 ? this.poseFeet[l]!.mode : 'stand';
    // lower joint target (wrist / hock) from paw
    const lift = Math.max(0, foot.y - 0.035 - 0.0);
    const curl = Math.min(1, lift * 6);
    const dirLow = v3();
    if (front) dirLow.set(0, 0.95 - curl * 0.35, -0.3 + curl * 1.0);
    else dirLow.set(0, 0.96 - curl * 0.25, -0.29 + curl * 0.75);
    if (mode === 'flat') dirLow.set(0, 0.08, -1);
    if (mode === 'hockDown') dirLow.set(0, 0.12, -1);
    dirLow.normalize();
    const W = v3().copy(foot).addScaledVector(dirLow, l3);
    const ht = this.hockTargets[l];
    if (ht && this.poseWeight > 0) W.lerp(ht, smooth(this.poseWeight));
    // two-bone IK A -> K -> W
    const d = v3().subVectors(W, A);
    let dist = d.length();
    const maxR = (l1 + l2) * 0.999, minR = Math.abs(l1 - l2) * 1.05 + 0.01;
    dist = THREE.MathUtils.clamp(dist, minR, maxR);
    d.normalize();
    const pole = v3(0, 0, front ? -1 : 1).applyQuaternion(this.worldQ[this.i('hips')]);
    pole.addScaledVector(d, -pole.dot(d)).normalize();
    const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const K = v3().copy(A).addScaledVector(d, l1 * cosA).addScaledVector(pole, l1 * sinA);
    const Wc = v3().copy(A).addScaledVector(d, dist);
    this.aim(a, kn, v3().subVectors(K, A));
    this.aim(kn, lo, v3().subVectors(Wc, K));
    this.aim(lo, paw, v3().subVectors(foot, Wc).lengthSq() > 1e-6 ? v3().subVectors(foot, Wc) : v3(0, -1, 0));
    // paw: keep level (flat on the ground) with a little curl in swing
    const pq = _q.setFromEuler(_e.set(curl * 0.9 + this.pawRot[l], 0, 0));
    this.localQ[paw].copy(this.worldQ[lo]).invert().multiply(pq);
  }

  /** Emote / pose targets. Coordinates are in rig space (unit lion). */
  private computePose(pose: PoseName, P: Params) {
    Object.assign(P, ZERO());
    const t = this.poseTime, H = this.H, L = this.L;
    const fx = this.restModel[this.i('fpawL')].x, hx = this.restModel[this.i('hpawL')].x;
    const hipZ = this.restModel[this.i('femL')].z;
    const setFoot = (l: number, x: number, y: number, z: number, mode: FootMode = 'stand', ground = true) => { this.poseFeet[l] = { p: new THREE.Vector3(x, y, z), mode, ground, lift: 0 }; };
    const breathe = 1;
    P.breath = breathe;
    switch (pose) {
      case 'sit': case 'groom': case 'eat': {
        P.hipsY = -(H - 0.34); P.hipsPitch = -0.62; P.hipsZ = 0.04;
        P.neckPitch = 0.12; P.headPitch = 0.55; P.tailCurl = 0.9; P.tailLift = -0.2; P.tailWag = 0.05;
        setFoot(0, fx, 0.035, 0.18); setFoot(1, -fx, 0.035, 0.18);
        setFoot(2, hx * 1.25, 0.035, hipZ + 0.3); setFoot(3, -hx * 1.25, 0.035, hipZ + 0.3);
        this.hockTargets[2] = new THREE.Vector3(hx * 1.3, 0.06, hipZ - 0.02); this.hockTargets[3] = new THREE.Vector3(-hx * 1.3, 0.06, hipZ - 0.02);
        if (pose === 'groom') {
          const c = Math.sin(t * 5.5);
          setFoot(0, 0.04, H * 0.98 + c * 0.02, 0.55, 'free', false);
          P.neckPitch = 0.55; P.headPitch = 0.25 + c * 0.08; P.headYaw = -0.25; P.headRoll = 0.25; P.jaw = 0.12 + Math.max(0, c) * 0.1; P.eyes = 0.6;
        }
        if (pose === 'eat') {
          // crouched over food
          P.hipsY = -(H * 0.45); P.hipsPitch = 0.1; P.neckPitch = 0.9; P.headPitch = 0.1 + Math.sin(t * 4) * 0.1; P.jaw = 0.3 + Math.sin(t * 6) * 0.2;
          setFoot(0, fx * 1.4, 0.035, 0.6); setFoot(1, -fx * 1.4, 0.035, 0.6);
          setFoot(2, hx * 1.3, 0.035, hipZ + 0.25); setFoot(3, -hx * 1.3, 0.035, hipZ + 0.25);
          this.hockTargets[2] = new THREE.Vector3(hx * 1.4, 0.06, hipZ - 0.05); this.hockTargets[3] = new THREE.Vector3(-hx * 1.4, 0.06, hipZ - 0.05);
        }
        break;
      }
      case 'lie': case 'sleep': case 'nuzzle': case 'groomOther': {
        P.hipsY = -(H - 0.24); P.hipsPitch = 0.02;
        P.neckPitch = -0.15; P.headPitch = 0.1; P.tailCurl = 0.5; P.tailLift = -0.3; P.tailWag = 0.03;
        setFoot(0, fx * 0.9, 0.035, 0.8, 'flat'); setFoot(1, -fx * 0.9, 0.035, 0.8, 'flat');
        setFoot(2, hx * 2.0, 0.03, hipZ + 0.28, 'stand'); setFoot(3, -hx * 2.0, 0.03, hipZ + 0.28, 'stand');
        this.hockTargets[2] = new THREE.Vector3(hx * 2.1, 0.05, hipZ - 0.06); this.hockTargets[3] = new THREE.Vector3(-hx * 2.1, 0.05, hipZ - 0.06);
        if (pose === 'sleep') {
          P.hipsRoll = 1.15; P.hipsY = -(H - 0.2); P.neckPitch = 0.2; P.headPitch = 0.15; P.headRoll = -0.4; P.eyes = 1; P.breath = 0.6;
          for (let l = 0; l < 4; l++) {
            const front = l < 2, side = l % 2 === 0 ? 1 : -1;
            const z = front ? 0.55 + (side > 0 ? 0.08 : -0.02) : hipZ + (side > 0 ? 0.0 : 0.15);
            this.poseFeet[l] = { p: new THREE.Vector3(-0.62 - (side > 0 ? 0.0 : 0.12), 0.07 + (side > 0 ? 0.0 : 0.1), z), mode: 'free', ground: true, lift: 0 };
          }
          P.tailCurl = 0.2; P.tailLift = -0.5;
        }
        if (pose === 'nuzzle' || pose === 'groomOther') {
          const c = Math.sin(t * (pose === 'nuzzle' ? 1.6 : 4.5));
          P.hipsY = -(H * 0.12); P.hipsPitch = 0.08; P.neckPitch = 0.35; P.headPitch = 0.2; P.headYaw = c * 0.3; P.headRoll = c * 0.35 + 0.1; P.eyes = 0.55;
          this.poseFeet = [null, null, null, null]; this.hockTargets = [null, null, null, null];
          if (pose === 'groomOther') { P.jaw = 0.12 + Math.max(0, c) * 0.1; P.neckPitch = 0.55; }
        }
        break;
      }
      case 'roar': {
        const env = smooth(Math.min(1, t / 0.6)) * (1 - smooth(Math.max(0, (t - 2.2) / 0.8)));
        P.hipsY = -0.04 * env; P.hipsZ = 0.04 * env; P.spinePitch = 0.08 * env;
        P.neckPitch = -0.15 * env; P.headPitch = -0.55 * env + Math.sin(t * 18) * 0.015 * env; P.jaw = env * (0.95 + Math.sin(t * 20) * 0.04);
        P.earsBack = env * 0.9; P.tailLift = 0.25 * env; P.tailWag = 0.2 * env; P.tailWagF = 2; P.breath = 3;
        break;
      }
      case 'growl': {
        P.hipsY = -H * 0.12; P.hipsPitch = 0.08; P.neckPitch = 0.4; P.headPitch = -0.2; P.jaw = 0.22 + Math.sin(t * 30) * 0.02;
        P.earsBack = 1; P.tailWag = 0.5; P.tailWagF = 2.2; P.tailLift = 0.05; P.scap = 0.8; P.breath = 2;
        break;
      }
      case 'playbow': {
        P.hipsPitch = 0.42; P.hipsY = -0.06; P.spinePitch = 0.12; P.neckPitch = -0.25; P.headPitch = -0.2 + Math.sin(t * 3) * 0.05;
        P.tailLift = 0.7; P.tailCurl = -0.3; P.tailWag = 0.5; P.tailWagF = 3; P.earsUp = 1;
        setFoot(0, fx * 1.05, 0.035, 0.85, 'flat'); setFoot(1, -fx * 1.05, 0.035, 0.85, 'flat');
        break;
      }
      case 'stretch': {
        const a = smooth(Math.min(1, t / 0.8)) * (1 - smooth(Math.max(0, (t - 1.6) / 0.6)));
        const b = smooth(Math.max(0, Math.min(1, (t - 1.7) / 0.6))) * (1 - smooth(Math.max(0, (t - 3.0) / 0.5)));
        P.hipsPitch = 0.45 * a - 0.2 * b; P.hipsY = -0.08 * a; P.spinePitch = 0.2 * a - 0.15 * b; P.neckPitch = -0.3 * a; P.headPitch = -0.35 * a - 0.2 * b;
        P.jaw = a * smooth(Math.min(1, Math.max(0, (t - 0.6) / 0.5))) * 0.9; P.eyes = a * 0.8; P.tailLift = 0.5 * a + 0.2 * b; P.tailCurl = -0.4 * a;
        if (a > 0.01) { setFoot(0, fx, 0.035, 0.47 * (1 - a) + 0.9 * a, a > 0.5 ? 'flat' : 'stand'); setFoot(1, -fx, 0.035, 0.47 * (1 - a) + 0.9 * a, a > 0.5 ? 'flat' : 'stand'); }
        if (b > 0.01) { setFoot(2, hx, 0.035 + 0.04 * b, hipZ - 0.1 - 0.35 * b); }
        break;
      }
      case 'pounce': {
        const a = t / 1.1;
        const crouchA = smooth(Math.min(1, a / 0.35)) * (1 - smooth(Math.max(0, (a - 0.35) / 0.15)));
        P.hipsY = -H * 0.35 * crouchA; P.scap = crouchA; P.neckPitch = 0.4 * crouchA; P.headPitch = -0.2 * crouchA; P.tailWag = 0.4 * crouchA; P.tailWagF = 3;
        P.earsUp = 1;
        break;
      }
      case 'drink': {
        P.hipsY = -H * 0.25; P.hipsPitch = 0.15; P.neckPitch = 1.05; P.headPitch = 0.0 + Math.sin(t * 7) * 0.06; P.jaw = 0.1 + Math.max(0, Math.sin(t * 7)) * 0.12;
        setFoot(0, fx * 1.4, 0.035, 0.6); setFoot(1, -fx * 1.4, 0.035, 0.6);
        break;
      }
      case 'carry': {
        P.neckPitch = -0.05; P.headPitch = 0.05; P.jaw = 0.25; P.tailWag = 0.1;
        break;
      }
      case 'playfight': {
        const c = Math.sin(t * 3.2);
        P.hipsPitch = -0.35 - 0.2 * Math.max(0, c); P.hipsY = -0.12; P.neckPitch = -0.2; P.headPitch = 0.1; P.jaw = 0.4 + 0.2 * c; P.earsBack = 0.7; P.tailWag = 0.5; P.tailWagF = 3;
        setFoot(0, fx * 1.2, 0.3 + 0.2 * Math.max(0, c), 0.65 + 0.15 * c, 'free', true);
        setFoot(1, -fx * 1.2, 0.25 + 0.2 * Math.max(0, -c), 0.6 - 0.1 * c, 'free', true);
        break;
      }
    }
    void L;
  }
}
function smooth(t: number) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }
