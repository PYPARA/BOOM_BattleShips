import * as THREE from 'three/webgpu';
import { createMatch, TICK_DT } from '@boom/sim';
import { RtsCamera } from './camera.ts';
import { loadData } from './data.ts';
import { Hud } from './hud.ts';
import { SelectionInput } from './input.ts';
import { Minimap } from './minimap.ts';
import { loadGlbModels } from './models/glb.ts';
import { Overlay } from './overlay.ts';
import { ProjectileViews } from './projectiles.ts';
import { createBuildings, createDoodads } from './props.ts';
import { ShipViews } from './shipViews.ts';
import { SEA_LEVEL, toThree } from './space.ts';
import { createTerrainMesh } from './terrain.ts';
import { createWater } from './water.ts';

/** Local player slot: the first southern player. */
const PLAYER = 2;
/** Never run more than this many sim ticks per frame, so a stalled tab cannot spiral. */
const MAX_TICKS_PER_FRAME = 5;

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const info = document.getElementById('info')!;

const [data] = await Promise.all([loadData(), loadGlbModels()]);
const params = new URLSearchParams(location.search);
const match = createMatch(data, { players: [PLAYER], mode: 'fast', seed: Date.now() % 100000 });
const world = match.world;
// `?gold=20000` starts with extra gold, for trying ships while developing.
if (import.meta.env.DEV && params.has('gold')) match.players.get(PLAYER)!.gold = Number(params.get('gold')) || 20000;

// `?webgl` forces the WebGL2 backend, to test the fallback path on WebGPU-capable browsers.
const forceWebGL = params.has('webgl');
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
const buildingGroup = createBuildings(data.map.placements, data.unitsById, data.terrain);
scene.add(buildingGroup);
// Link each building mesh to its simulated structure, to remove it when destroyed.
const buildingMeshes = new Map<number, THREE.Object3D>();
for (const s of world.structures.values()) {
  const mesh = buildingGroup.children.find((c) => c.userData.mapX === s.x && c.userData.mapY === s.y);
  if (mesh) buildingMeshes.set(s.id, mesh);
}

// Handy in the browser console while developing.
if (import.meta.env.DEV) Object.assign(window, { boom: { scene, match, world, renderer, get rts() { return rts; } } });

const shipViews = new ShipViews(world);
scene.add(shipViews.group);
const projectileViews = new ProjectileViews(world);
scene.add(projectileViews.mesh);
const overlay = new Overlay(match, PLAYER);
const hudPanel = new Hud(match, PLAYER, data);

const rts = new RtsCamera(renderer.domElement, data.map.bounds);
const input = new SelectionInput(renderer.domElement, rts, world, PLAYER);
const buildings = data.map.placements.filter((p) => data.unitsById.get(p.id)?.isBuilding && p.id !== 'hhou');
const minimap = new Minimap(data.terrain, data.pathingInfo, data.pathingCells, buildings, data.unitsById, world, rts, PLAYER);
minimap.onOrder = (x, y) => input.orderAt(x, y);
const firstShip = world.ships.get(match.players.get(PLAYER)!.shipId!)!;
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
    match.step();
    overlay.onEvents(match.events, now);
    hudPanel.onEvents(match.events, now);
    for (const e of match.events) {
      if (e.kind === 'death') buildingMeshes.get(e.unitId)?.removeFromParent();
      if (e.kind === 'respawn' && e.player === PLAYER) {
        const ship = world.ships.get(e.shipId)!;
        rts.lookAt(ship.x, ship.y);
      }
    }
    accumulator -= TICK_DT;
    ticks++;
  }
  if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0;

  // The player's ship changes on purchase and respawn; keep it selected.
  const own = match.players.get(PLAYER)!.shipId;
  for (const id of input.selected) if (!world.ships.has(id)) input.selected.delete(id);
  if (own !== undefined && input.selected.size === 0) input.selected.add(own);

  rts.update(frameDt);
  const alpha = accumulator / TICK_DT;
  shipViews.update(alpha, now / 1000, input.selected, frameDt);
  projectileViews.update(alpha);

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
  overlay.draw(rts.camera, now);
  minimap.draw();
  hudPanel.update(now);

  const selected = [...input.selected].map((id) => world.ships.get(id)).filter((s) => s !== undefined);
  info.textContent = selected
    .map((s) => {
      const type = shipTypes.get(s.typeId);
      if (!type) return '';
      return `${type.name}（${type.hullClass}，${type.size}）  航速 ${(s.speed / 10).toFixed(1)}/${type.speed / 10} 节  转向 ${type.turnRate}`;
    })
    .join('\n');
  hud.textContent = `${data.map.version} · ${backendName} · ${fps.toFixed(0)} FPS`;
});
