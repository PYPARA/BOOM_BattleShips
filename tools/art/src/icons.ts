// Builds the 2D icon list (ships, weapons, shop items, ship skills) from the extracted game data
// and generates the icons through the same images API as generate.ts.
//
// Usage: node src/icons.ts list                 writes art/icons.json
//        node src/icons.ts generate [id...]     generates missing icons (all when no ids)
// Icons land in packages/client/public/icons/<kind>/<id>.jpg (128 px). Full-size PNGs go to
// art/icons/ (gitignored, like the concept PNGs).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const gen = (name: string) => JSON.parse(readFileSync(join(root, 'packages/gamedata/generated', name), 'utf8'));
const listFile = join(root, 'art/icons.json');
const fullDir = join(root, 'art/icons');
const outDir = join(root, 'packages/client/public/icons');

type Kind = 'ship' | 'weapon' | 'item' | 'skill';
interface Icon { kind: Kind; id: string; name: string; subject: string }

const TEMPLATE = 'Game UI icon of {SUBJECT}, centered, bold readable shape, hand-painted fantasy naval style, rich colors, dark vignette background, square, no text, no letters, no border';
const clean = (s: string) => (s ?? '').replace(/\|c[0-9a-fA-F]{8}|\|r|\|n/g, ' ').replace(/^[.!~_@\s]+/, '').replace(/\s+/g, ' ').trim();
/** The first sentence of a tooltip, without the stat lines. */
const gist = (s: string) => clean(s).split(/ - |\n|破坏力|攻击对象|射程/)[0]!.slice(0, 80).trim();

function buildList(): Icon[] {
  const ships = gen('ships.json') as { id: string; name: string; description: string }[];
  const weapons = gen('weapons.json') as { id: string; name: string }[];
  const items = gen('items.json') as { id: string; name: string; goldCost: number; description: string }[];
  const units = gen('units.json') as { sellsItems?: string[] }[];
  const abilities = gen('abilities.json') as { id: string; name: string; levels: { description: string }[] }[];
  const manifest = JSON.parse(readFileSync(join(root, 'art/manifest.json'), 'utf8')) as { items: { id: string; description: string }[] };
  const concept = new Map(manifest.items.map((i) => [i.id, i.description]));
  const weaponIds = new Set(weapons.map((w) => w.id));
  const sold = new Set(units.flatMap((u) => u.sellsItems ?? []));
  const byAbility = new Map(abilities.map((a) => [a.id, a]));

  const out: Icon[] = [];
  for (const s of ships) {
    out.push({ kind: 'ship', id: s.id, name: s.name, subject: `a sailing warship portrait seen from the front-left: ${concept.get(s.id) ?? `a ship called "${s.name}", ${gist(s.description)}`}` });
  }
  // NPC fleet models (hired at the shipyard); their I/II/III variants share these.
  for (const id of ['h00I', 'h00B', 'h00H', 'h018']) {
    const name = { h00I: '海军小艇', h00B: '海军护卫舰', h00H: '海军巡洋舰', h018: '超级战舰' }[id]!;
    out.push({ kind: 'ship', id, name, subject: `a warship portrait seen from the front-left: ${concept.get(id) ?? name}` });
  }
  for (const w of weapons) {
    const subject = /火焰喷射/.test(w.name)
      ? 'a brass ship-mounted fire nozzle device with fuel tanks and a small flame at the tip, shown as a single object'
      : `a naval ship weapon called "${clean(w.name)}" (cannon, rocket launcher, torpedo, gun or similar, as the Chinese name suggests), shown as a single object`;
    out.push({ kind: 'weapon', id: w.id, name: clean(w.name), subject });
  }
  for (const i of items) {
    if (weaponIds.has(i.id) || !sold.has(i.id) || i.goldCost <= 0) continue;
    // Blueprints get a neutral subject: weapon-upgrade wording trips the image API's filter.
    const blueprint = /^(设计图|合成图|船体强化)/.test(clean(i.name));
    const subject = blueprint
      ? `a rolled-out old parchment shipwright blueprint with ink technical drawings of ship parts, a brass compass and ruler on it (${/船体/.test(i.name) ? 'hull' : 'deck fitting'} plans)`
      : `a ship equipment item called "${clean(i.name)}": ${gist(i.description)}`;
    out.push({ kind: 'item', id: i.id, name: clean(i.name), subject });
  }
  const skills = new Set(ships.flatMap((s) => (s as unknown as { skills: string[] }).skills));
  // Skills bought for the ship (船只特殊能力) and the submarine's own actions.
  for (const id of ['AUls', 'Asta', 'A03I', 'Acri', 'ANhs', 'ANab', 'A036', 'A02H', 'A04M']) skills.add(id);
  for (const id of skills) {
    const a = byAbility.get(id);
    if (!a) continue;
    out.push({ kind: 'skill', id, name: clean(a.name), subject: `a naval battle skill called "${clean(a.name)}": ${gist(a.levels.at(-1)?.description ?? '')}, shown as a dramatic magical or military effect` });
  }
  return out;
}

async function requestImage(prompt: string): Promise<Buffer> {
  const { baseUrl, apiKey } = JSON.parse(readFileSync(join(root, 'key.json'), 'utf8')) as { baseUrl: string; apiKey: string };
  const model = (JSON.parse(readFileSync(join(root, 'art/manifest.json'), 'utf8')) as { model: string }).model;
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024' }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  const d = (JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] }).data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d?.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
  throw new Error(`No image in response: ${text.slice(0, 200)}`);
}

async function generate(ids: string[]): Promise<void> {
  const list = JSON.parse(readFileSync(listFile, 'utf8')) as Icon[];
  const todo = list.filter((i) => (ids.length === 0 || ids.includes(i.id)) && !existsSync(join(outDir, i.kind, `${i.id}.jpg`)));
  console.log(`${todo.length} icons to generate`);
  let done = 0;
  const failures: string[] = [];
  const worker = async () => {
    for (let icon = todo.shift(); icon; icon = todo.shift()) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const png = await requestImage(TEMPLATE.replace('{SUBJECT}', icon.subject));
          mkdirSync(join(fullDir, icon.kind), { recursive: true });
          mkdirSync(join(outDir, icon.kind), { recursive: true });
          const full = join(fullDir, icon.kind, `${icon.id}.png`);
          writeFileSync(full, png);
          execFileSync('sips', ['-Z', '128', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', full, '--out', join(outDir, icon.kind, `${icon.id}.jpg`)], { stdio: 'ignore' });
          console.log(`${++done} ${icon.kind}/${icon.id} ${icon.name}`);
          break;
        } catch (e) {
          if (attempt === 3) failures.push(`${icon.kind}/${icon.id}: ${String(e).slice(0, 200)}`);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (failures.length) { console.error(`${failures.length} failed:\n${failures.join('\n')}`); process.exitCode = 1; }
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'list') {
  const list = buildList();
  writeFileSync(listFile, JSON.stringify(list, null, 1) + '\n');
  const counts = list.reduce<Record<string, number>>((c, i) => ({ ...c, [i.kind]: (c[i.kind] ?? 0) + 1 }), {});
  console.log(`${list.length} icons`, counts);
} else if (command === 'generate') {
  await generate(rest);
} else {
  console.error('Usage: node src/icons.ts list | generate [id...]');
  process.exitCode = 1;
}
