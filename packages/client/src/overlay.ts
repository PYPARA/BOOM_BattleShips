// A 2D canvas over the 3D view for health bars, status tags, floating gold and damage numbers;
// far cheaper than a mesh per bar.
import * as THREE from 'three/webgpu';
import type { Match, MatchEvent, UnitEntity } from '@boom/sim';
import { SEA_LEVEL } from './space.ts';

interface Floater {
  text: string; color: string; x: number; y: number; z: number; born: number; size: number;
  /** Damage numbers on the same target within a few frames add up instead of stacking. */
  targetId?: number; amount?: number; drift?: number;
}

/** Short labels shown over a unit's health bar while a status effect is on it. */
const BUFF_TAGS: Partial<Record<string, [string, string]>> = {
  stun: ['晕', '#ffd84a'], root: ['定', '#c9a35a'], silence: ['沉默', '#c58cff'], slow: ['慢', '#7ab8ff'],
  haste: ['加速', '#7dffb0'], invulnerable: ['无敌', '#ffffff'], dot: ['灼烧', '#ff8a4a'], hot: ['回复', '#7dff8a'],
  invisible: ['隐形', '#b9c6d8'], armorDown: ['破甲', '#ff6a6a'], disarm: ['变异', '#e59cff'],
};

const FLOAT_MS = 1400;
/** Hits on one target closer together than this merge into one number. */
const MERGE_MS = 180;

export class Overlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floaters: Floater[] = [];
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
        this.floaters.push({ text: `+${e.amount}`, color: '#ffd84a', x: e.x, y: e.y!, z: SEA_LEVEL + 80, born: now, size: 15 });
      }
      if (e.kind === 'hit' && e.damage >= 1) this.damage(e.targetId, e.sourceOwner, e.damage, e.attackType, e.x, e.y, now);

    }
  }

  /** Damage the player dealt (white, skills yellow) or took (red), merged per target. */
  private damage(targetId: number, sourceOwner: number, amount: number, attackType: string, x: number, y: number, now: number): void {
    const target = this.match.world.unit(targetId);
    const taken = target?.owner === this.player;
    if (sourceOwner !== this.player && !taken) return;
    const recent = this.floaters.find((f) => f.targetId === targetId && now - f.born < MERGE_MS);
    const total = (recent?.amount ?? 0) + amount;
    const skill = attackType === 'ability' || attackType === 'pure';
    const f = recent ?? { text: '', color: '', x, y, z: SEA_LEVEL + 110, born: now, size: 14, targetId, drift: (Math.random() - 0.5) * 30 };
    f.amount = total;
    f.text = taken ? `-${Math.round(total)}` : `${Math.round(total)}`;
    f.color = taken ? '#ff6a5a' : skill ? '#ffd84a' : '#ffffff';
    f.size = Math.min(26, 13 + Math.log10(Math.max(1, total)) * 4);
    if (!recent) this.floaters.push(f);
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
    const boss = u.id === this.match.creeps.bossId;
    const w = boss ? 110 : u.kind === 'structure' ? 70 : u.isHero ? 52 : 34;
    const h = boss ? 8 : u.isHero || u.kind === 'structure' ? 6 : 4;
    const own = u.owner === this.player;
    const ally = !own && this.match.players.get(this.player)?.team === u.team;
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, h + 2);
    ctx.fillStyle = own ? '#5cff7a' : ally ? '#5aa8ff' : '#ff5a4a';
    ctx.fillRect(sx - w / 2, sy, w * Math.max(0, u.hp / u.maxHp), h);
    const tags = [...new Set(u.buffs.map((b) => b.kind))].map((k) => BUFF_TAGS[k]).filter((t) => t !== undefined);
    if (u.invulnerable && !u.buffs.some((b) => b.kind === 'invulnerable')) tags.push(BUFF_TAGS.invulnerable!);
    if (tags.length) {
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      tags.forEach(([text, color], i) => {
        const x = sx + (i - (tags.length - 1) / 2) * 30;
        ctx.fillStyle = '#000a';
        ctx.fillText(text, x + 1, sy - 4);
        ctx.fillStyle = color;
        ctx.fillText(text, x, sy - 5);
      });
    }
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
    const team = this.match.players.get(this.player)?.team;
    for (const u of this.match.world.allUnits()) {
      if (u.locust || (team && u.team !== team && !this.match.world.visibleTo(team, u))) continue;
      if (u.hp < u.maxHp || u.isHero || u.id === this.match.creeps.bossId) this.bar(u, camera);
    }

    ctx.textAlign = 'center';
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      const t = (now - f.born) / FLOAT_MS;
      if (t >= 1) { this.floaters.splice(i, 1); continue; }
      const at = this.project(f.x, f.y, f.z, camera);
      if (!at) continue;
      // Pop in, then rise and fade.
      const pop = t < 0.1 ? 1 + (0.1 - t) * 4 : 1;
      ctx.font = `800 ${Math.round(f.size * pop)}px system-ui, sans-serif`;
      ctx.globalAlpha = 1 - t * t;
      const sx = at[0] + (f.drift ?? 0) * t, sy = at[1] - t * 46;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000b';
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, sy);
      ctx.globalAlpha = 1;
    }
  }
}
