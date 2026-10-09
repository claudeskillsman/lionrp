import * as THREE from 'three';
import { G } from '../engine/atmosphere';
import { skyUniforms } from './sky';
import { clamp, smoothstep, lerp } from '../engine/noise';

/** Palette keyframes by sun elevation (degrees). */
interface Key { e: number; zen: string; hor: string; gnd: string; fog: string; fogSun: string; sun: string; sunI: number; sky: string; skyI: number; bounce: string; cloudLit: string; cloudShade: string; grade: [number, number, number, number]; }
// grade = warmth, saturation, contrast, exposure
const KEYS: Key[] = [
  { e: -18, zen: '#03060f', hor: '#0b1428', gnd: '#060a14', fog: '#0a1222', fogSun: '#101a33', sun: '#8aa4e0', sunI: 0.55, sky: '#2a3d6e', skyI: 0.55, bounce: '#141826', cloudLit: '#1a2440', cloudShade: '#070b16', grade: [-0.25, 0.85, 1.05, 1.0] },
  { e: -6, zen: '#141c46', hor: '#a8584a', gnd: '#1a1420', fog: '#3a3048', fogSun: '#c0614a', sun: '#ff8a5a', sunI: 0.6, sky: '#3a3f72', skyI: 0.6, bounce: '#3a2630', cloudLit: '#e07a62', cloudShade: '#2c2440', grade: [0.1, 1.05, 1.05, 1.0] },
  { e: 2, zen: '#3a64a8', hor: '#ffab5e', gnd: '#5a3a28', fog: '#b99a7e', fogSun: '#ffb468', sun: '#ff9a4a', sunI: 2.6, sky: '#6a7fb4', skyI: 0.75, bounce: '#9a5a32', cloudLit: '#ffc48a', cloudShade: '#6a5a8a', grade: [0.35, 1.18, 1.1, 1.0] },
  { e: 9, zen: '#3c64a8', hor: '#ffc07e', gnd: '#7a5434', fog: '#d9a676', fogSun: '#ffc88a', sun: '#ffb86a', sunI: 2.9, sky: '#7d95c6', skyI: 0.8, bounce: '#a8703e', cloudLit: '#ffe0b8', cloudShade: '#8a8cb0', grade: [0.3, 1.14, 1.08, 1.0] },
  { e: 25, zen: '#3f72bf', hor: '#e9d6b4', gnd: '#8a7254', fog: '#d4c4a6', fogSun: '#fbe2b8', sun: '#ffe4c0', sunI: 3.0, sky: '#8fb0de', skyI: 0.7, bounce: '#9a7a52', cloudLit: '#fff6ea', cloudShade: '#a4aec8', grade: [0.12, 1.06, 1.05, 1.0] },
  { e: 60, zen: '#3a74c8', hor: '#d9dccf', gnd: '#94866c', fog: '#d4ceb8', fogSun: '#f2e6cc', sun: '#fff1dc', sunI: 3.1, sky: '#8fb0de', skyI: 0.6, bounce: '#a8875a', cloudLit: '#ffffff', cloudShade: '#b0bad0', grade: [0.16, 1.16, 1.08, 0.92] },
];
const c = (s: string) => new THREE.Color(s);
const KC = KEYS.map((k) => ({ ...k, zenC: c(k.zen), horC: c(k.hor), gndC: c(k.gnd), fogC: c(k.fog), fogSunC: c(k.fogSun), sunC: c(k.sun), skyC: c(k.sky), bounceC: c(k.bounce), litC: c(k.cloudLit), shadeC: c(k.cloudShade) }));

export class Environment {
  time = 17.6; // hours
  timeSpeed = 1; // game minutes per real second multiplier base
  dayLengthMin = 24; // real minutes per full day at speed 1
  paused = false;
  rain = 0; rainTarget = 0; nextWeatherCheck = 0;
  sunDir = new THREE.Vector3();
  moonDir = new THREE.Vector3();
  sunLight: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  grade = { warmth: 0, saturation: 1, contrast: 1, exposure: 1 };
  sunElevationDeg = 0;
  lightColor = new THREE.Color();
  wetness = 0;
  windStrength = 0.6;
  private tmp = new THREE.Color();

  constructor(public scene: THREE.Scene) {
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.hemi = new THREE.HemisphereLight(0x8899cc, 0x664422, 0.8);
    scene.add(this.hemi);
  }

  setTime(h: number) { this.time = ((h % 24) + 24) % 24; this.apply(); }

