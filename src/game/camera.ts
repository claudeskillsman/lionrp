import * as THREE from 'three';
import type { Input } from './input';

/** Smooth third-person orbit camera that frames the cat and avoids the terrain. */
export class FollowCamera {
  yaw = Math.PI; pitch = 0.18; dist = 4.2; targetDist = 4.2;
  target = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private initialized = false;
  autoFollow = 0;
  constructor(public camera: THREE.PerspectiveCamera, public groundFn: (x: number, z: number) => number) {}
  update(dt: number, focus: THREE.Vector3, catYaw: number, catSize: number, moving: boolean, input: Input | null, sens = 1, invertY = false) {
    if (input) {
      this.yaw -= input.mouseDX * 0.0042 * sens;
      this.pitch += input.mouseDY * 0.0032 * sens * (invertY ? -1 : 1);
      this.targetDist *= Math.pow(1.12, input.wheel);
      if (Math.abs(input.mouseDX) + Math.abs(input.mouseDY) > 0) this.autoFollow = 0;
    }
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.35, 1.25);
    const minD = 1.6 * catSize, maxD = 14 * Math.max(0.6, catSize);
    this.targetDist = THREE.MathUtils.clamp(this.targetDist, minD, maxD);
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 6);
    // gently swing behind the cat while moving if the player isn't steering the camera
    this.autoFollow = Math.min(1, this.autoFollow + dt * (moving ? 0.35 : 0));
    if (moving && this.autoFollow > 0.5) {
      let d = (catYaw + Math.PI) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 0.9) * (this.autoFollow - 0.5);
    }
    const t = focus.clone();
    t.y += 0.9 * catSize;
    if (!this.initialized) { this.smoothTarget.copy(t); this.initialized = true; }
    // critically damped follow
    const k = 9;
    const diff = t.clone().sub(this.smoothTarget);
    this.vel.addScaledVector(diff, k * k * dt).multiplyScalar(Math.max(0, 1 - 2 * k * dt));
    this.smoothTarget.addScaledVector(this.vel, dt);
    if (diff.length() > 6) this.smoothTarget.copy(t);
    this.target.copy(this.smoothTarget);
    const cp = Math.cos(this.pitch);
    const off = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    const pos = this.target.clone().add(off);
    // keep above ground (sample along the arm too)
    for (let i = 1; i <= 4; i++) {
      const p = this.target.clone().addScaledVector(off, i / 4);
      const g = this.groundFn(p.x, p.z) + 0.35;
      if (p.y < g) pos.y += (g - p.y) * (i / 4);
    }
    const gy = this.groundFn(pos.x, pos.z) + 0.3;
    if (pos.y < gy) pos.y = gy;
    this.camera.position.copy(pos);
    // look slightly above the cat so it sits in the lower third
    const look = this.target.clone(); look.y += 0.15 * catSize;
    this.camera.lookAt(look);
  }
  snap() { this.initialized = false; }
  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
}
