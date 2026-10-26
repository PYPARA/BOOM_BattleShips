// Extracts game data from the BOOM 海战 map into packages/gamedata/generated.
// Usage: node src/main.ts [path/to/map.w3x]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateScript, collectRawcodes, parseFunctions, parseMapInfo, parseTriggers, parseWts } from './jass.ts';
import { parseDoodads, parsePathing, parseTerrain } from './mapFiles.ts';
import { MpqArchive } from './mpq.ts';
import {
  buildAbilities, buildBuffs, buildItems, buildShips, buildUnits, buildUpgrades, buildWeapons, type ObjectSources,
} from './objects.ts';
import { parseObjectMods } from './objectMods.ts';
import { mergeProfiles, parseProfile } from './profile.ts';
import { shipSkillsReport } from './report.ts';
import { parseSlk } from './slk.ts';
import { cleanText } from './text.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const mapPath = resolve(process.argv[2] ?? join(root, 'data/qcloud_20120392.w3x'));
const outDir = join(root, 'packages/gamedata/generated');
const rawDir = join(root, 'data/raw');

const archive = new MpqArchive(readFileSync(mapPath));
const read = (name: string) => {
  const data = archive.read(name);
  if (!data) throw new Error(`Missing ${name} in ${mapPath}`);
  return data;
};
const text = (name: string) => read(name).toString('utf8');

const KNOWN_FILES = [
  'war3map.j', 'war3map.w3e', 'war3map.w3i', 'war3map.wts', 'war3map.w3a', 'war3map.doo', 'war3map.wpm',
  'war3map.mmp', 'war3map.shd', 'war3mapMap.blp', 'war3mapMisc.txt', 'war3mapSkin.txt', 'war3mapExtra.txt',
  'units\\UnitData.slk', 'units\\UnitBalance.slk', 'units\\UnitWeapons.slk', 'units\\UnitAbilities.slk', 'units\\UnitUI.slk',
  'units\\AbilityData.slk', 'units\\AbilityBuffData.slk', 'units\\ItemData.slk', 'units\\UpgradeData.slk',
  'units\\DestructableData.slk', 'Doodads\\Doodads.slk',
  'units\\CampaignUnitStrings.txt', 'units\\CampaignAbilityStrings.txt', 'units\\CommonAbilityStrings.txt',
  'units\\ItemStrings.txt', 'units\\ItemAbilityStrings.txt', 'units\\CampaignUpgradeStrings.txt',
];

function writeJson(name: string, value: unknown, compact = false) {
  writeFileSync(join(outDir, name), JSON.stringify(value, null, compact ? undefined : 2) + '\n');
}

