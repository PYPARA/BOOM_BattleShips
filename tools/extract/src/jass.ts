// Static analysis of war3map.j: player setup, rects, preplaced units and a trigger index.
// This does not execute JASS; it reads the regular shapes the World Editor (and YDWE) emit.
import type { MapInfo, Placement, PlayerSlot, Rect, TriggerInfo } from '@boom/gamedata';
import { intToRawcode } from './text.ts';

interface JassFunction { name: string; body: string; startLine: number; endLine: number }

const NUM = String.raw`(-?[\d.]+)`;

export function parseFunctions(script: string): JassFunction[] {
  const functions: JassFunction[] = [];
  const lines = script.split('\n');
  let current: JassFunction | undefined;
  const body: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    const start = /^(?:constant\s+)?function\s+(\w+)\s+takes/.exec(line);
    if (start) { current = { name: start[1]!, body: '', startLine: i + 1, endLine: i + 1 }; body.length = 0; continue; }
    if (current && line.startsWith('endfunction')) {
      current.body = body.join('\n');
      current.endLine = i + 1;
      functions.push(current);
      current = undefined;
      continue;
    }
    if (current) body.push(line);
  }
  return functions;
}

/** Rawcode for a JASS integer literal: $68303049, 'h00I' or a plain decimal. */
function literalToRawcode(lit: string): string | undefined {
  if (lit.startsWith("'")) return lit.slice(1, -1);
  const n = lit.startsWith('$') ? parseInt(lit.slice(1), 16) : Number(lit);
  const code = intToRawcode(n);
  return code && /^[A-Za-z][0-9A-Za-z]{3}$/.test(code) ? code : undefined;
}

const RAWCODE_LITERAL = /\$[0-9A-Fa-f]{8}|'[0-9A-Za-z]{4}'/g;

export function collectRawcodes(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(RAWCODE_LITERAL)) {
    const code = literalToRawcode(m[0]);
    if (code) found.add(code);
  }
  return [...found].sort();
}

export function parseMapInfo(script: string, functions: JassFunction[], version: string): MapInfo {
  const rects: Rect[] = [];
  for (const m of script.matchAll(new RegExp(String.raw`set gg_rct_(\w+)=Rect\(${NUM},${NUM},${NUM},${NUM}\)`, 'g'))) {
    rects.push({ name: m[1]!, minX: +m[2]!, minY: +m[3]!, maxX: +m[4]!, maxY: +m[5]! });
  }

  const placements: Placement[] = [];
  for (const fn of functions) {
    if (!/^Create(Buildings|Units)For|^CreateNeutral/.test(fn.name)) continue;
    let player = -1;
    for (const line of fn.body.split('\n')) {
      const p = /(?:local player p|set p)=Player\((\w+)\)/.exec(line);
      if (p) player = p[1] === 'PLAYER_NEUTRAL_AGGRESSIVE' ? -1 : p[1] === 'PLAYER_NEUTRAL_PASSIVE' ? -2 : Number(p[1]);
      const u = new RegExp(String.raw`(?:set (gg_unit_\w+)=)?CreateUnit\(p,(\$[0-9A-Fa-f]{8}|'\w{4}'|\d+),${NUM},${NUM},${NUM}\)`).exec(line);
      if (!u) continue;
      const id = literalToRawcode(u[2]!);
      if (!id) continue;
      placements.push({ id, player, x: +u[3]!, y: +u[4]!, facing: +u[5]!, handle: u[1] });
    }
  }

  const players = new Map<number, PlayerSlot>();
  const slot = (i: number) => {
    let s = players.get(i);
    if (!s) players.set(i, (s = { index: i, name: '', controller: 'user', team: 0 }));
    return s;
  };
  for (const m of script.matchAll(/SetPlayerController\(Player\((\d+)\),MAP_CONTROL_(\w+)\)/g)) slot(+m[1]!).controller = m[2]!.toLowerCase();
  for (const m of script.matchAll(/SetPlayerTeam\(Player\((\d+)\),(\d+)\)/g)) slot(+m[1]!).team = +m[2]!;
  for (const m of script.matchAll(new RegExp(String.raw`DefineStartLocation\((\d+),${NUM},${NUM}\)`, 'g'))) {
    Object.assign(slot(+m[1]!), { startX: +m[2]!, startY: +m[3]! });
  }
  for (const s of players.values()) {
    const side = (s.startY ?? 0) < 0 ? '南方' : '北方';
    s.name = s.controller === 'computer' ? `${side}舰队（电脑）` : `${side}玩家`;
  }

  const cam = new RegExp(String.raw`SetCameraBounds\(${NUM}\+GetCameraMargin\(CAMERA_MARGIN_LEFT\),${NUM}\+GetCameraMargin\(CAMERA_MARGIN_BOTTOM\),${NUM}-GetCameraMargin\(CAMERA_MARGIN_RIGHT\),${NUM}-`).exec(script);
  return {
    version,
    bounds: cam ? { minX: +cam[1]!, minY: +cam[2]!, maxX: +cam[3]!, maxY: +cam[4]! } : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    players: [...players.values()].sort((a, b) => a.index - b.index),
    rects,
    placements,
  };
}

