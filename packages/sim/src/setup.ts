// Builds a World from the extracted game data.
import type { MapInfo, PathingInfo, Ship, Terrain, Unit } from '@boom/gamedata';
import { PathGrid } from './pathing.ts';
import { World } from './world.ts';

export interface GameData {
  ships: Ship[];
  units: Unit[];
  map: MapInfo;
  terrain: Pick<Terrain, 'originX' | 'originY'>;
  pathingInfo: PathingInfo;
  pathingCells: Uint8Array;
}

export function createWorld(data: GameData): World {
  const grid = new PathGrid({
    width: data.pathingInfo.width,
    height: data.pathingInfo.height,
    cellSize: data.pathingInfo.cellSize,
    originX: data.terrain.originX,
    originY: data.terrain.originY,
    cells: data.pathingCells,
    noWaterFlag: data.pathingInfo.flags.noWater,
  });
  // Preplaced buildings block ships; most stand on land already, towers and docks do not.
  const units = new Map(data.units.map((u) => [u.id, u]));
  grid.blockCircles(
    data.map.placements
      .filter((p) => units.get(p.id)?.isBuilding)
      .map((p) => ({ x: p.x, y: p.y, radius: units.get(p.id)!.collision ?? 48 })),
  );
  return new World(grid, data.ships);
}
