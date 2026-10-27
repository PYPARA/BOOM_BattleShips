// Computer player. It plays through the same commands as a human (match.issue / world.issue),
// so it cannot cheat beyond reading unit positions (the game has no fog of war yet).
// Behavior follows the map's own AI (docs/mechanics/README.md §9): buy ships and weapons at
// home, push a lane behind the friendly fleet, keep out of tower fire, retreat to repair when
// hurt, and use skills when enough enemies are in reach.
import {
  canLearn, distance, LANES, REPAIR_RECTS, skillPoints, type Match, type UnitEntity, type Vec2,
} from '@boom/sim';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Personality = 'brawler' | 'support' | 'fast';

/** Ship upgrade routes, all through ships whose skills are implemented. */
const ROUTES: Record<Personality, string[]> = {
  brawler: ['H000', 'H001', 'H007', 'H008'],
  support: ['H000', 'H004', 'H006', 'H00V'],
  fast: ['H000', 'H003', 'H006', 'H008'],
};

/**
 * Retreating early is the costly mistake: the trip home takes the ship out of the fight for
 * a minute (self-play showed bots retreating at 45% losing to ones staying in), so better
 * bots hold out longer and lean on repair kits.
 */
const SETTINGS: Record<Difficulty, { thinkEvery: number; retreatAt: number; castChance: number; weaponSlots: number }> = {
  easy: { thinkEvery: 20, retreatAt: 0.5, castChance: 0.4, weaponSlots: 3 },
  normal: { thinkEvery: 10, retreatAt: 0.35, castChance: 0.8, weaponSlots: 4 },
  hard: { thinkEvery: 5, retreatAt: 0.3, castChance: 1, weaponSlots: 4 },
};

/** Hull plating and sails, cheapest first; repair kits are consumables. */
const HULLS = ['I009', 'I016', 'I00A'];
const SAILS = ['I007', 'I008', 'I01A'];
const REPAIR_KIT = 'I00C';

export class Bot {
  readonly player: number;
  private readonly match: Match;
  private readonly settings: (typeof SETTINGS)[Difficulty];
  private readonly route: string[];
  private readonly lane: number;
  private readonly random: () => number;
  private retreating = false;
  private lastGoal?: Vec2;
  private lastGoalTick = -Infinity;

  constructor(match: Match, player: number, options: { difficulty?: Difficulty; personality?: Personality; lane?: number } = {}) {
    this.match = match;
    this.player = player;
    this.settings = SETTINGS[options.difficulty ?? 'normal'];
    this.route = ROUTES[options.personality ?? (['brawler', 'support', 'fast'] as const)[player % 3]!];
    // Two players per lane on each side, the fifth joins lane 1.
    this.lane = options.lane ?? ((player - 2) % 5 >= 2 && (player - 2) % 5 < 4 ? 1 : 0);
    this.random = match.world.random;
  }

  private get state() {
    return this.match.players.get(this.player)!;
  }

  private get ship(): UnitEntity | undefined {
    return this.match.world.ships.get(this.state.shipId ?? -1);
  }

  private get side(): 'south' | 'north' {
    return this.state.team as 'south' | 'north';
  }

  /** Call every tick; the bot thinks every few ticks depending on difficulty. */
  update(): void {
    if ((this.match.world.tick + this.player) % this.settings.thinkEvery !== 0 || this.match.winner) return;
    const ship = this.ship;
    if (!ship || ship.frozen) return;
    this.learn();
    if (this.match.shopsInReach(this.player).length > 0) this.shop(ship);
    this.useItems(ship);
    this.castSkills(ship);
    this.steer(ship);
  }

  // Shopping ------------------------------------------------------------------------------

