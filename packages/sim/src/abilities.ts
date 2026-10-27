// Ship skills and item abilities. Each Warcraft base ability the map copies (AHtb Storm Bolt,
// AOws War Stomp, …) gets one behavior; the numbers come from the ability's level data.
// See docs/mechanics/ship-skills.md for the per-ship list.
import type { Ability, AbilityLevel, Item } from '@boom/gamedata';
import { addBuff, hasBuff, type BuffKind } from './buffs.ts';
import { parseTargets } from './combat.ts';
import { SUBMARINES } from './goods.ts';
import { canLearn, newHero } from './heroes.ts';
import { distance, type Vec2 } from './math.ts';
import { teamOfPlayer, TICK_DT, TICK_RATE, type Projectile, type Team, type UnitEntity, type World } from './world.ts';

export type Targeting = 'unit' | 'ally' | 'point' | 'instant' | 'passive';

/** How each base ability is aimed. Anything unlisted is treated as passive. */
const TARGETING: Record<string, Targeting> = {
  AHtb: 'unit', Auco: 'unit', Aens: 'unit', Amls: 'unit', Ashs: 'unit', ANso: 'unit', ACbf: 'unit', Afae: 'unit', AEsh: 'unit',
  ANpa: 'unit', ANch: 'unit', AEer: 'unit', AOcl: 'unit', ANfl: 'unit', Aprg: 'unit', Aply: 'unit', AHdr: 'unit',
  Arej: 'ally', Aams: 'ally', AIil: 'ally',
  ANrf: 'point', ANsi: 'point', AEbl: 'point', AHbz: 'point', AOwd: 'point', AHfs: 'point', AOsf: 'point', ANvc: 'point',
  ANcs: 'point', Adis: 'point', ANhs: 'point', AOsh: 'point',
  Absk: 'instant', AHwe: 'instant', AHtc: 'instant', AOws: 'instant', AOvd: 'instant', AEsf: 'instant', ANcl: 'instant', AIhe: 'instant',
  AHds: 'instant', Aivs: 'instant', AIvi: 'instant', AOmi: 'instant', AEtq: 'instant', AEfk: 'instant', ANto: 'instant', AUls: 'instant',
  AIsa: 'instant',
  // Bought ship skills and item abilities.
  Acri: 'unit', ANab: 'unit', Asta: 'point', Afla: 'point', ANwm: 'point', AIbl: 'point',
};

/**
 * Skills that would need mana, which the remake does not simulate (the map's ships have none
 * to speak of): 能量护盾 (ANms) and 能量恢复 (Arpm) stay inert passives.
 */

/** Debuff kinds that 防护罩 and 能量外壳 wash off. */
const HOSTILE = new Set<BuffKind>(['stun', 'root', 'silence', 'slow', 'dot', 'armorDown', 'disarm', 'spied']);

// World imports this module, so its tick constants are only read inside functions.

/** Hero stat constants from the map's Misc section (StrHitPointBonus, StrRegenBonus). */
interface HeroConstants { hpPerStr: number; regenPerStr: number }

interface Scheduled { at: number; run: () => void }

/** A mine (水雷) waiting for an enemy to come close (Asds Kaboom! data). */
interface Mine { unitId: number; trigger: number; fullRadius: number; full: number; partialRadius: number; partial: number; stun?: number }

/** An area a team can see into for a while (照明弹). */
interface RevealZone { x: number; y: number; radius: number; team: Team; until: number }

/** A summon that hunts enemies near its master (小艇 swarms, 龙卷风, illusions), within `leash`. */
interface Follower { masterId: number; leash: number }

/** A recent wreck that 打捞 can salvage. */
interface Wreck { x: number; y: number; tick: number; level: number }

export class AbilitySystem {
  readonly byId: Map<string, Ability>;
  private readonly items: Map<string, Item>;
  private readonly world: World;
  private readonly hero: HeroConstants;
  private scheduled: Scheduled[] = [];
  private readonly mines = new Map<number, Mine>();
  private readonly followers = new Map<number, Follower>();
  private wrecks: Wreck[] = [];
  private zones: RevealZone[] = [];
  /** 镇魂曲 kill counters per ship. */
  private readonly requiem = new Map<number, number>();
  /** Built-in abilities per unit type (summons carry auras such as 建筑物破坏光环). */
  private readonly intrinsic = new Map<string, Ability[]>();

  constructor(world: World, abilities: Ability[], items: Item[], misc: Record<string, unknown>) {
    this.world = world;
    this.byId = new Map(abilities.map((a) => [a.id, a]));
    this.items = new Map(items.map((i) => [i.id, i]));
    this.hero = { hpPerStr: Number(misc.strhitpointbonus ?? 25), regenPerStr: Number(misc.strregenbonus ?? 0.05) };
  }

  targeting(abilityId: string): Targeting {
    if (abilityId.startsWith('@')) return 'instant'; // scripted item actions (对地导弹)
    return TARGETING[this.byId.get(abilityId)?.baseCode ?? ''] ?? 'passive';
  }

  /** Skills the ship has besides its learnable ones: bought ship skills and submarine gear. */
  grantedOf(u: UnitEntity): Ability[] {
    return Object.keys(u.hero?.granted ?? {}).map((id) => this.byId.get(id)).filter((a): a is Ability => !!a);
  }

