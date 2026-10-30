// Save and resume. The simulation and the computer players are deterministic from the seed, so a
// match is saved as its options, its seed and every command the local player gave (with the tick
// it was given on); resuming replays them headless behind the loading screen. A fingerprint of the
// state at save time tells whether the replay reached the same match (it would not after a game
// update changed the rules or data).
import type { Bot } from '@boom/ai';
import { TICK_RATE, type Command, type Match, type MatchCommand, type MatchEvent } from '@boom/sim';
import type { GameConfig } from './config.ts';

const SAVE_KEY = 'boom.save';
const VERSION = 1;

/** A command and the tick it was issued before: `m` the match queue, `w` the world queue. */
type Entry = [tick: number, queue: 'm', command: MatchCommand] | [tick: number, queue: 'w', command: Command];

export interface SavedMatch {
  v: number;
  config: GameConfig;
  seed: number;
  /** `?gold=` while developing. */
  gold?: number;
  tick: number;
  log: Entry[];
  check: string;
  /** The tutorial's step, when the match is the tutorial. */
  tutorialStep?: number;
  savedAt: number;
}

export function loadSave(): SavedMatch | undefined {
  try {
    const save = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as SavedMatch | null;
    return save?.v === VERSION && save.tick > 0 ? save : undefined;
  } catch {
    return undefined;
  }
}

export function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ }
}

/** What a save looks like in the menu: mode, side and match time. */
export function describeSave(save: SavedMatch): string {
  const mode = save.config.tutorial ? '新手教程' : { fast: '快速战斗', standard: '联赛标准', traders: '商船任务' }[save.config.mode];
  const s = Math.floor(save.tick / TICK_RATE);
  return `${mode} · ${save.config.side === 'south' ? '南方' : '北方'} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The state the fingerprint covers: every player's standing and every unit's hull, rounded. */
function fingerprint(match: Match): string {
  let h = 2166136261;
  const mix = (n: number) => { h = Math.imul(h ^ (Math.round(n) | 0), 16777619); };
  mix(match.world.tick);
  for (const p of match.players.values()) { mix(p.gold); mix(p.hero.xp); mix(p.kills); mix(p.deaths); mix(p.items.length); }
  for (const u of match.world.allUnits()) { mix(u.id); mix(u.hp); mix(u.x); mix(u.y); }
  return (h >>> 0).toString(36);
}

/** Records the local player's commands and writes the save. */
export class Recorder {
  private readonly match: Match;
  private readonly config: GameConfig;
  private readonly seed: number;
  private readonly gold: number | undefined;
  private log: Entry[] = [];
  /** Off while the computer players think (their commands come back by themselves on replay). */
  recording = true;
  /** Set to keep the tutorial's place in the save. */
  tutorialStep: (() => number) | undefined;
  private done = false;

  constructor(match: Match, config: GameConfig, seed: number, gold?: number) {
    this.match = match;
    this.config = config;
    this.seed = seed;
    this.gold = gold;
    const matchIssue = match.issue.bind(match), worldIssue = match.world.issue.bind(match.world);
    match.issue = (c) => { if (this.recording) this.log.push([match.world.tick, 'm', structuredClone(c)]); matchIssue(c); };
    match.world.issue = (c) => { if (this.recording) this.log.push([match.world.tick, 'w', structuredClone(c)]); worldIssue(c); };
  }

  /** Continues a replayed save's log. */
  resume(save: SavedMatch): void {
    this.log = save.log;
  }

  save(): void {
    if (this.done || this.match.world.tick === 0) return;
    const save: SavedMatch = {
      v: VERSION, config: this.config, seed: this.seed, gold: this.gold, tick: this.match.world.tick, log: this.log,
      check: fingerprint(this.match), tutorialStep: this.tutorialStep?.(), savedAt: Date.now(),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* storage full or blocked */ }
  }

  /** The match is decided (or left for a new one): nothing to resume. */
  finish(): void {
    this.done = true;
    clearSave();
  }
}

/**
 * Plays a saved match forward to its saved tick, the same way the game loop does (the player's
 * commands, then the computer players, then the step), yielding now and then so the loading screen
 * can show progress. Returns whether the result matches the save's fingerprint.
 */
export async function replay(save: SavedMatch, match: Match, bots: Bot[], onEvents: (events: MatchEvent[]) => void, onProgress: (fraction: number) => void): Promise<boolean> {
  let next = 0;
  let sliceStart = performance.now();
  while (match.world.tick < save.tick && !match.winner) {
    const tick = match.world.tick;
    for (; next < save.log.length && save.log[next]![0] <= tick; next++) {
      const [, queue, command] = save.log[next]!;
      if (queue === 'm') match.issue(command as MatchCommand); else match.world.issue(command as Command);
    }
    for (const bot of bots) bot.update();
    match.step();
    onEvents(match.events);
    if (performance.now() - sliceStart > 40) {
      onProgress(match.world.tick / save.tick);
      await new Promise((r) => setTimeout(r));
      sliceStart = performance.now();
    }
  }
  onProgress(1);
  return fingerprint(match) === save.check;
}
