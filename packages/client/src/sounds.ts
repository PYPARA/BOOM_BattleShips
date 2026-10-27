// Match events → sounds: skills by their Warcraft base ability, cannon fire, hits, sinking ships,
// gold, purchases, level-ups and announcements; plus the music's battle intensity.
import type { Match, MatchEvent } from '@boom/sim';
import type { AudioEngine, SoundName } from './audio.ts';
import type { Music } from './music.ts';

/** Skill sound per base ability; barrages repeat their sound over the area. */
const SKILL_SOUNDS: Record<string, SoundName> = {
  AHtb: 'bigCannon', Auco: 'bigExplosion', AHbz: 'explosion', ANcs: 'explosion', AOsh: 'bigCannon', AEfk: 'cannon', Agyb: 'bigExplosion',
  ANrf: 'fire', ACbf: 'fire', AEsf: 'explosion', ANvc: 'fire', Amls: 'fire', AEim: 'fire',
  AOws: 'frost', Acri: 'frost', AHtc: 'lightning', AOcl: 'lightning', ANfl: 'lightning',
  AHds: 'shield', Aams: 'shield', AOvd: 'shield', Absk: 'buff', AIsa: 'buff', AEbl: 'blink', Afla: 'blink',
  AHwe: 'magic', AOwd: 'magic', ANto: 'magic', AOsf: 'magic', AUls: 'magic', AOmi: 'magic', AIil: 'magic', ANwm: 'magic', AIbl: 'magic', Asta: 'magic',
  Arej: 'heal', AEtq: 'heal', ANhs: 'heal', AIhe: 'heal', Arpl: 'heal',
  ANsi: 'curse', ANso: 'curse', Afae: 'curse', Aply: 'curse', ANab: 'curse', ANpa: 'curse', AEer: 'curse', Aens: 'curse', Ashs: 'curse',
  ANcl: 'curse', Aprg: 'curse', ANch: 'curse', AHdr: 'curse',
};
/** Barrages: how many extra impacts, over how many seconds. */
const BARRAGES: Record<string, [count: number, seconds: number]> = { ANcs: [6, 2.2], ANrf: [5, 4], AEsf: [6, 4], ANvc: [7, 7], AOsh: [5, 0.7] };

export class SoundFx {
  private readonly audio: AudioEngine;
  private readonly match: Match;
  private readonly player: number;
  private readonly music: Music;
  private heat = 0;
  private last = { gold: 0, goods: '', learned: 0 };

  constructor(audio: AudioEngine, music: Music, match: Match, player: number) {
    this.audio = audio;
    this.music = music;
    this.match = match;
    this.player = player;
    // Every interface button clicks.
    document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) audio.play('click'); }, true);
  }

  onEvents(events: MatchEvent[]): void {
    const { world } = this.match;
    const me = this.match.players.get(this.player)!;
    for (const e of events) {
      switch (e.kind) {
        case 'cast': {
          if (e.abilityId.startsWith('@')) { setTimeout(() => this.audio.play('bigExplosion', e), 4000); break; }
          const code = world.abilities.byId.get(e.abilityId)?.baseCode ?? '';
          const name = SKILL_SOUNDS[code] ?? 'magic';
          this.audio.play(name, e, { gain: 1.1 });
          const barrage = BARRAGES[code];
          if (barrage) {
            const area = world.abilities.byId.get(e.abilityId)?.levels[0]?.area || 300;
            for (let i = 1; i <= barrage[0]; i++) {
              setTimeout(() => this.audio.play(name, { x: e.x + (Math.random() - 0.5) * area, y: e.y + (Math.random() - 0.5) * area }, { pitch: 0.9 + Math.random() * 0.25 }),
                (i / barrage[0]) * barrage[1] * 1000);
            }
          }
          break;
        }
        case 'zap': this.audio.play('lightning', { x: e.toX, y: e.toY }, { gain: 0.6 }); break;
        case 'shot': {
          const from = world.unit(e.sourceId);
          if (!from) break;
          const big = from.kind === 'structure' || from.bodyRadius >= 80;
          this.audio.play(big ? 'bigCannon' : 'cannon', from, { gain: from.owner === this.player ? 0.9 : 0.55, pitch: 0.85 + Math.random() * 0.3 });
          break;
        }
        case 'hit':
          if (e.attackType === 'ability' || e.attackType === 'pure') break;
          this.audio.play('hit', e, { gain: 0.5, pitch: 0.8 + Math.random() * 0.4 });
          if (Math.random() < 0.4) this.audio.play('splash', e, { gain: 0.5 });
          this.heat = Math.min(1, this.heat + 0.04);
          break;
        case 'death':
          if (e.structure) this.audio.play('bigExplosion', e, { gain: 1.3 });
          else this.audio.play(e.hero ? 'sink' : 'explosion', e, { gain: e.hero ? 1.2 : 0.8 });
          if (e.hero && e.owner === this.player) this.audio.play('killed');
          break;
        case 'gold': if (e.player === this.player && e.reason !== 'salary') this.audio.play('coin', undefined, { gain: 0.6 }); break;
        case 'denied': if (e.player === this.player) this.audio.play('deny'); break;
        case 'levelUp': if (e.player === this.player) this.audio.play('levelUp'); break;
        case 'respawn': if (e.player === this.player) this.audio.play('respawn'); break;
        case 'victory': this.audio.play(e.winner === me.team ? 'victory' : 'defeat'); break;
      }
    }
  }

  /** A kill call from the HUD (first blood, streaks). */
  announce(): void {
    this.audio.play('announce', undefined, { gain: 1.1 });
  }

  /** Per frame: the listener follows the camera; purchases and learned skills chime. */
  update(listenerX: number, listenerY: number, distance: number): void {
    this.audio.setListener(listenerX, listenerY, distance);
    const p = this.match.players.get(this.player)!;
    const goods = `${p.shipTypeId}|${p.items.join()}|${Object.keys(p.hero.granted).join()}|${Object.keys(p.hero.hullBonus).join()}|${p.hero.techs.join()}`;
    const learned = Object.values(p.hero.learned).reduce((s, v) => s + v, 0);
    if (this.last.goods && goods !== this.last.goods && p.gold < this.last.gold) this.audio.play('buy');
    if (learned > this.last.learned) this.audio.play('learn');
    this.last = { gold: p.gold, goods, learned };
    this.heat *= 0.995;
    this.music.setIntensity(this.heat > 0.15 ? 1 : this.heat * 4);
  }
}
