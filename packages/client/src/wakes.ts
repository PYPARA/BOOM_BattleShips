// Foam wakes behind moving ships: flat patches laid on the water at the stern and at both
// sides of the bow wave, spreading and fading as the ship pulls away. Their own instanced pool
// (lying flat, not facing the camera), so wakes never crowd out combat effects.
import * as THREE from 'three/webgpu';
import { instancedDynamicBufferAttribute, texture, vec4 } from 'three/tsl';
import type { Team, World } from '@boom/sim';
import { SEA_LEVEL, toThree } from './space.ts';

const MAX_FOAM = 4000;
/** Seconds between foam drops for a ship at full speed. */
const EVERY = 0.07;
const LIFE = 2.6;

interface Foam { x: number; y: number; vx: number; vy: number; age: number; life: number; size0: number; size1: number; alpha: number; turn: number }

function foamTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Speckles, so the foam reads as broken water rather than a disc.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.5})`;
    g.beginPath();
    g.arc(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Wakes {
  readonly mesh: THREE.InstancedMesh;
  private readonly foam: Foam[] = [];
  private readonly alphas: THREE.InstancedBufferAttribute;
  private readonly next = new Map<number, number>();
  private readonly world: World;
  private readonly team: Team;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly spin = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly scale = new THREE.Vector3();
  private time = 0;

  constructor(world: World, team: Team) {
    this.world = world;
    this.team = team;
    this.alphas = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FOAM * 4), 4);
    this.alphas.setUsage(THREE.DynamicDrawUsage);
    const tint = instancedDynamicBufferAttribute(this.alphas, 'vec4') as unknown as ReturnType<typeof vec4>;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: true });
    const tex = texture(foamTexture());
    material.colorNode = vec4(tint.rgb.mul(tex.rgb), 1);
    material.opacityNode = tint.a.mul(tex.a);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, MAX_FOAM);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'wakes';
  }

  private drop(x: number, y: number, vx: number, vy: number, size: number, grow: number, alpha: number): void {
    if (this.foam.length >= MAX_FOAM) return;
    this.foam.push({ x, y, vx, vy, age: 0, life: LIFE * (0.8 + Math.random() * 0.4), size0: size, size1: size * grow, alpha, turn: Math.random() * Math.PI * 2 });
  }

  update(dt: number): void {
    this.time += dt;
    for (const ship of this.world.ships.values()) {
      if (ship.locust || ship.maxSpeed <= 0) continue;
      const speed = ship.speed / Math.max(1, ship.maxSpeed);
      if (speed < 0.15 || !this.world.seenBy(this.team, ship)) { this.next.delete(ship.id); continue; }
      const at = this.next.get(ship.id) ?? this.time;
      if (this.time < at) continue;
      this.next.set(ship.id, this.time + EVERY / Math.min(1, speed + 0.2));
      const r = ship.bodyRadius;
      const fx = Math.cos(ship.facing), fy = Math.sin(ship.facing);
      // A submerged submarine only stirs a faint trail.
      const strength = ship.submerged ? 0.35 : Math.min(1, 0.4 + speed * 0.6);
      // Stern: churned water straight behind.
      this.drop(ship.x - fx * r * 0.9, ship.y - fy * r * 0.9, -fx * 10, -fy * 10, r * 0.55, 2.4, 0.7 * strength);
      // Bow wave: foam pushed out to both sides, opening into a V.
      for (const side of [-1, 1]) {
        const sx = -fy * side, sy = fx * side;
        this.drop(ship.x + fx * r * 0.5 + sx * r * 0.35, ship.y + fy * r * 0.5 + sy * r * 0.35, sx * 38 * strength, sy * 38 * strength, r * 0.3, 2.8, 0.55 * strength);
      }
    }
    // Ships that left the world drop out of the timer map.
    if (this.next.size > this.world.ships.size * 2) for (const id of this.next.keys()) if (!this.world.ships.has(id)) this.next.delete(id);

    let n = 0;
    const out = this.alphas.array as Float32Array;
    // Compacted in place: no new array each frame.
    let keep = 0;
    for (const f of this.foam) {
      f.age += dt;
      if (f.age >= f.life) continue;
      this.foam[keep++] = f;
      const t = f.age / f.life;
      const k = Math.exp(-0.9 * dt);
      f.vx *= k; f.vy *= k;
      f.x += f.vx * dt; f.y += f.vy * dt;
      const size = f.size0 + (f.size1 - f.size0) * Math.sqrt(t);
      toThree(f.x, f.y, SEA_LEVEL + 1.5, this.pos);
      this.spin.setFromAxisAngle(this.up, f.turn);
      this.q.copy(this.spin).multiply(this.flat);
      this.mesh.setMatrixAt(n, this.m.compose(this.pos, this.q, this.scale.set(size, size, size)));
      out[n * 4] = out[n * 4 + 1] = out[n * 4 + 2] = 0.9;
      out[n * 4 + 3] = f.alpha * (1 - t) * Math.min(1, t * 8);
      n++;
    }
    this.foam.length = keep;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphas.needsUpdate = true;
  }
}
