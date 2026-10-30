import * as THREE from 'three/webgpu';
import { Bot } from '@boom/ai';
import { createMatch, REPAIR_RECTS, TICK_DT, TRADER_SHOPS } from '@boom/sim';
import { RtsCamera } from './camera.ts';
import { loadConfig, loadSettings, matchSlots, Progress, saveConfig } from './config.ts';
import { loadData } from './data.ts';
import { AudioEngine, createVolumeControl } from './audio.ts';
import { Effects } from './effects.ts';
import { Environment } from './environment.ts';
import { FogLayer } from './fog.ts';
import { createFullscreenButton } from './fullscreen.ts';
import { CombatFx } from './fx.ts';
import { Hud } from './hud.ts';
import { Info } from './info.ts';
import { SelectionInput } from './input.ts';
import { MainMenu } from './menu.ts';
import { Minimap } from './minimap.ts';
import { Music } from './music.ts';
import { loadGlbModels } from './models/glb.ts';
import { Wakes } from './wakes.ts';
import { WeatherView } from './weather.ts';
import { Overlay } from './overlay.ts';
import { ProjectileViews } from './projectiles.ts';
import { Catalog } from './catalog.ts';
import { Codex } from './codex.ts';
import { Results } from './results.ts';
import { clearSave, describeSave, loadSave, Recorder, replay, type SavedMatch } from './save.ts';
import { SelectionPanel } from './selection.ts';
import { SettingsPanel } from './settings.ts';
import { OpeningTips } from './tips.ts';
import { Tutorial } from './tutorial.ts';
import { prewarm } from './prewarm.ts';
import { PerfGraph } from './perfGraph.ts';
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
/** Set in this tab while a match runs, so a refresh resumes it (settings.ts clears it to leave). */
const IN_MATCH_KEY = 'boom.inMatch';

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;

// Load the data and models in the background while the main menu is up.
const params = new URLSearchParams(location.search);
const settings = loadSettings();
const progress = new Progress();
// Ships nobody sails at the start (the 30-odd purchasable hulls) load after the match begins.
const STARTING_SHIPS = new Set(['H000', 'h00I', 'h00B', 'h00H', 'h018']);
const startingModel = (kind: string, id: string) => kind !== 'ships' || STARTING_SHIPS.has(id);
const dataLoading = loadData(progress);
const loading = Promise.all([dataLoading, loadGlbModels(progress, startingModel)]);
// Sound starts with the menu (on the first click), so the shanty plays while choosing.
const audio = new AudioEngine();
const music = new Music(audio);
audio.onStart = () => music.start();
const settingsPanel = new SettingsPanel(settings, audio);
const fullscreenButton = createFullscreenButton();
const menu = new MainMenu(progress);
menu.onSettings = () => settingsPanel.open();
// `?play` (rematch) and the developer parameters skip the menu and start a new match. Otherwise a
// refresh during a match resumes it straight away; a new visit, or going back to the main menu,
// offers the saved match next to a new one.
const skipMenu = ['play', 'ai', 'solo', 'gold', 'side', 'mode'].some((k) => params.has(k));
const saved = skipMenu ? undefined : loadSave();
let refreshed = false;
try { refreshed = sessionStorage.getItem(IN_MATCH_KEY) === '1'; } catch { /* storage blocked */ }
let resume: SavedMatch | undefined;
let config;
if (saved && refreshed) {
  resume = saved;
  config = saved.config;
} else {
  const choice = skipMenu ? loadConfig() : await menu.choose(loadConfig(), saved && describeSave(saved));
  if (choice === 'resume') {
    resume = saved;
    config = saved!.config;
  } else {
    config = choice;
    // Remember menu choices only; URL overrides are for one visit, the tutorial is its own thing.
    if (!skipMenu && !config.tutorial) saveConfig(config);
    clearSave();
  }
}
try { sessionStorage.setItem(IN_MATCH_KEY, '1'); } catch { /* storage blocked */ }
// A rematch's `?play` has done its job; a refresh from here resumes instead of starting over.
if (params.has('play')) history.replaceState(null, '', location.pathname);
menu.showLoading(!!resume);
const data = await dataLoading;

