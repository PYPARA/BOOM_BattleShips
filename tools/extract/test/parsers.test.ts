import { describe, expect, it } from 'vitest';
import { collectRawcodes, parseWts } from '../src/jass.ts';
import { hashString } from '../src/mpq.ts';
import { parseProfile } from '../src/profile.ts';
import { parseSlk } from '../src/slk.ts';
import { cleanText, intToRawcode } from '../src/text.ts';

describe('mpq', () => {
  it('hashes the table keys to their well-known values', () => {
    expect(hashString('(hash table)', 3)).toBe(0xc3af3770);
    expect(hashString('(block table)', 3)).toBe(0xec83b3a3);
  });
});

describe('slk', () => {
  it('reads rows keyed by the first column and keeps the current row across cells', () => {
    const rows = parseSlk([
      'ID;PWXL;N;E', 'C;X1;Y1;K"id"', 'C;X2;K"HP"', 'C;X3;K"name"',
      'C;X1;Y2;K"H000"', 'C;X2;K200', 'C;X3;K"a;;b"', 'C;X1;Y3;K"H001"', 'C;X2;K"-"', 'E',
    ].join('\n'));
    expect(rows.get('H000')).toEqual({ id: 'H000', HP: 200, name: 'a;b' });
    expect(rows.get('H001')).toEqual({ id: 'H001' });
  });
});

describe('profile', () => {
  it('splits values on commas outside quotes and keeps bare LF inside quoted values', () => {
    const text = '[A000]\r\nName=小炮\r\nTip="a,b","c"\r\nUbertip="line1\nline2"\r\n';
    const section = parseProfile(text).get('A000')!;
    expect(section.name).toEqual(['小炮']);
    expect(section.tip).toEqual(['a,b', 'c']);
    expect(section.ubertip).toEqual(['line1\nline2']);
  });
});

describe('text', () => {
  it('decodes JASS rawcode integers', () => {
    expect(intToRawcode(0x68303049)).toBe('h00I');
    expect(intToRawcode(5)).toBeUndefined();
  });

  it('strips color codes', () => {
    expect(cleanText('|cffFF0000腐蚀大炮|r|n射程')).toBe('腐蚀大炮\n射程');
  });
});

describe('jass', () => {
  it('collects hex and quoted rawcodes', () => {
    expect(collectRawcodes("call X($68303049,'A03M',$FFFFFFFF)")).toEqual(['A03M', 'h00I']);
  });

  it('parses wts strings', () => {
    expect(parseWts('STRING 2\n{\nhello\nworld\n}\n').get('2')).toBe('hello\nworld');
  });
});
