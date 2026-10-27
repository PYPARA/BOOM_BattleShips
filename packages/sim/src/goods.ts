// Shop goods the map implements in triggers rather than in item data (UP_Unit, Buy_QianShui_Item
// and the 船只特殊能力 triggers in war3map.j): blueprints that rebuild a weapon, hull blueprints,
// skills bought for the ship, submarine research, and the special weapons' on-hit effects.
// Most of them are PowerUps: used up on purchase.
import type { Item, Ship, Weapon } from '@boom/gamedata';

const clean = (s: string) => s.replace(/\|c[0-9a-fA-F]{8}|\|r/g, '').trim();

/** Hull blueprints (船体强化设计图): max HP per ship type, once per ship. */
const HULL_BLUEPRINTS: Record<string, Record<string, number>> = {
  I03D: { H000: 500, H001: 500, H01B: 500, H01A: 500 },
  I039: { H003: 900, H004: 1100, H016: 1100, H01K: 1100 },
  I038: { H007: 1500, H006: 1500, H01C: 1500, H01H: 1500, H01V: 1500, H021: 1500, H01D: 1100 },
  I03A: { H008: 2000, H009: 2000, H00R: 2000, H00V: 2000, H00X: 2000, H015: 2000, H019: 2000, H01O: 2000, H01P: 2000, H01L: 2000 },
  I03P: { H00T: 2000, H00C: 2000, H005: 2000, H01N: 2000 },
};

/** 船只特殊能力: the skill each one adds to the ship (one per ship; buy again to level it up). */
const SHIP_SKILLS: Record<string, string> = { I042: 'AUls', I043: 'Asta', I044: 'A03I', I04A: 'Acri', I04E: 'ANhs', I04F: 'ANab' };

/** Submarine gear: researches for the owner, or levels of the submarine's own skills. */
export interface SubTech { damage?: number; range?: number; rate?: number; speed?: number; detect?: number }
const SUB_TECHS: Record<string, SubTech & { value: number }> = {
  I03L: { damage: 100, value: 50 }, I03Q: { range: 300, value: 30 }, I04B: { rate: 2, value: 50 },
  I03R: { speed: 100, value: 20 }, I03S: { detect: 900, value: 10 },
};
const SUB_SKILLS: Record<string, { abilityId: string; level: number; value: number }> = {
  I03I: { abilityId: 'A036', level: 2, value: 10 }, I03J: { abilityId: 'A036', level: 3, value: 20 },
  I04C: { abilityId: 'A036', level: 4, value: 40 }, I03M: { abilityId: 'A02H', level: 0, value: 130 },
  I04J: { abilityId: 'A04M', level: 1, value: 40 },
};
export const SUBMARINES = new Set(['H005', 'H00U']);

/** Abilities a ship type starts with besides its learnable skills (the submarine's mine layer and 下潜). */
export const DEFAULT_GRANTS: Record<string, Record<string, number>> = { H005: { A036: 1, A046: 1 } };

/** Blueprints whose text abbreviates the weapon names: [from, to] item pairs. */
const UPGRADES: Record<string, [string, string][]> = {
  I02X: [['I006', 'I027']], I02Y: [['I027', 'I02C']], I03O: [['I00H', 'I03N']], I03X: [['I03N', 'I03W']],
  I04I: [['I00O', 'I04G']], I06B: [['I069', 'I06A']], I06L: [['I064', 'I06J'], ['I067', 'I06K']],
};

/** Ground missiles: fired from the silo at a random enemy building. */
const GROUND_MISSILES: Record<string, number> = { I01O: 500, I01P: 1000, I01Q: 2000 };

export type Purchase =
  | { kind: 'upgrade'; pairs: [string, string][] }
  | { kind: 'combine'; needs: string[]; to: string }
  | { kind: 'hull'; bonus: Record<string, number> }
  | { kind: 'shipSkill'; abilityId: string; ships?: string[] }
  | { kind: 'subTech'; tech: SubTech; value: number }
  | { kind: 'subSkill'; abilityId: string; level: number; value: number }
  | { kind: 'reset' };

/** On-hit behavior of the 特殊武器 (腐蚀大炮, 燃烧弹加榴炮, 霹雳大炮). */
export interface WeaponSpecial {
  /** Slow and burn the target for `seconds`. */
  corrode?: { slow: number; dps: number; seconds: number };
  /** Burn everything around the target. */
  burn?: { radius: number; dps: number; seconds: number };
  /** Jump to further targets after the first. */
  bounce?: { targets: number; radius: number };
  /** Final damage ignores hull plating (船甲). */
  ignoresPlating: boolean;
}

