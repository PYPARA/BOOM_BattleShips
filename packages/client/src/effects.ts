// Visual effects: a small CPU particle system drawn as three instanced quad pools (colored fire,
// sparks and magic; smoke and spray; a few additive hot cores), plus expanding rings, lightning
// bolts and shield bubbles. Over the bright sea, additive blending washes every color out to
// white, so only small cores use it. The presets at the bottom (explosion, frost, lightning…) are what
// fx.ts calls for skills and combat events. Positions are in sim space (x, y, height).
import * as THREE from 'three/webgpu';
import {
  abs, color as colorNode, dot, float, instancedDynamicBufferAttribute, normalView, positionViewDirection, pow, texture, uniform, vec4,
} from 'three/tsl';
import { SEA_LEVEL, toThree } from './space.ts';

export type Rgb = [number, number, number];

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number; life: number;
  size0: number; size1: number;
  c0: Rgb; c1: Rgb;
  a0: number; a1: number;
  gravity: number; drag: number;
}

export interface ParticleSpec {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number;
  size: number; endSize?: number;
  color: Rgb; endColor?: Rgb;
  alpha?: number; endAlpha?: number;
  gravity?: number; drag?: number;
}

const MAX_PARTICLES = 5000;

/** Preset colors are picked in sRGB; materials work in linear space. */
const lin = (c: number) => c ** 2.2;

/** A soft round sprite, drawn once into a canvas. */
function softTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor(sprite: THREE.Texture, additive: boolean) {
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    const tint = instancedDynamicBufferAttribute(this.colors, 'vec4') as unknown as ReturnType<typeof vec4>;
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, fog: false, toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const tex = texture(sprite);
    material.colorNode = vec4(tint.rgb.mul(tex.rgb), 1);
    material.opacityNode = tint.a.mul(tex.a);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, MAX_PARTICLES);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = additive ? 4 : 3;
  }

  spawn(s: ParticleSpec): void {
    if (this.particles.length >= MAX_PARTICLES) return; // a full pool drops new sparks, not old ones
    this.particles.push({
      x: s.x, y: s.y, z: s.z, vx: s.vx ?? 0, vy: s.vy ?? 0, vz: s.vz ?? 0, age: 0, life: s.life,
      size0: s.size, size1: s.endSize ?? s.size, c0: s.color, c1: s.endColor ?? s.color,
      a0: s.alpha ?? 1, a1: s.endAlpha ?? 0, gravity: s.gravity ?? 0, drag: s.drag ?? 0,
    });
  }

  update(dt: number, camera: THREE.Camera): void {
    let n = 0;
    const colors = this.colors.array as Float32Array;
    // Compacted in place: live particles keep the front of the list.
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      this.particles[n] = p;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz = p.vz * k - p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.age / p.life;
      const size = p.size0 + (p.size1 - p.size0) * t;
      toThree(p.x, p.y, p.z, this.pos);
      this.matrix.compose(this.pos, camera.quaternion, this.scale.set(size, size, size));
      this.mesh.setMatrixAt(n, this.matrix);
      colors[n * 4] = lin(p.c0[0] + (p.c1[0] - p.c0[0]) * t);
      colors[n * 4 + 1] = lin(p.c0[1] + (p.c1[1] - p.c0[1]) * t);
      colors[n * 4 + 2] = lin(p.c0[2] + (p.c1[2] - p.c0[2]) * t);
      colors[n * 4 + 3] = p.a0 + (p.a1 - p.a0) * t;
      n++;
    }
    this.particles.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colors.needsUpdate = true;
  }
}

/** Rings and bolts are pooled with their materials: a new node material per effect would be
 * built into a shader on its first frame, a visible hitch in a big fight. */
interface Pooled { mesh: THREE.Mesh; opacity: { value: number }; color: { value: THREE.Color } }
interface Ring extends Pooled { age: number; life: number; from: number; to: number; alpha: number }
interface Bolt extends Pooled { age: number; life: number }
/** Something that keeps spawning particles for a while (smoke over a wreck, a burning area). */
interface Emitter { until: number; every: number; next: number; spawn: () => void }

