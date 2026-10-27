// Fixed-tick simulation of ships and structures on the sea plane: movement, targeting,
// projectiles and damage. Pure TypeScript with no rendering dependencies, so it also runs
// headless (tests, AI self-play, a future server). Game rules (waves, gold, shops, victory)
// live in match.ts on top of this.
import type { Ability, Item, Ship, Unit, Weapon } from '@boom/gamedata';
import { AbilitySystem } from './abilities.ts';
import { dropExpired, hasBuff, strongest, type Buff } from './buffs.ts';
import { DamageTable, parseTargets, type TargetFilter } from './combat.ts';
import { Goods, SUBMARINES, type WeaponSpecial } from './goods.ts';
import { isNight, Vision } from './vision.ts';
import type { HeroState } from './heroes.ts';
import { createRng, distance, turnToward, wrapAngle, type Vec2 } from './math.ts';
import type { PathGrid } from './pathing.ts';

export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

// Handling constants. These are tuned for feel, not taken from the map: Warcraft III
// turns units almost instantly, which reads wrong for ships.
/** Turn speed in rad/s per point of the unit's turnRate (领主 0.25 → 180° in 2 s). */
export const TURN_RATE_SCALE = 2 * Math.PI;
/** Seconds to reach full speed from a standstill. */
export const ACCELERATION_TIME = 0.8;
/** Ships keep at least this fraction of top speed while turning hard. */
export const MIN_TURNING_SPEED = 0.2;
/** Distance at which an intermediate waypoint counts as reached. */
export const WAYPOINT_RADIUS = 64;
/** Projectile speed in world units per second; the map's missile speeds are mostly 900–1500. */
export const PROJECTILE_SPEED = 1100;
/** Units notice enemies this much beyond their attack range while attack-moving. */
export const ACQUIRE_BONUS = 250;
/** How long an attack with nothing in range waits before looking again. */
const RETARGET_TICKS = 5;

/** Radius used to keep hulls apart, by the shop's size label. Pathing uses the smaller unit collision. */
const BODY_RADIUS: Record<string, number> = { 小型: 40, 中型: 55, 大型: 70, 大: 70, 巨大: 85 };

export type Team = 'south' | 'north' | 'neutral';

export function teamOfPlayer(player: number): Team {
  if (player === 0 || (player >= 2 && player <= 6)) return 'south';
  if (player === 1 || (player >= 7 && player <= 11)) return 'north';
  return 'neutral';
}

/** A built-in attack (NPC ships and structures), from UnitWeapons data. */
export interface AttackSlot {
  damageBase: number;
  dice: number;
  sides: number;
  range: number;
  cooldown: number;
  attackType: string;
  filter: TargetFilter;
  readyAt: number;
}

/** A weapon item on a player ship: fires at a random valid enemy in range (Phoenix Fire). */
export interface WeaponSlot {
  itemId: string;
  damage: number;
  range: number;
  cooldown: number;
  filter: TargetFilter;
  readyAt: number;
  /** Fires only when used by hand (反潜火箭). */
  manual?: boolean;
  special?: WeaponSpecial;
}

export type Order =
  | { kind: 'idle' }
  | { kind: 'move' }
  /** Move along `goals`, stopping to fight anything that comes into range. */
  | { kind: 'attackMove'; goals: Vec2[] };

