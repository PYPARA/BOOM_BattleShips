// Shapes of the JSON files in ../generated, produced by tools/extract from the 7.876 map.
// Distances are Warcraft III world units; times are seconds.

export type Rawcode = string;

export interface UnitAttack {
  /** Base damage per hit is `damageBase + dice..dice*sides`. */
  damageBase: number;
  dice: number;
  sides: number;
  range: number;
  cooldown: number;
  attackType?: string;
  weaponType?: string;
  targets: string[];
}

export interface Unit {
  id: Rawcode;
  name: string;
  /** Hero ships carry their ship name here (e.g. 领主) while `name` is the hull class. */
  properName?: string;
  isHero: boolean;
  isBuilding: boolean;
  /** Final max HP; for heroes this already includes STR × StrHitPointBonus. */
  hp: number;
  /** Final armor; for heroes this already includes AGI × AgiDefenseBonus. */
  armor: number;
  armorType?: string;
  /** Movement speed in world units per second. The game shows it as knots = speed / 10. */
  speed: number;
  turnRate?: number;
  collision?: number;
  regenHp: number;
  goldCost: number;
  /** Gold the killer gets: base + dice × d(sides). */
  bounty: { base: number; dice: number; sides: number };
  level?: number;
  sight?: number;
  /** Sight radius at night (Warcraft's nsight). */
  nightSight?: number;
  moveType?: string;
  targetedAs: string[];
  abilities: Rawcode[];
  heroAbilities: Rawcode[];
  attacks: UnitAttack[];
  sellsUnits: Rawcode[];
  sellsItems: Rawcode[];
  /** Units this one can be upgraded into (改装). */
  upgradesTo: Rawcode[];
  /** Research upgrades (e.g. R001 防御火力) that affect this unit. */
  upgrades: Rawcode[];
  tip: string;
  description: string;
  model?: string;
  modelScale?: number;
}

export interface AbilityLevel {
  level: number;
  area?: number;
  cooldown?: number;
  cost?: number;
  duration?: number;
  heroDuration?: number;
  range?: number;
  castTime?: number;
  targets: string[];
  buffs: Rawcode[];
  effects: Rawcode[];
  units: Rawcode[];
  /** Ability-specific values DataA..DataI; meaning depends on `baseCode`. */
  data: Partial<Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I', number | string>>;
  tip: string;
  description: string;
}

export interface Ability {
  id: Rawcode;
  /** The built-in Warcraft ability it was copied from, which defines its behavior. */
  baseCode: Rawcode;
  name: string;
  isHeroAbility: boolean;
  levels: AbilityLevel[];
  requiredLevel?: number;
  levelSkip?: number;
  hotkey?: string;
  order?: string;
  researchDescription: string;
  /** Script triggers that react to this ability (see triggers.json). */
  triggers: string[];
}

export interface Buff {
  id: Rawcode;
  name: string;
  tip: string;
  description: string;
}

export interface Item {
  id: Rawcode;
  name: string;
  goldCost: number;
  abilities: Rawcode[];
  itemClass?: string;
  uses?: number;
  perishable: boolean;
  usable: boolean;
  droppable: boolean;
  cooldownGroup?: Rawcode;
  stockMax?: number;
  stockRegen?: number;
  tip: string;
  description: string;
  soldAt: Rawcode[];
}

export interface Ship {
  id: Rawcode;
  name: string;
  hullClass: string;
  /** 小型 / 中型 / 大型 / 巨大 as shown in the shop tooltip. */
  size: string;
  price: number;
  hp: number;
  armor: number;
  speed: number;
  turnRate: number;
  regenHp: number;
  collision: number;
  /** Ship skills and the shared hull/sail upgrades, in learn-menu order. */
  skills: Rawcode[];
  soldAt: Rawcode[];
  recommendedWeapons: string;
  description: string;
}

export interface Weapon {
  /** Item id; equipping the item grants `abilityId`. */
  id: Rawcode;
  /**
   * auto: Phoenix Fire copy, fires at a random enemy in range by itself.
   * salvo: manually fired volley (Cluster Rockets copy), sometimes paired with an auto single shot.
   * scripted: no ability on the item; the map's triggers implement it (stats parsed from the tooltip).
   */
  mode: 'auto' | 'salvo' | 'scripted';
  abilityId?: Rawcode;
  /** Extra abilities granted alongside the main one (salvo + single shot, armor, …). */
  extraAbilities: Rawcode[];
  name: string;
  price: number;
  damage: number | string;
  /** Targets are picked at random within this radius (Phoenix Fire behavior). */
  range: number;
  cooldown: number;
  targets: string[];
  soldAt: Rawcode[];
  description: string;
}

export interface Upgrade {
  id: Rawcode;
  name: string;
  maxLevel: number;
  goldBase: number;
  goldPerLevel: number;
  effects: { code: string; base: number; perLevel: number }[];
  description: string;
}

export interface Placement {
  id: Rawcode;
  /** -1 = neutral hostile, -2 = neutral passive; otherwise a player slot 0..11. */
  player: number;
  x: number;
  y: number;
  facing: number;
  /** Generated global name, e.g. gg_unit_n000_0020, used by triggers. */
  handle?: string;
}

export interface Rect {
  name: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PlayerSlot {
  index: number;
  name: string;
  controller: string;
  team: number;
  startX?: number;
  startY?: number;
}

export interface MapInfo {
  version: string;
  /** World-space camera bounds, i.e. the playable area. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  players: PlayerSlot[];
  rects: Rect[];
  placements: Placement[];
}

export interface Terrain {
  /** Corner grid: `width × height` corners, 128 world units apart, starting at (originX, originY). */
  width: number;
  height: number;
  originX: number;
  originY: number;
  tileset: string;
  groundTiles: string[];
  /** Per corner, row-major from the bottom-left. */
  groundHeight: number[];
  waterHeight: number[];
  isWater: number[];
  groundTexture: number[];
  cliffLevel: number[];
}

export interface PathingInfo {
  /**
   * pathing.bin holds `width × height` bytes, 32 world units per cell, row-major from the
   * bottom-left, aligned with the terrain origin. Ships can sail where `noWater` is clear.
   */
  width: number;
  height: number;
  cellSize: number;
  flags: { noWalk: number; noFly: number; noBuild: number; blight: number; noWater: number; unknown: number };
}

export interface Doodad {
  id: Rawcode;
  variation: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  scale: [number, number, number];
}

export interface TriggerInfo {
  name: string;
  events: string[];
  conditionFunctions: string[];
  actionFunctions: string[];
  /** Rawcodes referenced anywhere in the trigger's functions. */
  references: Rawcode[];
  /** Abilities compared against GetSpellAbilityId() or similar. */
  abilities: Rawcode[];
  lines: [number, number];
  initiallyEnabled: boolean;
}
