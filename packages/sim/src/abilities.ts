// Ship skills and item abilities. Each Warcraft base ability the map copies (AHtb Storm Bolt,
// AOws War Stomp, …) gets one behavior; the numbers come from the ability's level data.
// See docs/mechanics/ship-skills.md for the per-ship list.
import type { Ability, AbilityLevel, Item } from '@boom/gamedata';
import { addBuff, hasBuff, type BuffKind } from './buffs.ts';
import { canLearn, newHero } from './heroes.ts';
import { distance, type Vec2 } from './math.ts';
import { TICK_DT, TICK_RATE, type UnitEntity, type World } from './world.ts';

export type Targeting = 'unit' | 'ally' | 'point' | 'instant' | 'passive';

/** How each base ability is aimed. Anything unlisted is treated as passive. */
const TARGETING: Record<string, Targeting> = {
  AHtb: 'unit', Auco: 'unit', Aens: 'unit', Amls: 'unit', Ashs: 'unit', Arej: 'ally',
  ANrf: 'point', ANsi: 'point', AEbl: 'point',
  Absk: 'instant', AHwe: 'instant', AHtc: 'instant', AOws: 'instant', AOvd: 'instant', AEsf: 'instant', ANcl: 'instant', AIhe: 'instant',
};

/** Hero stat constants from the map's Misc section (StrHitPointBonus, StrRegenBonus). */
interface HeroConstants { hpPerStr: number; regenPerStr: number }

interface Scheduled { at: number; run: () => void }

/** A mine (水雷) waiting for an enemy to come close (Asds Kaboom! data). */
interface Mine { unitId: number; trigger: number; fullRadius: number; full: number; partialRadius: number; partial: number }

export class AbilitySystem {
  readonly byId: Map<string, Ability>;
  private readonly items: Map<string, Item>;
  private readonly world: World;
  private readonly hero: HeroConstants;
  private scheduled: Scheduled[] = [];
  private readonly mines = new Map<number, Mine>();

  constructor(world: World, abilities: Ability[], items: Item[], misc: Record<string, unknown>) {
    this.world = world;
    this.byId = new Map(abilities.map((a) => [a.id, a]));
    this.items = new Map(items.map((i) => [i.id, i]));
    this.hero = { hpPerStr: Number(misc.strhitpointbonus ?? 25), regenPerStr: Number(misc.strregenbonus ?? 0.05) };
  }

  targeting(abilityId: string): Targeting {
    return TARGETING[this.byId.get(abilityId)?.baseCode ?? ''] ?? 'passive';
  }

  /** Skills a ship type can learn, in learn-menu order. */
  skillsOf(typeId: string): Ability[] {
    return (this.world.shipType(typeId)?.skills ?? []).map((id) => this.byId.get(id)).filter((a): a is Ability => !!a);
  }

  private level(u: UnitEntity, abilityId: string): AbilityLevel | undefined {
    const n = u.hero?.learned[abilityId] ?? 0;
    return n > 0 ? this.byId.get(abilityId)?.levels[n - 1] : undefined;
  }

  // Stats -----------------------------------------------------------------------------------

  /** Recomputes live stats from base values, learned passives and carried items. */
  refreshStats(u: UnitEntity): void {
    let maxHp = u.base.maxHp, regen = u.base.regen, speedPct = 0, speedFlat = 0, taken = 1;
    const passive = (a: Ability, level: AbilityLevel) => {
      const d = level.data;
      switch (a.baseCode) {
        case 'Aamk': { // 改良船体: strength → hit points and regeneration
          const str = Number(d.C ?? 0);
          maxHp += str * this.hero.hpPerStr;
          regen += str * this.hero.regenPerStr;
          break;
        }
        case 'AOae': speedPct += Number(d.A ?? 0); break; // 船帆 (negative on heavy hulls)
        case 'AIml': maxHp += Number(d.A ?? 0); break;
        case 'Arel': regen += Number(d.A ?? 0); break;
        case 'AIms': speedFlat += Number(d.A ?? 0); break;
        case 'AIdd': taken = Math.min(taken, Number(d.E ?? 1)); break; // 船甲减伤
      }
    };
    for (const [id, n] of Object.entries(u.hero?.learned ?? {})) {
      const a = this.byId.get(id);
      if (a && n > 0) passive(a, a.levels[n - 1]!);
    }
    for (const itemId of u.items) {
      for (const abilityId of this.items.get(itemId)?.abilities ?? []) {
        const a = this.byId.get(abilityId);
        if (a?.levels[0]) passive(a, a.levels[0]);
      }
    }
    const gained = maxHp - u.maxHp;
    u.maxHp = maxHp;
    u.hp = Math.min(maxHp, u.hp + Math.max(0, gained)); // added max HP comes with matching HP
    u.regen = regen;
    u.maxSpeed = Math.max(0, (u.base.speed + speedFlat) * (1 + speedPct));
    u.armor = u.base.armor;
    u.damageTaken = taken;
  }

