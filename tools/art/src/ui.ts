// Generates the interface art (the menu and loading key art) through the images API. The UI
// itself is drawn in CSS (a clean, modern glass style).
// Usage: node src/ui.ts [name...]   (all missing ones when no names)
// Originals go to art/ui/ (gitignored); the post-processed files the client uses are written by
// tools/art/src/ui-process.py into packages/client/public/ui/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = join(root, 'art/ui');

const STYLE = 'stylized hand-painted fantasy naval game art, warm golden light, rich colors, clean readable shapes, no text, no letters, no watermark';

interface Asset { prompt: string; size: '1024x1024' | '1536x1024'; transparent?: boolean }

const ASSETS: Record<string, Asset> = {
  keyart: {
    size: '1536x1024',
    prompt: `epic wide key art for a naval battle game: two fleets of chunky stylized wooden and ironclad warships trading cannon fire across a turquoise tropical sea between lush islands and a stone harbor fortress, cannon smoke and splashes, dramatic golden hour sky, the upper center of the sky calm and uncluttered, ${STYLE}`,
  },
  logo: {
    size: '1024x1024', transparent: true,
    prompt: 'a modern game logo emblem without any text: a stylized warship bow with a cannon cutting through a cresting wave inside an angular shield, bold flat vector shapes with subtle gradients, steel white and bright cyan blue with a touch of orange, crisp clean edges, centered, isolated on a transparent background, no text, no letters',
  },
  compassLines: {
    size: '1024x1024', transparent: true,
    prompt: 'minimalist line-art compass rose with thin concentric rings, degree ticks and an eight-point star, thin uniform white lines only, technical nautical chart style, centered, isolated on a transparent background, no text, no letters, no numbers',
  },
  loading: {
    size: '1536x1024',
    prompt: `wide atmospheric scene: a fleet of stylized warships with billowing sails setting out at dawn through light sea mist toward distant islands, lighthouse glow, calm turquoise water, ${STYLE}`,
  },
};

async function requestImage(asset: Asset): Promise<Buffer> {
  const { baseUrl, apiKey } = JSON.parse(readFileSync(join(root, 'key.json'), 'utf8')) as { baseUrl: string; apiKey: string };
  const model = (JSON.parse(readFileSync(join(root, 'art/manifest.json'), 'utf8')) as { model: string }).model;
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt: asset.prompt, n: 1, size: asset.size,
      ...(asset.transparent ? { background: 'transparent', output_format: 'png' } : {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  const d = (JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] }).data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d?.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
  throw new Error(`No image in response: ${text.slice(0, 200)}`);
}

const names = process.argv.slice(2);
const todo = Object.keys(ASSETS).filter((n) => (names.length ? names.includes(n) : !existsSync(join(outDir, `${n}.png`))));
mkdirSync(outDir, { recursive: true });
let i = 0;
const failures: string[] = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let name = todo[i++]; name; name = todo[i++]) {
    try {
      writeFileSync(join(outDir, `${name}.png`), await requestImage(ASSETS[name]!));
      console.log(name);
    } catch (e) {
      failures.push(`${name}: ${String(e).slice(0, 200)}`);
    }
  }
}));
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
