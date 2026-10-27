// Fog of war and the day/night cycle.
import { describe, expect, it } from 'vitest';
import { createMatch, isNight, TICK_RATE, timeOfDay } from '../src/index.ts';
import { data } from './world.test.ts';

/** A sailable spot at least `clear` from every southern unit, with open water to the east. */
function lonelySpot(m: ReturnType<typeof createMatch>, clear = 3500) {
  const south = [...m.world.allUnits()].filter((u) => u.team === 'south');
  for (let x = -8000; x < 5000; x += 250) for (let y = -6000; y < 6000; y += 250) {
    if (!m.world.grid.isSailable(x, y, 30) || !m.world.grid.isSailable(x + 1000, y, 30) || !m.world.grid.isSailable(x + 2600, y, 30)) continue;
    if (south.every((u) => Math.hypot(u.x - x, u.y - y) > clear)) return { x, y };
  }
  throw new Error('no lonely spot');
}

describe('fog of war', () => {
  it('hides enemies beyond sight and keeps them out of reach', () => {
    const m = createMatch(data, { players: [2, 7] });
    const me = m.world.ships.get(m.players.get(2)!.shipId!)!;
    const spot = lonelySpot(m);
    me.x = me.prevX = spot.x; me.y = me.prevY = spot.y;
    const near = m.world.spawnShip('h00I', 13, spot.x + 600, spot.y);
    const far = m.world.spawnShip('h00I', 13, spot.x + 2600, spot.y);
    m.step(); m.step(); m.step(); m.step();
    expect(m.world.visibleTo('south', near)).toBe(true);
    expect(m.world.visibleTo('south', far)).toBe(false);
    // A unit-target skill cannot pick a fogged ship.
    m.world.abilities.learn(me, 'A01Y');
    expect(m.world.abilities.cast(me, 'A01Y', { unitId: far.id })).toBe('看不到这个目标');
  });

  it('each side always sees its own harbour, not the other one', () => {
    const m = createMatch(data, { players: [2] });
    const south = m.rectCenter('South_Harbour'), north = m.rectCenter('North_Harbour');
    m.step();
    expect(m.world.vision.sees('south', south.x, south.y)).toBe(true);
    expect(m.world.vision.sees('north', north.x, north.y)).toBe(true);
    expect(m.world.vision.sees('south', north.x, north.y)).toBe(false);
  });

  it('night shortens sight', () => {
    const m = createMatch(data, { players: [2, 7] });
    const me = m.world.ships.get(m.players.get(2)!.shipId!)!;
    const spot = lonelySpot(m);
    const at = (dx: number) => m.world.spawnShip('h00I', 13, spot.x + dx, spot.y);
    me.x = me.prevX = spot.x; me.y = me.prevY = spot.y;
    const edge = at(1000); // inside the sailor's 1100 day sight, outside its 800 night sight
    for (let i = 0; i < 4; i++) m.step();
    expect(isNight(m.world.tick)).toBe(false);
    expect(m.world.visibleTo('south', edge)).toBe(true);
    // Dusk comes at 18:00, 80 s after the noon start.
    while (!isNight(m.world.tick)) { m.step(); me.x = spot.x; me.y = spot.y; edge.x = spot.x + 1000; edge.y = spot.y; }
    for (let i = 0; i < 4; i++) { m.step(); me.x = spot.x; me.y = spot.y; edge.x = spot.x + 1000; edge.y = spot.y; }
    expect(m.world.visibleTo('south', edge)).toBe(false);
  });

  it('the clock starts at noon and turns a full day in 320 s', () => {
    expect(timeOfDay(0)).toBe(12);
    expect(timeOfDay(80 * TICK_RATE)).toBeCloseTo(18);
    expect(timeOfDay(320 * TICK_RATE)).toBeCloseTo(12);
  });

  it('can be switched off', () => {
    const m = createMatch(data, { players: [2], fog: false });
    const far = m.world.spawnShip('h00I', 13, 3000, 3000);
    m.step();
    expect(m.world.visibleTo('south', far)).toBe(true);
  });
});
