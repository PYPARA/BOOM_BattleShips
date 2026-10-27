// DOM HUD: the top bar (gold, team score, clock), respawn countdown, messages, victory, the
// shop that opens when the player's ship is within reach of one (a tab per shop, goods as icon
// tiles; hover for details), and the scoreboard while Tab is held.
import type { Item, Unit, Weapon } from '@boom/gamedata';
import { TICK_RATE, type Match, type MatchEvent } from '@boom/sim';
import { clean } from './info.ts';
import { icon } from './tooltip.ts';

export interface HudData {
  unitsById: Map<string, Unit>;
  itemsById: Map<string, Item>;
  weapons: Weapon[];
}

export class Hud {
  private readonly top: HTMLElement;
  private readonly respawn: HTMLElement;
  private readonly shop: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly board: HTMLElement;
  private readonly weapons: Map<string, Weapon>;
  private shopKey = '';
  private topKey = '';
  private boardKey = '';
  private tab: string | undefined;
  private showBoard = false;
  private readonly repairButton: HTMLButtonElement;
  private toastUntil = 0;
  private readonly match: Match;
  private readonly player: number;
  private readonly data: HudData;

  constructor(match: Match, player: number, data: HudData) {
    this.match = match;
    this.player = player;
    this.data = data;
    this.weapons = new Map(data.weapons.map((w) => [w.id, w]));
    const el = (cls: string) => Object.assign(document.body.appendChild(document.createElement('div')), { className: cls });
    this.top = el('topbar');
    this.respawn = el('respawn');
    this.shop = el('shop');
    this.toast = el('toast');
    this.banner = el('banner');
    this.board = el('scoreboard');
    this.shop.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b?.dataset.cmd) return;
      const [cmd, arg] = b.dataset.cmd.split(':') as [string, string];
      if (cmd === 'tab') { this.tab = arg; this.shopKey = ''; }
      if (cmd === 'ship') this.match.issue({ kind: 'buyShip', player, typeId: arg });
      if (cmd === 'item') this.match.issue({ kind: 'buyItem', player, itemId: arg });
    });
    this.repairButton = Object.assign(document.body.appendChild(document.createElement('button')), {
      className: 'repair', textContent: '修理中…　提前离港 (Esc)',
    });
    this.repairButton.addEventListener('click', () => this.match.issue({ kind: 'leaveRepair', player }));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.match.issue({ kind: 'leaveRepair', player });
      if (e.key === 'Tab') { e.preventDefault(); this.showBoard = true; }
    });
    window.addEventListener('keyup', (e) => { if (e.key === 'Tab') this.showBoard = false; });
    window.addEventListener('blur', () => { this.showBoard = false; });
  }

  private unitName(id: string): string {
    const u = this.data.unitsById.get(id);
    return clean(this.match.world.shipType(id)?.name ?? u?.properName ?? u?.name ?? id);
  }

  private say(text: string, now: number, ms: number): void {
    this.toast.textContent = text;
    this.toastUntil = now + ms;
  }

  onEvents(events: MatchEvent[], now: number): void {
    for (const e of events) {
      if (e.kind === 'denied' && e.player === this.player) this.say(e.reason, now, 2500);
      if (e.kind === 'westChannel') this.say(e.open ? '西侧航道短暂开放！（120 秒）' : '西侧航道已关闭', now, 3500);
      if (e.kind === 'levelUp' && e.player === this.player) this.say(`升到 ${e.level} 级！`, now, 2000);
      if (e.kind === 'victory') {
        const won = this.match.players.get(this.player)?.team === e.winner;
        this.banner.textContent = won ? '胜利！敌方主基地已被摧毁' : '战败……我方主基地被摧毁';
        this.banner.classList.add('show', won ? 'win' : 'lose');
      }
    }
  }

  update(now: number): void {
    const p = this.match.players.get(this.player)!;
    const ship = this.match.world.ships.get(p.shipId ?? -1);
    this.toast.classList.toggle('show', now < this.toastUntil);
    const side = p.team as 'south' | 'north';
    this.repairButton.classList.toggle('show', ship !== undefined && this.match.repairing[side] === ship.id);

    const t = Math.floor(this.match.seconds);
    const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    // Slots 0 and 1 are the NPC fleets.
    const players = [...this.match.players.values()].filter((q) => q.index >= 2 && (q.team === 'south' || q.team === 'north'));
    const score = (team: string) => players.filter((q) => q.team === team).reduce((s, q) => s + q.kills, 0);
    const top = `<span class="gold" title="金钱">${p.gold}</span>
      <span class="score"><b class="south">${score('south')}</b> : <b class="north">${score('north')}</b></span>
      <span class="clock">${clock}</span><span class="kd" title="击沉 / 阵亡">${p.kills} / ${p.deaths}</span>`;
    if (top !== this.topKey) { this.topKey = top; this.top.innerHTML = top; }

    const wait = p.respawnAt !== undefined ? Math.ceil((p.respawnAt - this.match.world.tick) / TICK_RATE) : 0;
    this.respawn.textContent = wait > 0 ? `船只沉没 · ${wait} 秒后在母港复活` : '';
    this.respawn.classList.toggle('show', wait > 0);

    this.updateBoard(players);
    this.updateShop();
  }

  private updateBoard(players: ReturnType<Match['players']['get']>[]): void {
    this.board.classList.toggle('show', this.showBoard);
    if (!this.showBoard) return;
    const me = this.match.players.get(this.player)!;
    const rows = (team: string) => players.filter((q) => q!.team === team).map((q) => {
      const s = this.match.world.ships.get(q!.shipId ?? -1);
      const name = clean(this.match.world.shipType(q!.shipTypeId)?.name ?? this.data.unitsById.get(q!.shipTypeId)?.name);
      const items = q!.items.map((id) => icon(this.weapons.has(id) ? 'weapon' : 'item', id, clean(this.data.itemsById.get(id)?.name), 'mini')).join('');
      return `<tr class="${q!.index === this.player ? 'me' : ''}">
          <td>玩家 ${q!.index - 1}</td><td class="ship">${icon('ship', q!.shipTypeId, name, 'mini')}${name}</td><td>${q!.hero.level}</td>
          <td>${q!.kills} / ${q!.deaths}</td><td>${q!.team === me.team ? q!.gold : '—'}</td>
          <td>${s ? `${Math.round((s.hp / s.maxHp) * 100)}%` : '沉没'}</td><td class="items">${items}</td></tr>`;
    }).join('');
    const head = '<tr><th>玩家</th><th>船只</th><th>等级</th><th>击沉/阵亡</th><th>金钱</th><th>耐久</th><th>装备</th></tr>';
    const html = `<h3 class="south">南方</h3><table>${head}${rows('south')}</table><h3 class="north">北方</h3><table>${head}${rows('north')}</table>`;
    if (html !== this.boardKey) { this.boardKey = html; this.board.innerHTML = html; }
  }

  private updateShop(): void {
    const p = this.match.players.get(this.player)!;
    const shops = this.match.shopsInReach(this.player).filter((s) => s.sellsUnits.some((id) => id !== 'H00J') || s.sellsItems.some((id) => (this.data.itemsById.get(id)?.goldCost ?? 0) > 0));
    const active = shops.find((s) => s.unitId === this.tab) ?? shops[0];
    // Rebuild only when what it shows changes.
    const key = `${shops.map((s) => s.unitId).join()}|${active?.unitId}|${p.items.join()}|${p.gold}|${p.shipTypeId}`;
    if (key === this.shopKey) return;
    this.shopKey = key;
    if (!active) {
      this.shop.innerHTML = '';
      this.shop.classList.remove('show');
      return;
    }
    const tile = (cmd: string, tip: string, iconHtml: string, cost: number, extra = '') =>
      `<button class="tile${cost > p.gold ? ' poor' : ''}${extra}" data-cmd="${cmd}" data-tip="${tip}">${iconHtml}<b>${cost}</b></button>`;
    const ships: string[] = [], hires: string[] = [], weapons: string[] = [], gear: string[] = [];
    for (const id of active.sellsUnits) {
      if (id === 'H00J') continue; // the on-foot captain
      const u = this.data.unitsById.get(id);
      const html = tile(`ship:${id}`, `ship:${id}`, icon('ship', id, this.unitName(id)), u?.goldCost ?? 0, id === p.shipTypeId ? ' current' : '');
      (u?.isHero ? ships : hires).push(html);
    }
    for (const id of active.sellsItems) {
      const cost = this.data.itemsById.get(id)?.goldCost ?? 0;
      if (cost <= 0) continue; // quest tokens handed out by triggers
      const isWeapon = this.weapons.has(id);
      const html = tile(`item:${id}`, `item:${id}`, icon(isWeapon ? 'weapon' : 'item', id, clean(this.data.itemsById.get(id)?.name)), cost);
      (isWeapon ? weapons : gear).push(html);
    }
    const group = (title: string, tiles: string[]) => (tiles.length ? `<h4>${title}</h4><div class="grid">${tiles.join('')}</div>` : '');
    const tabs = shops.length > 1
      ? `<nav>${shops.map((s) => `<button data-cmd="tab:${s.unitId}" class="${s === active ? 'on' : ''}">${this.unitName(s.unitId)}</button>`).join('')}</nav>`
      : `<nav><span class="on">${this.unitName(active.unitId)}</span></nav>`;
    this.shop.innerHTML = tabs + group('船只', ships) + group('雇佣舰队', hires) + group('武器', weapons) + group('装备', gear)
      + `<p class="shop-hint">点击购买 · 悬停查看详情 · 右键物品栏卖出 · 身上 ${p.items.length}/6</p>`;
    this.shop.classList.add('show');
  }
}