export interface UnitEntity {
  id: number;
  typeId: string;
  owner: number;
  team: Team;
  kind: 'ship' | 'structure';
  isHero: boolean;
  x: number;
  y: number;
  /** Radians, 0 = +x (east), counter-clockwise, like Warcraft facing. */
  facing: number;
  speed: number;
  maxSpeed: number;
  turnSpeed: number;
  /** Collision radius from the map data, used against terrain. */
  pathRadius: number;
  /** Larger radius used between ships and for hit tests. */
  bodyRadius: number;
  path: Vec2[];
  order: Order;
  /** Current attack target for units with built-in attacks. */
  targetId?: number;
  hp: number;
  maxHp: number;
  armor: number;
  armorType: string;
  regen: number;
  attacks: AttackSlot[];
  weapons: WeaponSlot[];
  /** Item ids in the six inventory slots (player ships). */
  items: string[];
  /** Map handle for preplaced units, e.g. gg_unit_n003_0024. */
  handle?: string;
  /** Research upgrades that apply to this unit (R001 …), from the unit data. */
  upgrades: string[];
  /** Flat damage added to every built-in attack (research and the like). */
  bonusDamage: number;
  /** Extra attack speed as a fraction (0.15 = 15% faster). */
  attackSpeedBonus: number;
  /** Critical strike: chance and damage multiplier. */
  critChance: number;
  critMultiplier: number;
  /** Takes no damage (ships under repair, freshly respawned ships). */
  invulnerable: boolean;
  /** Cannot move or fight (ships being repaired). */
  frozen: boolean;
  /** Player ships: experience, learned skills, cooldowns. */
  hero?: HeroState;
  buffs: Buff[];
  /** Stats before items, passives and buffs; refreshStats derives the live ones from them. */
  base: { maxHp: number; regen: number; speed: number; armor: number };
  /** Share of weapon and attack damage taken (船甲 hulls lower it). */
  damageTaken: number;
  /** A cast waiting for the caster to come into range. */
  pendingCast?: { abilityId: string; targetId?: number; point?: Vec2; itemSlot?: number };
  /** Summons and mines disappear at this tick. */
  expiresAt?: number;
  /** Summoned by a skill (dispel hurts it). */
  summoned?: boolean;
  /** A skill-made copy of a ship (假目标, 分身, 造影): fights, but its death gives nothing. */
  illusion?: boolean;
  /** Cannot be targeted by anything (小艇 swarms, Warcraft's Locust). */
  locust?: boolean;
  /** A mine or a submarine: only anti-submarine weapons (and normal ones, for the surfaced sub) hit it. */
  ward?: boolean;
  /** The unit type it has turned into (下潜: the submarine's H00U), whose stats and sight apply. */
  form?: string;
  /** Under water: only anti-submarine weapons reach it and its items cannot be used. */
  submerged?: boolean;
  /** Reveals invisible enemies within this range (探测者, 观察员, 声纳, 探测器). */
  detects?: number;
  /** State at the start of the current tick, for render interpolation. */
  prevX: number;
  prevY: number;
  prevFacing: number;
}

/** Kept for code written against the M1 ship-only world. */
export type ShipEntity = UnitEntity;

export interface Projectile {
  id: number;
  sourceId: number;
  owner: number;
  targetId: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  damage: number;
  attackType: string;
  special?: WeaponSpecial;
  /** Fired by a built-in attack (creep poisons, bashes and cleaves ride on these). */
  attack?: boolean;
}

export type WorldEvent =
  | { kind: 'shot'; projectileId: number; sourceId: number; targetId: number }
  | { kind: 'hit'; targetId: number; sourceOwner: number; damage: number; attackType: string; x: number; y: number }
  /** A bolt between two points (chain lightning jumps, bouncing shots), for the renderer. */
  | { kind: 'zap'; abilityId: string; fromX: number; fromY: number; toX: number; toY: number }
  | { kind: 'death'; unit: UnitEntity; killerOwner: number; killerId: number }
  | { kind: 'cast'; casterId: number; abilityId: string; x: number; y: number }
  /** A consumable left the inventory; match.ts mirrors it into the player's item list. */
  | { kind: 'itemUsed'; unitId: number; slot: number }
  /** Gold and experience granted by a skill (打捞, 同化). */
  | { kind: 'reward'; player: number; gold: number; xp: number; x: number; y: number };

export type Command =
  | { kind: 'move'; unitIds: number[]; x: number; y: number }
  | { kind: 'stop'; unitIds: number[] };

export interface WorldData {
  ships: Ship[];
  units: Unit[];
  weapons: Weapon[];
  abilities?: Ability[];
  items?: Item[];
  misc?: Record<string, unknown>;
}

export class World {
  tick = 0;
  /** Everything that moves: player ships and NPC fleets. */
  readonly ships = new Map<number, UnitEntity>();
  readonly structures = new Map<number, UnitEntity>();
  readonly projectiles = new Map<number, Projectile>();
  /** Events of the last step, for rules and rendering. */
  events: WorldEvent[] = [];
  readonly grid: PathGrid;
  readonly damage: DamageTable;
  readonly random: () => number;
  readonly abilities: AbilitySystem;
  readonly goods: Goods;
  /** Fog of war: what each side currently sees. */
  readonly vision: Vision;
  private readonly shipTypes: Map<string, Ship>;
  private readonly unitTypes: Map<string, Unit>;
  private readonly weaponTypes: Map<string, Weapon>;
  private readonly pending: Command[] = [];
  private nextId = 1;

