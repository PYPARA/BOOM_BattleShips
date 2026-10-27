// Sky, sunlight and shadows. A gradient sky dome with a sun glow sets the horizon and fog color
// and, rendered once into an environment map, gives water and hulls something to reflect. The
// sun casts shadows in a box that follows the camera, sized to what is on screen.
import * as THREE from 'three/webgpu';
import { cameraPosition, dot, float, max, mix, normalize, positionWorld, pow, smoothstep, vec3 } from 'three/tsl';

const ZENITH = new THREE.Color(0x3d7cc4);
const HORIZON = new THREE.Color(0xbfdcea);
/** Direction toward the sun: high in the south-west, like the map's default lighting. */
const SUN_DIR = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();

function skyMaterial(): THREE.MeshBasicNodeMaterial {
  const dir = normalize(positionWorld.sub(cameraPosition));
  const up = max(dir.y, 0);
  const sky = mix(vec3(HORIZON.r, HORIZON.g, HORIZON.b), vec3(ZENITH.r, ZENITH.g, ZENITH.b), pow(up, float(0.55)));
  const sun = dot(dir, vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z));
  const glow = pow(max(sun, 0), float(64)).mul(0.6).add(smoothstep(float(0.9995), float(0.9999), sun));
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  m.colorNode = sky.add(vec3(1, 0.93, 0.78).mul(glow));
  return m;
}

export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  private shadowSize = 0;

  constructor(scene: THREE.Scene) {
    scene.background = HORIZON.clone();
    scene.fog = new THREE.Fog(HORIZON.clone(), 5000, 14000);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), skyMaterial());
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    scene.add(new THREE.HemisphereLight(0xdcecff, 0x3a5a48, 0.9));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 2;
    this.sun.shadow.camera.near = 100;
    this.sun.shadow.camera.far = 12000;
    scene.add(this.sun, this.sun.target);
  }

  /** Bakes the sky into the scene's environment map (reflections on water and metal). */
  bakeEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene): void {
    const skyScene = new THREE.Scene();
    skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial()));
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(skyScene);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.55;
  }

  /** Keeps the sun's shadow box over what the camera looks at. */
  update(camera: THREE.Camera, target: THREE.Vector3, distance: number): void {
    this.sky.position.copy(camera.position);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(SUN_DIR, 6000);
    const size = Math.ceil((distance * 1.1) / 200) * 200;
    if (size !== this.shadowSize) {
      this.shadowSize = size;
      const c = this.sun.shadow.camera;
      c.left = -size; c.right = size; c.top = size; c.bottom = -size;
      c.updateProjectionMatrix();
    }
  }
}
