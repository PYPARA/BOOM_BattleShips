// Turns match events and unit states into effects: each skill's Warcraft base ability picks a
// preset (explosion, fire, frost, lightning, summon, heal, curse…), weapons get muzzle flashes
// and hit sparks, sunk ships burn and smoke, and status effects show on the units carrying them.
import type { Match, MatchEvent, Team, UnitEntity } from '@boom/sim';
import type { Effects, Rgb } from './effects.ts';
import { SEA_LEVEL } from './space.ts';

/** Height above the sea surface. */
const H = (h: number) => SEA_LEVEL + h;

type Preset = (fx: Effects, e: { x: number; y: number }, caster: UnitEntity | undefined, area: number, duration: number) => void;

const ORANGE: Rgb = [1, 0.6, 0.15], BLUE: Rgb = [0.35, 0.65, 1], GREEN: Rgb = [0.35, 0.95, 0.4], PURPLE: Rgb = [0.65, 0.3, 1];

/** Random spots in a circle over time, for bombardments and rains. */
function barrage(fx: Effects, x: number, y: number, radius: number, seconds: number, every: number, hit: (x: number, y: number) => void): void {
  fx.emit(seconds, every, () => {
    const r = radius * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    hit(x + Math.cos(a) * r, y + Math.sin(a) * r);
  });
}

