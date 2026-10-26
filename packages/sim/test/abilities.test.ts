import { describe, expect, it } from 'vitest';
import { createMatch, hasBuff, TICK_RATE, xpForLevel, type Match, type UnitEntity } from '../src/index.ts';
import { data } from './world.test.ts';

const run = (m: Match, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) m.step(); };

/** Player 2 in `typeId` at an open spot in the western lane, an enemy ship (player 7) nearby. */
function duel(typeId: string, level = 1, enemyType = 'H009', gap = 400) {
  const m = createMatch(data, { players: [2, 7] });
  const p = m.players.get(2)!;
  p.shipTypeId = typeId;
  p.hero.xp = xpForLevel(level);
  p.hero.level = level;
  const spot = m.world.grid.nearestSailable(-2000, -1500, 20)!;
  const at = (owner: number, type: string, dx: number): UnitEntity => {
    const old = m.world.ships.get(m.players.get(owner)!.shipId!);
    if (old) m.world.remove(old.id);
    m.players.get(owner)!.shipTypeId = type;
    const s = m.world.spawnShip(type, owner, spot.x + dx, spot.y);
    s.hero = m.players.get(owner)!.hero;
    m.players.get(owner)!.shipId = s.id;
    return s;
  };
  const me = at(2, typeId, 0);
  const enemy = at(7, enemyType, gap);
  return { m, p, me, enemy };
}

describe('learning and experience', () => {
  it('respects required level and level skip', () => {
    const { m, me } = duel('H008', 1);
    expect(m.world.abilities.learn(me, 'A03M')).toBe(false); // 冻结 needs level 2
    expect(m.world.abilities.learn(me, 'A02Z')).toBe(true); // 派遣间谍 at level 1
    expect(m.world.abilities.learn(me, 'A03W')).toBe(false); // no points left
  });

  it('levels a ship up from kills nearby', () => {
    const { m, p, enemy } = duel('H000', 1);
    m.world.dealDamage(enemy, 1e6, 'pure', 2, m.players.get(2)!.shipId!);
    m.step();
    expect(p.hero.xp).toBeCloseTo(70 * 1.5);
    expect(p.hero.level).toBe(2);
  });

  it('passive hull upgrade adds 50 HP per strength point', () => {
    const { m, me } = duel('H000', 1);
    m.world.abilities.learn(me, 'A07U');
    expect(me.maxHp).toBe(200 + 50);
  });
});

