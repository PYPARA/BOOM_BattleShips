import * as THREE from 'three/webgpu';

const PITCH = THREE.MathUtils.degToRad(56);
const MIN_DISTANCE = 800;
const MAX_DISTANCE = 4000;

/** Warcraft-style RTS camera: fixed pitch, wheel zoom, drag to pan. */
export function createRtsCamera(dom: HTMLElement) {
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 10, 20000);
  const target = new THREE.Vector3(0, 0, 0);
  let distance = 2200;

  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    distance = THREE.MathUtils.clamp(distance * Math.exp(e.deltaY * 0.001), MIN_DISTANCE, MAX_DISTANCE);
  }, { passive: false });

  let dragging = false;
  dom.addEventListener('pointerdown', (e) => {
    if (e.button === 0 || e.button === 1) dragging = true;
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const scale = distance / 900;
    target.x -= e.movementX * scale;
    target.z -= e.movementY * scale / Math.sin(PITCH);
  });

  function update() {
    camera.position.set(target.x, target.y + distance * Math.sin(PITCH), target.z + distance * Math.cos(PITCH));
    camera.lookAt(target);
  }

  return { camera, target, update };
}
