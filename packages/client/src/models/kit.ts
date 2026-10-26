// A small procedural modeling kit for low-poly ships and props. Parts are baked into a few
// merged meshes (flat-shaded vertex colors, team color, glow) so each model costs only a
// handful of draw calls. Conventions follow docs/art/README.md: bow along +x, y up,
// waterline at y = 0, one unit = one game unit.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Where a part's faces end up: a plain color, the runtime team color, or the glow layer. */
export type Paint = THREE.ColorRepresentation | 'team' | { glow: THREE.ColorRepresentation };

export interface Transform {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

const tmpColor = new THREE.Color();

/** Deterministic per-face brightness jitter, so flat colors read as hand-painted planks. */
function jitter(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return 0.94 + (s - Math.floor(s)) * 0.12;
}

type Bucket = 'solid' | 'team' | 'glow';

export class ModelBuilder {
  /** Parts go into the current layer; each layer becomes a child group (e.g. `hull`, `rig`). */
  layer = 'hull';
  private readonly parts = new Map<string, Record<Bucket, THREE.BufferGeometry[]>>();
  private glowColor = new THREE.Color(0x66ccff);
  private readonly nodes: THREE.Object3D[] = [];
  private faceSeed = 1;

  /** Adds a geometry with one paint for all faces. */
  add(geometry: THREE.BufferGeometry, paint: Paint, transform: Transform = {}): this {
    return this.addPainted(geometry, () => paint, transform);
  }

  /** Adds a geometry whose faces are painted by their centroid (in the part's final position). */
  addPainted(geometry: THREE.BufferGeometry, paintAt: (centroid: THREE.Vector3) => Paint, transform: Transform = {}): this {
    const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).deleteAttribute('uv').deleteAttribute('normal');
    applyTransform(g, transform);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const buckets = { solid: [] as number[], team: [] as number[], glow: [] as number[] };
    const colors = { solid: [] as number[], team: [] as number[], glow: [] as number[] };
    const c = new THREE.Vector3();
    for (let f = 0; f < pos.count; f += 3) {
      c.set(0, 0, 0);
      for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(pos, f + k));
      c.multiplyScalar(1 / 3);
      const paint = paintAt(c);
      const j = jitter(this.faceSeed++);
      let bucket: keyof typeof buckets;
      if (paint === 'team') { bucket = 'team'; tmpColor.setScalar(j); }
      else if (typeof paint === 'object' && paint !== null && 'glow' in paint) { bucket = 'glow'; tmpColor.set(paint.glow); this.glowColor.set(paint.glow); }
      else { bucket = 'solid'; tmpColor.set(paint as THREE.ColorRepresentation).multiplyScalar(j); }
      for (let k = 0; k < 3; k++) {
        buckets[bucket].push(pos.getX(f + k), pos.getY(f + k), pos.getZ(f + k));
        colors[bucket].push(tmpColor.r, tmpColor.g, tmpColor.b);
      }
    }
    let layer = this.parts.get(this.layer);
    if (!layer) this.parts.set(this.layer, (layer = { solid: [], team: [], glow: [] }));
    for (const key of ['solid', 'team', 'glow'] as const) {
      if (buckets[key].length === 0) continue;
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(buckets[key], 3));
      out.setAttribute('color', new THREE.Float32BufferAttribute(colors[key], 3));
      layer[key].push(out);
    }
    return this;
  }

  /** Named empty node (mast_1, muzzle_1, wake, …) for the engine to attach things to. */
  node(name: string, position: [number, number, number]): this {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(...position);
    this.nodes.push(o);
    return this;
  }

  build(name: string, teamColor: THREE.ColorRepresentation): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const materials: Record<Bucket, THREE.Material> = {
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }),
      team: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, color: teamColor, side: THREE.DoubleSide }),
      glow: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.3, emissive: this.glowColor, emissiveIntensity: 0.9 }),
    };
    for (const [layerName, buckets] of this.parts) {
      const layer = new THREE.Group();
      layer.name = layerName;
      for (const key of ['solid', 'team', 'glow'] as const) {
        if (buckets[key].length === 0) continue;
        const geometry = mergeGeometries(buckets[key])!;
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, materials[key]);
        mesh.name = key === 'solid' ? 'body' : key;
        layer.add(mesh);
      }
      group.add(layer);
    }
    for (const n of this.nodes) group.add(n);
    return group;
  }
}

