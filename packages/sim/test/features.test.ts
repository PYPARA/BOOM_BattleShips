// Submarine diving, creep skills, the three modes, 商船任务 quests and the weather.
import { describe, expect, it } from 'vitest';
import { CREEP_OWNER, createMatch, DEFAULT_GRANTS, hasBuff, parseTargets, TICK_RATE, type GameMode, type Match } from '../src/index.ts';
import { data } from './world.test.ts';

const run = (m: Match, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) m.step(); };

/** Player 2's ship swapped for `typeId` and moved to a rect. */
function sail(m: Match, typeId: string, rect?: string) {
  const p = m.players.get(2)!;
  const old = m.world.ships.get(p.shipId!)!;
  const at = rect ? m.rectCenter(rect) : old;
  const spot = m.world.grid.nearestSailable(at.x, at.y, 30)!;
  m.world.remove(old.id);
  p.shipTypeId = typeId;
  const ship = m.world.spawnShip(typeId, 2, spot.x, spot.y);
  ship.hero = p.hero;
  Object.assign(p.hero.granted, DEFAULT_GRANTS[typeId]);
  p.shipId = ship.id;
  m.world.setItems(ship, p.items);
  return ship;
}

function moveTo(m: Match, rect: string) {
  const ship = m.world.ships.get(m.players.get(2)!.shipId!)!;
  const c = m.rectCenter(rect);
  const spot = m.world.grid.nearestSailable(c.x, c.y, 30)!;
  ship.x = spot.x; ship.y = spot.y; ship.path = [];
  run(m, 1.05);
}

describe('submarine diving', () => {
  it('dives out of reach of normal weapons and surfaces again', () => {
    const m = createMatch(data, { players: [2, 7], mode: 'traders', fog: false });
    const sub = sail(m, 'H005');
    const p = m.players.get(2)!;
    p.items.push('I00C'); // a repair kit
    m.world.setItems(sub, p.items);
    const cannon = parseTargets(['ground']);
    const antiSub = parseTargets(['ward']);
    expect(m.world.canTarget(cannon, sub)).toBe(true);
    m.issue({ kind: 'cast', player: 2, abilityId: 'A046' });
    run(m, 0.2);
    expect(sub.submerged).toBe(true);
    expect(sub.maxSpeed).toBeGreaterThan(200); // 25 knots under water
    expect(m.world.canTarget(cannon, sub)).toBe(false);
    expect(m.world.canTarget(antiSub, sub)).toBe(true);
    m.issue({ kind: 'useItem', player: 2, slot: 0 });
    m.step();
    expect(m.events.find((e) => e.kind === 'denied')).toMatchObject({ reason: '水下航行时不能使用物品' });
    run(m, 10);
    m.issue({ kind: 'cast', player: 2, abilityId: 'A046' });
    run(m, 0.2);
    expect(sub.submerged).toBe(false);
    expect(sub.maxSpeed).toBe(180);
  });
});

describe('creep skills', () => {
  it('a creep ensnares a ship that fights it, and its poison sticks', () => {
    const m = createMatch(data, { players: [2], fog: false });
    const ship = sail(m, 'H004', 'GoblinShop');
    const creep = m.world.spawnShip('nmrr', CREEP_OWNER, ship.x + 400, ship.y);
    m.world.attackMove(creep, [{ x: ship.x, y: ship.y }]);
    let rooted = false, poisoned = false;
    for (let i = 0; i < 8 * TICK_RATE && !(rooted && poisoned); i++) {
      m.step();
      rooted ||= hasBuff(ship, 'root');
      poisoned ||= ship.buffs.some((b) => b.kind === 'dot');
    }
    expect(rooted).toBe(true);
    expect(poisoned).toBe(true);
  });

  it('a creep shaman heals a hurt ally', () => {
    const m = createMatch(data, { players: [2], fog: false });
    const ship = sail(m, 'H004', 'GoblinShop');
    const shaman = m.world.spawnShip('ndrs', CREEP_OWNER, ship.x + 500, ship.y);
    const friend = m.world.spawnShip('ndrp', CREEP_OWNER, ship.x + 550, ship.y + 60);
    friend.hp = 100;
    shaman.maxSpeed = friend.maxSpeed = 0;
    ship.attacks = [];
    run(m, 2);
    expect(friend.hp).toBeGreaterThan(250);
  });
});

