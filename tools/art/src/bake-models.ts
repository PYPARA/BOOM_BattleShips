// Shrinks the pulled Aha models for download: drops texture coordinates (the game paints with
// materials and vertex colors only), stores normals as 8-bit and positions as 16-bit integers
// (KHR_mesh_quantization, which three's GLTFLoader reads natively). Each mesh's positions are
// scaled into the integer range by its own bounds; a child node carries the scale back.
//
// Usage: node src/bake-models.ts [kind...]     (default: every kind under public/models)
// Run it after pull-aha; already baked files are skipped.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const modelsDir = join(root, 'packages/client/public/models');
const EXT = 'KHR_mesh_quantization';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const FLOAT = 5126, BYTE = 5120, SHORT = 5122, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

function parseGlb(buf: Buffer): { json: Json; bin: Buffer } {
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength;
  const bin = binStart < buf.length ? buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart)) : Buffer.alloc(0);
  return { json, bin };
}

function writeGlb(json: Json, bin: Buffer): Buffer {
  const pad = (b: Buffer, fill: number) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (type: number, data: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
  return Buffer.concat([header, chunk(0x4e4f534a, jsonChunk), chunk(0x004e4942, binChunk)]);
}

/** An accessor's values as floats (or raw integers for indices), honoring strides. */
function read(json: Json, bin: Buffer, index: number): { values: Float64Array; size: number; count: number } {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const size = COMPONENTS[acc.type]!, bytes = BYTES[acc.componentType]!;
  const stride = view.byteStride ?? size * bytes;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const values = new Float64Array(acc.count * size);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < size; c++) {
      const o = base + i * stride + c * bytes;
      let v: number;
      switch (acc.componentType) {
        case FLOAT: v = bin.readFloatLE(o); break;
        case 5125: v = bin.readUInt32LE(o); break;
        case 5123: v = bin.readUInt16LE(o); if (acc.normalized) v /= 65535; break;
        case SHORT: v = bin.readInt16LE(o); if (acc.normalized) v = Math.max(v / 32767, -1); break;
        case 5121: v = bin.readUInt8(o); if (acc.normalized) v /= 255; break;
        default: v = bin.readInt8(o); if (acc.normalized) v = Math.max(v / 127, -1);
      }
      values[i * size + c] = v;
    }
  }
  return { values, size, count: acc.count };
}

