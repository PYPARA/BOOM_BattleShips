// Codex (图鉴): every ship, weapon and piece of equipment the shops sell, grouped by shop like the
// game's own goods lists, with a search box. Picking one shows its full card (the same text as the
// tooltips, compared with what the player has now); a ship also lists its skills. The match waits
// while it is open. Opens from its button or F2.
import type { Item, Unit } from '@boom/gamedata';
import type { Match } from '@boom/sim';
import { clean, type Info } from './info.ts';
import { keyName, keyOf, pressed } from './keys.ts';
import { icon } from './tooltip.ts';

type Tab = 'ship' | 'weapon' | 'gear';
const TABS: [Tab, string][] = [['ship', '船只'], ['weapon', '武器'], ['gear', '装备']];

interface Entry { id: string; name: string; price: number }
interface Group { shop: string; entries: Entry[] }

export class Codex {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly match: Match;
  private readonly info: Info;
  private readonly groups: Record<Tab, Group[]>;
  private tab: Tab = 'ship';
  private picked: string | undefined;
  private query = '';
  /** True while open (the match waits). */
  isOpen = false;

  constructor(match: Match, info: Info, units: Map<string, Unit>, items: Map<string, Item>) {
    this.match = match;
    this.info = info;
    this.groups = { ship: [], weapon: [], gear: [] };
    // One list per kind of shop (each side has its own copy of every shop).
    const seen = new Set<string>();
    for (const shop of match.shops) {
      if (seen.has(shop.unitId)) continue;
      seen.add(shop.unitId);
      const shopName = clean(units.get(shop.unitId)?.name ?? shop.unitId);
      const ships = shop.sellsUnits.filter((id) => units.get(id)?.isHero && id !== 'H00J')
        .map((id) => ({ id, name: clean(match.world.shipType(id)?.name ?? units.get(id)?.name), price: units.get(id)?.goldCost ?? 0 }));
      const goods = shop.sellsItems.map((id) => ({ id, name: clean(items.get(id)?.name), price: items.get(id)?.goldCost ?? 0 })).filter((e) => e.price > 0);
      const add = (tab: Tab, entries: Entry[]) => { if (entries.length) this.groups[tab].push({ shop: shopName, entries: entries.sort((a, b) => a.price - b.price) }); };
      add('ship', ships);
      add('weapon', goods.filter((e) => match.world.weaponType(e.id)));
      add('gear', goods.filter((e) => !match.world.weaponType(e.id)));
    }

    this.button = Object.assign(document.body.appendChild(document.createElement('button')), { className: 'codex-button', textContent: '📖' });
    this.button.addEventListener('click', () => this.toggle());
    this.root = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'codex' });
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value.trim();
      this.renderList();
    });
    // Typing in the search box is not hotkeys.
    this.root.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest?.('input, textarea')) return;
      if (pressed(e, 'codex')) { e.preventDefault(); this.toggle(); }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) { e.stopImmediatePropagation(); this.close(); }
    }, { capture: true });
    this.renderButton();
  }

  private renderButton(): void {
    const key = keyName(keyOf('codex'));
    this.button.title = `图鉴${key ? ` (${key})` : ''}`;
  }

  toggle(): void {
    if (this.isOpen) this.close(); else this.open();
  }

  open(): void {
    this.isOpen = true;
    this.renderButton();
    this.render();
    this.root.classList.add('show');
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.remove('show');
  }

  private render(): void {
    this.root.innerHTML = `<div class="codex-card">
      <div class="codex-head">
        <h2>图鉴</h2>
        <nav>${TABS.map(([t, label]) => `<button data-tab="${t}" class="${t === this.tab ? 'on' : ''}">${label}</button>`).join('')}</nav>
        <input type="search" placeholder="搜索名称" value="${this.query.replace(/"/g, '&quot;')}">
        <button class="codex-close" data-close title="关闭 (Esc)">×</button>
      </div>
      <div class="codex-body"><div class="codex-list"></div><div class="codex-detail"></div></div>
    </div>`;
    this.renderList();
  }

  private renderList(): void {
    const list = this.root.querySelector('.codex-list');
    if (!list) return;
    const q = this.query.toLowerCase();
    const kind = this.tab === 'ship' ? 'ship' : this.tab === 'weapon' ? 'weapon' : 'item';
    const groups = this.groups[this.tab]
      .map((g) => ({ ...g, entries: g.entries.filter((e) => !q || e.name.toLowerCase().includes(q)) }))
      .filter((g) => g.entries.length);
    if (!this.picked || !groups.some((g) => g.entries.some((e) => e.id === this.picked))) this.picked = groups[0]?.entries[0]?.id;
    list.innerHTML = groups.length
      ? groups.map((g) => `<h4>${g.shop}</h4><div class="grid">${g.entries.map((e) =>
        `<button class="tile${e.id === this.picked ? ' on' : ''}" data-pick="${e.id}" title="${e.name}">${icon(kind, e.id, e.name)}<b>${e.price}</b></button>`).join('')}</div>`).join('')
      : '<p class="codex-empty">没有找到</p>';
    this.renderDetail();
  }

  private renderDetail(): void {
    const detail = this.root.querySelector('.codex-detail')!;
    const id = this.picked;
    if (!id) { detail.innerHTML = ''; return; }
    let html = this.tab === 'ship' ? this.info.ship(id) : this.info.item(id);
    if (this.tab === 'ship') {
      const skills = this.match.world.abilities.skillsOf(id);
      if (skills.length) html += `<h4>技能（悬停查看详情）</h4><div class="codex-skills">${skills.map((a) =>
        `<span data-tip="skill:${a.id}">${icon('skill', a.id, clean(a.name), 'small')}<em>${clean(a.name)}</em></span>`).join('')}</div>`;
    }
    detail.innerHTML = html;
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    if (t === this.root || t.closest('[data-close]')) return this.close();
    const b = t.closest('button');
    if (b?.dataset.tab) { this.tab = b.dataset.tab as Tab; this.picked = undefined; this.render(); }
    if (b?.dataset.pick) {
      this.picked = b.dataset.pick;
      for (const tile of this.root.querySelectorAll('.codex-list .tile')) tile.classList.toggle('on', tile === b);
      this.renderDetail();
    }
  }
}