  /** Skills a ship type can learn, in learn-menu order. */
  skillsOf(typeId: string): Ability[] {
    return (this.world.shipType(typeId)?.skills ?? []).map((id) => this.byId.get(id)).filter((a): a is Ability => !!a);
  }

  private level(u: UnitEntity, abilityId: string): AbilityLevel | undefined {
    const n = u.hero?.learned[abilityId] || u.hero?.granted[abilityId] || 0;
    return n > 0 ? this.byId.get(abilityId)?.levels[n - 1] : undefined;
  }

  // Stats -----------------------------------------------------------------------------------

  /** Recomputes live stats from base values, learned passives and carried items. */
  refreshStats(u: UnitEntity): void {
    let maxHp = u.base.maxHp + (u.hero?.hullBonus[u.typeId] ?? 0), regen = u.base.regen, speedPct = 0, speedFlat = 0, taken = 1, crit = 0, critMultiplier = 1;
    let detects = 0;
    // Submarine research (推进器, 声纳).
    if (SUBMARINES.has(u.typeId)) {
      for (const id of u.hero?.techs ?? []) {
        const p = this.world.goods.purchases.get(id);
        if (p?.kind === 'subTech') { speedFlat += p.tech.speed ?? 0; detects = Math.max(detects, p.tech.detect ?? 0); }
      }
    }
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
        case 'AOcr': crit = Number(d.A ?? 0) / 100; critMultiplier = Number(d.B ?? 1); break; // 致命一击
        case 'Adet': detects = Math.max(detects, level.range || 900); break; // 探测者, 观察员
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
    // NPC ships get their crit from levelling up (Match), player ships from 致命一击.
    if (u.hero) { u.critChance = crit; u.critMultiplier = critMultiplier; }
    if (u.hero || detects) u.detects = detects || undefined;
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
    const code = this.byId.get(abilityId)?.baseCode;
    if (targetUnit && kind === 'unit' && !this.world.visibleTo(u.team, targetUnit)) return '看不到这个目标';
    if (code === 'ANch' && (targetUnit!.isHero || targetUnit!.kind === 'structure')) return '只能控制普通船只';
    if (code === 'Aprg' && !targetUnit!.isHero) return '只能控制敌方玩家船只';
    u.pendingCast = { abilityId, targetId: target.unitId, point: target.point, itemSlot };
    u.path = [];
    return undefined;
  }

  private castRange(u: UnitEntity, cast: NonNullable<UnitEntity['pendingCast']>): number {
    const a = this.byId.get(cast.abilityId);
    if (!a) return Infinity;
    const level = cast.itemSlot !== undefined ? a.levels[0] : this.level(u, cast.abilityId);
    if (a.baseCode === 'AEbl') return Infinity; // blink goes as far as it can, capped by DataA
    if (a.baseCode === 'AHbz' && this.tipNumber(level, '最大距离')) return Infinity; // 风贝跳跃 jumps the same way
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
      if (u.expiresAt !== undefined && now >= u.expiresAt) { this.world.remove(u.id); this.mines.delete(u.id); this.followers.delete(u.id); continue; }
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

    if (now % 10 === 0) this.steerFollowers();
    if (now % 200 === 0) this.wrecks = this.wrecks.filter((w) => now - w.tick < 60 * TICK_RATE);
    if (this.zones.length) this.zones = this.zones.filter((z) => z.until > now);

    for (const [id, mine] of this.mines) {
      const unit = this.world.unit(id);
      if (!unit) { this.mines.delete(id); continue; }
      if (this.enemiesNear(unit, unit, mine.trigger).length === 0) continue;
      this.mines.delete(id);
      for (const e of this.enemiesNear(unit, unit, mine.partialRadius)) {
        if (mine.stun) this.buff(e, 'stun', mine.stun, 0, unit, 'Asta');
        else this.world.dealDamage(e, distance(unit, e) <= mine.fullRadius ? mine.full : mine.partial, 'ability', unit.owner, unit.id);
      }
      this.world.remove(id);
    }
  }

