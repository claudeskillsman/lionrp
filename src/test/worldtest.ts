
import * as THREE from 'three';
import { World } from '../world/worldgen';
import { GameWorld } from '../game/gameworld';
import { PostFX } from '../engine/postfx';
import { QUALITY } from '../engine/settings';

export function runWorldTest(params: URLSearchParams) {

const q = QUALITY[(params.get('q') as 'high') || 'high'];
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 12000);
const world = new World();
const t0 = performance.now();
world.generate();
console.log('worldgen', performance.now() - t0);
const gw = new GameWorld(world, camera, q);
const post = new PostFX(renderer, gw.scene, camera, q);
const time = parseFloat(params.get('t') || '17.7');
gw.env.setTime(time); gw.env.paused = true;
const cx = parseFloat(params.get('x') || '0'), cz = parseFloat(params.get('z') || '40');
const yaw = parseFloat(params.get('yaw') || '0');
const h = world.height(cx, cz);
camera.position.set(cx, h + parseFloat(params.get('h') || '2.2'), cz);
camera.lookAt(cx + Math.sin(yaw) * 10, h + 1.2 + parseFloat(params.get('pitch') || '0'), cz - Math.cos(yaw) * 10);
let last = performance.now();
let frames = 0;
function frame() {
  const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  gw.update(dt, camera.position);
  const g = gw.env.grade;
  const u = post.grade.uniforms;
  u.get('warmth')!.value = g.warmth; u.get('saturation')!.value = g.saturation; u.get('contrast')!.value = g.contrast; u.get('exposure')!.value = g.exposure;
  post.render(dt);
  frames++;
  (window as any).__frames = frames;
  const maxF = parseInt(params.get('frames') || '0');
  if (!maxF || frames < maxF) requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight); });
}
