import * as THREE from 'three';
import { G, NOISE_GLSL } from '../engine/atmosphere';

const SPRITE_VERT = /* glsl */ `
attribute vec4 aData; // x: life 0..1, y: size, z: kind, w: seed
varying vec4 vData; varying float vDist;
uniform float uPixel;
void main(){
  vData = aData;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aData.y * uPixel / max(0.1, -mv.z);
}`;

/** Pooled soft particles: dust puffs, splashes, fireflies, pollen motes. */
export class Particles {
  group = new THREE.Group();
  private dust: THREE.Points; private dustPos: Float32Array; private dustData: Float32Array; private dustVel: Float32Array; private dustN = 220; private dustI = 0;
  private flies: THREE.Points; private flyPos: Float32Array; private flyBase: Float32Array; private flyN = 160;
  private motes: THREE.Points; private motePos: Float32Array; private moteN = 220;
  private rain: THREE.LineSegments; private rainPos: Float32Array; private rainN = 2600;
  private center = new THREE.Vector3();
  constructor(pixelRatio: number, quality: number) {
    const uPixel = { value: 300 * pixelRatio };
    this.dustN = Math.round(220 * quality); this.rainN = Math.round(2600 * quality);
    // dust
    this.dustPos = new Float32Array(this.dustN * 3); this.dustData = new Float32Array(this.dustN * 4); this.dustVel = new Float32Array(this.dustN * 3);
    for (let i = 0; i < this.dustN; i++) this.dustData[i * 4] = 1;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    dg.setAttribute('aData', new THREE.BufferAttribute(this.dustData, 4));
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({
      uniforms: { ...G, uPixel }, transparent: true, depthWrite: false,
      vertexShader: SPRITE_VERT,
      fragmentShader: /* glsl */ `${NOISE_GLSL}
uniform vec3 gSunColor; uniform vec3 gFogColor; varying vec4 vData;
void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c);
  float n = gg_vnoise(gl_PointCoord * 4.0 + vData.w * 10.0);
  float a = smoothstep(0.5, 0.1, r) * (0.55 + 0.45 * n) * (1.0 - vData.x) * smoothstep(0.0, 0.1, vData.x);
  vec3 col = vData.z > 0.5 ? vec3(0.85, 0.9, 0.95) * (0.6 + gSunColor * 0.3) : mix(vec3(0.62, 0.5, 0.36), gSunColor * 0.5 + gFogColor * 0.4, 0.5);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a * (vData.z > 0.5 ? 0.7 : 0.45));
  #include <colorspace_fragment>
}`,
    }));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    // fireflies
    this.flyPos = new Float32Array(this.flyN * 3); this.flyBase = new Float32Array(this.flyN * 4);
    const fd = new Float32Array(this.flyN * 4);
    for (let i = 0; i < this.flyN; i++) { this.flyBase[i * 4 + 3] = Math.random() * 100; fd[i * 4 + 1] = 0.5; fd[i * 4 + 3] = Math.random(); }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.flyPos, 3));
    fg.setAttribute('aData', new THREE.BufferAttribute(fd, 4));
    this.flies = new THREE.Points(fg, new THREE.ShaderMaterial({
      uniforms: { ...G, uPixel }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: SPRITE_VERT,
      fragmentShader: /* glsl */ `uniform float gNight; uniform float gTime; varying vec4 vData;
void main(){ float r = length(gl_PointCoord - 0.5); float blink = smoothstep(0.3, 1.0, sin(gTime * (1.3 + vData.w) + vData.w * 40.0));
  float a = smoothstep(0.5, 0.0, r); a = a * a * blink * gNight;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(1.0, 0.85, 0.35) * 5.0 * a, a); }`,
    }));
    this.flies.frustumCulled = false;
    this.group.add(this.flies);
    // pollen / dust motes that catch the low sun
    this.motePos = new Float32Array(this.moteN * 3);
    const md = new Float32Array(this.moteN * 4);
    for (let i = 0; i < this.moteN; i++) { md[i * 4 + 1] = 0.08 + Math.random() * 0.1; md[i * 4 + 3] = Math.random(); }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    mg.setAttribute('aData', new THREE.BufferAttribute(md, 4));
    this.motes = new THREE.Points(mg, new THREE.ShaderMaterial({
      uniforms: { ...G, uPixel }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: SPRITE_VERT,
      fragmentShader: /* glsl */ `uniform vec3 gSunColor; uniform vec3 gSunDir; uniform float gNight; varying vec4 vData; varying float vDist;
void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r);
  float low = smoothstep(0.5, 0.05, gSunDir.y) * (1.0 - gNight);
  a *= low * smoothstep(1.0, 3.0, vDist) * smoothstep(30.0, 10.0, vDist) * 0.6;
  if (a < 0.003) discard;
  gl_FragColor = vec4(gSunColor * a * 1.5, a); }`,
    }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
    // rain streaks
    this.rainPos = new Float32Array(this.rainN * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xc8d0dc, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
    for (let i = 0; i < this.rainN; i++) this.resetDrop(i, true);
  }
  private resetDrop(i: number, any: boolean) {
    const c = this.center;
    const x = c.x + (Math.random() - 0.5) * 50, z = c.z + (Math.random() - 0.5) * 50;
    const y = any ? c.y - 5 + Math.random() * 25 : c.y + 15 + Math.random() * 6;
    const p = this.rainPos;
    p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z; p[i * 6 + 3] = x + 0.05; p[i * 6 + 4] = y - 0.55; p[i * 6 + 5] = z + 0.02;
  }
  emitDust(p: THREE.Vector3, amount: number, splash = false) {
    for (let k = 0; k < amount; k++) {
      const i = this.dustI = (this.dustI + 1) % this.dustN;
      this.dustPos[i * 3] = p.x + (Math.random() - 0.5) * 0.5; this.dustPos[i * 3 + 1] = p.y + 0.1; this.dustPos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.5;
      this.dustVel[i * 3] = (Math.random() - 0.5) * 0.8; this.dustVel[i * 3 + 1] = splash ? 1.5 + Math.random() * 1.5 : 0.25 + Math.random() * 0.4; this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      this.dustData[i * 4] = 0.001; this.dustData[i * 4 + 1] = splash ? 0.25 : 0.9 + Math.random() * 0.8; this.dustData[i * 4 + 2] = splash ? 1 : 0; this.dustData[i * 4 + 3] = Math.random();
    }
  }
  update(dt: number, cam: THREE.Vector3, ground: (x: number, z: number) => number, rain: number, night: number) {
    this.center.copy(cam);
    // dust
    for (let i = 0; i < this.dustN; i++) {
      const d = this.dustData;
      if (d[i * 4] >= 1) continue;
      d[i * 4] = Math.min(1, d[i * 4] + dt * (d[i * 4 + 2] > 0.5 ? 1.6 : 0.55));
      this.dustVel[i * 3 + 1] -= dt * (d[i * 4 + 2] > 0.5 ? 6 : 0.1);
      this.dustPos[i * 3] += this.dustVel[i * 3] * dt; this.dustPos[i * 3 + 1] += this.dustVel[i * 3 + 1] * dt; this.dustPos[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
      d[i * 4 + 1] += dt * (d[i * 4 + 2] > 0.5 ? 0 : 1.2);
    }
    (this.dust.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.dust.geometry.getAttribute('aData') as THREE.BufferAttribute).needsUpdate = true;
    // fireflies drift around the camera at night
    this.flies.visible = night > 0.05;
    if (this.flies.visible) {
      const t = G.gTime.value;
      for (let i = 0; i < this.flyN; i++) {
        const b = this.flyBase;
        let bx = b[i * 4], bz = b[i * 4 + 2];
        if (Math.hypot(bx - cam.x, bz - cam.z) > 40 || b[i * 4 + 1] === 0) {
          bx = cam.x + (Math.random() - 0.5) * 70; bz = cam.z + (Math.random() - 0.5) * 70;
          b[i * 4] = bx; b[i * 4 + 2] = bz; b[i * 4 + 1] = 1;
        }
        const s = b[i * 4 + 3];
        this.flyPos[i * 3] = bx + Math.sin(t * 0.3 + s) * 1.5; this.flyPos[i * 3 + 2] = bz + Math.cos(t * 0.27 + s * 2) * 1.5;
        this.flyPos[i * 3 + 1] = ground(bx, bz) + 0.6 + Math.sin(t * 0.5 + s * 3) * 0.4 + (s % 1) * 0.8;
      }
      (this.flies.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // motes float within ~25 m
    const t = G.gTime.value;
    for (let i = 0; i < this.moteN; i++) {
      let x = this.motePos[i * 3], y = this.motePos[i * 3 + 1], z = this.motePos[i * 3 + 2];
      if (Math.abs(x - cam.x) > 25 || Math.abs(z - cam.z) > 25 || y === 0) { x = cam.x + (Math.random() - 0.5) * 50; z = cam.z + (Math.random() - 0.5) * 50; y = ground(x, z) + 0.3 + Math.random() * 3; }
      x += Math.sin(t * 0.4 + i) * dt * 0.2 + G.gWind.value.x * dt * 0.3; z += Math.cos(t * 0.33 + i * 1.7) * dt * 0.2 + G.gWind.value.y * dt * 0.3; y += Math.sin(t * 0.6 + i * 0.3) * dt * 0.08;
      this.motePos[i * 3] = x; this.motePos[i * 3 + 1] = y; this.motePos[i * 3 + 2] = z;
    }
    (this.motes.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // rain
    const rm = this.rain.material as THREE.LineBasicMaterial;
    rm.opacity = Math.min(0.55, rain * 0.6) * (1 - night * 0.5);
    this.rain.visible = rain > 0.02;
    if (this.rain.visible) {
      const p = this.rainPos;
      const n = Math.floor(this.rainN * Math.min(1, rain * 1.2));
      for (let i = 0; i < this.rainN; i++) {
        if (i >= n) { p[i * 6 + 1] = p[i * 6 + 4] = -1e4; continue; }
        const fall = 16 * dt;
        p[i * 6 + 1] -= fall; p[i * 6 + 4] -= fall; p[i * 6] += G.gWind.value.x * dt; p[i * 6 + 3] += G.gWind.value.x * dt;
        if (p[i * 6 + 4] < cam.y - 8 || Math.abs(p[i * 6] - cam.x) > 26 || Math.abs(p[i * 6 + 2] - cam.z) > 26) this.resetDrop(i, p[i * 6 + 1] < -1e3);
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
