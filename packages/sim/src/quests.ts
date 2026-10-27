// Trade contracts and map quests of the 商船任务 mode (-m3), from war3map.j: Buying_Mission_Item,
// Barrel_of_Ale … South_Rewards, Bomb_*, Repair_Mission, Gold1–3, Nuli_*, YaPian1–3, FaShi*,
// dfzs, HaiDao_*, x_1/x_2 and Mission_333. A contract is an item; sailing to a spot with the
// right items picks up cargo or delivers it. Match runs the steps and their effects.

/** The merchant ship (巴拿马): the only hull that can carry trade cargo. */
export const MERCHANT = 'H00D';
/** 圣战者: the hull for the suicide attack. */
const JIHADI = 'H001';

/**
 * How close to a quest spot a ship must come. The spots are the map's trigger rects, mostly on
 * the shore by a building, where Warcraft ships could nose in further than ours.
 */
export const QUEST_REACH = 380;

/**
 * Reputation (声望, the map's lumber) each contract needs: its lumber price in the item data,
 * refunded on purchase by Buying_Mission_Item except 2 points for the slave contract. Some
 * contracts come with their cargo.
 */
export const CONTRACTS: Record<string, { rep: number; cost?: number; gives?: string }> = {
  I00K: { rep: 0 }, I00S: { rep: 4 }, I00W: { rep: 10 }, I00M: { rep: 10 }, I00U: { rep: 25 }, I00Q: { rep: 25 },
  I013: { rep: 50 }, I012: { rep: 50 }, I01Z: { rep: 80 }, I02E: { rep: 80 }, I01I: { rep: 8 }, I01E: { rep: 10 },
  I02R: { rep: 30 }, I01U: { rep: 60, gives: 'I003' }, I02P: { rep: 60, gives: 'I02Q' }, I02N: { rep: 30, cost: 2 },
  I02T: { rep: 6 }, I02U: { rep: 6 },
};

/** Cargo and quest tokens: worthless to a shop, and not counted as gear. */
export const QUEST_ITEMS = new Set([
  ...Object.keys(CONTRACTS),
  'I00J', 'I003', 'I00V', 'I00N', 'I00R', 'I00T', 'I014', 'I015', 'I01F', 'I01G', 'I01J', 'I024', 'I02B', 'I02L', 'I02F', 'I02G',
  'I02S', 'I021', 'I022', 'I02M', 'I02K', 'I02O', 'I02H', 'I02D', 'I02Q',
]);

/** The repairman (小精灵修理工) restores this much to a building over REPAIRMAN_SECONDS. */
export const REPAIRMAN = { item: 'I01J', hp: 2500, seconds: 20, reward: [700, 300, 3] as Reward };

type Side = 'south' | 'north';
/** Gold, experience, reputation. */
export type Reward = [number, number, number];

export type QuestEffect = 'cruisers' | 'bomb' | 'fakeGold' | 'opium' | 'flag' | 'mageDone';

export interface QuestStep {
  /** A map rect, or the player's own trader (`@reward`), the enemy trader, or the enemy base. */
  at: string;
  ship?: string;
  side?: Side;
  has: string[];
  lacks?: string[];
  /** Cargo needs room: the ship carries fewer than three items (UnitInventoryCount < 3). */
  room?: boolean;
  take?: string[];
  give?: string;
  reward?: Reward;
  effect?: QuestEffect;
  /** Steps of the one-off dark mage chain stop once it is done. */
  mage?: boolean;
  say: string;
}

