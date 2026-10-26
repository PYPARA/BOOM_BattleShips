// Builds a World from the extracted game data.
import type { Item, MapInfo, PathingInfo, Ship, Terrain, Unit, Weapon } from '@boom/gamedata';
import { Match, type GameMode } from './match.ts';
import { PathGrid } from './pathing.ts';
import { World } from './world.ts';

export interface GameData {
  ships: Ship[];
  units: Unit[];
  weapons: Weapon[];
  items: Item[];
  misc?: Record<string, unknown>;
  map: MapInfo;
  terrain: Pick<Terrain, 'originX' | 'originY'>;
  pathingInfo: PathingInfo;
  pathingCells: Uint8Array;
}

export function createWorld(data: GameData, seed = 1): World {
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
  return new World(grid, data, seed);
}

/** A full match: structures placed, the given player slots each with a starting ship. */
export function createMatch(data: GameData, options: { players: number[]; mode?: GameMode; seed?: number }): Match {
  return new Match(createWorld(data, options.seed), data, options);
}
