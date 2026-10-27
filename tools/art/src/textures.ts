// Generates the terrain ground textures through the images API used by generate.ts.
// Usage: node src/textures.ts [name...]   (all missing ones when no names)
// Writes packages/client/public/textures/terrain/<name>.jpg (512 px). The client tiles them
// mirrored, so they do not need to be seamless.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = join(root, 'packages/client/public/textures/terrain');
const fullDir = join(root, 'art/textures');

const STYLE = 'flat top-down orthographic view filling the whole square, hand-painted stylized game ground texture, soft painterly strokes, low contrast, even lighting, no shadows, no objects, no horizon, no border, no text';
/** Map ground tiles (Lordaeron Summer) plus beach and seabed. */
const TEXTURES: Record<string, string> = {
  grass: 'lush bright green grass with tiny clover and a few small flowers',
  grass_dark: 'dense dark green grass with darker patches',
  dirt: 'warm brown packed dirt path with small pebbles',
  dirt_rough: 'rough darker brown dirt with roots and small stones',
  dirt_grass: 'patchy mix of short grass and brown dirt',
  rock: 'grey stone cliff rock surface with cracks and a little moss',
  sand: 'pale golden beach sand with gentle ripples and a few tiny shells',
  seabed: 'shallow sandy seabed seen through water, teal-tinted sand with small rocks',
};

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

const names = process.argv.slice(2);
const todo = Object.keys(TEXTURES).filter((n) => (names.length ? names.includes(n) : !existsSync(join(outDir, `${n}.jpg`))));
mkdirSync(outDir, { recursive: true });
mkdirSync(fullDir, { recursive: true });
const results = await Promise.allSettled(todo.map(async (name) => {
  const png = await requestImage(`${TEXTURES[name]}, ${STYLE}`);
  const full = join(fullDir, `${name}.png`);
  writeFileSync(full, png);
  execFileSync('sips', ['-Z', '512', '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', full, '--out', join(outDir, `${name}.jpg`)], { stdio: 'ignore' });
  console.log(name);
}));
for (const r of results) if (r.status === 'rejected') { console.error(String(r.reason)); process.exitCode = 1; }