const PRESETS: Record<string, Preset> = {
  // Bombardments and blasts.
  AHtb: (fx, e) => fx.explosion(e.x, e.y, 40),
  Auco: (fx, e) => fx.explosion(e.x, e.y, 110),
  AHbz: (fx, e, c, area) => { if (c) fx.flash(c.x, c.y); fx.explosion(e.x, e.y, Math.max(60, area * 0.4)); },
  ANcs: (fx, e, _c, area) => barrage(fx, e.x, e.y, area || 300, 2.2, 0.22, (x, y) => fx.explosion(x, y, 38)),
  AOsh: (fx, e, c) => {
    if (!c) return fx.explosion(e.x, e.y, 60);
    const dx = e.x - c.x, dy = e.y - c.y, len = Math.hypot(dx, dy) || 1;
    for (let d = 100; d <= 1700; d += 140) fx.after(d / 2500, () => fx.explosion(c.x + (dx / len) * d, c.y + (dy / len) * d, 45));
  },
  AEfk: (fx, e, _c, area) => { fx.pulse(e.x, e.y, area || 900, ORANGE); barrage(fx, e.x, e.y, area || 900, 0.5, 0.04, (x, y) => fx.explosion(x, y, 22)); },
  Agyb: (fx, e) => { fx.explosion(e.x, e.y, 140); fx.pulse(e.x, e.y, 800, [1, 0.85, 0.5]); },
  // Fire.
  ANrf: (fx, e, _c, area) => barrage(fx, e.x, e.y, area || 300, 4, 0.12, (x, y) => { fx.fire(x, y, 60); if (Math.random() < 0.3) fx.explosion(x, y, 30); }),
  ACbf: (fx, e, c) => { fx.fire(e.x, e.y, 150); if (c) fx.muzzle(c.x, c.y, e.x - c.x, e.y - c.y); },
  AEsf: (fx, e, c, area, duration) => barrage(fx, c?.x ?? e.x, c?.y ?? e.y, area || 600, Math.max(2, duration), 0.25, (x, y) => fx.explosion(x, y, 50)),
  ANvc: (fx, e, _c, area) => barrage(fx, e.x, e.y, area || 650, 8, 0.2, (x, y) => { fx.fire(x, y, 90); if (Math.random() < 0.4) fx.explosion(x, y, 45); }),
  Amls: (fx, e) => fx.fire(e.x, e.y, 70),
  // Frost and lightning.
  AOws: (fx, e, _c, area) => fx.frost(e.x, e.y, area || 400),
  AHtc: (fx, e, _c, area) => { fx.pulse(e.x, e.y, area || 500, BLUE); barrage(fx, e.x, e.y, area || 500, 0.4, 0.05, (x, y) => fx.lightning(e.x, e.y, x, y)); },
  // Shields and buffs.
  AHds: (fx, e) => fx.flash(e.x, e.y, BLUE),
  Aams: (fx, e) => fx.flash(e.x, e.y, BLUE),
  AOvd: (fx, e, _c, area) => fx.pulse(e.x, e.y, area || 600, BLUE),
  Absk: (fx, e) => fx.pulse(e.x, e.y, 160, [1, 0.85, 0.4]),
  AIsa: (fx, e, _c, area) => fx.pulse(e.x, e.y, area || 1200, [0.6, 1, 0.8]),
  AEbl: (fx, e, c) => { fx.flash(e.x, e.y); if (c) fx.flash(c.x, c.y); },
  Afla: (fx, e, _c, area) => { fx.flash(e.x, e.y, [1, 0.95, 0.7]); fx.ring(e.x, e.y, 50, area || 1200, [1, 0.95, 0.7], 1.2, 0.5); },
  // Summons.
  AHwe: (fx, e) => fx.summon(e.x, e.y, 160),
  AOwd: (fx, e) => fx.summon(e.x, e.y, 160, GREEN),
  ANto: (fx, e) => fx.summon(e.x, e.y, 260, [0.8, 0.85, 0.9]),
  AOsf: (fx, e) => fx.summon(e.x, e.y, 260, [0.4, 0.7, 0.9]),
  AUls: (fx, e) => fx.summon(e.x, e.y, 220, ORANGE),
  AOmi: (fx, e) => fx.summon(e.x, e.y, 180, PURPLE),
  AIil: (fx, e) => fx.summon(e.x, e.y, 180, PURPLE),
  ANwm: (fx, e) => fx.summon(e.x, e.y, 120, BLUE),
  AIbl: (fx, e) => fx.summon(e.x, e.y, 200, ORANGE),
  Asta: (fx, e) => fx.summon(e.x, e.y, 100, BLUE),
  // Healing.
  Arej: (fx, e) => fx.heal(e.x, e.y, 120),
  AEtq: (fx, e, _c, area) => fx.heal(e.x, e.y, area || 900),
  ANhs: (fx, e, _c, area) => barrage(fx, e.x, e.y, area || 700, 6, 0.75, (x, y) => fx.heal(x, y, 250)),
  AIhe: (fx, e) => fx.heal(e.x, e.y, 120),
  // Curses and control.
  ANsi: (fx, e, _c, area) => fx.curse(e.x, e.y, area || 400),
  ANso: (fx, e) => fx.curse(e.x, e.y, 120),
  Afae: (fx, e) => fx.curse(e.x, e.y, 120, [0.35, 0.3, 0.45]),
  Aply: (fx, e) => fx.curse(e.x, e.y, 140, [1, 0.6, 0.9]),
  Acri: (fx, e) => fx.curse(e.x, e.y, 120, BLUE),
  ANab: (fx, e, _c, area) => fx.curse(e.x, e.y, area || 400, [0.5, 1, 0.3]),
  ANpa: (fx, e) => fx.curse(e.x, e.y, 120, [0.4, 0.9, 0.3]),
  AEer: (fx, e) => fx.curse(e.x, e.y, 120, [0.45, 0.7, 0.3]),
  Aens: (fx, e) => fx.curse(e.x, e.y, 120, [0.8, 0.7, 0.5]),
  Ashs: (fx, e) => fx.curse(e.x, e.y, 80, [0.6, 0.6, 0.7]),
  ANcl: (fx, e) => fx.pulse(e.x, e.y, 300, PURPLE),
  Aprg: (fx, e) => fx.curse(e.x, e.y, 140, PURPLE),
  ANch: (fx, e) => fx.curse(e.x, e.y, 140, [1, 0.5, 0.8]),
  // 下潜 / 浮出水面.
  Arav: (fx, e) => { fx.ring(e.x, e.y, 30, 160, [0.75, 0.9, 1], 0.8, 0.6); fx.splash(e.x, e.y, 45); },
  // Neutral creeps' skills.
  ACtb: (fx, e) => fx.explosion(e.x, e.y, 45),
  ANfd: (fx, e, c) => { if (c) fx.bolt(c.x, c.y, H(80), e.x, e.y, H(40), [0.85, 0.3, 1], 0.4, 18); fx.curse(e.x, e.y, 120, PURPLE); },
  AUcs: (fx, e, c) => {
    if (!c) return fx.explosion(e.x, e.y, 50);
    const dx = e.x - c.x, dy = e.y - c.y, len = Math.hypot(dx, dy) || 1;
    for (let d = 80; d <= 1000; d += 120) fx.after(d / 2000, () => fx.splash(c.x + (dx / len) * d, c.y + (dy / len) * d, 50));
  },
  Aslo: (fx, e) => fx.curse(e.x, e.y, 110, BLUE),
  AOhx: (fx, e) => fx.curse(e.x, e.y, 140, [1, 0.6, 0.9]),
  Acrs: (fx, e) => fx.curse(e.x, e.y, 120, [0.3, 0.25, 0.35]),
  AOhw: (fx, e) => fx.heal(e.x, e.y, 120),
  Aroa: (fx, e, _c, area) => fx.pulse(e.x, e.y, area || 500, ORANGE),
  Aadm: (fx, e, _c, area) => fx.pulse(e.x, e.y, area || 300, [0.95, 0.95, 1]),
  AHdr: (fx, e, c, _a, duration) => {
    if (!c) return;
    fx.emit(Math.max(1, duration), 0.25, () => fx.bolt(e.x, e.y, H(60), c.x, c.y, H(60), [1, 0.25, 0.3], 0.3, 8));
  },
};

