// Warcraft III damage rules as the map uses them: attack-type × armor-type multipliers (with
// the map's overrides from misc.json) and armor reduction.

/** Column order used by the game's DamageBonus* constants. */
export const ARMOR_TYPES = ['small', 'medium', 'large', 'fort', 'normal', 'hero', 'divine', 'none'] as const;
export type ArmorType = (typeof ARMOR_TYPES)[number];
export type AttackType = 'normal' | 'pierce' | 'siege' | 'magic' | 'chaos' | 'spells' | 'hero';

/** Frozen Throne defaults; the map replaces some rows through misc.json. */
const DEFAULT_TABLE: Record<AttackType, number[]> = {
  normal: [1.0, 1.5, 1.0, 0.7, 1.0, 1.0, 0.05, 1.0],
  pierce: [2.0, 0.75, 1.0, 0.35, 1.0, 0.5, 0.05, 1.5],
  siege: [1.0, 0.5, 1.0, 1.5, 1.0, 0.5, 0.05, 1.5],
  magic: [1.25, 0.75, 2.0, 0.35, 1.0, 0.5, 0.05, 1.0],
  chaos: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  spells: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.05, 1.0],
  hero: [1.0, 1.0, 1.0, 0.5, 1.0, 1.0, 0.05, 1.0],
};

/** Armor reduction factor per point (the game's DefenseArmor constant). */
const ARMOR_FACTOR = 0.06;

export class DamageTable {
  private readonly table: Record<AttackType, number[]>;

  /** `misc` is misc.json: keys like `damagebonuspierce` override a row. */
  constructor(misc: Record<string, unknown> = {}) {
    this.table = { ...DEFAULT_TABLE };
    for (const type of Object.keys(DEFAULT_TABLE) as AttackType[]) {
      const row = misc[`damagebonus${type}`];
      if (Array.isArray(row) && row.length === ARMOR_TYPES.length) this.table[type] = row.map(Number);
    }
  }

  multiplier(attack: string | undefined, armor: string | undefined): number {
    const row = this.table[(attack ?? 'normal') as AttackType] ?? this.table.normal;
    const col = ARMOR_TYPES.indexOf((armor ?? 'none') as ArmorType);
    return row[col < 0 ? ARMOR_TYPES.length - 1 : col]!;
  }

  /** Final damage after the type multiplier and armor (negative armor amplifies damage). */
  damage(amount: number, attack: string | undefined, armorType: string | undefined, armor: number): number {
    const typed = amount * this.multiplier(attack, armorType);
    const reduction = armor >= 0
      ? (armor * ARMOR_FACTOR) / (1 + armor * ARMOR_FACTOR)
      : -(1 - Math.pow(1 - ARMOR_FACTOR, -armor));
    return typed * (1 - reduction);
  }
}

/** What a weapon or attack may hit, from Warcraft target flags (English or the map's Chinese tooltips). */
export interface TargetFilter {
  ships: boolean;
  structures: boolean;
  /** Only heroes (player ships), e.g. the towers' anti-hero attack. */
  heroesOnly: boolean;
  noHeroes: boolean;
  /** Submarines and mines (深水炸弹, 反潜火箭). */
  wards: boolean;
}

export function parseTargets(flags: string[]): TargetFilter {
  const has = (...names: string[]) => names.some((n) => flags.includes(n));
  const structures = has('structure', '建筑', '建筑物');
  const ships = has('ground', 'air', 'hero', '船只', '空中', '英雄', '敌方单位') || (!structures && !has('ward', '潜水艇', '水雷'));
  return { ships, structures, heroesOnly: flags.includes('hero') && !has('ground'), noHeroes: flags.includes('nonhero'), wards: has('ward', '潜水艇', '水雷') };
}
