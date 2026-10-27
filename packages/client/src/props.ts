// Map doodads (trees, rocks, plants, props) and preplaced buildings. Doodads use the Aha models
// in public/models/doodads (docs/art/batch-doodads.md), instanced per model; a type whose model
// is not pulled yet falls back to a simple placeholder shape.
import * as THREE from 'three/webgpu';
import type { Doodad, Placement, Terrain, Unit } from '@boom/gamedata';
import { glbModel, glbParts } from './models/glb.ts';
import { groundHeightAt, SEA_LEVEL, TEAM_COLORS, teamOf, toThree } from './space.ts';

/** On-screen heights for pulled building models, before the unit's own model scale. */
const BUILDING_HEIGHTS: Record<string, number> = {
  n000: 320, n003: 130, h00K: 230, h00M: 250, h012: 290, n001: 150, n002: 150, n00Y: 120, n012: 100,
  n011: 220, n005: 170, n014: 210, n00U: 220, repair: 120,
};

/** Building types without a model of their own borrow a close relative's (docs/art/batch-buildings.md). */
const BUILDING_MODELS: Record<string, string> = {
  n007: 'n001', n00Z: 'n001', n013: 'n011', n01H: 'n012', h01S: 'h00M',
  n00F: 'n002', n00E: 'n002', n00H: 'n002', n009: 'n002', n00B: 'n011', n008: 'n002', n00A: 'n002', n00C: 'n002', ncp2: 'n00Y',
};

type DoodadKind = 'tree' | 'rock' | 'plant' | 'prop';

/** Warcraft doodad ids encode the category in the second letter (T = tree, R = rock, W = water plant…). */
function doodadKind(id: string): DoodadKind {
  const c = id[1];
  if (c === 'T') return 'tree';
  if (c === 'R' || c === 'O') return 'rock';
  if (c === 'W') return 'plant';
  return 'prop';
}

const DOODAD_PARTS: Record<DoodadKind, { geometry: THREE.BufferGeometry; color: number }> = {
  tree: { geometry: new THREE.ConeGeometry(45, 170, 7).translate(0, 105, 0), color: 0x2f5e2a },
  rock: { geometry: new THREE.DodecahedronGeometry(45, 0).translate(0, 15, 0), color: 0x7b766c },
  plant: { geometry: new THREE.CylinderGeometry(22, 22, 3, 8).translate(0, 1, 0), color: 0x4f8a3c },
  prop: { geometry: new THREE.BoxGeometry(50, 50, 50).translate(0, 25, 0), color: 0x8a6a46 },
};

/** On-screen height of each doodad model before the map's own scale. */
const MODEL_HEIGHTS: Record<string, number> = {
  tree_broadleaf_a: 190, tree_broadleaf_b: 210, tree_pine_a: 215, tree_pine_b: 175, tree_palm_a: 220, tree_palm_b: 200,
  tree_dead: 160, bush_a: 60, bush_b: 60, flowers: 35, reeds: 85, lilypads: 8, seaweed: 45, rock_large: 90,
  rocks_small: 40, barrels_crates: 55, ruins_pillar: 140, shipwreck: 110,
};

/** Which models stand in for a Warcraft doodad type; `i` picks a variant. */
function doodadModels(d: Doodad): string[] {
  const id = d.id, c = id[1];
  if (c === 'T') {
    if (/d\d$/.test(id) || id === 'ZTd5') return ['tree_dead'];
    // Trees on the beach become palms.
    if (d.z < SEA_LEVEL + 70 || id.startsWith('B')) return ['tree_palm_a', 'tree_palm_b'];
    if (id.startsWith('L') || id.startsWith('Z') || id.startsWith('YTp')) return ['tree_pine_a', 'tree_pine_b'];
    return ['tree_broadleaf_a', 'tree_broadleaf_b'];
  }
  if (c === 'W') return /fl|fs|fp|fb/.test(id.slice(2)) ? ['lilypads'] : id.startsWith('N') ? ['seaweed'] : ['reeds'];
  if (c === 'R') return ['rock_large', 'rocks_small'];
  if (c === 'P') return /fw|fp|lp/.test(id.slice(2)) ? ['flowers'] : /rs/.test(id.slice(2)) ? ['rocks_small'] : ['bush_a', 'bush_b'];
  if (c === 'O') {
    if (/^VOf/.test(id)) return ['flowers'];
    if (/bt|sw|sv/.test(id.slice(2))) return ['shipwreck'];
    if (/^[ZD]/.test(id)) return ['ruins_pillar'];
    return ['barrels_crates'];
  }
  return ['ruins_pillar'];
}

