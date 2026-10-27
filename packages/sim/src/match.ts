// Match rules on top of World, following docs/mechanics/README.md (extracted from the 7.876
// map script): structures, NPC fleet waves on two lanes, gold, bounties, shops, respawn and
// victory. Section numbers below refer to that document.
import type { Item, MapInfo, Placement, Unit } from '@boom/gamedata';
import { gainXp, HERO_XP_RANGE, killXp, newHero, type HeroState } from './heroes.ts';
import { distance, type Vec2 } from './math.ts';
import { CREEP_OWNER, Creeps } from './creeps.ts';
import { DEFAULT_GRANTS, SUBMARINES } from './goods.ts';
import { teamOfPlayer, TICK_RATE, type Team, type UnitEntity, type World } from './world.ts';

export type GameMode = 'standard' | 'fast';

/** §5: salary base per 7 seconds, split between the team's players. */
const SALARY_BASE: Record<GameMode, number> = { standard: 60, fast: 120 };
const STARTING_GOLD = 400;
/** §5: hero bounty by the dead ship's price. */
const HERO_BOUNTY: [number, number][] = [[9000, 600], [7000, 500], [5000, 400], [3000, 350], [1500, 300], [1000, 250], [500, 200], [0, 150]];
/**
 * How close a ship must be to a shop to trade: the shops' activation radius (Aneu/Ane2 DataA =
 * 450) plus room for a hull, since shops stand on the shore 75–300 from sailable water.
 */
export const SHOP_RANGE = 600;
/** §6/§7: selling ships and items refunds this share of the price. */
const RESALE = 0.6;
const ASSIST_WINDOW_TICKS = 10 * TICK_RATE;
/** §6: invulnerability after a respawn. */
const RESPAWN_SHIELD_TICKS = 5 * TICK_RATE;
/**
 * §6 repair station healing per second as a share of max HP. The map uses repair workers whose
 * rate is not in the data; this restores a ship in about 12 seconds.
 */
const REPAIR_RATE = 1 / 12;
export const REPAIR_RECTS = { south: { station: 'Repair_Station_South', out: 'Repair_Out_South' }, north: { station: 'Repair_Station_North', out: 'Repair_Out_North' } } as const;
/** §3: the west channel, shut in fast mode and opened for 120 s when a whole side is down. */
const WEST_CHANNEL = 'Left_Path';
const WEST_CHANNEL_OPEN_TICKS = 120 * TICK_RATE;
/** §5 Tech_Auto_UP: every 15 minutes, up to 15 times; ship speed only the first 4 times. */
const TECH_INTERVAL_TICKS = 900 * TICK_RATE;
const TECH_MAX = 15;
const TECH_SPEED_MAX = 4;
/** §4 AI_UP: what an NPC gains for sinking a player ship (A06L trick, A06F, A00I, AIsx). */
const NPC_LEVEL_UP = { hp: 300, critChance: 0.2, critMultiplier: 2, regen: 15, attackSpeed: 0.15 } as const;

/** §4: wave definitions. */
const WAVES = [
  { every: 35, delay: 0, count: 6, normal: 'h00I', strong: 'h00E' },
  { every: 60, delay: 2, count: 4, normal: 'h00B', strong: 'h00F' },
  { every: 170, delay: 7, count: 1, normal: 'h00H', strong: 'h00G' },
] as const;
const SUPER_SHIP = 'h018';

/** The two lanes: each side's shipyard and harbour. Handles are the map's preplaced unit names. */
export const LANES = [
  { south: { yard: 'gg_unit_n003_0024', harbour: 'Harbour1_South' }, north: { yard: 'gg_unit_n003_0016', harbour: 'Harbour1_North' } },
  { south: { yard: 'gg_unit_n003_0025', harbour: 'Harbour2_South' }, north: { yard: 'gg_unit_n003_0017', harbour: 'Harbour2_North' } },
] as const;
export const BASES = { south: 'gg_unit_n000_0020', north: 'gg_unit_n000_0018' } as const;
const RESPAWN_RECTS = { south: 'SouthRespawn', north: 'NorthRespawn' } as const;
/** Fleet (computer) player of each side; NPC ships and structures belong to it. */
export const FLEET = { south: 0, north: 1 } as const;

export interface PlayerState {
  index: number;
  team: Team;
  gold: number;
  kills: number;
  deaths: number;
  /** Deaths since this player's last kill; bounty on them shrinks with it (§5). */
  deathStreak: number;
  shipId?: number;
  shipTypeId: string;
  items: string[];
  respawnAt?: number;
  /** Tick when the post-respawn invulnerability ends. */
  shieldUntil?: number;
  /** Experience and skills; kept across deaths, skills reset when changing ships. */
  hero: HeroState;
}

export interface Shop {
  unitId: string;
  /** World unit id when the shop is a structure (e.g. the main base), else undefined. */
  entityId?: number;
  owner: number;
  x: number;
  y: number;
  sellsUnits: string[];
  sellsItems: string[];
}

