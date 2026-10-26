// Fixed-tick simulation of ships on the sea plane. Pure TypeScript with no rendering
// dependencies, so it also runs headless (tests, AI self-play, a future server).
import type { Ship } from '@boom/gamedata';
import { distance, turnToward, wrapAngle, type Vec2 } from './math.ts';
import type { PathGrid } from './pathing.ts';

export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

// Handling constants. These are tuned for feel, not taken from the map: Warcraft III
// turns units almost instantly, which reads wrong for ships.
/** Turn speed in rad/s per point of the unit's turnRate (领主 0.25 → 180° in 2 s). */
export const TURN_RATE_SCALE = 2 * Math.PI;
/** Seconds to reach full speed from a standstill. */
export const ACCELERATION_TIME = 0.8;
/** Ships keep at least this fraction of top speed while turning hard. */
export const MIN_TURNING_SPEED = 0.2;
/** Distance at which an intermediate waypoint counts as reached. */
export const WAYPOINT_RADIUS = 64;

/** Radius used to keep hulls apart, by the shop's size label. Pathing uses the smaller unit collision. */
const BODY_RADIUS: Record<string, number> = { 小型: 40, 中型: 55, 大型: 70, 大: 70, 巨大: 85 };

export interface ShipEntity {
  id: number;
  typeId: string;
  owner: number;
  x: number;
  y: number;
  /** Radians, 0 = +x (east), counter-clockwise, like Warcraft facing. */
  facing: number;
  speed: number;
  maxSpeed: number;
  turnSpeed: number;
  /** Collision radius from the map data, used against terrain. */
  pathRadius: number;
  /** Larger radius used between ships. */
  bodyRadius: number;
  path: Vec2[];
  /** State at the start of the current tick, for render interpolation. */
  prevX: number;
  prevY: number;
  prevFacing: number;
}

export type Command =
  | { kind: 'move'; unitIds: number[]; x: number; y: number }
  | { kind: 'stop'; unitIds: number[] };

export class World {
  tick = 0;
  readonly ships = new Map<number, ShipEntity>();
  private readonly shipTypes: Map<string, Ship>;
  private readonly pending: Command[] = [];
  private nextId = 1;
  readonly grid: PathGrid;

  constructor(grid: PathGrid, shipTypes: Ship[]) {
    this.grid = grid;
    this.shipTypes = new Map(shipTypes.map((s) => [s.id, s]));
  }

  spawnShip(typeId: string, owner: number, x: number, y: number, facing = Math.PI / 2): ShipEntity {
    const type = this.shipTypes.get(typeId);
    if (!type) throw new Error(`Unknown ship type ${typeId}`);
    const ship: ShipEntity = {
      id: this.nextId++,
      typeId,
      owner,
      x, y, facing,
      speed: 0,
      maxSpeed: type.speed,
      turnSpeed: type.turnRate * TURN_RATE_SCALE,
      pathRadius: type.collision,
      bodyRadius: BODY_RADIUS[type.size] ?? 55,
      path: [],
      prevX: x, prevY: y, prevFacing: facing,
    };
    this.ships.set(ship.id, ship);
    return ship;
  }

  issue(command: Command): void {
    this.pending.push(command);
  }

  step(): void {
    for (const ship of this.ships.values()) {
      ship.prevX = ship.x;
      ship.prevY = ship.y;
      ship.prevFacing = ship.facing;
    }
    for (const command of this.pending.splice(0)) this.apply(command);
    for (const ship of this.ships.values()) this.move(ship);
    this.separate();
    this.tick++;
  }

  private apply(command: Command): void {
    const ships = command.unitIds.map((id) => this.ships.get(id)).filter((s): s is ShipEntity => s !== undefined);
    if (command.kind === 'stop') {
      for (const s of ships) s.path = [];
      return;
    }
    const targets = formationTargets(ships, { x: command.x, y: command.y });
    ships.forEach((ship, i) => {
      ship.path = this.grid.findPath(ship, targets[i]!, ship.pathRadius) ?? [];
    });
  }

  private move(ship: ShipEntity): void {
    while (ship.path.length > 1 && distance(ship, ship.path[0]!) < WAYPOINT_RADIUS) ship.path.shift();
    const target = ship.path[0];
    let targetSpeed = 0;
    if (target) {
      const dist = distance(ship, target);
      const isLast = ship.path.length === 1;
      if (isLast && dist < Math.max(8, ship.speed * TICK_DT)) {
        ship.path = [];
      } else {
        const desired = Math.atan2(target.y - ship.y, target.x - ship.x);
        ship.facing = turnToward(ship.facing, desired, ship.turnSpeed * TICK_DT);
        const off = Math.abs(wrapAngle(desired - ship.facing));
        targetSpeed = ship.maxSpeed * Math.max(MIN_TURNING_SPEED, Math.cos(Math.min(off, Math.PI / 2)));
        // Brake into the final point so ships do not overshoot and circle.
        if (isLast) targetSpeed = Math.min(targetSpeed, dist * 2);
      }
    }
    const accel = (ship.maxSpeed / ACCELERATION_TIME) * TICK_DT;
    ship.speed = targetSpeed > ship.speed ? Math.min(targetSpeed, ship.speed + accel) : Math.max(targetSpeed, ship.speed - accel * 2);
    if (ship.speed <= 0) return;

    const step = ship.speed * TICK_DT;
    const nx = ship.x + Math.cos(ship.facing) * step;
    const ny = ship.y + Math.sin(ship.facing) * step;
    if (this.grid.isSailable(nx, ny, ship.pathRadius)) {
      ship.x = nx; ship.y = ny;
    } else if (this.grid.isSailable(nx, ship.y, ship.pathRadius)) {
      ship.x = nx; // slide along the shore
    } else if (this.grid.isSailable(ship.x, ny, ship.pathRadius)) {
      ship.y = ny;
    } else {
      ship.speed = 0;
    }
  }

  /** Pushes overlapping hulls apart; O(n²) is fine for the few dozen ships of M1. */
  private separate(): void {
    const list = [...this.ships.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.bodyRadius + b.bodyRadius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) / 2;
        const ux = d2 > 0 ? dx / d : 1, uy = d2 > 0 ? dy / d : 0;
        this.nudge(a, -ux * push, -uy * push);
        this.nudge(b, ux * push, uy * push);
      }
    }
  }

  private nudge(ship: ShipEntity, dx: number, dy: number): void {
    if (this.grid.isSailable(ship.x + dx, ship.y + dy, ship.pathRadius)) {
      ship.x += dx;
      ship.y += dy;
    }
  }
}

/** Spreads a group's destinations on a grid around the clicked point. */
export function formationTargets(ships: ShipEntity[], center: Vec2): Vec2[] {
  if (ships.length <= 1) return ships.map(() => center);
  const spacing = Math.max(...ships.map((s) => s.bodyRadius)) * 2.2;
  const cols = Math.ceil(Math.sqrt(ships.length));
  const rows = Math.ceil(ships.length / cols);
  return ships.map((_, i) => ({
    x: center.x + ((i % cols) - (cols - 1) / 2) * spacing,
    y: center.y + (Math.floor(i / cols) - (rows - 1) / 2) * spacing,
  }));
}
