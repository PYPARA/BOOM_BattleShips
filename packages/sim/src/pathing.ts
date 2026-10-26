// Ship navigation on the map's 32-unit pathing grid: clearance map, A* and path smoothing.
import type { Vec2 } from './math.ts';

const SQRT2 = Math.SQRT2;
/** Clearance is only tracked this far (in cells); enough for the largest hull. */
const MAX_CLEARANCE = 8;

export interface PathGridOptions {
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originY: number;
  /** One byte per cell, row-major from the bottom-left. */
  cells: Uint8Array;
  /** Bit that marks a cell as dry land (wpm "no water"). */
  noWaterFlag: number;
}

export class PathGrid {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly originX: number;
  readonly originY: number;
  /** Chebyshev distance in cells to the nearest blocked cell (0 = blocked). */
  private readonly clearance: Uint8Array;
  private readonly blocked: Uint8Array;
  /** Cells blocked by the map itself and by buildings, before any region closures. */
  private readonly baseBlocked: Uint8Array;
  private readonly closedRegions = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();

  // A* scratch buffers, reused between searches.
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly visit: Uint32Array;
  private readonly closed: Uint32Array;
  private generation = 0;
  /** Connected water regions per required clearance, built on demand. */
  private readonly components = new Map<number, Int32Array>();

  constructor(opts: PathGridOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.cellSize = opts.cellSize;
    this.originX = opts.originX;
    this.originY = opts.originY;
    const n = opts.width * opts.height;
    this.blocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.blocked[i] = opts.cells[i]! & opts.noWaterFlag ? 1 : 0;
    this.baseBlocked = this.blocked.slice();
    this.clearance = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.visit = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.rebuildClearance();
  }