export type MatchCommand =
  /** `shop`: index into `shops` when the player bought from a selected shop. */
  | { kind: 'buyShip'; player: number; typeId: string; shop?: number }
  | { kind: 'buyItem'; player: number; itemId: string; shop?: number }
  | { kind: 'sellItem'; player: number; slot: number }
  /** §6 the `-out` chat command: leave the repair station early. */
  | { kind: 'leaveRepair'; player: number }
  | { kind: 'learn'; player: number; abilityId: string }
  | { kind: 'cast'; player: number; abilityId: string; unitId?: number; point?: Vec2 }
  | { kind: 'useItem'; player: number; slot: number; unitId?: number; point?: Vec2 };

export type MatchEvent =
  | { kind: 'gold'; player: number; amount: number; reason: string; x?: number; y?: number }
  | { kind: 'denied'; player: number; reason: string }
  | { kind: 'respawn'; player: number; shipId: number }
  | { kind: 'death'; unitId: number; typeId: string; owner: number; x: number; y: number; killerOwner: number; hero: boolean; structure: boolean }
  | { kind: 'victory'; winner: Team }
  | { kind: 'repair'; player: number; active: boolean }
  | { kind: 'westChannel'; open: boolean }
  | { kind: 'levelUp'; player: number; level: number }
  | { kind: 'cast'; casterId: number; abilityId: string; x: number; y: number }
  // Combat feedback for the renderer, passed through from the world.
  | { kind: 'shot'; projectileId: number; sourceId: number; targetId: number }
  | { kind: 'hit'; targetId: number; sourceOwner: number; damage: number; attackType: string; x: number; y: number }
  | { kind: 'zap'; abilityId: string; fromX: number; fromY: number; toX: number; toY: number }
  /** §8: the boss appeared, or a player sank it. */
  | { kind: 'boss'; typeId: string; killed: boolean; killerOwner?: number; x: number; y: number };

export interface MatchData {
  units: Unit[];
  items: Item[];
  map: MapInfo;
}

export class Match {
  readonly world: World;
  readonly mode: GameMode;
  readonly players = new Map<number, PlayerState>();
  readonly shops: Shop[] = [];
  winner?: Team;
  events: MatchEvent[] = [];
  /** Global research level from Tech_Auto_UP. */
  techLevel = 0;
  /** Ship being repaired at each side's station. */
  readonly repairing: Partial<Record<'south' | 'north', number>> = {};
  private westChannelCloseAt?: number;
  private readonly rectBounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  private readonly units: Map<string, Unit>;
  private readonly items: Map<string, Item>;
  private readonly rects: Map<string, Vec2>;
  private readonly handles = new Map<string, number>();
  private readonly pending: MatchCommand[] = [];
  /** victim id → player → last tick they damaged it (§5 assists). */
  private readonly damagedBy = new Map<number, Map<number, number>>();
  private superShipAt?: number;
  /** §8 neutral creep camps and the boss. */
  readonly creeps: Creeps;
  /** The goblin merchant that appears where the boss died, and when it leaves. */
  private goblin?: { entityId: number; until: number };

  constructor(world: World, data: MatchData, options: { mode?: GameMode; players: number[]; fog?: boolean }) {
    this.world = world;
    this.mode = options.mode ?? 'fast';
    this.units = new Map(data.units.map((u) => [u.id, u]));
    this.items = new Map(data.items.map((i) => [i.id, i]));
    this.rects = new Map(data.map.rects.map((r) => [r.name, { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }]));
    for (const r of data.map.rects) this.rectBounds.set(r.name, r);
    // Fog of war; each side always sees its own harbour (CreateFogModifierRectBJ in war3map.j).
    this.world.vision.enabled = options.fog ?? true;
    for (const [team, rect] of [['south', 'South_Harbour'], ['north', 'North_Harbour']] as const) {
      const r = this.rectBounds.get(rect);
      if (r) this.world.vision.addAlwaysVisible(team, r);
    }
    this.creeps = new Creeps(this.world, this.rectBounds);
    // §2: fast mode keeps the west channel shut; standard opens it from the start.
    const channel = this.rectBounds.get(WEST_CHANNEL);
    if (channel && this.mode === 'fast') this.world.grid.setRegionClosed(WEST_CHANNEL, channel, true);
    this.placeStructures(data.map.placements);
    for (const index of options.players) {
      const start = data.map.players.find((p) => p.index === index);
      this.players.set(index, {
        index, team: teamOfPlayer(index), gold: STARTING_GOLD, kills: 0, deaths: 0, deathStreak: 0,
        shipTypeId: 'H000', items: [], hero: newHero(),
      });
      const spot = start?.startX !== undefined ? { x: start.startX, y: start.startY! } : this.rect(RESPAWN_RECTS[teamOfPlayer(index) as 'south' | 'north']);
      this.spawnPlayerShip(index, spot);
    }
    for (const team of ['south', 'north'] as const) this.players.set(FLEET[team], this.fleetState(team));
  }

  private fleetState(team: 'south' | 'north'): PlayerState {
    return { index: FLEET[team], team, gold: 0, kills: 0, deaths: 0, deathStreak: 0, shipTypeId: '', items: [], hero: newHero() };
  }

