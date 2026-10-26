import * as THREE from 'three/webgpu';

/** Box-and-cylinder stand-in until the AI art pipeline produces real hulls. Bow points along +x. */
export function createPlaceholderShip(teamColor: number): THREE.Group {
  const ship = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 });
  const sail = new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.9, side: THREE.DoubleSide });
  const flag = new THREE.MeshStandardMaterial({ color: teamColor, side: THREE.DoubleSide });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(160, 30, 50), wood);
  hull.position.y = 10;
  const bow = new THREE.Mesh(new THREE.ConeGeometry(25, 50, 4, 1), wood);
  bow.rotation.set(0, Math.PI / 4, -Math.PI / 2);
  bow.scale.set(1, 1, 0.6);
  bow.position.set(105, 10, 0);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 150), wood);
  mast.position.set(10, 95, 0);
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(10, 80), sail);
  sheet.scale.x = 0.1;
  sheet.rotation.y = Math.PI / 2;
  sheet.position.set(14, 100, 0);
  const sailCloth = new THREE.Mesh(new THREE.PlaneGeometry(90, 80), sail);
  sailCloth.rotation.y = Math.PI / 2;
  sailCloth.position.set(14, 100, 0);
  const pennant = new THREE.Mesh(new THREE.PlaneGeometry(36, 16), flag);
  pennant.position.set(-8, 165, 0);

  ship.add(hull, bow, mast, sailCloth, pennant);
  return ship;
}