  private shop(ship: UnitEntity): void {
    const p = this.state;
    const shops = this.match.shopsInReach(this.player);
    const sells = (id: string, kind: 'ship' | 'item') => shops.some((s) => (kind === 'ship' ? s.sellsUnits : s.sellsItems).includes(id));
    const refund = Math.floor(this.match.unitPrice(ship.typeId) * 0.6);

    // Next ship on the route first, once weapons are in place.
    const next = this.route[this.route.indexOf(ship.typeId) + 1];
    const weapons = p.items.filter((i) => this.match.world.weaponType(i));
    if (next && sells(next, 'ship') && weapons.length >= 2 && p.gold + refund >= this.match.unitPrice(next)) {
      this.match.issue({ kind: 'buyShip', player: this.player, typeId: next });
      return;
    }
    const saving = next ? Math.max(0, this.match.unitPrice(next) - refund) : 0;
    const spare = (price: number) => (weapons.length < 2 ? p.gold >= price : p.gold - price >= saving * 0.5);

    // Weapons: the best affordable one that can hit ships, up to the slot budget.
    const best = this.bestWeapon(shops.flatMap((s) => s.sellsItems), p.gold);
    if (best && weapons.length < this.settings.weaponSlots && p.items.length < 6 && spare(this.match.itemPrice(best))) {
      this.match.issue({ kind: 'buyItem', player: this.player, itemId: best });
      return;
    }
    // Replace the weakest weapon when something three times its price is affordable.
    if (best && weapons.length >= this.settings.weaponSlots) {
      const weakest = weapons.reduce((a, b) => (this.match.itemPrice(a) <= this.match.itemPrice(b) ? a : b));
      if (this.match.itemPrice(best) >= this.match.itemPrice(weakest) * 3 && spare(this.match.itemPrice(best) - this.match.itemPrice(weakest) * 0.6)) {
        this.match.issue({ kind: 'sellItem', player: this.player, slot: p.items.indexOf(weakest) });
        this.match.issue({ kind: 'buyItem', player: this.player, itemId: best });
        return;
      }
    }
    // Hull, sail, then a repair kit in whatever slots remain.
    const upgrade = (line: string[]) => {
      const owned = p.items.findIndex((i) => line.includes(i));
      const tier = owned >= 0 ? line.indexOf(p.items[owned]!) : -1;
      const want = [...line].reverse().find((id, i) => line.length - 1 - i > tier && sells(id, 'item') && spare(this.match.itemPrice(id)));
      if (!want) return false;
      if (owned >= 0) this.match.issue({ kind: 'sellItem', player: this.player, slot: owned });
      else if (p.items.length >= 6) return false;
      this.match.issue({ kind: 'buyItem', player: this.player, itemId: want });
      return true;
    };
    if (weapons.length >= 2 && (upgrade(HULLS) || upgrade(SAILS))) return;
    if (p.items.length < 6 && !p.items.includes(REPAIR_KIT) && sells(REPAIR_KIT, 'item') && spare(this.match.itemPrice(REPAIR_KIT))) {
      this.match.issue({ kind: 'buyItem', player: this.player, itemId: REPAIR_KIT });
    }
  }

  private bestWeapon(offered: string[], gold: number): string | undefined {
    let best: string | undefined;
    let bestPrice = -1;
    for (const id of offered) {
      const w = this.match.world.weaponType(id);
      if (!w || w.mode !== 'auto' || w.range < 600) continue;
      if (!w.targets.some((t) => ['ground', '船只', 'air'].includes(t))) continue;
      const price = this.match.itemPrice(id);
      if (price <= gold && price > bestPrice) { best = id; bestPrice = price; }
    }
    return best;
  }

  // Skills --------------------------------------------------------------------------------

  private learn(): void {
    const ship = this.ship;
    if (!ship || skillPoints(this.state.hero) <= 0) return;
    const abilities = this.match.world.abilities;
    const skills = abilities.skillsOf(ship.typeId);
    // Active skills first, then the hull and sail upgrades.
    const order = [...skills].sort((a, b) => Number(abilities.targeting(a.id) === 'passive') - Number(abilities.targeting(b.id) === 'passive'));
    const pick = order.find((a) => canLearn(this.state.hero, a));
    if (pick) this.match.issue({ kind: 'learn', player: this.player, abilityId: pick.id });
  }

  private enemiesWithin(at: Vec2, radius: number): UnitEntity[] {
    const out: UnitEntity[] = [];
    for (const u of this.match.world.allUnits()) if (u.team !== this.side && u.hp > 0 && distance(at, u) <= radius) out.push(u);
    return out;
  }

