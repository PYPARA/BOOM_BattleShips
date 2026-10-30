// Beginner's guide. Opening tips: a short checklist in the side column for a new captain. Each
// step ticks itself off from the match state; once all are done (or the card is closed) it stays
// away for good. While a step is current, the game points at what to click (the weapon shop, the
// + on a skill). Situation hints: one-off notes the first time something happens (low hull, first
// sinking, a Boss, spare skill points, gold for a bigger ship). Settings can bring both back.
import * as THREE from 'three/webgpu';
import type { Terrain } from '@boom/gamedata';
import { distance, skillPoints, type Match, type MatchEvent, type Vec2 } from '@boom/sim';
import { groundHeightAt, SEA_LEVEL, toThree } from './space.ts';

const STORAGE_KEY = 'boom.tips';
const HINTS_KEY = 'boom.hints';
/** How long a situation hint stays up, in ms. */
const HINT_MS = 14000;
/** 武器商店: a first gun is what the buying step asks for. */
const WEAPON_SHOP = 'n001';
/** Gold enough for the first bigger hulls (快艇 500 … 护卫舰 1100). */
const SHIP_GOLD = 1100;

interface Step { title: string; how: string; done: (m: Match, player: number, start: Vec2) => boolean }

const STEPS: Step[] = [
  {
    title: '买一件装备',
    how: '左键点港口里的商店，开船靠近后点击商品购买（先买一门武器或一面帆）',
    done: (m, i) => { const p = m.players.get(i)!; return p.items.length > 0 || p.shipTypeId !== 'H000'; },
  },
  {
    title: '学习一个技能',
    how: '技能图标上出现 + 号时点击它（或按 Ctrl + 快捷键）',
    done: (m, i) => Object.values(m.players.get(i)!.hero.learned).some((n) => n > 0),
  },
  {
    title: '驶出港口',
    how: '右键点海面航行，选一条航线跟着我方舰队推进',
    done: (m, i, start) => { const ship = m.world.ships.get(m.players.get(i)!.shipId ?? -1); return !!ship && distance(ship, start) > 2500; },
  },
  {
    title: '获得第一份战功',
    how: '击沉敌方舰队、野怪或敌船，拿经验和赏金。受损后回母港修理站可自动修理',
    done: (m, i) => m.players.get(i)!.hero.xp > 0,
  },
];

type HintId = 'lowHp' | 'sunk' | 'boss' | 'points' | 'ship';

const HINTS: Record<HintId, { title: string; text: string }> = {
  lowHp: { title: '耐久不足', text: '先撤退！回母港修理站可以自动修理，按空格把镜头拉回自己的船' },
  sunk: { title: '船被击沉了', text: '稍后会在母港复活，等级越高等得越久。等待时可以按住 Tab 看看战况' },
  boss: { title: 'Boss 出现', text: 'Boss 血厚伤害高，击败它奖励丰厚。最好等装备成形，或跟队友一起挑战' },
  points: { title: '还有技能点', text: '技能图标上的 + 号可以学习新技能或升级已有技能，别让技能点闲着' },
  ship: { title: '可以换船了', text: '钱已经够买一艘更大的船：回母港点商店，在船只一栏挑选' },
};

/** Brings the checklist and every situation hint back (they show again in the next match). */
export function resetTips(): void {
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(HINTS_KEY); } catch { /* storage blocked */ }
}

export class OpeningTips {
  private readonly root: HTMLElement;
  private readonly hintCard: HTMLElement;
  private readonly pointer: HTMLElement;
  private readonly match: Match;
  private readonly player: number;
  private readonly start: Vec2;
  /** Above the weapon shop nearest the start, where the pointer floats while buying is the step. */
  private readonly shopAnchor: THREE.Vector3 | undefined;
  private readonly projected = new THREE.Vector3();
  private closed = false;
  private finishedAt: number | undefined;
  private key = '';
  private seen = new Set<string>();
  private readonly queue: HintId[] = [];
  private hint: { id: HintId; until: number } | undefined;

