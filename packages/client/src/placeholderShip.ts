import * as THREE from 'three/webgpu';

/**
 * Procedural stand-in hull until the AI art pipeline produces real models.
 * Bow points along +x; the waterline is y = 0; overall length is `length` world units.
 */
export function createPlaceholderShip(length: number, masts: number, teamColor: number): THREE.Group {
  const ship = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 });
  const deck = new THREE.MeshStandardMaterial({ color: 0xa0784c, roughness: 0.9 });
  const sail = new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.9, side: THREE.DoubleSide });
  const flag = new THREE.MeshStandardMaterial({ color: teamColor, side: THREE.DoubleSide });

  const beam = length * 0.3;
  const hullHeight = length * 0.16;
  // Hull: a box with a tapered bow, sitting slightly below the waterline.
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-length * 0.5, -beam / 2);
  hullShape.lineTo(length * 0.2, -beam / 2);
  hullShape.quadraticCurveTo(length * 0.45, -beam * 0.35, length * 0.5, 0);
  hullShape.quadraticCurveTo(length * 0.45, beam * 0.35, length * 0.2, beam / 2);
  hullShape.lineTo(-length * 0.5, beam / 2);
  hullShape.closePath();
  const hullGeometry = new THREE.ExtrudeGeometry(hullShape, { depth: hullHeight, bevelEnabled: false });
  hullGeometry.rotateX(-Math.PI / 2);
  hullGeometry.translate(0, -hullHeight * 0.35, 0);
  const hull = new THREE.Mesh(hullGeometry, wood);
  const deckMesh = new THREE.Mesh(new THREE.BoxGeometry(length * 0.7, 2, beam * 0.85), deck);
  deckMesh.position.set(-length * 0.08, hullHeight * 0.66, 0);
  ship.add(hull, deckMesh);

  const mastHeight = length * 0.75;
  for (let m = 0; m < masts; m++) {
    const x = masts === 1 ? 0 : length * (0.22 - (0.5 * m) / (masts - 1));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(length * 0.012, length * 0.018, mastHeight), wood);
    mast.position.set(x, hullHeight * 0.6 + mastHeight / 2, 0);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(beam * 1.5, mastHeight * 0.55), sail);
    cloth.rotation.y = Math.PI / 2;
    cloth.position.set(x + length * 0.02, hullHeight * 0.6 + mastHeight * 0.58, 0);
    ship.add(mast, cloth);
    if (m === 0) {
      const pennant = new THREE.Mesh(new THREE.PlaneGeometry(length * 0.18, length * 0.08), flag);
      pennant.position.set(x - length * 0.09, hullHeight * 0.6 + mastHeight * 0.96, 0);
      ship.add(pennant);
    }
  }
  return ship;
}