function applyTransform(g: THREE.BufferGeometry, t: Transform): void {
  if (t.scale) g.scale(...t.scale);
  if (t.rotation) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...t.rotation)));
  if (t.position) g.translate(...t.position);
}

// ---------------------------------------------------------------------------------------
// Hull

export interface HullSpec {
  length: number;
  beam: number;
  /** Deck height above the waterline at midship. */
  freeboard: number;
  /** Keel depth below the waterline at midship. */
  draft: number;
  /** How much the deck line rises toward bow and stern, as a fraction of freeboard. */
  sheer?: number;
  /** Extra rise at the bow only. */
  bowRise?: number;
  /** Transom half-width as a fraction of the beam. */
  sternWidth?: number;
  /** Larger = fuller bow; 1.2 is sharp, 2.5 is blunt. */
  bowFullness?: number;
  /** Superellipse exponent of the cross-section; 2 = round bilge, 4 = boxy. */
  boxiness?: number;
  /** How far the stem's foot is pulled back from its top, as a fraction of length (raked bow). */
  bowRake?: number;
  /** Keel rise toward the bow and the stern, as fractions of draft (banana-shaped hulls). */
  keelRiseBow?: number;
  keelRiseStern?: number;
  /** Bulwark height above the deck. */
  bulwark?: number;
  stations?: number;
}

export interface Hull {
  geometry: THREE.BufferGeometry;
  deck: THREE.BufferGeometry;
  /** Half-width of the hull at a given x and height (outer skin). */
  halfWidthAt(x: number, y?: number): number;
  /** Deck height at a given x. */
  deckAt(x: number): number;
  /** 0 at the gunwale, 1 at the keel; paint bands by this so they follow the sheer line. */
  depthFraction(x: number, y: number): number;
  /** Points down the stem from the gunwale (s = 0) to the keel (s = 1), for stem caps. */
  stemLine(samples: number): THREE.Vector3[];
  /** Points along the top edge of one side (side = -1 port, 1 starboard), stern to bow. */
  gunwaleLine(side: -1 | 1, samples: number): THREE.Vector3[];
  spec: Required<HullSpec>;
}