export function parseTriggers(functions: JassFunction[]): TriggerInfo[] {
  const inits = functions.filter((f) => f.name.startsWith('InitTrig_'));
  const names = inits.map((f) => f.name.slice('InitTrig_'.length)).sort((a, b) => b.length - a.length);
  const owned = new Map<string, JassFunction[]>();
  for (const fn of functions) {
    // Trigger functions are named Trig_<Trigger>…; pick the longest trigger name that prefixes it.
    const owner = names.find((n) => fn.name.startsWith(`Trig_${n}`) || fn.name === `InitTrig_${n}`);
    if (owner) owned.set(owner, [...(owned.get(owner) ?? []), fn]);
  }

  return inits.map((init) => {
    const name = init.name.slice('InitTrig_'.length);
    const handle = `gg_trg_${name}`;
    const fns = owned.get(name) ?? [init];
    const events: string[] = [];
    for (const m of init.body.matchAll(new RegExp(String.raw`call (TriggerRegister\w+|YDWE\w*Register\w*)\(${handle},?(.*)\)\s*$`, 'gm'))) {
      events.push(`${m[1]}(${annotateRawcodes(m[2]!)})`);
    }
    const conditionFunctions = [...init.body.matchAll(/TriggerAddCondition\([^)]*function (\w+)/g)].map((m) => m[1]!);
    const actionFunctions = [...init.body.matchAll(/TriggerAddAction\([^,]*,function (\w+)/g)].map((m) => m[1]!);
    const all = fns.map((f) => f.body).join('\n');
    const abilities = new Set<string>();
    for (const m of all.matchAll(/(?:GetSpellAbilityId|GetLearnedSkill)\(\)\s*==\s*(\$[0-9A-Fa-f]{8}|'\w{4}')/g)) {
      const code = literalToRawcode(m[1]!);
      if (code) abilities.add(code);
    }
    return {
      name,
      events,
      conditionFunctions,
      actionFunctions,
      references: collectRawcodes(all),
      abilities: [...abilities].sort(),
      lines: [Math.min(...fns.map((f) => f.startLine)), Math.max(...fns.map((f) => f.endLine))],
      initiallyEnabled: !init.body.includes(`DisableTrigger(${handle})`),
    };
  });
}

function annotateRawcodes(text: string): string {
  return text.replace(RAWCODE_LITERAL, (lit) => {
    const code = literalToRawcode(lit);
    return code ? `'${code}'` : lit;
  });
}

/**
 * A readable copy of the script: rawcodes become 'h00I'/*name*\/ and TRIGSTR references
 * get their text appended as a comment.
 */
export function annotateScript(script: string, names: Map<string, string>, strings: Map<string, string>): string {
  return script
    .replace(RAWCODE_LITERAL, (lit) => {
      const code = literalToRawcode(lit);
      if (!code) return lit;
      const name = names.get(code);
      return name ? `'${code}'/*${name.replaceAll('*/', '')}*/` : `'${code}'`;
    })
    .replace(/"TRIGSTR_(\d+)"/g, (m, n: string) => {
      const text = strings.get(String(Number(n)));
      return text ? `${m}/*${text.replace(/\s+/g, ' ').replaceAll('*/', '').slice(0, 120)}*/` : m;
    });
}

/** war3map.wts: `STRING n { text }` blocks. */
export function parseWts(text: string): Map<string, string> {
  const strings = new Map<string, string>();
  for (const m of text.replace(/^﻿/, '').matchAll(/STRING (\d+)\s*(?:\/\/[^\n]*\n\s*)?\{\r?\n([\s\S]*?)\r?\n\}/g)) {
    strings.set(String(Number(m[1])), m[2]!);
  }
  return strings;
}
