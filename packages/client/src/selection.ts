// The bottom panel when something other than the player's ship is selected (Warcraft's unit
// info card): portrait, health, attack, armor, speed and status for a unit or building; for a
// shop, its goods. Buying from a shop works only while the player's ship is in its reach, like
// the original's shops (select the shop, click the goods).
import type { Item, Unit } from '@boom/gamedata';
import { BOSSES, CONTRACTS, CREEP_OWNER, distance, SHOP_RANGE, strongest, type Match, type UnitEntity } from '@boom/sim';
import type { Focus } from './input.ts';
import { clean, statClass } from './info.ts';
import { icon } from './tooltip.ts';

const ARMOR: Record<string, string> = { small: '轻型', medium: '中型', large: '重型', fort: '城墙', hero: '英雄', divine: '神圣', none: '无', normal: '普通' };
const BUFFS: Partial<Record<string, string>> = {
  stun: '失控', root: '定身', silence: '沉默', slow: '减速', haste: '加速', invulnerable: '无敌', dot: '灼烧', hot: '回复',
  damageBonus: '战鼓', spied: '被监视', invisible: '隐形', armorDown: '破甲', disarm: '变异',
};

/** The NPC fleets' boats share the ship icons; every other unit and building has its own. */
const NPC_FLEET = /^h0(0[IEBFHG]|1[M3708]|10)$/;

export interface SelectionData {
  units: Map<string, Unit>;
  items: Map<string, Item>;
}

export class SelectionPanel {
  private readonly root: HTMLElement;
  private readonly match: Match;
  private readonly player: number;
  private readonly data: SelectionData;
  private key = '';
  private shopIndex: number | undefined;
  /** Sends the player's ship to a point (the shop's dock). */
  onSail: ((x: number, y: number) => void) | undefined;
  /** Clicking the portrait: the camera goes to the unit or shop shown. */
  onLook: ((x: number, y: number) => void) | undefined;

