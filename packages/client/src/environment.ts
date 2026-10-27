// Sky, sunlight, shadows and the day/night cycle. A gradient sky dome with a sun glow sets the
// horizon and fog color and, rendered once into an environment map, gives water and hulls
// something to reflect. The sun casts shadows in a box that follows the camera, sized to what is
// on screen, and swings across the sky with the map's clock: warm at dawn and dusk, a dim blue
// moonlight at night.
import * as THREE from 'three/webgpu';
import { cameraPosition, dot, float, max, mix, normalize, positionWorld, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import { timeOfDay } from '@boom/sim';

const ZENITH = new THREE.Color(0x3d7cc4);
const HORIZON = new THREE.Color(0xbfdcea);
/** Direction toward the sun: high in the south-west, like the map's default lighting. */
const SUN_DIR = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();

const NIGHT_ZENITH = new THREE.Color(0x0b1730);
const NIGHT_HORIZON = new THREE.Color(0x26385a);
const DUSK = new THREE.Color(0xffa060);

/** Sky colors and sun direction the dome reads, updated with the clock. */
const skyState = {
  zenith: uniform(ZENITH.clone()),
  horizon: uniform(HORIZON.clone()),
  sunDir: uniform(SUN_DIR.clone()),
  glow: uniform(1),
};

function skyMaterial(fixed = false): THREE.MeshBasicNodeMaterial {
  const dir = normalize(positionWorld.sub(cameraPosition));
  const up = max(dir.y, 0);
  const horizon = fixed ? vec3(HORIZON.r, HORIZON.g, HORIZON.b) : skyState.horizon;
  const zenith = fixed ? vec3(ZENITH.r, ZENITH.g, ZENITH.b) : skyState.zenith;
  const sky = mix(horizon, zenith, pow(up, float(0.55)));
  const sun = dot(dir, fixed ? vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z) : skyState.sunDir);
  const glow = pow(max(sun, 0), float(64)).mul(0.6).add(smoothstep(float(0.9995), float(0.9999), sun));
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  m.colorNode = sky.add(vec3(1, 0.93, 0.78).mul(glow).mul(fixed ? float(1) : skyState.glow));
  return m;
}

/** 0 at night, 1 by day, easing over dawn (5–7 h) and dusk (17–19 h). */
export function daylight(hour: number): number {
  const ease = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return ease(5, 7, hour) - ease(17, 19, hour);
}

export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  private readonly hemi: THREE.HemisphereLight;
  private readonly scene: THREE.Scene;
  private shadowSize = 0;
  private readonly sunDir = SUN_DIR.clone();

  constructor(scene: THREE.Scene, shadowMapSize = 2048) {
    scene.background = HORIZON.clone();
    scene.fog = new THREE.Fog(HORIZON.clone(), 5000, 14000);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), skyMaterial());
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x3a5a48, 0.9);
    scene.add(this.hemi);
    this.scene = scene;
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 2;
    this.sun.shadow.camera.near = 100;
    this.sun.shadow.camera.far = 12000;
    scene.add(this.sun, this.sun.target);
  }

  /** Bakes the sky into the scene's environment map (reflections on water and metal). */
  bakeEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene): void {
    const skyScene = new THREE.Scene();
    skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(true)));
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(skyScene);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.55;
  }

  /** Keeps the sun's shadow box over what the camera looks at. */
  update(camera: THREE.Camera, target: THREE.Vector3, distance: number, tick: number): void {
    this.updateClock(timeOfDay(tick));
    this.sky.position.copy(camera.position);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 6000);
    const size = Math.ceil((distance * 1.1) / 200) * 200;
    if (size !== this.shadowSize) {
      this.shadowSize = size;
      const c = this.sun.shadow.camera;
      c.left = -size; c.right = size; c.top = size; c.bottom = -size;
      c.updateProjectionMatrix();
    }
  }

  /** Light, sky and fog for the hour: the sun by day, a low blue moon by night. */
  private updateClock(hour: number): void {
    const d = daylight(hour);
    // Dawn and dusk: the warm tint peaks halfway through the change.
    const dusk = 1 - Math.abs(d * 2 - 1);
    // By day the sun crosses from east (6 h) to west (18 h); at night a fixed high moon.
    const a = ((hour - 12) / 12) * (Math.PI / 2);
    const day = new THREE.Vector3(-0.42 * Math.cos(a) + Math.sin(a) * 0.6, 0.25 + 0.6 * d, 0.46).normalize();
    // The moon stands behind the camera (south) like the sun, so the sea does not mirror it back
    // as bright streaks.
    this.sunDir.copy(day).lerp(new THREE.Vector3(0.25, 0.75, 0.6).normalize(), 1 - d).normalize();
    this.sun.intensity = 0.4 + 2.2 * d;
    this.sun.color.setRGB(1, 0.95, 0.86).lerp(new THREE.Color(0x9fb6ff), 1 - d).lerp(DUSK, dusk * 0.55);
    this.hemi.intensity = 0.35 + 0.55 * d;
    this.scene.environmentIntensity = 0.2 + 0.35 * d;
    const horizon = NIGHT_HORIZON.clone().lerp(HORIZON, d).lerp(DUSK, dusk * 0.35);
    skyState.horizon.value.copy(horizon);
    skyState.zenith.value.copy(NIGHT_ZENITH).lerp(ZENITH, d);
    skyState.sunDir.value.copy(this.sunDir);
    skyState.glow.value = 0.25 + 0.75 * d;
    (this.scene.background as THREE.Color).copy(horizon);
    (this.scene.fog as THREE.Fog).color.copy(horizon);
  }
}