export class Effects {
  readonly group = new THREE.Group();
  readonly glow: ParticlePool;
  readonly smoke: ParticlePool;
  /** Additive: small, very bright centers of flashes and blasts. */
  readonly core: ParticlePool;
  private readonly rings: Ring[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly freeRings: Pooled[] = [];
  private readonly freeBolts: Pooled[] = [];
  private readonly ringGeometry = new THREE.RingGeometry(0.82, 1, 48);
  private readonly emitters: Emitter[] = [];
  private readonly shields = new Map<number, THREE.Mesh>();
  private readonly shieldMaterial: THREE.MeshBasicNodeMaterial;
  private time = 0;

  constructor() {
    this.group.name = 'effects';
    const sprite = softTexture();
    this.glow = new ParticlePool(sprite, false);
    this.smoke = new ParticlePool(sprite, false);
    this.core = new ParticlePool(sprite, true);
    this.group.add(this.smoke.mesh, this.glow.mesh, this.core.mesh);
    // Shield bubble: bright at the rim, clear in the middle (fresnel).
    this.shieldMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false, fog: false });
    const rim = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), float(2.2));
    this.shieldMaterial.colorNode = vec4(lin(0.45), lin(0.8), 1, 1);
    this.shieldMaterial.opacityNode = rim.mul(0.75).add(0.08);
  }

  get now(): number { return this.time; }

  /** An expanding flat ring on the water (shockwaves, frost, summoning circles). */
  ring(x: number, y: number, from: number, to: number, color: Rgb, life = 0.6, alpha = 0.9, z = SEA_LEVEL + 4): void {
    const r = this.freeRings.pop() ?? this.pooled(this.ringGeometry, THREE.NormalBlending, 3);
    r.mesh.rotation.set(-Math.PI / 2, 0, 0);
    r.color.value.setRGB(lin(color[0]), lin(color[1]), lin(color[2]));
    r.opacity.value = alpha;
    toThree(x, y, z, r.mesh.position);
    r.mesh.scale.setScalar(from);
    this.group.add(r.mesh);
    this.rings.push({ ...r, age: 0, life, from, to, alpha });
  }

  /** A jagged lightning bolt between two points, flickering out over `life`. */
  bolt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: Rgb = [0.7, 0.85, 1], life = 0.3, width = 10): void {
    const a = toThree(ax, ay, az, new THREE.Vector3()), b = toThree(bx, by, bz, new THREE.Vector3());
    const segments = Math.max(4, Math.round(a.distanceTo(b) / 40));
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const p = a.clone().lerp(b, i / segments);
      if (i > 0 && i < segments) p.add(new THREE.Vector3((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 50));
      points.push(p);
    }
    // A flat ribbon facing up-ish is enough from the RTS camera.
    const positions: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i]!, q = points[i + 1]!;
      const side = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(width / 2);
      positions.push(...p.clone().add(side).toArray(), ...p.clone().sub(side).toArray(), ...q.clone().add(side).toArray());
      positions.push(...p.clone().sub(side).toArray(), ...q.clone().sub(side).toArray(), ...q.clone().add(side).toArray());
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const bolt = this.freeBolts.pop() ?? this.pooled(geometry, THREE.AdditiveBlending, 4);
    if (bolt.mesh.geometry !== geometry) { bolt.mesh.geometry.dispose(); bolt.mesh.geometry = geometry; }
    bolt.color.value.setRGB(lin(color[0]), lin(color[1]), lin(color[2]));
    bolt.opacity.value = 1;
    this.group.add(bolt.mesh);
    this.bolts.push({ ...bolt, age: 0, life });
  }

  /** A ring or bolt mesh with its own color and opacity uniforms (one shader for all of them). */
  private pooled(geometry: THREE.BufferGeometry, blending: THREE.Blending, renderOrder: number): Pooled {
    const opacity = uniform(1);
    const color = uniform(new THREE.Color());
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending, side: THREE.DoubleSide, fog: false });
    material.colorNode = vec4(colorNode(color), 1);
    material.opacityNode = opacity;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    return { mesh, opacity, color: color as unknown as { value: THREE.Color } };
  }

  emit(seconds: number, every: number, spawn: () => void, delay = 0): void {
    this.emitters.push({ until: this.time + delay + seconds, every, next: this.time + delay, spawn });
  }

  /** Runs `fn` once after `seconds` (a missile landing). */
  after(seconds: number, fn: () => void): void {
    this.emit(0.001, 1, fn, seconds);
  }

  /** Shows or hides the shield bubble on a unit (radius in world units). */
  shield(unitId: number, on: boolean, x = 0, y = 0, radius = 60): void {
    let mesh = this.shields.get(unitId);
    if (!on) {
      if (mesh) { mesh.removeFromParent(); this.shields.delete(unitId); }
      return;
    }
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), this.shieldMaterial);
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.shields.set(unitId, mesh);
    }
    toThree(x, y, SEA_LEVEL + radius * 0.25, mesh.position);
    const pulse = 1 + Math.sin(this.time * 4 + unitId) * 0.03;
    mesh.scale.set(radius * 1.25 * pulse, radius * 0.8 * pulse, radius * 1.25 * pulse);
  }

  /** Drops shield bubbles for units that are gone or no longer shielded. */
  pruneShields(keep: Set<number>): void {
    for (const id of [...this.shields.keys()]) if (!keep.has(id)) this.shield(id, false);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    for (const e of this.emitters) {
      while (e.next <= this.time && e.next < e.until) { e.spawn(); e.next += e.every; }
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) if (this.emitters[i]!.next >= this.emitters[i]!.until) this.emitters.splice(i, 1);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.age += dt;
      const t = Math.min(1, r.age / r.life);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * (1 - (1 - t) ** 2));
      r.opacity.value = r.alpha * (1 - t);
      if (t >= 1) { r.mesh.removeFromParent(); this.freeRings.push(r); this.rings.splice(i, 1); }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.age += dt;
      b.opacity.value = Math.max(0, 1 - b.age / b.life) * (0.6 + Math.random() * 0.4);
      if (b.age >= b.life) { b.mesh.removeFromParent(); this.freeBolts.push(b); this.bolts.splice(i, 1); }
    }
    this.glow.update(dt, camera);
    this.smoke.update(dt, camera);
    this.core.update(dt, camera);
  }

  // Presets ---------------------------------------------------------------------------------

  explosion(x: number, y: number, size = 60, z = SEA_LEVEL + 15): void {
    this.core.spawn({ x, y, z: z + 10, life: 0.22, size: size * 1.2, endSize: size * 2, color: [1, 0.8, 0.45], alpha: 0.9 });
    this.glow.spawn({ x, y, z: z + 5, life: 0.35, size: size * 1.4, endSize: size * 2.2, color: [1, 0.55, 0.15], endColor: [0.6, 0.15, 0.05], alpha: 0.85 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, v = size * (1.5 + Math.random() * 2.5);
      this.glow.spawn({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: v * (0.5 + Math.random()), life: 0.45 + Math.random() * 0.3,
        size: size * 0.75, endSize: size * 0.25, color: [1, 0.6, 0.12], endColor: [0.8, 0.12, 0.03], drag: 3, gravity: 120 });
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, v = size * (0.6 + Math.random());
      this.smoke.spawn({ x, y, z: z + 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 40 + Math.random() * 40, life: 1.4 + Math.random(),
        size: size * 0.9, endSize: size * 2.4, color: [0.32, 0.3, 0.29], endColor: [0.55, 0.55, 0.56], alpha: 0.7, drag: 1.5 });
    }
    this.ring(x, y, size * 0.4, size * 2.4, [1, 0.7, 0.4], 0.5, 0.7);
  }

  splash(x: number, y: number, size = 30): void {
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, v = size * (0.8 + Math.random() * 1.4);
      this.smoke.spawn({ x, y, z: SEA_LEVEL + 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: size * (4 + Math.random() * 3), life: 0.7,
        size: size * 0.45, endSize: size * 0.9, color: [0.92, 0.97, 1], alpha: 0.85, gravity: size * 14 });
    }
    this.ring(x, y, size * 0.3, size * 1.6, [0.85, 0.95, 1], 0.6, 0.5);
  }

  /** Muzzle flash and a puff of smoke, pushed a little toward the target. */
  muzzle(x: number, y: number, dx: number, dy: number, z = SEA_LEVEL + 35): void {
    const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    this.core.spawn({ x: x + ux * 20, y: y + uy * 20, z, vx: ux * 60, vy: uy * 60, life: 0.1, size: 30, endSize: 14, color: [1, 0.75, 0.35] });
    this.glow.spawn({ x: x + ux * 24, y: y + uy * 24, z, vx: ux * 60, vy: uy * 60, life: 0.14, size: 26, endSize: 10, color: [1, 0.6, 0.15] });
    this.smoke.spawn({ x: x + ux * 30, y: y + uy * 30, z, vx: ux * 50, vy: uy * 50, vz: 20, life: 0.9, size: 18, endSize: 46,
      color: [0.75, 0.75, 0.75], alpha: 0.45, drag: 2 });
  }

  fire(x: number, y: number, radius: number, z = SEA_LEVEL + 8): void {
    const n = Math.min(40, Math.max(8, Math.round(radius / 12)));
    for (let i = 0; i < n; i++) {
      const r = radius * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      this.glow.spawn({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z, vz: 60 + Math.random() * 80, life: 0.6 + Math.random() * 0.5,
        size: 40 + Math.random() * 30, endSize: 10, color: [1, 0.55, 0.08], endColor: [0.75, 0.08, 0.02], alpha: 0.95 });
      if (i % 3 === 0) this.core.spawn({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z, vz: 80, life: 0.4, size: 30, endSize: 6, color: [0.9, 0.45, 0.1] });
    }
    for (let i = 0; i < n / 3; i++) {
      const r = radius * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      this.smoke.spawn({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z: z + 40, vz: 50, life: 1.6, size: 40, endSize: 90,
        color: [0.25, 0.22, 0.2], endColor: [0.45, 0.44, 0.44], alpha: 0.45, drag: 0.6 });
    }
  }

  frost(x: number, y: number, radius: number): void {
    const n = Math.min(50, Math.max(12, Math.round(radius / 10)));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = radius * (0.6 + Math.random() * 0.8);
      this.glow.spawn({ x, y, z: SEA_LEVEL + 15, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 30 + Math.random() * 60, life: 0.8,
        size: 18, endSize: 4, color: [0.75, 0.92, 1], endColor: [0.3, 0.6, 1], drag: 2.5 });
    }
    this.ring(x, y, radius * 0.2, radius, [0.6, 0.85, 1], 0.7, 0.9);
    this.ring(x, y, radius * 0.1, radius * 0.75, [0.85, 0.95, 1], 0.9, 0.6);
  }

  lightning(ax: number, ay: number, bx: number, by: number): void {
    this.bolt(ax, ay, SEA_LEVEL + 50, bx, by, SEA_LEVEL + 40, [0.2, 0.4, 1], 0.35, 16);
    this.bolt(ax, ay, SEA_LEVEL + 50, bx, by, SEA_LEVEL + 40, [0.7, 0.85, 1], 0.2, 5);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 120;
      this.glow.spawn({ x: bx, y: by, z: SEA_LEVEL + 40, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: Math.random() * 100, life: 0.35,
        size: 14, endSize: 3, color: [0.85, 0.92, 1], drag: 3 });
    }
  }

  /** A pulse of energy around the caster (EMP, war stomp without the ice). */
  pulse(x: number, y: number, radius: number, color: Rgb): void {
    this.ring(x, y, radius * 0.1, radius, color, 0.55, 0.95);
    this.glow.spawn({ x, y, z: SEA_LEVEL + 30, life: 0.3, size: radius * 0.5, endSize: radius * 0.9, color, alpha: 0.6 });
  }

  summon(x: number, y: number, radius: number, color: Rgb = [0.35, 0.6, 1]): void {
    this.ring(x, y, radius, radius * 0.2, color, 0.8, 0.9);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.glow.spawn({ x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius, z: SEA_LEVEL + 10,
        vx: -Math.cos(a) * radius * 0.9, vy: -Math.sin(a) * radius * 0.9, vz: 90, life: 0.9, size: 16, endSize: 6, color, drag: 1 });
    }
    this.glow.spawn({ x, y, z: SEA_LEVEL + 40, life: 0.6, size: radius * 0.6, endSize: radius * 1.1, color, alpha: 0.5 });
  }

  heal(x: number, y: number, radius: number): void {
    const n = Math.min(30, Math.max(8, Math.round(radius / 15)));
    for (let i = 0; i < n; i++) {
      const r = radius * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      this.glow.spawn({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z: SEA_LEVEL + 20, vz: 70 + Math.random() * 50, life: 1,
        size: 14, endSize: 4, color: [0.5, 1, 0.55], endColor: [0.9, 1, 0.6] });
    }
    this.ring(x, y, radius * 0.3, radius, [0.45, 1, 0.55], 0.8, 0.6);
  }

  curse(x: number, y: number, radius: number, color: Rgb = [0.75, 0.45, 1]): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = radius * Math.random();
      this.smoke.spawn({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z: SEA_LEVEL + 30, vz: 40, life: 1.1, size: 30, endSize: 60,
        color, endColor: [0.2, 0.1, 0.3], alpha: 0.55, drag: 1 });
    }
    this.ring(x, y, radius * 0.2, radius, color, 0.6, 0.7);
  }

  /** A flash where a ship vanishes or appears (blink, jump). */
  flash(x: number, y: number, color: Rgb = [0.75, 0.9, 1]): void {
    this.core.spawn({ x, y, z: SEA_LEVEL + 40, life: 0.3, size: 100, endSize: 30, color: [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6] });
    this.glow.spawn({ x, y, z: SEA_LEVEL + 35, life: 0.45, size: 110, endSize: 40, color, alpha: 0.6 });
    this.ring(x, y, 20, 140, color, 0.45, 0.8);
  }

  /** A wreck going down: fire, then a column of smoke and a ring on the water. */
  sinking(x: number, y: number, size: number): void {
    this.explosion(x, y, size * 0.7);
    this.emit(3.2, 0.12, () => {
      this.smoke.spawn({ x: x + (Math.random() - 0.5) * size * 0.6, y: y + (Math.random() - 0.5) * size * 0.6, z: SEA_LEVEL + 20,
        vx: 15, vy: 10, vz: 70 + Math.random() * 40, life: 2.4, size: size * 0.45, endSize: size * 1.3,
        color: [0.2, 0.19, 0.18], endColor: [0.5, 0.5, 0.52], alpha: 0.6, drag: 0.4 });
      if (Math.random() < 0.5) this.glow.spawn({ x: x + (Math.random() - 0.5) * size * 0.5, y: y + (Math.random() - 0.5) * size * 0.5, z: SEA_LEVEL + 15,
        vz: 60, life: 0.5, size: size * 0.35, endSize: 6, color: [1, 0.6, 0.15], endColor: [0.8, 0.15, 0.02] });
    });
    this.ring(x, y, size * 0.5, size * 2.2, [0.85, 0.95, 1], 1.6, 0.45);
  }
}
