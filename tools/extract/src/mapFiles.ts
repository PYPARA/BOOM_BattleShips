// Parsers for the map's terrain (w3e), pathing (wpm) and doodad (doo) files.
import type { Doodad, PathingInfo, Terrain } from '@boom/gamedata';

export function parseTerrain(buf: Buffer): Terrain {
  let p = 0;
  const int = () => { const v = buf.readInt32LE(p); p += 4; return v; };
  const id = () => { const s = buf.toString('latin1', p, p + 4); p += 4; return s; };
  if (id() !== 'W3E!') throw new Error('Not a w3e file');
  const version = int();
  if (version !== 11) throw new Error(`Unsupported w3e version ${version}`);
  const tileset = buf.toString('latin1', p, p + 1); p += 1;
  int(); // custom tilesets flag
  const groundTiles = Array.from({ length: int() }, id);
  const cliffTiles = Array.from({ length: int() }, id);
  void cliffTiles;
  const width = int(), height = int();
  const originX = buf.readFloatLE(p), originY = buf.readFloatLE(p + 4); p += 8;

  const n = width * height;
  const terrain: Terrain = {
    width, height, originX, originY, tileset, groundTiles,
    groundHeight: new Array(n), waterHeight: new Array(n), isWater: new Array(n),
    groundTexture: new Array(n), cliffLevel: new Array(n),
  };
  for (let i = 0; i < n; i++, p += 7) {
    const rawHeight = buf.readInt16LE(p);
    const rawWater = buf.readInt16LE(p + 2) & 0x3fff;
    const flagsTexture = buf[p + 4]!;
    const layer = buf[p + 6]! & 0x0f;
    // Height conventions from the World Editor: 0x2000 is zero, 4 raw units per world unit,
    // each cliff layer above 2 adds 128.
    terrain.groundHeight[i] = Math.round((rawHeight - 0x2000) / 4 + (layer - 2) * 128);
    terrain.waterHeight[i] = Math.round((rawWater - 0x2000) / 4 - 89.6);
    terrain.isWater[i] = flagsTexture & 0x40 ? 1 : 0;
    terrain.groundTexture[i] = flagsTexture & 0x0f;
    terrain.cliffLevel[i] = layer;
  }
  return terrain;
}

export function parsePathing(buf: Buffer): { info: PathingInfo; cells: Buffer } {
  if (buf.toString('latin1', 0, 4) !== 'MP3W') throw new Error('Not a wpm file');
  const width = buf.readInt32LE(8), height = buf.readInt32LE(12);
  return {
    info: {
      width, height, cellSize: 32,
      flags: { noWalk: 0x02, noFly: 0x04, noBuild: 0x08, blight: 0x20, noWater: 0x40, unknown: 0x80 },
    },
    cells: buf.subarray(16, 16 + width * height),
  };
}

export function parseDoodads(buf: Buffer): Doodad[] {
  let p = 0;
  const int = () => { const v = buf.readInt32LE(p); p += 4; return v; };
  const float = () => { const v = buf.readFloatLE(p); p += 4; return v; };
  if (buf.toString('latin1', 0, 4) !== 'W3do') throw new Error('Not a doo file');
  p = 4;
  const version = int();
  int(); // subversion
  if (version !== 8) throw new Error(`Unsupported doo version ${version}`);
  const count = int();
  const doodads: Doodad[] = [];
  for (let i = 0; i < count; i++) {
    const id = buf.toString('latin1', p, p + 4); p += 4;
    const variation = int();
    const x = float(), y = float(), z = float(), angle = float();
    const scale: [number, number, number] = [float(), float(), float()];
    p += 2; // flags, life
    int(); // item table pointer
    const sets = int();
    for (let s = 0; s < sets; s++) p += int() * 8;
    int(); // editor id
    doodads.push({ id, variation, x: r(x), y: r(y), z: r(z), angle: r(angle, 1000), scale: [r(scale[0], 100), r(scale[1], 100), r(scale[2], 100)] });
  }
  return doodads;
}

function r(n: number, f = 1): number {
  return Math.round(n * f) / f;
}
