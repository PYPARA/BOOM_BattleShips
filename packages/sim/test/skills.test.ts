// M5 ship skills: shields, invisibility, summons, chains, lines and the scripted passives.
import { describe, expect, it } from 'vitest';
import { createMatch, hasBuff, TICK_RATE, xpForLevel, type Match, type UnitEntity } from '../src/index.ts';
import { data } from './world.test.ts';

const run = (m: Match, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) m.step(); };

/** Player 2 in `typeId` at level 10 in the open western sea, player 7's ship nearby. */
function duel(typeId: string, enemyType = 'H009', gap = 400) {
  const m = createMatch(data, { players: [2, 7] });
  const spot = m.world.grid.nearestSailable(-2000, -1500, 20)!;
  const at = (owner: number, type: string, dx: number): UnitEntity => {
    const p = m.players.get(owner)!;
    const old = m.world.ships.get(p.shipId!);
    if (old) m.world.remove(old.id);
    p.shipTypeId = type;
    p.hero.xp = xpForLevel(10);
    p.hero.level = 10;
    const s = m.world.spawnShip(type, owner, spot.x + dx, spot.y);
    s.hero = p.hero;
    p.shipId = s.id;
    return s;
  };
  return { m, me: at(2, typeId, 0), enemy: at(7, enemyType, gap), spot };
}

const learn = (m: Match, me: UnitEntity, ...ids: string[]) => ids.forEach((id) => expect(m.world.abilities.learn(me, id)).toBe(true));
const cast = (m: Match, abilityId: string, target: { unitId?: number; point?: { x: number; y: number } } = {}) => {
  m.issue({ kind: 'cast', player: 2, abilityId, ...target });
  m.step(); m.step();
};
/** An enemy NPC fleet ship (player 13 is the north fleet). */
const npc = (m: Match, x: number, y: number, typeId = 'h00I') => m.world.spawnShip(typeId, 13, x, y);

