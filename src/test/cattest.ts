import * as THREE from 'three';
import { PostFX } from '../engine/postfx';
import { QUALITY } from '../engine/settings';
import { Cat } from '../cat/cat';
import { defaultCat, Species } from '../cat/catConfig';
import { G } from '../engine/atmosphere';

// Studio test scene for cat visuals
export function runCatTest(params: URLSearchParams) {
  const q = QUALITY.high;
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2a2420');
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 100);
  const key = new THREE.DirectionalLight('#ffe2c0', 3.2); key.position.set(2, 3, 2.5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -2; key.shadow.camera.right = 2; key.shadow.camera.top = 2; key.shadow.camera.bottom = -2; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffd0a0', 2.5); rim.position.set(-2, 2, -3); scene.add(rim);
  scene.add(new THREE.HemisphereLight('#c8d0e8', '#5a4030', 0.8));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const cfg = defaultCat((params.get('sp') as Species) || 'lion');
  if (params.get('stage')) cfg.lifeStage = params.get('stage') as any;
  if (params.get('acc')) cfg.accessories = params.get('acc')!.split(',');
  if (params.get('scars')) cfg.scars = params.get('scars')!.split(',');
  const cat = new Cat(cfg, { shells: parseInt(params.get('shells') || '16') });
  scene.add(cat.group);
  cat.rig.groundFn = () => 0;
  if (params.get('pose')) cat.rig.setPose(params.get('pose') as any);
  cat.rig.speed = parseFloat(params.get('speed') || '0');
  const post = new PostFX(renderer, scene, camera, q);
  const view = params.get('view') || 'side';
  const s = cat.shape.scale;
  const tgt = new THREE.Vector3(0, 0.7 * s, 0.1 * s);
  const camPos: Record<string, THREE.Vector3> = {
    side: new THREE.Vector3(3.2, 1.0, 1.2), front: new THREE.Vector3(0.9, 1.1, 3.2), face: new THREE.Vector3(0.35, 1.05, 1.6), back: new THREE.Vector3(-2, 1.4, -2.6), top: new THREE.Vector3(0.1, 4, 0.1),
  };
  camera.position.copy(camPos[view]).multiplyScalar(s);
  if (view === 'face') tgt.set(0, cat.shape.headC[1] * s, cat.shape.headC[2] * s);
  camera.lookAt(tgt);
  let frames = 0, last = performance.now();
  const maxF = parseInt(params.get('frames') || '0');
  const simT = parseFloat(params.get('simt') || '0');
  // pre-simulate
  for (let i = 0; i < simT * 30; i++) cat.update(1 / 30);
  const frame = () => {
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    G.gTime.value += dt;
    cat.update(maxF ? 1 / 30 : dt);
    post.render(dt);
    frames++; (window as any).__frames = frames;
    if (!maxF || frames < maxF) requestAnimationFrame(frame);
  };
  frame();
}