  private castSkills(ship: UnitEntity): void {
    if (this.random() > this.settings.castChance) return;
    const abilities = this.match.world.abilities;
    const hero = this.state.hero;
    for (const a of abilities.skillsOf(ship.typeId)) {
      const n = hero.learned[a.id] ?? 0;
      if (!n || abilities.castBlocker(ship, a.id)) continue;
      const level = a.levels[n - 1]!;
      const kind = abilities.targeting(a.id);
      const area = level.area || 600;
      const reach = (level.range || 0) + 200;
      const near = this.enemiesWithin(ship, area);
      const heroes = this.enemiesWithin(ship, reach).filter((u) => u.isHero && u.kind === 'ship');
      const cast = (target: { unitId?: number; point?: Vec2 } = {}) => this.match.issue({ kind: 'cast', player: this.player, abilityId: a.id, ...target });

      if (kind === 'instant') {
        // Self-centered blasts and buffs: worth it with a hero or a few ships in reach.
        if (a.baseCode === 'AOvd' || a.baseCode === 'Absk') {
          if (this.enemiesWithin(ship, 900).length >= 2 || this.retreating) { cast(); return; }
        } else if (a.baseCode === 'AHwe') {
          if (this.enemiesWithin(ship, 1000).length > 0) { cast(); return; }
        } else if (a.baseCode === 'ANcl') {
          if ([...this.match.world.allUnits()].some((u) => u.buffs.some((b) => b.kind === 'spied' && b.sourceOwner === this.player))) { cast(); return; }
        } else if (near.some((u) => u.isHero) || near.filter((u) => u.kind === 'ship').length >= 3) {
          cast(); return;
        }
      } else if (kind === 'unit') {
        // 同化 takes over ordinary ships only: grab the biggest one in reach.
        if (a.baseCode === 'ANch') {
          const prey = this.enemiesWithin(ship, reach).filter((u) => u.kind === 'ship' && !u.isHero).sort((x, y) => y.maxHp - x.maxHp)[0];
          if (prey) { cast({ unitId: prey.id }); return; }
          continue;
        }
        const target = heroes.sort((x, y) => x.hp - y.hp)[0]
          ?? (a.baseCode === 'Auco' ? undefined : this.enemiesWithin(ship, reach).filter((u) => u.kind === 'ship').sort((x, y) => y.maxHp - x.maxHp)[0]);
        // The suicide ram only pays off against a ship it can sink or a crowd.
        if (target && (a.baseCode !== 'Auco' || target.hp < Number(level.data.B ?? 0) || this.enemiesWithin(target, 400).length >= 4)) { cast({ unitId: target.id }); return; }
      } else if (kind === 'point') {
        const crowd = this.enemiesWithin(ship, reach).filter((u) => u.kind === 'ship');
        if (crowd.length >= 3 || crowd.some((u) => u.isHero)) {
          const c = crowd.reduce((acc, u) => ({ x: acc.x + u.x / crowd.length, y: acc.y + u.y / crowd.length }), { x: 0, y: 0 });
          cast({ point: c }); return;
        }
      } else if (kind === 'ally') {
        if (ship.hp < ship.maxHp * 0.6) { cast({ unitId: ship.id }); return; }
      }
    }
  }

  private useItems(ship: UnitEntity): void {
    const p = this.state;
    const hurt = ship.hp / ship.maxHp;
    p.items.forEach((itemId, slot) => {
      const abilityId = this.match.activeItemAbility(itemId);
      if (!abilityId || this.match.world.abilities.castBlocker(ship, abilityId, slot)) return;
      const base = this.match.world.abilities.byId.get(abilityId)?.baseCode;
      if (base === 'AIhe' && hurt < 0.35) this.match.issue({ kind: 'useItem', player: this.player, slot });
      // Teleport out of a losing fight, toward home.
      if (base === 'AEbl' && hurt < 0.3 && this.enemiesWithin(ship, 900).length > 0) {
        this.match.issue({ kind: 'useItem', player: this.player, slot, point: this.home() });
      }
    });
  }

  // Movement ------------------------------------------------------------------------------

