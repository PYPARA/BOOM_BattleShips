// SYLK (.slk) table parser. Row 1 holds column names; column 1 holds the object id.
export type SlkValue = string | number;
export type SlkRow = Record<string, SlkValue>;

/** Splits a record on ';' while keeping ';;' (an escaped semicolon) inside fields. */
function splitRecord(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ';') {
      if (line[i + 1] === ';') { current += ';'; i++; continue; }
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseValue(raw: string): SlkValue {
  if (raw.startsWith('"')) return raw.slice(1, raw.endsWith('"') ? -1 : undefined);
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

export function parseSlk(text: string): Map<string, SlkRow> {
  const cells = new Map<number, Map<number, SlkValue>>();
  let x = 0, y = 0;
  for (const line of text.split(/\r?\n/)) {
    const [type, ...fields] = splitRecord(line);
    if (type !== 'C' && type !== 'F') continue;
    let value: SlkValue | undefined;
    for (const f of fields) {
      if (f.startsWith('X')) x = Number(f.slice(1));
      else if (f.startsWith('Y')) y = Number(f.slice(1));
      else if (f.startsWith('K') && type === 'C') value = parseValue(f.slice(1));
    }
    if (value === undefined) continue;
    let row = cells.get(y);
    if (!row) cells.set(y, (row = new Map()));
    row.set(x, value);
  }

  const header = cells.get(1);
  if (!header) throw new Error('SLK has no header row');
  const rows = new Map<string, SlkRow>();
  for (const [rowIndex, row] of cells) {
    if (rowIndex === 1) continue;
    const id = row.get(1);
    if (id === undefined) continue;
    const record: SlkRow = {};
    for (const [col, value] of row) {
      const name = header.get(col);
      if (name !== undefined && value !== '-' && value !== '_') record[String(name)] = value;
    }
    rows.set(String(id), record);
  }
  return rows;
}