  constructor(grid: PathGrid, data: WorldData, seed = 1) {
    this.grid = grid;
    this.shipTypes = new Map(data.ships.map((s) => [s.id, s]));
    this.unitTypes = new Map(data.units.map((u) => [u.id, u]));
    this.weaponTypes = new Map(data.weapons.map((w) => [w.id, w]));
    this.damage = new DamageTable(data.misc);
    this.random = createRng(seed);
    this.goods = new Goods(data.items ?? [], data.weapons, data.ships);
    this.vision = new Vision({ minX: grid.originX, minY: grid.originY, maxX: grid.originX + grid.width * grid.cellSize, maxY: grid.originY + grid.height * grid.cellSize });
    this.abilities = new AbilitySystem(this, data.abilities ?? [], data.items ?? [], data.misc ?? {});
  }

  unitType(typeId: string): Unit | undefined {
    return this.unitTypes.get(typeId);
  }

  unit(id: number | undefined): UnitEntity | undefined {
    return id === undefined ? undefined : this.ships.get(id) ?? this.structures.get(id);
  }

  *allUnits(): Iterable<UnitEntity> {
    yield* this.ships.values();
    yield* this.structures.values();
  }

  shipType(typeId: string): Ship | undefined {
    return this.shipTypes.get(typeId);
  }

  weaponType(itemId: string): Weapon | undefined {
    return this.weaponTypes.get(itemId);
  }

  /** Spawns any mobile unit: a purchasable ship (hero) or an NPC fleet ship. */
  spawnShip(typeId: string, owner: number, x: number, y: number, facing = Math.PI / 2): UnitEntity {
    const unit = this.unitTypes.get(typeId);
    const ship = this.shipTypes.get(typeId);
    if (!unit) throw new Error(`Unknown unit type ${typeId}`);
    const entity = this.makeUnit(unit, owner, x, y, facing, 'ship');
    entity.maxSpeed = unit.speed;
    entity.turnSpeed = (ship?.turnRate ?? unit.turnRate ?? 0.6) * TURN_RATE_SCALE;
    entity.pathRadius = unit.collision ?? 16;
    entity.bodyRadius = ship ? BODY_RADIUS[ship.size] ?? 55 : Math.max(30, (unit.collision ?? 16) * 2);
    this.ships.set(entity.id, entity);
    this.abilities.refreshStats(entity);
    return entity;
  }

  spawnStructure(typeId: string, owner: number, x: number, y: number, facing = 0, handle?: string): UnitEntity {
    const unit = this.unitTypes.get(typeId);
    if (!unit) throw new Error(`Unknown unit type ${typeId}`);
    const entity = this.makeUnit(unit, owner, x, y, facing, 'structure');
    entity.bodyRadius = unit.collision ?? 48;
    entity.handle = handle;
    this.structures.set(entity.id, entity);
    return entity;
  }

  private makeUnit(unit: Unit, owner: number, x: number, y: number, facing: number, kind: UnitEntity['kind']): UnitEntity {
    return {
      id: this.nextId++, typeId: unit.id, owner, team: teamOfPlayer(owner), kind, isHero: unit.isHero,
      x, y, facing, speed: 0, maxSpeed: 0, turnSpeed: 0, pathRadius: 0, bodyRadius: 0, path: [], order: { kind: 'idle' },
      hp: unit.hp, maxHp: unit.hp, armor: unit.armor, armorType: unit.armorType ?? 'none', regen: unit.regenHp,
      attacks: this.attackSlots(unit),
      weapons: [], items: [], upgrades: unit.upgrades ?? [],
      bonusDamage: 0, attackSpeedBonus: 0, critChance: 0, critMultiplier: 1, invulnerable: false, frozen: false,
      buffs: [], base: { maxHp: unit.hp, regen: unit.regenHp, speed: unit.speed, armor: unit.armor }, damageTaken: 1,
      prevX: x, prevY: y, prevFacing: facing,
    };
  }

  private attackSlots(unit: Unit): AttackSlot[] {
    return unit.attacks.map((a) => ({
      damageBase: a.damageBase, dice: a.dice, sides: a.sides, range: a.range, cooldown: a.cooldown,
      attackType: a.attackType ?? 'normal', filter: parseTargets(a.targets), readyAt: 0,
    }));
  }