export function makeHull(input: HullSpec): Hull {
  const spec: Required<HullSpec> = {
    sheer: 0.25, bowRise: 0.2, sternWidth: 0.7, bowFullness: 1.8, boxiness: 3, bulwark: input.freeboard * 0.25, stations: 22,
    bowRake: 0, keelRiseBow: 0.85, keelRiseStern: 0, ...input,
  };
  const { length: L, beam: B, freeboard: F, draft: D, stations: N } = spec;
  const K = 10; // points per half cross-section
  const tOf = (x: number) => THREE.MathUtils.clamp(x / L + 0.5, 0, 1);
  const halfWidthT = (t: number) => {
    const full = 0.55;
    if (t <= full) return (B / 2) * THREE.MathUtils.lerp(spec.sternWidth, 1, Math.sqrt(t / full));
    return (B / 2) * Math.max(0, 1 - Math.pow((t - full) / (1 - full), spec.bowFullness));
  };
  const deckT = (t: number) => F + F * spec.sheer * Math.pow(2 * t - 1, 2) + F * spec.bowRise * Math.pow(Math.max(0, t - 0.6) / 0.4, 2);
  const keelT = (t: number) => -D * (1 - 0.35 * Math.pow(2 * t - 1, 4))
    * (1 - spec.keelRiseBow * Math.pow(Math.max(0, t - 0.7) / 0.3, 1.5))
    * (1 - spec.keelRiseStern * Math.pow(Math.max(0, 0.3 - t) / 0.3, 1.5));
  /** Pulls lower points back near the bow so the stem curves (s = 0 at the gunwale, 1 at the keel). */
  const rakeX = (t: number, s: number) => -spec.bowRake * L * Math.pow(Math.max(0, t - 0.75) / 0.25, 1.2) * Math.pow(s, 1.6);

  const section = (t: number): THREE.Vector3[] => {
    const x = (t - 0.5) * L;
    const w = halfWidthT(t), top = deckT(t) + spec.bulwark, bottom = keelT(t);
    const pts: THREE.Vector3[] = [];
    const n = spec.boxiness;
    // Port side from gunwale down to the keel, then starboard back up.
    for (let k = 0; k <= K; k++) {
      const th = (k / K) * (Math.PI / 2);
      const s = Math.pow(Math.sin(th), 2 / n);
      pts.push(new THREE.Vector3(x + rakeX(t, s), top - (top - bottom) * s, -w * Math.pow(Math.cos(th), 2 / n)));
    }
    for (let k = K - 1; k >= 0; k--) pts.push(pts[k]!.clone().setZ(-pts[k]!.z));
    return pts;
  };

  const rings = Array.from({ length: N + 1 }, (_, i) => section(i / N));
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < N; i++) {
    const r0 = rings[i]!, r1 = rings[i + 1]!;
    for (let k = 0; k < r0.length - 1; k++) {
      tri(r0[k]!, r1[k]!, r0[k + 1]!);
      tri(r0[k + 1]!, r1[k]!, r1[k + 1]!);
    }
  }
  // Transom (stern face) as a fan.
  const stern = rings[0]!;
  const sc = stern.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / stern.length);
  for (let k = 0; k < stern.length - 1; k++) tri(sc, stern[k + 1]!, stern[k]!);
  // Close the top of the bulwark with the inner face down to the deck.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));

  // Deck: a strip slightly inside the bulwark.
  const deckPos: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const x0 = (t0 - 0.5) * L, x1 = (t1 - 0.5) * L;
    const w0 = halfWidthT(t0) * 0.9, w1 = halfWidthT(t1) * 0.9;
    const y0 = deckT(t0), y1 = deckT(t1);
    const a = new THREE.Vector3(x0, y0, -w0), b = new THREE.Vector3(x0, y0, w0), c = new THREE.Vector3(x1, y1, -w1), d = new THREE.Vector3(x1, y1, w1);
    deckPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));

  return {
    geometry,
    deck,
    spec,
    halfWidthAt: (x, y = 0) => {
      const t = tOf(x);
      const top = deckT(t) + spec.bulwark, bottom = keelT(t);
      const s = THREE.MathUtils.clamp((top - y) / Math.max(1e-3, top - bottom), 0, 1);
      return halfWidthT(t) * Math.pow(1 - Math.pow(s, spec.boxiness), 1 / spec.boxiness);
    },
    deckAt: (x) => deckT(tOf(x)),
    depthFraction: (x, y) => {
      const t = tOf(x);
      const top = deckT(t) + spec.bulwark, bottom = keelT(t);
      return THREE.MathUtils.clamp((top - y) / Math.max(1e-3, top - bottom), 0, 1);
    },
    gunwaleLine: (side, samples) => Array.from({ length: samples + 1 }, (_, i) => {
      const t = i / samples;
      return new THREE.Vector3((t - 0.5) * L, deckT(t) + spec.bulwark, side * halfWidthT(t));
    }),
    stemLine: (samples) => Array.from({ length: samples + 1 }, (_, i) => {
      const s = i / samples;
      const top = deckT(1) + spec.bulwark, bottom = keelT(1);
      return new THREE.Vector3(L / 2 + rakeX(1, s), top - (top - bottom) * s, 0);
    }),
  };
}

