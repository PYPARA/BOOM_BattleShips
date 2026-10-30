// Codex (图鉴): every ship, weapon and piece of equipment, grouped by the shop that sells it like
// the game's own goods lists (plus what only blueprints and plans make), with a search box.
// Picking one shows its full card (the tooltip text, compared with what the player has now) and
// where it comes from: the shops and where they stand, its blueprint chain, what it combines from
// or into, the hull blueprints and bought skills a ship takes, and the carry-one-of rules. Linked
// names open their own entry. The match waits while it is open. Opens from its button or F2.
import type { Match } from '@boom/sim';
import type { Catalog, Edge } from './catalog.ts';
import { clean, esc, type Info } from './info.ts';
import { keyName, keyOf, pressed } from './keys.ts';
import { icon } from './tooltip.ts';

type Tab = 'ship' | 'weapon' | 'gear';
const TABS: [Tab, string][] = [['ship', '船只'], ['weapon', '武器'], ['gear', '装备']];

interface Entry { id: string; name: string; price: number }
interface Group { shop: string; entries: Entry[] }

/** The carry-one-of groups (goods.ts) as the codex words them. */
const UNIQUE: Record<string, string> = { 帆: '船帆只能装一面', 船首像: '船首像只能装一个', 特殊武器: '特殊武器只能带一件' };

export class Codex {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly match: Match;
  private readonly info: Info;
  private readonly catalog: Catalog;
  private readonly groups: Record<Tab, Group[]>;
  private tab: Tab = 'ship';
  private picked: string | undefined;
  private query = '';
  /** True while open (the match waits). */
  isOpen = false;

