import * as THREE from 'three/webgpu';
import type { Ship, Weapon } from '@boom/gamedata';
import mapInfo from '@boom/gamedata/generated/map.json';
import shipsJson from '@boom/gamedata/generated/ships.json';
import weaponsJson from '@boom/gamedata/generated/weapons.json';
import { createRtsCamera } from './camera.ts';
import { createPlaceholderShip } from './placeholderShip.ts';

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);
await renderer.init();
const backendName = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb8d0);
scene.fog = new THREE.Fog(0x8fb8d0, 2500, 7000);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x1a3a4a, 1.2));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(-600, 1200, 800);
scene.add(sun);

// Placeholder sea: a flat plane until the water shader lands in M1.
const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(16384, 16384),
  new THREE.MeshStandardMaterial({ color: 0x1d5f82, roughness: 0.35, metalness: 0.1 }),
);
sea.rotation.x = -Math.PI / 2;
scene.add(sea);

const ship = createPlaceholderShip(0xc23b2a);
scene.add(ship);

const rts = createRtsCamera(renderer.domElement);

window.addEventListener('resize', () => {
  rts.camera.aspect = window.innerWidth / window.innerHeight;
  rts.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  // Sim units are x/y on the sea plane; three.js uses x/-z.
  ship.position.set(Math.cos(t * 0.2) * 600, Math.sin(t * 1.3) * 3, -Math.sin(t * 0.2) * 600);
  ship.rotation.set(Math.sin(t * 1.1) * 0.03, t * 0.2, Math.sin(t * 0.9) * 0.05);
  rts.update();
  renderer.render(scene, rts.camera);
});

const ships = shipsJson as Ship[];
const weapons = weaponsJson as Weapon[];
hud.textContent = `${mapInfo.version} · ${ships.length} 艘船 / ${weapons.length} 种武器 · 渲染后端：${backendName}`;
