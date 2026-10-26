import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWorld, distance, formationTargets, TICK_RATE, type GameData } from '../src/index.ts';

const gen = (name: string) => fileURLToPath(new URL(`../../gamedata/generated/${name}`, import.meta.url));
const json = (name: string) => JSON.parse(readFileSync(gen(name), 'utf8'));
const data: GameData = {
  ships: json('ships.json'),
  units: json('units.json'),
  map: json('map.json'),
  terrain: json('terrain.json'),
  pathingInfo: json('pathing.json'),
  pathingCells: new Uint8Array(readFileSync(gen('pathing.bin'))),
};
const southStart = data.map.players.find((p) => p.index === 2)!;
const northStart = data.map.players.find((p) => p.index === 7)!;

describe('pathing', () => {
  const world = createWorld(data);

  it('finds a sea route from the south harbour to the north harbour for the biggest hull', () => {
    const from = world.grid.nearestSailable(southStart.startX!, southStart.startY!, 17)!;
    const path = world.grid.findPath(from, { x: northStart.startX!, y: northStart.startY! }, 17);
    expect(path).toBeDefined();
    expect(path!.length).toBeGreaterThan(1);
    for (const p of path!) expect(world.grid.isSailable(p.x, p.y, 17)).toBe(true);
  });

  it('treats dry land as blocked', () => {
    // The north-west farm sits on an island.
    const farm = data.map.placements.find((p) => p.id === 'n00C')!;
    expect(world.grid.isSailable(farm.x, farm.y, 5)).toBe(false);
  });
});

describe('ship movement', () => {
  it('sails to a move target and stops there', () => {
    const world = createWorld(data);
    const start = world.grid.nearestSailable(southStart.startX!, southStart.startY!, 5)!;
    const ship = world.spawnShip('H000', 2, start.x, start.y);
    const target = world.grid.nearestSailable(start.x + 600, start.y + 1500, 5)!;
    world.issue({ kind: 'move', unitIds: [ship.id], x: target.x, y: target.y });
    for (let i = 0; i < TICK_RATE * 30 && (ship.path.length > 0 || i === 0); i++) world.step();
    expect(ship.path).toEqual([]);
    expect(distance(ship, target)).toBeLessThan(40);
  });

  it('turns slowly for heavy hulls', () => {
    const world = createWorld(data);
    const start = world.grid.nearestSailable(southStart.startX!, southStart.startY!, 15)!;
    const lord = world.spawnShip('H008', 2, start.x, start.y, 0);
    world.issue({ kind: 'move', unitIds: [lord.id], x: start.x - 1000, y: start.y });
    for (let i = 0; i < TICK_RATE; i++) world.step();
    // 0.25 turn rate → π/2 rad/s, so after one second it has turned about 90°, not 180°.
    expect(Math.abs(lord.facing)).toBeGreaterThan(1.4);
    expect(Math.abs(lord.facing)).toBeLessThan(1.8);
  });
});

describe('group orders', () => {
  it('spread destinations so a fleet does not pile onto one point', () => {
    const world = createWorld(data);
    const start = world.grid.nearestSailable(southStart.startX!, southStart.startY!, 17)!;
    const ships = ['H000', 'H003', 'H008', 'H011'].map((t, i) => world.spawnShip(t, 2, start.x + i * 200, start.y));
    const targets = formationTargets(ships, { x: 0, y: 0 });
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        expect(distance(targets[i]!, targets[j]!)).toBeGreaterThanOrEqual(ships[i]!.bodyRadius + ships[j]!.bodyRadius);
      }
    }
  });
});