// ---------------------------------------------------------------------------------------
// Common parts

export const geo = {
  box: (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d),
  cyl: (rTop: number, rBottom: number, h: number, seg = 8) => new THREE.CylinderGeometry(rTop, rBottom, h, seg),
  cone: (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg),
  crystal: (r: number, h: number) => new THREE.OctahedronGeometry(1, 0).scale(r, h / 2, r),
  sphere: (r: number, seg = 6) => new THREE.SphereGeometry(r, seg, Math.max(3, seg - 2)),
};

/** A cannon on a wooden carriage, barrel along +x before rotation about y by `yaw`. */
export function addCannon(b: ModelBuilder, at: [number, number, number], size: number, yaw = 0, colors = { iron: 0x3c3f44, wood: 0x6e4524 }): void {
  const [x, y, z] = at;
  const rot = (dx: number, dz: number): [number, number] => [x + dx * Math.cos(yaw) + dz * Math.sin(yaw), z - dx * Math.sin(yaw) + dz * Math.cos(yaw)];
  const [bx, bz] = rot(size * 0.25, 0);
  b.add(geo.cyl(size * 0.12, size * 0.16, size * 1.1, 8), colors.iron, { position: [bx, y + size * 0.32, bz], rotation: [0, yaw, -Math.PI / 2] });
  b.add(geo.cyl(size * 0.16, size * 0.16, size * 0.08, 8), colors.iron, { position: [rot(size * 0.8, 0)[0], y + size * 0.32, rot(size * 0.8, 0)[1]], rotation: [0, yaw, -Math.PI / 2] });
  b.add(geo.box(size * 0.6, size * 0.22, size * 0.42), colors.wood, { position: [x, y + size * 0.11, z], rotation: [0, yaw, 0] });
}

/** Railing posts with a top bar along a polyline of [x, z] points at deck heights. */
export function addRailing(b: ModelBuilder, points: [number, number][], deckAt: (x: number) => number, height: number, paint: Paint): void {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i]!, [x1, z1] = points[i + 1]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = -Math.atan2(z1 - z0, x1 - x0);
    const y = (deckAt(x0) + deckAt(x1)) / 2 + height;
    b.add(geo.box(len, height * 0.12, height * 0.12), paint, { position: [(x0 + x1) / 2, y, (z0 + z1) / 2], rotation: [0, yaw, 0] });
    b.add(geo.cyl(height * 0.07, height * 0.07, height, 5), paint, { position: [x0, deckAt(x0) + height / 2, z0] });
  }
}

// ---------------------------------------------------------------------------------------
// Rigging (sails are generated, never modeled; see docs/art/README.md)

export interface MastSpec {
  x: number;
  /** Height the mast stands on; defaults to the deck. */
  base?: number;
  height: number;
  /** Sail width across the ship. */
  width: number;
  style: 'square' | 'lateen' | 'junk';
  sailColor: THREE.ColorRepresentation;
}

