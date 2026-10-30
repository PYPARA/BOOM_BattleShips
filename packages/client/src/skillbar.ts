// Bottom command panel for the player's ship: portrait with health and experience, skills
// (learn with +, cast with hotkeys or clicks, unit/point targeting, cooldown sweep) and the six
// item slots (1–6 to use, right-click near a shop to sell). Hover anything for its tooltip.
import type { Ability, Item } from '@boom/gamedata';
import { canLearn, skillPoints, TICK_RATE, xpForLevel, type Match } from '@boom/sim';
import type { RtsCamera } from './camera.ts';
import { clean } from './info.ts';
import { keyFrom, keyName, keyOf, pressed, SKILL_SLOTS, type KeyAction } from './keys.ts';
import { icon } from './tooltip.ts';

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
    this.bar = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'command' });
    this.hint = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'target-hint' });

    this.bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.learn) this.match.issue({ kind: 'learn', player, abilityId: b.dataset.learn });
      else if (b.dataset.cast) this.begin(b.dataset.cast);
      else if (b.dataset.item) this.beginItem(Number(b.dataset.item));
    });
    this.bar.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.item && this.match.shopsInReach(player).length) this.match.issue({ kind: 'sellItem', player, slot: Number(b.dataset.item) });
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
      for (let slot = 0; slot < 6; slot++) if (pressed(e, `item${slot + 1}` as KeyAction)) { this.beginItem(slot); return; }
      if (e.altKey) return;
      const key = keyFrom(e);
      const ability = this.skills().find((a, i) => this.hotkeyOf(a, i) === key);
      if (ability) this.begin(ability.id);
    });
  }

  /** Hidden while the bottom panel shows something else (a selected unit or shop). */
  setVisible(visible: boolean): void {
    this.bar.classList.toggle('hidden', !visible);
  }

  private ship() {
    return this.match.world.ships.get(this.match.players.get(this.player)?.shipId ?? -1);
  }

  /** Learnable skills, then skills bought for the ship (船只特殊能力, submarine gear). */
  private skills(): Ability[] {
    const ship = this.ship();
    return ship ? [...this.match.world.abilities.skillsOf(ship.typeId), ...this.match.world.abilities.grantedOf(ship)] : [];
  }

  /**
   * A skill's key by its slot: the slot's own binding, else the map's letter for the skill unless
   * some other binding has taken that letter.
   */
  private hotkeyOf(a: Ability, slot: number): string {
    const bound = slot < SKILL_SLOTS ? keyOf(`skill${slot + 1}` as KeyAction) : '';
    if (bound) return bound;
    const own = a.hotkey?.toLowerCase() ?? '';
    const taken = this.skills().some((_, i) => i !== slot && i < SKILL_SLOTS && keyOf(`skill${i + 1}` as KeyAction) === own);
    return taken ? '' : own;
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

  /** Cooldown sweep: the share still waiting, rounded so the panel only redraws on visible change. */
  private sweep(readyAt: number | undefined, total: number): string {
    const left = (readyAt ?? 0) - this.match.world.tick;
    if (left <= 0 || total <= 0) return '';
    const share = Math.min(1, left / (total * TICK_RATE));
    return `<span class="cd" style="--p:${Math.ceil(share * 50) / 50}">${Math.ceil(left / TICK_RATE)}</span>`;
  }

  update(): void {
    const ship = this.ship();
    const p = this.match.players.get(this.player)!;
    const hero = p.hero;
    const abilities = this.match.world.abilities;
    const type = this.match.world.shipType(p.shipTypeId);

    const prev = xpForLevel(hero.level), next = xpForLevel(hero.level + 1);
    const xpShare = hero.level >= 25 ? 1 : (hero.xp - prev) / Math.max(1, next - prev);
    const hpShare = ship ? ship.hp / ship.maxHp : 0;
    const points = skillPoints(hero);
    const portrait = `<div class="portrait" data-tip="ship:${p.shipTypeId}">
        ${icon('ship', p.shipTypeId, type?.name ?? '')}<span class="lv">${hero.level}</span>
      </div>
      <div class="vitals">
        <div class="name">${clean(type?.name)}<small>${type?.hullClass ?? ''} · ${type?.size ?? ''}</small></div>
        <div class="bar hp"><i style="width:${(hpShare * 100).toFixed(1)}%"></i><span>${ship ? `${Math.ceil(ship.hp)} / ${Math.round(ship.maxHp)}` : '沉没'}</span></div>
        <div class="bar xp"><i style="width:${(xpShare * 100).toFixed(1)}%"></i><span>${hero.level >= 25 ? '满级' : `经验 ${Math.floor(hero.xp - prev)} / ${next - prev}`}${points > 0 ? ` · 技能点 ${points}` : ''}</span></div>
        ${ship ? `<div class="stats"><span title="护甲">🛡 ${ship.armor.toFixed(1)}</span><span title="航速">⛵ ${Math.round(ship.maxSpeed)}</span>${ship.damageTaken < 1 ? `<span title="船甲减伤">⚓ −${Math.round((1 - ship.damageTaken) * 100)}%</span>` : ''}<span title="武器数量">💥 ${ship.weapons.length}</span></div>` : ''}
      </div>`;

    const skills = this.skills().map((a, slot) => {
      const hotkey = keyName(this.hotkeyOf(a, slot));
      const bought = !hero.learned[a.id] && !!hero.granted[a.id];
      const level = hero.learned[a.id] || hero.granted[a.id] || 0;
      const passive = abilities.targeting(a.id) === 'passive';
      const dots = Array.from({ length: a.levels.length }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
      const cooldown = a.levels[Math.max(0, level - 1)]?.cooldown ?? 0;
      return `<div class="slot skill${level ? '' : ' unlearned'}${passive ? ' passive' : ''}${bought ? ' bought' : ''}">
          <button data-cast="${a.id}" data-tip="skill:${a.id}" ${level && !passive ? '' : 'disabled'}>
            ${icon('skill', a.id, clean(a.name))}${hotkey && !passive ? `<kbd>${hotkey}</kbd>` : ''}${this.sweep(hero.readyAt[a.id], cooldown)}
          </button><span class="dots">${dots}</span>
          ${!bought && canLearn(hero, a) ? `<button class="learn" data-learn="${a.id}" data-tip="skill:${a.id}">+</button>` : ''}
        </div>`;
    });

    const slots = Array.from({ length: 6 }, (_, i) => {
      const id = p.items[i];
      if (!id) return '<span class="slot item empty"></span>';
      const item = this.items.get(id);
      const active = this.match.activeItemAbility(id);
      const group = `item:${item?.cooldownGroup ?? id}`;
      const cooldown = active ? abilities.byId.get(active)?.levels[0]?.cooldown ?? 0 : 0;
      const kind = this.match.world.weaponType(id) ? 'weapon' : 'item';
      return `<button class="slot item${active ? ' active' : ''}" data-item="${i}" data-tip="slot:${i}">
          ${icon(kind, id, clean(item?.name))}${keyOf(`item${i + 1}` as KeyAction) ? `<kbd>${keyName(keyOf(`item${i + 1}` as KeyAction))}</kbd>` : ''}${hero.charges[id] ? `<span class="charges">${hero.charges[id]}</span>` : ''}${this.sweep(hero.readyAt[group], cooldown)}
        </button>`;
    });

    const html = `<div class="hero">${portrait}</div><div class="skills">${skills.join('')}</div><div class="items">${slots.join('')}</div>`;
    if (html !== this.key) {
      this.key = html;
      this.bar.innerHTML = html;
    }
  }
}