  /** Puts weapon items in a ship's inventory (at most six); non-weapon items are kept but inert for now. */
  setItems(ship: UnitEntity, items: string[]): void {
    ship.items = items.slice(0, 6);
    ship.weapons = ship.items.flatMap((itemId) => {
      const w = this.weaponTypes.get(itemId);
      if (!w) return [];
      return [{
        itemId, damage: Number(w.damage) || 0, range: w.range, cooldown: Math.max(0.1, w.cooldown), filter: parseTargets(w.targets), readyAt: 0,
        manual: this.goods.manualOnly.has(itemId), special: this.goods.specials.get(itemId),
      }];
    });
    // Submarine research: better torpedoes and weapons.
    if (SUBMARINES.has(ship.typeId) && ship.hero) {
      ship.attacks = this.attackSlots(this.unitTypes.get(ship.form ?? ship.typeId)!);
      const techs = ship.hero.techs.map((id) => this.goods.purchases.get(id)).flatMap((p) => (p?.kind === 'subTech' ? [p.tech] : []));
      for (const t of techs) {
        for (const w of ship.weapons) { w.damage += t.damage ?? 0; w.range += t.range ?? 0; w.cooldown /= t.rate ?? 1; }
        for (const a of ship.attacks) { a.damageBase += t.damage ?? 0; a.range += t.range ?? 0; a.cooldown /= t.rate ?? 1; }
      }
    }
    this.abilities.refreshStats(ship);
  }

  /**
   * Turns a unit into another unit type (下潜 → H00U) or back (`formId` undefined): speed,
   * regeneration, attacks and sight follow the form; hit points keep their share.
   */
  setForm(u: UnitEntity, formId: string | undefined): void {
    const type = this.unitTypes.get(formId ?? u.typeId);
    if (!type) return;
    u.form = formId;
    u.submerged = !!formId && (type.targetedAs ?? []).includes('ward');
    u.base.speed = type.speed;
    u.base.regen = type.regenHp;
    u.attacks = this.attackSlots(type);
    u.targetId = undefined;
    this.setItems(u, u.items);
  }

  remove(id: number): void {
    this.ships.delete(id);
    this.structures.delete(id);
  }

  issue(command: Command): void {
    this.pending.push(command);
  }

  /** Orders NPC-style travel: follow `goals` in turn, fighting whatever comes into range. */
  attackMove(unit: UnitEntity, goals: Vec2[]): void {
    unit.order = { kind: 'attackMove', goals: [...goals] };
    unit.targetId = undefined;
    unit.path = goals[0] ? this.grid.findPath(unit, goals[0], unit.pathRadius) ?? [] : [];
  }

  step(): void {
    this.events = [];
    for (const u of this.ships.values()) {
      u.prevX = u.x; u.prevY = u.y; u.prevFacing = u.facing;
    }
    for (const p of this.projectiles.values()) {
      p.prevX = p.x; p.prevY = p.y;
    }
    for (const command of this.pending.splice(0)) this.apply(command);
    this.abilities.tick();
    this.updateVision();
    for (const u of this.ships.values()) if (!u.frozen && !hasBuff(u, 'stun')) this.think(u);
    for (const u of this.ships.values()) {
      if (u.frozen || hasBuff(u, 'stun') || hasBuff(u, 'root')) u.speed = 0; else this.move(u);
    }
    this.separate();
    for (const u of [...this.allUnits()]) this.fight(u);
    this.moveProjectiles();
    for (const u of this.allUnits()) {
      const heal = u.regen + strongest(u, 'hot');
      if (u.hp > 0) u.hp = Math.min(u.maxHp, u.hp + heal * TICK_DT);
      dropExpired(u, this.tick);
    }
    this.tick++;
  }

  private apply(command: Command): void {
    const ships = command.unitIds.map((id) => this.ships.get(id)).filter((s): s is UnitEntity => s !== undefined);
    for (const s of ships) s.pendingCast = undefined; // a new order cancels a cast in progress
    if (command.kind === 'stop') {
      for (const s of ships) { s.path = []; s.order = { kind: 'idle' }; }
      return;
    }
    const targets = formationTargets(ships, { x: command.x, y: command.y });
    ships.forEach((ship, i) => {
      ship.order = { kind: 'move' };
      ship.path = this.grid.findPath(ship, targets[i]!, ship.pathRadius) ?? [];
    });
  }

