// The map's weather (rain, snow, rays of light; looks only) around what the camera shows: rain
// streaks and snowflakes fall in a box that follows the view, sun rays slant down through it.
import * as THREE from 'three/webgpu';
import type { Weather } from '@boom/sim';
import { SEA_LEVEL } from './space.ts';

const DROPS = 2600;
const FLAKES = 1400;
const RAYS = 10;
/** Height of the falling box above the sea. */
const TOP = 1400;

export class WeatherView {
  readonly group = new THREE.Group();
  private weather: Weather = 'clear';
  private readonly rain: THREE.LineSegments;
  private readonly rainPos: Float32Array;
  private readonly rainMat: THREE.LineBasicMaterial;
  private readonly snow: THREE.InstancedMesh;
  private readonly flakes: { x: number; y: number; z: number; drift: number }[] = [];
  private readonly snowMat: THREE.MeshBasicMaterial;
  private readonly rays: THREE.Mesh[] = [];
  private readonly rayMat: THREE.MeshBasicMaterial;
  /** Eased strength of each kind, so the weather fades in and out. */
  private level = { rain: 0, snow: 0, rays: 0 };
  private box = 3000;
  private readonly m = new THREE.Matrix4();

  constructor() {
    this.group.name = 'weather';
    // Rain: short slanted streaks; positions are relative to the box, rewritten each frame.
    this.rainPos = new Float32Array(DROPS * 6);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.LineSegments(rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    for (let i = 0; i < DROPS; i++) this.respawnDrop(i, Math.random() * TOP);

    this.snowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.snow = new THREE.InstancedMesh(new THREE.CircleGeometry(4, 6), this.snowMat, FLAKES);
    this.snow.frustumCulled = false;
    for (let i = 0; i < FLAKES; i++) this.flakes.push({ x: Math.random() - 0.5, y: Math.random() * TOP, z: Math.random() - 0.5, drift: Math.random() * Math.PI * 2 });

    // Rays: tall soft beams, bright in the middle and fading at the edges and the bottom.
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const across = ctx.createLinearGradient(0, 0, 64, 0);
    across.addColorStop(0, 'rgba(255,240,200,0)'); across.addColorStop(0.5, 'rgba(255,240,200,1)'); across.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, 64, 256);
    ctx.globalCompositeOperation = 'destination-in';
    const down = ctx.createLinearGradient(0, 0, 0, 256);
    down.addColorStop(0, 'rgba(0,0,0,0.9)'); down.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = down;
    ctx.fillRect(0, 0, 64, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Light shafts sit in the air between camera and sea: drawn over everything rather than cut by the water.
    this.rayMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < RAYS; i++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.rayMat);
      ray.userData.seed = Math.random();
      ray.renderOrder = 10;
      this.rays.push(ray);
    }
    this.group.add(this.rain, this.snow, ...this.rays);
  }

  set(weather: Weather): void {
    this.weather = weather;
  }

  private respawnDrop(i: number, height: number): void {
    const x = Math.random() - 0.5, z = Math.random() - 0.5;
    const o = i * 6;
    this.rainPos[o] = x; this.rainPos[o + 1] = height; this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x; this.rainPos[o + 4] = height; this.rainPos[o + 5] = z;
  }

  update(dt: number, target: THREE.Vector3, camera: THREE.Camera, viewDistance: number): void {
    const w = this.weather;
    const ease = (v: number, to: number) => v + (to - v) * Math.min(1, dt * 0.5);
    this.level.rain = ease(this.level.rain, w === 'heavyRain' ? 1 : w === 'lightRain' ? 0.4 : 0);
    this.level.snow = ease(this.level.snow, w === 'snow' ? 1 : 0);
    this.level.rays = ease(this.level.rays, w === 'sunrays' ? 1 : 0);
    this.box = Math.max(1500, viewDistance * 1.6);
    this.group.position.set(target.x, SEA_LEVEL, target.z);

    // Rain: drops fall with a slant; only a share of them show in light rain.
    this.rain.visible = this.level.rain > 0.01;
    if (this.rain.visible) {
      const shown = Math.round(DROPS * Math.min(1, this.level.rain * 1.2));
      const fall = 1700 * dt, len = 70;
      for (let i = 0; i < DROPS; i++) {
        const o = i * 6;
        let y = this.rainPos[o + 1]! - fall;
        if (y < 0) { this.respawnDrop(i, TOP); y = TOP; }
        const x = this.rainPos[o]!, z = this.rainPos[o + 2]!;
        const hide = i >= shown ? -1e5 : 0;
        this.rainPos[o + 1] = y + hide;
        this.rainPos[o + 4] = y + len + hide;
        this.rainPos[o + 3] = x - 0.004; // wind
        this.rainPos[o + 5] = z;
      }
      this.rain.scale.set(this.box, 1, this.box);
      this.rain.geometry.attributes.position!.needsUpdate = true;
      this.rainMat.opacity = 0.6 * this.level.rain;
    }

    // Snow: flakes drift down, turned to face the camera.
    this.snow.visible = this.level.snow > 0.01;
    if (this.snow.visible) {
      const t = performance.now() / 1000;
      const q = camera.quaternion;
      const scale = new THREE.Vector3(1, 1, 1).multiplyScalar(this.box / 3000);
      const pos = new THREE.Vector3();
      this.flakes.forEach((f, i) => {
        f.y -= 90 * dt;
        if (f.y < 0) { f.y = TOP; f.x = Math.random() - 0.5; f.z = Math.random() - 0.5; }
        pos.set((f.x + Math.sin(t * 0.7 + f.drift) * 0.01) * this.box, f.y, f.z * this.box);
        this.snow.setMatrixAt(i, this.m.compose(pos, q, scale));
      });
      this.snow.instanceMatrix.needsUpdate = true;
      this.snowMat.opacity = 0.85 * this.level.snow;
    }

    // Sun rays: slanted beams turned to the camera (the view looks steeply down, so beams standing
    // upright would be seen edge-on), drifting slowly across the view.
    const showRays = this.level.rays > 0.01;
    this.rays.forEach((ray, i) => {
      ray.visible = showRays;
      if (!showRays) return;
      const s = ray.userData.seed as number;
      const t = performance.now() / 1000 * 0.015 + s * 10;
      ray.position.set(((s * 1.7 + t) % 1 - 0.5) * this.box * 1.1, 200 + 300 * ((s * 5) % 1), ((s * 3.1) % 1 - 0.5) * this.box * 0.7);
      ray.quaternion.copy(camera.quaternion);
      ray.rotateZ(-0.45 + ((i % 3) - 1) * 0.06);
      ray.scale.set(this.box * (0.05 + 0.08 * ((s * 7) % 1)), this.box * 0.9, 1);
    });
    this.rayMat.opacity = 0.22 * this.level.rays;
  }
}
