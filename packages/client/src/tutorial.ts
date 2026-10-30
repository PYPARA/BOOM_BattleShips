// The tutorial: the player alone with the NPC fleets, taught one lesson at a time. A card under the
// top bar says what to do; each lesson ticks itself off from what the player does (or can be
// skipped), with a pointer or glow on what to click. Its place is kept in the save.
import type * as THREE from 'three/webgpu';
import type { Terrain } from '@boom/gamedata';
import { distance, type Match, type MatchEvent, type Vec2 } from '@boom/sim';
import type { RtsCamera } from './camera.ts';
import { keyName, keyOf, pressed } from './keys.ts';
import { weaponShopAnchor, WorldPointer } from './tips.ts';

interface Context {
  match: Match;
  player: number;
  spawn: Vec2;
  rts: RtsCamera;
  /** Things the player did since the lesson began. */
  did: Set<'focus' | 'scoreboard' | 'cast' | 'codex'>;
  codexOpen: boolean;
}

interface Lesson {
  title: string;
  text: () => string;
  done: (c: Context) => boolean;
  /** Point at the weapon shop / make the skill + glow while this lesson is on. */
  pointShop?: boolean;
  glowLearn?: boolean;
}

const key = (action: Parameters<typeof keyOf>[0], fallback: string) => keyName(keyOf(action)) || fallback;

const LESSONS: Lesson[] = [
  {
    title: '移动镜头',
    text: () => '用方向键、把鼠标移到屏幕边缘或按住中键拖动来平移镜头，滚动滚轮缩放。随便看看周围的母港。',
    done: (c) => Math.hypot(c.rts.target.x - c.spawn.x, -c.rts.target.z - c.spawn.y) > 1200 || Math.abs(c.rts.viewDistance - 2400) > 500,
  },
  {
    title: '回到船只',
    text: () => `按 <kbd>${key('focus', '空格')}</kbd> 把镜头拉回你的船。迷路的时候随时可以用。`,
    done: (c) => c.did.has('focus'),
  },
  {
    title: '航行',
    text: () => '左键点你的小艇选中它，然后<b>右键点海面</b>，船就会驶向那里。也可以右键点小地图远航。',
    done: (c) => { const ship = c.match.world.ships.get(c.match.players.get(c.player)!.shipId ?? -1); return !!ship && distance(ship, c.spawn) > 500; },
  },
  {
    title: '买一门武器',
    text: () => '<b>左键点武器商店</b>打开商品。船需要开到商店附近才能买：点「驶向商店」或自己开过去，然后点一门买得起的武器。',
    done: (c) => c.match.players.get(c.player)!.items.some((id) => c.match.world.weaponType(id)),
    pointShop: true,
  },
  {
    title: '学习技能',
    text: () => '每升一级得到一个技能点。技能图标上的 <b>+</b> 号表示可以学习，点击它学一个技能（开局就有 1 点）。',
    done: (c) => Object.values(c.match.players.get(c.player)!.hero.learned).some((n) => n > 0),
    glowLearn: true,
  },
  {
    title: '释放技能',
    text: () => '按技能图标角上的快捷键，或直接点击图标释放技能；需要目标的技能再左键点选目标或海面。被动技能不用释放，可以跳过这一步。',
    done: (c) => c.did.has('cast'),
  },
  {
    title: '查看战况',
    text: () => `按住 <kbd>${key('scoreboard', 'Tab')}</kbd> 查看双方每位玩家的船、等级、击沉与装备。松开就会收起。`,
    done: (c) => c.did.has('scoreboard'),
  },
  {
    title: '翻翻图鉴',
    text: () => `按 <kbd>${key('codex', 'F2')}</kbd> 或点左上角的 📖 打开图鉴，看看能买哪些船、武器和装备。打开时游戏会暂停。`,
    done: (c) => c.did.has('codex'),
  },
  {
    title: '第一场战斗',
    text: () => '沿航道跟着我方舰队推进，击沉一艘敌方舰队的船或野怪，赚取经验和赏金。耐久低了就回母港修理站修理。',
    done: (c) => c.match.players.get(c.player)!.hero.xp > 0,
  },
];

export class Tutorial {
  private readonly root: HTMLElement;
  private readonly ctx: Context;
  private readonly pointer = new WorldPointer('武器商店');
  private readonly shopAnchor: THREE.Vector3 | undefined;
  /** The current lesson; LESSONS.length when all are done. */
  step: number;
  private doneAt: number | undefined;
  private hidden = false;
  private key = '';
  /** Leaves the tutorial for the main menu. */
  onExit: (() => void) | undefined;

  constructor(match: Match, player: number, spawn: Vec2, rts: RtsCamera, terrain: Terrain, step = 0) {
    this.ctx = { match, player, spawn, rts, did: new Set(), codexOpen: false };
    this.step = Math.min(step, LESSONS.length);
    this.shopAnchor = weaponShopAnchor(match, terrain, spawn);
    this.root = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'tutorial' });
    this.root.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest('button')?.dataset.action;
      if (action === 'skip') this.advance();
      if (action === 'practice') this.hidden = true;
      if (action === 'exit') this.onExit?.();
    });
    window.addEventListener('keydown', (e) => {
      if (pressed(e, 'focus')) this.ctx.did.add('focus');
      if (pressed(e, 'scoreboard')) this.ctx.did.add('scoreboard');
    });
  }

  private advance(): void {
    this.step = Math.min(this.step + 1, LESSONS.length);
    this.ctx.did.clear();
    this.doneAt = undefined;
  }

  onEvents(events: MatchEvent[]): void {
    const shipId = this.ctx.match.players.get(this.ctx.player)!.shipId;
    for (const e of events) if (e.kind === 'cast' && e.casterId === shipId) this.ctx.did.add('cast');
  }

  update(now: number, camera: THREE.Camera, shopOpen: boolean, codexOpen: boolean): void {
    if (codexOpen) this.ctx.did.add('codex');
    const lesson = LESSONS[this.step];
    // A finished lesson shows its tick for a moment before the next one.
    if (lesson && this.doneAt === undefined && lesson.done(this.ctx)) this.doneAt = now;
    if (lesson && this.doneAt !== undefined && now - this.doneAt > 1400) this.advance();
    const current = LESSONS[this.step];
    this.pointer.update(current?.pointShop && !shopOpen && this.doneAt === undefined ? this.shopAnchor : undefined, camera);
    document.body.classList.toggle('tip-learn', !!current?.glowLearn);

    const html = current
      ? `<div class="tutorial-head"><span>新手教程 · 第 ${this.step + 1} / ${LESSONS.length} 课</span><button data-action="exit">退出教程</button></div>
        <h3>${this.doneAt !== undefined ? '✓ ' : ''}${current.title}</h3>
        <p>${current.text()}</p>
        <div class="tutorial-foot"><span class="dots">${LESSONS.map((_, i) => `<i class="${i < this.step ? 'on' : i === this.step ? 'now' : ''}"></i>`).join('')}</span>
          ${this.doneAt === undefined ? '<button data-action="skip">跳过这一步</button>' : '<b>完成！</b>'}</div>`
      : `<div class="tutorial-head"><span>新手教程</span></div>
        <h3>教程完成！</h3>
        <p>你已经学会了基本操作。可以留在这里继续练习，也可以回主菜单开始一局正式对战（有电脑队友和对手）。</p>
        <div class="tutorial-foot"><button data-action="practice">继续练习</button><button class="primary" data-action="exit">返回主菜单</button></div>`;
    if (html !== this.key) { this.key = html; this.root.innerHTML = html; }
    this.root.classList.toggle('show', !this.hidden);
  }
}
