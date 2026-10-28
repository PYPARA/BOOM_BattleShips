// Shells in flight, styled by the weapon that fired them: cannonballs with a smoky ember trail,
// rockets with a smoke plume, heavy shot that smokes and shakes the view, glowing energy bolts
// that fly flat and streak, tracers, ice and fire, depth charges lobbed high. Bodies are two
// instanced meshes (a dark shell, an additive glow); trails and impacts go to the particle pools.
import * as THREE from 'three/webgpu';
import type { Weapon } from '@boom/gamedata';
import type { Projectile, World } from '@boom/sim';
import type { Effects, Rgb } from './effects.ts';
import { SEA_LEVEL } from './space.ts';

const MAX = 1024;

type Kind = 'cannon' | 'heavy' | 'rocket' | 'flame' | 'frost' | 'energy' | 'tracer' | 'arrow' | 'blade' | 'depth';

interface Style {
  kind: Kind;
  /** Shell radius (world units); 0 for none. */
  shell: number;
  /** Glow radius and color; 0 for none. Energy glows are stretched along the flight. */
  glow: number;
  color: Rgb;
  /** Peak arc height as a share of the distance, and its cap. */
  arc: number;
  /** Seconds between trail puffs. */
  trailEvery: number;
}

const STYLES: Record<Kind, Omit<Style, 'kind' | 'color'> & { color: Rgb }> = {
  cannon: { shell: 7, glow: 9, color: [1, 0.55, 0.2], arc: 0.15, trailEvery: 0.05 },
  heavy: { shell: 12, glow: 14, color: [1, 0.45, 0.15], arc: 0.2, trailEvery: 0.035 },
  rocket: { shell: 5, glow: 10, color: [1, 0.7, 0.3], arc: 0.06, trailEvery: 0.02 },
  flame: { shell: 0, glow: 22, color: [1, 0.5, 0.1], arc: 0.08, trailEvery: 0.025 },
  frost: { shell: 0, glow: 16, color: [0.55, 0.85, 1], arc: 0.1, trailEvery: 0.035 },
  energy: { shell: 0, glow: 13, color: [0.45, 0.75, 1], arc: 0.02, trailEvery: 0.03 },
  tracer: { shell: 0, glow: 6, color: [1, 0.85, 0.4], arc: 0.02, trailEvery: 1 },
  arrow: { shell: 3, glow: 0, color: [0.9, 0.8, 0.6], arc: 0.08, trailEvery: 1 },
  blade: { shell: 9, glow: 0, color: [0.8, 0.8, 0.85], arc: 0.12, trailEvery: 1 },
  depth: { shell: 10, glow: 0, color: [0.4, 0.4, 0.4], arc: 0.35, trailEvery: 1 },
};

/** Energy weapons glow in their own color. */
const ENERGY_COLORS: [RegExp, Rgb][] = [
  [/激光|真红|红箭|炮姐/, [1, 0.35, 0.35]],
  [/雷神|霹雳|电磁/, [0.75, 0.6, 1]],
  [/精灵|压缩空间|缩退|无相/, [0.6, 1, 0.75]],
  [/天星|慧星|灭日|光束|声波/, [0.45, 0.75, 1]],
  [/死黑|混乱/, [0.75, 0.35, 1]],
];

function styleFor(weapon: Weapon | undefined): Style {
  const name = (weapon?.name ?? '').replace(/\|c[0-9a-fA-F]{8}|\|r/g, '');
  const pick = (kind: Kind, color?: Rgb): Style => ({ kind, ...STYLES[kind], color: color ?? STYLES[kind].color });
  if (!weapon) return pick('cannon');
  if (/深水炸弹/.test(name)) return pick('depth');
  if (/火焰|燃烧|火神炮/.test(name)) return pick(/火神炮/.test(name) ? 'tracer' : 'flame');
  if (/冷冻/.test(name)) return pick('frost');
  if (/机关炮|近防炮|格林/.test(name)) return pick('tracer');
  if (/火箭|导弹|冲天炮/.test(name)) return pick('rocket');
  if (/箭|弩/.test(name) && !/红箭|真红之箭/.test(name)) return pick('arrow');
  if (/飞斧|阔剑|飞锤/.test(name)) return pick('blade');
  for (const [re, color] of ENERGY_COLORS) if (re.test(name)) return pick('energy', color);
  if (/巨石|攻城|轰击|红衣|战列舰|废墟|土豪|EX|旋风/.test(name)) return pick('heavy');
  return pick('cannon');
}

