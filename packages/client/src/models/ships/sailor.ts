// H000 水手 — modeled after art/concepts/preview/H000_sailor_34.jpg: a humble wooden launch,
// orange planking over a blue lower band (team color here), iron caps on stem and stern,
// a small bow cannon, a deck hatch, a rope coil and a tiller.
import * as THREE from 'three/webgpu';
import { addBeam, addCannon, addRig, addStrip, geo, makeHull, ModelBuilder } from '../kit.ts';

const C = { plank: 0xb4682c, deck: 0xc4874e, iron: 0x55575c, rope: 0xb99a62, wood: 0x6b4426 };

export function buildSailor(teamColor: THREE.ColorRepresentation): THREE.Group {
  const L = 120;
  const hull = makeHull({
    length: L, beam: 44, freeboard: 13, draft: 11, sheer: 0.75, bowRise: 0.35, sternWidth: 0.6, bowFullness: 1.5,
    boxiness: 2.2, bulwark: 4, bowRake: 0.1, keelRiseBow: 0.5, keelRiseStern: 0.35,
  });
  const b = new ModelBuilder();
  const top = (x: number) => hull.deckAt(x) + hull.spec.bulwark;

  b.addPainted(hull.geometry, (c) => {
    const s = hull.depthFraction(c.x, c.y);
    if (s < 0.5) return C.plank;
    return 'team'; // the concept's blue lower hull carries the team color
  });
  b.add(hull.deck, C.deck, { position: [0, 0.2, 0] });
  for (const side of [-1, 1] as const) addBeam(b, hull.gunwaleLine(side, 16), 3, 2.6, C.iron); // rub rail

  // Iron cap down the curved stem, iron corners on the transom.
  addStrip(b, hull.stemLine(6).map((p) => p.setX(p.x + 1.5)), 7, 4, C.iron);
  const sternTop = top(-L / 2);
  for (const s of [-1, 1]) {
    b.add(geo.box(5, sternTop + 6, 5), C.iron, { position: [-L / 2 + 1, sternTop / 2 - 3, s * (hull.halfWidthAt(-L / 2, sternTop) - 1)] });
  }
  // Iron bands down the sides.
  for (const x of [-30, 0, 30]) {
    for (const s of [-1, 1]) b.add(geo.box(2.5, 14, 1.2), C.iron, { position: [x, 13, s * (hull.halfWidthAt(x, 13) + 0.4)] });
  }
  // Thwarts across the hull.
  for (const x of [-12, 18]) b.add(geo.box(5, 2, hull.halfWidthAt(x, 18) * 1.8), C.wood, { position: [x, hull.deckAt(x) + 3, 0] });

  // Raised bow platform with the cannon.
  b.add(geo.box(18, 4, hull.halfWidthAt(L * 0.33, 20) * 1.6), C.wood, { position: [L * 0.33, hull.deckAt(L * 0.33) + 2, 0] });
  addCannon(b, [L * 0.31, hull.deckAt(L * 0.33) + 4, 0], 26, 0);
  // Deck hatch with iron frame.
  b.add(geo.box(18, 2.5, 14), C.iron, { position: [-4, hull.deckAt(-4) + 1.5, 0] });
  b.add(geo.box(15, 3, 11), C.wood, { position: [-4, hull.deckAt(-4) + 2, 0] });
  // Rope coil.
  b.add(new THREE.TorusGeometry(5, 1.6, 4, 10), C.rope, { position: [-24, hull.deckAt(-24) + 1.8, 4], rotation: [Math.PI / 2, 0, 0] });
  // Tiller.
  b.add(geo.box(3, 6, 3), C.iron, { position: [-L / 2 + 8, top(-L / 2 + 8) + 2, 0] });
  b.add(geo.box(22, 2, 2), C.wood, { position: [-L / 2 + 2, top(-L / 2 + 8) + 5, 0], rotation: [0, 0, 0.3] });

  addRig(b, [{ x: 6, height: 78, width: 46, style: 'lateen', sailColor: 0xf1ead8 }], hull.deckAt);
  b.node('muzzle_1', [L * 0.31 + 26, hull.deckAt(L * 0.33) + 14, 0]);
  b.node('wake', [-L / 2, 0, 0]);
  b.node('fx_center', [0, 12, 0]);
  return b.build('H000_sailor', teamColor);
}
