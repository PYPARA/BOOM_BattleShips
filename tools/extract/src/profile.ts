// Warcraft III profile (.txt) parser: `[ID]` sections of `Key=value,value,...` lines.
// Values are comma-separated; a quoted value may contain commas. Keys are case-insensitive
// in the game, so they are stored lower-cased.
export type ProfileSection = Record<string, string[]>;

export function splitProfileValues(raw: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { values.push(current); current = ''; }
    else current += ch;
  }
  values.push(current);
  return values;
}

export function parseProfile(text: string): Map<string, ProfileSection> {
  const sections = new Map<string, ProfileSection>();
  let section: ProfileSection | undefined;
  // Quoted values may contain bare LF line breaks; real line ends are CRLF in such files.
  const body = text.replace(/^\uFEFF/, '');
  const lines = body.includes('\r\n') ? body.split('\r\n') : body.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('//')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = {};
      sections.set(header[1]!, section);
      continue;
    }
    const eq = line.indexOf('=');
    if (!section || eq < 0) continue;
    section[line.slice(0, eq).toLowerCase()] = splitProfileValues(line.slice(eq + 1));
  }
  return sections;
}

/** Merges several profile files; later files win per key, like the game does. */
export function mergeProfiles(...profiles: Map<string, ProfileSection>[]): Map<string, ProfileSection> {
  const merged = new Map<string, ProfileSection>();
  for (const profile of profiles) {
    for (const [id, section] of profile) merged.set(id, { ...merged.get(id), ...section });
  }
  return merged;
}
