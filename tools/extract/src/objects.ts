// Builds units, abilities, items, buffs and upgrades from the map's SLK tables,
// profile strings and level-5+ ability modifications.
import type {
  Ability, AbilityLevel, Buff, Item, Ship, Unit, UnitAttack, Upgrade, Weapon,
} from '@boom/gamedata';
import { abilityColumn, type ModifiedObject } from './objectMods.ts';
import type { ProfileSection } from './profile.ts';
import type { SlkRow } from './slk.ts';
import { cleanText, num, splitList } from './text.ts';

export interface ObjectSources {
  unitData: Map<string, SlkRow>;
  unitBalance: Map<string, SlkRow>;
  unitWeapons: Map<string, SlkRow>;
  unitAbilities: Map<string, SlkRow>;
  unitUi: Map<string, SlkRow>;
  abilityData: Map<string, SlkRow>;
  abilityMods: ModifiedObject[];
  buffData: Map<string, SlkRow>;
  itemData: Map<string, SlkRow>;
  upgradeData: Map<string, SlkRow>;
  /** All profile strings merged (units, abilities, items, upgrades, buffs). */
  strings: Map<string, ProfileSection>;
  misc: ProfileSection;
}

const first = (s: ProfileSection | undefined, key: string) => s?.[key]?.[0] ?? '';
const joined = (s: ProfileSection | undefined, key: string) => (s?.[key] ?? []).join(',');

export function buildUnits(src: ObjectSources): Unit[] {
  const strHp = Number(first(src.misc, 'strhitpointbonus') || 25);
  const agiArmor = Number(first(src.misc, 'agidefensebonus') || 0.3);
  const units: Unit[] = [];
  for (const [id, data] of src.unitData) {
    const bal = src.unitBalance.get(id) ?? {};
    const weap = src.unitWeapons.get(id) ?? {};
    const abil = src.unitAbilities.get(id) ?? {};
    const ui = src.unitUi.get(id) ?? {};
    const s = src.strings.get(id);
    const isHero = /^[A-Z]/.test(id) && bal.STR !== undefined;
    const attacks: UnitAttack[] = [];
    const enabled = num(weap.weapsOn) ?? 0;
    for (const i of [1, 2]) {
      if (!(enabled & i)) continue;
      attacks.push({
        damageBase: num(weap[`dmgplus${i}`]) ?? 0,
        dice: num(weap[`dice${i}`]) ?? 0,
        sides: num(weap[`sides${i}`]) ?? 0,
        range: num(weap[`rangeN${i}`]) ?? 0,
        cooldown: num(weap[`cool${i}`]) ?? 0,
        attackType: weap[`atkType${i}`] as string | undefined,
        weaponType: weap[`weapTp${i}`] as string | undefined,
        targets: splitList(weap[`targs${i}`]),
      });
    }
    units.push({
      id,
      name: first(s, 'name'),
      properName: isHero ? s?.propernames?.[0] : undefined,
      isHero,
      isBuilding: num(bal.isbldg) === 1,
      hp: (num(bal.HP) ?? 0) + (isHero ? (num(bal.STR) ?? 0) * strHp : 0),
      armor: round((num(bal.def) ?? 0) + (isHero ? (num(bal.AGI) ?? 0) * agiArmor : 0)),
      armorType: bal.defType as string | undefined,
      speed: num(bal.spd) ?? 0,
      turnRate: num(data.turnRate),
      collision: num(bal.collision),
      regenHp: num(bal.regenHP) ?? 0,
      goldCost: num(bal.goldcost) ?? 0,
      bounty: { base: num(bal.bountyplus) ?? 0, dice: num(bal.bountydice) ?? 0, sides: num(bal.bountysides) ?? 0 },
      level: num(bal.level),
      sight: num(bal.sight),
      moveType: data.movetp as string | undefined,
      targetedAs: splitList(data.targType),
      abilities: splitList(abil.abilList),
      heroAbilities: splitList(abil.heroAbilList),
      attacks,
      sellsUnits: s?.sellunits?.filter(Boolean) ?? [],
      sellsItems: s?.sellitems?.filter(Boolean) ?? [],
      upgradesTo: s?.upgrade?.filter(Boolean) ?? [],
      tip: cleanText(first(s, 'tip')),
      description: cleanText(joined(s, 'ubertip')),
      model: ui.file as string | undefined,
      modelScale: num(ui.modelScale),
    });
  }
  return units;
}

