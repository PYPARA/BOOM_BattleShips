// Minimal MPQ (format v0) reader for Warcraft III maps.
// Supports what war3 maps use in practice: encrypted hash/block tables,
// sectored or single-unit files, and zlib compression.
import { inflateSync } from 'node:zlib';

const HASH_TABLE_OFFSET = 0, HASH_NAME_A = 1, HASH_NAME_B = 2, HASH_FILE_KEY = 3;

const FILE_IMPLODE = 0x00000100;
const FILE_COMPRESS = 0x00000200;
const FILE_ENCRYPTED = 0x00010000;
const FILE_FIX_KEY = 0x00020000;
const FILE_SINGLE_UNIT = 0x01000000;
const FILE_SECTOR_CRC = 0x04000000;
const FILE_EXISTS = 0x80000000;

const COMPRESSION_ZLIB = 0x02;

const cryptTable = (() => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let i = 0; i < 0x100; i++) {
    for (let j = 0, idx = i; j < 5; j++, idx += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const hi = (seed & 0xffff) << 16;
      seed = (seed * 125 + 3) % 0x2aaaab;
      table[idx] = (hi | (seed & 0xffff)) >>> 0;
    }
  }
  return table;
})();

export function hashString(name: string, type: number): number {
  let seed1 = 0x7fed7fed, seed2 = 0xeeeeeeee;
  const upper = name.toUpperCase().replaceAll('/', '\\');
  for (let i = 0; i < upper.length; i++) {
    const ch = upper.charCodeAt(i) & 0xff;
    seed1 = (cryptTable[type * 0x100 + ch]! ^ ((seed1 + seed2) >>> 0)) >>> 0;
    seed2 = (ch + seed1 + seed2 + ((seed2 << 5) >>> 0) + 3) >>> 0;
  }
  return seed1;
}

function decrypt(words: Uint32Array, key: number): void {
  let seed = 0xeeeeeeee;
  for (let i = 0; i < words.length; i++) {
    seed = (seed + cryptTable[0x400 + (key & 0xff)]!) >>> 0;
    const ch = (words[i]! ^ ((key + seed) >>> 0)) >>> 0;
    key = ((((~key << 0x15) >>> 0) + 0x11111111) | (key >>> 0x0b)) >>> 0;
    seed = (ch + seed + ((seed << 5) >>> 0) + 3) >>> 0;
    words[i] = ch;
  }
}

function readTable(buf: Buffer, offset: number, entries: number, keyName: string): Uint32Array {
  const words = new Uint32Array(entries * 4);
  for (let i = 0; i < words.length; i++) words[i] = buf.readUInt32LE(offset + i * 4);
  decrypt(words, hashString(keyName, HASH_FILE_KEY));
  return words;
}

interface Block { offset: number; compressedSize: number; size: number; flags: number }

export class MpqArchive {
  private readonly buf: Buffer;
  private readonly base: number;
  private readonly sectorSize: number;
  private readonly hashTable: Uint32Array;
  private readonly blocks: Block[];

  constructor(file: Buffer) {
    // Archives sit at a 512-byte-aligned offset (w3x maps have a 512-byte HM3W header).
    let base = -1;
    for (let off = 0; off < file.length; off += 0x200) {
      if (file.readUInt32LE(off) === 0x1a51504d) { base = off; break; }
    }
    if (base < 0) throw new Error('No MPQ header found');
    this.buf = file;
    this.base = base;
    const formatVersion = file.readUInt16LE(base + 0x0c);
    if (formatVersion !== 0) throw new Error(`Unsupported MPQ format version ${formatVersion}`);
    this.sectorSize = 0x200 << file.readUInt16LE(base + 0x0e);
    const hashTableOffset = file.readUInt32LE(base + 0x10);
    const blockTableOffset = file.readUInt32LE(base + 0x14);
    const hashEntries = file.readUInt32LE(base + 0x18);
    const blockEntries = file.readUInt32LE(base + 0x1c);
    this.hashTable = readTable(file, base + hashTableOffset, hashEntries, '(hash table)');
    const bt = readTable(file, base + blockTableOffset, blockEntries, '(block table)');
    this.blocks = [];
    for (let i = 0; i < blockEntries; i++) {
      this.blocks.push({ offset: bt[i * 4]!, compressedSize: bt[i * 4 + 1]!, size: bt[i * 4 + 2]!, flags: bt[i * 4 + 3]! });
    }
  }

  get blockCount(): number {
    return this.blocks.filter((b) => b.flags & FILE_EXISTS).length;
  }

  private findBlockIndex(name: string): number | undefined {
    const entries = this.hashTable.length / 4;
    const start = hashString(name, HASH_TABLE_OFFSET) & (entries - 1);
    const a = hashString(name, HASH_NAME_A), b = hashString(name, HASH_NAME_B);
    for (let n = 0; n < entries; n++) {
      const i = ((start + n) & (entries - 1)) * 4;
      const blockIndex = this.hashTable[i + 3]!;
      if (blockIndex === 0xffffffff) return undefined; // empty, never used
      if (this.hashTable[i] === a && this.hashTable[i + 1] === b && blockIndex !== 0xfffffffe) return blockIndex;
    }
    return undefined;
  }

  has(name: string): boolean {
    return this.findBlockIndex(name) !== undefined;
  }

  /** Index of the block holding `name`, used to tell which blocks are still unnamed. */
  blockIndexOf(name: string): number | undefined {
    return this.findBlockIndex(name);
  }

  read(name: string): Buffer | undefined {
    const index = this.findBlockIndex(name);
    if (index === undefined) return undefined;
    const block = this.blocks[index]!;
    if (block.flags & (FILE_ENCRYPTED | FILE_FIX_KEY)) throw new Error(`${name}: encrypted files are not supported`);
    if (block.flags & FILE_IMPLODE) throw new Error(`${name}: PKWARE implode is not supported`);
    const start = this.base + block.offset;

    if (!(block.flags & FILE_COMPRESS)) return Buffer.from(this.buf.subarray(start, start + block.size));
    if (block.flags & FILE_SINGLE_UNIT) {
      const raw = this.buf.subarray(start, start + block.compressedSize);
      return block.compressedSize < block.size ? decompress(raw, name) : Buffer.from(raw);
    }

    const sectorCount = Math.ceil(block.size / this.sectorSize);
    const offsets: number[] = [];
    const tableLength = sectorCount + 1 + (block.flags & FILE_SECTOR_CRC ? 1 : 0);
    for (let i = 0; i < tableLength; i++) offsets.push(this.buf.readUInt32LE(start + i * 4));
    const out = Buffer.alloc(block.size);
    for (let s = 0; s < sectorCount; s++) {
      const expected = Math.min(this.sectorSize, block.size - s * this.sectorSize);
      const raw = this.buf.subarray(start + offsets[s]!, start + offsets[s + 1]!);
      const sector = raw.length < expected ? decompress(raw, name) : raw;
      sector.copy(out, s * this.sectorSize);
    }
    return out;
  }
}

function decompress(raw: Buffer, name: string): Buffer {
  const mask = raw[0]!;
  if (mask === COMPRESSION_ZLIB) return inflateSync(raw.subarray(1));
  throw new Error(`${name}: unsupported compression mask 0x${mask.toString(16)}`);
}
