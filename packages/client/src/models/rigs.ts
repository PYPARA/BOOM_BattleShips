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
  H00D: [
    { x: 0.15, height: 0.62, width: 0.4, style: 'square', sailColor: 0xe2d3ae },
  ],
  H001: [
    { x: 0.06, height: 0.62, width: 0.4, style: 'lateen', sailColor: 0xf1ead8 },
  ],
  H01A: [
    { x: -0.2, height: 0.6, width: 0.39, style: 'square', sailColor: 0xa7cedc },
  ],
  H021: [
    { x: 0.16, height: 0.65, width: 0.43, style: 'square', sailColor: 0xf4edd9 },
  ],
  H003: [
    { x: 0.23, height: 0.61, width: 0.34, style: 'square', sailColor: 0xf1ead8 },
    { x: -0.2, height: 0.53, width: 0.3, style: 'square', sailColor: 0xf1ead8 },
  ],
  H004: [
    { x: 0.1, height: 0.53, width: 0.31, style: 'square', sailColor: 0xd4d4cb },
    { x: -0.3, height: 0.45, width: 0.27, style: 'square', sailColor: 0xd4d4cb },
  ],
  H01K: [
    { x: 0.24, height: 0.62, width: 0.35, style: 'square', sailColor: 0xf6edcf },
    { x: -0.3, height: 0.53, width: 0.31, style: 'square', sailColor: 0xf6edcf },
  ],
  H007: [
    { x: 0.08, height: 0.57, width: 0.34, style: 'square', sailColor: 0x828582 },
    { x: -0.3, height: 0.49, width: 0.3, style: 'square', sailColor: 0x828582 },
  ],
  H006: [
    { x: 0.16, height: 0.56, width: 0.32, style: 'square', sailColor: 0x253e70 },
    { x: -0.2, height: 0.48, width: 0.29, style: 'square', sailColor: 0x253e70 },
  ],
  H01C: [
    { x: 0.18, height: 0.59, width: 0.34, style: 'square', sailColor: 0x772f35 },
    { x: -0.22, height: 0.51, width: 0.3, style: 'square', sailColor: 0x772f35 },
  ],
  H01D: [
    { x: 0.16, height: 0.59, width: 0.34, style: 'square', sailColor: 0xc6b9e3 },
    { x: -0.21, height: 0.51, width: 0.3, style: 'square', sailColor: 0xc6b9e3 },
  ],
  H01H: [
    { x: 0.22, height: 0.58, width: 0.34, style: 'junk', sailColor: 0x6d9b48 },
    { x: -0.32, height: 0.5, width: 0.3, style: 'junk', sailColor: 0x6d9b48 },
  ],
  H01N: [
    { x: 0.2, height: 0.55, width: 0.29, style: 'square', sailColor: 0x7d9182 },
    { x: -0.02, height: 0.64, width: 0.34, style: 'square', sailColor: 0x7d9182 },
    { x: -0.31, height: 0.45, width: 0.25, style: 'square', sailColor: 0x7d9182 },
  ],
  H00X: [
    { x: 0.29, height: 0.58, width: 0.42, style: 'square', sailColor: 0xb34a42 },
  ],
  H00V: [
    { x: 0.36, height: 0.54, width: 0.29, style: 'square', sailColor: 0xf2e5bb },
    { x: 0.12, height: 0.63, width: 0.34, style: 'square', sailColor: 0xf2e5bb },
    { x: -0.2, height: 0.45, width: 0.25, style: 'square', sailColor: 0xf2e5bb },
  ],
  H00T: [
    { x: 0.07, height: 0.57, width: 0.42, style: 'square', sailColor: 0x282629 },
  ],
  H011: [
    { x: 0.23, height: 0.56, width: 0.34, style: 'lateen', sailColor: 0x24232b },
    { x: -0.21, height: 0.48, width: 0.3, style: 'lateen', sailColor: 0x24232b },
  ],
  H01L: [
    { x: 0.29, height: 0.56, width: 0.34, style: 'junk', sailColor: 0xaabed7 },
    { x: -0.4, height: 0.48, width: 0.3, style: 'junk', sailColor: 0xaabed7 },
  ],
  H009: [
    { x: 0.42, height: 0.51, width: 0.29, style: 'square', sailColor: 0x872e35 },
    { x: 0.1, height: 0.59, width: 0.33, style: 'square', sailColor: 0x872e35 },
    { x: -0.41, height: 0.43, width: 0.25, style: 'square', sailColor: 0x872e35 },
  ],
  H01O: [
    { x: 0.25, height: 0.53, width: 0.29, style: 'square', sailColor: 0x302e33 },
    { x: 0.12, height: 0.61, width: 0.33, style: 'square', sailColor: 0x302e33 },
    { x: -0.25, height: 0.45, width: 0.25, style: 'square', sailColor: 0x302e33 },
  ],
  H019: [
    { x: 0.34, height: 0.44, width: 0.24, style: 'junk', sailColor: 0xac3c30 },
    { x: 0.17, height: 0.52, width: 0.27, style: 'junk', sailColor: 0xac3c30 },
    { x: 0.0, height: 0.59, width: 0.3, style: 'junk', sailColor: 0xac3c30 },
    { x: -0.18, height: 0.52, width: 0.27, style: 'junk', sailColor: 0xac3c30 },
    { x: -0.44, height: 0.43, width: 0.23, style: 'junk', sailColor: 0xac3c30 },
  ],
  H00C: [
    { x: 0.28, height: 0.55, width: 0.29, style: 'square', sailColor: 0x27262b },
    { x: -0.02, height: 0.64, width: 0.34, style: 'square', sailColor: 0x27262b },
    { x: -0.31, height: 0.46, width: 0.25, style: 'square', sailColor: 0x27262b },
  ],
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
    // Some Aha decks leave a narrow plank seam on the centerline. Sample either side
    // as well, so a mast rests on the deck instead of falling through that seam.
    let base = -Infinity;
    for (const z of [0, length * 0.002, -length * 0.002]) {
      raycaster.set(new THREE.Vector3(x, length * 10, z), down);
      const hit = raycaster.intersectObject(ship, true)[0];
      if (hit) base = Math.max(base, hit.point.y);
    }
    return { x, base: Number.isFinite(base) ? base : 0, height: m.height * length, width: m.width * length, style: m.style, sailColor: m.sailColor };
  });
  addRig(b, specs, () => 0);
  const built = b.build('rig', teamColor);
  const container = new THREE.Group();
  container.add(ship);
  const rig = built.getObjectByName('rig');
  if (rig) container.add(rig);
  return container;
}
