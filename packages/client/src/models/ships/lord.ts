// H008 领主 — modeled after art/concepts/preview/H008_lord_34.jpg: a massive riveted iron
// hull, wooden deck with railings, an armored ram with a frost crystal at the bow, a
// stepped stone keep studded with crystals (team-colored crests), two twin-gun turrets and
// broadside gun ports.
import * as THREE from 'three/webgpu';
import { addGunPorts, addRailing, addRig, geo, makeHull, ModelBuilder } from '../kit.ts';

const C = {
  iron: 0x50545a, ironDark: 0x3a3d42, rust: 0x5e4535, deck: 0xb7783c, stone: 0x6d7076, stoneDark: 0x55585d,
  window: 0x1f2328, door: 0x6b4426, frame: 0x7a5430, crystal: 0x5ad1ff,
};

export function buildLord(teamColor: THREE.ColorRepresentation): THREE.Group {
  const L = 255;
  const hull = makeHull({
    length: L, beam: 80, freeboard: 28, draft: 28, sheer: 0.12, bowRise: 0.3, sternWidth: 0.75, bowFullness: 1.6,
    boxiness: 3.0, bulwark: 4, bowRake: 0.06, keelRiseBow: 0.55, keelRiseStern: 0.25,
  });
  const b = new ModelBuilder();
  const deck = hull.deckAt;

  b.addPainted(hull.geometry, (c) => {
    if (c.y < 4) return C.rust;
    if (c.y > deck(c.x) + hull.spec.bulwark - 1.5) return 'team'; // gunwale stripe
    return Math.abs(Math.sin(c.x * 0.09)) < 0.12 ? C.ironDark : C.iron; // plate seams
  });
  b.add(hull.deck, C.deck, { position: [0, 0.3, 0] });
  addGunPorts(b, hull, [-70, -42, -14, 14, 42], 15, 7, C.frame);

  // Bow shield: a faceted armor plate facing forward with a big frost crystal, over a ram.
  // Pentagonal plate leaning back over the stem, like a knight's shield on the prow.
  const shieldX = L / 2 - 2, shieldY = deck(shieldX) - 4;
  const plate = (r: number, depth: number) => new THREE.CylinderGeometry(r, r, depth, 5).rotateY(Math.PI / 10).rotateZ(Math.PI / 2);
  b.add(plate(34, 10), C.ironDark, { position: [shieldX, shieldY, 0], rotation: [0, 0, 0.35], scale: [1, 1.15, 0.85] });
  b.add(plate(25, 11), C.iron, { position: [shieldX + 2.5, shieldY, 0], rotation: [0, 0, 0.35], scale: [1, 1.15, 0.85] });
  for (const s of [-1, 1]) b.add(geo.cone(3.5, 14, 4), C.ironDark, { position: [shieldX - 6, shieldY + 34, s * 22], rotation: [s * 0.6, 0, -0.2] });
  b.add(geo.crystal(10, 28), { glow: C.crystal }, { position: [shieldX + 9, shieldY + 2, 0], rotation: [0, 0, 0.35] });
  b.add(geo.cone(9, 26, 4), C.iron, { position: [L / 2 + 8, 4, 0], rotation: [0, 0, -Math.PI / 2] });

  // Stepped keep.
  const kx = -8, ky = deck(kx);
  const tiers: [number, number, number, number][] = [[64, 26, 48, 0], [44, 22, 34, 26], [28, 18, 22, 48]]; // w, h, d, y
  tiers.forEach(([w, h, d, y], i) => {
    b.add(geo.box(w, h, d), i % 2 ? C.stoneDark : C.stone, { position: [kx, ky + y + h / 2, 0] });
    // Crenellations around the top edge.
    const step = 8;
    for (let x = -w / 2 + 4; x <= w / 2 - 4; x += step) {
      for (const s of [-1, 1]) b.add(geo.box(5, 5, 5), C.stone, { position: [kx + x, ky + y + h + 2.5, s * (d / 2 - 2.5)] });
    }
    for (let z = -d / 2 + 4 + step; z <= d / 2 - 4 - step; z += step) {
      for (const s of [-1, 1]) b.add(geo.box(5, 5, 5), C.stone, { position: [kx + s * (w / 2 - 2.5), ky + y + h + 2.5, z] });
    }
    // Windows on the long sides.
    for (let x = -w / 2 + 8; x <= w / 2 - 8; x += 11) {
      for (const s of [-1, 1]) b.add(geo.box(5, 7, 1.5), C.window, { position: [kx + x, ky + y + h * 0.55, s * (d / 2 + 0.5)] });
    }
    // Crystals on the corners.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.add(geo.crystal(2.6, 9), { glow: C.crystal }, { position: [kx + sx * (w / 2 - 2), ky + y + h + 9, sz * (d / 2 - 2)] });
    }
  });
  b.add(geo.crystal(4, 14), { glow: C.crystal }, { position: [kx, ky + 66 + 14, 0] });
  // Crest shields (team color) with a crystal on the keep's front and back, plus doors.
  for (const s of [-1, 1]) {
    b.add(geo.box(3, 16, 12), 'team', { position: [kx + s * 33, ky + 14, 0] });
    b.add(geo.crystal(3, 9), { glow: C.crystal }, { position: [kx + s * 35, ky + 15, 0] });
    b.add(geo.box(1.5, 13, 8), C.door, { position: [kx + 10, ky + 6.5, s * 24.5] });
  }

  // Twin-gun turrets fore and aft.
  for (const [tx, yaw] of [[L * 0.25, 0], [-L * 0.3, Math.PI]] as const) {
    const ty = deck(tx);
    b.add(geo.cyl(19, 21, 4, 10), C.ironDark, { position: [tx, ty + 2, 0] });
    b.add(geo.cyl(15, 17, 15, 8), C.iron, { position: [tx, ty + 11, 0], rotation: [0, Math.PI / 8, 0] });
    for (const s of [-1, 1]) {
      const dir = Math.cos(yaw);
      b.add(geo.cyl(2.2, 2.8, 32, 8), C.ironDark, { position: [tx + dir * 28, ty + 13, s * 5], rotation: [0, 0, -Math.PI / 2] });
    }
  }

  // Railings along the deck edges.
  const rail = (s: number) => Array.from({ length: 13 }, (_, i): [number, number] => {
    const x = -L / 2 + 10 + i * ((L - 40) / 12);
    return [x, s * (hull.halfWidthAt(x, deck(x)) - 2)];
  });
  addRailing(b, rail(-1), deck, 7, C.ironDark);
  addRailing(b, rail(1), deck, 7, C.ironDark);

  // One tall mast rising from the keep (docs/art/image-prompts.md: dark grey square sail).
  addRig(b, [{ x: kx - 4, base: ky + 66, height: 110, width: 70, style: 'square', sailColor: 0x5a5d63 }], deck);
  [-70, -42, -14, 14, 42, 70].forEach((x, i) => b.node(`muzzle_${i + 1}`, [x, 15, (i % 2 ? 1 : -1) * 40]));
  b.node('wake', [-L / 2, 0, 0]);
  b.node('fx_center', [kx, 40, 0]);
  return b.build('H008_lord', teamColor);
}