export class CombatFx {
  private readonly fx: Effects;
  private readonly match: Match;
  private readonly team: Team;
  private statusAt = 0;

  constructor(fx: Effects, match: Match, team: Team) {
    this.fx = fx;
    this.match = match;
    this.team = team;
  }

  onEvents(events: MatchEvent[]): void {
    const { world } = this.match;
    for (const e of events) {
      if ('x' in e && 'y' in e && e.kind !== 'gold' && !this.sees(e.x as number, e.y as number)) continue;
      if (e.kind === 'zap' && !this.sees(e.toX, e.toY)) continue;
      if (e.kind === 'cast') {
        const caster = world.unit(e.casterId);
        if (e.abilityId.startsWith('@')) { this.fx.after(4, () => this.fx.explosion(e.x, e.y, 120)); continue; } // ground missile
        const a = world.abilities.byId.get(e.abilityId);
        const level = a?.levels[Math.max(0, (caster?.hero?.learned[e.abilityId] ?? caster?.hero?.granted[e.abilityId] ?? 1) - 1)] ?? a?.levels[0];
        const preset = a ? PRESETS[a.baseCode] : undefined;
        if (preset) preset(this.fx, e, caster, level?.area ?? 0, level?.duration ?? 0);
        else this.fx.pulse(e.x, e.y, 120, BLUE);
      } else if (e.kind === 'zap') {
        // A healing wave jumps in green; everything else is lightning.
        if (world.abilities.byId.get(e.abilityId)?.baseCode === 'AOhw') this.fx.bolt(e.fromX, e.fromY, H(50), e.toX, e.toY, H(40), GREEN, 0.35, 12);
        else this.fx.lightning(e.fromX, e.fromY, e.toX, e.toY);
      } else if (e.kind === 'shot') {
        const from = world.unit(e.sourceId), to = world.unit(e.targetId);
        if (from && to && this.visible(from)) this.fx.muzzle(from.x, from.y, to.x - from.x, to.y - from.y, from.kind === 'structure' ? H(230) : undefined);
      } else if (e.kind === 'hit') {
        if (e.attackType === 'ability' || e.attackType === 'pure') continue;
        const target = world.unit(e.targetId);
        const big = e.damage >= 150;
        this.fx.glow.spawn({ x: e.x, y: e.y, z: H(40), life: 0.2, size: big ? 70 : 40, endSize: 10, color: [1, 0.8, 0.45] });
        if (!target || target.kind === 'ship') this.fx.splash(e.x + (Math.random() - 0.5) * 40, e.y + (Math.random() - 0.5) * 40, big ? 34 : 20);
      } else if (e.kind === 'death') {
        if (e.structure) {
          this.fx.explosion(e.x, e.y, 150, H(120));
          this.fx.emit(5, 0.15, () => this.fx.smoke.spawn({ x: e.x + (Math.random() - 0.5) * 120, y: e.y + (Math.random() - 0.5) * 120, z: H(150),
            vz: H(80), life: 3, size: 80, endSize: 200, color: [0.2, 0.2, 0.2], endColor: [0.5, 0.5, 0.5], alpha: 0.6, drag: 0.3 }));
        } else {
          this.fx.sinking(e.x, e.y, e.hero ? 90 : 55);
        }
      }
    }
  }

