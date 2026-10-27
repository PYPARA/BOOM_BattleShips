// The fog of war on screen: the local side's vision grid as a small texture, eased over time so
// sight edges glide instead of popping, which the terrain and water shaders use to darken what
// the side cannot see.
import * as THREE from 'three/webgpu';
import { float, mix, positionWorld, texture, vec2, vec3 } from 'three/tsl';
import { VISION_CELL, type Team, type World } from '@boom/sim';

export class FogLayer {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly level: Float32Array;
  private readonly world: World;
  private readonly team: Team;

  constructor(world: World, team: Team) {
    this.world = world;
    this.team = team;
    const { width, height } = world.vision;
    this.data = new Uint8Array(width * height * 4);
    this.level = new Float32Array(width * height).fill(1);
    this.texture = new THREE.DataTexture(this.data, width, height, THREE.RGBAFormat);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.update(1);
  }

  /** Eases toward the current vision; call every frame. */
  update(dt: number): void {
    const v = this.world.vision;
    const seen = this.team === 'south' || this.team === 'north' ? v.grid(this.team) : undefined;
    const k = Math.min(1, dt * 5);
    for (let i = 0; i < this.level.length; i++) {
      const target = !v.enabled || !seen || seen[i] ? 1 : 0;
      this.level[i]! += (target - this.level[i]!) * k;
      this.data[i * 4] = Math.round(this.level[i]! * 255);
    }
    this.texture.needsUpdate = true;
  }

  /** Eased visibility (0 fog … 1 seen) at a sim-space point. */
  levelAt(x: number, y: number): number {
    const v = this.world.vision;
    const i = Math.floor((x - v.originX) / VISION_CELL), j = Math.floor((y - v.originY) / VISION_CELL);
    if (i < 0 || j < 0 || i >= v.width || j >= v.height) return 0;
    return this.level[j * v.width + i]!;
  }

  /**
   * Darkens instanced decorations in the fog through their instance colors (their materials come
   * from the models, so the terrain's shader trick does not reach them). Call a few times a second.
   */
  tintInstances(group: THREE.Object3D): void {
    const color = new THREE.Color();
    group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      const spots = mesh.userData.spots as [number, number][] | undefined;
      if (!mesh.isInstancedMesh || !spots) return;
      // The first tint adds the instance colors; the material must be rebuilt to use them.
      if (!mesh.instanceColor) (mesh.material as THREE.Material).needsUpdate = true;
      spots.forEach(([x, y], i) => {
        const lit = this.levelAt(x, y);
        mesh.setColorAt(i, color.setRGB(0.34 + 0.66 * lit, 0.38 + 0.62 * lit, 0.48 + 0.52 * lit));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  /**
   * How lit a world-space point is: 1 in sight, about 0.4 in the fog, tinted cool. Multiply a
   * material's color by it.
   */
  shade() {
    const v = this.world.vision;
    // Vision rows run from the map's south-west corner; sim y is three.js −z.
    const uv = vec2(
      positionWorld.x.sub(v.originX).div(v.width * VISION_CELL),
      positionWorld.z.negate().sub(v.originY).div(v.height * VISION_CELL),
    );
    const lit = texture(this.texture, uv).r;
    return mix(vec3(0.34, 0.38, 0.48), vec3(1, 1, 1), lit.mul(float(1)));
  }
}