const { player: PLAYER, slots } = matchSlots(config);
const seed = resume?.seed ?? Date.now() % 100000;
const match = createMatch(data, { players: slots, mode: config.mode, seed });
const bots = slots.filter((p) => p !== PLAYER).map((p) => new Bot(match, p, { difficulty: config.difficulty }));
const world = match.world;
// `?gold=20000` starts with extra gold, for trying ships while developing.
const devGold = import.meta.env.DEV && params.has('gold') ? Number(params.get('gold')) || 20000 : undefined;
const startGold = resume ? resume.gold : devGold;
if (startGold) match.players.get(PLAYER)!.gold = startGold;
const spawnShip = world.ships.get(match.players.get(PLAYER)!.shipId!)!;
const spawn = { x: spawnShip.x, y: spawnShip.y };

// Resuming: replay the saved match behind the loading screen; match stats come from its events,
// and the buildings it destroyed are taken off the map below.
const results = new Results(match, PLAYER);
const destroyed = new Set<string>();
let replayOk = true;
if (resume) {
  replayOk = await replay(resume, match, bots, (events) => {
    results.onEvents(events);
    for (const e of events) if (e.kind === 'death' && e.structure) destroyed.add(`${e.x},${e.y}`);
  }, (f) => menu.setStatus(`正在恢复对局 ${Math.round(f * 100)}%`, f));
  menu.setStatus(undefined);
}
const recorder = new Recorder(match, config, seed, startGold);
if (resume) recorder.resume(resume);
await loading;
menu.close();

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

const fog = new FogLayer(world, match.players.get(PLAYER)!.team);
scene.add(createTerrainMesh(data.terrain, fog));
scene.add(createWater(data.terrain, fog, settings.quality !== 'low'));
const doodads = createDoodads(data.doodads);
scene.add(doodads);
// The other modes take the 商船任务 shops (奸商, 贸易主, 潜艇工厂) off the map, as the original does.
const placements = data.map.placements.filter((p) => match.mode === 'traders' || !TRADER_SHOPS.has(p.id));
const buildingGroup = createBuildings(placements, data.unitsById, data.terrain);
for (const mesh of [...buildingGroup.children]) if (destroyed.has(`${mesh.userData.mapX},${mesh.userData.mapY}`)) mesh.removeFromParent();
scene.add(buildingGroup);
scene.add(createRepairDocks((['south', 'north'] as const).map((team) => ({ team, ...match.rectCenter(REPAIR_RECTS[team].station) })), data.terrain));
// Link each building mesh to its simulated structure, to remove it when destroyed.
const buildingMeshes = new Map<number, THREE.Object3D>();
for (const s of world.structures.values()) {
  const mesh = buildingGroup.children.find((c) => c.userData.mapX === s.x && c.userData.mapY === s.y);
  if (mesh) buildingMeshes.set(s.id, mesh);
}

// Handy in the browser console while developing.
if (import.meta.env.DEV) Object.assign(window, { boom: { scene, match, world, renderer, get rts() { return rts; }, get effects() { return effects; }, get hud() { return hudPanel; }, get overlay() { return overlay; }, get audio() { return audio; }, get music() { return music; }, get input() { return input; } } });

