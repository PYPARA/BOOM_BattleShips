// Ship model registry. Each entry builds a model for a team color; types without an entry
// fall back to the generic placeholder. A commercial image-to-3D pipeline can later add GLB
// loaders here without touching the rest of the client.
import type * as THREE from 'three/webgpu';
import { buildLord } from './ships/lord.ts';
import { buildSailor } from './ships/sailor.ts';
import { buildTurtle } from './ships/turtle.ts';

export type ShipModelFactory = (teamColor: THREE.ColorRepresentation) => THREE.Group;

export const shipModels: Record<string, ShipModelFactory> = {
  H000: buildSailor,
  H016: buildTurtle,
  H008: buildLord,
};

/** Concept image each model was built from, for the comparison viewer. */
export const shipConcepts: Record<string, string> = {
  H000: 'H000_sailor',
  H016: 'H016_turtle',
  H008: 'H008_lord',
};
