import * as THREE from 'three/webgpu';
import { Bot } from '@boom/ai';
import { createMatch, REPAIR_RECTS, TICK_DT } from '@boom/sim';
import { RtsCamera } from './camera.ts';
import { loadConfig, loadSettings, matchSlots, Progress, saveConfig } from './config.ts';
import { loadData } from './data.ts';
import { AudioEngine, createVolumeControl } from './audio.ts';
import { Effects } from './effects.ts';
import { Environment } from './environment.ts';
import { CombatFx } from './fx.ts';
import { Hud } from './hud.ts';
import { Info } from './info.ts';
import { SelectionInput } from './input.ts';
import { MainMenu } from './menu.ts';
import { Minimap } from './minimap.ts';
import { Music } from './music.ts';
import { loadGlbModels } from './models/glb.ts';
import { Overlay } from './overlay.ts';
import { ProjectileViews } from './projectiles.ts';
import { Results } from './results.ts';
import { SettingsPanel } from './settings.ts';
import { createBuildings, createDoodads, createRepairDocks } from './props.ts';
import { ShipViews } from './shipViews.ts';
import { SkillBar } from './skillbar.ts';
import { SoundFx } from './sounds.ts';
import { SEA_LEVEL, toThree } from './space.ts';
import { createTerrainMesh } from './terrain.ts';
import { Tooltip } from './tooltip.ts';
import { createWater } from './water.ts';

/** Never run more than this many sim ticks per frame, so a stalled tab cannot spiral. */
const MAX_TICKS_PER_FRAME = 5;

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;

// Load the data and models in the background while the main menu is up.
const params = new URLSearchParams(location.search);
const settings = loadSettings();
const progress = new Progress();
const loading = Promise.all([loadData(progress), loadGlbModels(progress)]);
// Sound starts with the menu (on the first click), so the shanty plays while choosing.
const audio = new AudioEngine();
const music = new Music(audio);
audio.onStart = () => music.start();
const settingsPanel = new SettingsPanel(settings, audio);
const menu = new MainMenu(progress);
menu.onSettings = () => settingsPanel.open();
// `?play` (rematch) and the developer parameters skip the menu.
const skipMenu = ['play', 'ai', 'solo', 'gold', 'side', 'mode'].some((k) => params.has(k));
const config = skipMenu ? loadConfig() : await menu.choose(loadConfig());
// Remember menu choices only; URL overrides are for one visit.
if (!skipMenu) saveConfig(config);
await menu.finish(loading);
const [data] = await loading;

const { player: PLAYER, slots } = matchSlots(config);
const match = createMatch(data, { players: slots, mode: config.mode, seed: Date.now() % 100000 });
const bots = slots.filter((p) => p !== PLAYER).map((p) => new Bot(match, p, { difficulty: config.difficulty }));
const world = match.world;
// `?gold=20000` starts with extra gold, for trying ships while developing.
if (import.meta.env.DEV && params.has('gold')) match.players.get(PLAYER)!.gold = Number(params.get('gold')) || 20000;

// `?webgl` forces the WebGL2 backend, to test the fallback path on WebGPU-capable browsers.
const forceWebGL = params.has('webgl');
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
// Quality: render resolution and shadows (applied when a match starts).
renderer.setPixelRatio(settings.quality === 'low' ? 0.75 : settings.quality === 'medium' ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);
await renderer.init();
const backendName = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const environment = new Environment(scene, settings.quality === 'high' ? 2048 : 1024);
environment.bakeEnvironment(renderer, scene);

scene.add(createTerrainMesh(data.terrain));
scene.add(createWater(data.terrain));
scene.add(createDoodads(data.doodads));
const buildingGroup = createBuildings(data.map.placements, data.unitsById, data.terrain);
scene.add(buildingGroup);
scene.add(createRepairDocks((['south', 'north'] as const).map((team) => ({ team, ...match.rectCenter(REPAIR_RECTS[team].station) })), data.terrain));
// Link each building mesh to its simulated structure, to remove it when destroyed.
const buildingMeshes = new Map<number, THREE.Object3D>();
for (const s of world.structures.values()) {
  const mesh = buildingGroup.children.find((c) => c.userData.mapX === s.x && c.userData.mapY === s.y);
  if (mesh) buildingMeshes.set(s.id, mesh);
}

