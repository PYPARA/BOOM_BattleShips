// Models built in Aha's 3D Workshop (docs/art/aha-workflow.md), pulled into
// public/models/<kind>/<id>.glb with a sidecar <id>.json. Aha exports meters, Y up, origin at
// the bottom center; ships face +X. Here they are normalized to game units: ships by length
// with the waterline on the sea surface, buildings by height standing on the ground.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Progress } from '../config.ts';

export type ModelKind = 'ships' | 'buildings' | 'creatures' | 'doodads';

interface Sidecar {
  versionName: string;
  waterline?: number;
  teamMaterials: string[];
}

interface Template {
  scene: THREE.Group;
  size: THREE.Vector3;
  min: THREE.Vector3;
  center: THREE.Vector3;
  sidecar: Sidecar;
}

/** Fraction of hull height under water when a model does not say. */
const DEFAULT_WATERLINE = 0.35;

const sidecars = import.meta.glob('../../public/models/*/*.json', { eager: true, import: 'default' }) as Record<string, Sidecar>;
const templates = new Map<string, Template>();
const teamMaterialCache = new Map<string, THREE.Material>();

/** Counts model loads, so views built before a model arrived can rebuild with it. */
let generation = 0;
export const glbGeneration = (): number => generation;

/**
 * Loads the pulled GLBs (those `include` accepts, or all) once; missing files are skipped. The
 * match loads what it needs at the start up front and the rest in the background.
 */
export async function loadGlbModels(progress?: Progress, include: (kind: string, id: string) => boolean = () => true): Promise<void> {
  const loader = new GLTFLoader();
  const wanted = Object.entries(sidecars).flatMap(([path, sidecar]) => {
    const match = /models\/(\w+)\/(\w+)\.json$/.exec(path);
    return match && include(match[1]!, match[2]!) && !templates.has(`${match[1]}/${match[2]}`) ? [{ kind: match[1]!, id: match[2]!, sidecar }] : [];
  });
  progress?.add(wanted.length);
  await Promise.all(wanted.map(async ({ kind, id, sidecar }) => {
    try {
      // The version in the URL lets hosts cache models for good; a new pull changes it.
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${kind}/${id}.glb?v=${encodeURIComponent(sidecar.versionName ?? '')}`);
      const scene = mergeByMaterial(gltf.scene);
      const box = new THREE.Box3().setFromObject(scene);
      templates.set(`${kind}/${id}`, {
        scene,
        size: box.getSize(new THREE.Vector3()),
        min: box.min.clone(),
        center: box.getCenter(new THREE.Vector3()),
        sidecar,
      });
      generation++;
    } catch (error) {
      console.warn(`Could not load model ${kind}/${id}:`, error);
    }
    progress?.tick();
  }));
}

/**
 * Aha models arrive as hundreds of small named parts (the lord had 1031). Bake each part's
 * transform and merge everything that shares a material into one mesh, so a model costs
 * one draw call per material instead of one per part.
 */
function mergeByMaterial(source: THREE.Object3D): THREE.Group {
  source.updateMatrixWorld(true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  source.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    let g = mesh.geometry.clone();
    // Baked models store positions and normals as normalized integers (bake-models.ts): back to
    // floats before baking the part's transform in, which integers could not hold.
    for (const name of ['position', 'normal'] as const) {
      const a = g.getAttribute(name);
      if (a && !(a.array instanceof Float32Array)) {
        const floats = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) floats.set([a.getX(i), a.getY(i), a.getZ(i)], i * 3);
        g.setAttribute(name, new THREE.BufferAttribute(floats, 3));
      }
    }
    g.applyMatrix4(mesh.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    // Some models paint with vertex colors (Aha decorations); keep them, as RGB, where the
    // material uses them, and give uncolored parts white so the merged attributes line up.
    const keepColor = (mesh.material as THREE.MeshStandardMaterial).vertexColors === true;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(keepColor && name === 'color')) g.deleteAttribute(name);
    if (keepColor) {
      const c = g.getAttribute('color');
      const rgb = new Float32Array(g.getAttribute('position').count * 3).fill(1);
      if (c) for (let i = 0; i < c.count; i++) rgb.set([c.getX(i), c.getY(i), c.getZ(i)], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    byMaterial.set(mesh.material, [...(byMaterial.get(mesh.material) ?? []), g]);
  });
  const group = new THREE.Group();
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = material.name;
    group.add(mesh);
  }
  return group;
}

export function hasGlbModel(kind: ModelKind, id: string): boolean {
  return templates.has(`${kind}/${id}`);
}

/** Version label of a pulled model, for the viewer. */
/** Ids of the loaded models of a kind, e.g. every pulled ship. */
export function glbIds(kind: ModelKind): string[] {
  return [...templates.keys()].filter((k) => k.startsWith(`${kind}/`)).map((k) => k.slice(kind.length + 1)).sort();
}

export function glbVersion(kind: ModelKind, id: string): string | undefined {
  return templates.get(`${kind}/${id}`)?.sidecar.versionName;
}

/**
 * A normalized copy of a pulled model, or undefined when there is none. Ships and creatures are
 * scaled to `length` along X; buildings and doodads to `height`. Team materials are recolored.
 */
export function glbModel(kind: ModelKind, id: string, teamColor: THREE.ColorRepresentation, size: { length?: number; height?: number }): THREE.Group | undefined {
  const t = templates.get(`${kind}/${id}`);
  if (!t) return undefined;
  const model = t.scene.clone(true);
  const team = new Set(t.sidecar.teamMaterials);
  const color = new THREE.Color(teamColor);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      if (!team.has(m.name)) return m;
      const key = `${m.uuid}:${color.getHexString()}`;
      let tinted = teamMaterialCache.get(key);
      if (!tinted) {
        tinted = m.clone();
        (tinted as THREE.MeshStandardMaterial).color?.copy(color);
        teamMaterialCache.set(key, tinted);
      }
      return tinted;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });

  // Ships and sea creatures are sized by length and float at their waterline.
  const floats = kind === 'ships' || kind === 'creatures';
  const scale = floats ? (size.length ?? 150) / t.size.x : (size.height ?? 200) / t.size.y;
  // Height of the waterline above the model's bottom (the sidecar value is already that).
  const waterline = floats ? (t.sidecar.waterline ?? t.size.y * DEFAULT_WATERLINE) : 0;
  // Center on x/z, put the waterline (ships) or the base (buildings) at y = 0.
  model.position.set(-t.center.x, -(t.min.y + waterline), -t.center.z);
  const wrapper = new THREE.Group();
  wrapper.name = `${kind}/${id}`;
  wrapper.scale.setScalar(scale);
  wrapper.add(model);
  return wrapper;
}

const partsCache = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material }[]>();

/**
 * A model as bare geometry + material pairs, scaled to `height` and standing on y = 0, for
 * instancing (map doodads draw the same few models thousands of times).
 */
export function glbParts(kind: ModelKind, id: string, height: number): { geometry: THREE.BufferGeometry; material: THREE.Material }[] | undefined {
  const key = `${kind}/${id}@${height}`;
  const cached = partsCache.get(key);
  if (cached) return cached;
  const t = templates.get(`${kind}/${id}`);
  if (!t) return undefined;
  const s = height / t.size.y;
  const m = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-t.center.x, -t.min.y, -t.center.z));
  const parts = t.scene.children
    .filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh)
    .map((mesh) => ({ geometry: mesh.geometry.clone().applyMatrix4(m), material: mesh.material as THREE.Material }));
  partsCache.set(key, parts);
  return parts;
}