function dumpRaw(script: string, annotated: string) {
  for (const name of KNOWN_FILES) {
    const data = archive.read(name);
    if (!data) continue;
    const path = join(rawDir, name.replaceAll('\\', '/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  writeFileSync(join(rawDir, 'war3map.annotated.j'), annotated);
  void script;
}

/** Names unknown archive entries by probing asset paths mentioned in the data and script. */
function inventoryAssets(sources: string[]): { files: string[]; unnamedBlocks: number } {
  const candidates = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/[\w\\/ .()-]+\.(?:mdx|mdl|blp|tga|wav|mp3|txt|slk|fdf|toc|w3\w)/gi)) {
      const path = m[0].trim().replaceAll('/', '\\');
      candidates.add(path);
      if (/\.mdl$/i.test(path)) candidates.add(path.replace(/\.mdl$/i, '.mdx'));
      if (/\.mdx$/i.test(path)) candidates.add(path.replace(/\.mdx$/i, '_portrait.mdx'));
    }
  }
  const named = new Set<number>();
  const files: string[] = [];
  for (const name of [...KNOWN_FILES, ...candidates]) {
    const index = archive.blockIndexOf(name);
    if (index === undefined || named.has(index)) continue;
    named.add(index);
    files.push(name);
  }
  return { files: files.sort(), unnamedBlocks: archive.blockCount - named.size };
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const script = text('war3map.j');
  const wts = parseWts(text('war3map.wts'));
  const strings = mergeProfiles(
    ...['units\\CampaignUnitStrings.txt', 'units\\CampaignAbilityStrings.txt', 'units\\CommonAbilityStrings.txt',
      'units\\ItemStrings.txt', 'units\\ItemAbilityStrings.txt', 'units\\CampaignUpgradeStrings.txt']
      .map((n) => parseProfile(text(n))),
  );
  const slk = (n: string) => parseSlk(text(n));
  const src: ObjectSources = {
    unitData: slk('units\\UnitData.slk'),
    unitBalance: slk('units\\UnitBalance.slk'),
    unitWeapons: slk('units\\UnitWeapons.slk'),
    unitAbilities: slk('units\\UnitAbilities.slk'),
    unitUi: slk('units\\UnitUI.slk'),
    abilityData: slk('units\\AbilityData.slk'),
    abilityMods: parseObjectMods(read('war3map.w3a'), true),
    buffData: slk('units\\AbilityBuffData.slk'),
    itemData: slk('units\\ItemData.slk'),
    upgradeData: slk('units\\UpgradeData.slk'),
    strings,
    misc: parseProfile(text('war3mapMisc.txt')).get('Misc') ?? {},
  };

  const functions = parseFunctions(script);
  const triggers = parseTriggers(functions);
  const triggersByAbility = new Map<string, string[]>();
  for (const t of triggers) for (const a of t.abilities) triggersByAbility.set(a, [...(triggersByAbility.get(a) ?? []), t.name]);

  const units = buildUnits(src);
  const abilities = buildAbilities(src, triggersByAbility);
  const items = buildItems(src, units);
  const ships = buildShips(units);
  const weapons = buildWeapons(items, abilities);
  const version = cleanText(/SetMapName\("([^"]*)"\)/.exec(script)?.[1]);
  const mapInfo = parseMapInfo(script, functions, version);
  const terrain = parseTerrain(read('war3map.w3e'));
  const pathing = parsePathing(read('war3map.wpm'));
  const doodads = parseDoodads(read('war3map.doo'));

  writeJson('ships.json', ships);
  writeJson('weapons.json', weapons);
  writeJson('units.json', units);
  writeJson('abilities.json', abilities);
  writeJson('items.json', items);
  writeJson('buffs.json', buildBuffs(src));
  writeJson('upgrades.json', buildUpgrades(src));
  writeJson('misc.json', Object.fromEntries(Object.entries(src.misc).map(([k, v]) => [k, v.length === 1 ? v[0] : v])));
  writeJson('map.json', mapInfo);
  writeJson('triggers.json', triggers);
  writeJson('terrain.json', terrain, true);
  writeJson('pathing.json', pathing.info);
  writeFileSync(join(outDir, 'pathing.bin'), pathing.cells);
  writeJson('doodads.json', doodads, true);

  const names = new Map<string, string>();
  for (const u of units) names.set(u.id, u.properName ? `${u.properName}` : u.name);
  for (const a of abilities) names.set(a.id, a.name);
  for (const i of items) names.set(i.id, i.name);
  const annotated = annotateScript(script, names, wts);
  dumpRaw(script, annotated);

  const docsDir = join(root, 'docs/mechanics');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, 'ship-skills.md'), shipSkillsReport(ships, units, abilities, version));

  const assets = inventoryAssets([script, ...[...src.unitUi.values(), ...src.itemData.values()].map((r) => JSON.stringify(r)), ...KNOWN_FILES.filter((n) => n.endsWith('.txt')).map(text)]);
  writeJson('assets.json', assets);

  const unknownRefs = collectRawcodes(script).filter((c) => !names.has(c) && !src.buffData.has(c) && !src.upgradeData.has(c));
  console.log(`${version}
  ships ${ships.length}, weapons ${weapons.length}, units ${units.length}, abilities ${abilities.length}, items ${items.length}
  triggers ${triggers.length}, rects ${mapInfo.rects.length}, placements ${mapInfo.placements.length}, doodads ${doodads.length}
  terrain ${terrain.width}x${terrain.height}, pathing ${pathing.info.width}x${pathing.info.height}
  archive files named ${assets.files.length}, unnamed ${assets.unnamedBlocks}
  script rawcodes without a data entry: ${unknownRefs.length}`);
}

main();
