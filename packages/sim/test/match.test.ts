import { describe, expect, it } from 'vitest';
import { createMatch, DamageTable, TICK_RATE, type Match } from '../src/index.ts';
import { data } from './world.test.ts';

const run = (m: Match, seconds: number) => { for (let i = 0; i < seconds * TICK_RATE; i++) m.step(); };
const npcCount = (m: Match) => [...m.world.ships.values()].filter((s) => s.owner === 0 || s.owner === 1).length;

describe('damage', () => {
  it('uses the map overrides and Warcraft armor reduction', () => {
    const t = new DamageTable(data.misc);
    expect(t.multiplier('pierce', 'fort')).toBeCloseTo(0.35);
    expect(t.multiplier('pierce', 'small')).toBe(1); // the map flattened pierce
    expect(t.damage(100, 'chaos', 'large', 10)).toBeCloseTo(100 * (1 - 0.6 / 1.6));
  });
});

describe('match', () => {
  it('places both sides and opens with a wave on every lane', () => {
    const m = createMatch(data, { players: [2, 7] });
    expect(m.structureByHandle('gg_unit_n000_0020')?.typeId).toBe('n000');
    expect([...m.world.structures.values()].filter((s) => s.typeId === 'n003')).toHaveLength(4);
    m.step();
    expect(npcCount(m)).toBe(6 * 4); // six rowboats from each of four shipyards
  });

  it('lets the fleets meet in the middle and kill each other, paying the fleet accounts', () => {
    const m = createMatch(data, { players: [], seed: 7 });
    let deaths = 0;
    for (let i = 0; i < 90 * TICK_RATE; i++) {
      m.step();
      deaths += m.events.filter((e) => e.kind === 'death').length;
    }
    expect(deaths).toBeGreaterThan(5);
    expect(m.players.get(0)!.gold + m.players.get(1)!.gold).toBeGreaterThan(0);
  });

  it('pays a ship kill by price tier and respawns the victim', () => {
    const m = createMatch(data, { players: [2, 7] });
    const victim = m.world.ships.get(m.players.get(2)!.shipId!)!;
    m.world.dealDamage(victim, 99999, 'chaos', 7, -1);
    m.step();
    expect(m.players.get(7)!.gold).toBe(400 + 150);
    expect(m.players.get(2)!.shipId).toBeUndefined();
    run(m, 11);
    expect(m.players.get(2)!.shipId).toBeDefined();
  });

  it('pays salary every 7 seconds', () => {
    const m = createMatch(data, { players: [2, 3, 7] });
    run(m, 7.05);
    expect(m.players.get(2)!.gold).toBe(400 + 60); // fast mode: 120 split between two southern players, first at 7 s
  });

  it('sells ships and weapons only near the right shops', () => {
    const m = createMatch(data, { players: [2] });
    const p = m.players.get(2)!;
    p.gold = 5000;
    m.issue({ kind: 'buyItem', player: 2, itemId: 'I004' }); // 护卫舰炮 at the weapon shop
    m.issue({ kind: 'buyShip', player: 2, typeId: 'H001' }); // 圣战者 at the main base
    m.step();
    expect(p.items).toEqual(['I004']);
    expect(p.shipTypeId).toBe('H001');
    expect(p.gold).toBe(5000 - 430 - 500 + 120);
    const ship = m.world.ships.get(p.shipId!)!;
    expect(ship.weapons).toHaveLength(1);
    m.issue({ kind: 'buyShip', player: 2, typeId: 'H01B' }); // 飞鱼 is only sold at Alexandria
    m.step();
    expect(m.events.some((e) => e.kind === 'denied')).toBe(true);
  });

  it('ends when a main base falls', () => {
    const m = createMatch(data, { players: [2, 7] });
    m.world.dealDamage(m.structureByHandle('gg_unit_n000_0018')!, 1e6, 'chaos', 2, -1);
    m.step();
    expect(m.winner).toBe('south');
  });
});

describe('hiring', () => {
  it('turns a shipyard purchase into a fleet ship heading for the enemy base', () => {
    const m = createMatch(data, { players: [2] });
    const p = m.players.get(2)!;
    p.gold = 1000;
    const before = npcCount(m);
    m.issue({ kind: 'buyShip', player: 2, typeId: 'h00F' }); // 海军护卫舰 (II型) at the shipyard
    m.step();
    expect(p.shipTypeId).toBe('H000');
    expect(p.gold).toBe(1000 - 120);
    const hired = [...m.world.ships.values()].find((s) => s.typeId === 'h00F' && s.owner === 0);
    expect(hired?.order.kind).toBe('attackMove');
    expect(npcCount(m)).toBeGreaterThan(before);
  });
});