  /** Marks discs as blocked, e.g. for buildings standing in the water. */
  blockCircles(circles: { x: number; y: number; radius: number }[]): void {
    for (const { x, y, radius } of circles) {
      const [cx, cy] = this.toCell(x, y);
      const r = Math.ceil(radius / this.cellSize);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const i = this.index(cx + dx, cy + dy);
          if (i >= 0) this.blocked[i] = this.baseBlocked[i] = 1;
        }
      }
    }
    this.rebuildClearance();
  }

  /**
   * Closes or reopens a rectangular region to ships, e.g. the west channel that the fast
   * mode keeps shut. Rebuilds clearance, so call it only when the state changes.
   */
  setRegionClosed(name: string, rect: { minX: number; minY: number; maxX: number; maxY: number }, closed: boolean): void {
    if (closed) this.closedRegions.set(name, rect); else this.closedRegions.delete(name);
    this.blocked.set(this.baseBlocked);
    for (const r of this.closedRegions.values()) {
      const [x0, y0] = this.toCell(r.minX, r.minY), [x1, y1] = this.toCell(r.maxX, r.maxY);
      for (let y = Math.max(0, y0); y <= Math.min(this.height - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(this.width - 1, x1); x++) this.blocked[y * this.width + x] = 1;
      }
    }
    this.rebuildClearance();
  }

  isRegionClosed(name: string): boolean {
    return this.closedRegions.has(name);
  }

  private rebuildClearance(): void {
    this.components.clear();
    // Multi-source BFS from blocked cells (and the map edge) over 8 neighbours.
    const { width: w, height: h } = this;
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    this.clearance.fill(MAX_CLEARANCE);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (this.blocked[i]) { this.clearance[i] = 0; queue[tail++] = i; }
        else if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { this.clearance[i] = 1; queue[tail++] = i; }
      }
    }
    while (head < tail) {
      const i = queue[head++]!;
      const d = this.clearance[i]! + 1;
      if (d >= MAX_CLEARANCE) continue;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = this.index(x + dx, y + dy);
          if (j < 0 || this.clearance[j]! <= d) continue;
          this.clearance[j] = d;
          queue[tail++] = j;
        }
      }
    }
  }

  toCell(x: number, y: number): [number, number] {
    return [Math.floor((x - this.originX) / this.cellSize), Math.floor((y - this.originY) / this.cellSize)];
  }

  cellCenter(cx: number, cy: number): Vec2 {
    return { x: this.originX + (cx + 0.5) * this.cellSize, y: this.originY + (cy + 0.5) * this.cellSize };
  }

  private index(cx: number, cy: number): number {
    return cx < 0 || cy < 0 || cx >= this.width || cy >= this.height ? -1 : cy * this.width + cx;
  }

  /** Clearance a hull of `radius` needs: its centre cell must be this far from any blocked cell. */
  requiredClearance(radius: number): number {
    return Math.min(MAX_CLEARANCE, Math.max(1, Math.ceil(radius / this.cellSize + 0.5)));
  }

  isSailable(x: number, y: number, radius: number): boolean {
    const [cx, cy] = this.toCell(x, y);
    const i = this.index(cx, cy);
    return i >= 0 && this.clearance[i]! >= this.requiredClearance(radius);
  }

  /** Labels the regions a hull needing `need` clearance can sail between (0 = none). */
  private componentsFor(need: number): Int32Array {
    let labels = this.components.get(need);
    if (labels) return labels;
    const { width: w, height: h } = this;
    labels = new Int32Array(w * h);
    const stack: number[] = [];
    let next = 0;
    for (let start = 0; start < w * h; start++) {
      if (labels[start] || this.clearance[start]! < need) continue;
      labels[start] = ++next;
      stack.push(start);
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % w, y = (i - x) / w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = this.index(x + dx, y + dy);
          if (j < 0 || labels[j] || this.clearance[j]! < need) continue;
          labels[j] = next;
          stack.push(j);
        }
      }
    }
    this.components.set(need, labels);
    return labels;
  }

  private regionAt(x: number, y: number, radius: number): number {
    const [cx, cy] = this.toCell(x, y);
    const i = this.index(cx, cy);
    return i < 0 ? 0 : this.componentsFor(this.requiredClearance(radius))[i]!;
  }

  /**
   * Nearest cell a hull fits in, searching outward up to `maxCells`. With `region`, only
   * cells connected to that water region count.
   */
  nearestSailable(x: number, y: number, radius: number, maxCells = 64, region = 0): Vec2 | undefined {
    const need = this.requiredClearance(radius);
    const labels = region ? this.componentsFor(need) : undefined;
    const [cx, cy] = this.toCell(x, y);
    for (let r = 0; r <= maxCells; r++) {
      let best: [number, number] | undefined;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const i = this.index(cx + dx, cy + dy);
          if (i < 0 || this.clearance[i]! < need || (labels && labels[i] !== region)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = [cx + dx, cy + dy]; }
        }
      }
      if (best) return r === 0 ? { x, y } : this.cellCenter(best[0], best[1]);
    }
    return undefined;
  }

  /** Straight segment check, sampled every quarter cell. */
  lineClear(a: Vec2, b: Vec2, radius: number): boolean {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / (this.cellSize / 4)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.isSailable(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius)) return false;
    }
    return true;
  }

  /**
   * A* from `from` to `to` for a hull of `radius`. Returns smoothed world-space waypoints
   * (excluding the start), or undefined when the target cannot be reached.
   */
  findPath(from: Vec2, to: Vec2, radius: number, maxExpanded = 300_000): Vec2[] | undefined {
    const start = this.isSailable(from.x, from.y, radius) ? from : this.nearestSailable(from.x, from.y, radius);
    if (!start) return undefined;
    // Aim for the nearest point in the start's own water region, so clicks on land or on a
    // cut-off lake still move the ship as close as it can get.
    const region = this.regionAt(start.x, start.y, radius);
    const goal = this.regionAt(to.x, to.y, radius) === region ? to : this.nearestSailable(to.x, to.y, radius, 256, region);
    if (!goal) return undefined;
    if (this.lineClear(start, goal, radius)) return [goal];

    const need = this.requiredClearance(radius);
    const w = this.width;
    const [sx, sy] = this.toCell(start.x, start.y);
    const [gx, gy] = this.toCell(goal.x, goal.y);
    const startIdx = sy * w + sx, goalIdx = gy * w + gx;
    const gen = ++this.generation;
    const heap = new MinHeap();
    const h = (x: number, y: number) => {
      const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    this.visit[startIdx] = gen;
    this.g[startIdx] = 0;
    this.parent[startIdx] = -1;
    heap.push(startIdx, h(sx, sy));

    let expanded = 0;
    let found = false;
    while (heap.size > 0) {
      const i = heap.pop();
      if (this.closed[i] === gen) continue; // stale heap entry
      this.closed[i] = gen;
      if (i === goalIdx) { found = true; break; }
      if (++expanded > maxExpanded) break;
      const x = i % w, y = (i - x) / w;
      const gi = this.g[i]!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = this.index(x + dx, y + dy);
          if (j < 0 || this.closed[j] === gen || this.clearance[j]! < need) continue;
          // No corner cutting.
          if (dx !== 0 && dy !== 0 && (this.clearance[i + dx]! < need || this.clearance[i + dy * w]! < need)) continue;
          const ng = gi + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
          if (this.visit[j] === gen && this.g[j]! <= ng) continue;
          this.visit[j] = gen;
          this.g[j] = ng;
          this.parent[j] = i;
          heap.push(j, ng + h(x + dx, y + dy));
        }
      }
    }
    if (!found) return undefined;

    const cells: Vec2[] = [];
    for (let i = goalIdx; i !== -1 && i !== startIdx; i = this.parent[i]!) {
      const x = i % w;
      cells.push(this.cellCenter(x, (i - x) / w));
    }
    cells.reverse();
    if (cells.length > 0) cells[cells.length - 1] = goal;
    return this.smooth(start, cells, radius);
  }

  /** Greedy string pulling: skip waypoints while the straight line stays sailable. */
  private smooth(start: Vec2, points: Vec2[], radius: number): Vec2[] {
    const out: Vec2[] = [];
    let anchor = start;
    let i = 0;
    while (i < points.length) {
      let j = points.length - 1;
      while (j > i && !this.lineClear(anchor, points[j]!, radius)) j--;
      out.push(points[j]!);
      anchor = points[j]!;
      i = j + 1;
    }
    return out;
  }
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    const { items, keys } = this;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      items[i] = items[p]!; keys[i] = keys[p]!;
      i = p;
    }
    items[i] = item; keys[i] = key;
  }

  pop(): number {
    const { items, keys } = this;
    const top = items[0]!;
    const lastItem = items.pop()!, lastKey = keys.pop()!;
    if (items.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        let mk = lastKey;
        if (l < items.length && keys[l]! < mk) { m = l; mk = keys[l]!; }
        if (r < items.length && keys[r]! < mk) { m = r; mk = keys[r]!; }
        if (m === i) break;
        items[i] = items[m]!; keys[i] = keys[m]!;
        i = m;
      }
      items[i] = lastItem; keys[i] = lastKey;
    }
    return top;
  }
}