  /** Learned passives and the unit type's own abilities that act every tick or pulse. */
  private runAuras(u: UnitEntity): void {
    const now = this.world.tick;
    const pulse = (now + u.id) % TICK_RATE === 0; // once a second: plague, tentacles
    const run = (a: Ability, level: AbilityLevel) => {
      const d = level.data;
      const area = level.area || 0;
      switch (a.baseCode) {
        case 'Aakb': // 战鼓
          for (const ally of this.alliesNear(u, u, area || 1000)) {
            addBuff(ally, { kind: 'damageBonus', until: now + 2, value: Number(d.A ?? 0), sourceId: u.id, sourceOwner: u.owner, abilityId: a.id });
          }
          break;
        case 'AEim': // 献祭 (no mana to drain, so always burning)
        case 'Atdg': // 龙卷风 建筑物破坏光环
          for (const e of this.enemiesNear(u, u, area + u.bodyRadius * 0.5)) this.world.dealDamage(e, Number(d.A ?? 0) * TICK_DT, 'ability', u.owner, u.id);
          break;
        case 'Aasl': // 减速光环
          for (const e of this.enemiesNear(u, u, area)) addBuff(e, { kind: 'slow', until: now + 2, value: -Number(d.A ?? 0), sourceId: u.id, sourceOwner: u.owner, abilityId: a.id });
          break;
        case 'Aapl': // 瘟疫: infect whoever comes close
          if (!pulse) break;
          for (const e of this.enemiesNear(u, u, area + u.bodyRadius)) {
            if (!e.buffs.some((b) => b.kind === 'dot' && b.abilityId === a.id)) this.buff(e, 'dot', Number(d.A ?? 120), Number(d.B ?? 0), u, a.id);
          }
          break;
        case 'Aoar': // 雅典娜女神 figurehead: regeneration aura
          for (const ally of this.alliesNear(u, u, area || 900)) ally.hp = Math.min(ally.maxHp, ally.hp + Number(d.A ?? 0) * TICK_DT);
          break;
        case 'Arpl': // 战场支援: heal allies every few seconds
          if ((now + u.id) % Math.round((Number(d.E ?? 5) || 5) * TICK_RATE) !== 0) break;
          for (const ally of this.alliesNear(u, u, area || 800)) ally.hp = Math.min(ally.maxHp, ally.hp + Number(d.A ?? 0));
          break;
        case 'Apxf': { // 小炮 / 格林箭: shoot a random enemy in reach
          const key = `auto:${a.id}`;
          u.hero ??= newHero();
          if (now < (u.hero.readyAt[key] ?? 0)) break;
          const targets = this.enemiesNear(u, u, area).filter((e) => this.world.visibleTo(u.team, e));
          if (!targets.length) break;
          const t = targets[Math.floor(this.world.random() * targets.length)]!;
          this.world.dealDamage(t, Number(d.A ?? 0), 'ability', u.owner, u.id);
          u.hero.readyAt[key] = now + Math.round((level.cooldown || 1) * TICK_RATE);
          break;
        }
        case 'AUls': { // 海怪 tentacles: lash a few enemies every second
          if (!pulse || u.isHero) break;
          const targets = this.enemiesNear(u, u, area).filter((e) => this.world.visibleTo(u.team, e)).slice(0, 3);
          for (const t of targets) this.world.dealDamage(t, Number(d.C ?? 0), 'ability', u.owner, u.id);
          break;
        }
      }
    };
    for (const [id, n] of Object.entries(u.hero?.learned ?? {})) {
      const a = this.byId.get(id);
      if (a && n > 0 && this.targeting(id) === 'passive') run(a, a.levels[n - 1]!);
    }
    for (const a of this.intrinsicOf(u.typeId)) run(a, a.levels[0]!);
    for (const itemId of u.items) {
      // Cannons the weapon table does not list (真红之箭 …) fire through their 小炮-style ability.
      const autoGun = !this.world.weaponType(itemId);
      for (const id of this.items.get(itemId)?.abilities ?? []) {
        const a = this.byId.get(id);
        if (a?.baseCode === 'Aoar' || (autoGun && a?.baseCode === 'Apxf')) run(a, a.levels[0]!);
      }
    }
  }

  private intrinsicOf(typeId: string): Ability[] {
    let list = this.intrinsic.get(typeId);
    if (!list) {
      const auras = new Set(['Atdg', 'Aasl', 'Aapl', 'Apxf', 'AUls', 'Aakb', 'AEim', 'Arpl']);
      list = (this.world.unitType(typeId)?.abilities ?? []).map((id) => this.byId.get(id)).filter((a): a is Ability => !!a && auras.has(a.baseCode) && a.levels.length > 0);
      this.intrinsic.set(typeId, list);
    }
    return list;
  }

  /** Summons chase enemies near their master and fall back to it when there are none. */
  private steerFollowers(): void {
    for (const [id, f] of this.followers) {
      const u = this.world.unit(id);
      const master = this.world.unit(f.masterId);
      if (!u) { this.followers.delete(id); continue; }
      if (!master) { if (!u.illusion) continue; this.world.remove(id); this.followers.delete(id); continue; }
      if (u.targetId !== undefined && this.world.unit(u.targetId) && distance(this.world.unit(u.targetId)!, master) <= f.leash) continue;
      const prey = this.enemiesNear(u, master, f.leash).filter((e) => this.world.visibleTo(u.team, e));
      const pick = prey.length ? prey[Math.floor(this.world.random() * prey.length)]! : undefined;
      const goal = pick ?? (distance(u, master) > 300 ? master : undefined);
      if (!goal) continue;
      if (u.attacks.length || u.weapons.length) { this.world.attackMove(u, [{ x: goal.x, y: goal.y }]); u.targetId = pick?.id; }
      else u.path = this.world.grid.findPath(u, goal, u.pathRadius) ?? [];
    }
  }

  // Hooks from World.dealDamage --------------------------------------------------------------

  /** Detection (探测者) and 影随行 reveal invisible ships to a team. */
  revealed(u: UnitEntity, team: Team): boolean {
    if (u.buffs.some((b) => b.kind === 'armorDown' && teamOfPlayer(b.sourceOwner) === team)) return true;
    for (const z of this.zones) if (z.team === team && distance(z, u) <= z.radius) return true;
    for (const v of this.world.allUnits()) if (v.detects && v.team === team && distance(v, u) <= v.detects) return true;
    return false;
  }

