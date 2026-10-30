// Rebindable keys, one per action, saved in the browser. Skill slots default to the map's own
// letters (each ship's skills bring theirs, shown on the icons); a key set for a slot takes that
// slot over, whatever skill sits there. Escape (cancel), the arrow keys (camera) and Alt+Enter
// (fullscreen) stay fixed.

export type KeyAction =
  | 'focus' | 'deselect' | 'scoreboard' | 'codex' | 'pause' | 'settings' | 'slower' | 'faster'
  | `item${1 | 2 | 3 | 4 | 5 | 6}` | `skill${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

export interface KeyDef { action: KeyAction; label: string; group: string; key: string }

const STORAGE_KEY = 'boom.keys';
export const SKILL_SLOTS = 8;

export const KEY_DEFS: KeyDef[] = [
  { action: 'focus', label: '镜头回到船只', group: '镜头与界面', key: ' ' },
  { action: 'deselect', label: '回到指挥面板', group: '镜头与界面', key: 'F1' },
  { action: 'scoreboard', label: '查看战况（按住）', group: '镜头与界面', key: 'Tab' },
  { action: 'codex', label: '图鉴', group: '镜头与界面', key: 'F2' },
  { action: 'settings', label: '设置', group: '镜头与界面', key: 'F10' },
  { action: 'pause', label: '暂停 / 继续', group: '游戏', key: 'p' },
  { action: 'slower', label: '减慢游戏速度', group: '游戏', key: '-' },
  { action: 'faster', label: '加快游戏速度', group: '游戏', key: '=' },
  ...([1, 2, 3, 4, 5, 6] as const).map((n): KeyDef => ({ action: `item${n}`, label: `物品栏 ${n}`, group: '物品', key: String(n) })),
  ...([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n): KeyDef => ({ action: `skill${n}`, label: `第 ${n} 个技能`, group: '技能（留空用技能图标上的原版字母）', key: '' })),
];

/** Keys nobody may take: cancel, the camera, modifiers. */
const RESERVED = new Set(['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Enter']);

let custom: Partial<Record<KeyAction, string>> = {};
try { custom = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as typeof custom; } catch { /* storage blocked */ }

function store(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)); } catch { /* storage blocked */ }
}

/** A keyboard event's key as bindings store it: letters lower-case, everything else as named. */
export function keyFrom(e: KeyboardEvent): string {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

/** The key bound to an action ('' when none: for a skill slot, the skill's own letter applies). */
export function keyOf(action: KeyAction): string {
  return custom[action] ?? KEY_DEFS.find((d) => d.action === action)!.key;
}

/** Whether this event is the action's key (modifier combinations are left to the browser). */
export function pressed(e: KeyboardEvent, action: KeyAction): boolean {
  const key = keyOf(action);
  return key !== '' && !e.ctrlKey && !e.metaKey && !e.altKey && keyFrom(e) === key;
}

/** How a key reads on screen. */
export function keyName(key: string): string {
  if (key === '') return '';
  if (key === ' ') return '空格';
  return key.length === 1 ? key.toUpperCase() : key;
}

export function canBind(key: string): boolean {
  return !RESERVED.has(key);
}

/**
 * Binds `key` to `action` ('' clears it). An action that had the key gets this action's old key
 * instead, so nothing silently ends up with two meanings.
 */
export function bind(action: KeyAction, key: string): void {
  const old = keyOf(action);
  if (key !== '') for (const d of KEY_DEFS) if (d.action !== action && keyOf(d.action) === key) custom[d.action] = old;
  custom[action] = key;
  for (const d of KEY_DEFS) if (custom[d.action] === d.key) delete custom[d.action];
  store();
}

export function resetKeys(): void {
  custom = {};
  store();
}
