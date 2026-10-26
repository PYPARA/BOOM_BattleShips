import * as THREE from 'three/webgpu';
import { SEA_LEVEL } from './space.ts';

const PITCH = THREE.MathUtils.degToRad(56);
const MIN_DISTANCE = 900;
const MAX_DISTANCE = 4200;
const EDGE_PX = 12;
/** Pan speed in world units per second at the default zoom. */
const PAN_SPEED = 2600;

export interface MapBounds { minX: number; minY: number; maxX: number; maxY: number }

/**
 * Warcraft-style RTS camera: fixed pitch, wheel zoom, pan with screen edges, arrow keys
 * or middle-mouse drag. `target` is the sea-level point the camera looks at (three.js space).
 */
export class RtsCamera {
  readonly camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 20, 30000);
  readonly target = new THREE.Vector3(0, SEA_LEVEL, 0);
  private distance = 2400;
  private readonly keys = new Set<string>();
  private mouse: { x: number; y: number } | undefined;
  private dragging = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SEA_LEVEL);
  private readonly bounds: MapBounds;

  constructor(dom: HTMLElement, bounds: MapBounds) {
    this.bounds = bounds;
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), MIN_DISTANCE, MAX_DISTANCE);
    }, { passive: false });
    dom.addEventListener('pointerdown', (e) => { if (e.button === 1) { this.dragging = true; e.preventDefault(); } });
    window.addEventListener('pointerup', (e) => { if (e.button === 1) this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!this.dragging) return;
      const scale = this.distance / 1000;
      this.target.x -= e.movementX * scale;
      this.target.z -= (e.movementY * scale) / Math.sin(PITCH);
    });
    dom.addEventListener('pointerleave', () => { this.mouse = undefined; });
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Centers the view on a sim-space point. */
  lookAt(x: number, y: number): void {
    this.target.set(x, SEA_LEVEL, -y);
  }

  update(dt: number): void {
    let dx = 0, dz = 0;
    // Letters are skill hotkeys (the map's own, e.g. F for 冻结), so only arrows pan.
    if (this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('arrowup')) dz -= 1;
    if (this.keys.has('arrowdown')) dz += 1;
    if (this.mouse && document.hasFocus()) {
      if (this.mouse.x <= EDGE_PX) dx -= 1;
      if (this.mouse.x >= window.innerWidth - EDGE_PX) dx += 1;
      if (this.mouse.y <= EDGE_PX) dz -= 1;
      if (this.mouse.y >= window.innerHeight - EDGE_PX) dz += 1;
    }
    const speed = PAN_SPEED * (this.distance / 2400) * dt;
    this.target.x += Math.sign(dx) * speed;
    this.target.z += Math.sign(dz) * speed;
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -this.bounds.maxY, -this.bounds.minY);

    this.camera.position.set(
      this.target.x,
      this.target.y + this.distance * Math.sin(PITCH),
      this.target.z + this.distance * Math.cos(PITCH),
    );
    this.camera.lookAt(this.target);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Sea-level point under a screen position, in sim space. */
  screenToSea(clientX: number, clientY: number): { x: number; y: number } | undefined {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.seaPlane, new THREE.Vector3());
    return hit ? { x: hit.x, y: -hit.z } : undefined;
  }
}
