// Fog of war and the day/night cycle. Each side sees what its ships and buildings see (day or
// night sight radius from the unit data) plus its harbour, which the map keeps visible for it
// (CreateFogModifierRectBJ on South_Harbour / North_Harbour). The grid is coarse (128 units, a
// terrain tile) and refreshed a few times a second.
import type { Rect } from './creeps.ts';
import { TICK_RATE } from './world.ts';

/** World units per vision cell. */
export const VISION_CELL = 128;
const CELL = VISION_CELL;
/** Ticks between vision refreshes. */
const REFRESH = 4;
/** The map starts at noon (SetTimeOfDay 12) and runs the clock at 150%: a day lasts 320 s. */
const START_HOUR = 12;
const DAY_SECONDS = 480 / 1.5;

export type SideTeam = 'south' | 'north';

/** Hour of the day (0–24) at a tick. */
export function timeOfDay(tick: number): number {
  return (START_HOUR + (tick / TICK_RATE / DAY_SECONDS) * 24) % 24;
}

export function isNight(tick: number): boolean {
  const h = timeOfDay(tick);
  return h < 6 || h >= 18;
}

export interface Viewer { team: string; x: number; y: number; hp: number; sight: number }

export class Vision {
  /** Off: everything is visible (tests and sandbox play). */
  enabled = true;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  private readonly seen: Record<SideTeam, Uint8Array>;
  private readonly always: Record<SideTeam, Rect[]> = { south: [], north: [] };
  /** Bumped on every refresh, so renderers can tell when to re-upload. */
  version = 0;

  constructor(bounds: Rect) {
    this.originX = bounds.minX;
    this.originY = bounds.minY;
    this.width = Math.ceil((bounds.maxX - bounds.minX) / CELL) + 1;
    this.height = Math.ceil((bounds.maxY - bounds.minY) / CELL) + 1;
    this.seen = { south: new Uint8Array(this.width * this.height), north: new Uint8Array(this.width * this.height) };
  }

  /** A rect the side always sees (its harbour). */
  addAlwaysVisible(team: SideTeam, rect: Rect): void {
    this.always[team].push(rect);
  }

  /** The side's visibility grid (1 = seen), row-major from the map's south-west corner. */
  grid(team: SideTeam): Uint8Array {
    return this.seen[team];
  }

  sees(team: string, x: number, y: number): boolean {
    if (!this.enabled || (team !== 'south' && team !== 'north')) return true;
    const i = Math.floor((x - this.originX) / CELL), j = Math.floor((y - this.originY) / CELL);
    if (i < 0 || j < 0 || i >= this.width || j >= this.height) return false;
    return this.seen[team][j * this.width + i] === 1;
  }

  update(tick: number, viewers: Iterable<Viewer>, force = false): void {
    if (!this.enabled || (!force && tick % REFRESH !== 0)) return;
    for (const team of ['south', 'north'] as const) {
      const g = this.seen[team];
      g.fill(0);
      for (const r of this.always[team]) this.fillRect(g, r);
    }
    for (const v of viewers) {
      if (v.hp <= 0 || (v.team !== 'south' && v.team !== 'north') || v.sight <= 0) continue;
      this.fillCircle(this.seen[v.team], v.x, v.y, v.sight);
    }
    this.version++;
  }

  private fillRect(g: Uint8Array, r: Rect): void {
    const i0 = Math.max(0, Math.floor((r.minX - this.originX) / CELL)), i1 = Math.min(this.width - 1, Math.floor((r.maxX - this.originX) / CELL));
    const j0 = Math.max(0, Math.floor((r.minY - this.originY) / CELL)), j1 = Math.min(this.height - 1, Math.floor((r.maxY - this.originY) / CELL));
    for (let j = j0; j <= j1; j++) g.fill(1, j * this.width + i0, j * this.width + i1 + 1);
  }

  private fillCircle(g: Uint8Array, x: number, y: number, radius: number): void {
    const ci = (x - this.originX) / CELL, cj = (y - this.originY) / CELL, r = radius / CELL;
    const j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(this.height - 1, Math.ceil(cj + r));
    for (let j = j0; j <= j1; j++) {
      const dy = j + 0.5 - cj;
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      const i0 = Math.max(0, Math.floor(ci - half)), i1 = Math.min(this.width - 1, Math.floor(ci + half));
      if (i1 >= i0) g.fill(1, j * this.width + i0, j * this.width + i1 + 1);
    }
  }
}
