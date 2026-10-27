// DOM HUD: the top bar (gold, team score, clock), respawn countdown, messages, victory, a hint
// naming the shops in reach (trading happens by clicking a shop: selection.ts), and the
// scoreboard while Tab is held.
import type { Item, Unit, Weapon } from '@boom/gamedata';
import { isNight, TICK_RATE, timeOfDay, type Match, type MatchEvent } from '@boom/sim';
import { clean } from './info.ts';
import { icon } from './tooltip.ts';

export interface HudData {
  unitsById: Map<string, Unit>;
  itemsById: Map<string, Item>;
  weapons: Weapon[];
}

/** Kills in a row without dying (DotA-style calls, as players of the map know them). */
const STREAKS: Record<number, string> = {
  3: '大杀特杀！', 4: '主宰比赛！', 5: '杀人如麻！', 6: '无人能挡！', 7: '变态杀戮！', 8: '妖怪般的杀戮！', 9: '如同神一般！', 10: '超越神的杀戮！',
};
/** Kills within MULTI_KILL_MS of each other. */
const MULTI: Record<number, string> = { 2: '双杀！', 3: '三杀！', 4: '疯狂杀戮！', 5: '暴走！' };
const MULTI_KILL_MS = 10_000;

export class Hud {
  private readonly top: HTMLElement;
  private readonly respawn: HTMLElement;
  private readonly shop: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly board: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly announce: HTMLElement;
  private announceUntil = 0;
  /** Called with each kill call, for its sound. */
  onAnnounce: (() => void) | undefined;
  private firstBlood = false;
  /** Per player: kills since last death, and the recent kill times for multi-kills. */
  private readonly streaks = new Map<number, { streak: number; recent: number[] }>();
  private readonly weapons: Map<string, Weapon>;
  private shopKey = '';
  private topKey = '';
  private boardKey = '';
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
    this.shop = el('shop-hint');
    this.toast = el('toast');
    this.banner = el('banner');
    this.board = el('scoreboard');
    this.feed = el('killfeed');
    this.announce = el('announce');
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
      if (e.kind === 'death' && (e.hero || e.structure)) this.onKill(e, now);
      if (e.kind === 'boss') {
        const name = this.unitName(e.typeId);
        this.announce.innerHTML = e.killed
          ? `<strong>${name} 被击败！</strong><small>${this.playerName(e.killerOwner ?? 0)} · 船只耐久 +300 · 失踪的地精出现了（65 秒）</small>`
          : `<strong>${name} 出现了！</strong><small>西部海域的 Boss 点</small>`;
        this.announce.className = 'announce show';
        this.announceUntil = now + 4000;
        this.onAnnounce?.();
      }
      if (e.kind === 'victory') {
        const won = this.match.players.get(this.player)?.team === e.winner;
        this.banner.textContent = won ? '胜利！敌方主基地已被摧毁' : '战败……我方主基地被摧毁';
        this.banner.classList.add('show', won ? 'win' : 'lose');
      }
    }
  }

  private playerName(index: number): string {
    const p = this.match.players.get(index);
    if (!p || index < 2) return index === 0 ? '南方舰队' : index === 1 ? '北方舰队' : '中立';
    const ship = clean(this.match.world.shipType(p.shipTypeId)?.name);
    return `${index === this.player ? '你' : `玩家 ${index - 1}`}（${ship}）`;
  }

  private onKill(e: Extract<MatchEvent, { kind: 'death' }>, now: number): void {
    const victim = this.match.players.get(e.owner);
    const killer = this.match.players.get(e.killerOwner);
    const side = (team?: string) => (team === 'south' ? 'south' : team === 'north' ? 'north' : '');
    const name = e.structure ? `${side(victim?.team) === 'south' ? '南方' : '北方'}${this.unitName(e.typeId)}` : this.playerName(e.owner);
    const line = document.createElement('div');
    line.innerHTML = `<b class="${side(killer?.team)}">${this.playerName(e.killerOwner)}</b> ${e.structure ? '摧毁了' : '击沉了'} <b class="${side(victim?.team)}">${name}</b>`;
    this.feed.prepend(line);
    while (this.feed.children.length > 5) this.feed.lastElementChild!.remove();
    setTimeout(() => line.classList.add('old'), 8000);
    if (e.structure) return;

    // Streaks: the victim's ends, the killer's grows.
    const ended = this.streaks.get(e.owner)?.streak ?? 0;
    this.streaks.set(e.owner, { streak: 0, recent: [] });
    if (!killer || e.killerOwner < 2 || killer.team === victim?.team) return;
    const k = this.streaks.get(e.killerOwner) ?? { streak: 0, recent: [] };
    k.streak++;
    k.recent = [...k.recent.filter((t) => now - t < MULTI_KILL_MS), now];
    this.streaks.set(e.killerOwner, k);
    const who = this.playerName(e.killerOwner);
    let call: string | undefined;
    if (!this.firstBlood) { this.firstBlood = true; call = '第一滴血！'; }
    else if (MULTI[Math.min(5, k.recent.length)] && k.recent.length >= 2) call = MULTI[Math.min(5, k.recent.length)];
    else if (k.streak >= 3) call = STREAKS[Math.min(10, k.streak)];
    else if (ended >= 3) call = `终结了 ${this.playerName(e.owner)} 的连杀！`;
    if (!call) return;
    this.announce.innerHTML = `<strong>${call}</strong><small>${who}</small>`;
    this.announce.className = `announce show ${side(killer.team)}`;
    this.announceUntil = now + 3000;
    this.onAnnounce?.();
  }

  update(now: number): void {
    if (now > this.announceUntil) this.announce.classList.remove('show');
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
      <span class="clock">${clock}</span><span class="tod" title="${isNight(this.match.world.tick) ? '夜晚：视野变短' : '白天'}">${isNight(this.match.world.tick) ? '☾' : '☀'} ${String(Math.floor(timeOfDay(this.match.world.tick))).padStart(2, '0')}:00</span><span class="kd" title="击沉 / 阵亡">${p.kills} / ${p.deaths}</span>`;
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

  /** Names the shops in reach: trading itself happens by clicking a shop (the bottom panel). */
  private updateShop(): void {
    const names = [...new Set(this.match.shopsInReach(this.player)
      .filter((s) => s.sellsUnits.some((id) => id !== 'H00J') || s.sellsItems.some((id) => (this.data.itemsById.get(id)?.goldCost ?? 0) > 0))
      .map((s) => this.unitName(s.unitId)))];
    const key = names.join('、');
    if (key === this.shopKey) return;
    this.shopKey = key;
    this.shop.innerHTML = key ? `附近商店：<b>${key}</b> · 点击建筑交易` : '';
    this.shop.classList.toggle('show', key !== '');
  }

}