  /** Center of a named map region (harbours, repair stations, …). */
  rectCenter(name: string): Vec2 {
    return this.rect(name);
  }

  itemPrice(itemId: string): number {
    return this.items.get(itemId)?.goldCost ?? Infinity;
  }

  item(itemId: string): Item | undefined {
    return this.items.get(itemId);
  }

  unitPrice(typeId: string): number {
    return this.units.get(typeId)?.goldCost ?? Infinity;
  }

  /** Shops a player's side may use (own side or neutral, still standing), wherever the ship is. */
  friendlyShops(player: number): Shop[] {
    const team = this.players.get(player)?.team;
    return this.shops.filter((s) => {
      if (s.entityId !== undefined && !this.world.structures.has(s.entityId)) return false;
      const side = teamOfPlayer(s.owner);
      return side === 'neutral' || side === team;
    });
  }

  private rect(name: string): Vec2 {
    const r = this.rects.get(name);
    if (!r) throw new Error(`Missing rect ${name}`);
    return r;
  }

  private placeStructures(placements: Placement[]): void {
    for (const p of placements) {
      const unit = this.units.get(p.id);
      if (!unit?.isBuilding || p.id === 'hhou') continue;
      // Only priced goods make a shop; towers list free quest tokens handed out by triggers.
      const sellsItems = unit.sellsItems.filter((id) => (this.items.get(id)?.goldCost ?? 0) > 0);
      const sells = unit.sellsUnits.length > 0 || sellsItems.length > 0;
      // The fleets' buildings are combat units; neutral shops are just trading posts.
      if (p.player === 0 || p.player === 1) {
        const s = this.world.spawnStructure(p.id, p.player, p.x, p.y, (p.facing * Math.PI) / 180, p.handle);
        if (p.handle) this.handles.set(p.handle, s.id);
        if (sells) this.shops.push({ unitId: p.id, entityId: s.id, owner: p.player, x: p.x, y: p.y, sellsUnits: unit.sellsUnits, sellsItems });
      } else if (sells) {
        this.shops.push({ unitId: p.id, owner: p.player, x: p.x, y: p.y, sellsUnits: unit.sellsUnits, sellsItems });
      }
    }
  }

  private alive(handle: string): boolean {
    const id = this.handles.get(handle);
    return id !== undefined && this.world.structures.has(id);
  }

  structureByHandle(handle: string): UnitEntity | undefined {
    return this.world.structures.get(this.handles.get(handle) ?? -1);
  }

  issue(command: MatchCommand): void {
    this.pending.push(command);
  }

  get seconds(): number {
    return this.world.tick / TICK_RATE;
  }

  step(): void {
    this.events = [];
    // Damage dealt outside a step (scripted effects, tests) is reported before the step clears it.
    this.consumeWorldEvents();
    const tick = this.world.tick;
    for (const c of this.pending.splice(0)) this.apply(c);
    this.world.step();
    this.consumeWorldEvents();
    if (this.winner) return;
    const boss = this.creeps.bossId;
    this.creeps.tick();
    if (boss === undefined && this.creeps.bossId !== undefined) {
      const b = this.world.unit(this.creeps.bossId)!;
      this.events.push({ kind: 'boss', typeId: b.typeId, killed: false, x: b.x, y: b.y });
    }
    if (this.goblin && tick >= this.goblin.until) {
      this.world.remove(this.goblin.entityId);
      const id = this.goblin.entityId;
      this.shops.splice(0, this.shops.length, ...this.shops.filter((s) => s.entityId !== id));
      this.goblin = undefined;
    }
    this.spawnWaves(tick);
    if (tick > 0 && tick % (7 * TICK_RATE) === 0) this.paySalary();
    if (tick > 0 && tick % (180 * TICK_RATE) === 0) this.payEmpireGold();
    if (tick > 0 && tick % TECH_INTERVAL_TICKS === 0 && this.techLevel < TECH_MAX) this.raiseTech();
    if (this.westChannelCloseAt !== undefined && tick >= this.westChannelCloseAt) this.setWestChannel(false);
    this.runRepairStations();
    for (const p of this.players.values()) {
      if (p.respawnAt !== undefined && tick >= p.respawnAt) this.respawn(p);
      const ship = this.world.ships.get(p.shipId ?? -1);
      if (ship?.invulnerable && p.shieldUntil !== undefined && tick >= p.shieldUntil) {
        ship.invulnerable = false;
        p.shieldUntil = undefined;
      }
    }
  }

