// What the codex knows about each ship, weapon and item beyond its own stats: which shops sell it
// and where they stand, what it is rebuilt from or into (weapon blueprints), what it is combined
// from or into (合成图), the hull blueprints and bought skills a ship can take, and the
// carry-one-of rules. Built once from the match's shops and the map's trigger-made goods (goods.ts).
import type { Item, Unit } from '@boom/gamedata';
import type { Match, Team, Vec2 } from '@boom/sim';
import { clean } from './info.ts';

export interface Source {
  shopId: string;
  shop: string;
  where: string;
  /** Whether the player may buy there: an own-side or neutral shop. */
  usable: boolean;
}
export interface Edge { id: string; via: string }
export interface Recipe { needs: string[]; via: string }

/** Shops the triggers bring in for a while instead of standing on the map. */
const TIMED_SHOPS: Record<string, string> = { h01T: '击败 Boss 后限时出现（65 秒）' };

export class Catalog {
  readonly sources = new Map<string, Source[]>();
  /** Weapon blueprints: what each weapon is rebuilt from, and into. */
  readonly upgradeFrom = new Map<string, Edge[]>();
  readonly upgradeTo = new Map<string, Edge[]>();
  /** 合成图: the recipes that make an item, and what each item goes into. */
  readonly recipes = new Map<string, Recipe[]>();
  readonly usedIn = new Map<string, Edge[]>();
  /** Hull blueprints by ship: the blueprint and the max hull it adds. */
  readonly hulls = new Map<string, { via: string; hp: number }[]>();
  /** 船只特殊能力 items: the skill and the ships that may take it (undefined: every ship). */
  readonly shipSkills: { via: string; abilityId: string; ships?: string[] }[] = [];
  private readonly match: Match;
  private readonly units: Map<string, Unit>;
  private readonly items: Map<string, Item>;

  constructor(match: Match, player: number, units: Map<string, Unit>, items: Map<string, Item>, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    this.match = match;
    this.units = units;
    this.items = items;
    const team = match.players.get(player)!.team;
    const push = <T>(map: Map<string, T[]>, key: string, value: T) => { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); };

    for (const shop of match.shops) {
      const where = this.where(shop.unitId, shop.owner, shop, team, bounds);
      const usable = !(shop.owner === 0 || shop.owner === 1) || this.teamOf(shop.owner) === team;
      const source: Source = { shopId: shop.unitId, shop: clean(units.get(shop.unitId)?.name ?? shop.unitId), where, usable };
      for (const id of [...shop.sellsUnits, ...shop.sellsItems]) {
        const list = this.sources.get(id) ?? [];
        // Each side has its own copy of the base shops: name a shop once, the usable copy first.
        const same = list.findIndex((s) => s.shopId === source.shopId);
        if (same < 0) list.push(source);
        else if (!list[same]!.usable && usable) list[same] = source;
        this.sources.set(id, list);
      }
    }
    for (const list of this.sources.values()) list.sort((a, b) => Number(b.usable) - Number(a.usable));

    for (const [via, p] of match.world.goods.purchases) {
      if (p.kind === 'upgrade') for (const [from, to] of p.pairs) { push(this.upgradeFrom, to, { id: from, via }); push(this.upgradeTo, from, { id: to, via }); }
      if (p.kind === 'combine') { push(this.recipes, p.to, { needs: p.needs, via }); for (const n of p.needs) push(this.usedIn, n, { id: p.to, via }); }
      if (p.kind === 'hull') for (const [ship, hp] of Object.entries(p.bonus)) push(this.hulls, ship, { via, hp });
      if (p.kind === 'shipSkill') this.shipSkills.push({ via, abilityId: p.abilityId, ships: p.ships });
    }
  }

  private teamOf(owner: number): Team {
    return owner === 0 ? 'south' : 'north';
  }

  /** "我方母港", "敌方母港", or a neutral shop's corner of the map. */
  private where(shopId: string, owner: number, at: Vec2, team: Team, b: { minX: number; minY: number; maxX: number; maxY: number }): string {
    if (TIMED_SHOPS[shopId]) return TIMED_SHOPS[shopId]!;
    if (owner === 0 || owner === 1) return this.teamOf(owner) === team ? '我方母港' : '敌方母港（不能购买）';
    const fx = (at.x - b.minX) / (b.maxX - b.minX), fy = (at.y - b.minY) / (b.maxY - b.minY);
    const ns = fy > 0.62 ? '北' : fy < 0.38 ? '南' : '', ew = fx > 0.62 ? '东' : fx < 0.38 ? '西' : '';
    return `野外 · 地图${ns || ew ? `${ew && ns ? `${ew}${ns}` : ew || ns}部` : '中部'}`;
  }

  /** Things no shop sells but a blueprint or plan makes, for the codex's lists. */
  madeOnly(): string[] {
    return [...new Set([...this.upgradeFrom.keys(), ...this.recipes.keys()])].filter((id) => !this.sources.has(id));
  }

  /** Things a blueprint or plan needs that no shop sells and nothing makes (quest rewards and the like). */
  unsold(): string[] {
    const needed = [...this.upgradeTo.keys(), ...[...this.recipes.values()].flat().flatMap((r) => r.needs)];
    return [...new Set(needed)].filter((id) => !this.sources.has(id) && !this.upgradeFrom.has(id) && !this.recipes.has(id));
  }

  /**
   * Every blueprint chain through `id`, from its first weapon to each last one; each step carries
   * the blueprint that made it (none for the first).
   */
  chains(id: string): Edge[][] {
    const before = this.backPath(id);
    const forward = (at: string, path: Edge[], seen: Set<string>): Edge[][] => {
      const next = (this.upgradeTo.get(at) ?? []).filter((e) => !seen.has(e.id));
      if (!next.length) return [path];
      return next.flatMap((e) => forward(e.id, [...path, e], new Set([...seen, e.id])));
    };
    return forward(id, [...before, { id, via: before.length ? this.upgradeFrom.get(id)![0]!.via : '' }], new Set(before.map((e) => e.id).concat(id)));
  }

  /** The steps before `id`: the first weapon (no blueprint), then each with the blueprint that made it. */
  private backPath(id: string): Edge[] {
    const path: Edge[] = [];
    const seen = new Set([id]);
    let at = id;
    for (;;) {
      const prev = this.upgradeFrom.get(at)?.[0];
      if (!prev || seen.has(prev.id)) break;
      seen.add(prev.id);
      path.unshift({ id: prev.id, via: this.upgradeFrom.get(prev.id)?.[0]?.via ?? '' });
      at = prev.id;
    }
    return path;
  }

  /** The bought ship skills a ship may take. */
  skillsFor(shipId: string): { via: string; abilityId: string }[] {
    return this.shipSkills.filter((s) => !s.ships || s.ships.includes(shipId));
  }

  name(id: string): string {
    return clean(this.match.world.shipType(id)?.name ?? this.items.get(id)?.name ?? this.units.get(id)?.name ?? id);
  }

  kind(id: string): 'ship' | 'weapon' | 'item' {
    return this.match.world.shipType(id) ? 'ship' : this.match.world.weaponType(id) ? 'weapon' : 'item';
  }

  price(id: string): number {
    return this.kind(id) === 'ship' ? this.units.get(id)?.goldCost ?? 0 : this.items.get(id)?.goldCost ?? 0;
  }
}
