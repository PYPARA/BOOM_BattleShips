// Engine-generated masts and sails for ships whose models leave them out (all Aha GLBs, per
// docs/art/README.md). Positions are fractions of the ship length so they survive model
// revisions; each mast stands on whatever surface a downward ray hits at its x.
import * as THREE from 'three/webgpu';
import { addRig, ModelBuilder, type MastSpec } from './kit.ts';

interface RigMast {
  /** Along the ship, as a fraction of length from the center (+ toward the bow). */
  x: number;
  /** Mast height and sail width as fractions of length. */
  height: number;
  width: number;
  style: MastSpec['style'];
  sailColor: THREE.ColorRepresentation;
}

/** Sail styles from docs/art/image-prompts.md. */
export const shipRigs: Record<string, RigMast[]> = {
  H000: [{ x: 0.05, height: 0.65, width: 0.38, style: 'lateen', sailColor: 0xf1ead8 }],
  H016: [
    { x: 0.14, height: 0.48, width: 0.3, style: 'junk', sailColor: 0xc9a35a },
    { x: -0.22, height: 0.4, width: 0.26, style: 'junk', sailColor: 0xc9a35a },
  ],
  H008: [{ x: -0.04, height: 0.42, width: 0.28, style: 'square', sailColor: 0x5a5d63 }],
};

const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);

/**
 * Returns `ship` (bow along +x, `length` long) together with a generated `rig` group, side by
 * side in an unscaled container, or `ship` unchanged when its type has no rig spec.
 */
export function withEngineRig(ship: THREE.Object3D, typeId: string, length: number, teamColor: THREE.ColorRepresentation): THREE.Object3D {
  const masts = shipRigs[typeId];
  if (!masts) return ship;
  ship.updateMatrixWorld(true);
  const b = new ModelBuilder();
  const specs: MastSpec[] = masts.map((m) => {
    const x = m.x * length;
    raycaster.set(new THREE.Vector3(x, length * 10, 0), down);
    const hit = raycaster.intersectObject(ship, true)[0];
    return { x, base: hit ? hit.point.y : 0, height: m.height * length, width: m.width * length, style: m.style, sailColor: m.sailColor };
  });
  addRig(b, specs, () => 0);
  const built = b.build('rig', teamColor);
  const container = new THREE.Group();
  container.add(ship);
  const rig = built.getObjectByName('rig');
  if (rig) container.add(rig);
  return container;
}