  private enemiesOf(u: UnitEntity): Iterable<UnitEntity> {
    const out: UnitEntity[] = [];
    for (const other of this.allUnits()) if (other.team !== u.team && other.hp > 0 && this.visibleTo(u.team, other)) out.push(other);
    return out;
  }

  /** Whether `team` can target `u`: swarms never; others when seen (fog, invisibility). */
  visibleTo(team: Team, u: UnitEntity): boolean {
    return !u.locust && this.seenBy(team, u);
  }

  /**
   * Whether `team` sees `u`: its own units always, others inside its vision (fog of war) and,
   * when invisible, only if revealed. Neutral creeps see everything.
   */
  seenBy(team: Team, u: UnitEntity): boolean {
    if (team === 'neutral' || u.team === team) return true;
    if (this.vision.enabled && this.vision.version === 0) this.updateVision(true); // first look before any step
    if (!this.vision.sees(team, u.x, u.y)) return false;
    return !hasBuff(u, 'invisible') || this.abilities.revealed(u, team);
  }

  /** Each side's sight: day or night radius of every ship and building it owns. */
  private updateVision(force = false): void {
    const night = isNight(this.tick);
    const viewers = [];
    for (const u of this.allUnits()) {
      if (u.team === 'neutral') continue;
      const type = this.unitTypes.get(u.form ?? u.typeId);
      viewers.push({ team: u.team, x: u.x, y: u.y, hp: u.hp, sight: (night ? type?.nightSight ?? type?.sight : type?.sight) ?? 800 });
    }
    this.vision.update(this.tick, viewers, force);
  }

  canTarget(filter: TargetFilter, target: UnitEntity): boolean {
    if (target.submerged) return filter.wards;
    if (filter.wards && (target.ward || SUBMARINES.has(target.typeId))) return true;
    if (target.ward) return false;
    if (target.kind === 'structure' ? !filter.structures : !filter.ships) return false;
    if (filter.heroesOnly && !target.isHero) return false;
    if (filter.noHeroes && target.isHero) return false;
    return true;
  }

  /** Edge-to-edge distance, so big targets can be hit from their rim. */
  private reach(a: UnitEntity, b: UnitEntity): number {
    return distance(a, b) - b.bodyRadius * 0.6;
  }

  /** Attack-move AI: keep a target in sight, otherwise continue to the next goal. */
  private think(u: UnitEntity): void {
    if (u.order.kind !== 'attackMove' || u.attacks.length === 0) return;
    const range = Math.max(...u.attacks.map((a) => a.range));
    const current = this.unit(u.targetId);
    const lost = !current || current.hp <= 0 || current.team === u.team || !this.visibleTo(u.team, current) || this.reach(u, current) > range + ACQUIRE_BONUS;
    // Without a target, look for one a few times a second (staggered by unit), not every tick.
    if (lost && (current || (this.tick + u.id) % RETARGET_TICKS === 0)) {
      u.targetId = undefined;
      let best: UnitEntity | undefined;
      let bestD = range + ACQUIRE_BONUS;
      for (const e of this.enemiesOf(u)) {
        if (!u.attacks.some((a) => this.canTarget(a.filter, e))) continue;
        const d = this.reach(u, e);
        if (d < bestD) { best = e; bestD = d; }
      }
      u.targetId = best?.id;
    }
    const target = this.unit(u.targetId);
    if (target) {
      // Close in if needed; stop once in range.
      if (this.reach(u, target) > range * 0.9) {
        if (u.path.length === 0 || this.tick % 20 === u.id % 20) u.path = this.grid.findPath(u, target, u.pathRadius) ?? [];
      } else {
        u.path = [];
        u.facing = turnToward(u.facing, Math.atan2(target.y - u.y, target.x - u.x), u.turnSpeed * TICK_DT);
      }
      return;
    }
    // No target: head for the current goal, advancing when it is reached.
    const goals = u.order.goals;
    while (goals.length > 0 && distance(u, goals[0]!) < 200) goals.shift();
    if (goals.length === 0) { u.order = { kind: 'idle' }; u.path = []; return; }
    if (u.path.length === 0) u.path = this.grid.findPath(u, goals[0]!, u.pathRadius) ?? [];
  }

