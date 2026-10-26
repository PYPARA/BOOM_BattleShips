// Match rules on top of World, following docs/mechanics/README.md (extracted from the 7.876
// map script): structures, NPC fleet waves on two lanes, gold, bounties, shops, respawn and
// victory. Section numbers below refer to that document.
import type { Item, MapInfo, Placement, Unit } from '@boom/gamedata';
import { distance, type Vec2 } from './math.ts';
import { teamOfPlayer, TICK_RATE, type Team, type UnitEntity, type World } from './world.ts';

export type GameMode = 'standard' | 'fast';

/** §5: salary base per 7 seconds, split between the team's players. */
const SALARY_BASE: Record<GameMode, number> = { standard: 60, fast: 120 };
const STARTING_GOLD = 400;
/** §5: hero bounty by the dead ship's price. */
const HERO_BOUNTY: [number, number][] = [[9000, 600], [7000, 500], [5000, 400], [3000, 350], [1500, 300], [1000, 250], [500, 200], [0, 150]];
/**
 * How close a ship must be to a shop to trade. Not in the map data: tuned so a ship anywhere in
 * its home harbour reaches every home shop (they sit up to ~1250 from the start points).
 */
export const SHOP_RANGE = 1300;
/** §6/§7: selling ships and items refunds this share of the price. */
const RESALE = 0.6;
const ASSIST_WINDOW_TICKS = 10 * TICK_RATE;

/** §4: wave definitions. */
const WAVES = [
  { every: 35, delay: 0, count: 6, normal: 'h00I', strong: 'h00E' },
  { every: 60, delay: 2, count: 4, normal: 'h00B', strong: 'h00F' },
  { every: 170, delay: 7, count: 1, normal: 'h00H', strong: 'h00G' },
] as const;
const SUPER_SHIP = 'h018';

/** The two lanes: each side's shipyard and harbour. Handles are the map's preplaced unit names. */
const LANES = [
  { south: { yard: 'gg_unit_n003_0024', harbour: 'Harbour1_South' }, north: { yard: 'gg_unit_n003_0016', harbour: 'Harbour1_North' } },
  { south: { yard: 'gg_unit_n003_0025', harbour: 'Harbour2_South' }, north: { yard: 'gg_unit_n003_0017', harbour: 'Harbour2_North' } },
] as const;
const BASES = { south: 'gg_unit_n000_0020', north: 'gg_unit_n000_0018' } as const;
const RESPAWN_RECTS = { south: 'SouthRespawn', north: 'NorthRespawn' } as const;
/** Fleet (computer) player of each side; NPC ships and structures belong to it. */
const FLEET = { south: 0, north: 1 } as const;

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
  | { kind: 'buyShip'; player: number; typeId: string }
  | { kind: 'buyItem'; player: number; itemId: string }
  | { kind: 'sellItem'; player: number; slot: number };

