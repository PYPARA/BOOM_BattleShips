// A 2D canvas over the 3D view for health bars, floating gold numbers and hit flashes;
// far cheaper than a mesh per bar.
import * as THREE from 'three/webgpu';
import type { Match, MatchEvent, UnitEntity } from '@boom/sim';
import { SEA_LEVEL } from './space.ts';

interface Floater { text: string; color: string; x: number; y: number; z: number; born: number }
interface Burst { x: number; y: number; z: number; born: number; size: number }

const FLOAT_MS = 1400;
const BURST_MS = 650;

export class Overlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floaters: Floater[] = [];
  private readonly bursts: Burst[] = [];
  private readonly v = new THREE.Vector3();
  private readonly match: Match;
  private readonly player: number;

  constructor(match: Match, player: number) {
    this.match = match;
    this.player = player;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Turns match events into floating text and bursts. */
  onEvents(events: MatchEvent[], now: number): void {
    for (const e of events) {
      if (e.kind === 'gold' && e.player === this.player && e.x !== undefined) {
        this.floaters.push({ text: `+${e.amount}`, color: '#ffd84a', x: e.x, y: e.y!, z: SEA_LEVEL + 80, born: now });
      }
      if (e.kind === 'death') this.bursts.push({ x: e.x, y: e.y, z: SEA_LEVEL + 20, born: now, size: e.typeId.startsWith('n') || e.typeId.startsWith('h01') ? 90 : 50 });
    }
  }

  private project(x: number, y: number, z: number, camera: THREE.Camera): [number, number] | undefined {
    this.v.set(x, z, -y).project(camera);
    if (this.v.z > 1) return undefined;
    return [((this.v.x + 1) / 2) * innerWidth, ((1 - this.v.y) / 2) * innerHeight];
  }

  private bar(u: UnitEntity, camera: THREE.Camera): void {
    const height = u.kind === 'structure' ? 260 : u.bodyRadius * 1.4;
    const at = this.project(u.x, u.y, SEA_LEVEL + height, camera);
    if (!at) return;
    const [sx, sy] = at;
    if (sx < -60 || sy < -20 || sx > innerWidth + 60 || sy > innerHeight + 20) return;
    const w = u.kind === 'structure' ? 70 : u.isHero ? 52 : 34;
    const h = u.isHero || u.kind === 'structure' ? 6 : 4;
    const own = u.owner === this.player;
    const ally = !own && this.match.players.get(this.player)?.team === u.team;
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, h + 2);
    ctx.fillStyle = own ? '#5cff7a' : ally ? '#5aa8ff' : '#ff5a4a';
    ctx.fillRect(sx - w / 2, sy, w * Math.max(0, u.hp / u.maxHp), h);
  }

  draw(camera: THREE.Camera, now: number): void {
    const dpr = Math.min(devicePixelRatio, 2);
    if (this.canvas.width !== innerWidth * dpr || this.canvas.height !== innerHeight * dpr) {
      this.canvas.width = innerWidth * dpr;
      this.canvas.height = innerHeight * dpr;
    }
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const u of this.match.world.allUnits()) if (u.hp < u.maxHp || u.isHero) this.bar(u, camera);

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      const t = (now - b.born) / BURST_MS;
      if (t >= 1) { this.bursts.splice(i, 1); continue; }
      const at = this.project(b.x, b.y, b.z, camera);
      if (!at) continue;
      ctx.beginPath();
      ctx.arc(at[0], at[1], b.size * (0.3 + t) * (1100 / Math.max(600, camera.position.y)), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,${Math.round(180 - 120 * t)},60,${0.55 * (1 - t)})`;
      ctx.fill();
    }

    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      const t = (now - f.born) / FLOAT_MS;
      if (t >= 1) { this.floaters.splice(i, 1); continue; }
      const at = this.project(f.x, f.y, f.z, camera);
      if (!at) continue;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = '#000a';
      ctx.fillText(f.text, at[0] + 1, at[1] - t * 40 + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, at[0], at[1] - t * 40);
      ctx.globalAlpha = 1;
    }
  }
}
