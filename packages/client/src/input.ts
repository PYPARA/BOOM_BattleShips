// Selection (click / drag box) and right-click move orders for the local player's ships.
import * as THREE from 'three/webgpu';
import type { World } from '@boom/sim';
import type { RtsCamera } from './camera.ts';
import { toThree } from './space.ts';

const DRAG_THRESHOLD_PX = 6;

export class SelectionInput {
  readonly selected = new Set<number>();
  /** Last move order target, for the click marker. */
  lastOrder: { x: number; y: number; at: number } | undefined;
  private dragStart: { x: number; y: number } | undefined;
  private readonly box: HTMLDivElement;
  private readonly rts: RtsCamera;
  private readonly world: World;
  private readonly player: number;

  constructor(dom: HTMLElement, rts: RtsCamera, world: World, player: number) {
    this.rts = rts;
    this.world = world;
    this.player = player;
    this.box = document.createElement('div');
    this.box.className = 'selection-box';
    document.body.appendChild(this.box);

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.dragStart = { x: e.clientX, y: e.clientY };
      if (e.button === 2) this.order(e.clientX, e.clientY);
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragStart) return;
      const { x, y } = this.dragStart;
      const show = Math.hypot(e.clientX - x, e.clientY - y) > DRAG_THRESHOLD_PX;
      Object.assign(this.box.style, {
        display: show ? 'block' : 'none',
        left: `${Math.min(x, e.clientX)}px`, top: `${Math.min(y, e.clientY)}px`,
        width: `${Math.abs(e.clientX - x)}px`, height: `${Math.abs(e.clientY - y)}px`,
      });
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.dragStart) return;
      const start = this.dragStart;
      this.dragStart = undefined;
      this.box.style.display = 'none';
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD_PX) this.boxSelect(start, { x: e.clientX, y: e.clientY }, e.shiftKey);
      else this.clickSelect(e.clientX, e.clientY, e.shiftKey);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.selected.clear();
      if (e.key.toLowerCase() === 'h' || e.key === ' ') this.focusSelection();
    });
  }

  private ownShips() {
    return [...this.world.ships.values()].filter((s) => s.owner === this.player);
  }

  private clickSelect(clientX: number, clientY: number, additive: boolean): void {
    const point = this.rts.screenToSea(clientX, clientY);
    if (!additive) this.selected.clear();
    if (!point) return;
    let best: number | undefined;
    let bestD = Infinity;
    for (const s of this.ownShips()) {
      const d = Math.hypot(s.x - point.x, s.y - point.y);
      if (d < s.bodyRadius * 1.6 && d < bestD) { best = s.id; bestD = d; }
    }
    if (best !== undefined) this.selected.add(best);
  }

  private boxSelect(a: { x: number; y: number }, b: { x: number; y: number }, additive: boolean): void {
    if (!additive) this.selected.clear();
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    const v = new THREE.Vector3();
    for (const s of this.ownShips()) {
      toThree(s.x, s.y, undefined, v).project(this.rts.camera);
      const sx = ((v.x + 1) / 2) * window.innerWidth, sy = ((1 - v.y) / 2) * window.innerHeight;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) this.selected.add(s.id);
    }
  }

  private order(clientX: number, clientY: number): void {
    const point = this.rts.screenToSea(clientX, clientY);
    if (point) this.orderAt(point.x, point.y);
  }

  /** Moves the selected ships to a sim-space point. */
  orderAt(x: number, y: number): void {
    if (this.selected.size === 0) return;
    this.world.issue({ kind: 'move', unitIds: [...this.selected], x, y });
    this.lastOrder = { x, y, at: performance.now() };
  }

  focusSelection(): void {
    const ships = [...this.selected].map((id) => this.world.ships.get(id)).filter((s) => s !== undefined);
    if (ships.length === 0) return;
    this.rts.lookAt(ships.reduce((a, s) => a + s.x, 0) / ships.length, ships.reduce((a, s) => a + s.y, 0) / ships.length);
  }
}
