// Ship (hero) experience, levels and skill learning, using the map's Misc constants where it
// sets them (GrantHeroXP, GrantNormalXP, HeroExpRange, MaxHeroLevel, NeedHeroXP).
import type { Ability } from '@boom/gamedata';

export const MAX_HERO_LEVEL = 25;
/** Allied ships within this distance share the experience of a kill. */
export const HERO_XP_RANGE = 1800;
/** XP for killing a ship of level 1, 2, … (GrantHeroXP). */
const GRANT_HERO_XP = [70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300];
/** XP per level of a killed non-hero unit (GrantNormalXP). */
const GRANT_NORMAL_XP = 15;

export interface HeroState {
  xp: number;
  level: number;
  /** Learned level per ability id. */
  learned: Record<string, number>;
  /** Tick when each ability or item cooldown group (`item:<group>`) is ready again. */
  readyAt: Record<string, number>;
  /** Skills the ship has besides its learnable ones (bought 船只特殊能力, submarine gear), by level. */
  granted: Record<string, number>;
  /** Uses left on multi-use consumables, by item id. */
  charges: Record<string, number>;
  /** Max HP from hull blueprints, by ship type (once per ship). */
  hullBonus: Record<string, number>;
  /** Upgrade value bought for the current ship (the map's hero INT − 1), refunded at 60 gold a point. */
  invested: number;
  /** The player's submarine researches (高爆弹头 …), by item id. */
  techs: string[];
}

export function newHero(): HeroState {
  return { xp: 0, level: 1, learned: {}, readyAt: {}, granted: {}, charges: {}, hullBonus: {}, invested: 0, techs: [] };
}

/**
 * Total XP needed to reach `level`. The map sets the first step (NeedHeroXP = 100) and keeps
 * Warcraft's growing steps after it: 100, 300, 600, 1000, …
 */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) * level;
}

/** Adds XP and returns how many levels were gained. */
export function gainXp(hero: HeroState, amount: number): number {
  hero.xp += amount;
  let gained = 0;
  while (hero.level < MAX_HERO_LEVEL && hero.xp >= xpForLevel(hero.level + 1)) {
    hero.level++;
    gained++;
  }
  return gained;
}

export function killXp(victimIsHero: boolean, victimLevel: number): number {
  if (victimIsHero) return GRANT_HERO_XP[Math.min(GRANT_HERO_XP.length, Math.max(1, victimLevel)) - 1]!;
  return GRANT_NORMAL_XP * Math.max(1, victimLevel);
}

export function skillPoints(hero: HeroState): number {
  const spent = Object.values(hero.learned).reduce((s, v) => s + v, 0);
  return hero.level - spent;
}

/** Whether the next level of `ability` can be learned now (reqLevel and levelSkip rules). */
export function canLearn(hero: HeroState, ability: Ability): boolean {
  const next = (hero.learned[ability.id] ?? 0) + 1;
  if (next > ability.levels.length || skillPoints(hero) <= 0) return false;
  const required = (ability.requiredLevel ?? 1) + (next - 1) * (ability.levelSkip ?? 2);
  return hero.level >= required;
}