interface Flight { style: Style; ship: boolean; fromX: number; fromY: number; x: number; y: number; h: number; damage: number; nextTrail: number }

export class ProjectileViews {
  readonly group = new THREE.Group();
  private readonly shells: THREE.InstancedMesh;
  private readonly glows: THREE.InstancedMesh;
  private readonly flights = new Map<number, Flight>();
  private readonly styles = new Map<string, Style>();
  private readonly world: World;
  private readonly fx: Effects;
  private readonly weapons: Map<string, Weapon>;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly axis = new THREE.Vector3(1, 0, 0);
  private readonly dir = new THREE.Vector3();
  private time = 0;
  /** Whether the local side sees a spot (shells in the fog are not drawn). */
  sees: (x: number, y: number) => boolean = () => true;
  /** Shakes the camera for a heavy impact at a spot. */
  onHeavyImpact: ((x: number, y: number, power: number) => void) | undefined;

  constructor(world: World, fx: Effects, weapons: Map<string, Weapon>) {
    this.world = world;
    this.fx = fx;
    this.weapons = weapons;
    this.shells = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.3 }),
      MAX,
    );
    this.glows = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      // Normal blending: additive washes every color to white over the bright sea.
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false }),
      MAX,
    );
    for (const mesh of [this.shells, this.glows]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.setColorAt(0, this.color.set(0xffffff));
      this.group.add(mesh);
    }
    this.glows.renderOrder = 5;
  }

  private styleOf(p: Projectile): Style {
    const key = p.weaponId ?? '';
    let style = this.styles.get(key);
    if (!style) { style = styleFor(p.weaponId ? this.weapons.get(p.weaponId) : undefined); this.styles.set(key, style); }
    return style;
  }

  update(alpha: number, dt: number): void {
    this.time += dt;
    let shells = 0, glows = 0;
    for (const p of this.world.projectiles.values()) {
      let f = this.flights.get(p.id);
      if (!f) {
        f = { style: this.styleOf(p), ship: this.world.unit(p.targetId)?.kind === 'ship', fromX: p.prevX, fromY: p.prevY, x: p.prevX, y: p.prevY, h: 0, damage: p.damage, nextTrail: this.time };
        this.flights.set(p.id, f);
      }
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      // Arc height from the share of the flight already covered.
      const target = this.world.unit(p.targetId);
      const covered = Math.hypot(x - f.fromX, y - f.fromY);
      const total = covered + (target ? Math.hypot(target.x - x, target.y - y) : 0);
      const t = Math.min(1, covered / Math.max(1, total));
      const s = f.style;
      const h = SEA_LEVEL + 40 + Math.sin(t * Math.PI) * Math.min(s.kind === 'depth' ? 320 : 160, total * s.arc);
      const vx = x - f.x, vy = y - f.y, vh = h - f.h;
      f.x = x; f.y = y; f.h = h;
      if (!this.sees(x, y) || shells >= MAX || glows >= MAX) continue;

      this.pos.set(x, h, -y);
      // Shells point along their flight (rockets and bolts are stretched that way).
      const speed = Math.hypot(vx, vy, vh);
      if (speed > 0.01) this.q.setFromUnitVectors(this.axis, this.dir.set(vx, vh, -vy).divideScalar(speed));
      if (s.shell > 0) {
        const long = s.kind === 'rocket' ? 3.2 : s.kind === 'arrow' ? 6 : 1;
        if (s.kind === 'blade') this.q.setFromAxisAngle(this.dir.set(0, 1, 0), this.time * 18 + p.id);
        this.shells.setMatrixAt(shells, this.m.compose(this.pos, this.q, this.scale.set(s.shell * long, s.shell, s.kind === 'blade' ? s.shell * 0.25 : s.shell)));
        this.shells.setColorAt(shells, this.color.setRGB(...(s.kind === 'arrow' || s.kind === 'blade' ? s.color : [0.17, 0.17, 0.19] as Rgb)));
        shells++;
      }
      if (s.glow > 0) {
        const flicker = 0.85 + Math.sin(this.time * 40 + p.id) * 0.15;
        const stretch = s.kind === 'energy' ? 4.5 : s.kind === 'tracer' ? 7 : s.kind === 'rocket' ? 1.6 : 1;
        const r = s.glow * flicker;
        this.glows.setMatrixAt(glows, this.m.compose(this.pos, this.q, this.scale.set(r * stretch, r * 0.8, r * 0.8)));
        this.glows.setColorAt(glows, this.color.setRGB(s.color[0], s.color[1], s.color[2], THREE.SRGBColorSpace));
        glows++;
      }
      if (this.time >= f.nextTrail) {
        f.nextTrail = this.time + s.trailEvery;
        this.trail(s, x, y, h);
      }
    }
    for (const mesh of [this.shells, this.glows]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.shells.count = shells;
    this.glows.count = glows;

    // Shells that left the world landed: their impact, where they were last seen.
    for (const [id, f] of this.flights) {
      if (this.world.projectiles.has(id)) continue;
      this.flights.delete(id);
      if (this.sees(f.x, f.y)) this.impact(f);
    }
  }

  private trail(s: Style, x: number, y: number, h: number): void {
    const fx = this.fx, jitter = () => (Math.random() - 0.5) * 6;
    switch (s.kind) {
      case 'cannon':
      case 'heavy':
        fx.smoke.spawn({ x: x + jitter(), y: y + jitter(), z: h, vz: 8, life: s.kind === 'heavy' ? 0.9 : 0.55, size: s.shell * 1.4, endSize: s.shell * 3.5,
          color: [0.45, 0.43, 0.42], endColor: [0.7, 0.7, 0.72], alpha: 0.45 });
        fx.glow.spawn({ x, y, z: h, life: 0.12, size: s.shell * 1.6, endSize: s.shell * 0.6, color: s.color, alpha: 0.7 });
        break;
      case 'rocket':
        fx.smoke.spawn({ x: x + jitter(), y: y + jitter(), z: h, vz: 12, life: 1.1, size: 9, endSize: 30, color: [0.75, 0.74, 0.72], endColor: [0.85, 0.85, 0.87], alpha: 0.55, drag: 1 });
        fx.core.spawn({ x, y, z: h, life: 0.07, size: 12, endSize: 5, color: [1, 0.8, 0.45] });
        break;
      case 'flame':
        fx.glow.spawn({ x: x + jitter(), y: y + jitter(), z: h, vz: 25, life: 0.35, size: 20, endSize: 6, color: [1, 0.65, 0.15], endColor: [0.8, 0.15, 0.03], alpha: 0.9 });
        fx.smoke.spawn({ x, y, z: h + 6, vz: 30, life: 0.8, size: 12, endSize: 34, color: [0.25, 0.22, 0.2], endColor: [0.45, 0.45, 0.45], alpha: 0.35 });
        break;
      case 'frost':
        fx.glow.spawn({ x: x + jitter(), y: y + jitter(), z: h, life: 0.45, size: 12, endSize: 3, color: [0.75, 0.92, 1], endColor: [0.4, 0.7, 1], alpha: 0.8 });
        break;
      case 'energy':
        fx.glow.spawn({ x, y, z: h, life: 0.22, size: s.glow * 1.1, endSize: 2, color: s.color, alpha: 0.75 });
        break;
      default:
        break;
    }
  }

  private impact(f: Flight): void {
    const fx = this.fx, s = f.style, big = f.damage >= 150;
    switch (s.kind) {
      case 'heavy':
        fx.explosion(f.x, f.y, big ? 75 : 55, f.h);
        this.onHeavyImpact?.(f.x, f.y, big ? 0.45 : 0.25);
        break;
      case 'rocket':
        fx.explosion(f.x, f.y, big ? 55 : 38, f.h);
        if (big) this.onHeavyImpact?.(f.x, f.y, 0.2);
        break;
      case 'flame':
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 80;
          fx.glow.spawn({ x: f.x, y: f.y, z: f.h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 40 + Math.random() * 60, life: 0.5 + Math.random() * 0.4,
            size: 26, endSize: 8, color: [1, 0.6, 0.12], endColor: [0.75, 0.12, 0.02], drag: 2.5, alpha: 0.9 });
        }
        fx.core.spawn({ x: f.x, y: f.y, z: f.h, life: 0.18, size: 50, endSize: 70, color: [1, 0.75, 0.4], alpha: 0.8 });
        break;
      case 'frost':
        fx.ring(f.x, f.y, 10, 70, [0.7, 0.9, 1], 0.5, 0.7);
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 50;
          fx.smoke.spawn({ x: f.x, y: f.y, z: f.h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 20, life: 0.9, size: 16, endSize: 40, color: [0.85, 0.95, 1], alpha: 0.7, drag: 2 });
        }
        break;
      case 'energy':
        fx.core.spawn({ x: f.x, y: f.y, z: f.h, life: 0.16, size: big ? 70 : 46, endSize: big ? 110 : 70, color: s.color, alpha: 0.9 });
        fx.ring(f.x, f.y, 8, big ? 90 : 60, s.color, 0.35, 0.8, f.h);
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2, v = 90 + Math.random() * 120;
          fx.glow.spawn({ x: f.x, y: f.y, z: f.h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: Math.random() * 80, life: 0.3, size: 9, endSize: 2, color: s.color, drag: 3 });
        }
        break;
      case 'depth':
        // Goes off under the surface: a tall column of white water.
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * Math.PI * 2, v = 15 + Math.random() * 40;
          fx.smoke.spawn({ x: f.x, y: f.y, z: SEA_LEVEL + 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 280 + Math.random() * 200, life: 1.1,
            size: 22, endSize: 46, color: [0.92, 0.97, 1], alpha: 0.85, gravity: 520 });
        }
        fx.ring(f.x, f.y, 20, 140, [0.85, 0.95, 1], 0.8, 0.6);
        this.onHeavyImpact?.(f.x, f.y, 0.15);
        break;
      default: {
        const size = big ? 34 : s.kind === 'tracer' || s.kind === 'arrow' ? 12 : 22;
        fx.core.spawn({ x: f.x, y: f.y, z: f.h, life: 0.12, size: size * 1.4, endSize: size * 0.5, color: s.kind === 'tracer' ? [1, 0.9, 0.5] : [1, 0.75, 0.4] });
        if (s.kind === 'cannon') {
          fx.glow.spawn({ x: f.x, y: f.y, z: f.h, life: 0.25, size: size * 1.6, endSize: size * 0.4, color: [1, 0.55, 0.15], endColor: [0.6, 0.15, 0.05] });
          fx.smoke.spawn({ x: f.x, y: f.y, z: f.h, vz: 30, life: 1, size: size, endSize: size * 2.6, color: [0.3, 0.29, 0.28], endColor: [0.55, 0.55, 0.56], alpha: 0.6 });
        }
      }
    }
    // Hits on a hull throw up spray around it.
    if (f.ship && s.kind !== 'depth') fx.splash(f.x + (Math.random() - 0.5) * 30, f.y + (Math.random() - 0.5) * 30, big ? 32 : 20);
  }
}
