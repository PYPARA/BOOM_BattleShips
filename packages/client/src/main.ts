import * as THREE from 'three/webgpu';
import { createWorld, TICK_DT } from '@boom/sim';
import { RtsCamera } from './camera.ts';
import { loadData } from './data.ts';
import { SelectionInput } from './input.ts';
import { Minimap } from './minimap.ts';
import { createBuildings, createDoodads } from './props.ts';
import { ShipViews } from './shipViews.ts';
import { SEA_LEVEL, toThree } from './space.ts';
import { createTerrainMesh } from './terrain.ts';
import { createWater } from './water.ts';

/** Local player slot: the first southern player. */
const PLAYER = 2;
/** Ships handed to the player in M1 to compare hull handling (水手, 拦截者, 领主, 黑色幽灵). */
const STARTING_FLEET = ['H000', 'H003', 'H008', 'H011'];
/** Never run more than this many sim ticks per frame, so a stalled tab cannot spiral. */
const MAX_TICKS_PER_FRAME = 5;

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const info = document.getElementById('info')!;

const data = await loadData();
const world = createWorld(data);

// `?webgl` forces the WebGL2 backend, to test the fallback path on WebGPU-capable browsers.
const forceWebGL = new URLSearchParams(location.search).has('webgl');
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);
await renderer.init();
const backendName = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc3d8);
scene.fog = new THREE.Fog(0x9cc3d8, 4000, 11000);
scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x2a4a50, 1.3));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.set(-3000, 6000, 2500);
scene.add(sun);

scene.add(createTerrainMesh(data.terrain));
scene.add(createWater(data.terrain));
scene.add(createDoodads(data.doodads));
scene.add(createBuildings(data.map.placements, data.unitsById, data.terrain));

const start = data.map.players.find((p) => p.index === PLAYER)!;
STARTING_FLEET.forEach((typeId, i) => {
  const radius = data.ships.find((s) => s.id === typeId)!.collision;
  const spot = world.grid.nearestSailable(start.startX! + (i - 1.5) * 220, start.startY! + 500, radius)!;
  world.spawnShip(typeId, PLAYER, spot.x, spot.y, Math.PI / 2);
});

// Handy in the browser console while developing.
if (import.meta.env.DEV) Object.assign(window, { boom: { scene, world, renderer } });

const shipViews = new ShipViews(world);
scene.add(shipViews.group);

const rts = new RtsCamera(renderer.domElement, data.map.bounds);
const input = new SelectionInput(renderer.domElement, rts, world, PLAYER);
const buildings = data.map.placements.filter((p) => data.unitsById.get(p.id)?.isBuilding && p.id !== 'hhou');
const minimap = new Minimap(data.terrain, data.pathingInfo, data.pathingCells, buildings, data.unitsById, world, rts, PLAYER);
minimap.onOrder = (x, y) => input.orderAt(x, y);
const firstShip = [...world.ships.values()][0]!;
input.selected.add(firstShip.id);
rts.lookAt(firstShip.x, firstShip.y + 400);

// Fading ring where the last move order was given.
const marker = new THREE.Mesh(
  new THREE.RingGeometry(24, 34, 32),
  new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, depthWrite: false }),
);
marker.rotation.x = -Math.PI / 2;
scene.add(marker);

window.addEventListener('resize', () => {
  rts.resize(window.innerWidth, window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const shipTypes = new Map(data.ships.map((s) => [s.id, s]));
let accumulator = 0;
let last = performance.now();
let fps = 60;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frameDt = Math.min(0.25, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(frameDt, 1e-3) - fps) * 0.05;

  accumulator += frameDt;
  let ticks = 0;
  while (accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
    world.step();
    accumulator -= TICK_DT;
    ticks++;
  }
  if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0;

  rts.update(frameDt);
  shipViews.update(accumulator / TICK_DT, now / 1000, input.selected, frameDt);

  if (input.lastOrder) {
    const age = (now - input.lastOrder.at) / 600;
    marker.visible = age < 1;
    toThree(input.lastOrder.x, input.lastOrder.y, SEA_LEVEL + 3, marker.position);
    marker.scale.setScalar(1 + age * 0.6);
    (marker.material as THREE.MeshBasicMaterial).opacity = 1 - age;
  } else {
    marker.visible = false;
  }

  renderer.render(scene, rts.camera);
  minimap.draw();

  const selected = [...input.selected].map((id) => world.ships.get(id)).filter((s) => s !== undefined);
  info.textContent = selected
    .map((s) => {
      const type = shipTypes.get(s.typeId)!;
      return `${type.name}（${type.hullClass}，${type.size}）  航速 ${(s.speed / 10).toFixed(1)}/${type.speed / 10} 节  转向 ${type.turnRate}`;
    })
    .join('\n');
  hud.textContent = `${data.map.version} · ${backendName} · ${fps.toFixed(0)} FPS`;
});
