// Placeholder geometry for map doodads (trees, rocks, plants) and preplaced buildings.
// Real models come from the AI art pipeline later; these only need the right size and place.
import * as THREE from 'three/webgpu';
import type { Doodad, Placement, Terrain, Unit } from '@boom/gamedata';
import { glbModel } from './models/glb.ts';
import { groundHeightAt, SEA_LEVEL, TEAM_COLORS, teamOf, toThree } from './space.ts';

/** On-screen heights for pulled building models, matching the placeholder proportions. */
const BUILDING_HEIGHTS: Record<string, number> = { n000: 320, n003: 130, h00K: 230, h00M: 250, h012: 290 };

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

export function createDoodads(doodads: Doodad[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'doodads';
  const byKind = new Map<DoodadKind, Doodad[]>();
  for (const d of doodads) {
    const kind = doodadKind(d.id);
    byKind.set(kind, [...(byKind.get(kind) ?? []), d]);
  }
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [kind, list] of byKind) {
    const part = DOODAD_PARTS[kind];
    const material = new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.9, flatShading: true });
    const mesh = new THREE.InstancedMesh(part.geometry, material, list.length);
    list.forEach((d, i) => {
      // Water plants float on the surface; everything else stands on the ground.
      const z = kind === 'plant' ? Math.max(d.z, SEA_LEVEL) : d.z;
      toThree(d.x, d.y, z, position);
      quaternion.setFromAxisAngle(up, d.angle);
      const s = (d.scale[0] + d.scale[1] + d.scale[2]) / 3;
      scale.set(s, s * (0.85 + ((i * 7919) % 30) / 100), s);
      mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
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
    const mesh = glbModel('buildings', p.id, color, { height: BUILDING_HEIGHTS[p.id] ?? (unit.collision ?? 48) * 4 }) ?? buildingMesh(unit, color);
    const ground = Math.max(groundHeightAt(terrain, p.x, p.y), SEA_LEVEL - 20);
    toThree(p.x, p.y, ground, mesh.position);
    mesh.rotation.y = THREE.MathUtils.degToRad(p.facing);
    mesh.scale.multiplyScalar(unit.modelScale ?? 1); // on top of any GLB normalization
    mesh.userData.unitId = p.id;
    group.add(mesh);
  }
  return group;
}
