import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, Effect, SMAAEffect, DepthOfFieldEffect, BlendFunction } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Quality } from './settings';

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
uniform float warmth; uniform float saturation; uniform float contrast; uniform float exposure; uniform float night; uniform float filterMode; uniform float time; uniform float shimmer;
float gg_h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void mainUv(inout vec2 uv){
  // heat shimmer near the horizon at midday
  if (shimmer > 0.001) {
    float band = smoothstep(0.35, 0.5, uv.y) * smoothstep(0.65, 0.5, uv.y);
    uv.x += sin(uv.y * 220.0 + time * 6.0) * 0.0007 * shimmer * band;
    uv.y += sin(uv.x * 160.0 + time * 4.3) * 0.0005 * shimmer * band;
  }
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec3 c = inputColor.rgb * exposure;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // split toning: cool shadows, warm highlights
  vec3 shadowTint = mix(vec3(0.96, 0.99, 1.06), vec3(0.9, 0.97, 1.12), night);
  vec3 hiTint = vec3(1.0 + warmth * 0.10, 1.0 + warmth * 0.03, 1.0 - warmth * 0.10);
  c *= mix(shadowTint, hiTint, smoothstep(0.02, 0.6, l));
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = max(c, 0.0);
  c = pow(c / 0.18, vec3(contrast)) * 0.18;
  // photo filters
  if (filterMode > 0.5 && filterMode < 1.5) { float g = dot(c, vec3(0.3,0.59,0.11)); c = vec3(g); c = pow(c, vec3(1.1)); }
  else if (filterMode > 1.5 && filterMode < 2.5) { float g = dot(c, vec3(0.3,0.59,0.11)); c = mix(c, g * vec3(1.15, 0.98, 0.75), 0.75); }
  else if (filterMode > 2.5 && filterMode < 3.5) { c = mix(c, c * vec3(1.15, 0.95, 0.85) + vec3(0.02, 0.0, 0.03), 0.8); c = pow(c, vec3(0.95)); }
  else if (filterMode > 3.5) { c = mix(c, c.bgr * vec3(0.8, 0.95, 1.2), 0.25); c *= vec3(0.9, 1.0, 1.1); }
  // fine film grain to avoid banding in skies
  c += (gg_h(uv * 1000.0 + time) - 0.5) * 0.006;
  outputColor = vec4(c, inputColor.a);
}`, {
      uniforms: new Map<string, THREE.Uniform>([
        ['warmth', new THREE.Uniform(0)], ['saturation', new THREE.Uniform(1)], ['contrast', new THREE.Uniform(1)], ['exposure', new THREE.Uniform(1)],
        ['night', new THREE.Uniform(0)], ['filterMode', new THREE.Uniform(0)], ['time', new THREE.Uniform(0)], ['shimmer', new THREE.Uniform(0)],
      ]),
    });
  }
}

export class PostFX {
  composer: EffectComposer;
  renderPass: RenderPass;
  ao: any = null;
  bloom: BloomEffect;
  grade: GradeEffect;
  tone: ToneMappingEffect;
  vignette: VignetteEffect;
  dof: DepthOfFieldEffect | null = null;
  effectPass: EffectPass;
  dofPass: EffectPass | null = null;
  smaaPass: EffectPass | null = null;
  constructor(public renderer: THREE.WebGLRenderer, public scene: THREE.Scene, public camera: THREE.PerspectiveCamera, q: Quality) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: q.msaa });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    const dbg = new URLSearchParams(location.search);
    if (q.ao && !dbg.has('noao')) {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      this.ao = new N8AOPostPass(scene, camera, s.x, s.y);
      this.ao.configuration.aoRadius = 1.6;
      this.ao.configuration.distanceFalloff = 1.0;
      this.ao.configuration.intensity = 2.2;
      this.ao.configuration.halfRes = q.ao === 'half';
      this.ao.configuration.gammaCorrection = false;
      this.ao.configuration.color = new THREE.Color(0.12, 0.07, 0.03);
      this.ao.setQualityMode(q.ao === 'half' ? 'Low' : 'Medium');
      this.composer.addPass(this.ao);
    }
    this.bloom = new BloomEffect({ intensity: q.bloom ? 0.55 : 0, luminanceThreshold: 0.82, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 });
    this.grade = new GradeEffect();
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    const effects: Effect[] = [];
    if (q.bloom && !dbg.has('nobloom')) effects.push(this.bloom);
    effects.push(this.tone, this.grade, this.vignette);
    this.effectPass = new EffectPass(camera, ...effects);
    this.composer.addPass(this.effectPass);
    // SMAA is a convolution effect, so it cannot share a pass with the heat-shimmer UV warp
    if (q.msaa === 0) { this.smaaPass = new EffectPass(camera, new SMAAEffect()); this.composer.addPass(this.smaaPass); }
  }
  enableDOF(on: boolean, focus = 6, bokeh = 3) {
    if (on && !this.dof) {
      this.dof = new DepthOfFieldEffect(this.camera, { worldFocusDistance: focus, worldFocusRange: 3, bokehScale: bokeh, resolutionScale: 0.75 });
      this.dofPass = new EffectPass(this.camera, this.dof);
      // insert before the main effect pass so tone mapping happens after
      const passes = this.composer.passes;
      const i = passes.indexOf(this.effectPass);
      this.composer.addPass(this.dofPass, i);
    }
    if (this.dofPass) this.dofPass.enabled = on;
    if (this.dof && on) { this.dof.cocMaterial.worldFocusDistance = focus; this.dof.bokehScale = bokeh; }
  }
  setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene; this.camera = camera;
    this.renderPass.mainScene = scene; this.renderPass.mainCamera = camera;
    if (this.ao) { (this.ao as any).scene = scene; (this.ao as any).camera = camera; }
    this.effectPass.mainCamera = camera;
    if (this.smaaPass) this.smaaPass.mainCamera = camera;
    if (this.dofPass) this.dofPass.mainCamera = camera;
  }
  setSize(w: number, h: number) { this.composer.setSize(w, h); }
  render(dt: number) { this.composer.render(dt); }
  dispose() { this.composer.dispose(); }
}
