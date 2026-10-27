// Main menu: mode, difficulty, side and computer players, shown while the game's data and
// models load in the background (progress bar at the bottom). Starting before the load is done
// switches to a loading screen until it is.
import { matchSlots, type GameConfig, type Progress } from './config.ts';

const OPTIONS = {
  mode: [['fast', '快速战斗', '地图默认规则（-m2）：工资高、经验 1.5 倍、一方全灭时开放西侧航道；没有商船和潜水艇'], ['standard', '联赛标准', '联赛规则（-m1）：工资 60、西侧航道常开；没有商船和潜水艇'], ['traders', '商船任务', '完整模式（-m3）：工资 60、有商船贸易和地图任务、潜艇工厂，队友间可以互相给钱']],
  difficulty: [['easy', '简单', '电脑反应慢，常常恋战'], ['normal', '普通', '会推线、撤退、放技能'], ['hard', '困难', '思考更快，残血及时撤退，技能用得更勤']],
  side: [['south', '南方', '蓝色舰队，从地图下方出发'], ['north', '北方', '红色舰队，从地图上方出发']],
} as const;

const HELP = `左键选择 · 右键航行 · 方向键 / 屏幕边缘 / 中键拖动平移 · 滚轮缩放
技能快捷键见技能图标 · 1–6 使用物品 · 按住 Tab 查看战况 · 空格回到船只 · F10 设置
在母港附近打开商店：买船、买武器装备；击沉敌船和舰队赚钱升级，摧毁敌方主基地获胜`;

export class MainMenu {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly label: HTMLElement;
  private readonly progress: Progress;
  /** Opens the settings panel (set by main once it exists). */
  onSettings: (() => void) | undefined;

  constructor(progress: Progress) {
    this.progress = progress;
    this.root = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'menu' });
    const ships = ['H008', 'H016', 'H00C', 'H019', 'H00V', 'H005', 'H015', 'H01N', 'H009'];
    this.root.innerHTML = `
      <div class="menu-ships">${ships.map((id) => `<i style="background-image:url(${import.meta.env.BASE_URL}icons/ship/${id}.jpg)"></i>`).join('')}</div>
      <div class="menu-card">
        <i class="menu-compass"></i>
        <h1><img src="${import.meta.env.BASE_URL}ui/logo.webp" alt=""><span>BOOM 海战<small>7.876 · 网页重制版</small></span></h1>
        <div class="menu-body"></div>
        <i class="divider"></i>
        <div class="menu-actions">
          <button class="primary" data-action="start">开始游戏</button>
          <button data-action="settings">设置</button>
          <button data-action="help">操作说明</button>
        </div>
        <p class="menu-help">${HELP.replace(/\n/g, '<br>')}</p>
      </div>
      <div class="menu-loading"><div class="menu-bar"><i></i></div><span></span></div>`;
    this.bar = this.root.querySelector('.menu-bar i')!;
    this.label = this.root.querySelector('.menu-loading span')!;
    progress.onChange = () => this.renderProgress();
    this.renderProgress();
  }

  private renderProgress(): void {
    const pct = Math.round(this.progress.fraction * 100);
    this.bar.style.width = `${pct}%`;
    this.label.textContent = pct >= 100 ? '资源已就绪' : `正在加载资源 ${pct}%`;
  }

  /** Shows the options and resolves with the player's choice when they press start. */
  choose(initial: GameConfig): Promise<GameConfig> {
    const config = { ...initial };
    const body = this.root.querySelector('.menu-body')!;
    const render = () => {
      const group = (key: keyof typeof OPTIONS, title: string) => `
        <div class="menu-row"><span>${title}</span><div class="seg">${OPTIONS[key].map(([value, label, tip]) =>
          `<button data-key="${key}" data-value="${value}" class="${config[key] === value ? 'on' : ''}" title="${tip}">${label}</button>`).join('')}</div></div>`;
      const count = (key: 'allies' | 'enemies', title: string, max: number) => `
        <div class="menu-row"><span>${title}</span><div class="seg">${Array.from({ length: max + 1 }, (_, n) =>
          `<button data-key="${key}" data-value="${n}" class="${config[key] === n ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
      const { slots } = matchSlots(config);
      const desc = [OPTIONS.mode, OPTIONS.difficulty].map((o, i) => o.find(([v]) => v === [config.mode, config.difficulty][i])![2]).join('；');
      body.innerHTML = group('mode', '模式') + group('difficulty', '难度') + group('side', '阵营')
        + count('allies', '电脑队友', 4) + count('enemies', '电脑对手', 5)
        + `<p class="menu-note">${slots.length === 1 ? '单人练习：只有你和双方 NPC 舰队' : `${1 + config.allies} 对 ${config.enemies}`} · ${desc}</p>`;
    };
    render();
    return new Promise((resolve) => {
      this.root.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        if (b.dataset.key) {
          const key = b.dataset.key as keyof GameConfig;
          (config as Record<string, unknown>)[key] = key === 'allies' || key === 'enemies' ? Number(b.dataset.value) : b.dataset.value;
          render();
        } else if (b.dataset.action === 'start') {
          resolve(config);
        } else if (b.dataset.action === 'settings') {
          this.onSettings?.();
        } else if (b.dataset.action === 'help') {
          this.root.classList.toggle('show-help');
        }
      });
    });
  }

  /** After start: a loading screen until `ready` settles, then the menu goes away. */
  async finish(ready: Promise<unknown>): Promise<void> {
    this.root.classList.add('loading');
    await ready;
    this.root.classList.add('leaving');
    setTimeout(() => this.root.remove(), 400);
  }
}
