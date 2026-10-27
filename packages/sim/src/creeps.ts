// Neutral creep camps and the boss (§8, Shua_YeGuai / Shua_YeGuai5 / Shua_YeGuai6 / BossTime in
// war3map.j). Six camps refill on their own timers and get stronger units as their wave count
// rises; the boss point holds one of three bosses, back 600 s after it dies. Creeps guard their
// spot, chase what comes close, and give up past a leash.
import { distance, type Vec2 } from './math.ts';
import { TICK_RATE, type UnitEntity, type World } from './world.ts';

/** Player(PLAYER_NEUTRAL_AGGRESSIVE). */
export const CREEP_OWNER = 12;
export const BOSSES = ['nbzd', 'ntrd', 'n016'] as const;
const BOSS_RESPAWN = 600;
/** Creeps notice ships this close and give up the chase this far from home. */
const ACQUIRE = 700;
const LEASH = 1100;

export interface Rect { minX: number; minY: number; maxX: number; maxY: number }

interface Camp {
  /** Rect the camp counts units in, and the smaller one it spawns in. */
  area: string;
  spawn: string;
  every: number;
  /** When it refills: below six units, cleared (no ships, fewer than two creeps), or a ship sails in. */
  rule: 'fill' | 'cleared' | 'enter';
  wave: number;
  next: number;
  /** Unit types to add for this wave, given how many creeps are in the camp now. */
  units(wave: number, count: number, pick: (a: string, b: string) => string): string[];
}

const pair = (pick: (a: string, b: string) => string, a: string, b: string) => [pick(a, b)];

function camps(): Camp[] {
  return [
    { area: 'YeGuai_1', spawn: 'YeGuai_1B', every: 41, rule: 'fill', wave: 0, next: 41, units: (w, n, pick) => [
      ...(w < 37 ? pair(pick, 'ndrm', 'ndrp') : pair(pick, 'ndrh', 'ndrw')),
      ...(n + 1 >= 6 && w > 50 ? ['ndrs', ...(w > 60 ? ['ndrd'] : [])] : []),
    ] },
    { area: 'YeGuai_2', spawn: 'YeGuai_2B', every: 41, rule: 'fill', wave: 0, next: 43, units: (w, n, pick) => [
      ...(w < 37 ? pair(pick, 'nmbg', 'nmtw') : pair(pick, 'nmsn', 'nmrr')),
      ...(n + 1 >= 6 && w > 50 ? ['nmsc'] : []),
    ] },
    { area: 'YeGuai_3', spawn: 'YeGuai_3B', every: 99, rule: 'cleared', wave: 0, next: 99, units: (w) => [
      ...(w < 6 ? ['nsel', 'nsel', 'nsel', 'nsel', 'nmyr', 'nmyr'] : ['ntrt', 'ntrt', 'ntrt', 'ntrt', 'ndrv', 'ndrv']),
      ...(w > 8 ? ['nsgb'] : []),
    ] },
    { area: 'YeGuai_4', spawn: 'YeGuai_4B', every: 99, rule: 'cleared', wave: 0, next: 100, units: (w) =>
      w < 6 ? ['ntka', 'ntka', 'ntka', 'ntka', 'ntkf', 'ntkf'] : ['nwns', 'nwns', 'nwns', 'nwns', 'nwna', 'nwna'] },
    { area: 'YeGuai_5', spawn: 'YeGuai_5B', every: 123, rule: 'enter', wave: 0, next: 0, units: (w) => [
      ...(w < 6 ? ['nsnp', 'nsc3', 'nsc3', 'nlkl', 'nlkl'] : ['nslv', 'nnrg', 'nnrg']),
      ...(w > 8 ? ['nahy'] : []),
    ] },
    { area: 'YeGuai_6', spawn: 'YeGuai_6B', every: 41, rule: 'fill', wave: 0, next: 42, units: (_w, _n, pick) => pair(pick, 'nahy', 'nnrg') },
  ];
}

interface Creep { unitId: number; home: Vec2; returning: boolean }

export class Creeps {
  private readonly world: World;
  private readonly rects: Map<string, Rect>;
  readonly camps = camps();
  private readonly creeps = new Map<number, Creep>();
  bossId: number | undefined;
  /** Tick from which the boss may spawn again. */
  private bossReadyAt = 99 * TICK_RATE;

  constructor(world: World, rects: Map<string, Rect>) {
    this.world = world;
    this.rects = rects;
  }

  private inRect(u: Vec2, name: string): boolean {
    const r = this.rects.get(name);
    return !!r && u.x >= r.minX && u.x <= r.maxX && u.y >= r.minY && u.y <= r.maxY;
  }

