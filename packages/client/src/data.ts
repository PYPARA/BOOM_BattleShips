// Loads the extracted game data. Each JSON file is its own lazily loaded chunk so the
// app bundle stays small; the binary pathing grid is fetched.
import type { Doodad, MapInfo, PathingInfo, Ship, Terrain, Unit } from '@boom/gamedata';
import pathingBinUrl from '@boom/gamedata/generated/pathing.bin?url';

export interface ClientData {
  ships: Ship[];
  units: Unit[];
  unitsById: Map<string, Unit>;
  map: MapInfo;
  terrain: Terrain;
  doodads: Doodad[];
  pathingInfo: PathingInfo;
  pathingCells: Uint8Array;
}

export async function loadData(): Promise<ClientData> {
  const [response, ships, units, map, terrain, doodads, pathingInfo] = await Promise.all([
    fetch(pathingBinUrl),
    import('@boom/gamedata/generated/ships.json').then((m) => m.default as Ship[]),
    import('@boom/gamedata/generated/units.json').then((m) => m.default as Unit[]),
    import('@boom/gamedata/generated/map.json').then((m) => m.default as MapInfo),
    import('@boom/gamedata/generated/terrain.json').then((m) => m.default as Terrain),
    import('@boom/gamedata/generated/doodads.json').then((m) => m.default as Doodad[]),
    import('@boom/gamedata/generated/pathing.json').then((m) => m.default as PathingInfo),
  ]);
  if (!response.ok) throw new Error(`Failed to load pathing grid: ${response.status}`);
  return {
    ships,
    units,
    unitsById: new Map(units.map((u) => [u.id, u])),
    map,
    terrain,
    doodads,
    pathingInfo,
    pathingCells: new Uint8Array(await response.arrayBuffer()),
  };
}