  private visible(u: UnitEntity): boolean {
    return this.match.world.seenBy(this.team, u);
  }

  /** Whether the side sees a spot (effects in the fog are not shown). */
  private sees(x: number, y: number): boolean {
    return this.match.world.vision.sees(this.team, x, y);
  }

  /** Per-frame visuals for status effects: shields, stuns, burns, frost, healing. */
  update(): void {
    const { world } = this.match;
    const shielded = new Set<number>();
    const tick = this.fx.now >= this.statusAt;
    if (tick) this.statusAt = this.fx.now + 0.15;
    for (const u of world.allUnits()) {
      if (!this.visible(u) || u.locust) continue;
      const size = u.kind === 'structure' ? 120 : u.bodyRadius;
      if (u.invulnerable || u.buffs.some((b) => b.kind === 'invulnerable')) {
        shielded.add(u.id);
        this.fx.shield(u.id, true, u.x, u.y, size);
      }
      if (!tick || u.buffs.length === 0) continue;
      const kinds = new Set(u.buffs.map((b) => b.kind));
      const frozen = u.buffs.some((b) => b.kind === 'stun' && world.abilities.byId.get(b.abilityId)?.baseCode === 'AOws');
      const at = () => ({ x: u.x + (Math.random() - 0.5) * size, y: u.y + (Math.random() - 0.5) * size });
      if (frozen) {
        const p = at();
        this.fx.glow.spawn({ ...p, z: H(30), vz: H(20), life: 0.6, size: 22, endSize: 6, color: [0.8, 0.95, 1] });
      } else if (kinds.has('stun')) {
        const a = this.fx.now * 6;
        this.fx.glow.spawn({ x: u.x + Math.cos(a) * size * 0.5, y: u.y + Math.sin(a) * size * 0.5, z: H(size * 1.2), life: 0.3, size: 16, endSize: 6, color: [1, 0.9, 0.3] });
      }
      if (kinds.has('dot')) { const p = at(); this.fx.glow.spawn({ ...p, z: H(25), vz: H(60), life: 0.5, size: 22, endSize: 5, color: [1, 0.6, 0.2], endColor: [0.8, 0.15, 0.02] }); }
      if (kinds.has('slow') && !frozen) { const p = at(); this.fx.glow.spawn({ ...p, z: H(40), vz: -20, life: 0.6, size: 10, endSize: 4, color: BLUE }); }
      if (kinds.has('hot')) { const p = at(); this.fx.glow.spawn({ ...p, z: H(20), vz: H(70), life: 0.7, size: 12, endSize: 4, color: GREEN }); }
      if (kinds.has('silence') || kinds.has('disarm')) { const p = at(); this.fx.glow.spawn({ ...p, z: H(size), vz: H(20), life: 0.5, size: 14, endSize: 4, color: PURPLE }); }
      if (kinds.has('root')) { const p = at(); this.fx.smoke.spawn({ ...p, z: H(10), vz: H(15), life: 0.6, size: 20, endSize: 30, color: [0.45, 0.6, 0.3], alpha: 0.6 }); }
      if (kinds.has('miss')) { const p = at(); this.fx.smoke.spawn({ ...p, z: H(size), vz: H(10), life: 0.6, size: 18, endSize: 26, color: [0.25, 0.2, 0.3], alpha: 0.5 }); }
      if (kinds.has('haste')) { const p = at(); this.fx.glow.spawn({ ...p, z: H(15), life: 0.35, size: 14, endSize: 4, color: [1, 0.9, 0.5] }); }
    }
    this.fx.pruneShields(shielded);
  }
}