describe('ship skills', () => {
  const learnAll = (m: Match, me: UnitEntity, ids: string[]) => ids.forEach((id) => expect(m.world.abilities.learn(me, id)).toBe(true));

  it('船长火炮 damages and stuns', () => {
    const { m, me, enemy } = duel('H000');
    learnAll(m, me, ['A01Y']);
    const hp = enemy.hp;
    m.issue({ kind: 'cast', player: 2, abilityId: 'A01Y', unitId: enemy.id });
    m.step(); m.step();
    expect(enemy.hp).toBeLessThanOrEqual(hp - 50 + 10);
    expect(hasBuff(enemy, 'stun')).toBe(true);
  });

  it('冻结 stuns and damages everything around the lord', () => {
    const { m, me, enemy } = duel('H008', 2);
    learnAll(m, me, ['A03M']);
    m.issue({ kind: 'cast', player: 2, abilityId: 'A03M' });
    m.step(); m.step();
    expect(hasBuff(enemy, 'stun')).toBe(true);
    expect(enemy.maxHp - enemy.hp).toBeGreaterThan(300);
  });

  it('燃料加速 speeds up and, once learned, 燃料炸弹 blasts around', () => {
    const { m, me, enemy } = duel('H003', 2);
    learnAll(m, me, ['A00N', 'A07P']);
    m.issue({ kind: 'cast', player: 2, abilityId: 'A00N' });
    m.step(); m.step();
    expect(hasBuff(me, 'haste')).toBe(true);
    expect(enemy.maxHp - enemy.hp).toBeGreaterThan(100);
  });

  it('渔网 roots, 自杀撞击 sinks the caster and hurts the target', () => {
    const net = duel('H001', 5);
    learnAll(net.m, net.me, ['A00Y']);
    net.m.issue({ kind: 'cast', player: 2, abilityId: 'A00Y', unitId: net.enemy.id });
    run(net.m, 0.2);
    expect(hasBuff(net.enemy, 'root')).toBe(true);

    const ram = duel('H001', 1, 'H009', 250);
    learnAll(ram.m, ram.me, ['A01A']);
    const hp = ram.enemy.hp;
    ram.m.issue({ kind: 'cast', player: 2, abilityId: 'A01A', unitId: ram.enemy.id });
    run(ram.m, 1);
    expect(ram.m.players.get(2)!.shipId).toBeUndefined();
    expect(ram.enemy.hp).toBeLessThan(hp - 200);
  });

  it('紧急修理 heals an ally over time; 布放水雷 mines blow up enemies', () => {
    const { m, me, enemy } = duel('H004', 2, 'H009', 2000);
    learnAll(m, me, ['A01E', 'A07L']);
    me.hp = 300;
    m.issue({ kind: 'cast', player: 2, abilityId: 'A01E', unitId: me.id });
    run(m, 3);
    expect(me.hp).toBeGreaterThan(380);
    m.issue({ kind: 'cast', player: 2, abilityId: 'A07L' });
    m.step(); m.step();
    const mine = [...m.world.ships.values()].find((s) => s.typeId === 'n00S')!;
    expect(mine).toBeDefined();
    Object.assign(enemy, { x: mine.x + 100, y: mine.y });
    const hp = enemy.hp;
    m.step();
    expect(m.world.ships.has(mine.id)).toBe(false);
    expect(enemy.hp).toBeLessThan(hp - 200);
  });

  it('破坏者: boarding stuns and burns, signal jamming silences', () => {
    const { m, me, enemy } = duel('H007', 1, 'H009', 120);
    learnAll(m, me, ['A01R']);
    m.issue({ kind: 'cast', player: 2, abilityId: 'A01R', unitId: enemy.id });
    run(m, 1);
    expect(hasBuff(enemy, 'stun')).toBe(true);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    m.players.get(2)!.hero.level = 2;
    learnAll(m, me, ['A038']);
    m.issue({ kind: 'cast', player: 2, abilityId: 'A038', point: { x: enemy.x, y: enemy.y } });
    run(m, 0.2);
    expect(hasBuff(enemy, 'silence')).toBe(true);
  });

  it('电磁脉冲 slows enemies', () => {
    const { m, me, enemy } = duel('H006', 3);
    learnAll(m, me, ['A037']);
    m.issue({ kind: 'cast', player: 2, abilityId: 'A037' });
    run(m, 0.2);
    expect(hasBuff(enemy, 'slow')).toBe(true);
  });

  it('大天使: invulnerable escorts, war-drum aura, summoned frigates that expire', () => {
    const { m, me } = duel('H00V', 2, 'H009', 3000);
    learnAll(m, me, ['AOvd', 'A08X']);
    const escort = m.world.spawnShip('H000', 2, me.x + 200, me.y);
    m.issue({ kind: 'cast', player: 2, abilityId: 'AOvd' });
    run(m, 0.2);
    expect(hasBuff(escort, 'invulnerable')).toBe(true);
    expect(hasBuff(me, 'invulnerable')).toBe(false);
    expect(hasBuff(escort, 'damageBonus')).toBe(true);

    m.players.get(2)!.hero.level = 3;
    learnAll(m, me, ['AHwe']);
    m.issue({ kind: 'cast', player: 2, abilityId: 'AHwe' });
    run(m, 0.2);
    expect([...m.world.ships.values()].filter((s) => s.typeId === 'h00F' && s.owner === 2)).toHaveLength(2);
    run(m, 31);
    expect([...m.world.ships.values()].filter((s) => s.typeId === 'h00F' && s.owner === 2)).toHaveLength(0);
  });
});

describe('items', () => {
  it('hulls cut damage taken and slow the ship, sails speed it up', () => {
    const { m, me } = duel('H000');
    m.world.setItems(me, ['I00A']); // 金甲船体: +700 HP, 70% damage taken, −20% speed
    expect(me.maxHp).toBe(900);
    expect(me.damageTaken).toBeCloseTo(0.7);
    expect(me.maxSpeed).toBeCloseTo(180 * 0.8);
    m.world.setItems(me, ['I01A']); // 精灵帆 +50%
    expect(me.maxSpeed).toBeCloseTo(270);
  });

  it('a repair kit heals and is consumed; the teleporter blinks', () => {
    const { m, p, me } = duel('H000');
    p.items = ['I00C', 'I01L'];
    m.world.setItems(me, p.items);
    me.hp = 50;
    m.issue({ kind: 'useItem', player: 2, slot: 0 });
    m.step(); m.step();
    expect(me.hp).toBe(200);
    expect(p.items).toEqual(['I01L']);
    const from = { x: me.x, y: me.y };
    m.issue({ kind: 'useItem', player: 2, slot: 0, point: { x: me.x, y: me.y + 900 } });
    m.step(); m.step();
    expect(Math.hypot(me.x - from.x, me.y - from.y)).toBeGreaterThan(600);
  });
});
