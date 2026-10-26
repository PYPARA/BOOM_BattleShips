// 2D minimap: sea/land from the pathing grid, buildings, ships and the camera's view.
import type { PathingInfo, Placement, Terrain, Unit } from '@boom/gamedata';
import type { World } from '@boom/sim';
import type { RtsCamera } from './camera.ts';
import { TEAM_COLORS, teamOf } from './space.ts';

const SIZE = 220;
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background: HTMLCanvasElement;
  private readonly worldW: number;
  private readonly worldH: number;
  private readonly originX: number;
  private readonly originY: number;
  private readonly buildingSizes: Map<Placement, number>;

  private readonly buildings: Placement[];
  private readonly world: World;
  private readonly rts: RtsCamera;
  private readonly player: number;
  /** Called with a sim-space point when the minimap is right-clicked. */
  onOrder: ((x: number, y: number) => void) | undefined;

  constructor(
    terrain: Terrain,
    pathingInfo: PathingInfo,
    cells: Uint8Array,
    buildings: Placement[],
    unitsById: Map<string, Unit>,
    world: World,
    rts: RtsCamera,
    player: number,
  ) {
    this.buildings = buildings;
    this.world = world;
    this.rts = rts;
    this.player = player;
    this.worldW = (terrain.width - 1) * 128;
    this.worldH = (terrain.height - 1) * 128;
    this.originX = terrain.originX;
    this.originY = terrain.originY;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.width = this.canvas.height = SIZE * devicePixelRatio;
    this.ctx = this.canvas.getContext('2d')!;
    document.body.appendChild(this.canvas);

    // Pre-render terrain once at pathing resolution (rows run bottom-up, so flip).
    this.background = document.createElement('canvas');
    this.background.width = pathingInfo.width;
    this.background.height = pathingInfo.height;
    const bg = this.background.getContext('2d')!;
    const image = bg.createImageData(pathingInfo.width, pathingInfo.height);
    for (let y = 0; y < pathingInfo.height; y++) {
      for (let x = 0; x < pathingInfo.width; x++) {
        const land = cells[y * pathingInfo.width + x]! & pathingInfo.flags.noWater;
        const o = ((pathingInfo.height - 1 - y) * pathingInfo.width + x) * 4;
        image.data.set(land ? [92, 120, 64, 255] : [24, 72, 108, 255], o);
      }
    }
    bg.putImageData(image, 0, 0);
    this.buildingSizes = new Map(buildings.map((p) => [p, unitsById.get(p.id)?.collision ?? 40]));

    const toWorld = (e: PointerEvent): [number, number] => {
      const rect = this.canvas.getBoundingClientRect();
      const u = (e.clientX - rect.left) / rect.width, v = (e.clientY - rect.top) / rect.height;
      return [this.originX + u * this.worldW, this.originY + (1 - v) * this.worldH];
    };
    const jump = (e: PointerEvent) => this.rts.lookAt(...toWorld(e));
    let down = false;
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button === 2) { this.onOrder?.(...toWorld(e)); return; }
      down = true;
      jump(e);
    });
    window.addEventListener('pointerup', () => { down = false; });
    this.canvas.addEventListener('pointermove', (e) => { if (down) jump(e); });
  }

  private toMap(x: number, y: number): [number, number] {
    const s = this.canvas.width;
    return [((x - this.originX) / this.worldW) * s, (1 - (y - this.originY) / this.worldH) * s];
  }

  draw(): void {
    const { ctx } = this;
    const s = this.canvas.width;
    ctx.drawImage(this.background, 0, 0, s, s);
    for (const p of this.buildings) {
      const [x, y] = this.toMap(p.x, p.y);
      const r = Math.max(2, (this.buildingSizes.get(p)! / this.worldW) * s * 2);
      ctx.fillStyle = css(TEAM_COLORS[teamOf(p.player)]);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (const ship of this.world.ships.values()) {
      const [x, y] = this.toMap(ship.x, ship.y);
      ctx.fillStyle = ship.owner === this.player ? '#7dff8a' : css(TEAM_COLORS[teamOf(ship.owner)]);
      ctx.beginPath();
      ctx.arc(x, y, 3 * devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    // Camera footprint: project the four screen corners onto the sea.
    const corners = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]]
      .map(([cx, cy]) => this.rts.screenToSea(cx!, cy!));
    if (corners.every((c) => c)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = devicePixelRatio;
      ctx.beginPath();
      corners.forEach((c, i) => {
        const [x, y] = this.toMap(c!.x, c!.y);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }
}