  // Learning and casting --------------------------------------------------------------------

  learn(u: UnitEntity, abilityId: string): boolean {
    u.hero ??= newHero();
    const a = this.byId.get(abilityId);
    if (!a || !this.skillsOf(u.typeId).includes(a) || !canLearn(u.hero, a)) return false;
    u.hero.learned[abilityId] = (u.hero.learned[abilityId] ?? 0) + 1;
    this.refreshStats(u);
    return true;
  }

  /** Cooldown key: the ability, or for items their cooldown group (Warcraft shares it per item kind). */
  private cooldownKey(u: UnitEntity, abilityId: string, itemSlot?: number): string {
    if (itemSlot === undefined) return abilityId;
    const item = this.items.get(u.items[itemSlot] ?? '');
    return `item:${item?.cooldownGroup ?? item?.id ?? itemSlot}`;
  }

  /** Why a cast cannot start now, or undefined if it can. */
  castBlocker(u: UnitEntity, abilityId: string, itemSlot?: number): string | undefined {
    if (hasBuff(u, 'stun') || u.frozen) return '船只失控中';
    const key = this.cooldownKey(u, abilityId, itemSlot);
    if (this.world.tick < (u.hero?.readyAt[key] ?? 0)) return '冷却中';
    if (itemSlot === undefined) {
      if (!this.level(u, abilityId)) return '尚未学会这个技能';
      if (hasBuff(u, 'silence')) return '被干扰，无法使用技能';
    }
    if (this.targeting(abilityId) === 'passive') return '被动技能';
    return undefined;
  }

  /**
   * Starts a cast (a ship skill, or an item's ability when `itemSlot` is set). Out-of-range
   * targets make the caster sail closer first. Returns a reason when the cast is refused.
   */
  cast(u: UnitEntity, abilityId: string, target: { unitId?: number; point?: Vec2 }, itemSlot?: number): string | undefined {
    const blocker = this.castBlocker(u, abilityId, itemSlot);
    if (blocker) return blocker;
    const kind = this.targeting(abilityId);
    const targetUnit = this.world.unit(target.unitId);
    if (kind === 'unit' && (!targetUnit || targetUnit.team === u.team)) return '需要选择一个敌方目标';
    if (kind === 'ally' && (!targetUnit || targetUnit.team !== u.team)) return '需要选择一个友方目标';
    if (kind === 'point' && !target.point) return '需要选择一个地点';
    u.pendingCast = { abilityId, targetId: target.unitId, point: target.point, itemSlot };
    u.path = [];
    return undefined;
  }

  private castRange(u: UnitEntity, cast: NonNullable<UnitEntity['pendingCast']>): number {
    const a = this.byId.get(cast.abilityId)!;
    const level = cast.itemSlot !== undefined ? a.levels[0] : this.level(u, cast.abilityId);
    if (a.baseCode === 'AEbl') return Infinity; // blink goes as far as it can, capped by DataA
    return Math.max(level?.range ?? 0, 150);
  }