const M = MERCHANT;
export const STEPS: QuestStep[] = [
  // Cargo pickups.
  { at: 'AleFactory', ship: M, room: true, has: ['I00K'], lacks: ['I00J'], give: 'I00J', say: '装好了一桶啤酒' },
  { at: 'SwedeLumberMill', ship: M, room: true, has: ['I00S'], lacks: ['I003'], give: 'I003', say: '取得了瑞典天然原木' },
  { at: 'PigShop', ship: M, side: 'south', room: true, has: ['I00W'], lacks: ['I00V'], give: 'I00V', say: '向当地人买了一头肥猪' },
  { at: 'PotionShop', ship: M, side: 'north', room: true, has: ['I00M'], lacks: ['I00N'], give: 'I00N', say: '得到一瓶印度神油' },
  { at: 'GhostShip', ship: M, side: 'south', room: true, has: ['I00Q'], lacks: ['I00R'], give: 'I00R', say: '从沉船处捞起一个神秘箱子' },
  { at: 'Book', ship: M, side: 'north', room: true, has: ['I00U'], lacks: ['I00T'], give: 'I00T', say: '从精灵图书馆运出一本书' },
  { at: 'North_Main', ship: M, side: 'south', room: true, has: ['I013'], lacks: ['I014'], give: 'I014', say: '从敌方主基地救出一个俘虏' },
  { at: 'South_Main', ship: M, side: 'north', room: true, has: ['I012'], lacks: ['I015'], give: 'I015', say: '从敌方主基地救出一个俘虏' },
  // Deliveries to the player's own trader; the contract stays for the next run.
  { at: '@reward', ship: M, has: ['I00K', 'I00J'], take: ['I00J'], reward: [400, 80, 1], say: '啤酒交货' },
  { at: '@reward', ship: M, has: ['I00S', 'I003'], take: ['I003'], reward: [600, 130, 2], say: '瑞典天然原木交货' },
  { at: '@reward', ship: M, side: 'south', has: ['I00W', 'I00V'], take: ['I00V'], reward: [1300, 300, 5], say: '肥猪交货' },
  { at: '@reward', ship: M, side: 'north', has: ['I00M', 'I00N'], take: ['I00N'], reward: [1300, 300, 5], say: '印度神油交货' },
  { at: '@reward', ship: M, side: 'south', has: ['I00Q', 'I00R'], take: ['I00R'], reward: [2000, 450, 6], say: '神秘箱子交货' },
  { at: '@reward', ship: M, side: 'north', has: ['I00U', 'I00T'], take: ['I00T'], reward: [2000, 450, 6], say: '书籍交货' },
  { at: '@reward', ship: M, side: 'south', has: ['I013', 'I014'], take: ['I014'], reward: [4000, 850, 10], effect: 'cruisers', say: '俘虏获救，联盟得到两艘超级巡洋舰' },
  { at: '@reward', ship: M, side: 'north', has: ['I012', 'I015'], take: ['I015'], reward: [4000, 850, 10], effect: 'cruisers', say: '俘虏获救，联盟得到两艘超级巡洋舰' },
  // 自杀攻击: gunpowder from the elf shop, made into explosives at home, blown up in the enemy base.
  { at: 'GoblinShop', ship: JIHADI, has: ['I01E'], lacks: ['I01F', 'I01G'], give: 'I01F', say: '装满一桶火药' },
  { at: '@reward', ship: JIHADI, has: ['I01E', 'I01F'], take: ['I01F'], give: 'I01G', say: '火药制成了炸药' },
  { at: '@enemyMain', ship: JIHADI, has: ['I01E', 'I01G'], take: ['I01E', 'I01G'], reward: [1500, 800, 5], effect: 'bomb', say: '炸药在敌方主基地引爆，造成 1000 点破坏' },
  // 修理建筑物: fetch a repairman from the elf shop; using him finishes the job (Match).
  { at: 'GoblinShop', has: ['I01I'], lacks: ['I01J'], give: 'I01J', say: '找到一个小精灵修理工，使用他来修理己方建筑' },
  // 假黄金 (north): gold from the mine owner, forged at home, sold to the southern trader.
  { at: '_______Gold', ship: M, room: true, has: ['I01Z'], lacks: ['I024', 'I02B'], give: 'I024', say: '从金矿主那里得到了金块' },
  { at: '@reward', ship: M, has: ['I01Z', 'I024'], lacks: ['I02B'], take: ['I024'], give: 'I02B', say: '金块制成了假黄金' },
  { at: '@enemyReward', ship: M, has: ['I01Z', 'I02B'], take: ['I01Z', 'I02B'], reward: [9000, 1800, 10], effect: 'fakeGold', say: '假黄金卖给了敌方商人' },
  // 鸦片 (south): poppies from the farm, made into opium at home, sold to the northern trader.
  { at: 'PigShop', ship: M, room: true, has: ['I02E'], lacks: ['I02F', 'I02G'], give: 'I02F', say: '从种植场得到了罂粟' },
  { at: '@reward', ship: M, has: ['I02E', 'I02F'], lacks: ['I02G'], take: ['I02F'], give: 'I02G', say: '罂粟制成了鸦片' },
  { at: '@enemyReward', ship: M, has: ['I02E', 'I02G'], take: ['I02E', 'I02G'], reward: [9000, 1800, 10], effect: 'opium', say: '鸦片卖给了敌人' },
  // 贩运奴隶: labourers from the farm to the gold mine.
  { at: 'PigShop', ship: M, room: true, has: ['I02N'], lacks: ['I02L'], give: 'I02L', say: '从人贩子手里接过一批奴隶' },
  { at: '_______Gold', ship: M, has: ['I02N', 'I02L'], take: ['I02L'], reward: [4500, 500, -3], say: '成功贩卖奴隶' },
  // 拯救黑魔法师: a healing potion, then a spell book, then a mana potion; he leaves a map.
  { at: 'PotionShop', ship: M, mage: true, has: ['I02R'], lacks: ['I02S'], give: 'I02S', say: '取得生命药水' },
  { at: '_______FaShi_1', ship: M, mage: true, has: ['I02R', 'I02S'], take: ['I02R', 'I02S'], give: 'I021', reward: [1951, 650, 7], say: '你救了黑魔法师。他还需要一本魔法书（东南的图书馆）' },
  { at: 'Book', ship: M, mage: true, has: ['I021'], lacks: ['I022'], give: 'I022', say: '取得一本魔法书' },
  { at: '_______FaShi_1', ship: M, mage: true, has: ['I021', 'I022'], take: ['I021', 'I022'], give: 'I02M', reward: [0, 650, 7], say: '黑魔法师收下了魔法书。他还需要一瓶魔法药水（西南的药剂坊）' },
  { at: 'PotionShop', ship: M, mage: true, has: ['I02M'], lacks: ['I02K'], give: 'I02K', say: '得到一瓶魔法药水' },
  { at: '_______FaShi_1', ship: M, mage: true, has: ['I02M', 'I02K'], take: ['I02M', 'I02K'], give: 'I02O', reward: [0, 650, 7], effect: 'mageDone', say: '黑魔法师恢复了法力，留给你一幅看不懂的地图（去西方农场附近找人翻译）' },
  // 海盗宝藏: the map translated, the key dug up, the cave opened.
  { at: '_______Dfzs', has: ['I02O'], lacks: ['I02H'], take: ['I02O'], give: 'I02H', say: '刀锋战士为你翻译了藏宝图：钥匙埋在东南的图书馆' },
  { at: 'Book', has: ['I02H'], lacks: ['I02D'], give: 'I02D', say: '挖呀挖……终于挖到了海盗宝藏钥匙（洞穴在东北角）' },
  { at: '_______HaiDao1', has: ['I02D'], take: ['I02D', 'I02H'], reward: [300, 0, 0], say: '打开海盗洞穴，找到三箱沉船财宝' },
  // Transport jobs between the Swedes and the elves.
  { at: 'GoblinShop', ship: M, has: ['I01U', 'I003'], take: ['I01U', 'I003'], reward: [2000, 400, 3], say: '精灵商店收下了瑞典天然原木' },
  { at: 'SwedeLumberMill', ship: M, has: ['I02P', 'I02Q'], take: ['I02P', 'I02Q'], reward: [2000, 400, 3], say: '小精灵到达了瑞典人的作坊' },
  // 中立港: two more flags than the enemy's and the port is the side's.
  { at: '_______33333333', side: 'north', has: ['I02U'], take: ['I02U'], reward: [500, 300, 3], effect: 'flag', say: '一面北方旗帜插在了中立港上' },
  { at: '_______33333333', side: 'south', has: ['I02T'], take: ['I02T'], reward: [500, 300, 3], effect: 'flag', say: '一面南方旗帜插在了中立港上' },
];