  constructor(match: Match, info: Info, catalog: Catalog) {
    this.match = match;
    this.info = info;
    this.catalog = catalog;
    this.groups = { ship: [], weapon: [], gear: [] };
    const entry = (id: string): Entry => ({ id, name: catalog.name(id), price: catalog.price(id) });
    const add = (tab: Tab, shop: string, entries: Entry[]) => { if (entries.length) this.groups[tab].push({ shop, entries: entries.sort((a, b) => a.price - b.price) }); };
    // One list per kind of shop (each side has its own copy of every base shop).
    const seen = new Set<string>();
    for (const shop of match.shops) {
      if (seen.has(shop.unitId)) continue;
      seen.add(shop.unitId);
      const name = catalog.sources.get(shop.sellsUnits[0] ?? shop.sellsItems[0] ?? '')?.find((s) => s.shopId === shop.unitId)?.shop ?? shop.unitId;
      const ships = shop.sellsUnits.filter((id) => match.world.shipType(id) && id !== 'H00J').map(entry);
      const goods = shop.sellsItems.map(entry).filter((e) => e.price > 0);
      add('ship', name, ships);
      add('weapon', name, goods.filter((e) => catalog.kind(e.id) === 'weapon'));
      add('gear', name, goods.filter((e) => catalog.kind(e.id) === 'item'));
    }
    for (const [title, ids] of [['图纸改造 / 合成获得', catalog.madeOnly()], ['商店不出售', catalog.unsold()]] as const) {
      const entries = ids.map(entry);
      add('weapon', title, entries.filter((e) => catalog.kind(e.id) === 'weapon'));
      add('gear', title, entries.filter((e) => catalog.kind(e.id) === 'item'));
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
      if (e.key === 'Escape' && this.isOpen && !document.querySelector('.dialog')) { e.stopImmediatePropagation(); this.close(); }
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
        <input type="search" placeholder="搜索名称" value="${esc(this.query).replace(/"/g, '&quot;')}">
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
    // A linked entry stays picked even when the search hides it.
    this.picked ??= groups[0]?.entries[0]?.id;
    list.innerHTML = groups.length
      ? groups.map((g) => `<h4>${esc(g.shop)}</h4><div class="grid">${g.entries.map((e) =>
        `<button class="tile${e.id === this.picked ? ' on' : ''}" data-pick="${e.id}" title="${esc(e.name)}">${icon(kind, e.id, e.name)}<b>${e.price || '—'}</b></button>`).join('')}</div>`).join('')
      : '<p class="codex-empty">没有找到</p>';
    this.renderDetail();
  }

  /** A linked name with its icon; clicking it opens that entry. */
  private chip(id: string, current = false): string {
    const c = this.catalog;
    return `<button class="codex-chip k-${c.kind(id)}${current ? ' on' : ''}" data-goto="${id}" data-tip="${c.kind(id) === 'ship' ? 'ship' : 'item'}:${id}">${icon(c.kind(id), id, c.name(id), 'small')}<span>${esc(c.name(id))}</span></button>`;
  }

  private section(title: string, body: string): string {
    return body ? `<section class="codex-sec"><h4>${title}</h4>${body}</section>` : '';
  }

  private sources(id: string): string {
    const c = this.catalog;
    const shops = (c.sources.get(id) ?? []).map((s) =>
      `<li class="${s.usable ? '' : 'off'}"><b>${esc(s.shop)}</b><span>${esc(s.where)}</span></li>`).join('');
    const made = [
      ...(c.upgradeFrom.get(id) ?? []).map((e) => `<li class="made">用 ${this.chip(e.via)} 改造 ${this.chip(e.id)}<small>需要携带被改造的武器</small></li>`),
      ...(c.recipes.get(id) ?? []).map((r) => `<li class="made">用 ${this.chip(r.via)} 合成，需要 ${r.needs.map((n) => this.chip(n)).join('<i class="plus">+</i>')}</li>`),
    ].join('');
    const none = !shops && !made ? '<li class="off">商店不出售：任务奖励或特殊来源</li>' : '';
    return `<ul class="codex-sources">${shops}${made}${none}</ul>`;
  }

  /** The blueprint chains through a weapon, top to bottom, each step's blueprint (and its price) on the arrow before it. */
  private chains(id: string): string {
    const chains = this.catalog.chains(id).filter((chain) => chain.length > 1);
    const step = (e: Edge, i: number) => `${i ? `<div class="via"><span>↓</span>${e.via ? `${this.chip(e.via)}<b class="s-gold">${this.catalog.price(e.via)}</b>` : ''}</div>` : ''}${this.chip(e.id, e.id === id)}`;
    return chains.map((chain) => `<div class="codex-chain v">${chain.map(step).join('')}</div>`).join('');
  }

  private blueprintBody(id: string): string {
    const p = this.match.world.goods.purchases.get(id);
    if (!p) return '';
    if (p.kind === 'upgrade') return p.pairs.map(([from, to]) => `<div class="codex-chain">${this.chip(from)}<span class="arrow">→</span>${this.chip(to)}</div>`).join('')
      + '<p class="codex-note">买下时船上要带着左边的武器，它会被直接改造成右边的武器。</p>';
    if (p.kind === 'combine') return `<div class="codex-chain">${p.needs.map((n) => this.chip(n)).join('<i class="plus">+</i>')}<span class="arrow">→</span>${this.chip(p.to)}</div>
      <p class="codex-note">买下时船上要带齐左边的物品，它们会合成右边的物品。</p>`;
    if (p.kind === 'hull') return `<div class="codex-ships">${Object.entries(p.bonus).map(([ship, hp]) => `<span>${this.chip(ship)}<b class="s-hp">+${hp}</b></span>`).join('')}</div>
      <p class="codex-note">增加船只耐久上限，每艘船只能用一次。</p>`;
    if (p.kind === 'shipSkill') {
      const ability = this.match.world.abilities.byId.get(p.abilityId);
      return `<p class="codex-note">为船加装技能 <em class="k-skill" data-tip="skill:${p.abilityId}">${esc(clean(ability?.name))}</em>，每艘船只能装一个；再买一次升一级。</p>`
        + (p.ships ? `<div class="codex-ships">${p.ships.map((s) => this.chip(s)).join('')}</div>` : '<p class="codex-note">所有船只都能安装。</p>');
    }
    if (p.kind === 'reset') return '<p class="codex-note">退还所有技能点，买来的船只特殊能力被移除并退款。</p>';
    return '';
  }

  private renderDetail(): void {
    const detail = this.root.querySelector('.codex-detail')!;
    const id = this.picked;
    if (!id) { detail.innerHTML = ''; return; }
    const c = this.catalog;
    let html = this.tab === 'ship' ? this.info.ship(id) : this.info.item(id);
    html += this.section('获取途径', this.sources(id));
    if (this.tab === 'ship') {
      const skills = this.match.world.abilities.skillsOf(id);
      html += this.section('技能（悬停查看详情）', skills.length ? `<div class="codex-skills">${skills.map((a) =>
        `<span data-tip="skill:${a.id}">${icon('skill', a.id, clean(a.name), 'small')}<em>${esc(clean(a.name))}</em></span>`).join('')}</div>` : '');
      html += this.section('船体强化', (c.hulls.get(id) ?? []).map((h) => `<div class="codex-row">${this.chip(h.via)}<b class="s-hp">耐久 +${h.hp}</b></div>`).join(''));
      const extras = c.skillsFor(id);
      html += this.section('可加装的特殊能力', extras.length ? extras.map((s) => this.chip(s.via)).join('')
        : '<p class="codex-note">这艘船不能加装（改装中心的特殊能力只适用于部分小型船）。</p>');
      html += this.section('换船规则', '<p class="codex-note">买新船时旧船按 <b class="n">60%</b> 退款，升级点按每点 <b class="n">60</b> 金退还；等级和经验保留，技能需要重新学习。</p>');
    } else {
      html += this.section('升级路径', this.chains(id));
      html += this.section('用途', this.blueprintBody(id));
      html += this.section('可用于合成', (c.usedIn.get(id) ?? []).map((e) => `<div class="codex-row">${this.chip(e.id)}<small>配方 ${this.chip(e.via)}</small></div>`).join(''));
      const group = this.match.world.goods.uniqueGroup.get(id);
      html += this.section('限制', group ? `<p class="codex-note"><em class="fx-warn">${UNIQUE[group] ?? `${group}只能带一件`}</em></p>` : '');
    }
    detail.innerHTML = html;
  }

  private goto(id: string): void {
    const kind = this.catalog.kind(id);
    this.tab = kind === 'ship' ? 'ship' : kind === 'weapon' ? 'weapon' : 'gear';
    this.picked = id;
    this.query = '';
    this.render();
    this.root.querySelector('.codex-list .tile.on')?.scrollIntoView({ block: 'nearest' });
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    if (t === this.root || t.closest('[data-close]')) return this.close();
    const b = t.closest('button');
    if (b?.dataset.goto) return this.goto(b.dataset.goto);
    if (b?.dataset.tab) { this.tab = b.dataset.tab as Tab; this.picked = undefined; this.render(); }
    if (b?.dataset.pick) {
      this.picked = b.dataset.pick;
      for (const tile of this.root.querySelectorAll('.codex-list .tile')) tile.classList.toggle('on', tile === b);
      this.renderDetail();
    }
  }
}