export function createDoodads(doodads: Doodad[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'doodads';
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (d: Doodad, i: number, floats: boolean) => {
    // Water plants float on the surface; everything else stands on the ground.
    toThree(d.x, d.y, floats ? Math.max(d.z, SEA_LEVEL) : d.z, position);
    quaternion.setFromAxisAngle(up, d.angle);
    const s = (d.scale[0] + d.scale[1] + d.scale[2]) / 3;
    scale.set(s, s * (0.85 + ((i * 7919) % 30) / 100), s);
    return matrix.compose(position, quaternion, scale);
  };

  // Doodads with a pulled model, grouped by model.
  const byModel = new Map<string, Doodad[]>();
  const rest: Doodad[] = [];
  doodads.forEach((d, i) => {
    const options = doodadModels(d);
    const model = options[(i * 2654435761) % options.length >>> 0] ?? options[0]!;
    if (glbParts('doodads', model, MODEL_HEIGHTS[model] ?? 100)) byModel.set(model, [...(byModel.get(model) ?? []), d]);
    else rest.push(d);
  });
  for (const [model, list] of byModel) {
    const floats = model === 'lilypads' || model === 'seaweed';
    for (const part of glbParts('doodads', model, MODEL_HEIGHTS[model] ?? 100)!) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((d, i) => mesh.setMatrixAt(i, place(d, i, floats)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = model !== 'lilypads';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  doodads = rest;
  const byKind = new Map<DoodadKind, Doodad[]>();
  for (const d of doodads) {
    const kind = doodadKind(d.id);
    byKind.set(kind, [...(byKind.get(kind) ?? []), d]);
  }
  for (const [kind, list] of byKind) {
    const part = DOODAD_PARTS[kind];
    const material = new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.9, flatShading: true });
    const mesh = new THREE.InstancedMesh(part.geometry, material, list.length);
    list.forEach((d, i) => mesh.setMatrixAt(i, place(d, i, kind === 'plant')));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = kind !== 'plant';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function buildingMesh(unit: Unit, color: number): THREE.Object3D {
  const r = unit.collision ?? 48;
  const team = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.85 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.85 });
  const group = new THREE.Group();
  switch (unit.id) {
    case 'n000': { // main base: keep with a coloured roof
      const keep = new THREE.Mesh(new THREE.BoxGeometry(r * 3, 160, r * 3), stone);
      keep.position.y = 80;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 2.3, 140, 4), team);
      roof.position.y = 230;
      roof.rotation.y = Math.PI / 4;
      group.add(keep, roof);
      break;
    }
    case 'n003': { // shipyard: wooden pier with a crane
      const pier = new THREE.Mesh(new THREE.BoxGeometry(r * 4, 30, r * 1.6), wood);
      pier.position.y = 15;
      const crane = new THREE.Mesh(new THREE.BoxGeometry(14, 160, 14), team);
      crane.position.set(r, 95, 0);
      group.add(pier, crane);
      break;
    }
    case 'h00K': case 'h00M': case 'h012': { // towers
      const tall = unit.id === 'h012' ? 260 : 190;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.75, tall, 10), stone);
      body.position.y = tall / 2;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.6, 30, 10), team);
      cap.position.y = tall + 10;
      group.add(body, cap);
      break;
    }
    default: { // shops and other buildings: small house
      const house = new THREE.Mesh(new THREE.BoxGeometry(r * 2, 90, r * 2), stone);
      house.position.y = 45;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.6, 70, 4), team);
      roof.position.y = 125;
      roof.rotation.y = Math.PI / 4;
      group.add(house, roof);
    }
  }
  return group;
}

export function createBuildings(placements: Placement[], unitsById: Map<string, Unit>, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'buildings';
  for (const p of placements) {
    const unit = unitsById.get(p.id);
    if (!unit?.isBuilding || p.id === 'hhou') continue; // hhou: the script's hidden per-player helper
    const color = TEAM_COLORS[teamOf(p.player)];
    const model = BUILDING_MODELS[p.id] ?? p.id;
    const mesh = glbModel('buildings', model, color, { height: BUILDING_HEIGHTS[p.id] ?? BUILDING_HEIGHTS[model] ?? (unit.collision ?? 48) * 4 }) ?? buildingMesh(unit, color);
    const ground = Math.max(groundHeightAt(terrain, p.x, p.y), SEA_LEVEL - 20);
    toThree(p.x, p.y, ground, mesh.position);
    mesh.rotation.y = THREE.MathUtils.degToRad(p.facing);
    mesh.scale.multiplyScalar(unit.modelScale ?? 1); // on top of any GLB normalization
    mesh.userData.unitId = p.id;
    mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    mesh.userData.mapX = p.x; // lets the client match the mesh to its simulated structure
    mesh.userData.mapY = p.y;
    group.add(mesh);
  }
  return group;
}

/** The repair docks (a rect in the map, not a unit) beside each base. */
export function createRepairDocks(stations: { x: number; y: number; team: 'south' | 'north' }[], terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'repair-docks';
  for (const s of stations) {
    const mesh = glbModel('buildings', 'repair', TEAM_COLORS[s.team], { height: BUILDING_HEIGHTS.repair! });
    if (!mesh) continue;
    toThree(s.x, s.y, Math.max(groundHeightAt(terrain, s.x, s.y), SEA_LEVEL - 20), mesh.position);
    mesh.rotation.y = s.team === 'south' ? Math.PI / 2 : -Math.PI / 2;
    mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(mesh);
  }
  return group;
}
