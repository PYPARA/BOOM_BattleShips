/** Removes Warcraft color codes (|cAARRGGBB … |r) and turns |n into newlines. */
export function cleanText(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/\|c[0-9a-fA-F]{8}/g, '').replace(/\|r/gi, '').replace(/\|n/gi, '\n').trim();
}

/** Decodes a JASS integer that encodes a four-character rawcode, e.g. $68303049 → 'h00I'. */
export function intToRawcode(n: number): string | undefined {
  const chars = [24, 16, 8, 0].map((shift) => (n >>> shift) & 0xff);
  if (!chars.every((c) => c >= 0x30 && c <= 0x7a)) return undefined;
  return String.fromCharCode(...chars);
}

export function splitList(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  return String(v).split(',').map((s) => s.trim()).filter((s) => s && s !== '_' && s !== '-');
}

export function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '' || v === '-' || v === '_') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}