  constructor(match: Match, player: number, column: HTMLElement, terrain: Terrain) {
    this.match = match;
    this.player = player;
    const ship = match.world.ships.get(match.players.get(player)!.shipId ?? -1);
    this.start = ship ? { x: ship.x, y: ship.y } : { x: 0, y: 0 };
    try {
      this.closed = localStorage.getItem(STORAGE_KEY) === 'done';
      this.seen = new Set(JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]') as string[]);
    } catch { /* storage blocked */ }
    this.root = column.insertBefore(Object.assign(document.createElement('div'), { className: 'quests tips' }), column.firstChild);
    this.root.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) this.finish(); });
    this.hintCard = column.insertBefore(Object.assign(document.createElement('div'), { className: 'quests tips hint' }), this.root.nextSibling);
    this.hintCard.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) this.hint = undefined; });
    this.pointer = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'tip-pointer', textContent: '点击武器商店' });
    const shop = match.shops.filter((s) => s.unitId === WEAPON_SHOP)
      .reduce<{ s: Vec2; d: number } | undefined>((best, s) => { const d = distance(s, this.start); return !best || d < best.d ? { s, d } : best; }, undefined);
    if (shop) this.shopAnchor = toThree(shop.s.x, shop.s.y, Math.max(groundHeightAt(terrain, shop.s.x, shop.s.y), SEA_LEVEL) + 260);
  }

  /** After the settings reset the guide: the checklist and the hints start over. */
  reopen(): void {
    this.closed = false;
    this.finishedAt = undefined;
    this.key = '';
    this.seen.clear();
  }

  private finish(): void {
    this.closed = true;
    this.root.classList.remove('show');
    try { localStorage.setItem(STORAGE_KEY, 'done'); } catch { /* storage blocked */ }
  }

  private show(id: HintId): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.queue.push(id);
    try { localStorage.setItem(HINTS_KEY, JSON.stringify([...this.seen])); } catch { /* storage blocked */ }
  }

  onEvents(events: MatchEvent[]): void {
    const p = this.match.players.get(this.player)!;
    for (const e of events) {
      if (e.kind === 'death' && e.hero && e.owner === this.player) this.show('sunk');
      if (e.kind === 'boss' && !e.killed) this.show('boss');
      // The checklist teaches the first skill; this is for points left over later.
      if (e.kind === 'levelUp' && e.player === this.player && e.level >= 3 && skillPoints(p.hero) > 0) this.show('points');
    }
  }

  /** `shopOpen`: the player is looking at a shop already, so the pointer can rest. */
  update(now: number, camera: THREE.Camera, shopOpen: boolean): void {
    const p = this.match.players.get(this.player)!;
    const ship = this.match.world.ships.get(p.shipId ?? -1);
    if (ship && ship.hp < ship.maxHp * 0.35) this.show('lowHp');
    if (p.shipTypeId === 'H000' && p.gold >= SHIP_GOLD) this.show('ship');
    this.updateHint(now);

    const done = STEPS.map((s) => s.done(this.match, this.player, this.start));
    const current = this.closed ? -1 : done.indexOf(false);
    document.body.classList.toggle('tip-learn', current === 1);
    this.updatePointer(current === 0 && !shopOpen, camera);
    if (this.closed) return;
    if (current < 0) {
      this.finishedAt ??= now;
      if (now - this.finishedAt > 4000) return this.finish();
    }
    const html = `<h4>新手指引<button data-close title="不再显示（可在设置里重新打开）">×</button></h4>
      <ol>${STEPS.map((s, i) => `<li class="${done[i] ? 'done' : i === current ? 'now' : ''}">${s.title}${i === current ? `<small>${s.how}</small>` : ''}</li>`).join('')}</ol>
      ${current < 0 ? '<p>全部完成，祝你好运，船长！</p>' : ''}`;
    if (html !== this.key) { this.key = html; this.root.innerHTML = html; }
    this.root.classList.add('show');
  }

  private updateHint(now: number): void {
    if (this.hint && now > this.hint.until) this.hint = undefined;
    if (!this.hint && this.queue.length) {
      const id = this.queue.shift()!;
      this.hint = { id, until: now + HINT_MS };
      this.hintCard.innerHTML = `<h4>${HINTS[id].title}<button data-close title="知道了">×</button></h4><p>${HINTS[id].text}</p>`;
    }
    this.hintCard.classList.toggle('show', !!this.hint);
  }

  /** Floats the pointer over the shop; off screen, it waits at the nearest edge pointing the way. */
  private updatePointer(visible: boolean, camera: THREE.Camera): void {
    if (!visible || !this.shopAnchor) { this.pointer.classList.remove('show'); return; }
    const v = this.projected.copy(this.shopAnchor).project(camera);
    const sx = (v.z > 1 ? -v.x + 1 : v.x + 1) / 2 * innerWidth, sy = (v.z > 1 ? 2 : 1 - v.y) / 2 * innerHeight;
    const x = Math.min(innerWidth - 70, Math.max(70, sx)), y = Math.min(innerHeight - 250, Math.max(110, sy));
    const dx = sx - x, dy = sy - y, edge = dx !== 0 || dy !== 0;
    const arrow = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? '◀' : '▶') : (dy < 0 ? '▲' : '▼');
    const text = edge ? `${arrow} 武器商店` : '点击武器商店';
    if (this.pointer.textContent !== text) this.pointer.textContent = text;
    this.pointer.classList.toggle('edge', edge);
    this.pointer.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${edge ? '-50%' : '-100%'})`;
    this.pointer.classList.add('show');
  }
}