  /** On-hit effects of the special weapons (腐蚀, 燃烧, 弹射). */
  weaponHit(p: Projectile, target: UnitEntity): void {
    const sp = p.special!;
    const source = this.world.unit(p.sourceId);
    if (!source) return;
    if (sp.corrode) {
      this.buff(target, 'slow', sp.corrode.seconds, sp.corrode.slow, source, 'weapon:corrode');
      this.buff(target, 'dot', sp.corrode.seconds, sp.corrode.dps, source, 'weapon:corrode');
    }
    if (sp.burn) for (const e of this.enemiesNear(source, target, sp.burn.radius)) this.buff(e, 'dot', sp.burn.seconds, sp.burn.dps, source, 'weapon:burn');
    if (sp.bounce) {
      const hit = new Set([target.id]);
      let from: UnitEntity = target;
      for (let i = 1; i < sp.bounce.targets; i++) {
        const next = this.enemiesNear(source, from, sp.bounce.radius).filter((e) => !hit.has(e.id) && this.world.visibleTo(source.team, e))
          .sort((a, b) => distance(a, from) - distance(b, from))[0];
        if (!next) break;
        hit.add(next.id);
        this.world.dealDamage(next, p.damage, p.attackType, p.owner, p.sourceId, !sp.ignoresPlating);
        from = next;
      }
    }
  }

  onDamaged(u: UnitEntity): void {
    // 船精灵: below 30% the ship's spirit repairs it, on its own cooldown.
    if (!u.hero || u.hp >= u.maxHp * 0.3) return;
    for (const [id, n] of Object.entries(u.hero.learned)) {
      const a = this.byId.get(id);
      if (a?.baseCode !== 'Agyb' || !n) continue;
      const level = a.levels[n - 1]!;
      const heal = this.tipNumber(level, '生命恢复');
      if (!heal || this.world.tick < (u.hero.readyAt[id] ?? 0)) continue;
      u.hp = Math.min(u.maxHp, u.hp + heal);
      u.hero.readyAt[id] = this.world.tick + Math.round((this.tipNumber(level, '冷却时间') || 80) * TICK_RATE);
      this.world.events.push({ kind: 'cast', casterId: u.id, abilityId: id, x: u.x, y: u.y });
    }
  }

  onDeath(victim: UnitEntity, killerId: number): void {
    if (victim.kind === 'ship' && !victim.illusion && !victim.summoned) {
      this.wrecks.push({ x: victim.x, y: victim.y, tick: this.world.tick, level: victim.hero?.level ?? this.world.unitType(victim.typeId)?.level ?? 1 });
    }
    for (const b of victim.buffs) {
      const a = this.byId.get(b.abilityId);
      const caster = this.world.unit(b.sourceId);
      if (b.kind !== 'dot' || !a) continue;
      // 瘟疫: a ship that dies of plague feeds its share of hit points back to the carrier.
      if (a.baseCode === 'Aapl' && victim.isHero && caster) caster.hp = Math.min(caster.maxHp, caster.hp + victim.maxHp * Number(a.levels.at(-1)!.data.C ?? 10) / 100);
      // 寄生感染: the host releases a ghost ship for the caster.
      if (a.baseCode === 'ANpa' && caster) {
        const level = a.levels[(caster.hero?.learned[a.id] ?? 1) - 1] ?? a.levels[0]!;
        for (const typeId of level.units) this.summon(caster, typeId, victim, Number(level.data.D ?? 8) * (victim.isHero ? 2 : 1), 1200);
      }
    }
    // 镇魂曲: every 35 kills, or one ship kill, the killer releases a stunning blast.
    const killer = this.world.unit(killerId);
    const requiem = killer?.hero && Object.keys(killer.hero.learned).map((id) => this.byId.get(id)).find((a) => a?.baseCode === 'Agyb' && /震晕/.test(a.levels[0]?.description ?? ''));
    if (!killer || !requiem) return;
    const count = (this.requiem.get(killer.id) ?? 0) + (victim.isHero && !victim.illusion ? 35 : 1);
    if (count < 35) { this.requiem.set(killer.id, count); return; }
    this.requiem.set(killer.id, 0);
    const level = this.level(killer, requiem.id)!;
    const radius = Number(/(\d+)\s*范围/.exec(level.description)?.[1] ?? 800);
    const stun = Number(/震晕\s*(\d+(?:\.\d+)?)/.exec(level.description)?.[1] ?? 4);
    for (const e of this.enemiesNear(killer, victim, radius)) {
      this.world.dealDamage(e, this.tipNumber(level, '破坏力'), 'ability', killer.owner, killer.id);
      this.buff(e, 'stun', stun, 0, killer, requiem.id);
    }
    this.world.events.push({ kind: 'cast', casterId: killer.id, abilityId: requiem.id, x: victim.x, y: victim.y });
  }