  private count(area: string, creeps: boolean): number {
    let n = 0;
    for (const u of this.world.allUnits()) {
      if (u.hp <= 0 || !this.inRect(u, area)) continue;
      if (creeps ? u.owner === CREEP_OWNER : u.team !== 'neutral') n++;
    }
    return n;
  }

  private spawn(typeId: string, rectName: string, center = false): UnitEntity | undefined {
    const r = this.rects.get(rectName);
    if (!r || !this.world.unitType(typeId)) return undefined;
    const x = center ? (r.minX + r.maxX) / 2 : r.minX + this.world.random() * (r.maxX - r.minX);
    const y = center ? (r.minY + r.maxY) / 2 : r.minY + this.world.random() * (r.maxY - r.minY);
    // Creeps stand on islands as well as in the water; keep them where the map puts them.
    const u = this.world.spawnShip(typeId, CREEP_OWNER, x, y, this.world.random() * Math.PI * 2);
    // Creeps on an island cannot reach ships; they guard and shoot from the shore (and a
    // path search to an unreachable ship would scan the whole grid).
    if (!this.world.grid.isSailable(x, y, u.pathRadius)) u.maxSpeed = 0;
    this.creeps.set(u.id, { unitId: u.id, home: { x, y }, returning: false });
    return u;
  }

  tick(): void {
    const tick = this.world.tick;
    if (tick % TICK_RATE === 0) {
      const seconds = tick / TICK_RATE;
      const pick = (a: string, b: string) => (this.world.random() < 0.5 ? a : b);
      for (const camp of this.camps) {
        if (seconds < camp.next) continue;
        if (camp.rule === 'enter') {
          if (this.count(camp.area, false) === 0) continue;
        } else if (camp.rule === 'cleared') {
          camp.next = seconds + camp.every;
          if (this.count(camp.area, false) > 0 || this.count(camp.area, true) >= 2) continue;
        } else {
          camp.next = seconds + camp.every;
          if (this.count(camp.area, true) >= 6) continue;
        }
        camp.wave++;
        const n = this.count(camp.area, true);
        for (const typeId of camp.units(camp.wave, n, pick)) this.spawn(typeId, camp.spawn);
        if (camp.rule === 'enter') camp.next = seconds + camp.every;
      }
      // The boss shares the 99 s check with camps 3 and 4.
      if (this.bossId === undefined && tick >= this.bossReadyAt && seconds % 99 === 0 && this.count('YeGuai_6', false) === 0) {
        const boss = this.spawn(BOSSES[Math.floor(this.world.random() * BOSSES.length)]!, 'YeGuai_BOSS', true);
        this.bossId = boss?.id;
      }
    }
    if (tick % 10 === 0) this.think();
  }

  /** Guard, chase within the leash, then sail home healed. */
  private think(): void {
    for (const [id, c] of this.creeps) {
      const u = this.world.unit(id);
      if (!u) { this.creeps.delete(id); continue; }
      const fromHome = distance(u, c.home);
      if (c.returning) {
        if (fromHome < 120) { c.returning = false; u.order = { kind: 'idle' }; u.path = []; }
        continue;
      }
      if (fromHome > LEASH) {
        c.returning = true;
        u.targetId = undefined;
        u.order = { kind: 'move' };
        u.path = this.world.grid.findPath(u, c.home, u.pathRadius) ?? [];
        u.hp = u.maxHp; // creeps heal fully when they give up, like Warcraft's return-to-camp
        continue;
      }
      if (u.maxSpeed <= 0 || (u.order.kind === 'attackMove' && u.targetId !== undefined)) continue;
      let best: UnitEntity | undefined, bestD = ACQUIRE;
      for (const e of this.world.allUnits()) {
        if (e.team === 'neutral' || e.hp <= 0 || e.kind === 'structure' || !this.world.visibleTo(u.team, e)) continue;
        const d = distance(u, e);
        if (d < bestD) { best = e; bestD = d; }
      }
      if (best) this.world.attackMove(u, [{ x: best.x, y: best.y }]);
      else if (u.order.kind === 'attackMove') { u.order = { kind: 'idle' }; u.path = []; }
    }
  }

  isCreep(u: UnitEntity): boolean {
    return u.owner === CREEP_OWNER;
  }

  /** Bookkeeping for a dead creep; returns true when it was the boss. */
  onDeath(u: UnitEntity): boolean {
    this.creeps.delete(u.id);
    if (u.id !== this.bossId) return false;
    this.bossId = undefined;
    this.bossReadyAt = this.world.tick + BOSS_RESPAWN * TICK_RATE;
    return true;
  }
}