  update(dt: number, solo = true) {
    if (!this.paused) {
      const hoursPerSec = 24 / (this.dayLengthMin * 60) * this.timeSpeed;
      this.time = (this.time + dt * hoursPerSec) % 24;
    }
    G.gTime.value += dt;
    // weather: occasional rain
    this.nextWeatherCheck -= dt;
    if (this.nextWeatherCheck <= 0) {
      this.nextWeatherCheck = 90 + Math.random() * 120;
      this.rainTarget = Math.random() < 0.18 ? 0.6 + Math.random() * 0.4 : 0;
    }
    this.rain += clamp(this.rainTarget - this.rain, -dt * 0.03, dt * 0.03);
    this.wetness = clamp(this.wetness + (this.rain > 0.2 ? dt * 0.02 : -dt * 0.006), 0, 1);
    G.gWet.value = this.wetness;
    const gust = 0.5 + 0.5 * Math.sin(G.gTime.value * 0.13) * Math.sin(G.gTime.value * 0.071 + 1);
    G.gWind.value.z = this.windStrength * (0.6 + gust * 0.6) + this.rain * 0.5;
    this.apply();
  }

  apply() {
    const t = this.time;
    // sun path: rises in the east (+x), sets in the west (-x), arcs slightly south (+z)
    const a = ((t - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.82, 0.38).normalize();
    if (this.sunDir.y < -0.02) {
      // below horizon; moon leads lighting
    }
    this.moonDir.set(-Math.cos(a) * 0.9, Math.max(0.25, -Math.sin(a) * 0.8), -0.3).normalize();
    const elev = Math.asin(this.sunDir.y) * 180 / Math.PI;
    this.sunElevationDeg = elev;
    let i = 0;
    while (i < KC.length - 2 && elev > KC[i + 1].e) i++;
    const k0 = KC[i], k1 = KC[i + 1];
    const f = smoothstep(0, 1, clamp((elev - k0.e) / (k1.e - k0.e), 0, 1));
    const mix = (a: THREE.Color, b: THREE.Color, out: THREE.Color) => out.copy(a).lerp(b, f);
    const rainDim = 1 - this.rain * 0.45;
    mix(k0.zenC, k1.zenC, skyUniforms.uZenith.value);
    mix(k0.horC, k1.horC, skyUniforms.uHorizon.value);
    mix(k0.gndC, k1.gndC, skyUniforms.uGround.value);
    mix(k0.litC, k1.litC, skyUniforms.uCloudLit.value);
    mix(k0.shadeC, k1.shadeC, skyUniforms.uCloudShade.value);
    mix(k0.fogC, k1.fogC, G.gFogColor.value);
    mix(k0.fogSunC, k1.fogSunC, G.gFogSunColor.value);
    const grey = new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(clamp(elev / 30 + 0.4, 0.08, 1));
    if (this.rain > 0) {
      for (const col of [skyUniforms.uZenith.value, skyUniforms.uHorizon.value, G.gFogColor.value, G.gFogSunColor.value, skyUniforms.uCloudLit.value]) col.lerp(grey, this.rain * 0.65);
    }
    skyUniforms.uCloudCover.value = 0.38 + this.rain * 0.55;
    const night = 1 - smoothstep(-10, 2, elev);
    skyUniforms.uStars.value = night * (1 - this.rain);
    skyUniforms.uMoonDir.value.copy(this.moonDir);
    G.gNight.value = night;

    // key light: sun by day, moon by night
    const sunI = lerp(k0.sunI, k1.sunI, f) * rainDim;
    mix(k0.sunC, k1.sunC, this.lightColor);
    if (elev > -3) {
      this.sunLight.position.copy(this.sunDir);
      const up = smoothstep(-3, 3, elev);
      this.sunLight.intensity = sunI * up + (1 - up) * 0.5;
    } else {
      this.sunLight.position.copy(this.moonDir);
      this.sunLight.intensity = sunI;
    }
    this.sunLight.color.copy(this.lightColor);
    G.gSunDir.value.copy(elev > -3 ? this.sunDir : this.moonDir);
    G.gSunColor.value.copy(this.lightColor);
    // ambient: sky dome + warm ground bounce (keeps shadows from going flat)
    mix(k0.skyC, k1.skyC, this.hemi.color);
    mix(k0.bounceC, k1.bounceC, this.hemi.groundColor);
    this.hemi.intensity = lerp(k0.skyI, k1.skyI, f) * (1 + this.rain * 0.2);
    if (this.rain > 0) this.hemi.color.lerp(grey, this.rain * 0.5);

    // fog density: hazier at midday (heat), thicker in rain, crisp at golden hour
    const midday = smoothstep(30, 60, elev);
    G.gFogDensity.value = (0.00045 + midday * 0.0006 + night * 0.0003) * (1 + this.rain * 2.2);
    G.gMist.value.w = 0.6 + night * 0.6 + (1 - smoothstep(0, 15, elev)) * 0.6;
    const g0 = k0.grade, g1 = k1.grade;
    this.grade.warmth = lerp(g0[0], g1[0], f) * (1 - this.rain * 0.7);
    this.grade.saturation = lerp(g0[1], g1[1], f) * (1 - this.rain * 0.2);
    this.grade.contrast = lerp(g0[2], g1[2], f);
    this.grade.exposure = lerp(g0[3], g1[3], f);
  }
}