  private move(ship: UnitEntity): void {
    while (ship.path.length > 1 && distance(ship, ship.path[0]!) < WAYPOINT_RADIUS) ship.path.shift();
    const target = ship.path[0];
    let targetSpeed = 0;
    if (target) {
      const dist = distance(ship, target);
      const isLast = ship.path.length === 1;
      if (isLast && dist < Math.max(8, ship.speed * TICK_DT)) {
        ship.path = [];
      } else {
        const desired = Math.atan2(target.y - ship.y, target.x - ship.x);
        ship.facing = turnToward(ship.facing, desired, ship.turnSpeed * TICK_DT);
        const off = Math.abs(wrapAngle(desired - ship.facing));
        const buffed = ship.maxSpeed * (1 + strongest(ship, 'haste')) * (1 - strongest(ship, 'slow'));
        targetSpeed = buffed * Math.max(MIN_TURNING_SPEED, Math.cos(Math.min(off, Math.PI / 2)));
        // Brake into the final point so ships do not overshoot and circle.
        if (isLast) targetSpeed = Math.min(targetSpeed, dist * 2);
      }
    }
    const accel = (ship.maxSpeed / ACCELERATION_TIME) * TICK_DT;
    ship.speed = targetSpeed > ship.speed ? Math.min(targetSpeed, ship.speed + accel) : Math.max(targetSpeed, ship.speed - accel * 2);
    if (ship.speed <= 0) return;

    const step = ship.speed * TICK_DT;
    const nx = ship.x + Math.cos(ship.facing) * step;
    const ny = ship.y + Math.sin(ship.facing) * step;
    if (this.grid.isSailable(nx, ny, ship.pathRadius)) {
      ship.x = nx; ship.y = ny;
    } else if (this.grid.isSailable(nx, ship.y, ship.pathRadius)) {
      ship.x = nx; // slide along the shore
    } else if (this.grid.isSailable(ship.x, ny, ship.pathRadius)) {
      ship.y = ny;
    } else {
      ship.speed = 0;
    }
  }

  /** Fires every ready attack and weapon. */
  private fight(u: UnitEntity): void {
    if (u.hp <= 0 || u.frozen || hasBuff(u, 'stun') || hasBuff(u, 'disarm')) return;
    const bonus = 1 + strongest(u, 'damageBonus');
    // 诅咒: some attacks go wide (the shot is still spent).
    const miss = strongest(u, 'miss');
    let fired = false;
    for (const a of u.attacks) {
      if (this.tick < a.readyAt) continue;
      // Structures and idle units pick the nearest valid enemy; attack-movers use their target.
      let target = this.unit(u.targetId);
      if (!target || target.hp <= 0 || target.team === u.team || !this.visibleTo(u.team, target) || !this.canTarget(a.filter, target) || this.reach(u, target) > a.range) {
        target = undefined;
        let bestD = a.range;
        for (const e of this.enemiesOf(u)) {
          if (!this.canTarget(a.filter, e)) continue;
          const d = this.reach(u, e);
          if (d <= bestD) { target = e; bestD = d; }
        }
      }
      // Nothing in range: look again in a quarter second rather than every tick.
      if (!target) { a.readyAt = this.tick + RETARGET_TICKS; continue; }
      let roll = a.damageBase + u.bonusDamage + Array.from({ length: a.dice }, () => 1 + Math.floor(this.random() * a.sides)).reduce((s, v) => s + v, 0);
      if (u.critChance > 0 && this.random() < u.critChance) roll *= u.critMultiplier;
      if (!(miss > 0 && this.random() < miss)) this.shoot(u, target, roll * bonus, a.attackType, undefined, true);
      fired = true;
      a.readyAt = this.tick + Math.round((a.cooldown / (1 + u.attackSpeedBonus)) * TICK_RATE);
    }
    // Weapons are items, which a submerged submarine cannot use.
    for (const w of u.submerged ? [] : u.weapons) {
      if (w.manual || this.tick < w.readyAt) continue;
      const candidates: UnitEntity[] = [];
      for (const e of this.enemiesOf(u)) if (this.canTarget(w.filter, e) && this.reach(u, e) <= w.range) candidates.push(e);
      if (candidates.length === 0) { w.readyAt = this.tick + RETARGET_TICKS; continue; }
      const target = candidates[Math.floor(this.random() * candidates.length)]!;
      const crit = u.critChance > 0 && this.random() < u.critChance ? u.critMultiplier : 1;
      if (!(miss > 0 && this.random() < miss)) this.shoot(u, target, w.damage * bonus * crit, 'spells', w.special);
      fired = true;
      w.readyAt = this.tick + Math.round(w.cooldown * TICK_RATE);
    }
    // Attacking gives away an invisible ship.
    if (fired && u.buffs.length) u.buffs = u.buffs.filter((b) => b.kind !== 'invisible');
  }

