// Copies a model built in Aha's 3D Workshop into the client.
//
// Usage: node src/pull-aha.ts <project name or id> <game id> [--kind ships|buildings] [--team <material name>...]
//
// Takes the adopted version (or, with a warning, the current preview version) from
// ~/Documents/Aha/Models3D/<project>/, copies its model.glb to
// packages/client/public/models/<kind>/<game id>.glb and writes a sidecar <game id>.json
// with the source version, the waterline parameter and which materials take team color.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface AhaVersion { id: string; name: string; createdAt: string; build?: { parameters?: Record<string, unknown> }; report?: { triangles?: number } }
interface AhaProject { id: string; name: string; adoptedVersionId: string | null; previewVersionId: string | null; versions: AhaVersion[] }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const modelsRoot = process.env.AHA_MODELS_DIR ?? join(homedir(), 'Documents/Aha/Models3D');

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const kind = flag('--kind') ?? 'ships';
const teamMaterials = args.flatMap((a, i) => (args[i - 1] === '--team' ? [a] : []));
const [query, gameId] = args.filter((a, i) => !a.startsWith('--') && !['--kind', '--team'].includes(args[i - 1] ?? ''));
if (!query || !gameId) {
  console.error('Usage: node src/pull-aha.ts <project name or id> <game id> [--kind ships|buildings] [--team <material>]');
  process.exit(1);
}

const projects = readdirSync(modelsRoot)
  .map((dir) => join(modelsRoot, dir, 'project.json'))
  .filter(existsSync)
  .map((file) => ({ dir: dirname(file), project: JSON.parse(readFileSync(file, 'utf8')) as AhaProject }));
const matches = projects.filter(({ project }) => project.id === query || project.id.startsWith(query) || project.name === query);
if (matches.length !== 1) {
  console.error(matches.length ? `"${query}" matches several projects:` : `No Aha project named "${query}". Projects:`);
  for (const { project } of matches.length ? matches : projects) console.error(`  ${project.id}  ${project.name}`);
  process.exit(1);
}
const { dir, project } = matches[0]!;
const versionId = project.adoptedVersionId ?? project.previewVersionId;
const version = project.versions.find((v) => v.id === versionId);
if (!version) {
  console.error(`Project "${project.name}" has no built version yet.`);
  process.exit(1);
}
if (!project.adoptedVersionId) console.warn(`Note: "${project.name}" has no adopted version; using preview ${version.name}.`);

const glb = join(dir, 'versions', version.id, 'model.glb');
const outDir = join(root, 'packages/client/public/models', kind);
mkdirSync(outDir, { recursive: true });
copyFileSync(glb, join(outDir, `${gameId}.glb`));
const waterline = Number(version.build?.parameters?.waterline);
writeFileSync(join(outDir, `${gameId}.json`), JSON.stringify({
  source: 'aha',
  projectId: project.id,
  projectName: project.name,
  versionId: version.id,
  versionName: version.name,
  adopted: project.adoptedVersionId === version.id,
  triangles: version.report?.triangles,
  /** Meters above the model's bottom; undefined means the client's default. */
  waterline: Number.isFinite(waterline) ? waterline : undefined,
  teamMaterials: teamMaterials.length ? teamMaterials : ['team'],
}, null, 2) + '\n');
console.log(`${project.name} ${version.name} → packages/client/public/models/${kind}/${gameId}.glb (${version.report?.triangles ?? '?'} triangles)`);
