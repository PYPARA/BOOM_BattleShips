// Object modification files (war3map.w3a etc., format version 2).
// W3x2lni's SLK optimizer keeps levels 1–4 in the SLK tables and writes anything
// that does not fit (levels 5+) here as modifications.
export interface ObjectMod {
  field: string;
  level: number;
  /** 1..9 = DataA..DataI for ability-specific fields, 0 otherwise. */
  dataPointer: number;
  value: number | string;
}

export interface ModifiedObject {
  id: string;
  /** Present for custom objects: the id of the object they were copied from. */
  baseId?: string;
  mods: ObjectMod[];
}

export function parseObjectMods(buf: Buffer, withLevels: boolean): ModifiedObject[] {
  let p = 0;
  const int = () => { const v = buf.readInt32LE(p); p += 4; return v; };
  const id = () => { const s = buf.toString('latin1', p, p + 4); p += 4; return s; };
  const version = int();
  if (version !== 1 && version !== 2) throw new Error(`Unsupported object mod version ${version}`);

  const objects: ModifiedObject[] = [];
  for (const custom of [false, true]) {
    const count = int();
    for (let i = 0; i < count; i++) {
      const originalId = id();
      const newId = id();
      const mods: ObjectMod[] = [];
      const modCount = int();
      for (let m = 0; m < modCount; m++) {
        const field = id();
        const type = int();
        const level = withLevels ? int() : 0;
        const dataPointer = withLevels ? int() : 0;
        let value: number | string;
        if (type === 0) { value = buf.readInt32LE(p); p += 4; }
        else if (type === 1 || type === 2) { value = Math.round(buf.readFloatLE(p) * 1e4) / 1e4; p += 4; }
        else if (type === 3) { const end = buf.indexOf(0, p); value = buf.toString('utf8', p, end); p = end + 1; }
        else throw new Error(`Unknown mod value type ${type} in ${originalId}.${field}`);
        p += 4; // end marker
        mods.push({ field, level, dataPointer, value });
      }
      objects.push(custom ? { id: newId, baseId: originalId, mods } : { id: originalId, mods });
    }
  }
  return objects;
}

/** Ability fields that are not DataA–I, keyed by their modification id. */
const ABILITY_FIELDS: Record<string, string> = {
  aare: 'Area', acdn: 'Cool', amcs: 'Cost', adur: 'Dur', ahdu: 'HeroDur', aran: 'Rng',
  acas: 'Cast', atar: 'targs', abuf: 'BuffID', aeff: 'EfctID', aunt: 'UnitID',
  alev: 'levels', areq: 'reqLevel', alsk: 'levelSkip', apri: 'priority', achd: 'checkDep',
};

/** SLK column name (e.g. `DataA5`, `Cool6`) for an ability modification. */
export function abilityColumn(mod: ObjectMod): string {
  if (mod.dataPointer > 0) return `Data${String.fromCharCode(64 + mod.dataPointer)}${mod.level}`;
  const base = ABILITY_FIELDS[mod.field];
  if (!base) return mod.level > 0 ? `${mod.field}:${mod.level}` : mod.field; // unknown field: keep the raw id
  return mod.level > 0 ? `${base}${mod.level}` : base;
}