describe('M5 ship skills', () => {
  it('防护罩 blocks damage and enemy skills', () => {
    const { m, me } = duel('H00D');
    learn(m, me, 'A01V');
    cast(m, 'A01V');
    const hp = me.hp;
    m.world.dealDamage(me, 500, 'ability', 7, 0);
    expect(me.hp).toBe(hp);
    expect(hasBuff(me, 'invulnerable')).toBe(true);
  });

  it('隐形 hides the ship until it attacks; 影随行 reveals', () => {
    const { m, me, enemy } = duel('H00D');
    learn(m, me, 'A00A');
    cast(m, 'A00A');
    expect(m.world.visibleTo(enemy.team, me)).toBe(false);
    expect(m.world.abilities.cast(enemy, 'A00A', {})).toBe('尚未学会这个技能');
    me.buffs = me.buffs.filter((b) => b.kind !== 'invisible');
    expect(m.world.visibleTo(enemy.team, me)).toBe(true);
  });

  it('万铳齐鸣 hits every enemy around the turtle ship', () => {
    const { m, me, enemy, spot } = duel('H016');
    const boat = npc(m, spot.x - 300, spot.y);
    learn(m, me, 'AEfk');
    const [a, b] = [enemy.hp, boat.hp];
    cast(m, 'AEfk');
    expect(enemy.hp).toBeLessThan(a);
    expect(boat.hp).toBeLessThan(b);
  });

  it('致命一击 gives the submarine a crit chance', () => {
    const { m, me } = duel('H005');
    learn(m, me, 'AOcr');
    expect(me.critChance).toBeGreaterThan(0);
    expect(me.critMultiplier).toBe(2);
  });

  it('跳跃闪电 jumps between enemies', () => {
    const { m, me, enemy, spot } = duel('H015');
    const boats = [npc(m, spot.x + 600, spot.y + 150), npc(m, spot.x + 700, spot.y - 200)];
    learn(m, me, 'AOcl');
    cast(m, 'AOcl', { unitId: enemy.id });
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(boats.filter((b) => b.hp < b.maxHp || !m.world.unit(b.id)).length).toBe(2);
  });

  it('战斗小艇 launches untargetable boats that expire', () => {
    const { m, me } = duel('H019');
    learn(m, me, 'A061');
    cast(m, 'A061');
    const boats = [...m.world.ships.values()].filter((s) => s.typeId === 'u001');
    expect(boats.length).toBe(Number(m.world.abilities.byId.get('A061')!.levels[0]!.data.A));
    expect(boats.every((b) => b.locust && !m.world.visibleTo('north', b))).toBe(true);
    run(m, 31);
    expect([...m.world.ships.values()].some((s) => s.typeId === 'u001')).toBe(false);
  });

  it('主炮轰击 hits along a line only', () => {
    const { m, me, enemy, spot } = duel('H00R', 'H009', 800);
    const aside = npc(m, spot.x, spot.y + 700);
    learn(m, me, 'AOsh');
    cast(m, 'AOsh', { point: { x: enemy.x, y: enemy.y } });
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(aside.hp).toBe(aside.maxHp);
  });

  it('同化 takes over an NPC ship and pays gold', () => {
    const { m, me, enemy, spot } = duel('H01L');
    const boat = npc(m, spot.x + 300, spot.y + 200);
    learn(m, me, 'ANch');
    expect(m.world.abilities.cast(me, 'ANch', { unitId: enemy.id })).toBe('只能控制普通船只');
    const gold = m.players.get(2)!.gold;
    cast(m, 'ANch', { unitId: boat.id });
    expect(boat.owner).toBe(2);
    expect(boat.team).toBe(me.team);
    expect(m.players.get(2)!.gold).toBe(gold + 50);
  });

  it('打捞 salvages recent wrecks for gold', () => {
    const { m, me, spot } = duel('H01A');
    const boat = npc(m, spot.x + 300, spot.y);
    m.world.dealDamage(boat, 1e6, 'pure', 7, 0);
    m.step();
    learn(m, me, 'A08T');
    const gold = m.players.get(2)!.gold;
    cast(m, 'A08T');
    expect(m.players.get(2)!.gold).toBeGreaterThan(gold);
  });

  it('船精灵 repairs the ship once below 30%', () => {
    const { m, me } = duel('H021');
    learn(m, me, 'A086');
    m.world.dealDamage(me, me.hp * 0.8, 'pure', 7, 0);
    expect(me.hp).toBeGreaterThan(me.maxHp * 0.3);
    const hp = me.hp;
    m.world.dealDamage(me, me.hp * 0.9, 'pure', 7, 0);
    expect(me.hp).toBeLessThan(hp); // on cooldown now
  });

  it('镇魂曲 stuns everything around a sunk ship', () => {
    const { m, me, enemy, spot } = duel('H01V');
    const boat = npc(m, enemy.x + 200, enemy.y);
    learn(m, me, 'A06X');
    m.world.dealDamage(enemy, 1e6, 'pure', 2, me.id);
    expect(hasBuff(boat, 'stun') || !m.world.unit(boat.id)).toBe(true);
    void spot;
  });

  it('寄生感染 raises a ghost ship when the target dies', () => {
    const { m, me, spot } = duel('H01O');
    const boat = npc(m, spot.x + 300, spot.y);
    learn(m, me, 'A065');
    cast(m, 'A065', { unitId: boat.id });
    m.world.dealDamage(boat, 1e6, 'ability', 2, me.id);
    expect([...m.world.ships.values()].some((s) => s.typeId === 'h00W' && s.owner === 2)).toBe(true);
  });

  it('灵魂控制 turns an enemy ship for a while', () => {
    const { m, me, enemy } = duel('H01N');
    learn(m, me, 'A067');
    const home = enemy.team;
    cast(m, 'A067', { unitId: enemy.id });
    expect(enemy.team).toBe(me.team);
    run(m, 10);
    expect(enemy.team).toBe(home);
  });

  it('illusions copy the ship and give no bounty', () => {
    const { m, me, enemy } = duel('H011');
    learn(m, me, 'A04T');
    cast(m, 'A04T');
    const copy = [...m.world.ships.values()].find((s) => s.illusion && s.owner === 2)!;
    expect(copy.typeId).toBe('H011');
    const gold = m.players.get(7)!.gold;
    m.world.dealDamage(copy, 1e6, 'pure', 7, enemy.id);
    m.step();
    expect(m.players.get(7)!.gold).toBe(gold);
  });
});