const DATA_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;

export function buildAbilities(src: ObjectSources, triggersByAbility: Map<string, string[]>): Ability[] {
  const modsById = new Map(src.abilityMods.map((o) => [o.id, o]));
  const abilities: Ability[] = [];
  for (const [id, row] of src.abilityData) {
    // Levels 1–4 come from the SLK; levels 5+ from war3map.w3a. Fields missing for a
    // level fall back to the highest level that defines them (matches the editor's behavior
    // when levels are added).
    const merged: SlkRow = { ...row };
    for (const mod of modsById.get(id)?.mods ?? []) merged[abilityColumn(mod)] = mod.value;
    const levelCount = num(merged.levels) ?? 1;
    const pick = (field: string, level: number) => {
      for (let l = level; l >= 1; l--) if (merged[`${field}${l}`] !== undefined) return merged[`${field}${l}`];
      return undefined;
    };
    const s = src.strings.get(id);
    const levels: AbilityLevel[] = [];
    for (let level = 1; level <= levelCount; level++) {
      const data: AbilityLevel['data'] = {};
      for (const letter of DATA_LETTERS) {
        const v = pick(`Data${letter}`, level);
        if (v !== undefined && v !== '') data[letter] = v;
      }
      levels.push({
        level,
        area: num(pick('Area', level)),
        cooldown: num(pick('Cool', level)),
        cost: num(pick('Cost', level)),
        duration: num(pick('Dur', level)),
        heroDuration: num(pick('HeroDur', level)),
        range: num(pick('Rng', level)),
        castTime: num(pick('Cast', level)),
        targets: splitList(pick('targs', level)),
        buffs: splitList(pick('BuffID', level)),
        effects: splitList(pick('EfctID', level)),
        units: splitList(pick('UnitID', level)),
        data,
        tip: cleanText(s?.tip?.[Math.min(level, s.tip.length) - 1]),
        description: cleanText(s?.ubertip?.[Math.min(level, s.ubertip.length) - 1]),
      });
    }
    abilities.push({
      id,
      baseCode: String(row.code ?? id),
      name: first(s, 'name'),
      isHeroAbility: num(row.hero) === 1 || s?.researchtip !== undefined,
      levels,
      requiredLevel: num(merged.reqLevel),
      levelSkip: num(merged.levelSkip),
      hotkey: first(s, 'hotkey') || undefined,
      order: first(s, 'order') || undefined,
      researchDescription: cleanText(joined(s, 'researchubertip')),
      triggers: triggersByAbility.get(id) ?? [],
    });
  }
  return abilities;
}

export function buildBuffs(src: ObjectSources): Buff[] {
  return [...src.buffData.keys()].map((id) => {
    const s = src.strings.get(id);
    return { id, name: first(s, 'editorname') || first(s, 'bufftip'), tip: cleanText(first(s, 'bufftip')), description: cleanText(joined(s, 'buffubertip')) };
  });
}

export function buildItems(src: ObjectSources, units: Unit[]): Item[] {
  const soldAt = shopIndex(units, 'sellsItems');
  return [...src.itemData].map(([id, row]) => {
    const s = src.strings.get(id);
    return {
      id,
      name: first(s, 'name'),
      goldCost: num(row.goldcost) ?? 0,
      abilities: splitList(row.abilList),
      itemClass: row.class as string | undefined,
      uses: num(row.uses),
      perishable: num(row.perishable) === 1,
      usable: num(row.usable) === 1,
      droppable: num(row.droppable) === 1,
      cooldownGroup: row.cooldownID as string | undefined,
      stockMax: num(row.stockMax),
      stockRegen: num(row.stockRegen),
      tip: cleanText(first(s, 'tip')),
      description: cleanText(joined(s, 'ubertip')),
      soldAt: soldAt.get(id) ?? [],
    };
  });
}