  private shoot(source: UnitEntity, target: UnitEntity, damage: number, attackType: string, special?: WeaponSpecial, attack = false): void {
    const p: Projectile = {
      id: this.nextId++, sourceId: source.id, owner: source.owner, targetId: target.id,
      x: source.x, y: source.y, prevX: source.x, prevY: source.y, damage, attackType, special, attack,
    };
    this.projectiles.set(p.id, p);
    this.events.push({ kind: 'shot', projectileId: p.id, sourceId: source.id, targetId: target.id });
  }

  private moveProjectiles(): void {
    const step = PROJECTILE_SPEED * TICK_DT;
    for (const p of this.projectiles.values()) {
      const target = this.unit(p.targetId);
      if (!target) { this.projectiles.delete(p.id); continue; }
      const d = distance(p, target);
      if (d > step) {
        p.x += ((target.x - p.x) / d) * step;
        p.y += ((target.y - p.y) / d) * step;
        continue;
      }
      this.projectiles.delete(p.id);
      this.dealDamage(target, p.damage, p.attackType, p.owner, p.sourceId, !p.special?.ignoresPlating);
      if (p.special) this.abilities.weaponHit(p, target);
      if (p.attack) this.abilities.attackHit(p, target);
    }
  }

  /**
   * Applies damage and reports deaths. Attacks and weapons are typed and armor-reduced, then
   * scaled by hull plating (damageTaken). Attack type 'ability' is spell damage that ignores
   * armor and plating; 'pure' ignores everything (间谍破坏).
   */
  dealDamage(target: UnitEntity, amount: number, attackType: string, sourceOwner: number, sourceId: number, plating = true): void {
    if (target.hp <= 0 || target.invulnerable || hasBuff(target, 'invulnerable')) return;
    const dealt = attackType === 'ability' || attackType === 'pure'
      ? amount
      : this.damage.damage(amount, attackType, target.armorType, target.armor + strongest(target, 'armorUp') - strongest(target, 'armorDown')) * (plating ? target.damageTaken : 1);
    target.hp -= dealt;
    this.events.push({ kind: 'hit', targetId: target.id, sourceOwner, damage: dealt, attackType, x: target.x, y: target.y });
    this.abilities.onHit(target, sourceId, dealt, attackType);
    if (target.hp > 0) { this.abilities.onDamaged(target); return; }
    target.hp = 0;
    this.remove(target.id);
    this.abilities.onDeath(target, sourceId);
    this.events.push({ kind: 'death', unit: target, killerOwner: sourceOwner, killerId: sourceId });
  }

  /** Pushes overlapping hulls apart; O(n²) is fine for the few hundred ships of a match. */
  private separate(): void {
    const list = [...this.ships.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.bodyRadius + b.bodyRadius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) / 2;
        const ux = d2 > 0 ? dx / d : 1, uy = d2 > 0 ? dy / d : 0;
        this.nudge(a, -ux * push, -uy * push);
        this.nudge(b, ux * push, uy * push);
      }
    }
  }

  private nudge(ship: UnitEntity, dx: number, dy: number): void {
    if (this.grid.isSailable(ship.x + dx, ship.y + dy, ship.pathRadius)) {
      ship.x += dx;
      ship.y += dy;
    }
  }
}

/** Spreads a group's destinations on a grid around the clicked point. */
export function formationTargets(ships: UnitEntity[], center: Vec2): Vec2[] {
  if (ships.length <= 1) return ships.map(() => center);
  const spacing = Math.max(...ships.map((s) => s.bodyRadius)) * 2.2;
  const cols = Math.ceil(Math.sqrt(ships.length));
  const rows = Math.ceil(ships.length / cols);
  return ships.map((_, i) => ({
    x: center.x + ((i % cols) - (cols - 1) / 2) * spacing,
    y: center.y + (Math.floor(i / cols) - (rows - 1) / 2) * spacing,
  }));
}