const shipViews = new ShipViews(world, match.players.get(PLAYER)!.team);
scene.add(shipViews.group);
const effects = new Effects();
scene.add(effects.group);
const wakes = new Wakes(world, match.players.get(PLAYER)!.team);
scene.add(wakes.mesh);
const weatherView = new WeatherView();
scene.add(weatherView.group);
weatherView.set(match.weather);
environment.setWeather(match.weather);
const combatFx = new CombatFx(effects, match, match.players.get(PLAYER)!.team);
// Shells land with their own impacts (projectiles.ts), styled by the weapon that fired them.
const projectileViews = new ProjectileViews(world, effects, new Map(data.weapons.map((w) => [w.id, w])));
projectileViews.sees = (x, y) => world.vision.sees(match.players.get(PLAYER)!.team, x, y);
scene.add(projectileViews.group);
const overlay = new Overlay(match, PLAYER);
const hudPanel = new Hud(match, PLAYER, data);
createVolumeControl(audio);
settingsPanel.enterMatch();
fullscreenButton?.classList.add('in-match');
settingsPanel.canPause = () => !match.winner;
const tips = new OpeningTips(match, PLAYER, hudPanel.column, data.terrain, spawn, !config.tutorial);
settingsPanel.onResetTips = () => tips.reopen();
settingsPanel.onSurrender = () => { if (!match.winner) match.issue({ kind: 'surrender', player: PLAYER }); };
const soundFx = new SoundFx(audio, music, match, PLAYER);
hudPanel.onAnnounce = () => soundFx.announce();
const shipTypes = new Map(data.ships.map((s) => [s.id, s]));
const info = new Info(match, PLAYER, { ships: shipTypes, units: data.unitsById, items: data.itemsById, weapons: new Map(data.weapons.map((w) => [w.id, w])) });
const codex = new Codex(match, info, new Catalog(match, PLAYER, data.unitsById, data.itemsById, data.map.bounds));
/** The settings panel and the codex pause the match; everything else keeps drawing. */
const paused = () => settingsPanel.paused || codex.isOpen;
const tooltip = new Tooltip((key) => {
  const [kind, id = ''] = key.split(':');
  if (kind === 'ship') return info.ship(id);
  if (kind === 'item') return info.item(id);
  if (kind === 'skill') { const a = world.abilities.byId.get(id); return a ? info.skill(a) : ''; }
  if (kind === 'slot') { const itemId = match.players.get(PLAYER)!.items[Number(id)]; return itemId ? info.item(itemId, Number(id)) : ''; }
  return '';
});

const rts = new RtsCamera(renderer.domElement, data.map.bounds);
projectileViews.onHeavyImpact = (x, y, power) => {
  const d = Math.hypot(x - rts.target.x, y + rts.target.z);
  if (d < rts.viewDistance) rts.shake(power * (1 - d / rts.viewDistance));
};
// Created before selection input so its capture-phase listener sees targeting clicks first.
const skillBar = new SkillBar(match, PLAYER, data.itemsById, rts, renderer.domElement);
let speed = settings.speed;
settingsPanel.onChange = (s) => {
  overlay.showDamage = s.damageNumbers;
  rts.edgePan = s.edgePan;
  if (s.speed !== speed) hudPanel.say(`游戏速度 ${s.speed}×`, performance.now(), 1500);
  speed = s.speed;
};
settingsPanel.onChange(settings);
const input = new SelectionInput(renderer.domElement, rts, match, PLAYER);
input.buildings = buildingGroup;
const selectionPanel = new SelectionPanel(match, PLAYER, { units: data.unitsById, items: data.itemsById });
selectionPanel.onSail = (x, y) => input.orderAt(x, y);
const buildings = placements.filter((p) => data.unitsById.get(p.id)?.isBuilding && p.id !== 'hhou');
const minimap = new Minimap(data.terrain, data.pathingInfo, data.pathingCells, buildings, data.unitsById, world, rts, PLAYER);
minimap.onOrder = (x, y) => input.orderAt(x, y);
const tutorial = config.tutorial ? new Tutorial(match, PLAYER, spawn, rts, data.terrain, resume?.tutorialStep) : undefined;
if (tutorial) {
  recorder.tutorialStep = () => tutorial.step;
  tutorial.onExit = () => {
    recorder.finish();
    try { sessionStorage.removeItem(IN_MATCH_KEY); } catch { /* storage blocked */ }
    location.href = location.pathname;
  };
}
// The player's ship (sunk when a resumed match was saved mid-respawn: the camera waits at the spawn).
const firstShip = world.ships.get(match.players.get(PLAYER)!.shipId ?? -1);
if (firstShip) input.selected.add(firstShip.id);
rts.lookAt(firstShip?.x ?? spawn.x, (firstShip?.y ?? spawn.y) + 400);
if (resume) hudPanel.say(replayOk ? '已恢复上次的对局' : '已恢复上次的对局（游戏版本有更新，局面可能与保存时略有不同）', performance.now(), replayOk ? 3000 : 6000);
// Saved every few seconds and whenever the page may go away; a decided match is not kept.
let lastSave = performance.now();
const saveNow = () => { recorder.save(); lastSave = performance.now(); };
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

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