  private home(): Vec2 {
    return this.match.rectCenter(REPAIR_RECTS[this.side].station);
  }

  private steer(ship: UnitEntity): void {
    const hurt = ship.hp / ship.maxHp;
    if (hurt < this.settings.retreatAt) this.retreating = true;
    if (hurt > 0.95) this.retreating = false;
    if (this.retreating) return this.goTo(ship, this.home());
    // Head home to spend money once the next purchase is affordable. Go all the way in: at the
    // edge of shop range only the shipyards may be in reach, and they sell nothing for us.
    if (this.wantsToShop(ship) && distance(ship, this.home()) > 900) return this.goTo(ship, this.home());

    // Chase a weaker enemy ship in reach.
    const prey = this.enemiesWithin(ship, 1000).filter((u) => u.isHero && u.hp / u.maxHp < hurt && u.hp < ship.hp);
    if (prey[0]) return this.goTo(ship, prey[0]);
    this.goTo(ship, this.lanePosition(ship));
  }

  /** Whether the next planned purchase (weapons, then the next ship, then more weapons) is affordable. */
  private wantsToShop(ship: UnitEntity): boolean {
    const p = this.state;
    const weapons = p.items.filter((i) => this.match.world.weaponType(i)).length;
    const next = this.route[this.route.indexOf(ship.typeId) + 1];
    const refund = Math.floor(this.match.unitPrice(ship.typeId) * 0.6);
    if (weapons < 2) return p.gold >= 430; // 护卫舰炮, the staple starter cannon
    if (next) return p.gold + refund >= this.match.unitPrice(next);
    return weapons < this.settings.weaponSlots && p.gold >= 1500;
  }

  /** A point on the lane just behind the friendly fleet's front, kept out of tower fire. */
  private lanePosition(ship: UnitEntity): Vec2 {
    const lane = LANES[this.lane]!;
    const enemy = this.side === 'south' ? 'north' : 'south';
    const from = this.match.rectCenter(lane[this.side].harbour), to = this.match.rectCenter(lane[enemy].harbour);
    const along = (p: Vec2) => {
      const dx = to.x - from.x, dy = to.y - from.y, len2 = dx * dx + dy * dy;
      const t = ((p.x - from.x) * dx + (p.y - from.y) * dy) / len2;
      const px = from.x + dx * t, py = from.y + dy * t;
      return { t, off: Math.hypot(p.x - px, p.y - py) };
    };
    let front = 0.2;
    for (const u of this.match.world.ships.values()) {
      if (u.team !== this.side || u.isHero) continue;
      const { t, off } = along(u);
      if (off < 900 && t > front) front = t;
    }
    let t = Math.min(0.95, Math.max(0.15, front - 0.03));
    const at = (k: number) => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
    // Back off from enemy structures unless friendly ships are soaking their fire.
    for (let guard = 0; guard < 20; guard++) {
      const p = at(t);
      const tower = [...this.match.world.structures.values()].find((s) => s.team === enemy && s.attacks.length > 0
        && distance(s, p) < Math.max(...s.attacks.map((a) => a.range)) + 150);
      if (!tower) break;
      const near = [...this.match.world.ships.values()].filter((u) => u.team === this.side && distance(u, tower) < 1300);
      const cover = near.filter((u) => !u.isHero).length;
      // Push in behind the fleet, or as a group of healthy ships.
      const group = near.filter((u) => u.isHero && u.hp / u.maxHp > 0.6).length;
      if (cover >= 3 || (group >= 2 && ship.hp / ship.maxHp > 0.6) || ship.hp > tower.hp * 2) break;
      t -= 0.02;
    }
    return at(t);
  }

  private goTo(ship: UnitEntity, goal: Vec2): void {
    const tick = this.match.world.tick;
    if (this.lastGoal && distance(this.lastGoal, goal) < 150 && (ship.path.length > 0 || distance(ship, goal) < 200) && tick - this.lastGoalTick < 100) return;
    this.lastGoal = { x: goal.x, y: goal.y };
    this.lastGoalTick = tick;
    this.match.world.issue({ kind: 'move', unitIds: [ship.id], x: goal.x, y: goal.y });
  }
}