  /** Spawns a timed summon that hunts near `master`. */
  private summon(master: UnitEntity, typeId: string, at: Vec2, seconds: number, leash: number, still = false): UnitEntity | undefined {
    if (!this.world.unitType(typeId)) return undefined;
    const spot = this.world.grid.nearestSailable(at.x, at.y, 16) ?? master;
    const s = this.world.spawnShip(typeId, master.owner, spot.x, spot.y, master.facing);
    s.summoned = true;
    s.expiresAt = this.world.tick + Math.round(seconds * TICK_RATE);
    // Wards, hawks and helicopters see invisible ships (Adet, Atru, the helicopters' 声纳).
    const seers = (this.world.unitType(typeId)?.abilities ?? []).map((id) => this.byId.get(id)?.baseCode);
    if (seers.some((c) => c === 'Adet' || c === 'Atru' || c === 'Agyv')) s.detects = 900;
    if (still) { s.maxSpeed = 0; this.world.attackMove(s, [{ x: s.x, y: s.y }]); }
    else this.followers.set(s.id, { masterId: master.id, leash });
    return s;
  }

  /** A copy of `of` with its hit points and weapons, for `seconds`. */
  private illusion(of: UnitEntity, owner: UnitEntity, seconds: number, at: Vec2): void {
    const spot = this.world.grid.nearestSailable(at.x, at.y, of.pathRadius) ?? of;
    const s = this.world.spawnShip(of.typeId, owner.owner, spot.x, spot.y, of.facing);
    s.illusion = true;
    s.summoned = true;
    s.hp = of.hp;
    s.maxHp = of.maxHp;
    s.weapons = of.weapons.map((w) => ({ ...w, readyAt: 0 }));
    s.expiresAt = this.world.tick + Math.round(seconds * TICK_RATE);
    this.followers.set(s.id, { masterId: owner.id, leash: 1200 });
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
    // 防护罩 / 能量外壳 also shut out enemy skills.
    if (target.team !== source.team && (target.invulnerable || hasBuff(target, 'invulnerable'))) return;
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
    const m = level ? new RegExp(`${label}\\s*[：:]?\\s*(\\d+(?:\\.\\d+)?)`).exec(level.description) : null;
    return m ? Number(m[1]) : 0;
  }

  /**
   * A missile salvo: C missiles, B seconds apart, each landing at a random spot in the area and
   * hitting what the weapon can target there. 反舰火箭 also hits allies (误伤), not the shooter.
   */
  private salvo(u: UnitEntity, level: AbilityLevel, point: Vec2, itemSlot: number | undefined): void {
    const weapon = itemSlot !== undefined ? this.world.weaponType(u.items[itemSlot] ?? '') : undefined;
    const filter = parseTargets(weapon?.targets ?? level.targets);
    const friendlyFire = /误伤/.test(weapon?.description ?? '');
    const shots = Number(level.data.C ?? 10) || 10, every = Number(level.data.B ?? 0.25) || 0.25, damage = Number(level.data.A ?? 0);
    const area = level.area || 300;
    for (let i = 0; i < shots; i++) {
      this.schedule(i * every, () => {
        const r = area * Math.sqrt(this.world.random()), t = this.world.random() * Math.PI * 2;
        const at = { x: point.x + Math.cos(t) * r, y: point.y + Math.sin(t) * r };
        for (const v of [...this.world.allUnits()]) {
          if (v === u || v.hp <= 0 || distance(v, at) > 120 + v.bodyRadius * 0.5) continue;
          if (v.team === u.team && !friendlyFire) continue;
          if (this.world.canTarget(filter, v)) this.world.dealDamage(v, damage, 'spells', u.owner, u.id);
        }
      });
    }
  }

  /** Item actions the map scripts: ground missiles strike a random enemy building. */
  private scriptedItem(u: UnitEntity, itemId: string, itemSlot: number): void {
    const damage = this.world.goods.groundMissiles.get(itemId);
    if (damage) {
      const targets = [...this.world.structures.values()].filter((b) => b.team !== u.team && b.team !== 'neutral');
      const hit = targets[Math.floor(this.world.random() * targets.length)];
      if (hit) {
        this.schedule(4, () => { if (this.world.unit(hit.id)) this.world.dealDamage(hit, damage, 'ability', u.owner, u.id); });
        this.world.events.push({ kind: 'cast', casterId: u.id, abilityId: `@${itemId}`, x: hit.x, y: hit.y });
      }
    }
    u.hero ??= newHero();
    u.hero.readyAt[this.cooldownKey(u, `@${itemId}`, itemSlot)] = this.world.tick + 5 * TICK_RATE;
    this.consume(u, itemSlot);
  }

