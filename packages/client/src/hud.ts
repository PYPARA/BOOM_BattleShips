// DOM HUD: gold and score, respawn timer, messages, victory, and the shop panel that opens
// when the player's ship is within reach of a shop.
import type { Item, Unit, Weapon } from '@boom/gamedata';
import type { Match, MatchEvent } from '@boom/sim';

const clean = (s: string) => s.replace(/\|c[0-9a-fA-F]{8}|\|r/g, '').replace(/^\./, '').trim();

export interface HudData {
  unitsById: Map<string, Unit>;
  itemsById: Map<string, Item>;
  weapons: Weapon[];
}

export class Hud {
  private readonly status: HTMLElement;
  private readonly shop: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly weapons: Map<string, Weapon>;
  private shopKey = '';
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
    this.status = el('status panel');
    this.shop = el('shop');
    this.toast = el('toast');
    this.banner = el('banner');
    this.shop.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b?.dataset.cmd) return;
      const [cmd, arg] = b.dataset.cmd.split(':') as [string, string];
      if (cmd === 'ship') this.match.issue({ kind: 'buyShip', player, typeId: arg });
      if (cmd === 'item') this.match.issue({ kind: 'buyItem', player, itemId: arg });
      if (cmd === 'sell') this.match.issue({ kind: 'sellItem', player, slot: Number(arg) });
    });
  }

  private unitName(id: string): string {
    const u = this.data.unitsById.get(id);
    return clean(u?.properName ?? u?.name ?? id);
  }

  private itemLabel(id: string): string {
    const w = this.weapons.get(id);
    const name = clean(this.data.itemsById.get(id)?.name ?? id);
    return w ? `${name}<small>伤害 ${w.damage} · 射程 ${w.range} · 间隔 ${w.cooldown}s</small>` : `${name}<small>M3 生效</small>`;
  }

  onEvents(events: MatchEvent[], now: number): void {
    for (const e of events) {
      if (e.kind === 'denied' && e.player === this.player) {
        this.toast.textContent = e.reason;
        this.toastUntil = now + 2500;
      }
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
    const t = Math.floor(this.match.seconds);
    const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const respawn = p.respawnAt !== undefined ? `　复活倒计时 ${Math.ceil((p.respawnAt - this.match.world.tick) / 20)} 秒` : '';
    const hp = ship ? `　耐久 ${Math.ceil(ship.hp)}/${ship.maxHp}` : '';
    this.status.textContent = `💰 ${p.gold}　击沉 ${p.kills} / 阵亡 ${p.deaths}　⏱ ${clock}${hp}${respawn}`;
    this.toast.classList.toggle('show', now < this.toastUntil);

    // Rebuild the shop only when what it shows changes.
    const shops = this.match.shopsInReach(this.player);
    const key = `${shops.map((s) => s.unitId).join()}|${p.items.join()}|${p.gold}|${p.shipTypeId}`;
    if (key === this.shopKey) return;
    this.shopKey = key;
    if (shops.length === 0) {
      this.shop.innerHTML = '';
      this.shop.classList.remove('show');
      return;
    }
    const price = (cost: number) => `<b class="${cost > p.gold ? 'poor' : ''}">${cost}</b>`;
    const sections = shops.map((s) => {
      // Purchasable ships, plus the shipyards' fleet ships for hire; not the on-foot captain.
      const ships = s.sellsUnits.filter((id) => id !== 'H00J').map((id) => {
        const cost = this.data.unitsById.get(id)?.goldCost ?? 0;
        const current = id === p.shipTypeId ? ' disabled' : '';
        const hire = this.data.unitsById.get(id)?.isHero ? '' : '<small>雇佣：加入己方舰队进攻</small>';
        return `<button data-cmd="ship:${id}"${current}>${this.unitName(id)}${hire}${price(cost)}</button>`;
      });
      // Free items are quest tokens handed out by triggers, not shop goods.
      const items = s.sellsItems.filter((id) => (this.data.itemsById.get(id)?.goldCost ?? 0) > 0).map((id) => {
        const cost = this.data.itemsById.get(id)?.goldCost ?? 0;
        const inert = this.weapons.has(id) ? '' : ' class="inert"';
        return `<button data-cmd="item:${id}"${inert}>${this.itemLabel(id)}${price(cost)}</button>`;
      });
      const goods = [...ships, ...items];
      return goods.length ? `<section><h4>${this.unitName(s.unitId)}</h4>${goods.join('')}</section>` : '';
    });
    const slots = Array.from({ length: 6 }, (_, i) => {
      const id = p.items[i];
      return id ? `<button data-cmd="sell:${i}" title="卖出（返还 60%）">${clean(this.data.itemsById.get(id)?.name ?? id)} ✕</button>` : '<span class="empty"></span>';
    });
    this.shop.innerHTML = `<div class="inventory">${slots.join('')}</div>${sections.join('')}`;
    this.shop.classList.add('show');
  }
}