  /** Every tick: pending casts, scheduled waves, auras, damage/heal over time, mines, expiry. */
  tick(): void {
    const now = this.world.tick;
    const due = this.scheduled.filter((s) => s.at <= now);
    this.scheduled = this.scheduled.filter((s) => s.at > now);
    for (const s of due) s.run();

    for (const u of [...this.world.allUnits()]) {
      // Damage over time.
      for (const b of u.buffs) {
        if (b.kind === 'dot' && b.until > now) this.world.dealDamage(u, b.value * TICK_DT, 'ability', b.sourceOwner, b.sourceId);
      }
      if (u.expiresAt !== undefined && now >= u.expiresAt) { this.world.remove(u.id); this.mines.delete(u.id); continue; }
      this.runAuras(u);
      const cast = u.pendingCast;
      if (!cast) continue;
      if (this.castBlocker(u, cast.abilityId, cast.itemSlot)) { u.pendingCast = undefined; continue; }
      const target = this.world.unit(cast.targetId);
      if (cast.targetId !== undefined && !target) { u.pendingCast = undefined; continue; }
      const aim = target ?? cast.point;
      const range = this.castRange(u, cast);
      if (aim && range !== Infinity && distance(u, aim) - (target ? target.bodyRadius * 0.6 : 0) > range) {
        if (u.path.length === 0 || now % 10 === u.id % 10) u.path = this.world.grid.findPath(u, aim, u.pathRadius) ?? [];
        continue;
      }
      u.pendingCast = undefined;
      u.path = [];
      this.execute(u, cast.abilityId, target, cast.point, cast.itemSlot);
    }

    for (const [id, mine] of this.mines) {
      const unit = this.world.unit(id);
      if (!unit) { this.mines.delete(id); continue; }
      if (this.enemiesNear(unit, unit, mine.trigger).length === 0) continue;
      this.mines.delete(id);
      for (const e of this.enemiesNear(unit, unit, mine.partialRadius)) {
        this.world.dealDamage(e, distance(unit, e) <= mine.fullRadius ? mine.full : mine.partial, 'ability', unit.owner, unit.id);
      }
      this.world.remove(id);
    }
  }

  private runAuras(u: UnitEntity): void {
    const drums = Object.keys(u.hero?.learned ?? {}).map((id) => this.byId.get(id)).find((a) => a?.baseCode === 'Aakb');
    if (!drums) return;
    const level = this.level(u, drums.id)!;
    for (const ally of this.alliesNear(u, u, level.area ?? 1000)) {
      addBuff(ally, { kind: 'damageBonus', until: this.world.tick + 2, value: Number(level.data.A ?? 0), sourceId: u.id, sourceOwner: u.owner, abilityId: drums.id });
    }
  }

  private enemiesNear(of: UnitEntity, at: Vec2, radius: number): UnitEntity[] {
    const out: UnitEntity[] = [];
    for (const v of this.world.allUnits()) if (v.team !== of.team && v.hp > 0 && distance(at, v) <= radius + v.bodyRadius * 0.5) out.push(v);
    return out;
  }

  private alliesNear(of: UnitEntity, at: Vec2, radius: number): UnitEntity[] {
    const out: UnitEntity[] = [];
    for (const v of this.world.allUnits()) if (v.team === of.team && v.hp > 0 && distance(at, v) <= radius) out.push(v);
    return out;
  }

  private buff(target: UnitEntity, kind: BuffKind, seconds: number, value: number, source: UnitEntity, abilityId: string): void {
    if (seconds <= 0) return;
    addBuff(target, { kind, until: this.world.tick + Math.round(seconds * TICK_RATE), value, sourceId: source.id, sourceOwner: source.owner, abilityId });
  }

  /** Control duration: Warcraft uses the separate hero duration on heroes (player ships). */
  private duration(level: AbilityLevel, target: UnitEntity): number {
    return (target.isHero ? level.heroDuration : level.duration) ?? level.duration ?? 0;
  }

  private schedule(afterSeconds: number, run: () => void): void {
    this.scheduled.push({ at: this.world.tick + Math.max(1, Math.round(afterSeconds * TICK_RATE)), run });
  }

  /** Number following `label` in a level tooltip, for values the map keeps only in text (燃料炸弹). */
  private tipNumber(level: AbilityLevel | undefined, label: string): number {
    const m = level ? new RegExp(`${label}[：:]\\s*(\\d+(?:\\.\\d+)?)`).exec(level.description) : null;
    return m ? Number(m[1]) : 0;
  }