export type MatchEvent =
  | { kind: 'gold'; player: number; amount: number; reason: string; x?: number; y?: number }
  | { kind: 'denied'; player: number; reason: string }
  | { kind: 'respawn'; player: number; shipId: number }
  | { kind: 'death'; unitId: number; typeId: string; owner: number; x: number; y: number }
  | { kind: 'victory'; winner: Team };

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
  private readonly units: Map<string, Unit>;
  private readonly items: Map<string, Item>;
  private readonly rects: Map<string, Vec2>;
  private readonly handles = new Map<string, number>();
  private readonly pending: MatchCommand[] = [];
  /** victim id → player → last tick they damaged it (§5 assists). */
  private readonly damagedBy = new Map<number, Map<number, number>>();
  private superShipAt?: number;

  constructor(world: World, data: MatchData, options: { mode?: GameMode; players: number[] }) {
    this.world = world;
    this.mode = options.mode ?? 'fast';
    this.units = new Map(data.units.map((u) => [u.id, u]));
    this.items = new Map(data.items.map((i) => [i.id, i]));
    this.rects = new Map(data.map.rects.map((r) => [r.name, { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }]));
    this.placeStructures(data.map.placements);
    for (const index of options.players) {
      const start = data.map.players.find((p) => p.index === index);
      this.players.set(index, {
        index, team: teamOfPlayer(index), gold: STARTING_GOLD, kills: 0, deaths: 0, deathStreak: 0,
        shipTypeId: 'H000', items: [],
      });
      const spot = start?.startX !== undefined ? { x: start.startX, y: start.startY! } : this.rect(RESPAWN_RECTS[teamOfPlayer(index) as 'south' | 'north']);
      this.spawnPlayerShip(index, spot);
    }
    for (const team of ['south', 'north'] as const) this.players.set(FLEET[team], this.fleetState(team));
  }

  private fleetState(team: 'south' | 'north'): PlayerState {
    return { index: FLEET[team], team, gold: 0, kills: 0, deaths: 0, deathStreak: 0, shipTypeId: '', items: [] };
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
      const sells = unit.sellsUnits.length > 0 || unit.sellsItems.length > 0;
      // The fleets' buildings are combat units; neutral shops are just trading posts.
      if (p.player === 0 || p.player === 1) {
        const s = this.world.spawnStructure(p.id, p.player, p.x, p.y, (p.facing * Math.PI) / 180, p.handle);
        if (p.handle) this.handles.set(p.handle, s.id);
        if (sells) this.shops.push({ unitId: p.id, entityId: s.id, owner: p.player, x: p.x, y: p.y, sellsUnits: unit.sellsUnits, sellsItems: unit.sellsItems });
      } else if (sells) {
        this.shops.push({ unitId: p.id, owner: p.player, x: p.x, y: p.y, sellsUnits: unit.sellsUnits, sellsItems: unit.sellsItems });
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
    this.spawnWaves(tick);
    if (tick > 0 && tick % (7 * TICK_RATE) === 0) this.paySalary();
    if (tick > 0 && tick % (180 * TICK_RATE) === 0) this.payEmpireGold();
    for (const p of this.players.values()) {
      if (p.respawnAt !== undefined && tick >= p.respawnAt) this.respawn(p);
    }
  }

  private consumeWorldEvents(): void {
    for (const e of this.world.events) {
      if (e.kind === 'hit') this.noteDamage(e.targetId, e.sourceOwner);
      if (e.kind === 'death') {
        this.events.push({ kind: 'death', unitId: e.unit.id, typeId: e.unit.typeId, owner: e.unit.owner, x: e.unit.x, y: e.unit.y });
        this.onDeath(e.unit, e.killerOwner);
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

  private onDeath(unit: UnitEntity, killerOwner: number): void {
    const killer = this.players.get(killerOwner);
    const enemyKill = killer && killer.team !== unit.team;
    const victim = [...this.players.values()].find((p) => p.shipId === unit.id);
    if (victim) {
      victim.shipId = undefined;
      victim.deaths++;
      victim.deathStreak++;
      // §6: respawn after level × 2 + 5 + 0..3 seconds (all ships are level 1 until M3).
      victim.respawnAt = this.world.tick + Math.round((1 * 2 + 5 + Math.floor(this.world.random() * 4)) * TICK_RATE);
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

    if (unit.kind === 'structure') {
      if (unit.typeId === 'n003' && this.superShipAt === undefined) this.superShipAt = this.world.tick + 300 * TICK_RATE;
      if (unit.handle === BASES.south) this.win('north');
      if (unit.handle === BASES.north) this.win('south');
    }
  }

  private win(team: Team): void {
    this.winner = team;
    this.events.push({ kind: 'victory', winner: team });
  }

  // §6 ships, shops, respawn --------------------------------------------------------------

  private spawnPlayerShip(index: number, at: Vec2): UnitEntity {
    const p = this.players.get(index)!;
    const radius = this.units.get(p.shipTypeId)?.collision ?? 16;
    const spot = this.world.grid.nearestSailable(at.x, at.y, radius) ?? at;
    const ship = this.world.spawnShip(p.shipTypeId, index, spot.x, spot.y, p.team === 'south' ? Math.PI / 2 : -Math.PI / 2);
    this.world.setItems(ship, p.items);
    p.shipId = ship.id;
    return ship;
  }

  private respawn(p: PlayerState): void {
    p.respawnAt = undefined;
    const ship = this.spawnPlayerShip(p.index, this.rect(RESPAWN_RECTS[p.team as 'south' | 'north']));
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
    const base = this.structureByHandle(BASES[enemy]);
    if (base) this.world.attackMove(ship, [{ x: base.x, y: base.y }]);
  }

  private apply(c: MatchCommand): void {
    const p = this.players.get(c.player);
    if (!p) return;
    const ship = this.world.ships.get(p.shipId ?? -1);
    if (!ship) return this.deny(c.player, '船只阵亡中，复活后才能交易');
    const shops = this.shopsInReach(c.player);
    if (c.kind === 'buyShip') {
      const shop = shops.find((s) => s.sellsUnits.includes(c.typeId));
      if (!shop) return this.deny(c.player, '附近没有出售这艘船的商店');
      if (!this.world.shipType(c.typeId)) return this.hireFleetShip(p, c.typeId, shop);
      const price = this.units.get(c.typeId)?.goldCost ?? Infinity;
      const refund = Math.floor((this.units.get(p.shipTypeId)?.goldCost ?? 0) * RESALE);
      if (p.gold + refund < price) return this.deny(c.player, '金钱不足');
      p.gold += refund - price;
      p.shipTypeId = c.typeId;
      const at = { x: ship.x, y: ship.y };
      this.world.remove(ship.id);
      this.spawnPlayerShip(p.index, at);
    } else if (c.kind === 'buyItem') {
      if (!shops.some((s) => s.sellsItems.includes(c.itemId))) return this.deny(c.player, '附近没有出售这件物品的商店');
      const price = this.items.get(c.itemId)?.goldCost ?? Infinity;
      if (p.items.length >= 6) return this.deny(c.player, '物品栏已满');
      if (p.gold < price) return this.deny(c.player, '金钱不足');
      p.gold -= price;
      p.items.push(c.itemId);
      this.world.setItems(ship, p.items);
    } else if (c.kind === 'sellItem') {
      const itemId = p.items[c.slot];
      if (!itemId) return;
      if (shops.length === 0) return this.deny(c.player, '要在商店附近才能出售');
      p.items.splice(c.slot, 1);
      p.gold += Math.floor((this.items.get(itemId)?.goldCost ?? 0) * RESALE);
      this.world.setItems(ship, p.items);
    }
  }
}
