// Sea surface: depth-tinted color, shoreline foam and animated wave normals (TSL, so it runs
// on both the WebGPU and WebGL2 backends). Above low quality, two scrolling layers of fine
// ripples (a tiling normal map drawn at startup) add sun glitter, foam rolls in toward the
// shore in broken bands, shallow water shows caustics, and the surface turns more reflective
// and opaque toward the horizon (fresnel). Water depth is baked per vertex from the terrain
// corners instead of sampled from a texture, which keeps it independent of float-texture
// support on either backend.
import * as THREE from 'three/webgpu';
import {
  abs, attribute, clamp, cos, dot, float, max, mix, normalize, normalView, positionViewDirection, positionWorld, pow, sin, smoothstep, texture,
  time, transformNormalToView, vec2, vec3,
} from 'three/tsl';
import type { Terrain } from '@boom/gamedata';
import type { FogLayer } from './fog.ts';
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

/**
 * A seamless ripple normal map: a sum of waves whose frequencies are whole numbers of cycles
 * across the tile, with the slopes worked out exactly. Alpha holds the height, for foam noise.
 */
function rippleTexture(size = 256): THREE.DataTexture {
  const waves: { kx: number; ky: number; a: number; phase: number }[] = [];
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 24; i++) {
    const f = 2 + Math.floor(random() * 14);
    const angle = random() * Math.PI * 2;
    waves.push({ kx: Math.round(Math.cos(angle) * f), ky: Math.round(Math.sin(angle) * f), a: 1 / f, phase: random() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = 0, dx = 0, dy = 0;
      for (const w of waves) {
        const arg = (2 * Math.PI * (w.kx * x + w.ky * y)) / size + w.phase;
        h += w.a * Math.sin(arg);
        dx += w.a * w.kx * Math.cos(arg);
        dy += w.a * w.ky * Math.cos(arg);
      }
      const len = Math.hypot(dx * 0.12, dy * 0.12, 1);
      const o = (y * size + x) * 4;
      data[o] = ((-dx * 0.12) / len) * 127.5 + 127.5;
      data[o + 1] = ((-dy * 0.12) / len) * 127.5 + 127.5;
      data[o + 2] = (1 / len) * 127.5 + 127.5;
      data[o + 3] = Math.max(0, Math.min(255, h * 60 + 128));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createWater(terrain: Terrain, fog?: FogLayer, detailed = true): THREE.Mesh {
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
  const shallow = vec3(0.16, 0.52, 0.58);
  const deep = vec3(0.03, 0.16, 0.3);
  const waterColor = mix(shallow, deep, smoothstep(10, 200, depth));
  // Faint crests where three waves line up; two alone repeat as a visible dot grid.
  const crest = smoothstep(0.82, 1.0, abs(w1.mul(w2).mul(w3))).mul(0.06);
  const material = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: detailed ? 0.15 : 0.18, metalness: 0.05 });

  if (!detailed) {
    // Low quality: the broad waves and a simple shore band.
    const ripple = sin(depth.mul(0.25).sub(time.mul(2.0))).mul(0.5).add(0.5);
    const foam = float(1).sub(smoothstep(5, 45, depth)).mul(ripple.mul(0.6).add(0.4));
    const surface = mix(waterColor, vec3(0.95, 0.97, 0.97), clamp(foam.add(crest), 0, 1));
    material.colorNode = fog ? surface.mul(fog.shade()) : surface;
    material.normalNode = transformNormalToView(normalize(vec3(slopeX.negate(), float(1), slopeY)));
    material.opacityNode = mix(float(0.6), float(0.96), smoothstep(0, 90, depth));
  } else {
    // Two ripple layers drifting different ways, on top of the broad waves.
    const ripples = rippleTexture();
    const a = texture(ripples, mapXY.div(620).add(vec2(time.mul(0.018), time.mul(0.011))));
    const b = texture(ripples, mapXY.div(260).add(vec2(time.mul(-0.013), time.mul(0.024))));
    const fine = a.xy.sub(0.5).mul(0.45).add(b.xy.sub(0.5).mul(0.3));
    const normal = normalize(vec3(slopeX.add(fine.x).negate(), float(1), slopeY.add(fine.y)));

    // Shore foam: bands that roll in toward the beach, broken up by the ripple heights.
    const noise = a.w.mul(0.6).add(b.w.mul(0.4));
    const shore = float(1).sub(smoothstep(3, 24, depth));
    const bands = smoothstep(0.7, 0.98, sin(depth.mul(0.35).add(time.mul(1.6))).mul(0.5).add(0.5));
    const foam = shore.mul(bands.mul(0.45).add(float(1).sub(smoothstep(2, 7, depth)).mul(0.7))).mul(smoothstep(0.38, 0.62, noise));
    // Caustics: where the two layers' heights cross, bright threads on shallow ground.
    const caustic = pow(float(1).sub(abs(a.w.sub(b.w)).mul(2.2)).clamp(0, 1), float(6)).mul(float(1).sub(smoothstep(8, 70, depth))).mul(0.18);

    // Fresnel: straight down the sea is clear; toward the horizon it mirrors the sky.
    const facing = max(dot(normalView, positionViewDirection), 0);
    const fresnel = pow(float(1).sub(facing), float(4));
    const skyTint = vec3(0.55, 0.72, 0.85);
    const surface = mix(mix(waterColor, skyTint, fresnel.mul(0.45)).add(vec3(caustic, caustic, caustic.mul(0.85))), vec3(0.96, 0.98, 0.98), clamp(foam.add(crest), 0, 1));
    material.colorNode = fog ? surface.mul(fog.shade()) : surface;
    material.normalNode = transformNormalToView(normal);
    material.opacityNode = clamp(mix(float(0.55), float(0.96), smoothstep(0, 90, depth)).add(fresnel.mul(0.35)).add(foam.mul(0.4)), 0, 1);
  }
  const mesh = new THREE.Mesh(createWaterGeometry(terrain), material);
  mesh.name = 'water';
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  return mesh;
}
