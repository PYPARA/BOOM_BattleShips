// Settings panel: graphics quality, sound volumes, damage numbers and edge panning. Opens from
// the menu, the gear button or F10; in a match it pauses the game and offers to go back to the
// main menu.
import type { AudioEngine, AudioSettings } from './audio.ts';
import { saveSettings, type Quality, type Settings } from './config.ts';

const QUALITY: [Quality, string, string][] = [
  ['low', '低', '无阴影，降低渲染分辨率'],
  ['medium', '中', '阴影，标准分辨率'],
  ['high', '高', '高清阴影，高分屏全分辨率'],
];

export class SettingsPanel {
  private readonly root: HTMLElement;
  private readonly settings: Settings;
  private readonly audio: AudioEngine;
  private readonly startQuality: Quality;
  /** True while open during a match (the game pauses). */
  paused = false;
  private inMatch = false;
  onChange: ((s: Settings) => void) | undefined;

  constructor(settings: Settings, audio: AudioEngine) {
    this.settings = settings;
    this.audio = audio;
    this.startQuality = settings.quality;
    this.root = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'settings' });
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const key = input.dataset.audio as keyof AudioSettings | undefined;
      if (!key) return;
      if (key === 'muted') this.audio.settings.muted = input.checked;
      else this.audio.settings[key] = Number(input.value);
      this.audio.applySettings();
    });
    // Keys typed here are not skill hotkeys.
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F10') { e.preventDefault(); this.toggle(); }
      else if (e.key === 'Escape' && this.root.classList.contains('show')) { e.stopImmediatePropagation(); this.close(); }
    }, { capture: true });
  }

  /** From now on the panel pauses the match and offers to leave it. */
  enterMatch(): void {
    this.inMatch = true;
    const gear = Object.assign(document.body.appendChild(document.createElement('button')), { className: 'gear', title: '设置 (F10)', textContent: '⚙' });
    gear.addEventListener('click', () => this.toggle());
  }

  toggle(): void {
    if (this.root.classList.contains('show')) this.close(); else this.open();
  }

  open(): void {
    this.render();
    this.root.classList.add('show');
    this.paused = this.inMatch;
  }

  close(): void {
    this.root.classList.remove('show');
    this.paused = false;
  }

  private render(): void {
    const s = this.settings, a = this.audio.settings;
    const toggle = (key: 'damageNumbers' | 'edgePan', label: string) =>
      `<label class="check"><input type="checkbox" data-toggle="${key}" ${s[key] ? 'checked' : ''}>${label}</label>`;
    this.root.innerHTML = `<div class="settings-card">
      <h2>${this.inMatch ? '游戏已暂停' : '设置'}</h2>
      <section><h3>画面</h3>
        <div class="seg">${QUALITY.map(([q, label, tip]) => `<button data-quality="${q}" class="${s.quality === q ? 'on' : ''}" title="${tip}">${label}</button>`).join('')}</div>
        <p class="hint">${QUALITY.find(([q]) => q === s.quality)![2]}${this.inMatch && s.quality !== this.startQuality ? ' · 下一局生效' : ''}</p>
      </section>
      <section><h3>声音</h3>
        <label>音效<input type="range" min="0" max="1" step="0.05" data-audio="sfx" value="${a.sfx}"></label>
        <label>音乐<input type="range" min="0" max="1" step="0.05" data-audio="music" value="${a.music}"></label>
        <label class="check"><input type="checkbox" data-audio="muted" ${a.muted ? 'checked' : ''}>静音</label>
      </section>
      <section><h3>游戏</h3>
        ${toggle('damageNumbers', '显示伤害数字')}
        ${toggle('edgePan', '鼠标移到屏幕边缘时平移镜头')}
      </section>
      <div class="settings-actions">
        <button class="primary" data-action="close">${this.inMatch ? '继续游戏' : '完成'}</button>
        ${this.inMatch ? '<button data-action="menu">返回主菜单</button>' : ''}
      </div>
    </div>`;
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    if (t === this.root) return this.close(); // click outside the card
    const b = t.closest('button'), input = t.closest('input');
    if (b?.dataset.quality) { this.settings.quality = b.dataset.quality as Quality; this.commit(); }
    if (input?.dataset.toggle) { this.settings[input.dataset.toggle as 'damageNumbers' | 'edgePan'] = (input as HTMLInputElement).checked; this.commit(); }
    if (b?.dataset.action === 'close') this.close();
    if (b?.dataset.action === 'menu' && confirm('离开当前对局，返回主菜单？')) location.href = location.pathname;
  }

  private commit(): void {
    saveSettings(this.settings);
    this.onChange?.(this.settings);
    this.render();
  }
}
