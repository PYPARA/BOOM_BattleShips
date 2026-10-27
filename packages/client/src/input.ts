// Selection (click / drag box) and right-click move orders for the local player's ships. Like
// Warcraft, clicking anything else (an enemy, a creep, a building, a shop) selects it for the
// info panel at the bottom; the player's own ship stays the one taking orders.
import * as THREE from 'three/webgpu';
import type { Match, World } from '@boom/sim';
import type { RtsCamera } from './camera.ts';
import { toThree } from './space.ts';

const DRAG_THRESHOLD_PX = 6;

/** What the info panel shows: a unit or structure, or a shop (by index into `match.shops`). */
export type Focus = { kind: 'unit'; id: number } | { kind: 'shop'; index: number };

export class SelectionInput {
  readonly selected = new Set<number>();
  /** Something other than the player's ships, clicked to inspect (or a shop to buy from). */
  focus: Focus | undefined;
  /** Building meshes to pick by raycast (so a tall building's roof is clickable). */
  buildings: THREE.Object3D | undefined;
  private readonly raycaster = new THREE.Raycaster();
  private readonly match: Match;
  /** Last move order target, for the click marker. */
  lastOrder: { x: number; y: number; at: number } | undefined;
  private dragStart: { x: number; y: number } | undefined;
  private readonly box: HTMLDivElement;
  private readonly rts: RtsCamera;
  private readonly world: World;
  private readonly player: number;

  constructor(dom: HTMLElement, rts: RtsCamera, match: Match, player: number) {
    this.rts = rts;
    this.match = match;
    this.world = match.world;
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
      if (e.key === 'Escape') { this.selected.clear(); this.focus = undefined; }
      if (e.key === 'F1') { e.preventDefault(); this.selected.clear(); this.focus = undefined; }
      if (e.key.toLowerCase() === 'h' || e.key === ' ') this.focusSelection();
    });
  }

  private ownShips() {
    return [...this.world.ships.values()].filter((s) => s.owner === this.player);
  }

  private clickSelect(clientX: number, clientY: number, additive: boolean): void {
    const point = this.rts.screenToSea(clientX, clientY);
    if (!additive) { this.selected.clear(); this.focus = undefined; }
    const team = this.match.players.get(this.player)?.team;
    // Ships first (they sit in front of the shore), nearest to the clicked point.
    let best: { id: number; d: number; own: boolean } | undefined;
    if (point) {
      for (const s of this.world.ships.values()) {
        if (s.locust || (s.team !== team && team && !this.world.visibleTo(team, s))) continue;
        const d = Math.hypot(s.x - point.x, s.y - point.y);
        if (d < s.bodyRadius * 1.6 && (!best || d < best.d)) best = { id: s.id, d, own: s.owner === this.player };
      }
    }
    if (best?.own) { this.selected.add(best.id); this.focus = undefined; return; }
    if (best) { this.focus = { kind: 'unit', id: best.id }; return; }
    // Buildings by raycast: a shop opens its goods, any other structure shows its info.
    const hit = this.pickBuilding(clientX, clientY);
    if (hit) {
      const shop = this.match.shops.findIndex((s) => s.x === hit.x && s.y === hit.y);
      const structure = [...this.world.structures.values()].find((u) => u.x === hit.x && u.y === hit.y);
      if (shop >= 0 && this.match.shops[shop]!.sellsItems.length + this.match.shops[shop]!.sellsUnits.length > 0) this.focus = { kind: 'shop', index: shop };
      else if (structure) this.focus = { kind: 'unit', id: structure.id };
    }
  }

  /** Map position of the building under the cursor, if any. */
  private pickBuilding(clientX: number, clientY: number): { x: number; y: number } | undefined {
    if (!this.buildings) return undefined;
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.rts.camera.updateMatrixWorld();
    this.buildings.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.rts.camera);
    // Each mesh is asked directly (intersectObject on the group came back empty for the merged
    // GLB meshes); the nearest hit wins.
    const hits: THREE.Intersection[] = [];
    this.buildings.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) o.raycast(this.raycaster, hits); });
    hits.sort((a, b) => a.distance - b.distance);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.mapX === undefined) o = o.parent;
      if (o) return { x: o.userData.mapX as number, y: o.userData.mapY as number };
    }
    return undefined;
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