/** The trader rect each side delivers to, and each side's main base rect. */
export const REWARD_RECT: Record<Side, string> = { south: 'SouthReward', north: 'NorthReward' };
export const MAIN_RECT: Record<Side, string> = { south: 'South_Main', north: 'North_Main' };

/** The rect a step happens at, for a player of `side`. */
export function stepRect(step: QuestStep, side: Side): string {
  const enemy: Side = side === 'south' ? 'north' : 'south';
  if (step.at === '@reward') return REWARD_RECT[side];
  if (step.at === '@enemyReward') return REWARD_RECT[enemy];
  if (step.at === '@enemyMain') return MAIN_RECT[enemy];
  return step.at;
}

/** Whether a ship of `shipType` carrying `items` for a `side` player can do `step` now. */
export function stepApplies(step: QuestStep, side: Side, shipType: string, items: string[]): boolean {
  if (step.ship && step.ship !== shipType) return false;
  if (step.side && step.side !== side) return false;
  if (step.room && items.length >= 3) return false;
  return step.has.every((id) => items.includes(id)) && !(step.lacks ?? []).some((id) => items.includes(id));
}

/**
 * Where to go next with what the ship carries: the first step each held contract or cargo
 * leads to, ignoring the hull and cargo-room checks so the hint shows what is still missing.
 */
export function nextSteps(side: Side, items: string[], mageDone: boolean): QuestStep[] {
  const out: QuestStep[] = [];
  for (const step of STEPS) {
    if (step.mage && mageDone) continue;
    if (step.side && step.side !== side) continue;
    if (!step.has.every((id) => items.includes(id)) || (step.lacks ?? []).some((id) => items.includes(id))) continue;
    if (out.some((s) => s.has[0] === step.has[0])) continue; // one hint per contract
    out.push(step);
  }
  return out;
}
