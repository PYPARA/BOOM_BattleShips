// Shop goods: blueprints, hull upgrades, bought ship skills, submarine gear, salvos, special
// weapons, charges and carry limits — and a check that nothing a shop sells is inert.
import { describe, expect, it } from 'vitest';
import { createMatch, DEFAULT_GRANTS, hasBuff, TICK_RATE, type GameMode, type Match } from '../src/index.ts';
import { data } from './world.test.ts';

const run = (m: Match, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) m.step(); };

/** Player 2 sailing `typeId`, rich, parked at whichever shop sells `itemId`. */
function atShop(itemId: string, typeId = 'H000', mode?: GameMode) {
  const m = createMatch(data, { players: [2, 7], mode });
  const p = m.players.get(2)!;
  p.gold = 100000;
  const shop = m.shops.find((s) => s.sellsItems.includes(itemId) && m.world.grid.nearestSailable(s.x, s.y, 30))!;
  const old = m.world.ships.get(p.shipId!)!;
  m.world.remove(old.id);
  p.shipTypeId = typeId;
  const spot = m.world.grid.nearestSailable(shop.x, shop.y, 30)!;
  const ship = m.world.spawnShip(typeId, 2, spot.x, spot.y);
  ship.hero = p.hero;
  Object.assign(p.hero.granted, DEFAULT_GRANTS[typeId]);
  p.shipId = ship.id;
  m.world.setItems(ship, p.items);
  const buy = (id: string) => { m.issue({ kind: 'buyItem', player: 2, itemId: id }); m.step(); return m.events.find((e) => e.kind === 'denied')?.reason; };
  return { m, p, ship, buy };
}
const byName = (name: string) => data.items.find((i) => i.name === name)!.id;