// Handy in the browser console while developing.
if (import.meta.env.DEV) Object.assign(window, { boom: { scene, match, world, renderer, get rts() { return rts; }, get effects() { return effects; }, get hud() { return hudPanel; }, get overlay() { return overlay; }, get audio() { return audio; }, get music() { return music; } } });

const shipViews = new ShipViews(world, match.players.get(PLAYER)!.team);
scene.add(shipViews.group);
const effects = new Effects();
scene.add(effects.group);
const combatFx = new CombatFx(effects, match, match.players.get(PLAYER)!.team);
const projectileViews = new ProjectileViews(world);
scene.add(projectileViews.mesh);
const overlay = new Overlay(match, PLAYER);
const hudPanel = new Hud(match, PLAYER, data);
createVolumeControl(audio);
const results = new Results(match, PLAYER);
settingsPanel.enterMatch();
const soundFx = new SoundFx(audio, music, match, PLAYER);
hudPanel.onAnnounce = () => soundFx.announce();
const shipTypes = new Map(data.ships.map((s) => [s.id, s]));
const info = new Info(match, PLAYER, { ships: shipTypes, units: data.unitsById, items: data.itemsById, weapons: new Map(data.weapons.map((w) => [w.id, w])) });
const tooltip = new Tooltip((key) => {
  const [kind, id = ''] = key.split(':');
  if (kind === 'ship') return info.ship(id);
  if (kind === 'item') return info.item(id);
  if (kind === 'skill') { const a = world.abilities.byId.get(id); return a ? info.skill(a) : ''; }
  if (kind === 'slot') { const itemId = match.players.get(PLAYER)!.items[Number(id)]; return itemId ? info.item(itemId, Number(id)) : ''; }
  return '';
});

const rts = new RtsCamera(renderer.domElement, data.map.bounds);
// Created before selection input so its capture-phase listener sees targeting clicks first.
const skillBar = new SkillBar(match, PLAYER, data.itemsById, rts, renderer.domElement);
settingsPanel.onChange = (s) => { overlay.showDamage = s.damageNumbers; rts.edgePan = s.edgePan; };
settingsPanel.onChange(settings);
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

// Units under the cursor get a tooltip too (only over the 3D view, not the UI).
const pointer = { x: 0, y: 0, overCanvas: false };
renderer.domElement.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.overCanvas = true; });
renderer.domElement.addEventListener('pointerleave', () => { pointer.overCanvas = false; tooltip.hover(undefined); });
const ownTeam = match.players.get(PLAYER)!.team;
function hoverUnit(): void {
  const at = pointer.overCanvas ? rts.screenToSea(pointer.x, pointer.y) : undefined;
  let best: { d: number; html: string } | undefined;
  if (at) {
    for (const u of world.allUnits()) {
      if (u.locust || (u.team !== ownTeam && !world.visibleTo(ownTeam, u))) continue;
      const d = Math.hypot(u.x - at.x, u.y - at.y);
      if (d < Math.max(50, u.bodyRadius * 1.2) && (!best || d < best.d)) best = { d, html: info.unit(u) };
    }
  }
  tooltip.hover(best?.html);
}

window.addEventListener('resize', () => {
  rts.resize(window.innerWidth, window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let frame = 0;
let accumulator = 0;
let last = performance.now();
let fps = 60;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frameDt = Math.min(0.25, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(frameDt, 1e-3) - fps) * 0.05;

  // The settings panel pauses the match; everything else keeps drawing.
  accumulator = settingsPanel.paused ? 0 : accumulator + frameDt;
  let ticks = 0;
  while (accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
    for (const bot of bots) bot.update();
    match.step();
    overlay.onEvents(match.events, now);
    combatFx.onEvents(match.events);
    results.onEvents(match.events);
    soundFx.onEvents(match.events);
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
  environment.update(rts.camera, rts.target, rts.viewDistance);
  soundFx.update(rts.target.x, -rts.target.z, rts.viewDistance);
  const alpha = accumulator / TICK_DT;
  shipViews.update(alpha, now / 1000, input.selected, frameDt);
  projectileViews.update(alpha);
  combatFx.update();
  effects.update(frameDt, rts.camera);

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
  skillBar.update();

  if (++frame % 6 === 0) { hoverUnit(); tooltip.refresh(); }
  hud.textContent = `${data.map.version} · ${backendName} · ${fps.toFixed(0)} FPS`;
});
