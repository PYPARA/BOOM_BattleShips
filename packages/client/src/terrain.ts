// Island and seabed mesh built from the map's terrain corner grid.
import * as THREE from 'three/webgpu';
import type { Terrain } from '@boom/gamedata';
import { SEA_LEVEL } from './space.ts';

/** Placeholder colors for the Lordaeron Summer ground tiles the map uses. */
const TILE_COLORS: Record<string, number> = {
  Ldrt: 0x8a7150, Ldro: 0x76603f, Ldrg: 0x7e7c48, Lrok: 0x807b72, Lgrs: 0x5f8f3c, Lgrd: 0x4a7330,
};
const SAND = new THREE.Color(0xcdb98a);
const SEABED = new THREE.Color(0x2c5a5e);

export function createTerrainMesh(terrain: Terrain): THREE.Mesh {
  const { width: w, height: h } = terrain;
  const positions = new Float32Array(w * h * 3);
  const colors = new Float32Array(w * h * 3);
  const color = new THREE.Color();
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const height = terrain.groundHeight[k]!;
      positions.set([terrain.originX + i * 128, height, -(terrain.originY + j * 128)], k * 3);
      const tile = terrain.groundTiles[terrain.groundTexture[k]!] ?? 'Ldrt';
      color.set(TILE_COLORS[tile] ?? 0x888888);
      // Beaches near the waterline, darker seabed with depth.
      const aboveSea = height - SEA_LEVEL;
      if (aboveSea < 40) color.lerp(SAND, THREE.MathUtils.clamp(1 - aboveSea / 40, 0, 1) * 0.8);
      if (aboveSea < 0) color.lerp(SEABED, THREE.MathUtils.clamp(-aboveSea / 250, 0, 1));
      colors.set([color.r, color.g, color.b], k * 3);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      // Counter-clockwise seen from above: sim y maps to -z, which flips handedness.
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  return mesh;
}
