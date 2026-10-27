// Island and seabed mesh built from the map's terrain corner grid, textured with the painted
// ground tiles (tools/art/src/textures.ts): each corner's Warcraft tile picks its texture,
// steep slopes and cliff faces turn to rock, the waterline to sand and the sea floor to seabed.
// The grid is subdivided once so cliff steps can be drawn as short, steep faces.
import * as THREE from 'three/webgpu';
import {
  abs, attribute, clamp, cross, dFdx, dFdy, dot, float, mix, normalize, positionWorld, pow, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import type { Terrain } from '@boom/gamedata';
import { SEA_LEVEL } from './space.ts';

/** Texture per Lordaeron Summer ground tile; the order is the weight channel order. */
const LAYERS = ['dirt', 'dirt_rough', 'dirt_grass', 'rock', 'grass', 'grass_dark'] as const;
const TILE_LAYER: Record<string, number> = { Ldrt: 0, Ldro: 1, Ldrg: 2, Lrok: 3, Lgrs: 4, Lgrd: 5 };
/** World units per texture repeat. */
const TILE_SIZE = 760;

function loadTexture(name: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/terrain/${name}.jpg`);
  // Mirrored tiling hides the seams of textures that were not painted to tile.
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Cheap deterministic noise in [-1, 1] for roughening cliff faces. */
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

export function createTerrainMesh(terrain: Terrain): THREE.Mesh {
  const { width: w, height: h } = terrain;
  // Fine grid: every corner plus the midpoints between corners (half-cell spacing).
  const fw = w * 2 - 1, fh = h * 2 - 1;
  const positions = new Float32Array(fw * fh * 3);
  const weights0 = new Float32Array(fw * fh * 4);
  const weights1 = new Float32Array(fw * fh * 2);
  const corner = (i: number, j: number) => j * w + i;
  const layerOf = (k: number) => TILE_LAYER[terrain.groundTiles[terrain.groundTexture[k]!] ?? 'Ldrt'] ?? 0;

  for (let fj = 0; fj < fh; fj++) {
    for (let fi = 0; fi < fw; fi++) {
      const f = fj * fw + fi;
      // The corners this fine vertex sits between (1, 2 or 4 of them).
      const is = fi % 2 ? [(fi - 1) / 2, (fi + 1) / 2] : [fi / 2];
      const js = fj % 2 ? [(fj - 1) / 2, (fj + 1) / 2] : [fj / 2];
      const ks = js.flatMap((j) => is.map((i) => corner(i, j)));
      let height = ks.reduce((s, k) => s + terrain.groundHeight[k]!, 0) / ks.length;
      // Between corners on different cliff levels, take the upper side's height: the plateau
      // reaches the midpoint and the face drops over half a cell instead of a whole one.
      const levels = ks.map((k) => terrain.cliffLevel[k]!);
      const cliff = Math.max(...levels) !== Math.min(...levels);
      if (cliff) {
        const top = Math.max(...levels);
        const upper = ks.filter((k) => terrain.cliffLevel[k] === top);
        height = upper.reduce((s, k) => s + terrain.groundHeight[k]!, 0) / upper.length + hash(fi, fj) * 10;
      }
      const x = terrain.originX + fi * 64, y = terrain.originY + fj * 64;
      positions.set([x, height, -y], f * 3);
      const wsum = new Float32Array(LAYERS.length);
      for (const k of ks) wsum[layerOf(k)]! += 1 / ks.length;
      weights0.set([wsum[0]!, wsum[1]!, wsum[2]!, Math.max(wsum[3]!, cliff ? 0.6 : 0)], f * 4);
      weights1.set([wsum[4]!, wsum[5]!], f * 2);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < fh - 1; j++) {
    for (let i = 0; i < fw - 1; i++) {
      // Counter-clockwise seen from above: sim y maps to -z, which flips handedness.
      const a = j * fw + i, b = a + 1, c = a + fw, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('weights0', new THREE.BufferAttribute(weights0, 4));
  geometry.setAttribute('weights1', new THREE.BufferAttribute(weights1, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  material.colorNode = groundColor();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

function groundColor() {
  const tex = Object.fromEntries([...LAYERS, 'sand', 'seabed'].map((n) => [n, loadTexture(n)]));
  const uv = positionWorld.xz.div(TILE_SIZE);
  // A second, larger and offset sample of each layer breaks up visible repetition.
  const sample = (name: string) => mix(texture(tex[name]!, uv), texture(tex[name]!, uv.mul(0.37).add(vec2(0.31, 0.77))), 0.35).rgb;
  const w0 = attribute('weights0', 'vec4');
  const w1 = attribute('weights1', 'vec2');
  // Grass painted a little bright for this scene; calm it down.
  const grassRaw = mix(sample('grass'), sample('grass_dark'), 0.3);
  const grass = mix(vec3(dot(grassRaw, vec3(0.3, 0.59, 0.11))), grassRaw, 0.7).mul(vec3(0.9, 0.9, 0.78));
  let color = sample('dirt').mul(w0.x)
    .add(sample('dirt_rough').mul(w0.y))
    .add(sample('dirt_grass').mul(w0.z))
    .add(grass.mul(w1.x))
    .add(sample('grass_dark').mul(w1.y));
  const tileSum = w0.x.add(w0.y).add(w0.z).add(w1.x).add(w1.y);

  // Rock: Lrok tiles, cliff edges and anything steep, projected three ways so faces do not
  // stretch the texture.
  // Smoothed vertex normals lean the short cliff faces toward up, which would let the top-down
  // projection smear them into streaks; the true face normal comes from screen derivatives.
  const face = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
  const n = abs(face);
  const blend = pow(n, vec3(6)).div(dot(pow(n, vec3(6)), vec3(1)));
  const rockTex = tex.rock!;
  const rock = texture(rockTex, positionWorld.zy.div(TILE_SIZE * 0.7)).rgb.mul(blend.x)
    .add(texture(rockTex, positionWorld.xz.div(TILE_SIZE * 0.7)).rgb.mul(blend.y))
    .add(texture(rockTex, positionWorld.xy.div(TILE_SIZE * 0.7)).rgb.mul(blend.z));
  const steep = smoothstep(float(0.8), float(0.55), n.y);
  const rockWeight = clamp(w0.w.add(steep), 0, 1);
  color = mix(color.div(tileSum.max(0.001)), rock, rockWeight);

  // Beach near the waterline, seabed below it, darker with depth.
  const above = positionWorld.y.sub(SEA_LEVEL);
  color = mix(color, sample('sand'), smoothstep(float(45), float(5), above).mul(float(1).sub(steep.mul(0.7))));
  const seabed = sample('seabed').mul(mix(float(1), float(0.45), smoothstep(float(0), float(-260), above)));
  color = mix(color, seabed, smoothstep(float(2), float(-25), above));
  return vec4(color, 1);
}
