// H016 龟船 — modeled after art/concepts/preview/H016_turtle_34.jpg: dark wooden hull with
// iron hoops, a long spiked iron shell roof (team-colored trim at its base), a row of gun
// ports on each side, a dragon head at the bow and a small raised stern castle.
import * as THREE from 'three/webgpu';
import { addBeam, addGunPorts, addRig, geo, makeHull, ModelBuilder, rotationToward } from '../kit.ts';

const C = { hull: 0x5c3a22, band: 0x3d3d40, shell: 0x4c5966, rib: 0x2f3338, spike: 0x2a2c30, dragon: 0x46484c, frame: 0x7a5530, under: 0x2c3a3f };

export function buildTurtle(teamColor: THREE.ColorRepresentation): THREE.Group {
  const L = 165;
  // Tall hull: the upper strake (bulwark) is the gun-port wall the shell sits on.
  const hull = makeHull({
    length: L, beam: 52, freeboard: 18, draft: 18, sheer: 0.1, bowRise: 0.05, sternWidth: 0.85, bowFullness: 2.6,
    boxiness: 3.4, bulwark: 14, keelRiseBow: 0.6, keelRiseStern: 0.3,
  });
  const b = new ModelBuilder();
  const wallTop = (x: number) => hull.deckAt(x) + hull.spec.bulwark;

  b.addPainted(hull.geometry, (c) => (hull.depthFraction(c.x, c.y) < 0.36 ? C.frame : C.hull));
  // Iron hoops around the hull and a band under the gun ports.
  for (const x of [-56, -28, 0, 28, 54]) {
    for (const s of [-1, 1]) b.add(geo.box(3, 30, 1.4), C.band, { position: [x, 10, s * (hull.halfWidthAt(x, 10) + 0.5)] });
  }
  for (const side of [-1, 1] as const) {
    addBeam(b, hull.gunwaleLine(side, 16).map((p) => p.setY(p.y - hull.spec.bulwark)), 2, 2.4, C.band);
  }
  addGunPorts(b, hull, [-56, -42, -28, -14, 0, 14, 28, 42], 26, 4.6, C.band);

  // Shell roof: a long vault lofted along the ship, rounding off at both ends.
  const roofLen = L * 0.86, roofW = 60, roofH = 24, roofX = -4, roofY = wallTop(0);
  const STATIONS = 24, ARC = 12;
  const envelope = (u: number) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 5)), 1 / 5);
  const vaultPoint = (i: number, k: number) => {
    const u = -1 + (2 * i) / STATIONS, e = envelope(u), a = (k / ARC) * Math.PI;
    return new THREE.Vector3(roofX + (u * roofLen) / 2, roofY + Math.sin(a) * roofH * e, Math.cos(a) * (roofW / 2) * e);
  };
  const vault: number[] = [];
  const ribs: boolean[] = [];
  for (let i = 0; i < STATIONS; i++) {
    for (let k = 0; k < ARC; k++) {
      const p00 = vaultPoint(i, k), p10 = vaultPoint(i + 1, k), p01 = vaultPoint(i, k + 1), p11 = vaultPoint(i + 1, k + 1);
      vault.push(...p00.toArray(), ...p01.toArray(), ...p10.toArray(), ...p10.toArray(), ...p01.toArray(), ...p11.toArray());
      const rib = i % 3 === 0 || k % 4 === 0;
      ribs.push(rib, rib);
    }
  }
  const vaultGeometry = new THREE.BufferGeometry();
  vaultGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vault, 3));
  let face = 0;
  b.addPainted(vaultGeometry, () => (ribs[face++] ? C.rib : C.shell));
  // Team-colored trim where the roof meets the hull.
  for (const side of [-1, 1]) {
    addBeam(b, Array.from({ length: STATIONS + 1 }, (_, i) => vaultPoint(i, side < 0 ? ARC : 0).setY(roofY + 1)), 2.5, 2.5, 'team');
  }
  // Spikes on the vault, pointing out along its surface.
  for (let i = 2; i < STATIONS - 1; i += 2) {
    for (let k = 1; k < ARC; k += 2) {
      const p = vaultPoint(i, k);
      const normal = p.clone().sub(new THREE.Vector3(p.x, roofY, 0)).normalize();
      b.add(geo.cone(1.7, 6.5, 5), C.spike, { position: [p.x, p.y + 1, p.z], rotation: rotationToward(normal) });
    }
  }

  // Dragon head on a squat neck at the bow, mouth open, facing forward.
  const bowX = L / 2 - 10, bowY = wallTop(bowX);
  b.add(geo.cyl(9, 11, 18, 6), C.dragon, { position: [bowX, bowY + 8, 0] });
  b.add(geo.box(22, 13, 18), C.dragon, { position: [bowX + 6, bowY + 22, 0] });        // skull
  b.add(geo.box(16, 7, 13), C.dragon, { position: [bowX + 20, bowY + 24, 0] });         // upper snout
  b.add(geo.box(15, 4, 12), C.dragon, { position: [bowX + 19, bowY + 14, 0], rotation: [0, 0, 0.3] }); // lower jaw
  b.add(geo.box(10, 6, 10), 0x7a2a22, { position: [bowX + 17, bowY + 19, 0] });          // mouth
  for (const s of [-1, 1]) {
    b.add(geo.cone(2.4, 16, 4), C.dragon, { position: [bowX - 2, bowY + 33, s * 6], rotation: [s * 0.5, 0, 1.0] }); // horns
    b.add(geo.box(3, 3, 1), 0xd8b040, { position: [bowX + 13, bowY + 26, s * 9.2] });   // eyes
    for (let k = 0; k < 3; k++) b.add(geo.cone(1.3, 4, 4), 0xe6e0d0, { position: [bowX + 26 - k * 3.5, bowY + 19.5, s * 5], rotation: [Math.PI, 0, 0] });
  }

  // Low stern rail behind the shell.
  const sx = -L / 2 + 5;
  b.add(geo.box(8, 12, 44), C.hull, { position: [sx, wallTop(sx) + 5, 0] });
  b.add(geo.box(9, 2, 45), C.band, { position: [sx, wallTop(sx) + 11, 0] });

  addRig(b, [
    { x: 22, base: roofY + roofH * 0.8, height: 80, width: 50, style: 'junk', sailColor: 0xc9a35a },
    { x: -38, base: roofY + roofH * 0.7, height: 66, width: 42, style: 'junk', sailColor: 0xc9a35a },
  ], hull.deckAt);
  for (let i = 0; i < 6; i++) b.node(`muzzle_${i + 1}`, [-42 + i * 14, 26, (i % 2 ? 1 : -1) * 28]);
  b.node('wake', [-L / 2, 0, 0]);
  b.node('fx_center', [0, 34, 0]);
  return b.build('H016_turtle', teamColor);
}
