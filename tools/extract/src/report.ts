// Writes docs/mechanics/ship-skills.md: every purchasable ship with its skills and
// per-level numbers, generated from the extracted data so it never drifts from it.
import type { Ability, AbilityLevel, Ship, Unit } from '@boom/gamedata';

/** Built-in Warcraft III abilities the ship skills are copied from. */
const BASE_ABILITIES: Record<string, string> = {
  ACbf: '火焰呼吸', AEbl: '闪烁', AEer: '纠缠根须', AEfk: '刀阵旋风', AEim: '献祭', AEsf: '星辰坠落',
  AEsh: '暗影突袭', AEtq: '宁静', AHbz: '暴风雪', AHdr: '生命/法力汲取', AHds: '神圣护盾', AHfs: '烈焰风暴',
  AHtb: '风暴之锤', AHtc: '雷霆一击', AHwe: '召唤水元素', AIil: '幻象（物品）', AIvi: '隐形（物品）',
  ANch: '魅惑', ANcl: '通魔（自定义技能的空壳）', ANcs: '集束火箭', ANfl: '叉状闪电', ANhs: '治疗喷雾',
  ANms: '法力护盾', ANpa: '寄生', ANrf: '火焰雨', ANsi: '沉默', ANso: '灵魂燃烧', ANto: '龙卷风',
  ANvc: '火山爆发', AOae: '耐久光环', AOcl: '闪电链', AOcr: '致命一击', AOmi: '镜像', AOsf: '野性之魂',
  AOsh: '震荡波', AOvd: '巫毒狂舞', AOws: '战争践踏', AUls: '蝗虫群', Aakb: '战鼓', Aamk: '属性加成',
  Aams: '反魔法外壳', Aapl: '疾病云雾', Absk: '狂暴', Adet: '侦测', Aens: '诱捕', Afae: '精灵之火',
  Aivs: '隐形', Amls: '空中枷锁', Aply: '变形术', Aprg: '净化', Arej: '回春术', Arpm: '补充法力',
  Auco: '不稳定化合物', Apxf: '凤凰火焰',
};

const fmt = (n: number | undefined) => (n === undefined ? '' : String(Math.round(n * 100) / 100));

function levelSummary(l: AbilityLevel): string {
  const parts: string[] = [];
  if (l.cooldown) parts.push(`冷却 ${fmt(l.cooldown)}s`);
  if (l.cost) parts.push(`消耗 ${fmt(l.cost)}`);
  if (l.range) parts.push(`施法距离 ${fmt(l.range)}`);
  if (l.area) parts.push(`范围 ${fmt(l.area)}`);
  if (l.duration) parts.push(`持续 ${fmt(l.duration)}s`);
  if (l.heroDuration && l.heroDuration !== l.duration) parts.push(`对英雄 ${fmt(l.heroDuration)}s`);
  const data = Object.entries(l.data).filter(([, v]) => v !== 0 && v !== '' && v !== '0');
  if (data.length) parts.push(data.map(([k, v]) => `${k}=${v}`).join(' '));
  if (l.units.length) parts.push(`召唤 ${l.units.join(',')}`);
  return parts.join('，') || '—';
}

function skillSection(a: Ability): string {
  const base = BASE_ABILITIES[a.baseCode];
  const lines = [
    `#### ${a.name.replace(/^[!~_@]+/, '')}（\`${a.id}\`）`,
    '',
    `- 原型：\`${a.baseCode}\`${base ? ` ${base}` : ''}；${a.levels.length} 级${a.requiredLevel ? `，${a.requiredLevel} 级起可学` : ''}${a.levelSkip ? `，每 ${a.levelSkip} 级可升一次` : ''}`,
  ];
  if (a.triggers.length) lines.push(`- 相关触发器：${a.triggers.map((t) => `\`${t}\``).join('、')}`);
  const tooltip = a.levels[0]?.description.split('\n').filter(Boolean).join(' / ');
  if (tooltip) lines.push(`- 说明（1 级）：${tooltip}`);
  lines.push('', '| 等级 | 数值 |', '|---|---|');
  for (const l of a.levels) lines.push(`| ${l.level} | ${levelSummary(l)} |`);
  return lines.join('\n');
}

export function shipSkillsReport(ships: Ship[], units: Unit[], abilities: Ability[], version: string): string {
  const byId = new Map(abilities.map((a) => [a.id, a]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const shared = new Set(['AOae', 'Aamk']);
  const out = [
    '# 船只与技能数据',
    '',
    `> 由 \`pnpm extract\` 从 ${version} 自动生成，请勿手改。`,
    '> 数值来自地图的 AbilityData.slk（1–4 级）和 war3map.w3a（5 级以上）；DataA–DataI 的含义取决于原型技能。',
    '> 名字前的 `!`、`~` 等符号是原作者的标记，通常表示该技能有脚本参与。',
    '',
    '所有船共有的两项升级：**改良船体**（`Aamk` 属性加成：每级 +1 力量 = +50 耐久、+0.5 回复）和 **改良船帆**（`AOae` 耐久光环：提高航速）。下文每艘船只列出自己的技能。',
    '',
    '| 船 | 船型 | 尺寸 | 价格 | 耐久 | 装甲 | 航速 | 回复/秒 | 转向 | 购买地点 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...ships.map((s) => `| ${s.name} \`${s.id}\` | ${s.hullClass} | ${s.size} | ${s.price} | ${s.hp} | ${Math.round(s.armor)} | ${s.speed / 10} 节 | ${s.regenHp} | ${s.turnRate} | ${s.soldAt.map((id) => unitById.get(id)?.name.replace(/\|c[0-9a-fA-F]{8}|\|r/g, '') ?? id).join('、')} |`),
    '',
  ];
  for (const s of ships) {
    out.push(`## ${s.name}（${s.hullClass}，\`${s.id}\`）`, '', s.description, '', `推荐武器：${s.recommendedWeapons || '—'}`, '');
    for (const id of s.skills) {
      const a = byId.get(id);
      if (!a) { out.push(`#### 未找到技能 \`${id}\``, ''); continue; }
      if (shared.has(a.baseCode) && /改良/.test(a.name)) continue;
      out.push(skillSection(a), '');
    }
  }
  return out.join('\n');
}
