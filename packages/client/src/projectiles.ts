// Cannonballs: one instanced mesh for every projectile in flight, interpolated between ticks
// and lifted on a shallow arc.
import * as THREE from 'three/webgpu';
import type { World } from '@boom/sim';
import { SEA_LEVEL } from './space.ts';

const MAX = 1024;

export class ProjectileViews {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly launch = new Map<number, { x: number; y: number }>();
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(7, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.4, emissive: 0xff8a2a, emissiveIntensity: 0.35 }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(alpha: number): void {
    let i = 0;
    for (const p of this.world.projectiles.values()) {
      if (i >= MAX) break;
      if (!this.launch.has(p.id)) this.launch.set(p.id, { x: p.prevX, y: p.prevY });
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      // Arc height from the share of the flight already covered.
      const from = this.launch.get(p.id)!;
      const target = this.world.unit(p.targetId);
      const covered = Math.hypot(x - from.x, y - from.y);
      const total = covered + (target ? Math.hypot(target.x - x, target.y - y) : 0);
      const t = Math.min(1, covered / Math.max(1, total));
      const h = SEA_LEVEL + 40 + Math.sin(t * Math.PI) * Math.min(160, total * 0.15);
      this.matrix.makeTranslation(x, h, -y);
      this.mesh.setMatrixAt(i++, this.matrix);
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const id of this.launch.keys()) if (!this.world.projectiles.has(id)) this.launch.delete(id);
  }
}
