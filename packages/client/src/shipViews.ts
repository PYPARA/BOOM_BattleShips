// Keeps one 3D object per simulated ship, interpolating between ticks and adding
// cosmetic motion (bobbing, leaning into turns) that the simulation does not model.
import * as THREE from 'three/webgpu';
import { hasBuff, wrapAngle, type ShipEntity, type Team, type World } from '@boom/sim';
import { glbModel } from './models/glb.ts';
import { shipModels } from './models/index.ts';
import { withEngineRig } from './models/rigs.ts';
import { createPlaceholderShip } from './placeholderShip.ts';
import { TEAM_COLORS, teamOf, toThree } from './space.ts';

interface ShipView {
  root: THREE.Group;
  model: THREE.Object3D;
  ring: THREE.Mesh;
  roll: number;
  /** Seconds (render clock) when the ship was sunk; the view sinks, then goes. */
  sunkAt?: number;
}

const SINK_SECONDS = 2.5;

const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x5cff7a, transparent: true, opacity: 0.85, depthWrite: false });

export class ShipViews {
  readonly group = new THREE.Group();
  private readonly views = new Map<number, ShipView>();
  private readonly world: World;
  /** The local player's side: enemy ships it cannot see (invisible) are not drawn. */
  private readonly team: Team;

  constructor(world: World, team: Team) {
    this.world = world;
    this.team = team;
    this.group.name = 'ships';
  }

  private create(ship: ShipEntity): ShipView {
    // Aha GLB first, then the hand-built procedural model, then the generic placeholder.
    const length = ship.bodyRadius * 3;
    const masts = ship.bodyRadius >= 80 ? 3 : ship.bodyRadius >= 55 ? 2 : 1;
    const color = TEAM_COLORS[teamOf(ship.owner)];
    const glb = glbModel('ships', ship.typeId, color, { length });
    const model = (glb && withEngineRig(glb, ship.typeId, length, color)) // Aha models leave sails to the engine
      ?? shipModels[ship.typeId]?.(color) ?? createPlaceholderShip(length, masts, color);
    const ring = new THREE.Mesh(new THREE.RingGeometry(ship.bodyRadius * 1.05, ship.bodyRadius * 1.2, 40), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 2;
    ring.visible = false;
    const root = new THREE.Group();
    root.add(model, ring);
    root.userData.entityId = ship.id;
    this.group.add(root);
    const view = { root, model, ring, roll: 0 };
    this.views.set(ship.id, view);
    return view;
  }

  /** `alpha` is how far we are between the previous and the current tick (0..1). */
  update(alpha: number, time: number, selected: ReadonlySet<number>, frameDt: number): void {
    for (const ship of this.world.ships.values()) {
      const view = this.views.get(ship.id) ?? this.create(ship);
      const x = ship.prevX + (ship.x - ship.prevX) * alpha;
      const y = ship.prevY + (ship.y - ship.prevY) * alpha;
      const turn = wrapAngle(ship.facing - ship.prevFacing);
      const facing = ship.prevFacing + turn * alpha;
      toThree(x, y, undefined, view.root.position);
      view.root.rotation.y = facing;
      // Lean outward in turns, proportionally to turn speed × forward speed.
      const targetRoll = THREE.MathUtils.clamp(-turn * 20 * (ship.speed / Math.max(1, ship.maxSpeed)), -0.25, 0.25);
      view.roll += (targetRoll - view.roll) * Math.min(1, frameDt * 3);
      const phase = ship.id * 1.7;
      view.model.position.y = Math.sin(time * 1.3 + phase) * ship.bodyRadius * 0.04;
      view.model.rotation.x = view.roll + Math.sin(time * 1.1 + phase) * 0.03;
      view.model.rotation.z = Math.sin(time * 0.9 + phase) * 0.025;
      view.ring.visible = selected.has(ship.id);
      view.root.visible = ship.team === this.team || !hasBuff(ship, 'invisible') || this.world.abilities.revealed(ship, this.team);
    }
    // Sunk ships list over and slide under before their view is dropped.
    for (const [id, view] of this.views) {
      if (this.world.ships.has(id)) continue;
      view.sunkAt ??= time;
      view.ring.visible = false;
      const t = (time - view.sunkAt) / SINK_SECONDS;
      if (t >= 1) {
        this.group.remove(view.root);
        this.views.delete(id);
        continue;
      }
      view.model.rotation.x = view.roll + t * 0.9;
      view.model.rotation.z = -t * 0.35;
      view.model.position.y = -t * t * 120;
    }
  }
}
