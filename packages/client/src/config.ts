// Match options chosen in the main menu and player settings, both remembered in the browser.
// URL parameters still override the menu for development (?ai=hard, ?solo, ?mode=standard,
// ?side=north, ?play to skip the menu).
import type { Difficulty } from '@boom/ai';
import type { GameMode } from '@boom/sim';

export interface GameConfig {
  mode: GameMode;
  difficulty: Difficulty;
  side: 'south' | 'north';
  /** Computer teammates (0–4) and opponents (0–5). */
  allies: number;
  enemies: number;
}

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  damageNumbers: boolean;
  edgePan: boolean;
  /** Pause the match when the window loses focus or the tab is hidden. */
  autoPause: boolean;
}

const CONFIG_KEY = 'boom.config';
const SETTINGS_KEY = 'boom.settings';

export const DEFAULT_CONFIG: GameConfig = { mode: 'fast', difficulty: 'normal', side: 'south', allies: 4, enemies: 5 };
export const DEFAULT_SETTINGS: Settings = { quality: 'high', damageNumbers: true, edgePan: true, autoPause: true };

function read<T>(key: string, fallback: T): T {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<T> | null;
    return { ...fallback, ...(saved ?? {}) };
  } catch {
    return { ...fallback };
  }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}

export function loadConfig(): GameConfig {
  const config = read(CONFIG_KEY, DEFAULT_CONFIG);
  const params = new URLSearchParams(location.search);
  const ai = params.get('ai');
  if (ai === 'easy' || ai === 'normal' || ai === 'hard') config.difficulty = ai;
  if (['standard', 'fast', 'traders'].includes(params.get('mode') ?? '')) config.mode = params.get('mode') as GameMode;
  if (params.get('side') === 'north' || params.get('side') === 'south') config.side = params.get('side') as 'south' | 'north';
  if (params.has('solo')) { config.allies = 0; config.enemies = 0; }
  return config;
}

export function saveConfig(config: GameConfig): void {
  write(CONFIG_KEY, config);
}

export function loadSettings(): Settings {
  return read(SETTINGS_KEY, DEFAULT_SETTINGS);
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

/** The local player's slot and every slot in the match, from the chosen side and bot counts. */
export function matchSlots(config: GameConfig): { player: number; slots: number[] } {
  const south = [2, 3, 4, 5, 6], north = [7, 8, 9, 10, 11];
  const [own, other] = config.side === 'south' ? [south, north] : [north, south];
  const player = own[0]!;
  return { player, slots: [player, ...own.slice(1, 1 + config.allies), ...other.slice(0, config.enemies)] };
}

/** A shared counter the loaders report into, for the progress bar. */
export class Progress {
  done = 0;
  total = 0;
  onChange: (() => void) | undefined;

  add(n: number): void { this.total += n; this.onChange?.(); }
  tick(): void { this.done++; this.onChange?.(); }
  get fraction(): number { return this.total ? this.done / this.total : 0; }
}
