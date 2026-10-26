// Guards the extracted data against regressions, using the hand-checked tables in data/*.csv.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Ability, MapInfo, PathingInfo, Ship, Weapon } from '../src/index.ts';

const generated = (name: string) => fileURLToPath(new URL(`../generated/${name}`, import.meta.url));
const load = <T>(name: string): T => JSON.parse(readFileSync(generated(name), 'utf8')) as T;
const csv = (name: string) => {
  const [header, ...rows] = readFileSync(fileURLToPath(new URL(`../../../data/${name}`, import.meta.url)), 'utf8')
    .replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(','));
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])));
};

const ships = load<Ship[]>('ships.json');
const weapons = load<Weapon[]>('weapons.json');
const abilities = new Map(load<Ability[]>('abilities.json').map((a) => [a.id, a]));

describe('ships', () => {
  it('match data/ships.csv', () => {
    const rows = csv('ships.csv');
    expect(ships.map((s) => s.id).sort()).toEqual(rows.map((r) => r.id).sort());
    for (const r of rows) {
      const s = ships.find((x) => x.id === r.id)!;
      expect({ id: s.id, price: s.price, hp: s.hp, speed: s.speed / 10, size: s.size })
        .toEqual({ id: r.id, price: Number(r['价格']), hp: Number(r['耐久']), speed: Number(r['航速(节)']), size: r['尺寸'] });
    }
  });

  it('reference existing skills, with levels 5+ filled in', () => {
    for (const s of ships) for (const id of s.skills) expect(abilities.has(id), `${s.name} → ${id}`).toBe(true);
    const cannon = abilities.get('A01Y')!;
    expect(cannon.levels.map((l) => l.data.A)).toEqual([50, 100, 150, 200, 250, 300, 350, 400]);
  });
});

describe('weapons', () => {
  it('cover every weapon in data/weapons.csv with the same stats', () => {
    for (const r of csv('weapons.csv')) {
      const w = weapons.find((x) => x.id === r.id);
      expect(w, r.id).toBeDefined();
      expect([w!.range, w!.cooldown]).toEqual([Number(r['射程']), Number(r['间隔(秒)'])]);
    }
  });
});

describe('map', () => {
  it('has both bases, four shipyards and a full pathing grid', () => {
    const map = load<MapInfo>('map.json');
    expect(map.placements.filter((p) => p.id === 'n000')).toHaveLength(2);
    expect(map.placements.filter((p) => p.id === 'n003')).toHaveLength(4);
    const pathing = load<PathingInfo>('pathing.json');
    expect(readFileSync(generated('pathing.bin')).length).toBe(pathing.width * pathing.height);
  });
});