describe('game modes', () => {
  const shopsOf = (mode: GameMode) => createMatch(data, { players: [2], mode }).shops.map((s) => s.unitId);
  it('only the trade mode keeps the traders and the submarine factory', () => {
    for (const mode of ['standard', 'fast'] as const) expect(shopsOf(mode)).not.toContain('n00E');
    expect(shopsOf('traders')).toEqual(expect.arrayContaining(['n00E', 'n00F', 'n00U']));
  });

  it('teammates may give each other gold only in the trade mode', () => {
    for (const mode of ['fast', 'traders'] as const) {
      const m = createMatch(data, { players: [2, 3], mode });
      const [a, b] = [m.players.get(2)!, m.players.get(3)!];
      const before = b.gold;
      m.issue({ kind: 'giveGold', player: 2, to: 3, amount: 100 });
      m.step();
      expect(b.gold - before).toBe(mode === 'traders' ? 100 : 0);
      void a;
    }
  });
});

describe('trade quests', () => {
  it('a merchant ship runs beer from the brewery to its trader', () => {
    const m = createMatch(data, { players: [2], mode: 'traders' });
    const p = m.players.get(2)!;
    sail(m, 'H00D', 'SouthReward');
    m.issue({ kind: 'buyItem', player: 2, itemId: 'I00K' });
    m.step();
    expect(p.items).toEqual(['I00K']);
    moveTo(m, 'AleFactory');
    expect(p.items).toEqual(['I00K', 'I00J']);
    const gold = p.gold;
    moveTo(m, 'SouthReward');
    expect(p.items).toEqual(['I00K']);
    expect(p.gold - gold).toBeGreaterThanOrEqual(400);
    expect(p.reputation).toBe(1);
  });

  it('contracts need reputation', () => {
    const m = createMatch(data, { players: [2], mode: 'traders' });
    sail(m, 'H00D', 'SouthReward');
    m.issue({ kind: 'buyItem', player: 2, itemId: 'I00W' });
    m.step();
    expect(m.events.find((e) => e.kind === 'denied')).toMatchObject({ reason: '需要 10 点声望' });
  });

  it('two flags win the neutral port for a side', () => {
    const m = createMatch(data, { players: [2], mode: 'traders' });
    const p = m.players.get(2)!;
    p.reputation = 20;
    sail(m, 'H000', 'SouthReward');
    for (let i = 0; i < 2; i++) {
      moveTo(m, 'SouthReward');
      m.issue({ kind: 'buyItem', player: 2, itemId: 'I02T' });
      m.step();
      moveTo(m, '_______33333333');
    }
    expect(m.flags).toBe(-2);
    expect(m.shops.find((s) => s.unitId === 'n005')!.owner).toBe(0);
  });

  it('the suicide attack blows a hole in the enemy base', () => {
    const m = createMatch(data, { players: [2], mode: 'traders' });
    const p = m.players.get(2)!;
    p.reputation = 10;
    sail(m, 'H001', 'SouthReward');
    m.issue({ kind: 'buyItem', player: 2, itemId: 'I01E' });
    m.step();
    moveTo(m, 'GoblinShop');
    moveTo(m, 'SouthReward');
    expect(p.items).toContain('I01G');
    const base = m.structureByHandle('gg_unit_n000_0018')!;
    const hp = base.hp;
    moveTo(m, 'North_Main');
    expect(hp - base.hp).toBeGreaterThan(990);
    expect(p.shipId).toBeUndefined();
  });
});

describe('weather', () => {
  it('changes now and then', () => {
    const m = createMatch(data, { players: [2] });
    const seen = new Set<string>();
    for (let i = 0; i < 1500 * TICK_RATE; i += TICK_RATE) {
      run(m, 1);
      seen.add(m.weather);
    }
    expect(seen.size).toBeGreaterThan(2);
  }, 120_000);
});

describe('surrender', () => {
  it('the main base falls five seconds after a side gives up', () => {
    const m = createMatch(data, { players: [2, 7] });
    m.issue({ kind: 'surrender', player: 2 });
    run(m, 4);
    expect(m.winner).toBeUndefined();
    run(m, 1.2);
    expect(m.winner).toBe('north');
  });
});
