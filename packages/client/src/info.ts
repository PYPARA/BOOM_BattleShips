// Tooltip content for ships, weapons, items, skills and live units, built from the game data.
// Everything returns HTML for the shared tooltip (tooltip.ts).
import type { Ability, Item, Ship, Unit, Weapon } from '@boom/gamedata';
import { BOSSES, canLearn, CREEP_OWNER, strongest, TICK_RATE, type Match, type UnitEntity } from '@boom/sim';

export const clean = (s: string | undefined) => (s ?? '').replace(/\|c[0-9a-fA-F]{8}|\|r/g, '').replace(/\|n/g, '\n').replace(/^[.!~_@]+/, '').trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (s: string | undefined) => `<p class="tip-text">${esc(clean(s))}</p>`;
const row = (label: string, value: string | number, cls = '') => `<div class="tip-row"><span>${label}</span><b class="${cls}">${value}</b></div>`;
const head = (name: string, sub = '', price?: number) =>
  `<div class="tip-head"><strong>${esc(clean(name))}</strong>${price !== undefined ? `<span class="gold">${price}</span>` : ''}</div>${sub ? `<div class="tip-sub">${sub}</div>` : ''}`;
const fixed = (n: number, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString();

/** "船只 / 建筑 / 潜水艇" from a Warcraft target list. */
function targetsLabel(targets: string[]): string {
  const out: string[] = [];
  if (targets.includes('ground') || targets.includes('air')) out.push('船只');
  if (targets.includes('structure')) out.push('建筑');
  if (targets.includes('ward')) out.push('潜水艇 / 水雷');
  return out.join('、') || '—';
}

export interface InfoData {
  ships: Map<string, Ship>;
  units: Map<string, Unit>;
  items: Map<string, Item>;
  weapons: Map<string, Weapon>;
}

export class Info {
  private readonly match: Match;
  private readonly player: number;
  private readonly data: InfoData;

  constructor(match: Match, player: number, data: InfoData) {
    this.match = match;
    this.player = player;
    this.data = data;
  }

  private get state() { return this.match.players.get(this.player)!; }

  /** A purchasable ship type, compared with the one the player sails now. */
  ship(id: string): string {
    const s = this.data.ships.get(id);
    const u = this.data.units.get(id);
    if (!s) return u ? this.fleetUnit(u) : '';
    const now = this.data.ships.get(this.state.shipTypeId);
    const cmp = (v: number, base: number | undefined, more = true) => (base === undefined || v === base ? '' : (v > base) === more ? 'up' : 'down');
    const skills = s.skills.map((a) => this.match.world.abilities.byId.get(a)).filter((a): a is Ability => !!a);
    return head(s.name, `${s.hullClass} · ${s.size}`, s.price)
      + row('耐久', s.hp, cmp(s.hp, now?.hp))
      + row('护甲', fixed(s.armor), cmp(s.armor, now?.armor))
      + row('航速', s.speed, cmp(s.speed, now?.speed))
      + row('转向', s.turnRate, cmp(s.turnRate, now?.turnRate))
      + row('回复', `${fixed(s.regenHp)}/秒`, cmp(s.regenHp, now?.regenHp))
      + text(s.description)
      + (skills.length ? `<div class="tip-list">技能：${skills.map((a) => esc(clean(a.name))).join('、')}</div>` : '')
      + (s.recommendedWeapons ? `<div class="tip-note">推荐：${esc(clean(s.recommendedWeapons))}</div>` : '')
      + (id === this.state.shipTypeId ? '<div class="tip-note">当前船只</div>' : '');
  }

  /** A fleet ship for hire at the shipyard. */
  private fleetUnit(u: Unit): string {
    const a = u.attacks[0];
    return head(u.name, '雇佣舰：加入己方舰队，沿航道进攻', u.goldCost)
      + row('耐久', u.hp) + row('护甲', fixed(u.armor)) + row('航速', u.speed)
      + (a ? row('攻击', `${a.damageBase + a.dice}–${a.damageBase + a.dice * a.sides} / ${a.cooldown}s`) + row('射程', a.range) : '');
  }

  /** A weapon, with DPS and how it compares to the weakest weapon carried. */
  weapon(w: Weapon): string {
    const shots = Number(/x\s*(\d+)/.exec(w.description)?.[1] ?? 1);
    const dps = (Number(w.damage) * shots) / Math.max(0.1, w.cooldown);
    const carried = this.state.items.map((id) => this.data.weapons.get(id)).filter((x): x is Weapon => !!x && x.id !== w.id);
    const weakest = carried.length ? Math.min(...carried.map((x) => Number(x.damage) / Math.max(0.1, x.cooldown))) : undefined;
    const mode = w.mode === 'auto' ? '自动射击' : w.mode === 'salvo' ? '手动齐射' : '特殊武器';
    return head(w.name, mode, w.price)
      + row('破坏力', shots > 1 ? `${w.damage} × ${shots}` : w.damage)
      + row('射程', w.range)
      + row('间隔', `${w.cooldown} 秒`)
      + row('每秒伤害', fixed(dps), weakest === undefined ? '' : dps > weakest ? 'up' : 'down')
      + row('攻击对象', targetsLabel(w.targets))
      + (weakest !== undefined ? `<div class="tip-note">与身上最弱的武器相比：${dps > weakest ? '更强' : '更弱'}（${fixed(weakest)}/秒）</div>` : '');
  }

  item(id: string, slot?: number): string {
    const w = this.data.weapons.get(id);
    const goods = this.match.world.goods;
    if (w) {
      const manual = goods.manualOnly.has(id) ? '手动齐射：按物品键后点选区域' : w.mode === 'salvo' ? '自动单发；按物品键可手动齐射' : '';
      const special = goods.uniqueGroup.get(id) === '特殊武器' ? '特殊武器：只能携带一件' : '';
      return this.weapon(w) + [manual, special].filter(Boolean).map((t) => `<div class="tip-note">${t}</div>`).join('') + this.sellNote(id, slot);
    }
    const i = this.data.items.get(id);
    if (!i) return '';
    const active = this.match.activeItemAbility(id);
    const instant = goods.purchases.has(id);
    const charges = this.state.hero.charges[id] ?? goods.charges.get(id);
    const kind = instant ? '购买后立即生效，不占物品栏' : active ? (i.perishable ? '消耗品 · 主动使用' : '主动使用') : '被动';
    return head(i.name, `${kind}${charges ? ` · ${slot !== undefined ? '剩余' : ''} ${charges} 次` : ''}`, i.goldCost) + text(i.description) + this.sellNote(id, slot);
  }

  private sellNote(id: string, slot?: number): string {
    if (slot === undefined) return '';
    const back = Math.floor((this.data.items.get(id)?.goldCost ?? this.data.weapons.get(id)?.price ?? 0) * 0.6);
    return `<div class="tip-note">快捷键 ${slot + 1} 使用 · 在商店附近右键卖出（返还 ${back}）</div>`;
  }

  /** A ship skill: the current level, and the next one when it can be learned. */
  skill(a: Ability): string {
    const hero = this.state.hero;
    const bought = !hero.learned[a.id] && !!hero.granted[a.id];
    const level = hero.learned[a.id] || hero.granted[a.id] || 0;
    const passive = this.match.world.abilities.targeting(a.id) === 'passive';
    const now = a.levels[level - 1];
    const next = a.levels[level];
    const wait = Math.max(0, Math.ceil(((hero.readyAt[a.id] ?? 0) - this.match.world.tick) / TICK_RATE));
    const need = (a.requiredLevel ?? 1) + level * (a.levelSkip ?? 2);
    const sub = `${bought ? '购买获得 · ' : ''}${passive ? '被动' : `主动 · 快捷键 ${a.hotkey ?? '—'}`} · 等级 ${level}/${a.levels.length}${wait ? ` · 冷却 ${wait} 秒` : ''}`;
    let html = head(a.name, sub);
    html += levelTable(a, level);
    if (next && !bought) html += `<div class="tip-next">${level ? '下一级' : '学习后'}：等级 ${level + 1}${canLearn(hero, a) ? '' : `（需要船只等级 ${need}）`}</div>`;
    return html;
  }

  /** A unit on the map under the cursor. */
  unit(u: UnitEntity): string {
    const type = this.data.units.get(u.typeId);
    const owner = this.match.players.get(u.owner);
    const own = u.owner === this.player;
    const ally = !own && owner?.team === this.state.team;
    const creep = u.owner === CREEP_OWNER;
    const who = creep ? ((BOSSES as readonly string[]).includes(u.typeId) ? 'Boss' : '野怪') : u.isHero && owner && !u.illusion ? `玩家 ${owner.index - 1}` : u.kind === 'structure' ? '建筑' : '舰队';
    const side = creep ? '中立' : own ? '你' : ally ? '友军' : '敌方';
    const name = this.data.ships.get(u.typeId)?.name ?? type?.properName ?? type?.name ?? u.typeId;
    const level = u.hero?.level ?? type?.level;
    const buffs = [...new Set(u.buffs.map((b) => BUFF_NAMES[b.kind]).filter(Boolean))];
    const speed = u.maxSpeed * (1 + strongest(u, 'haste')) * (1 - strongest(u, 'slow'));
    return head(name, `${side} · ${who}${level ? ` · 等级 ${level}` : ''}${u.illusion ? ' · 幻象' : ''}`)
      + row('耐久', `${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}`)
      + row('护甲', fixed(u.armor - strongest(u, 'armorDown')))
      + (u.kind === 'ship' ? row('航速', Math.round(speed)) : '')
      + (u.weapons.length ? row('武器', u.weapons.length) : '')
      + (u.damageTaken < 1 ? row('船甲减伤', `${Math.round((1 - u.damageTaken) * 100)}%`) : '')
      + (buffs.length ? `<div class="tip-list">状态：${buffs.join('、')}</div>` : '');
  }
}

/** A skill's every level: the shared text and fixed stats once, then a table of the stats that
 * change per level, with the current level's column lit. */
function levelTable(a: Ability, current: number): string {
  const levels = a.levels.map((l) => clean(l.description));
  const stats = levels.map((d) => new Map([...d.matchAll(/^-\s*([^：:\n]+)[：:]\s*(.+)$/gm)].map((m) => [m[1]!.trim(), m[2]!.trim()])));
  const intro = (d: string) => d.split('\n').filter((l) => !l.startsWith('-')).join('\n').trim();
  const labels = [...new Set(stats.flatMap((m) => [...m.keys()]))];
  if (levels.length <= 1 || labels.length === 0) {
    // No stat lines: each level's own text, or the one description.
    if (new Set(levels).size <= 1) return text(levels[0]);
    return levels.map((d, i) => `<p class="tip-text tip-lv${i + 1 === current ? ' on' : ''}"><b>${i + 1} 级</b> ${esc(d)}</p>`).join('');
  }
  const varying = labels.filter((l) => new Set(stats.map((m) => m.get(l))).size > 1);
  const fixedRows = labels.filter((l) => !varying.includes(l)).map((l) => row(l, esc(stats[0]!.get(l) ?? '—'))).join('');
  const cell = (v: string | undefined, i: number) => `<td${i + 1 === current ? ' class="on"' : ''}>${esc((v ?? '—').replace(/\s*秒$/, 's'))}</td>`;
  const table = varying.length ? `<table class="tip-levels"><tr><th></th>${levels.map((_, i) => `<th${i + 1 === current ? ' class="on"' : ''}>${i + 1}</th>`).join('')}</tr>
    ${varying.map((l) => `<tr><th>${esc(l)}</th>${stats.map((m, i) => cell(m.get(l), i)).join('')}</tr>`).join('')}</table>` : '';
  return text(intro(levels[Math.max(0, current - 1)]!)) + fixedRows + table;
}

const BUFF_NAMES: Partial<Record<string, string>> = {
  stun: '失控', root: '定身', silence: '沉默', slow: '减速', haste: '加速', invulnerable: '无敌', dot: '持续伤害',
  hot: '回复中', damageBonus: '战鼓', spied: '被间谍标记', invisible: '隐形', armorDown: '破甲', disarm: '变异',
  armorUp: '护甲光环', miss: '诅咒（攻击常落空）',
};