export class Goods {
  readonly purchases = new Map<string, Purchase>();
  /** Item id → group, for the carry-one-of rule (sails, figureheads, special weapons). */
  readonly uniqueGroup = new Map<string, string>();
  readonly specials = new Map<string, WeaponSpecial>();
  /** Weapons that only fire by hand (反潜火箭). */
  readonly manualOnly = new Set<string>();
  /** Charges for multi-use consumables (探测器 ×3, 战鹰 ×3). */
  readonly charges = new Map<string, number>();
  readonly groundMissiles = new Map(Object.entries(GROUND_MISSILES));

  /** Whether an ability is one of the bought 船只特殊能力 (one per ship, removed by 重设技能). */
  isShipSkill(abilityId: string): boolean {
    return Object.values(SHIP_SKILLS).includes(abilityId);
  }

  constructor(items: Item[], weapons: Weapon[], ships: Ship[]) {
    const byName = new Map<string, string>();
    for (const w of weapons) byName.set(clean(w.name), w.id);
    for (const i of items) if (!byName.has(clean(i.name))) byName.set(clean(i.name), i.id);
    const shipsNamed = (list: string) => {
      if (/所有/.test(list)) return undefined;
      const names = list.split(/[,，、\s]+/).filter(Boolean);
      return ships.filter((s) => names.some((n) => s.name.startsWith(n))).map((s) => s.id);
    };

    for (const i of items) {
      const d = clean(i.description);
      if (HULL_BLUEPRINTS[i.id]) this.purchases.set(i.id, { kind: 'hull', bonus: HULL_BLUEPRINTS[i.id]! });
      else if (SHIP_SKILLS[i.id]) {
        this.purchases.set(i.id, { kind: 'shipSkill', abilityId: SHIP_SKILLS[i.id]!, ships: shipsNamed(/(?:适用|可安装)船型[:：]\s*(.+)/.exec(d)?.[1] ?? '所有') });
      } else if (i.id === 'I05U') this.purchases.set(i.id, { kind: 'reset' });
      else if (SUB_TECHS[i.id]) { const { value, ...tech } = SUB_TECHS[i.id]!; this.purchases.set(i.id, { kind: 'subTech', tech, value }); }
      else if (SUB_SKILLS[i.id]) this.purchases.set(i.id, { kind: 'subSkill', ...SUB_SKILLS[i.id]! });
      else {
        const up = /将\s*(.+?)\s*改造为\s*([^\s(（]+)/.exec(d);
        const from = up && byName.get(up[1]!), to = up && byName.get(up[2]!);
        if (UPGRADES[i.id]) this.purchases.set(i.id, { kind: 'upgrade', pairs: UPGRADES[i.id]! });
        else if (from && to) this.purchases.set(i.id, { kind: 'upgrade', pairs: [[from, to]] });
        const combo = /可合成[:：]\s*(\S+)[\s\S]*?所需物品[:：]\s*([^\n]+)/.exec(d);
        if (combo && byName.get(combo[1]!)) {
          const needs = combo[2]!.split(/[、,，]/).map((n) => byName.get(n.trim())).filter((x): x is string => !!x);
          this.purchases.set(i.id, { kind: 'combine', needs, to: byName.get(combo[1]!)! });
        }
      }
      if (/只能带一个帆/.test(d)) this.uniqueGroup.set(i.id, '帆');
      if (/只能带一个船首[相像]/.test(d)) this.uniqueGroup.set(i.id, '船首像');
      const uses = /使用次数[:：]\s*(\d+)|携带数量\s*(\d+)/.exec(d);
      if (uses) this.charges.set(i.id, Number(uses[1] ?? uses[2]));
    }

    for (const w of weapons) {
      const d = clean(w.description);
      if (/特殊武器\s*,?\s*只能携带一个/.test(d)) this.uniqueGroup.set(w.id, '特殊武器');
      if (w.mode === 'salvo' && !/自动单发/.test(d)) this.manualOnly.add(w.id);
      if (w.mode !== 'scripted') continue;
      const special: WeaponSpecial = { ignoresPlating: /无视船甲/.test(d) };
      const slowBurn = /目标移动速度下降，持续\s*(\d+)\s*秒，每秒\s*(\d+)\s*伤害/.exec(d);
      if (slowBurn) special.corrode = { slow: 0.3, seconds: Number(slowBurn[1]), dps: Number(slowBurn[2]) };
      const area = /范围燃烧，持续\s*(\d+)\s*秒，每秒\s*(\d+)\s*伤害/.exec(d);
      if (area) special.burn = { radius: 250, seconds: Number(area[1]), dps: Number(area[2]) };
      const bounce = /弹射,?\s*最多攻击\s*(\d+)\s*个目标/.exec(d);
      if (bounce) special.bounce = { targets: Number(bounce[1]), radius: 500 };
      this.specials.set(w.id, special);
    }
  }
}
