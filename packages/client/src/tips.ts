// Opening tips: a short checklist in the side column for a new captain. Each step ticks itself
// off from the match state; once all are done (or the card is closed) it stays away for good.
import { distance, type Match, type Vec2 } from '@boom/sim';

const STORAGE_KEY = 'boom.tips';

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

export class OpeningTips {
  private readonly root: HTMLElement;
  private readonly match: Match;
  private readonly player: number;
  private readonly start: Vec2;
  private closed = false;
  private finishedAt: number | undefined;
  private key = '';

  constructor(match: Match, player: number, column: HTMLElement) {
    this.match = match;
    this.player = player;
    const ship = match.world.ships.get(match.players.get(player)!.shipId ?? -1);
    this.start = ship ? { x: ship.x, y: ship.y } : { x: 0, y: 0 };
    try { this.closed = localStorage.getItem(STORAGE_KEY) === 'done'; } catch { /* storage blocked */ }
    this.root = column.insertBefore(Object.assign(document.createElement('div'), { className: 'quests tips' }), column.firstChild);
    this.root.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) this.finish(); });
  }

  private finish(): void {
    this.closed = true;
    this.root.classList.remove('show');
    try { localStorage.setItem(STORAGE_KEY, 'done'); } catch { /* storage blocked */ }
  }

  update(now: number): void {
    if (this.closed) return;
    const done = STEPS.map((s) => s.done(this.match, this.player, this.start));
    const current = done.indexOf(false);
    if (current < 0) {
      this.finishedAt ??= now;
      if (now - this.finishedAt > 4000) return this.finish();
    }
    const html = `<h4>新手指引<button data-close title="不再显示">×</button></h4>
      <ol>${STEPS.map((s, i) => `<li class="${done[i] ? 'done' : i === current ? 'now' : ''}">${s.title}${i === current ? `<small>${s.how}</small>` : ''}</li>`).join('')}</ol>
      ${current < 0 ? '<p>全部完成，祝你好运，船长！</p>' : ''}`;
    if (html !== this.key) { this.key = html; this.root.innerHTML = html; }
    this.root.classList.add('show');
  }
}