  private execute(u: UnitEntity, abilityId: string, target: UnitEntity | undefined, point: Vec2 | undefined, itemSlot?: number): void {
    if (abilityId.startsWith('@')) { this.scriptedItem(u, abilityId.slice(1), itemSlot!); return; }
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
            summon.ward = true;
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

      // Bought ship skills and item abilities -------------------------------------------------
      case 'Asta': { // 震荡雷: a hidden mine that stuns whoever comes close
        for (const typeId of level.units) {
          const mine = this.summon(u, typeId, point!, level.duration ?? 150, 0, true);
          if (!mine) continue;
          mine.ward = true;
          mine.attacks = [];
          this.buff(mine, 'invisible', level.duration ?? 150, 0, u, abilityId);
          this.mines.set(mine.id, { unitId: mine.id, trigger: Math.min(300, num('B') || 300), fullRadius: 0, full: 0, partialRadius: num('C') || 700, partial: 0, stun: level.heroDuration || 8 });
        }
        break;
      }
      case 'Acri': // 减速
        this.buff(target!, 'slow', this.duration(level, target!), num('A'), u, abilityId);
        break;
      case 'ANab': // 酸毒炸弹: acid around the target, burning and eating armor
        for (const e of this.enemiesNear(u, target!, level.area || 400)) {
          this.buff(e, 'dot', this.duration(level, e), num('D'), u, abilityId);
          this.buff(e, 'armorDown', this.duration(level, e), num('C'), u, abilityId);
        }
        break;
      case 'Afla': // 照明弹: light up an area for the team
        this.zones.push({ x: point!.x, y: point!.y, radius: level.area || 1200, team: u.team, until: this.world.tick + Math.round((level.duration || 7) * TICK_RATE) });
        break;
      case 'ANwm': // 探测器 / 战鹰: a ward or hawk that watches the area
        for (const typeId of level.units) this.summon(u, typeId, point!, level.duration || 60, 600, (this.world.unitType(typeId)?.speed ?? 0) === 0);
        break;
      case 'AIbl': // 岸防哨塔: build a tower at the spot
        for (const typeId of level.units) {
          const spot = this.world.grid.nearestSailable(point!.x, point!.y, 30) ?? point!;
          this.world.spawnStructure(typeId, u.owner, spot.x, spot.y);
        }
        break;

      // M5: the remaining ship skills ------------------------------------------------------
      case 'AHds': // 防护罩 / 坚硬外壳: immune to damage and enemy skills
      case 'Aams': // 能量外壳 on an ally
        this.buff(target ?? u, 'invulnerable', level.duration ?? 0, 0, u, abilityId);
        (target ?? u).buffs = (target ?? u).buffs.filter((b) => b.sourceOwner === u.owner || !HOSTILE.has(b.kind) || b.abilityId === abilityId);
        break;
      case 'Aivs': // 隐形
      case 'AIvi':
        this.buff(u, 'invisible', level.duration ?? 0, 0, u, abilityId);
        u.targetId = undefined;
        break;
      case 'AOmi': // 假目标 / 分身: copies of the ship around it
        for (let i = 0; i < Math.max(1, num('A')); i++) {
          const angle = u.facing + Math.PI / 2 + i * Math.PI;
          this.illusion(u, u, level.duration ?? 0, { x: u.x + Math.cos(angle) * 140, y: u.y + Math.sin(angle) * 140 });
        }
        break;
      case 'AIil': // 造影: a copy of the target ally
        this.illusion(target!, u, level.duration ?? 0, { x: target!.x - Math.cos(target!.facing) * 160, y: target!.y - Math.sin(target!.facing) * 160 });
        break;
      case 'AEtq': { // 打捞 (scripted salvage) or 龙王爷保佑 (heal allies over time)
        const radius = this.tipNumber(level, '打捞半径');
        if (radius) {
          const heal = this.tipNumber(level, '生命恢复'), times = this.tipNumber(level, '奖励倍数') || 1;
          for (const ally of this.alliesNear(u, u, radius)) ally.hp = Math.min(ally.maxHp, ally.hp + heal);
          const found = this.wrecks.filter((w) => distance(w, u) <= radius);
          this.wrecks = this.wrecks.filter((w) => !found.includes(w));
          const gold = found.reduce((sum, w) => sum + w.level * times, 0);
          if (gold > 0) this.world.events.push({ kind: 'reward', player: u.owner, gold, xp: 0, x: u.x, y: u.y });
        } else {
          const seconds = level.duration ?? 0;
          for (let t = 0; t < seconds; t++) {
            this.schedule(t, () => {
              if (!this.world.unit(u.id)) return;
              for (const ally of this.alliesNear(u, u, level.area ?? 900)) this.buff(ally, 'hot', 1.05, num('A'), u, abilityId);
            });
          }
        }
        break;
      }
      case 'AHbz': { // 开花弹, 要塞炮, 风贝跳跃 (scripted bombardments)
        if (this.tipNumber(level, '最大距离')) { // 风贝跳跃: jump, then land on the enemies
          const max = this.tipNumber(level, '最大距离');
          const dx = point!.x - u.x, dy = point!.y - u.y, len = Math.hypot(dx, dy) || 1;
          const land = this.world.grid.nearestSailable(u.x + (dx / len) * Math.min(max, len), u.y + (dy / len) * Math.min(max, len), u.pathRadius);
          if (land) { u.x = u.prevX = land.x; u.y = u.prevY = land.y; u.path = []; }
        }
        const at = this.tipNumber(level, '最大距离') ? u : point!;
        const damage = this.tipNumber(level, '杀伤力') || this.tipNumber(level, '基础伤害');
        const stun = this.tipNumber(level, '目标失控') || this.tipNumber(level, '重创');
        for (const e of this.enemiesNear(u, at, level.area || 250)) {
          this.world.dealDamage(e, damage, 'ability', u.owner, u.id);
          if (stun) this.buff(e, 'stun', stun, 0, u, abilityId);
        }
        break;
      }
      case 'ANso': // 混乱: silence and burn
        this.buff(target!, 'silence', this.duration(level, target!), 0, u, abilityId);
        this.buff(target!, 'dot', this.duration(level, target!), num('A'), u, abilityId);
        break;
      case 'AEfk': // 万铳齐鸣: every enemy around takes the volley, up to a total
        {
          const hit = this.enemiesNear(u, u, level.area ?? 0);
          const each = Math.min(num('A'), (num('B') || Infinity) / Math.max(1, hit.length));
          for (const e of hit) this.world.dealDamage(e, each, 'ability', u.owner, u.id);
        }
        break;
      case 'ACbf': // 烈焰喷射: a burst on the target and those beside it, then a burn
        for (const e of this.enemiesNear(u, target!, level.area || 150)) {
          this.world.dealDamage(e, this.tipNumber(level, '首次杀伤') || num('A'), 'ability', u.owner, u.id);
          this.buff(e, 'dot', level.duration ?? 0, this.tipNumber(level, '每秒杀伤') || num('E'), u, abilityId);
        }
        break;
      case 'Afae': // 影随行: lower armor and keep the target in sight
        this.buff(target!, 'armorDown', this.duration(level, target!), num('A'), u, abilityId);
        break;
      case 'AOwd': // 古树精灵: a rooted ward that fights
        for (const typeId of level.units) this.summon(u, typeId, point!, level.duration ?? 40, 0, true);
        break;
      case 'ANto': // 龙卷风: a tornado that hunts nearby enemies
        for (const typeId of level.units) {
          this.summon(u, typeId, { x: u.x + Math.cos(u.facing) * 250, y: u.y + Math.sin(u.facing) * 250 }, level.duration ?? 40, level.range || 1000);
        }
        break;
      case 'AOsf': // 召唤海怪
        for (const typeId of level.units) this.summon(u, typeId, point!, level.duration ?? 40, 1000);
        break;
      case 'AHfs': // 巨石群: boulders burst up, damaging and pinning enemies in the area
        for (const e of this.enemiesNear(u, point!, level.area ?? 0)) {
          this.world.dealDamage(e, num('F'), 'ability', u.owner, u.id);
          this.buff(e, 'root', num('D') || 2, 0, u, abilityId);
        }
        break;
      case 'AEsh': // 撕帆炮: chain shot tears the sails
        this.world.dealDamage(target!, num('E'), 'ability', u.owner, u.id);
        this.buff(target!, 'slow', this.duration(level, target!), num('B'), u, abilityId);
        break;
      case 'ANvc': { // 火山爆发: waves of lava land at random spots in the area
        const waves = num('B') || 8;
        for (let w = 0; w < waves; w++) {
          this.schedule(w * (num('D') || 1), () => {
            const r = (level.area ?? 0) * Math.sqrt(this.world.random()), t = this.world.random() * Math.PI * 2;
            const at = { x: point!.x + Math.cos(t) * r, y: point!.y + Math.sin(t) * r };
            for (const e of this.enemiesNear(u, at, 250)) {
              this.world.dealDamage(e, num('E') * (e.kind === 'structure' ? num('F') || 1 : 1), 'ability', u.owner, u.id);
              this.buff(e, 'stun', this.duration(level, e), 0, u, abilityId);
            }
          });
        }
        break;
      }
      case 'ANpa': // 寄生感染: a long burn; a ghost ship rises if the target dies of it (onDeath)
        this.buff(target!, 'dot', this.duration(level, target!), num('A'), u, abilityId);
        break;
      case 'ANch': // 同化: the ship joins the caster for good
        target!.owner = u.owner;
        target!.team = u.team;
        target!.targetId = undefined;
        target!.maxHp += 300;
        target!.hp += 300;
        target!.buffs = [];
        this.world.attackMove(target!, [{ x: u.x, y: u.y }]);
        this.followers.set(target!.id, { masterId: u.id, leash: 1200 });
        this.world.events.push({ kind: 'reward', player: u.owner, gold: 50, xp: 100, x: target!.x, y: target!.y });
        break;
      case 'AEer': // 缠绕根须: root and squeeze
        this.buff(target!, 'root', this.duration(level, target!), 0, u, abilityId);
        this.buff(target!, 'dot', this.duration(level, target!), num('A'), u, abilityId);
        break;
      case 'ANcs': // 轰天雷: rockets over the area, then a stun; weapon salvos (反舰火箭 …) and 潜射巡航导弹
        if (itemSlot !== undefined || a.id === 'A02H') { this.salvo(u, level, point!, itemSlot); break; }
        for (const e of this.enemiesNear(u, point!, level.area ?? 0)) {
          this.world.dealDamage(e, this.tipNumber(level, '杀伤力') || num('A'), 'ability', u.owner, u.id);
          this.buff(e, 'stun', this.duration(level, e), 0, u, abilityId);
        }
        break;
      case 'AUls': // 战斗小艇 / 海盗小艇: untargetable boats raid enemies near the ship
        for (const typeId of level.units) {
          for (let i = 0; i < Math.max(1, num('A')); i++) {
            const t = (i / Math.max(1, num('A'))) * Math.PI * 2;
            const boat = this.summon(u, typeId, { x: u.x + Math.cos(t) * 120, y: u.y + Math.sin(t) * 120 }, level.duration ?? 30, level.area || 1200);
            if (boat) boat.locust = true;
          }
        }
        break;
      case 'Adis': // 和谐: dispel the area; enemy summons are torn apart
        for (const v of [...this.world.allUnits()]) {
          if (distance(v, point!) > (level.area ?? 0)) continue;
          v.buffs = v.buffs.filter((b) => b.kind === 'spied');
          if (v.team !== u.team && v.summoned) this.world.dealDamage(v, num('B'), 'pure', u.owner, u.id);
        }
        break;
      case 'ANhs': { // 灭火剂: waves of repair over the area
        const waves = num('F') || 8, every = (num('C') || 6) / waves;
        for (let w = 0; w < waves; w++) {
          this.schedule(w * every, () => {
            for (const ally of this.alliesNear(u, point!, level.area ?? 0)) ally.hp = Math.min(ally.maxHp, ally.hp + num('A'));
          });
        }
        break;
      }
      case 'AOsh': { // 主炮轰击: everything on a line takes the shell
        const len = num('C') || 1700, half = (num('D') || 200) / 2;
        const dx = point!.x - u.x, dy = point!.y - u.y, d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        for (const e of this.enemiesNear(u, u, len)) {
          const along = (e.x - u.x) * ux + (e.y - u.y) * uy;
          const across = Math.abs((e.x - u.x) * uy - (e.y - u.y) * ux);
          if (along > 0 && along <= len && across <= half + e.bodyRadius * 0.5) this.world.dealDamage(e, num('A'), 'ability', u.owner, u.id);
        }
        break;
      }
      case 'AIsa': // 顺风顺水: allies sail faster
        for (const ally of this.alliesNear(u, u, level.area ?? 0)) this.buff(ally, 'haste', level.duration ?? 0, num('A'), u, abilityId);
        break;
      case 'AOcl': { // 跳跃闪电 / 死亡能量: jumps to the nearest enemy not yet hit
        const hit = new Set<number>();
        let current: UnitEntity | undefined = target!;
        for (let i = 0; i <= num('B') && current; i++) {
          this.world.dealDamage(current, num('A'), 'ability', u.owner, u.id);
          hit.add(current.id);
          const from: UnitEntity = current;
          current = this.enemiesNear(u, from, level.area || 700)
            .filter((e) => !hit.has(e.id) && this.world.visibleTo(u.team, e))
            .sort((a2, b2) => distance(a2, from) - distance(b2, from))[0];
        }
        break;
      }
      case 'ANfl': { // 叉状闪电: a cone toward the target, a limited number of ships
        const len = num('C') || 900, end = (num('D') || 400) / 2;
        const dx = target!.x - u.x, dy = target!.y - u.y, d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const inCone = this.enemiesNear(u, u, len).filter((e) => {
          const along = (e.x - u.x) * ux + (e.y - u.y) * uy;
          const across = Math.abs((e.x - u.x) * uy - (e.y - u.y) * ux);
          return e === target || (along > 0 && across <= (end * along) / len + e.bodyRadius * 0.5);
        });
        for (const e of inCone.sort((a2, b2) => distance(a2, u) - distance(b2, u)).slice(0, num('B') || 8)) {
          this.world.dealDamage(e, num('A'), 'ability', u.owner, u.id);
        }
        break;
      }
      case 'Aprg': { // 灵魂控制: the enemy ship fights for the caster's side for a while
        const victim = target!;
        const seconds = Number(/阵营\s*(\d+(?:\.\d+)?)\s*秒/.exec(level.description)?.[1] ?? '') || this.duration(level, victim);
        victim.team = u.team;
        victim.targetId = undefined;
        this.schedule(seconds, () => { victim.team = teamOfPlayer(victim.owner); victim.targetId = undefined; });
        break;
      }
      case 'Aply': // 变异: cannot fight or cast
        this.buff(target!, 'disarm', this.duration(level, target!), 0, u, abilityId);
        this.buff(target!, 'silence', this.duration(level, target!), 0, u, abilityId);
        this.buff(target!, 'slow', this.duration(level, target!), 0.5, u, abilityId);
        break;
      case 'AHdr': { // 生命汲取: drain while the target stays within the area
        const steps = Math.round((level.duration ?? 0) * 4);
        for (let i = 0; i < steps; i++) {
          this.schedule(i * 0.25, () => {
            const t = this.world.unit(target!.id), me = this.world.unit(u.id);
            if (!t || !me || distance(t, me) > (level.area || 900) || hasBuff(me, 'stun')) return;
            const before = t.hp;
            this.world.dealDamage(t, num('A') * 0.25, 'ability', u.owner, u.id);
            me.hp = Math.min(me.maxHp, me.hp + (before - Math.max(0, t.hp)));
          });
        }
        break;
      }
    }

    if (itemSlot !== undefined) this.consume(u, itemSlot);
  }

  /** Single-use items are used up; multi-use ones lose a charge. */
  private consume(u: UnitEntity, itemSlot: number): void {
    const itemId = u.items[itemSlot] ?? '';
    const charges = u.hero?.charges[itemId];
    if (charges !== undefined && charges > 1) { u.hero!.charges[itemId] = charges - 1; return; }
    if (u.hero) delete u.hero.charges[itemId];
    if (this.items.get(itemId)?.perishable || this.world.goods.groundMissiles.has(itemId)) {
      u.items.splice(itemSlot, 1);
      this.world.setItems(u, u.items);
      this.world.events.push({ kind: 'itemUsed', unitId: u.id, slot: itemSlot });
    }
  }
}
