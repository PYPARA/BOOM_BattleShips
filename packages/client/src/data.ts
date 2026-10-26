// Loads the extracted game data. Each JSON file is its own lazily loaded chunk so the
// app bundle stays small; the binary pathing grid is fetched.
import type { Ability, Doodad, Item, MapInfo, PathingInfo, Ship, Terrain, Unit, Weapon } from '@boom/gamedata';
import pathingBinUrl from '@boom/gamedata/generated/pathing.bin?url';

export interface ClientData {
  ships: Ship[];
  units: Unit[];
  unitsById: Map<string, Unit>;
  weapons: Weapon[];
  items: Item[];
  itemsById: Map<string, Item>;
  misc: Record<string, unknown>;
  abilities: Ability[];
  map: MapInfo;
  terrain: Terrain;
  doodads: Doodad[];
  pathingInfo: PathingInfo;
  pathingCells: Uint8Array;
}

export async function loadData(): Promise<ClientData> {
  const [response, ships, units, map, terrain, doodads, pathingInfo, weapons, items, misc, abilities] = await Promise.all([
    fetch(pathingBinUrl),
    import('@boom/gamedata/generated/ships.json').then((m) => m.default as Ship[]),
    import('@boom/gamedata/generated/units.json').then((m) => m.default as Unit[]),
    import('@boom/gamedata/generated/map.json').then((m) => m.default as MapInfo),
    import('@boom/gamedata/generated/terrain.json').then((m) => m.default as Terrain),
    import('@boom/gamedata/generated/doodads.json').then((m) => m.default as Doodad[]),
    import('@boom/gamedata/generated/pathing.json').then((m) => m.default as PathingInfo),
    import('@boom/gamedata/generated/weapons.json').then((m) => m.default as Weapon[]),
    import('@boom/gamedata/generated/items.json').then((m) => m.default as Item[]),
    import('@boom/gamedata/generated/misc.json').then((m) => m.default as Record<string, unknown>),
    import('@boom/gamedata/generated/abilities.json').then((m) => m.default as Ability[]),
  ]);
  if (!response.ok) throw new Error(`Failed to load pathing grid: ${response.status}`);
  return {
    ships,
    units,
    unitsById: new Map(units.map((u) => [u.id, u])),
    weapons,
    items,
    itemsById: new Map(items.map((i) => [i.id, i])),
    misc,
    abilities,
    map,
    terrain,
    doodads,
    pathingInfo,
    pathingCells: new Uint8Array(await response.arrayBuffer()),
  };
}