function bake(file: string): { before: number; after: number } | undefined {
  const buf = readFileSync(file);
  const { json, bin } = parseGlb(buf);
  if (json.extensionsUsed?.includes(EXT)) return undefined;
  const round = (v: number) => Math.round(v * 1e5) / 1e5;

  // One buffer view per (target, stride): accessors are offsets into it, which keeps the
  // JSON small for models made of thousands of tiny parts.
  const groups = new Map<string, { chunks: Buffer[]; length: number; view: Json }>();
  const accessors: Json[] = [];
  /** Appends data to its group's view and adds an accessor over it; returns the accessor index. */
  const add = (data: Buffer, accessor: Json, target?: number, byteStride?: number): number => {
    const key = `${target ?? 0}/${byteStride ?? 0}`;
    let g = groups.get(key);
    if (!g) { g = { chunks: [], length: 0, view: { buffer: 0, ...(byteStride ? { byteStride } : {}), ...(target ? { target } : {}) } }; groups.set(key, g); }
    const padded = data.length % 4 ? Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]) : data;
    accessors.push({ ...accessor, bufferView: key, ...(g.length ? { byteOffset: g.length } : {}) });
    g.chunks.push(padded);
    g.length += padded.length;
    return accessors.length - 1;
  };
  const copied = new Map<number, number>();
  /** Any accessor, re-packed tightly as it was (indices, colors). */
  const copy = (index: number, target?: number): number => {
    const hit = copied.get(index);
    if (hit !== undefined) return hit;
    const acc = json.accessors[index];
    const { values, size, count } = read(json, bin, index);
    const bytes = BYTES[acc.componentType]!;
    // Vertex attributes need 4-byte aligned elements.
    const elem = size * bytes, stride = target === ARRAY_BUFFER && elem % 4 ? elem + (4 - (elem % 4)) : elem;
    const out = Buffer.alloc(count * stride);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < size; c++) {
        let v = values[i * size + c]!;
        const o = i * stride + c * bytes;
        if (acc.normalized) v = acc.componentType === 5121 ? Math.round(v * 255) : acc.componentType === 5123 ? Math.round(v * 65535) : v;
        switch (acc.componentType) {
          case FLOAT: out.writeFloatLE(v, o); break;
          case 5125: out.writeUInt32LE(v, o); break;
          case 5123: out.writeUInt16LE(v, o); break;
          case SHORT: out.writeInt16LE(v, o); break;
          case 5121: out.writeUInt8(v, o); break;
          default: out.writeInt8(v, o);
        }
      }
    }
    const { bufferView: _v, byteOffset: _o, min: _min, max: _max, name: _n, ...rest } = acc;
    const result = add(out, rest, target, stride !== elem ? stride : undefined);
    copied.set(index, result);
    return result;
  };
  const normals = new Map<string, number>();
  /**
   * Unit normals as signed 8-bit (x, y, z, pad). The dequantizing node's scale `half` also
   * reaches normals (through the inverse transpose), so they are stored pre-scaled by it.
   */
  const normal = (index: number, mesh: number, half: number[]): number => {
    const key = `${index}/${mesh}`;
    const hit = normals.get(key);
    if (hit !== undefined) return hit;
    const { values, count } = read(json, bin, index);
    const out = Buffer.alloc(count * 4);
    for (let i = 0; i < count; i++) {
      const x = values[i * 3]! * half[0]!, y = values[i * 3 + 1]! * half[1]!, z = values[i * 3 + 2]! * half[2]!;
      const len = Math.hypot(x, y, z) || 1;
      out.writeInt8(Math.round((x / len) * 127), i * 4);
      out.writeInt8(Math.round((y / len) * 127), i * 4 + 1);
      out.writeInt8(Math.round((z / len) * 127), i * 4 + 2);
    }
    const result = add(out, { componentType: BYTE, normalized: true, count, type: 'VEC3' }, ARRAY_BUFFER, 4);
    normals.set(key, result);
    return result;
  };

  // Positions: one quantization per mesh, from the bounds of all its primitives.
  const meshScale = new Map<number, { center: number[]; half: number[] }>();
  json.meshes?.forEach((mesh: Json, m: number) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.primitives) {
      const acc = json.accessors[p.attributes.POSITION];
      if (acc.min && acc.max) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c]!, acc.min[c]); max[c] = Math.max(max[c]!, acc.max[c]); }
      else { const { values, count } = read(json, bin, p.attributes.POSITION); for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c]!, values[i * 3 + c]!); max[c] = Math.max(max[c]!, values[i * 3 + c]!); } }
    }
    const center = min.map((v, c) => (v + max[c]!) / 2);
    const half = min.map((v, c) => Math.max((max[c]! - v) / 2, 1e-6));
    meshScale.set(m, { center, half });
    const positions = new Map<number, number>();
    for (const p of mesh.primitives) {
      const attributes: Record<string, number> = {};
      for (const [name, index] of Object.entries(p.attributes) as [string, number][]) {
        if (name.startsWith('TEXCOORD') || name.startsWith('TANGENT')) continue;
        if (name === 'NORMAL') { attributes[name] = normal(index, m, half); continue; }
        if (name !== 'POSITION') { attributes[name] = copy(index, ARRAY_BUFFER); continue; }
        let q = positions.get(index);
        if (q === undefined) {
          const { values, count } = read(json, bin, index);
          const out = Buffer.alloc(count * 8);
          const qMin = [32767, 32767, 32767], qMax = [-32767, -32767, -32767];
          for (let i = 0; i < count; i++) {
            for (let c = 0; c < 3; c++) {
              const v = Math.round(((values[i * 3 + c]! - center[c]!) / half[c]!) * 32767);
              out.writeInt16LE(v, i * 8 + c * 2);
              qMin[c] = Math.min(qMin[c]!, v); qMax[c] = Math.max(qMax[c]!, v);
            }
          }
          q = add(out, { componentType: SHORT, normalized: true, count, type: 'VEC3', min: qMin.map((v) => round(v / 32767)), max: qMax.map((v) => round(v / 32767)) }, ARRAY_BUFFER, 8);
          positions.set(index, q);
        }
        attributes[name] = q;
      }
      p.attributes = attributes;
      if (p.indices !== undefined) p.indices = copy(p.indices, ELEMENT_ARRAY_BUFFER);
    }
  });

  // Every node with a mesh hands it to a child that undoes the quantization.
  const nodes: Json[] = json.nodes ?? [];
  const count = nodes.length;
  for (let n = 0; n < count; n++) {
    const node = nodes[n];
    if (node.mesh === undefined) continue;
    const { center, half } = meshScale.get(node.mesh)!;
    nodes.push({ mesh: node.mesh, translation: center, scale: half });
    delete node.mesh;
    node.children = [...(node.children ?? []), nodes.length - 1];
  }

  // Lay the groups out one after another and point the accessors at their views.
  const views: Json[] = [], chunks: Buffer[] = [];
  const viewIndex = new Map<string, number>();
  let offset = 0;
  for (const [key, g] of groups) {
    viewIndex.set(key, views.length);
    views.push({ ...g.view, byteOffset: offset, byteLength: g.length });
    chunks.push(...g.chunks);
    offset += g.length;
  }
  for (const a of accessors) a.bufferView = viewIndex.get(a.bufferView);
  // Inner parts lose their names and extras (the sidecar JSON carries what the game reads);
  // transforms are rounded.
  nodes.forEach((node, n) => {
    if (n > 0) { delete node.name; delete node.extras; }
    for (const k of ['matrix', 'translation', 'rotation', 'scale']) if (node[k]) node[k] = node[k].map(round);
  });
  for (const mesh of json.meshes ?? []) delete mesh.name;
  json.accessors = accessors;
  json.bufferViews = views;
  json.buffers = [{ byteLength: offset }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), EXT])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), EXT])];
  const out = writeGlb(json, Buffer.concat(chunks));
  writeFileSync(file, out);
  return { before: buf.length, after: out.length };
}

const kinds = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(modelsDir);
let before = 0, after = 0, files = 0;
for (const kind of kinds) {
  for (const f of readdirSync(join(modelsDir, kind)).filter((f) => f.endsWith('.glb'))) {
    const r = bake(join(modelsDir, kind, f));
    if (!r) continue;
    before += r.before; after += r.after; files++;
  }
}
console.log(`baked ${files} models: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);