// Build every shader now, behind the loading screen, instead of mid-fight.
rts.update(0);
await prewarm(renderer, scene, rts.camera);
// The rest of the ships in the background; their shaders compile as they arrive.
void loadGlbModels(undefined, (kind, id) => !startingModel(kind, id)).then(() => prewarm(renderer, scene, rts.camera, true));

const perfGraph = new PerfGraph();
let frame = 0;
let accumulator = 0;
let last = performance.now();
let fps = 60;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  perfGraph.frame(now - last);
  const frameDt = Math.min(0.25, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(frameDt, 1e-3) - fps) * 0.05;

  accumulator = paused() ? 0 : accumulator + frameDt * speed;
  let ticks = 0;
  const maxTicks = Math.ceil(MAX_TICKS_PER_FRAME * Math.max(1, speed));
  while (accumulator >= TICK_DT && ticks < maxTicks) {
    recorder.recording = false;
    for (const bot of bots) bot.update();
    recorder.recording = true;
    match.step();
    overlay.onEvents(match.events, now);
    combatFx.onEvents(match.events);
    results.onEvents(match.events);
    soundFx.onEvents(match.events);
    hudPanel.onEvents(match.events, now);
    minimap.onEvents(match.events, now);
    tips.onEvents(match.events);
    tutorial?.onEvents(match.events);
    for (const e of match.events) {
      if (e.kind === 'death') buildingMeshes.get(e.unitId)?.removeFromParent();
      if (e.kind === 'weather') { weatherView.set(e.weather); environment.setWeather(e.weather); }
      if (e.kind === 'victory') recorder.finish();
      if (e.kind === 'respawn' && e.player === PLAYER) {
        const ship = world.ships.get(e.shipId)!;
        rts.lookAt(ship.x, ship.y);
      }
    }
    accumulator -= TICK_DT;
    ticks++;
  }
  if (ticks === maxTicks) accumulator = 0;
  if (now - lastSave > 5000) saveNow();

  // The player's ship changes on purchase and respawn; keep it selected.
  const own = match.players.get(PLAYER)!.shipId;
  for (const id of input.selected) if (!world.ships.has(id)) input.selected.delete(id);
  if (own !== undefined && input.selected.size === 0) input.selected.add(own);

  rts.update(frameDt);
  environment.update(rts.camera, rts.target, rts.viewDistance, world.tick, frameDt);
  weatherView.update(frameDt, rts.target, rts.camera, rts.viewDistance);
  wakes.update(paused() ? 0 : frameDt);
  fog.update(frameDt);
  if (frame % 6 === 0) fog.tintInstances(doodads);
  soundFx.update(rts.target.x, -rts.target.z, rts.viewDistance);
  const alpha = accumulator / TICK_DT;
  // A selected enemy or creep gets the selection ring too (it is only inspected, not ordered).
  // An inspected unit that sinks or slips into the fog is deselected, as in Warcraft.
  if (input.focus?.kind === 'unit') {
    const u = world.unit(input.focus.id);
    if (!u || (u.kind === 'ship' && !world.seenBy(ownTeam, u))) input.focus = undefined;
  }
  const ringed = input.focus?.kind === 'unit' ? new Set([...input.selected, input.focus.id]) : input.selected;
  shipViews.update(alpha, now / 1000, ringed, frameDt);
  projectileViews.update(alpha, paused() ? 0 : frameDt);
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

  if (innerWidth > 0 && innerHeight > 0) renderer.render(scene, rts.camera);
  overlay.draw(rts.camera, now);
  minimap.marks = hudPanel.questSpots;
  minimap.draw();
  hudPanel.update(now);
  tips.update(now, rts.camera, input.focus?.kind === 'shop');
  tutorial?.update(now, rts.camera, input.focus?.kind === 'shop', codex.isOpen);
  // The bottom panel shows the inspected unit or shop, else the player's own ship.
  skillBar.setVisible(!selectionPanel.update(input.focus));
  skillBar.update();

  if (++frame % 6 === 0) { hoverUnit(); tooltip.refresh(); }
  hud.textContent = `${data.map.version} · ${backendName} · ${fps.toFixed(0)} FPS`;
});