  private consumeWorldEvents(): void {
    for (const e of this.world.events) {
      if (e.kind === 'hit') this.noteDamage(e.targetId, e.sourceOwner);
      if (e.kind === 'cast' || e.kind === 'shot' || e.kind === 'hit' || e.kind === 'zap') this.events.push(e);
      if (e.kind === 'itemUsed') {
        const p = [...this.players.values()].find((q) => q.shipId === e.unitId);
        if (p) p.items = [...(this.world.ships.get(e.unitId)?.items ?? [])];
      }
      if (e.kind === 'death') {
        this.events.push({
          kind: 'death', unitId: e.unit.id, typeId: e.unit.typeId, owner: e.unit.owner, x: e.unit.x, y: e.unit.y,
          killerOwner: e.killerOwner, hero: e.unit.isHero && !e.unit.illusion && !e.unit.summoned, structure: e.unit.kind === 'structure',
        });
        if (!e.unit.illusion) this.onDeath(e.unit, e.killerOwner, e.killerId);
      }
      if (e.kind === 'reward') {
        const p = this.players.get(e.player);
        if (!p) continue;
        if (e.gold > 0) this.give(e.player, e.gold, 'skill', e);
        if (e.xp > 0 && gainXp(p.hero, e.xp) > 0) this.events.push({ kind: 'levelUp', player: p.index, level: p.hero.level });
      }
    }
    this.world.events = [];
  }

  // §4 waves ------------------------------------------------------------------------------

  private spawnWaves(tick: number): void {
    const allYardsDown = LANES.every((l) => !this.alive(l.south.yard) && !this.alive(l.north.yard));
    if (!allYardsDown) {
      for (const w of WAVES) {
        const t = tick - w.delay * TICK_RATE;
        if (t >= 0 && t % (w.every * TICK_RATE) === 0) this.spawnWave(w.count, w.normal, w.strong);
      }
    }
    if (this.superShipAt !== undefined && tick >= this.superShipAt) {
      this.superShipAt = tick + 600 * TICK_RATE;
      for (const lane of LANES) {
        for (const side of ['south', 'north'] as const) {
          const enemy = side === 'south' ? 'north' : 'south';
          if (!this.alive(lane[enemy].yard)) this.spawnLaneShips(side, lane, 1, SUPER_SHIP);
        }
      }
    }
  }

  private spawnWave(count: number, normal: string, strong: string): void {
    for (const lane of LANES) {
      for (const side of ['south', 'north'] as const) {
        const enemy = side === 'south' ? 'north' : 'south';
        if (!this.alive(lane[side].yard)) continue; // a lost shipyard stops its lane
        this.spawnLaneShips(side, lane, count, this.alive(lane[enemy].yard) ? normal : strong);
      }
    }
  }

