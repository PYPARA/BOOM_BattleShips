// Skill bar and inventory for the player's ship: learn (+), cast with hotkeys or clicks,
// unit/point targeting, cooldowns, and usable items (1–6).
import type { Ability, Item } from '@boom/gamedata';
import { canLearn, skillPoints, TICK_RATE, xpForLevel, type Match } from '@boom/sim';
import type { RtsCamera } from './camera.ts';

const clean = (s: string) => s.replace(/\|c[0-9a-fA-F]{8}|\|r/g, '').replace(/^[.!~_@]+/, '').trim();

interface Targeting { abilityId: string; itemSlot?: number; kind: 'unit' | 'ally' | 'point'; label: string }

export class SkillBar {
  private readonly bar: HTMLElement;
  private readonly hint: HTMLElement;
  private targeting: Targeting | undefined;
  private key = '';
  private readonly match: Match;
  private readonly player: number;
  private readonly items: Map<string, Item>;
  private readonly rts: RtsCamera;

  constructor(match: Match, player: number, items: Map<string, Item>, rts: RtsCamera, canvas: HTMLElement) {
    this.match = match;
    this.player = player;
    this.items = items;
    this.rts = rts;
    this.bar = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'skillbar' });
    this.hint = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'target-hint' });

    this.bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.learn) this.match.issue({ kind: 'learn', player, abilityId: b.dataset.learn });
      if (b.dataset.cast) this.begin(b.dataset.cast);
      if (b.dataset.item) this.beginItem(Number(b.dataset.item));
    });
    // Targeting clicks are taken before selection sees them.
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.targeting) return;
      e.stopImmediatePropagation();
      if (e.button === 0) this.resolve(e.clientX, e.clientY);
      this.cancel();
    }, { capture: true });
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      if (e.key === 'Escape') { this.cancel(); return; }
      if (/^[1-6]$/.test(e.key)) { this.beginItem(Number(e.key) - 1); return; }
      const ability = this.skills().find((a) => a.hotkey?.toLowerCase() === e.key.toLowerCase());
      if (ability) this.begin(ability.id);
    });
  }

  private ship() {
    return this.match.world.ships.get(this.match.players.get(this.player)?.shipId ?? -1);
  }

  private skills(): Ability[] {
    const ship = this.ship();
    return ship ? this.match.world.abilities.skillsOf(ship.typeId) : [];
  }

  private begin(abilityId: string, itemSlot?: number): void {
    const abilities = this.match.world.abilities;
    const kind = abilities.targeting(abilityId);
    if (kind === 'passive') return;
    if (kind === 'instant') {
      if (itemSlot === undefined) this.match.issue({ kind: 'cast', player: this.player, abilityId });
      else this.match.issue({ kind: 'useItem', player: this.player, slot: itemSlot });
      return;
    }
    const label = clean(abilities.byId.get(abilityId)?.name ?? '');
    this.targeting = { abilityId, itemSlot, kind, label };
    this.hint.textContent = `${label}：${kind === 'point' ? '点击海面选择位置' : kind === 'ally' ? '点击一艘友方船只' : '点击一艘敌方船只'}（右键或 Esc 取消）`;
    this.hint.classList.add('show');
    document.body.classList.add('targeting');
  }

  private beginItem(slot: number): void {
    const itemId = this.match.players.get(this.player)?.items[slot];
    const abilityId = this.match.activeItemAbility(itemId);
    if (abilityId) this.begin(abilityId, slot);
  }

  private cancel(): void {
    this.targeting = undefined;
    this.hint.classList.remove('show');
    document.body.classList.remove('targeting');
  }

  private resolve(clientX: number, clientY: number): void {
    const t = this.targeting!;
    const point = this.rts.screenToSea(clientX, clientY);
    if (!point) return;
    let unitId: number | undefined;
    if (t.kind !== 'point') {
      let best = Infinity;
      for (const u of this.match.world.allUnits()) {
        const d = Math.hypot(u.x - point.x, u.y - point.y);
        if (d < Math.max(60, u.bodyRadius * 1.4) && d < best) { best = d; unitId = u.id; }
      }
      if (unitId === undefined) return;
    }
    const target = t.kind === 'point' ? { point } : { unitId };
    if (t.itemSlot === undefined) this.match.issue({ kind: 'cast', player: this.player, abilityId: t.abilityId, ...target });
    else this.match.issue({ kind: 'useItem', player: this.player, slot: t.itemSlot, ...target });
  }

  update(): void {
    const ship = this.ship();
    const p = this.match.players.get(this.player)!;
    const hero = p.hero;
    const tick = this.match.world.tick;
    const abilities = this.match.world.abilities;
    const parts: string[] = [];
    if (ship) {
      for (const a of this.skills()) {
        const level = hero.learned[a.id] ?? 0;
        const passive = abilities.targeting(a.id) === 'passive';
        const wait = Math.max(0, Math.ceil(((hero.readyAt[a.id] ?? 0) - tick) / TICK_RATE));
        const learnable = canLearn(hero, a);
        const dots = Array.from({ length: a.levels.length }, (_, i) => (i < level ? '●' : '○')).join('');
        parts.push(`<div class="skill${level ? '' : ' unlearned'}${passive ? ' passive' : ''}">
          <button data-cast="${a.id}" ${level && !passive ? '' : 'disabled'} title="${clean(a.levels[Math.max(0, level - 1)]?.description ?? '').replace(/"/g, '')}">
            <span class="name">${clean(a.name)}</span>${a.hotkey && !passive ? `<kbd>${a.hotkey}</kbd>` : ''}
            <span class="dots">${dots}</span>${wait ? `<span class="cd">${wait}</span>` : ''}
          </button>${learnable ? `<button class="learn" data-learn="${a.id}" title="学习">+</button>` : ''}
        </div>`);
      }
      parts.push('<span class="divider"></span>');
      for (let i = 0; i < 6; i++) {
        const itemId = p.items[i];
        const item = itemId ? this.items.get(itemId) : undefined;
        const active = this.match.activeItemAbility(itemId);
        const group = `item:${item?.cooldownGroup ?? itemId}`;
        const wait = Math.max(0, Math.ceil(((hero.readyAt[group] ?? 0) - tick) / TICK_RATE));
        parts.push(item
          ? `<button class="item${active ? '' : ' inert'}" data-item="${i}" ${active ? '' : 'disabled'}><kbd>${i + 1}</kbd>${clean(item.name)}${wait ? `<span class="cd">${wait}</span>` : ''}</button>`
          : '<span class="item empty"></span>');
      }
    }
    const next = xpForLevel(hero.level + 1);
    const header = `<div class="level">Lv ${hero.level}<small>${Math.floor(hero.xp)}/${next} 经验${skillPoints(hero) > 0 ? ` · 技能点 ${skillPoints(hero)}` : ''}</small></div>`;
    const html = header + parts.join('');
    if (html !== this.key) {
      this.key = html;
      this.bar.innerHTML = html;
    }
  }
}
