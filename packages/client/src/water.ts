// Sea surface: depth-tinted color, shoreline foam and animated wave normals (TSL, so it runs
// on both the WebGPU and WebGL2 backends). Water depth is baked per vertex from the terrain
// corners instead of sampled from a texture, which keeps it independent of float-texture
// support on either backend.
import * as THREE from 'three/webgpu';
import {
  abs, attribute, clamp, cos, float, mix, normalize, positionWorld, sin, smoothstep, time, transformNormalToView, vec2, vec3,
} from 'three/tsl';
import type { Terrain } from '@boom/gamedata';
import { SEA_LEVEL } from './space.ts';

/** Open sea beyond the map edge extends this far, so the horizon is never bare. */
const MARGIN = 8000;
const OPEN_SEA_DEPTH = 400;

function createWaterGeometry(terrain: Terrain): THREE.BufferGeometry {
  // The terrain corner grid plus one extra ring of vertices out at the margin.
  const w = terrain.width + 2, h = terrain.height + 2;
  const lastX = terrain.originX + (terrain.width - 1) * 128, lastY = terrain.originY + (terrain.height - 1) * 128;
  const coord = (k: number, n: number, origin: number, last: number) =>
    k === 0 ? origin - MARGIN : k === n - 1 ? last + MARGIN : origin + (k - 1) * 128;
  const positions = new Float32Array(w * h * 3);
  const depths = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      positions.set([coord(i, w, terrain.originX, lastX), SEA_LEVEL, -coord(j, h, terrain.originY, lastY)], k * 3);
      const inside = i > 0 && j > 0 && i < w - 1 && j < h - 1;
      depths[k] = inside ? SEA_LEVEL - terrain.groundHeight[(j - 1) * terrain.width + (i - 1)]! : OPEN_SEA_DEPTH;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(w * h * 3).map((_, n) => (n % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('depth', new THREE.BufferAttribute(depths, 1));
  geometry.setIndex(indices);
  return geometry;
}

export function createWater(terrain: Terrain): THREE.Mesh {
  const depth = attribute<'float'>('depth', 'float');
  const mapXY = vec2(positionWorld.x, positionWorld.z.negate());

  // Sum of a few directional waves; only their slopes are used, for lighting.
  const t = time.mul(0.6);
  const p = mapXY.mul(0.004);
  const w1 = cos(p.x.mul(1.0).add(p.y.mul(0.6)).add(t.mul(1.3)));
  const w2 = cos(p.x.mul(-0.7).add(p.y.mul(1.1)).add(t.mul(1.7)));
  const w3 = cos(p.x.mul(2.3).add(p.y.mul(-1.9)).add(t.mul(2.4)));
  const slopeX = w1.mul(1.0).add(w2.mul(-0.7)).add(w3.mul(1.15)).mul(0.08);
  const slopeY = w1.mul(0.6).add(w2.mul(1.1)).add(w3.mul(-0.95)).mul(0.08);
  const normal = normalize(vec3(slopeX.negate(), float(1), slopeY));

  const shallow = vec3(0.16, 0.52, 0.58);
  const deep = vec3(0.03, 0.16, 0.3);
  const waterColor = mix(shallow, deep, smoothstep(10, 200, depth));
  // Foam band along the shore, broken up by a moving ripple pattern.
  const ripple = sin(depth.mul(0.25).sub(time.mul(2.0))).mul(0.5).add(0.5);
  const foam = float(1).sub(smoothstep(5, 45, depth)).mul(ripple.mul(0.6).add(0.4));
  const crest = smoothstep(0.75, 1.0, abs(w1.mul(w2))).mul(0.12);

  const material = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: 0.18, metalness: 0.05 });
  material.colorNode = mix(waterColor, vec3(0.95, 0.97, 0.97), clamp(foam.add(crest), 0, 1));
  material.normalNode = transformNormalToView(normal);
  material.opacityNode = mix(float(0.6), float(0.96), smoothstep(0, 90, depth));
  const mesh = new THREE.Mesh(createWaterGeometry(terrain), material);
  mesh.name = 'water';
  mesh.renderOrder = 1;
  return mesh;
}