  private spawnLaneShips(side: 'south' | 'north', lane: (typeof LANES)[number], count: number, typeId: string): void {
    const enemy = side === 'south' ? 'north' : 'south';
    const from = this.rect(lane[side].harbour);
    const goals = [this.rect(lane[enemy].harbour), this.structureByHandle(BASES[enemy]) ?? this.rect(lane[enemy].harbour)];
    const radius = this.units.get(typeId)?.collision ?? 16;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const spot = this.world.grid.nearestSailable(from.x + Math.cos(angle) * 120, from.y + Math.sin(angle) * 120, radius) ?? from;
      const ship = this.world.spawnShip(typeId, FLEET[side], spot.x, spot.y, side === 'south' ? Math.PI / 2 : -Math.PI / 2);
      this.applyTech(ship, this.techLevel, 0);
      this.world.attackMove(ship, goals.map((g) => ({ x: g.x, y: g.y })));
    }
  }

  // §5 economy ----------------------------------------------------------------------------

  private give(player: number, amount: number, reason: string, at?: Vec2): void {
    const p = this.players.get(player);
    if (!p || amount <= 0) return;
    p.gold += amount;
    this.events.push({ kind: 'gold', player, amount, reason, x: at?.x, y: at?.y });
  }

  private teamPlayers(team: Team): PlayerState[] {
    return [...this.players.values()].filter((p) => p.team === team && p.index !== FLEET.south && p.index !== FLEET.north);
  }

  private paySalary(): void {
    for (const team of ['south', 'north'] as const) {
      const members = this.teamPlayers(team);
      if (members.length === 0) continue;
      const share = Math.floor(SALARY_BASE[this.mode] / members.length);
      for (const p of members) this.give(p.index, share, 'salary');
    }
  }

  private payEmpireGold(): void {
    for (const team of ['south', 'north'] as const) {
      const fleet = this.players.get(FLEET[team])!;
      const members = this.teamPlayers(team);
      if (fleet.gold <= 0 || members.length === 0) continue;
      const share = Math.floor((fleet.gold * 0.8) / members.length);
      fleet.gold = 0;
      for (const p of members) this.give(p.index, share, 'empire');
    }
  }

  private noteDamage(targetId: number, sourcePlayer: number): void {
    let byPlayer = this.damagedBy.get(targetId);
    if (!byPlayer) this.damagedBy.set(targetId, (byPlayer = new Map()));
    byPlayer.set(sourcePlayer, this.world.tick);
  }

  private onDeath(unit: UnitEntity, killerOwner: number, killerId: number): void {
    const killer = this.players.get(killerOwner);
    const enemyKill = killer && killer.team !== unit.team;
    const victim = [...this.players.values()].find((p) => p.shipId === unit.id);
    if (unit.owner === CREEP_OWNER && this.creeps.onDeath(unit)) this.onBossDeath(unit, killerOwner);
    // §5: sunk by creeps costs 50 + price / 30 + level × 6 gold.
    if (victim && killerOwner === CREEP_OWNER) {
      const price = this.units.get(unit.typeId)?.goldCost ?? 0;
      victim.gold = Math.max(0, victim.gold - Math.floor(50 + price / 30 + victim.hero.level * 6));
    }
    if (victim && victim.team !== 'neutral') {
      const killerUnit = this.world.unit(killerId);
      if (killerUnit && !killerUnit.isHero) this.levelUpNpc(killerUnit);
      const side = victim.team as 'south' | 'north';
      if (this.repairing[side] === unit.id) delete this.repairing[side];
    }
    if (victim) {
      victim.shipId = undefined;
      victim.deaths++;
      victim.deathStreak++;
      // §6: respawn after level × 2 + 5 + 0..3 seconds.
      victim.respawnAt = this.world.tick + Math.round((victim.hero.level * 2 + 5 + Math.floor(this.world.random() * 4)) * TICK_RATE);
      // §3 PathLeft_On: a side with every player down gets the west channel for 120 s.
      const side = this.teamPlayers(victim.team);
      if (this.mode === 'fast' && side.length > 0 && side.every((p) => p.shipId === undefined)) this.setWestChannel(true);
      if (enemyKill) {
        const price = this.units.get(unit.typeId)?.goldCost ?? 0;
        const base = unit.typeId === 'H00D' ? 400 : HERO_BOUNTY.find(([min]) => price >= min)![1];
        const bounty = Math.floor((base * (12 - Math.min(7, Math.max(2, victim.deathStreak)))) / 10);
        this.give(killerOwner, bounty, 'kill', unit);
        killer.kills++;
        killer.deathStreak = 0;
        const assisters = [...(this.damagedBy.get(unit.id) ?? [])]
          .filter(([p, at]) => p !== killerOwner && this.world.tick - at <= ASSIST_WINDOW_TICKS && this.players.get(p)?.team === killer.team)
          .map(([p]) => p);
        for (const p of assisters) this.give(p, Math.floor((bounty * 0.7) / assisters.length), 'assist', unit);
      }
    } else if (enemyKill) {
      const b = this.units.get(unit.typeId)?.bounty;
      if (b) {
        const roll = b.base + Array.from({ length: b.dice }, () => 1 + Math.floor(this.world.random() * b.sides)).reduce((s, v) => s + v, 0);
        this.give(killerOwner, roll, 'bounty', unit);
      }
    }
    this.damagedBy.delete(unit.id);
    if (killer && killer.team !== unit.team) this.shareXp(unit);

    if (unit.kind === 'structure') {
      if (unit.typeId === 'n003' && this.superShipAt === undefined) this.superShipAt = this.world.tick + 300 * TICK_RATE;
      if (unit.handle === BASES.south) this.win('north');
      if (unit.handle === BASES.north) this.win('south');
    }
  }

  /**
   * §8 BossTime1: the killer's ship gains 300 max HP for good (the map's add-ability, set level 9,
   * remove trick on A06L), and the goblin merchant appears for 65 s with one of two special cannons.
   */
  private onBossDeath(boss: UnitEntity, killerOwner: number): void {
    const killer = this.players.get(killerOwner);
    if (killer && killerOwner >= 2) {
      killer.hero.bonusHp += 300;
      const ship = this.world.ships.get(killer.shipId ?? -1);
      if (ship) this.world.abilities.refreshStats(ship);
    }
    this.events.push({ kind: 'boss', typeId: boss.typeId, killed: true, killerOwner, x: boss.x, y: boss.y });
    const unit = this.units.get('h01T');
    if (!unit || this.goblin) return;
    const at = this.rect('YeGuai_BOSS');
    const goblin = this.world.spawnStructure('h01T', 15, at.x, at.y);
    goblin.invulnerable = true;
    const cannon = this.world.random() < 0.5 ? 'I05W' : 'I05X';
    this.shops.push({ unitId: 'h01T', entityId: goblin.id, owner: 15, x: at.x, y: at.y, sellsUnits: [], sellsItems: [...unit.sellsItems, cannon] });
    this.goblin = { entityId: goblin.id, until: this.world.tick + 65 * TICK_RATE };
  }

  /** Allied ships near a dead enemy split its experience; fast mode grants 150%. */
  private shareXp(dead: UnitEntity): void {
    const level = dead.hero?.level ?? this.units.get(dead.typeId)?.level ?? 1;
    const total = killXp(dead.isHero, level) * (this.mode === 'fast' ? 1.5 : 1);
    const earners = this.teamPlayers(dead.team === 'south' ? 'north' : 'south')
      .map((p) => ({ p, ship: this.world.ships.get(p.shipId ?? -1) }))
      .filter((e) => e.ship && distance(e.ship, dead) <= HERO_XP_RANGE);
    for (const { p } of earners) {
      const gained = gainXp(p.hero, total / earners.length);
      if (gained > 0) this.events.push({ kind: 'levelUp', player: p.index, level: p.hero.level });
    }
  }

  private win(team: Team): void {
    this.winner = team;
    this.events.push({ kind: 'victory', winner: team });
  }

  // §5 research, §4 NPC level-up, §3 west channel ------------------------------------------

  private raiseTech(): void {
    const from = this.techLevel;
    this.techLevel++;
    for (const u of this.world.allUnits()) this.applyTech(u, this.techLevel, from);
  }

  /** Applies research levels (from → to) to one unit: R001/R005 damage, R003 HP, R004 speed. */
  private applyTech(u: UnitEntity, to: number, from: number): void {
    const levels = to - from;
    if (levels <= 0) return;
    if (u.upgrades.includes('R001') || u.upgrades.includes('R005')) u.bonusDamage += 10 * levels;
    if (u.upgrades.includes('R003')) u.base.maxHp += (this.units.get(u.typeId)?.hp ?? u.base.maxHp) * 0.2 * levels;
    if (u.upgrades.includes('R004')) u.base.speed += 20 * (Math.min(to, TECH_SPEED_MAX) - Math.min(from, TECH_SPEED_MAX));
    this.world.abilities.refreshStats(u);
  }

  private levelUpNpc(u: UnitEntity): void {
    if (u.kind !== 'structure') u.base.maxHp += NPC_LEVEL_UP.hp;
    if (u.critChance === 0) {
      u.critChance = NPC_LEVEL_UP.critChance;
      u.critMultiplier = NPC_LEVEL_UP.critMultiplier;
    } else if (u.base.regen < NPC_LEVEL_UP.regen) {
      u.base.regen += NPC_LEVEL_UP.regen;
    } else if (u.attackSpeedBonus === 0) {
      u.attackSpeedBonus = NPC_LEVEL_UP.attackSpeed;
    }
    this.world.abilities.refreshStats(u);
  }

  private setWestChannel(open: boolean): void {
    const rect = this.rectBounds.get(WEST_CHANNEL);
    if (!rect || this.world.grid.isRegionClosed(WEST_CHANNEL) === !open) return;
    this.world.grid.setRegionClosed(WEST_CHANNEL, rect, !open);
    this.westChannelCloseAt = open ? this.world.tick + WEST_CHANNEL_OPEN_TICKS : undefined;
    this.events.push({ kind: 'westChannel', open });
  }

  get westChannelOpen(): boolean {
    return !this.world.grid.isRegionClosed(WEST_CHANNEL);
  }

  // §6 repair station ---------------------------------------------------------------------

  private inRect(name: string, p: Vec2): boolean {
    const r = this.rectBounds.get(name);
    return !!r && p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
  }

  /** One ship at a time: held in place and invulnerable while it is repaired, then sent out. */
  private runRepairStations(): void {
    for (const side of ['south', 'north'] as const) {
      const rects = REPAIR_RECTS[side];
      const current = this.world.ships.get(this.repairing[side] ?? -1);
      if (current) {
        current.hp = Math.min(current.maxHp, current.hp + current.maxHp * REPAIR_RATE / TICK_RATE);
        if (current.hp >= current.maxHp) this.releaseFromRepair(side);
        continue;
      }
      delete this.repairing[side];
      for (const p of this.teamPlayers(side)) {
        const ship = this.world.ships.get(p.shipId ?? -1);
        if (!ship || ship.hp >= ship.maxHp || ship.path.length > 0 || !this.inRect(rects.station, ship)) continue;
        this.repairing[side] = ship.id;
        ship.frozen = true;
        ship.invulnerable = true;
        this.events.push({ kind: 'repair', player: p.index, active: true });
        break;
      }
    }
  }

  private releaseFromRepair(side: 'south' | 'north'): void {
    const ship = this.world.ships.get(this.repairing[side] ?? -1);
    delete this.repairing[side];
    if (!ship) return;
    ship.frozen = false;
    ship.invulnerable = false;
    const out = this.rect(REPAIR_RECTS[side].out);
    this.world.issue({ kind: 'move', unitIds: [ship.id], x: out.x, y: out.y });
    this.events.push({ kind: 'repair', player: ship.owner, active: false });
  }

  // §6 ships, shops, respawn --------------------------------------------------------------

  private spawnPlayerShip(index: number, at: Vec2): UnitEntity {
    const p = this.players.get(index)!;
    const radius = this.units.get(p.shipTypeId)?.collision ?? 16;
    const spot = this.world.grid.nearestSailable(at.x, at.y, radius) ?? at;
    const ship = this.world.spawnShip(p.shipTypeId, index, spot.x, spot.y, p.team === 'south' ? Math.PI / 2 : -Math.PI / 2);
    ship.hero = p.hero;
    for (const [id, level] of Object.entries(DEFAULT_GRANTS[p.shipTypeId] ?? {})) p.hero.granted[id] ??= level;
    this.world.setItems(ship, p.items);
    p.shipId = ship.id;
    return ship;
  }

  private respawn(p: PlayerState): void {
    p.respawnAt = undefined;
    const ship = this.spawnPlayerShip(p.index, this.rect(RESPAWN_RECTS[p.team as 'south' | 'north']));
    ship.invulnerable = true;
    p.shieldUntil = this.world.tick + RESPAWN_SHIELD_TICKS;
    this.events.push({ kind: 'respawn', player: p.index, shipId: ship.id });
  }

  /** Shops near the player's ship that are on their side (or neutral) and still standing. */
  shopsInReach(player: number): Shop[] {
    const p = this.players.get(player);
    const ship = this.world.ships.get(p?.shipId ?? -1);
    if (!p || !ship) return [];
    return this.shops.filter((s) => {
      if (s.entityId !== undefined && !this.world.structures.has(s.entityId)) return false;
      const side = teamOfPlayer(s.owner);
      if (side !== 'neutral' && side !== p.team) return false;
      return distance(ship, s) <= SHOP_RANGE;
    });
  }

  private deny(player: number, reason: string): void {
    this.events.push({ kind: 'denied', player, reason });
  }

  /** §4 Buy_NPC: shipyards sell upgraded fleet ships that join the side's fleet and attack. */
  private hireFleetShip(p: PlayerState, typeId: string, shop: Shop): void {
    const price = this.units.get(typeId)?.goldCost ?? Infinity;
    if (p.gold < price) return this.deny(p.index, '金钱不足');
    p.gold -= price;
    const side = p.team as 'south' | 'north';
    const enemy = side === 'south' ? 'north' : 'south';
    const spot = this.world.grid.nearestSailable(shop.x, shop.y, this.units.get(typeId)?.collision ?? 16) ?? shop;
    const ship = this.world.spawnShip(typeId, FLEET[side], spot.x, spot.y);
    this.applyTech(ship, this.techLevel, 0);
    const base = this.structureByHandle(BASES[enemy]);
    if (base) this.world.attackMove(ship, [{ x: base.x, y: base.y }]);
  }

  /** The usable ability of an item (blink, repair kit), if it has one; `@<item>` for scripted ones. */
  activeItemAbility(itemId: string | undefined): string | undefined {
    if (itemId && this.world.goods.groundMissiles.has(itemId)) return `@${itemId}`;
    return this.items.get(itemId ?? '')?.abilities.find((id) => this.world.abilities.targeting(id) !== 'passive');
  }

  /**
   * Goods used up on purchase (UP_Unit, Buy_QianShui_Item, 船只特殊能力 in war3map.j). Returns a
   * refusal, or undefined once applied. The gold is taken by the caller.
   */
  private applyPurchase(p: PlayerState, ship: UnitEntity, itemId: string): string | undefined {
    const buy = this.world.goods.purchases.get(itemId);
    if (!buy) return undefined;
    const hero = p.hero;
    switch (buy.kind) {
      case 'upgrade': {
        const pair = buy.pairs.find(([from]) => p.items.includes(from));
        if (!pair) return `需要先装备${this.items.get(buy.pairs[0]![0])?.name ?? '对应的武器'}`;
        p.items[p.items.indexOf(pair[0])] = pair[1];
        break;
      }
      case 'combine': {
        const left = [...p.items];
        for (const id of buy.needs) {
          const i = left.indexOf(id);
          if (i < 0) return `合成需要：${buy.needs.map((n) => this.items.get(n)?.name ?? n).join('、')}`;
          left.splice(i, 1);
        }
        p.items = [...left, buy.to];
        break;
      }
      case 'hull': {
        const bonus = buy.bonus[p.shipTypeId];
        if (!bonus) return '您的船不符合改装要求';
        if (hero.hullBonus[p.shipTypeId]) return '每艘船只能升级一次';
        hero.hullBonus[p.shipTypeId] = bonus;
        break;
      }
      case 'shipSkill': {
        if (buy.ships && !buy.ships.includes(p.shipTypeId)) return '您的船不符合改装要求';
        const a = this.world.abilities.byId.get(buy.abilityId);
        const now = hero.granted[buy.abilityId] ?? 0;
        if (now === 0 && Object.keys(hero.granted).some((id) => this.world.goods.isShipSkill(id))) return '每艘船只能安装一种特殊能力';
        if (now >= (a?.levels.length ?? 1)) return '已经是最高等级';
        hero.granted[buy.abilityId] = now + 1;
        hero.invested += 2;
        break;
      }
      case 'subTech':
        if (!SUBMARINES.has(p.shipTypeId)) return '非潜水艇，不能安装';
        if (hero.techs.includes(itemId)) return '已经安装过了';
        hero.techs.push(itemId);
        hero.invested += buy.value;
        break;
      case 'subSkill': {
        if (!SUBMARINES.has(p.shipTypeId)) return '非潜水艇，不能安装';
        const now = hero.granted[buy.abilityId] ?? 0;
        const next = buy.level || now + 1;
        const max = this.world.abilities.byId.get(buy.abilityId)?.levels.length ?? 1;
        if (now >= next || next > max) return '已经安装过了';
        hero.granted[buy.abilityId] = next;
        hero.invested += buy.value;
        break;
      }
      case 'reset': {
        // 重设技能: skill points back, bought ship skills removed and refunded.
        p.gold += hero.invested * 60;
        hero.invested = 0;
        hero.learned = {};
        for (const id of Object.keys(hero.granted)) if (this.world.goods.isShipSkill(id)) delete hero.granted[id];
        break;
      }
    }
    this.world.setItems(ship, p.items);
    return undefined;
  }

  private apply(c: MatchCommand): void {
    const p = this.players.get(c.player);
    if (!p) return;
    const ship = this.world.ships.get(p.shipId ?? -1);
    if (c.kind === 'learn') {
      if (!ship || !this.world.abilities.learn(ship, c.abilityId)) this.deny(c.player, '现在还不能学习这个技能');
      return;
    }
    if (c.kind === 'cast' || c.kind === 'useItem') {
      if (!ship) return;
      const abilityId = c.kind === 'cast' ? c.abilityId : this.activeItemAbility(p.items[c.slot]);
      if (!abilityId) return this.deny(c.player, '这件物品不能主动使用');
      const reason = this.world.abilities.cast(ship, abilityId, { unitId: c.unitId, point: c.point }, c.kind === 'useItem' ? c.slot : undefined);
      if (reason) this.deny(c.player, reason);
      return;
    }
    if (c.kind === 'leaveRepair') {
      const side = p.team as 'south' | 'north';
      if (ship && this.repairing[side] === ship.id) this.releaseFromRepair(side);
      return;
    }
    if (!ship) return this.deny(c.player, '船只阵亡中，复活后才能交易');
    const shops = this.shopsInReach(c.player);
    // Buying from a selected shop: that shop must be in reach and sell the goods.
    const chosen = 'shop' in c && c.shop !== undefined ? this.shops[c.shop] : undefined;
    if (chosen && !shops.includes(chosen)) return this.deny(c.player, '船只需要靠近这家商店');
    if (c.kind === 'buyShip') {
      const shop = chosen?.sellsUnits.includes(c.typeId) ? chosen : shops.find((s) => s.sellsUnits.includes(c.typeId));
      if (!shop) return this.deny(c.player, '附近没有出售这艘船的商店');
      if (!this.world.shipType(c.typeId)) return this.hireFleetShip(p, c.typeId, shop);
      const price = this.units.get(c.typeId)?.goldCost ?? Infinity;
      const refund = Math.floor((this.units.get(p.shipTypeId)?.goldCost ?? 0) * RESALE);
      if (p.gold + refund < price) return this.deny(c.player, '金钱不足');
      // The old hull's bought upgrades are sold with it (60 gold per upgrade point, as the map does).
      p.gold += refund - price + p.hero.invested * 60;
      p.shipTypeId = c.typeId;
      // A new hull keeps the captain's experience but its skills are learned afresh.
      p.hero.learned = {};
      p.hero.readyAt = {};
      p.hero.granted = { ...DEFAULT_GRANTS[c.typeId] };
      p.hero.invested = 0;
      const at = { x: ship.x, y: ship.y };
      this.world.remove(ship.id);
      this.spawnPlayerShip(p.index, at);
    } else if (c.kind === 'buyItem') {
      if (!(chosen ?? undefined)?.sellsItems.includes(c.itemId) && !shops.some((s) => s.sellsItems.includes(c.itemId))) return this.deny(c.player, '附近没有出售这件物品的商店');
      const price = this.items.get(c.itemId)?.goldCost ?? Infinity;
      if (p.gold < price) return this.deny(c.player, '金钱不足');
      const goods = this.world.goods;
      if (goods.purchases.has(c.itemId)) {
        const refused = this.applyPurchase(p, ship, c.itemId);
        if (refused) return this.deny(c.player, refused);
        p.gold -= price;
        return;
      }
      // Multi-use consumables stack their charges in one slot.
      const uses = goods.charges.get(c.itemId);
      if (uses && p.items.includes(c.itemId)) {
        p.gold -= price;
        p.hero.charges[c.itemId] = (p.hero.charges[c.itemId] ?? 0) + uses;
        return;
      }
      if (p.items.length >= 6) return this.deny(c.player, '物品栏已满');
      const group = goods.uniqueGroup.get(c.itemId);
      if (group && p.items.some((id) => goods.uniqueGroup.get(id) === group)) return this.deny(c.player, `只能携带一个${group}`);
      p.gold -= price;
      p.items.push(c.itemId);
      if (uses) p.hero.charges[c.itemId] = uses;
      this.world.setItems(ship, p.items);
    } else if (c.kind === 'sellItem') {
      const itemId = p.items[c.slot];
      if (!itemId) return;
      if (shops.length === 0) return this.deny(c.player, '要在商店附近才能出售');
      p.items.splice(c.slot, 1);
      delete p.hero.charges[itemId];
      p.gold += Math.floor((this.items.get(itemId)?.goldCost ?? 0) * RESALE);
      this.world.setItems(ship, p.items);
    }
  }
}
