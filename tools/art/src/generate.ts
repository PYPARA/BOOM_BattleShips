// Generates concept images from art/manifest.json through an OpenAI-compatible images API.
// Credentials come from key.json at the repo root ({ baseUrl, apiKey }); it is gitignored.
//
// Usage: node src/generate.ts <id...> [--n 2] [--refs]
//   --n     candidates per view (default 1)
//   --refs  send the manifest's styleReferences as input images (images/edits endpoint)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const conceptsDir = join(root, 'art/concepts');
const previewDir = join(conceptsDir, 'preview');

interface Item { id: string; name: string; kind: 'style' | 'ship' | 'building' | 'creature'; views: string[]; description: string }
interface Manifest {
  model: string;
  style: string;
  views: Record<string, string>;
  shipSuffix: string;
  styleReferences: string[];
  items: Item[];
}

const manifest = JSON.parse(readFileSync(join(root, 'art/manifest.json'), 'utf8')) as Manifest;
const { baseUrl, apiKey } = JSON.parse(readFileSync(join(root, 'key.json'), 'utf8')) as { baseUrl: string; apiKey: string };

const args = process.argv.slice(2);
const n = Number(args[args.indexOf('--n') + 1]) > 0 && args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 1;
const useRefs = args.includes('--refs');
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--n');

export function buildPrompt(item: Item, view: string): string {
  const parts = [item.description];
  if (item.kind === 'ship' || item.kind === 'style') parts.push(manifest.shipSuffix);
  parts.push(manifest.views[view] ?? view, manifest.style);
  return parts.join(', ');
}

async function requestImages(prompt: string, count: number): Promise<Buffer[]> {
  const headers = { Authorization: `Bearer ${apiKey}` };
  let response: Response;
  if (useRefs) {
    const form = new FormData();
    form.set('model', manifest.model);
    form.set('prompt', `Match the art style of the reference images exactly. ${prompt}`);
    form.set('n', String(count));
    for (const file of manifest.styleReferences) {
      const path = join(conceptsDir, file);
      form.append('image[]', new Blob([readFileSync(path)], { type: 'image/png' }), file);
    }
    response = await fetch(`${baseUrl}/images/edits`, { method: 'POST', headers, body: form });
  } else {
    response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: manifest.model, prompt, n: count, size: '1024x1024' }),
    });
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] };
  const images: Buffer[] = [];
  for (const d of json.data ?? []) {
    if (d.b64_json) images.push(Buffer.from(d.b64_json, 'base64'));
    else if (d.url) images.push(Buffer.from(await (await fetch(d.url)).arrayBuffer()));
  }
  if (images.length === 0) throw new Error(`No image in response: ${text.slice(0, 300)}`);
  return images;
}

async function generate(item: Item, view: string): Promise<void> {
  const prompt = buildPrompt(item, view);
  const started = Date.now();
  const images = await requestImages(prompt, n);
  images.forEach((png, k) => {
    const suffix = images.length > 1 ? `_${String.fromCharCode(97 + k)}` : '';
    const base = `${item.id}_${item.name}_${view}${suffix}`;
    const file = join(conceptsDir, `${base}.png`);
    writeFileSync(file, png);
    // Small JPEG copy that is cheap to keep in git and to look at.
    execFileSync('sips', ['-Z', '1024', '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', file, '--out', join(previewDir, `${base}.jpg`)], { stdio: 'ignore' });
    console.log(`${base}.png  ${(png.length / 1024).toFixed(0)} KB  ${((Date.now() - started) / 1000).toFixed(0)} s`);
  });
}

async function main() {
  mkdirSync(previewDir, { recursive: true });
  if (useRefs) {
    for (const f of manifest.styleReferences) if (!existsSync(join(conceptsDir, f))) throw new Error(`Missing style reference ${f}`);
  }
  const items = ids.length ? manifest.items.filter((i) => ids.includes(i.id)) : [];
  if (items.length === 0) throw new Error(`No items selected. Known ids: ${manifest.items.map((i) => i.id).join(', ')}`);
  const jobs = items.flatMap((item) => item.views.map((view) => () => generate(item, view)));
  // A few requests at a time; image generation is slow but the API may rate-limit.
  const failures: string[] = [];
  for (let i = 0; i < jobs.length; i += 3) {
    const results = await Promise.allSettled(jobs.slice(i, i + 3).map((job) => job()));
    for (const r of results) if (r.status === 'rejected') failures.push(String(r.reason));
  }
  if (failures.length) {
    console.error(`${failures.length} failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
}

await main();