  private execute(u: UnitEntity, abilityId: string, target: UnitEntity | undefined, point: Vec2 | undefined, itemSlot?: number): void {
    const a = this.byId.get(abilityId)!;
    const level = itemSlot !== undefined ? a.levels[0]! : this.level(u, abilityId)!;
    const d = level.data;
    const num = (k: keyof AbilityLevel['data']) => Number(d[k] ?? 0);
    u.hero ??= newHero();
    u.hero.readyAt[this.cooldownKey(u, abilityId, itemSlot)] = this.world.tick + Math.round((level.cooldown ?? 0) * TICK_RATE);
    this.world.events.push({ kind: 'cast', casterId: u.id, abilityId, x: (target ?? point ?? u).x, y: (target ?? point ?? u).y });

    switch (a.baseCode) {
      case 'AHtb': // 船长火炮 / 克虏伯主炮: damage and stun
        this.world.dealDamage(target!, num('A'), 'ability', u.owner, u.id);
        this.buff(target!, 'stun', this.duration(level, target!), 0, u, abilityId);
        break;
      case 'Auco': { // 自杀撞击: the ship blows itself up on the target
        for (const e of this.enemiesNear(u, target!, num('C'))) {
          this.world.dealDamage(e, e === target || distance(e, target!) < 200 ? num('B') : num('D'), 'ability', u.owner, u.id);
        }
        this.world.dealDamage(u, u.hp + 1, 'pure', u.owner, u.id);
        break;
      }
      case 'Aens': // 渔网: root
        this.buff(target!, 'root', this.duration(level, target!), 0, u, abilityId);
        break;
      case 'Amls': // 登船作战: target cannot act and burns
        this.buff(target!, 'stun', this.duration(level, target!), 0, u, abilityId);
        this.buff(target!, 'dot', this.duration(level, target!), num('A'), u, abilityId);
        break;
      case 'Arej': { // 紧急修理: heal over time, halved on structures
        const total = num('A') * (target!.kind === 'structure' ? 0.5 : 1);
        const seconds = level.duration || 1;
        this.buff(target!, 'hot', seconds, total / seconds, u, abilityId);
        break;
      }
      case 'Absk': { // 燃料加速 (+ 燃料炸弹 when learned)
        this.buff(u, 'haste', level.duration ?? 0, num('A'), u, abilityId);
        const bomb = this.skillsOf(u.typeId).find((s) => s.baseCode === 'Agyv');
        const bombLevel = bomb && this.level(u, bomb.id);
        if (bombLevel) {
          const radius = this.tipNumber(bombLevel, '杀伤范围') || 600;
          for (const e of this.enemiesNear(u, u, radius)) {
            this.world.dealDamage(e, this.tipNumber(bombLevel, '杀伤力'), 'ability', u.owner, u.id);
            this.buff(e, 'stun', this.tipNumber(bombLevel, '目标失控') || 1, 0, u, bomb.id);
          }
          this.world.events.push({ kind: 'cast', casterId: u.id, abilityId: bomb.id, x: u.x, y: u.y });
        }
        break;
      }
      case 'AHtc': // 电磁脉冲: damage and slow around the ship
        for (const e of this.enemiesNear(u, u, level.area ?? 0)) {
          this.world.dealDamage(e, num('A'), 'ability', u.owner, u.id);
          this.buff(e, 'slow', this.duration(level, e), num('C'), u, abilityId);
        }
        break;
      case 'AOws': // 冻结: damage and stun around the ship
        for (const e of this.enemiesNear(u, u, level.area ?? 0)) {
          this.world.dealDamage(e, num('A'), 'ability', u.owner, u.id);
          this.buff(e, 'stun', this.duration(level, e), 0, u, abilityId);
        }
        break;
      case 'ANsi': // 干扰信号: silence an area
        for (const e of this.enemiesNear(u, point!, level.area ?? 0)) this.buff(e, 'silence', this.duration(level, e), 0, u, abilityId);
        break;
      case 'ANrf': { // 火焰雨: waves over an area, each leaving a burn
        const waves = num('C') || 10, every = num('D') || 0.5;
        for (let w = 0; w < waves; w++) {
          this.schedule(w * every, () => {
            for (const e of this.enemiesNear(u, point!, level.area ?? 0)) {
              this.world.dealDamage(e, num('B'), 'ability', u.owner, u.id);
              this.buff(e, 'dot', level.duration ?? 3, num('E'), u, abilityId);
            }
          });
        }
        break;
      }
      case 'AEsf': { // 神之惩罚: meteor waves around the ship; structures take a share
        const every = num('B') || 1.5;
        for (let t = 0; t < (level.duration ?? 0); t += every) {
          this.schedule(t, () => {
            if (!this.world.unit(u.id)) return;
            for (const e of this.enemiesNear(u, u, level.area ?? 0)) {
              this.world.dealDamage(e, num('A') * (e.kind === 'structure' ? num('C') || 1 : 1), 'ability', u.owner, u.id);
            }
          });
        }
        break;
      }
      case 'AOvd': // 舰队防御: nearby allies invulnerable, not the flagship itself
        for (const ally of this.alliesNear(u, u, level.area ?? 0)) {
          if (ally !== u) this.buff(ally, 'invulnerable', level.duration ?? 0, 0, u, abilityId);
        }
        break;
      case 'AHwe': { // 舰队支援 (summon warships) or 布放水雷 (lay a mine)
        const typeId = level.units[0];
        if (!typeId) break;
        const mineAbility = this.world.unitType(typeId)?.abilities.map((id) => this.byId.get(id)).find((m) => m?.baseCode === 'Asds');
        const count = mineAbility ? 1 : Math.max(1, num('A'));
        for (let i = 0; i < count; i++) {
          const spot = this.world.grid.nearestSailable(u.x - Math.cos(u.facing) * 120 + i * 60, u.y - Math.sin(u.facing) * 120, 16) ?? u;
          const summon = this.world.spawnShip(typeId, u.owner, spot.x, spot.y, u.facing);
          summon.expiresAt = this.world.tick + Math.round((level.duration ?? 30) * TICK_RATE);
          if (mineAbility) {
            const m = mineAbility.levels[0]!;
            summon.maxSpeed = 0;
            summon.attacks = [];
            this.mines.set(summon.id, {
              unitId: summon.id, trigger: m.area ?? 220,
              fullRadius: Number(m.data.A ?? 200), full: Number(m.data.B ?? 0), partialRadius: Number(m.data.C ?? 400), partial: Number(m.data.D ?? 0),
            });
          } else {
            this.world.attackMove(summon, [{ x: u.x, y: u.y }]);
          }
        }
        break;
      }
      case 'Ashs': // 派遣间谍: mark the target (vision is not simulated yet)
        this.buff(target!, 'spied', 600, 0, u, abilityId);
        break;
      case 'ANcl': { // 间谍破坏: every target spied by this player takes a share of max HP as pure damage
        const share = this.tipNumber(level, '杀伤力') / 100;
        for (const e of this.world.allUnits()) {
          if (!e.buffs.some((b) => b.kind === 'spied' && b.sourceOwner === u.owner)) continue;
          e.buffs = e.buffs.filter((b) => !(b.kind === 'spied' && b.sourceOwner === u.owner));
          this.world.dealDamage(e, e.maxHp * share, 'pure', u.owner, u.id);
        }
        break;
      }
      case 'AEbl': { // 传送器 / 闪: jump toward the point, at most DataA
        const max = num('A') || 1200;
        const dx = point!.x - u.x, dy = point!.y - u.y, len = Math.hypot(dx, dy) || 1;
        const reach = Math.min(max, len);
        const land = this.world.grid.nearestSailable(u.x + (dx / len) * reach, u.y + (dy / len) * reach, u.pathRadius);
        if (land) { u.x = u.prevX = land.x; u.y = u.prevY = land.y; u.path = []; }
        break;
      }
      case 'AIhe': // 修理木: instant repair
        u.hp = Math.min(u.maxHp, u.hp + num('A'));
        break;
    }

    // Single-use items are consumed.
    if (itemSlot !== undefined && this.items.get(u.items[itemSlot] ?? '')?.perishable) {
      u.items.splice(itemSlot, 1);
      this.world.setItems(u, u.items);
      this.world.events.push({ kind: 'itemUsed', unitId: u.id, slot: itemSlot });
    }
  }
}
