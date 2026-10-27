// Timed status effects on units. Movement, combat and casting consult these.

export type BuffKind =
  /** Cannot move, attack or cast. */
  | 'stun'
  /** Cannot move. */
  | 'root'
  /** Cannot cast. */
  | 'silence'
  /** Move speed × (1 − value); the strongest slow applies. */
  | 'slow'
  /** Move speed × (1 + value); the strongest boost applies. */
  | 'haste'
  | 'invulnerable'
  /** `value` damage per second from `sourceOwner`. */
  | 'dot'
  /** `value` healing per second. */
  | 'hot'
  /** Outgoing damage × (1 + value) (war drums); refreshed each tick by the aura owner. */
  | 'damageBonus'
  /** Marked by a spy (领主 派遣间谍) of `sourceOwner`. */
  | 'spied'
  /** Cannot be targeted by enemies unless revealed; attacking ends it. */
  | 'invisible'
  /** Armor − value; also keeps the target visible to `sourceOwner`'s team (影随行). */
  | 'armorDown'
  /** Armor + value (creep 专注光环); refreshed each tick by the aura owner. */
  | 'armorUp'
  /** Each attack misses with chance `value` (creep 诅咒). */
  | 'miss'
  /** Cannot attack (变异). */
  | 'disarm';

export interface Buff {
  kind: BuffKind;
  /** Tick when it ends. */
  until: number;
  value: number;
  sourceId: number;
  sourceOwner: number;
  /** Ability that applied it, for display and stacking. */
  abilityId: string;
}

export interface HasBuffs {
  buffs: Buff[];
}

/** Adds a buff; a buff of the same kind from the same ability is replaced. */
export function addBuff(u: HasBuffs, buff: Buff): void {
  const i = u.buffs.findIndex((b) => b.kind === buff.kind && b.abilityId === buff.abilityId);
  if (i >= 0) u.buffs[i] = buff; else u.buffs.push(buff);
}

export function hasBuff(u: HasBuffs, kind: BuffKind): boolean {
  return u.buffs.some((b) => b.kind === kind);
}

export function strongest(u: HasBuffs, kind: BuffKind): number {
  let v = 0;
  for (const b of u.buffs) if (b.kind === kind && b.value > v) v = b.value;
  return v;
}

export function dropExpired(u: HasBuffs, tick: number): void {
  if (u.buffs.length) u.buffs = u.buffs.filter((b) => b.until > tick);
}
