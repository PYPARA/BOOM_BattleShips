// Shader prewarm. WebGPU builds a pipeline the first time a material is drawn, which stalls that
// frame (the first explosion, the first ship of a new type). Before the match starts, everything
// the match can show is drawn once: empty effect pools, hidden weather, and one copy of every
// ship, creature and building model in each team color, parked behind the camera.
import * as THREE from 'three/webgpu';
import { glbIds, glbModel, type ModelKind } from './models/glb.ts';
import { TEAM_COLORS } from './space.ts';

/**
 * At load (`live` false): everything, with one drawn frame. During the match (`live`): only the
 * models, compiled against the scene's lights without touching what is on screen.
 */
export async function prewarm(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, live = false): Promise<void> {
  const restore: (() => void)[] = [];
  if (!live) scene.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (mesh.isInstancedMesh && mesh.count === 0) { mesh.count = 1; restore.push(() => { mesh.count = 0; }); }
    if (!o.visible) { o.visible = true; restore.push(() => { o.visible = false; }); }
    if ((o as THREE.Mesh).isMesh && o.frustumCulled) { o.frustumCulled = false; restore.push(() => { o.frustumCulled = true; }); }
  });

  const models = new THREE.Group();
  const kinds: [ModelKind, THREE.ColorRepresentation[]][] = [
    ['ships', [TEAM_COLORS.south, TEAM_COLORS.north]],
    ['creatures', [TEAM_COLORS.neutral]],
    ['buildings', [TEAM_COLORS.south, TEAM_COLORS.north, TEAM_COLORS.neutral]],
  ];
  for (const [kind, colors] of kinds) {
    for (const id of glbIds(kind)) {
      for (const color of colors) {
        const model = glbModel(kind, id, color, { length: 100, height: 100 });
        if (model) models.add(model);
      }
    }
  }
  models.traverse((o) => { o.frustumCulled = false; });
  if (live) {
    await renderer.compileAsync(models, camera, scene);
    return;
  }
  // Behind the camera: drawn (so compiled) but never on screen.
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion).multiplyScalar(500);
  models.position.copy(camera.position).add(back);
  scene.add(models);

  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);

  scene.remove(models);
  for (const undo of restore) undo();
}
