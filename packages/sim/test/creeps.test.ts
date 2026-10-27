// §8 neutral creep camps and the boss.
import { describe, expect, it } from 'vitest';
import { BOSSES, CREEP_OWNER, createMatch, TICK_RATE, type Match } from '../src/index.ts';
import { data } from './world.test.ts';

const run = (m: Match, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) m.step(); };
const creeps = (m: Match) => [...m.world.ships.values()].filter((u) => u.owner === CREEP_OWNER);

describe('creep camps', () => {
  it('camps fill on their timers and stop at six', () => {
    const m = createMatch(data, { players: [2] });
    run(m, 40);
    expect(creeps(m).length).toBe(0);
    run(m, 5);
    expect(creeps(m).some((u) => ['ndrm', 'ndrp'].includes(u.typeId))).toBe(true);
    run(m, 41 * 8);
    const camp1 = creeps(m).filter((u) => ['ndrm', 'ndrp', 'ndrh', 'ndrw', 'ndrs', 'ndrd'].includes(u.typeId));
    expect(camp1.length).toBeLessThanOrEqual(6);
    // Camps 3 and 4 spawn six at once when cleared.
    expect(creeps(m).filter((u) => u.typeId === 'nsel').length).toBe(4);
  }, 60_000);

  it('sinking creeps pays their bounty', () => {
    const m = createMatch(data, { players: [2] });
    run(m, 45);
    const c = creeps(m)[0]!;
    const p = m.players.get(2)!;
    const gold = p.gold;
    m.world.dealDamage(c, 1e6, 'pure', 2, p.shipId!);
    m.step();
    expect(p.gold).toBeGreaterThan(gold);
  });

  it('a creep chases a ship that comes close and gives up past its leash', () => {
    const m = createMatch(data, { players: [2] });
    run(m, 100);
    const c = creeps(m).find((u) => u.maxSpeed > 0 && m.world.grid.isSailable(u.x, u.y, u.pathRadius))!;
    expect(c).toBeDefined();
    const p = m.players.get(2)!;
    const ship = m.world.ships.get(p.shipId!)!;
    const spot = m.world.grid.nearestSailable(c.x + 400, c.y, ship.pathRadius)!;
    ship.x = ship.prevX = spot.x; ship.y = ship.prevY = spot.y;
    ship.invulnerable = true;
    run(m, 1);
    expect(c.order.kind).toBe('attackMove');
    ship.x = ship.prevX = c.x + 3000; // far away: the creep turns back once past its leash
    c.x = c.prevX = c.x + 1300;
    run(m, 1);
    expect(c.order.kind).toBe('move');
  });

  it('the boss appears, pays its killer in max HP and calls the goblin merchant', () => {
    const m = createMatch(data, { players: [2] });
    run(m, 100);
    const boss = creeps(m).find((u) => (BOSSES as readonly string[]).includes(u.typeId))!;
    expect(boss).toBeDefined();
    expect(m.creeps.bossId).toBe(boss.id);
    const p = m.players.get(2)!;
    const ship = m.world.ships.get(p.shipId!)!;
    const hp = ship.maxHp;
    m.world.dealDamage(boss, 1e6, 'pure', 2, ship.id);
    m.step();
    expect(m.events.some((e) => e.kind === 'boss' && e.killed)).toBe(true);
    expect(ship.maxHp).toBe(hp + 300);
    const goblin = m.shops.find((s) => s.unitId === 'h01T' && s.entityId !== undefined);
    expect(goblin?.sellsItems.some((i) => i === 'I05W' || i === 'I05X')).toBe(true);
    run(m, 66);
    expect(m.shops.some((s) => s === goblin)).toBe(false);
    // Back 600 s after it died, on the next 99 s check (t = 792 s).
    run(m, 520);
    expect(m.creeps.bossId).toBeUndefined();
    run(m, 110);
    expect(m.creeps.bossId).toBeDefined();
  }, 60_000);

  it('being sunk by creeps costs gold', () => {
    const m = createMatch(data, { players: [2] });
    run(m, 45);
    const c = creeps(m)[0]!;
    const p = m.players.get(2)!;
    p.gold = 1000;
    m.world.dealDamage(m.world.ships.get(p.shipId!)!, 1e6, 'pure', CREEP_OWNER, c.id);
    m.step();
    expect(p.gold).toBe(1000 - Math.floor(50 + 200 / 30 + 6));
  });
});