export function addRig(b: ModelBuilder, masts: MastSpec[], deckAt: (x: number) => number, wood: THREE.ColorRepresentation = 0x5a3b22): void {
  const previous = b.layer;
  b.layer = 'rig';
  masts.forEach((m, i) => {
    const base = m.base ?? deckAt(m.x);
    const r = m.height * 0.025;
    b.add(geo.cyl(r * 0.7, r, m.height, 6), wood, { position: [m.x, base + m.height / 2, 0] });
    b.node(`mast_${i + 1}`, [m.x, base, 0]);
    const sailTop = base + m.height * 0.92, sailBottom = base + m.height * 0.3;
    const h = sailTop - sailBottom;
    if (m.style === 'square') {
      b.add(geo.cyl(r * 0.5, r * 0.5, m.width * 1.1, 5), wood, { position: [m.x, sailTop, 0], rotation: [Math.PI / 2, 0, 0] });
      b.add(curvedSail(m.width, h, h * 0.08), m.sailColor, { position: [m.x + r * 2, (sailTop + sailBottom) / 2, 0], rotation: [0, -Math.PI / 2, 0] });
    } else if (m.style === 'junk') {
      const panel = curvedSail(m.width, h, h * 0.04);
      b.add(panel, m.sailColor, { position: [m.x + r * 2, (sailTop + sailBottom) / 2, 0], rotation: [0, -Math.PI / 2, 0] });
      for (let k = 0; k <= 4; k++) {
        b.add(geo.box(r * 0.8, r * 0.8, m.width * 1.02), wood, { position: [m.x + r * 2.5, sailBottom + (h * k) / 4, 0] });
      }
    } else {
      // Lateen: a triangle swept back from the mast.
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([
        0, h * 0.5, 0, 0, -h * 0.5, 0, -m.width, -h * 0.45, 0,
        0, -h * 0.5, 0, 0, h * 0.5, 0, -m.width, -h * 0.45, 0,
      ], 3));
      b.add(tri, m.sailColor, { position: [m.x - r, (sailTop + sailBottom) / 2, 0] });
    }
    if (i === 0) {
      b.add(geo.box(m.height * 0.22, m.height * 0.1, 1), 'team', { position: [m.x - m.height * 0.11, base + m.height * 1.02, 0] });
    }
  });
  b.layer = previous;
}

/** A slightly bellied rectangular sail in the x-y plane, bellying toward +z. */
function curvedSail(width: number, height: number, belly: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height, 4, 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / (width / 2);
    p.setZ(i, belly * (1 - u * u));
  }
  // Double-sided by duplicating with flipped winding.
  const back = g.clone();
  const idx = back.getIndex()!;
  const arr = idx.array as Uint16Array;
  for (let i = 0; i < arr.length; i += 3) [arr[i + 1], arr[i + 2]] = [arr[i + 2]!, arr[i + 1]!];
  return mergeGeometries([g.toNonIndexed(), back.toNonIndexed()])!;
}

/** Dark gun ports with a frame, on both sides of the hull at the given stations. */
export function addGunPorts(b: ModelBuilder, hull: Hull, xs: number[], y: number, size: number, frame: Paint, hole: Paint = 0x1c1a18): void {
  for (const x of xs) {
    const z = hull.halfWidthAt(x, y);
    for (const side of [-1, 1]) {
      b.add(geo.box(size * 1.35, size * 1.35, size * 0.3), frame, { position: [x, y, side * (z + size * 0.05)] });
      b.add(geo.box(size, size, size * 0.3), hole, { position: [x, y, side * (z + size * 0.2)] });
    }
  }
}

/** Points cones along a surface normal: rotation that maps +y onto `normal`. */
export function rotationToward(normal: THREE.Vector3): [number, number, number] {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z];
}

/** A strip of boxes along a polyline in the x-y plane (e.g. an iron cap down the stem). */
export function addStrip(b: ModelBuilder, points: THREE.Vector3[], width: number, thickness: number, paint: Paint): void {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, c = points[i + 1]!;
    const len = a.distanceTo(c);
    const angle = Math.atan2(c.y - a.y, c.x - a.x);
    b.add(geo.box(len + thickness * 0.5, thickness, width), paint, {
      position: [(a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2], rotation: [0, 0, angle],
    });
  }
}

/** Boxes along any 3D polyline, each oriented along its segment (rub rails, hoops, pipes). */
export function addBeam(b: ModelBuilder, points: THREE.Vector3[], width: number, height: number, paint: Paint): void {
  const xAxis = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, c = points[i + 1]!;
    const dir = c.clone().sub(a);
    const len = dir.length();
    if (len < 1e-3) continue;
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(xAxis, dir.normalize()));
    b.add(geo.box(len + width * 0.6, height, width), paint, { position: [(a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2], rotation: [e.x, e.y, e.z] });
  }
}