  constructor(match: Match, player: number, data: SelectionData) {
    this.match = match;
    this.player = player;
    this.data = data;
    this.root = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'command info' });
    this.root.addEventListener('click', (e) => this.onClick(e));
  }

  private name(typeId: string): string {
    const u = this.data.units.get(typeId);
    return clean(this.match.world.shipType(typeId)?.name ?? u?.properName ?? u?.name ?? typeId);
  }

  /** Draws the panel for the focus; returns false (and hides) when there is nothing to show. */
  update(focus: Focus | undefined): boolean {
    let html = '';
    this.shopIndex = undefined;
    if (focus?.kind === 'unit') {
      const u = this.match.world.unit(focus.id);
      if (u) html = this.unitCard(u);
    } else if (focus?.kind === 'shop') {
      this.shopIndex = focus.index;
      html = this.shopCard(focus.index);
    }
    this.root.classList.toggle('show', html !== '');
    if (html !== this.key) { this.key = html; this.root.innerHTML = html; }
    return html !== '';
  }

  private unitCard(u: UnitEntity): string {
    const type = this.data.units.get(u.typeId);
    const owner = this.match.players.get(u.owner);
    const me = this.match.players.get(this.player)!;
    const creep = u.owner === CREEP_OWNER;
    const side = creep ? '中立' : u.team === 'neutral' ? '中立' : u.owner === this.player ? '你' : u.team === me.team ? '友军' : '敌方';
    const who = creep ? ((BOSSES as readonly string[]).includes(u.typeId) ? 'Boss' : '野怪')
      : u.isHero && owner && !u.illusion ? `玩家 ${owner.index - 1}` : u.kind === 'structure' ? '建筑' : u.summoned ? '召唤物' : '舰队';
    const level = u.hero?.level ?? type?.level;
    const stat = (label: string, value: string | number) => `<div><span>${label}</span><b class="${statClass(label)}">${value}</b></div>`;
    const stats: string[] = [];
    const a = u.attacks[0];
    if (a) stats.push(stat('攻击', `${a.damageBase + a.dice + u.bonusDamage}–${a.damageBase + a.dice * a.sides + u.bonusDamage}`), stat('间隔', `${(a.cooldown / (1 + u.attackSpeedBonus)).toFixed(2)} 秒`), stat('射程', a.range));
    if (u.weapons.length) {
      const dps = u.weapons.reduce((s, w) => s + w.damage / w.cooldown, 0);
      stats.push(stat('武器', `${u.weapons.length} 件`), stat('每秒伤害', Math.round(dps)));
    }
    stats.push(stat('护甲', `${(u.armor - strongest(u, 'armorDown')).toFixed(1)} · ${ARMOR[u.armorType] ?? u.armorType}`));
    if (u.kind === 'ship') stats.push(stat('航速', Math.round(u.maxSpeed)));
    if (type?.sight) stats.push(stat('视野', type.sight));
    if (u.damageTaken < 1) stats.push(stat('船甲减伤', `${Math.round((1 - u.damageTaken) * 100)}%`));
    if (type?.bounty && side !== '你' && side !== '友军') stats.push(stat('赏金', `${type.bounty.base + type.bounty.dice}–${type.bounty.base + type.bounty.dice * type.bounty.sides}`));
    const buffs = [...new Set(u.buffs.map((b) => BUFFS[b.kind]).filter(Boolean))];
    const items = u.isHero && owner ? owner.items.map((id) => `<span data-tip="item:${id}">${icon(this.match.world.weaponType(id) ? 'weapon' : 'item', id, clean(this.data.items.get(id)?.name), 'small')}</span>`).join('') : '';
    const skills = u.hero ? Object.entries(u.hero.learned).filter(([, n]) => n > 0).map(([id, n]) => {
      const ab = this.match.world.abilities.byId.get(id);
      return `<span data-tip="skill:${id}">${icon('skill', id, clean(ab?.name), 'small')}<sub>${n}</sub></span>`;
    }).join('') : '';
    const hp = u.hp / u.maxHp;
    // 商船任务 mode: teammates may hand each other gold.
    const gift = this.match.mode === 'traders' && side === '友军' && u.isHero && owner && owner.index >= 2 && !u.illusion
      ? `<div class="gift"><span>赠送金钱</span>${[100, 500, 1000].map((n) => `<button data-gift="${owner.index}:${n}">${n}</button>`).join('')}</div>` : '';
    return `${gift}<div class="hero"><div class="portrait" data-look="unit:${u.id}" title="点击：镜头移到这里">${icon(this.match.world.shipType(u.typeId) || NPC_FLEET.test(u.typeId) ? 'ship' : 'unit', u.typeId, this.name(u.typeId))}${level ? `<span class="lv">${level}</span>` : ''}</div>
      <div class="vitals">
        <div class="name">${this.name(u.typeId)}<small class="side ${side === '敌方' ? 'enemy' : side === '中立' ? 'neutral' : 'friend'}">${side} · ${who}${u.illusion ? ' · 幻象' : ''}</small></div>
        <div class="bar hp ${side === '敌方' || creep ? 'foe' : ''}"><i style="width:${(hp * 100).toFixed(1)}%"></i><span>${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}</span></div>
        ${buffs.length ? `<div class="chips">${buffs.map((b) => `<em>${b}</em>`).join('')}</div>` : ''}
      </div></div>
      <div class="statgrid">${stats.join('')}</div>
      ${items || skills ? `<div class="loadout">${skills ? `<div><span>技能</span>${skills}</div>` : ''}${items ? `<div><span>装备</span>${items}</div>` : ''}</div>` : ''}`;
  }

  private shopCard(index: number): string {
    const shop = this.match.shops[index];
    if (!shop) return '';
    const p = this.match.players.get(this.player)!;
    const ship = this.match.world.ships.get(p.shipId ?? -1);
    const usable = this.match.friendlyShops(this.player).includes(shop);
    const inReach = usable && this.match.shopsInReach(this.player).includes(shop);
    const gap = ship ? Math.max(0, Math.round(distance(ship, shop) - SHOP_RANGE)) : 0;
    const status = !usable ? '<b class="no">敌方商店，不能交易</b>'
      : !ship ? '<b class="no">船只沉没中，复活后才能交易</b>'
        : inReach ? '<b class="ok">船只在范围内，点击商品购买</b>'
          : `<b class="no">船只需要靠近商店（还差 ${gap} 码）</b><button data-sail>驶向商店</button>`;
    const tile = (cmd: string, tip: string, iconHtml: string, cost: number, extra = '') =>
      `<button class="tile${cost > p.gold ? ' poor' : ''}${inReach ? '' : ' off'}${extra}" data-cmd="${cmd}" data-tip="${tip}">${iconHtml}<b>${cost}</b></button>`;
    const ships: string[] = [], hires: string[] = [], weapons: string[] = [], gear: string[] = [], contracts: string[] = [];
    for (const id of shop.sellsUnits) {
      if (id === 'H00J') continue; // the on-foot captain
      const u = this.data.units.get(id);
      const html = tile(`ship:${id}`, `ship:${id}`, icon('ship', id, this.name(id)), u?.goldCost ?? 0, id === p.shipTypeId ? ' current' : '');
      (u?.isHero ? ships : hires).push(html);
    }
    for (const id of shop.sellsItems) {
      // Contracts are free but need reputation (声望).
      const contract = CONTRACTS[id];
      if (contract) {
        contracts.push(`<button class="tile contract${contract.rep > p.reputation ? ' poor' : ''}${inReach ? '' : ' off'}" data-cmd="item:${id}" data-tip="item:${id}">${icon('item', id, clean(this.data.items.get(id)?.name))}<b>★${contract.rep}</b></button>`);
        continue;
      }
      const cost = this.data.items.get(id)?.goldCost ?? 0;
      if (cost <= 0) continue; // quest tokens handed out by triggers
      const isWeapon = !!this.match.world.weaponType(id);
      (isWeapon ? weapons : gear).push(tile(`item:${id}`, `item:${id}`, icon(isWeapon ? 'weapon' : 'item', id, clean(this.data.items.get(id)?.name)), cost));
    }
    const group = (title: string, tiles: string[]) => (tiles.length ? `<h4>${title}</h4><div class="grid">${tiles.join('')}</div>` : '');
    const own = p.items.map((id, i) => `<button class="tile mine" data-sell="${i}" data-tip="slot:${i}">${icon(this.match.world.weaponType(id) ? 'weapon' : 'item', id, clean(this.data.items.get(id)?.name), 'small')}</button>`).join('');
    return `<div class="shop-head"><div class="portrait" data-look="shop:${index}" title="点击：镜头移到这里">${icon('unit', shop.unitId, this.name(shop.unitId))}</div>
        <div><div class="name">${this.name(shop.unitId)}</div><div class="status">${status}</div></div></div>
      <div class="goods">${group('船只', ships)}${group('雇佣舰队', hires)}${group('武器', weapons)}${group('装备', gear)}${group(`任务合同（需要声望 ★，你有 ${p.reputation}）`, contracts)}</div>
      ${own && inReach ? `<div class="loadout"><div><span>出售（返还 60%）</span>${own}</div></div>` : ''}`;
  }

  private onClick(e: Event): void {
    const look = (e.target as HTMLElement).closest<HTMLElement>('[data-look]')?.dataset.look;
    if (look) {
      const [kind, id] = look.split(':');
      const at = kind === 'shop' ? this.match.shops[Number(id)] : this.match.world.unit(Number(id));
      if (at) this.onLook?.(at.x, at.y);
      return;
    }
    const b = (e.target as HTMLElement).closest('button');
    if (b?.dataset.gift) {
      const [to, amount] = b.dataset.gift.split(':').map(Number);
      this.match.issue({ kind: 'giveGold', player: this.player, to: to!, amount: amount! });
      return;
    }
    if (!b || this.shopIndex === undefined) return;
    const shop = this.match.shops[this.shopIndex]!;
    if (b.dataset.sail !== undefined) {
      const ship = this.match.world.ships.get(this.match.players.get(this.player)?.shipId ?? -1);
      const spot = ship && this.match.world.grid.nearestSailable(shop.x, shop.y, ship.pathRadius);
      if (spot) this.onSail?.(spot.x, spot.y);
      return;
    }
    if (b.dataset.sell !== undefined) { this.match.issue({ kind: 'sellItem', player: this.player, slot: Number(b.dataset.sell) }); return; }
    const [cmd, id] = (b.dataset.cmd ?? '').split(':');
    if (cmd === 'ship') this.match.issue({ kind: 'buyShip', player: this.player, typeId: id!, shop: this.shopIndex });
    if (cmd === 'item') this.match.issue({ kind: 'buyItem', player: this.player, itemId: id!, shop: this.shopIndex });
  }
}