export function buildUpgrades(src: ObjectSources): Upgrade[] {
  return [...src.upgradeData].map(([id, row]) => {
    const s = src.strings.get(id);
    const effects: Upgrade['effects'] = [];
    for (let i = 1; i <= 4; i++) {
      const code = row[`effect${i}`];
      if (typeof code === 'string' && code) effects.push({ code, base: num(row[`base${i}`]) ?? 0, perLevel: num(row[`mod${i}`]) ?? 0 });
    }
    return {
      id,
      name: first(s, 'name'),
      maxLevel: num(row.maxlevel) ?? 1,
      goldBase: num(row.goldbase) ?? 0,
      goldPerLevel: num(row.goldmod) ?? 0,
      effects,
      description: cleanText(joined(s, 'ubertip')),
    };
  });
}

/** Ships are the hero units sold by a shop. Size and hull class come from the shop tooltip. */
export function buildShips(units: Unit[]): Ship[] {
  const soldAt = shopIndex(units, 'sellsUnits');
  return units
    .filter((u) => u.isHero && soldAt.has(u.id) && /类型:/.test(u.description))
    .map((u) => {
      const field = (label: string) => new RegExp(`${label}:\\s*([^\\n]*)`).exec(u.description)?.[1]?.trim() ?? '';
      return {
        id: u.id,
        name: u.properName ?? u.name,
        hullClass: field('类型'),
        size: field('尺寸'),
        price: u.goldCost,
        hp: u.hp,
        armor: u.armor,
        speed: u.speed,
        turnRate: u.turnRate ?? 0,
        regenHp: u.regenHp,
        collision: u.collision ?? 0,
        skills: u.heroAbilities,
        soldAt: soldAt.get(u.id) ?? [],
        recommendedWeapons: field('推荐搭配'),
        description: /介绍:\s*\n?([^\n]*)/.exec(u.description)?.[1]?.trim() ?? '',
      };
    })
    .sort((a, b) => a.price - b.price);
}

/**
 * Weapons are items carrying a Phoenix Fire (Apxf, random target in radius) or Cluster
 * Rockets (ANcs, manual salvo) copy, plus shop items with weapon stats in the tooltip but
 * no ability, which the map's triggers implement.
 */
export function buildWeapons(items: Item[], abilities: Ability[]): Weapon[] {
  const byId = new Map(abilities.map((a) => [a.id, a]));
  const weapons: Weapon[] = [];
  for (const item of items) {
    const owned = item.abilities.map((id) => byId.get(id)).filter((a): a is Ability => a !== undefined);
    const auto = owned.find((a) => a.baseCode === 'Apxf');
    const salvo = owned.find((a) => a.baseCode === 'ANcs');
    const fromTip = (label: string) => new RegExp(`${label}:\\s*([^\\n]+)`).exec(item.description)?.[1]?.trim();
    // Weapon items use the Artifact class; blueprints (PowerUp) and ammo (Permanent) also quote damage.
    const scripted = !auto && !salvo && item.itemClass === 'Artifact' && item.abilities.length === 0
      && item.soldAt.length > 0 && fromTip('破坏力') !== undefined;
    if (!auto && !salvo && !scripted) continue;

    const main = salvo ?? auto;
    const level = main?.levels[0];
    const tipNumber = (label: string) => Number.parseFloat(fromTip(label) ?? '') || 0;
    weapons.push({
      id: item.id,
      mode: salvo ? 'salvo' : auto ? 'auto' : 'scripted',
      abilityId: main?.id,
      extraAbilities: item.abilities.filter((id) => id !== main?.id),
      name: cleanText(item.name).replace(/^\./, ''),
      price: item.goldCost,
      // Damage is per hit (per rocket for salvos). Auto weapons reach as far as their
      // Phoenix Fire radius; salvo-only weapons use the cast range.
      damage: level?.data.A ?? fromTip('破坏力') ?? 0,
      range: auto?.levels[0]?.area ?? salvo?.levels[0]?.range ?? (tipNumber('射程') || tipNumber('范围')),
      cooldown: level?.cooldown ?? tipNumber('间隔'),
      targets: level?.targets ?? splitList(fromTip('攻击对象')?.replaceAll('、', ',')),
      soldAt: item.soldAt,
      description: item.description,
    });
  }
  return weapons.sort((a, b) => a.price - b.price);
}

function shopIndex(units: Unit[], key: 'sellsUnits' | 'sellsItems'): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const shop of units) {
    for (const id of shop[key]) index.set(id, [...(index.get(id) ?? []), shop.id]);
  }
  return index;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
