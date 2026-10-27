// Generates the interface art through the images API: the menu and loading key art, and the
// hand-painted fantasy UI kit (dark ship timber, blackened iron, teal gems) that the CSS lays
// out as border images: panel frame, top-bar plaque, buttons, slots, a banner and the crest.
// Usage: node src/ui.ts [name...]   (all missing ones when no names)
// Originals go to art/ui/ (gitignored); the post-processed files the client uses are written by
// tools/art/src/ui-process.py into packages/client/public/ui/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = join(root, 'art/ui');

const STYLE = 'stylized hand-painted fantasy naval game art, warm golden light, rich colors, clean readable shapes, no text, no letters, no watermark';

interface Asset { prompt: string; size: '1024x1024' | '1536x1024' | '1024x1536'; transparent?: boolean }

/** The fantasy kit's shared look. */
const KIT = 'hand-painted fantasy RTS game UI art, dark weathered ship timber, blackened wrought iron with bronze rivets, small polished teal gemstones, muted readable colors, not gold, crisp painted edges, front view, perfectly symmetrical, centered, isolated on a transparent background, no text, no letters';

const ASSETS: Record<string, Asset> = {
  woodFrame: {
    size: '1024x1024', transparent: true,
    prompt: `a square game UI panel: a thick border of dark timber bound with blackened iron straps, an ornate iron corner bracket with one round teal gem in each of the four corners, rivets evenly spaced along the border, the large inner area a plain flat dark walnut wood surface with very subtle grain, the border the same thickness on all four sides, ${KIT}`,
  },
  woodPlaque: {
    size: '1536x1024', transparent: true,
    prompt: `a single long horizontal game UI title plaque, very wide and short: a dark wood board with a blackened iron rim, iron end caps shaped like scrolls with a teal gem at the left and right ends, the middle plain and empty for text, ${KIT}`,
  },
  woodButton: {
    size: '1536x1024', transparent: true,
    prompt: `a single wide horizontal game UI button, very wide and short with slightly rounded corners: a dark brown wood face with a blackened iron rim and small rivets, a soft highlight along the top edge, the face empty, ${KIT}`,
  },
  woodButtonOn: {
    size: '1536x1024', transparent: true,
    prompt: `a single wide horizontal game UI button, very wide and short with slightly rounded corners: a glowing deep teal lacquered face with a bright inner glow, a blackened iron rim with small rivets and a tiny teal gem at each end, the face empty, ${KIT}`,
  },
  woodSlot: {
    size: '1024x1024', transparent: true,
    prompt: `a single square game UI slot for an ability icon: a blackened iron frame with four rivets and beveled edges, a dark recessed inset in the middle, empty, ${KIT}`,
  },
  woodBanner: {
    size: '1024x1536', transparent: true,
    prompt: `a single tall hanging cloth banner on a short wooden pole: weathered dark navy canvas with a pale painted ship anchor emblem and a frayed swallowtail bottom edge, ${KIT}`,
  },
  woodCrest: {
    size: '1024x1024', transparent: true,
    prompt: `a game logo emblem without any text: a heraldic shield of dark timber and blackened iron with two crossed cannons behind it, a ship anchor on the shield, a large teal gem at the top, rope coiled around the bottom, ${KIT}`,
  },
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
