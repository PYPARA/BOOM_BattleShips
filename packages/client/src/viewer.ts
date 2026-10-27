// Side-by-side viewer: a concept image next to the model rendered from the same angle, for
// checking models against the art. Open /viewer.html on the dev server; /viewer.html?sheet
// lays out every pulled ship in one grid with its engine rig, for a quick review.
import * as THREE from 'three/webgpu';
import { glbIds, glbModel, glbVersion, loadGlbModels } from './models/glb.ts';
import { shipConcepts, shipModels } from './models/index.ts';
import { withEngineRig } from './models/rigs.ts';
import { TEAM_COLORS } from './space.ts';

const concepts = import.meta.glob('../../../art/concepts/preview/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const conceptUrl = (name: string) => Object.entries(concepts).find(([path]) => path.endsWith(`/${name}.jpg`))?.[1];
/** Concept file stem (`H005_nautilus`) for a ship id, from the preview file names. */
const conceptOf = (id: string) => shipConcepts[id] ?? Object.keys(concepts).map((p) => /\/([^/]+)_34\.jpg$/.exec(p)?.[1]).find((n) => n?.startsWith(`${id}_`));
/** Ship lengths by size class (docs/art/README.md); NPC fleet models by their class. */
const LENGTHS: Record<string, number> = { 小型: 120, 中型: 165, 大型: 210, 巨大: 255 };
const NPC_LENGTHS: Record<string, number> = { h00I: 100, h00B: 150, h00H: 200, h018: 300 };
const shipsData = (await import('@boom/gamedata/generated/ships.json')).default as { id: string; name: string; size: string }[];
const lengthOf = (id: string) => NPC_LENGTHS[id] ?? LENGTHS[shipsData.find((s) => s.id === id)?.size ?? ''] ?? 165;
const nameOf = (id: string) => shipsData.find((s) => s.id === id)?.name ?? id;

await loadGlbModels();
const stage = document.getElementById('stage')!;
const img = document.getElementById('concept') as HTMLImageElement;
const controls = document.getElementById('controls')!;

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdedede);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(300, 500, -200);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-300, 200, 300);
scene.add(fill);
const camera = new THREE.PerspectiveCamera(28, 1, 1, 5000);

const ids = [...new Set([...glbIds('ships'), ...Object.keys(shipModels)])];
const state = { id: ids[0]!, view: '34' as '34' | 'side', team: 'south' as 'south' | 'north', spin: false, rig: false };
let model: THREE.Object3D | undefined;

function frame() {
  if (!model) return;
  // Only visible parts count, so hidden rigging does not shrink the model on screen.
  const box = new THREE.Box3();
  model.updateMatrixWorld(true); // GLB models carry a normalizing scale on their wrapper
  model.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) box.expandByObject(o); });
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  // Concept 3/4 views show the bow (+x) coming toward the viewer on the left.
  const dir = state.view === '34' ? new THREE.Vector3(0.4, 0.55, -0.85) : new THREE.Vector3(0, 0.02, 1);
  // Fit the bounding sphere in the narrower of the two field-of-view angles.
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const fov = Math.min(vFov, 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect));
  camera.position.copy(center).addScaledVector(dir.normalize(), (size / 2 / Math.sin(fov / 2)) * (state.view === '34' ? 0.9 : 0.95));
  camera.lookAt(center);
}

function load() {
  render();
  if (model) scene.remove(model);
  // Same priority as the game: the Aha GLB when one was pulled, else the procedural model.
  const length = lengthOf(state.id);
  const glb = glbModel('ships', state.id, TEAM_COLORS[state.team], { length });
  model = (glb && withEngineRig(glb, state.id, length, TEAM_COLORS[state.team])) ?? shipModels[state.id]?.(TEAM_COLORS[state.team]) ?? new THREE.Group();
  const caption = stage.querySelector('figcaption')!;
  const version = glbVersion('ships', state.id);
  caption.textContent = version ? `Aha 模型 ${version}` : 'Three.js 程序化模型';
  // Concept art has no rigging (the engine generates it), so hide it unless asked.
  const rig = model.getObjectByName('rig');
  if (rig) rig.visible = state.rig;
  scene.add(model);
  frame();
  const url = conceptUrl(`${conceptOf(state.id)}_${state.view}`);
  if (url) img.src = url;
  render();
}

function render() {
  const rect = stage.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false); // CSS sizes the canvas; avoid a resize feedback loop
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  for (const b of controls.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.key === state.id || b.dataset.key === state.view || b.dataset.key === state.team || (b.dataset.key === 'spin' && state.spin) || (b.dataset.key === 'rig' && state.rig)));
  }
}

function button(label: string, key: string, onClick: () => void) {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.key = key;
  b.addEventListener('click', () => { onClick(); load(); });
  controls.appendChild(b);
}
const sep = () => controls.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }));
for (const id of ids) button(`${id} ${nameOf(id)}`, id, () => { state.id = id; });
sep();
button('3/4 视角', '34', () => { state.view = '34'; });
button('侧视', 'side', () => { state.view = 'side'; });
sep();
button('南方', 'south', () => { state.team = 'south'; });
button('北方', 'north', () => { state.team = 'north'; });
button('显示帆', 'rig', () => { state.rig = !state.rig; });
button('旋转', 'spin', () => { state.spin = !state.spin; });

window.addEventListener('resize', render);
if (new URLSearchParams(location.search).has('sheet')) showSheet();
else load();

/** Every ship in a grid, 3/4 view with rigs, true relative size; labels list the order. */
function showSheet(): void {
  document.querySelector('main')!.setAttribute('style', 'display:block;max-width:none');
  img.parentElement!.remove();
  stage.setAttribute('style', 'aspect-ratio:auto;height:calc(100vh - 20px)');
  controls.textContent = ids.map((id, i) => `${i + 1}.${id} ${nameOf(id)}`).join('  ');
  const cols = Math.ceil(Math.sqrt(ids.length * 1.3)), cell = 330;
  ids.forEach((id, i) => {
    const length = lengthOf(id);
    const glb = glbModel('ships', id, TEAM_COLORS.south, { length });
    const m = (glb && withEngineRig(glb, id, length, TEAM_COLORS.south)) ?? shipModels[id]?.(TEAM_COLORS.south);
    if (!m) return;
    m.position.set((i % cols) * cell, 0, Math.floor(i / cols) * cell * 0.75);
    scene.add(m);
  });
  const rows = Math.ceil(ids.length / cols);
  const center = new THREE.Vector3(((cols - 1) * cell) / 2, 0, ((rows - 1) * cell * 0.75) / 2);
  camera.fov = 22;
  camera.position.copy(center).add(new THREE.Vector3(900, 2300, 2700));
  camera.lookAt(center);
  model = undefined;
  render();
}
renderer.setAnimationLoop(() => {
  if (model) model.rotation.y = state.spin ? model.rotation.y + 0.01 : 0;
  renderer.render(scene, camera);
});
