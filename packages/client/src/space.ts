// Simulation space is the Warcraft map plane: x east, y north, z up.
// three.js space is x east, y up, z south, so sim (x, y) maps to three (x, -y).
import * as THREE from 'three/webgpu';
import type { Terrain } from '@boom/gamedata';

/** Sea surface height in world units; almost every water corner on the map uses it. */
export const SEA_LEVEL = 166;

export function toThree(x: number, y: number, height = SEA_LEVEL, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, height, -y);
}

export const TEAM_COLORS = { south: 0x3f7fe0, north: 0xe0483c, neutral: 0x9a8f80 } as const;

export function teamOf(player: number): keyof typeof TEAM_COLORS {
  if (player === 0 || (player >= 2 && player <= 6)) return 'south';
  if (player === 1 || (player >= 7 && player <= 11)) return 'north';
  return 'neutral';
}

/** Bilinear ground height from the terrain corner grid. */
export function groundHeightAt(terrain: Terrain, x: number, y: number): number {
  const fx = (x - terrain.originX) / 128, fy = (y - terrain.originY) / 128;
  const cx = Math.max(0, Math.min(terrain.width - 2, Math.floor(fx)));
  const cy = Math.max(0, Math.min(terrain.height - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - cx)), ty = Math.max(0, Math.min(1, fy - cy));
  const h = (i: number, j: number) => terrain.groundHeight[j * terrain.width + i]!;
  const a = h(cx, cy) * (1 - tx) + h(cx + 1, cy) * tx;
  const b = h(cx, cy + 1) * (1 - tx) + h(cx + 1, cy + 1) * tx;
  return a * (1 - ty) + b * ty;
}
