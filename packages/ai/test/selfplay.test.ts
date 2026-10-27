import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMatch, TICK_RATE, xpForLevel, type GameData } from '@boom/sim';
import { Bot } from '../src/index.ts';

const gen = (name: string) => fileURLToPath(new URL(`../../gamedata/generated/${name}`, import.meta.url));
const json = (name: string) => JSON.parse(readFileSync(gen(name), 'utf8'));
export const data: GameData = {
  ships: json('ships.json'), units: json('units.json'), weapons: json('weapons.json'), items: json('items.json'),
  abilities: json('abilities.json'), misc: json('misc.json'), map: json('map.json'), terrain: json('terrain.json'),
  pathingInfo: json('pathing.json'), pathingCells: new Uint8Array(readFileSync(gen('pathing.bin'))),
};

export function playBots(minutes: number, seed: number, log = false) {
  const players = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const m = createMatch(data, { players, seed });
  const bots = players.map((p) => new Bot(m, p));
  const structuresLost = { south: 0, north: 0 };
  for (let i = 1; i <= minutes * 60 * TICK_RATE && !m.winner; i++) {
    for (const b of bots) b.update();
    m.step();
    for (const e of m.events) if (e.kind === 'death' && m.world.unitType(e.typeId)?.isBuilding) structuresLost[e.owner === 0 ? 'south' : 'north']++;
    if (log && i % (5 * 60 * TICK_RATE) === 0) {
      const row = players.map((p) => { const s = m.players.get(p)!; return `${p}:${s.shipTypeId} L${s.hero.level} ${s.kills}/${s.deaths} ${s.items.length}i`; });
      console.log(`${i / TICK_RATE / 60} min`, row.join(' | '), 'structures lost', JSON.stringify(structuresLost));
    }
  }
  return { m, structuresLost };
}

describe('self-play', () => {
  it('every ship type learns and casts its skills in a bot fight without errors', () => {
    const types = data.ships.map((s) => s.id);
    const players = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    let casts = 0;
    const cast = new Set<string>();
    for (let round = 0; round * players.length < types.length; round++) {
      const m = createMatch(data, { players, seed: round + 1 });
      players.forEach((p, i) => {
        const state = m.players.get(p)!;
        const old = m.world.ships.get(state.shipId!);
        state.shipTypeId = types[(round * players.length + i) % types.length]!;
        state.hero.xp = xpForLevel(12);
        state.hero.level = 12;
        // Swap the starting ship for the assigned type at the same spot.
        if (old) {
          m.world.remove(old.id);
          const ship = m.world.spawnShip(state.shipTypeId, p, old.x, old.y, old.facing);
          ship.hero = state.hero;
          state.shipId = ship.id;
        }
      });
      const bots = players.map((p) => new Bot(m, p));
      for (let i = 0; i < 4 * 60 * TICK_RATE && !m.winner; i++) {
        for (const b of bots) b.update();
        m.step();
        for (const e of m.events) if (e.kind === 'cast') { casts++; cast.add(e.abilityId); }
      }
    }
    expect(casts).toBeGreaterThan(30);
    expect(cast.size).toBeGreaterThan(15);
  }, 240_000);

  it('ten bots shop, level, fight and make progress', () => {
    const { m } = playBots(12, 11, true);
    const humans = [...m.players.values()].filter((p) => p.index >= 2);
    expect(humans.every((p) => p.items.length >= 2)).toBe(true);
    expect(humans.some((p) => p.shipTypeId !== 'H000')).toBe(true);
    expect(humans.reduce((s, p) => s + p.kills, 0)).toBeGreaterThan(0);
    expect(humans.every((p) => p.hero.level >= 3)).toBe(true);
  }, 120_000);
});