describe('shop goods', () => {
  it('a blueprint rebuilds the weapon it names', () => {
    const { p, buy } = atShop('I02V');
    expect(buy('I02V')).toMatch(/需要先装备/);
    p.items.push(byName('护卫舰炮'));
    expect(buy('I02V')).toBeUndefined();
    expect(p.items).toEqual(['I02W']);
  });

  it('hull blueprints add HP once, only for listed ships', () => {
    const { m, p, buy } = atShop('I03D');
    const ship = () => m.world.ships.get(p.shipId!)!;
    const hp = ship().maxHp;
    expect(buy('I03D')).toBeUndefined();
    expect(ship().maxHp).toBe(hp + 500);
    expect(buy('I03D')).toBe('每艘船只能升级一次');
    expect(buy('I03A')).toBe('您的船不符合改装要求');
  });

  it('ship special skills: allowed hulls, one per ship, buy again to level up, refunded on reset', () => {
    const { m, p, buy } = atShop('I04F');
    expect(buy('I04F')).toBeUndefined();
    expect(p.hero.granted.ANab).toBe(1);
    expect(buy('I04F')).toBeUndefined();
    expect(p.hero.granted.ANab).toBe(2);
    expect(buy('I043')).toBe('每艘船只能安装一种特殊能力');
    expect(m.world.abilities.grantedOf(m.world.ships.get(p.shipId!)!).map((a) => a.id)).toEqual(['ANab']);
    const gold = p.gold;
    expect(buy('I05U')).toBeUndefined();
    expect(p.hero.granted.ANab).toBeUndefined();
    expect(p.gold).toBe(gold - 2 + 4 * 60);
  });

  it('a bought 酸毒炸弹 can be cast and eats armor', () => {
    const { m, p, ship, buy } = atShop('I04F');
    buy('I04F');
    const enemy = m.world.spawnShip('h00I', 13, ship.x + 300, ship.y);
    m.issue({ kind: 'cast', player: 2, abilityId: 'ANab', unitId: enemy.id });
    run(m, 0.2);
    expect(hasBuff(enemy, 'armorDown')).toBe(true);
    void p;
  });

  it('submarine gear only fits the submarine and works once', () => {
    // The submarine factory only stands in the 商船任务 mode.
    expect(createMatch(data, { players: [2, 7] }).shops.some((s) => s.unitId === 'n00U')).toBe(false);
    const { buy } = atShop('I03R', 'H000', 'traders');
    expect(buy('I03R')).toBe('非潜水艇，不能安装');
    const sub = atShop('I03R', 'H005', 'traders');
    const speed = sub.ship.maxSpeed;
    expect(sub.buy('I03R')).toBeUndefined();
    expect(sub.m.world.ships.get(sub.p.shipId!)!.maxSpeed).toBe(speed + 100);
    expect(sub.buy('I03R')).toBe('已经安装过了');
    expect(sub.p.hero.granted.A036).toBe(1); // the mine layer comes with the hull
    expect(sub.buy('I03J')).toBeUndefined();
    expect(sub.p.hero.granted.A036).toBe(3);
  });

  it('salvo weapons fire by hand; 反舰火箭 can hit allies, 反潜火箭 never fires on its own', () => {
    // 反舰火箭 is not sold in a shop (it comes from upgrades): hand it over.
    const { m, p, ship, buy } = atShop('I01X', 'H008');
    m.world.setItems(ship, (p.items = ['I03F']));
    expect(ship.weapons[0]!.manual).toBe(false);
    const enemy = m.world.spawnShip('h00I', 13, ship.x + 600, ship.y);
    const friend = m.world.spawnShip('h00I', 0, ship.x + 650, ship.y + 40);
    m.issue({ kind: 'useItem', player: 2, slot: 0, point: { x: enemy.x + 20, y: enemy.y + 20 } });
    run(m, 4);
    expect(enemy.hp < enemy.maxHp || !m.world.unit(enemy.id)).toBe(true);
    expect(friend.hp < friend.maxHp || !m.world.unit(friend.id)).toBe(true);
    p.items = [];
    expect(buy('I01X')).toBeUndefined();
    expect(m.world.ships.get(p.shipId!)!.weapons[0]!.manual).toBe(true);
  });

  it('腐蚀大炮 slows and burns; only one special weapon at a time', () => {
    const { m, p, ship, buy } = atShop('I031');
    expect(buy('I031')).toBeUndefined();
    expect(buy('I05J')).toBe('只能携带一个特殊武器');
    const enemy = m.world.spawnShip('h00I', 13, ship.x + 500, ship.y);
    m.world.attackMove(m.world.ships.get(p.shipId!)!, [{ x: ship.x, y: ship.y }]);
    run(m, 3);
    expect(enemy.buffs.some((b) => b.abilityId === 'weapon:corrode') || !m.world.unit(enemy.id)).toBe(true);
  });

  it('探测器 stacks three charges in one slot', () => {
    const { p, buy } = atShop('I02I');
    buy('I02I');
    buy('I02I');
    expect(p.items.filter((i) => i === 'I02I').length).toBe(1);
    expect(p.hero.charges.I02I).toBe(6);
  });

  it('only one sail at a time', () => {
    const { buy } = atShop('I007');
    expect(buy('I007')).toBeUndefined();
    expect(buy('I008')).toBe('只能携带一个帆');
  });

  it('every shop item does something', () => {
    const m = createMatch(data, { players: [2] });
    const goods = m.world.goods;
    const abilities = m.world.abilities;
    const sold = new Set(data.units.flatMap((u) => u.sellsItems ?? []));
    // Passive item effects the sim applies (refreshStats, auras) besides castable abilities.
    const passive = new Set(['AOae', 'AIml', 'Arel', 'AIms', 'AIdd', 'Adet', 'Aoar', 'Apxf']);
    // Kept for completeness but meaningless here: music boxes, quest timber, night vision.
    const inert = new Set(['I04T', 'I04U', 'I04V', 'I04W', 'I01N']);
    const missing = data.items.filter((i) => {
      if (!sold.has(i.id) || i.goldCost <= 0 || inert.has(i.id)) return false;
      if (m.world.weaponType(i.id) || goods.purchases.has(i.id) || m.activeItemAbility(i.id)) return false;
      const codes = i.abilities.map((id) => abilities.byId.get(id)?.baseCode ?? '');
      return !codes.some((c) => passive.has(c));
    });
    expect(missing.map((i) => `${i.id} ${i.name}`)).toEqual([]);
  });
});
