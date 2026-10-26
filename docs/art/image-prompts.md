# 生图清单与提示词

> 配合 [美术规范](README.md) 使用。生成的图片用于后续的 Tripo 图生 3D，所以要求和普通概念图不同：**单个物体、完整入框、纯色背景、平光无阴影**。

## 怎么用

**顺序**：先做第 0 批（风格参考），挑出满意的图后，**之后每一张都把它们作为参考图（风格参考 / 图生图）一起喂给模型**，这是保证 31 艘船风格统一的关键。

**每个物体出两张图**：

| 视角 | 用途 | 在提示词里替换 `{VIEW}` 为 |
|---|---|---|
| 3/4 视角（主图） | Tripo 单图生成 3D 用这张 | `three-quarter view from the front-left, camera slightly above` |
| 正侧面 | 可选，Tripo 多视图模式和校对比例用 | `exact side profile view, orthographic, bow pointing right` |

**图片规格**：1:1，1024×1024 或更高。每个物体多出几张，挑一张最好的。

**文件命名**：`{编号}_{英文名}_{视角}.png`，例如 `H008_lord_34.png`、`H008_lord_side.png`。统一放到仓库的 `art/concepts/` 目录（我之后再决定是否用 Git LFS 管理）。

**通用负面提示词**（工具支持负面提示词时填入）：

```
water, ocean, waves, sails, masts, ropes, rigging, flags, people, crew, text, logo, watermark, frame, multiple objects, scenery, background details, dramatic lighting, cast shadows, reflections, blurry, cropped, cut off
```

**船只为什么不要桅杆和帆**：按美术规范，帆、桅杆、旗由游戏引擎程序化生成（能随风动、能换阵营色），图生 3D 也做不好这类细长结构。下面每艘船的表格里记了"帆的样式"，那是给引擎用的，不用画。

**版权提醒**：提示词里已避开 Warcraft、Blizzard 和具体作品名。标了 ⚠️ 的船原型来自其他作品，提示词已经改成原创设计，公开发布前名字也要改。

---

## 第 0 批：风格参考（先做，约 3 张提示词，各出 4–8 张）

目的是定下整个游戏的画风。挑 3–5 张最满意的作为后续所有生图的参考图。

**通用风格段**（下面所有提示词都已包含，若工具有"风格"字段也可单独填）：

```
stylized low-poly 3D game asset, hand-painted textures, chunky slightly exaggerated proportions, warm wood and weathered metal, clean readable silhouette, isolated on a plain light grey background, soft flat even lighting, no cast shadows, full object in frame, centered
```

| 编号 | 内容 | 提示词 |
|---|---|---|
| S1 | 小木船（定船只风格） | `A small wooden fishing sloop hull with a little deck cabin and a few barrels, hull and deck only, no masts, no sails, no rigging, three-quarter view from the front-left, camera slightly above, stylized low-poly 3D game asset, hand-painted textures, chunky slightly exaggerated proportions, warm wood and weathered metal, clean readable silhouette, isolated on a plain light grey background, soft flat even lighting, no cast shadows, full object in frame, centered` |
| S2 | 中型铁甲战舰（定金属感） | `A medium iron-plated warship hull with riveted armor, a small command bridge and two deck cannons, hull and deck only, no masts, no sails, no rigging, three-quarter view from the front-left, camera slightly above, stylized low-poly 3D game asset, hand-painted textures, chunky slightly exaggerated proportions, warm wood and weathered metal, clean readable silhouette, isolated on a plain light grey background, soft flat even lighting, no cast shadows, full object in frame, centered` |
| S3 | 海岸石塔（定建筑风格） | `A sturdy stone coastal defense tower with a cannon platform on top and a wooden door at the base, three-quarter view from the front-left, camera slightly above, stylized low-poly 3D game asset, hand-painted textures, chunky slightly exaggerated proportions, warm stone and weathered metal, clean readable silhouette, isolated on a plain light grey background, soft flat even lighting, no cast shadows, full object in frame, centered` |

---

## 第 1 批：试点三艘船（M1 流水线试点）

先只做这三艘，跑通"图 → Tripo → Blender → 游戏"整条流程后再批量做。

| 编号 | 船 | 尺寸 | 帆的样式（引擎用） |
|---|---|---|---|
| H000 | 水手 | 小型 | 单桅，白色三角帆 |
| H016 | 龟船 | 中型 | 双桅，土黄色硬帆（中式竹撑帆） |
| H008 | 领主 | 巨大 | 三桅，深灰色方帆 |

**H000 水手**（`H000_sailor`）
```
A small, cheap wooden launch boat with a single small cannon mounted at the bow, a tiny tiller at the stern and a coil of rope on deck, simple and humble, hull and deck only, no masts, no sails, no rigging, {VIEW}, stylized low-poly 3D game asset, hand-painted textures, chunky slightly exaggerated proportions, warm wood and weathered metal, clean readable silhouette, isolated on a plain light grey background, soft flat even lighting, no cast shadows, full object in frame, centered
```

**H016 龟船**（`H016_turtle`）
```
A Joseon-era Korean turtle warship: a fully enclosed curved armored roof covered in iron spikes like a turtle shell, a carved dragon head at the bow, rows of small gun ports along both sides, sturdy dark wooden hull, hull and roof only, no masts, no sails, no rigging, {VIEW}, stylized low-poly 3D game asset, hand-painted textures, chunky slightly exaggerated proportions, warm wood and weathered metal, clean readable silhouette, isolated on a plain light grey background, soft flat even lighting, no cast shadows, full object in frame, centered
```

**H008 领主**（`H008_lord`）
```
A massive dark iron battleship with a fortified stone-and-iron keep in the middle of the deck, a heavy reinforced ram at the bow, frost-blue crystal ornaments on the keep, broadside cannon ports along the hull, intimidating ruler of the sea, hull and deck superstructure only, no masts, no sails, no rigging, {VIEW}, stylized low-poly 3D game asset, hand-painted textures, chunky slightly exaggerated proportions, warm wood and weathered metal, clean readable silhouette, isolated on a plain light grey background, soft flat even lighting, no cast shadows, full object in frame, centered
```

---

## 第 2 批：其余 28 艘玩家船

每条提示词的结构相同：`{船的描述}, hull and deck superstructure only, no masts, no sails, no rigging, {VIEW}, {通用风格段}`。下面只列出"船的描述"一段，使用时把它拼进模板：

```
{DESCRIPTION}, hull and deck superstructure only, no masts, no sails, no rigging, {VIEW}, stylized low-poly 3D game asset, hand-painted textures, chunky slightly exaggerated proportions, warm wood and weathered metal, clean readable silhouette, isolated on a plain light grey background, soft flat even lighting, no cast shadows, full object in frame, centered
```

### 小型（船长约 120）

| 编号 | 船 | 描述（填入 `{DESCRIPTION}`） | 帆的样式 |
|---|---|---|---|
| H00D | 巴拿马（商船） | `A small round-bellied merchant cog loaded with cargo crates, sacks and barrels lashed on deck, a little covered cargo hold, peaceful trading vessel` | 单桅，米色方帆打补丁 |
| H001 | 圣战者（快艇） | `A fast armored skiff with an iron-reinforced pointed ram bow, low sleek hull, a few powder kegs strapped near the bow, built for daring suicide charges` | 单桅，白色三角帆 |
| H01A | 渔船 | `A sturdy fishing boat with a net winch, piled fishing nets and floats, a small wheelhouse, and a carved orca figurehead at the bow` | 单桅，浅蓝色方帆 |
| H01B | 飞鱼（汽艇） | `A sleek steam-powered launch with fin-shaped armored side plates like a flying fish, a short smokestack and a small engine housing, fast and tough` | 无帆（引擎加烟囱冒烟） |
| H021 | 黄金美丽 ⚠️ | `A cheerful small caravel with a bright sunflower-yellow hull and orange trim, a round sun-shaped carved figurehead at the bow, a small cozy cabin with round windows, adventurous and friendly` | 单桅，白色方帆带太阳图案 |

### 中型（船长约 165）

| 编号 | 船 | 描述 | 帆的样式 |
|---|---|---|---|
| H003 | 拦截者（护卫舰） | `A narrow fast naval frigate with twin fuel boilers and exhaust pipes at the stern, a sharp bow, a light deck cannon, built for speed` | 双桅，白色方帆 |
| H004 | 守护者（工程舰） | `A practical engineering ship with a deck crane, a repair workshop cabin with tool racks, spare planks, and naval mine racks at the stern` | 双桅，灰白色方帆 |
| H01K | 执法者（皇家炮舰） | `An elegant royal gunboat with a white hull and gold trim, twin forward deck guns, a polished command cabin and royal crest on the bow` | 双桅，白色方帆金边 |
| H007 | 破坏者（巡洋舰） | `A mysterious cruiser that looks like a patched-together shipwreck, mismatched hull planks and iron plates, broken railings, boarding hooks and grapples, eerie and chaotic` | 双桅，破洞灰帆 |
| H006 | 支配者（巡洋舰） | `A solid medium cruiser with a large copper electromagnetic coil tower on the deck, cables running along the hull, a few cannons` | 双桅，深蓝色方帆 |
| H01C | 私掠者（袭击舰） | `A privateer raider with flamethrower nozzles and fuel tanks at the bow, heavy chains and shackles hanging from the sides, a treasure chest on deck` | 双桅，暗红色方帆 |
| H01D | 影子战舰 | `A strange shimmering warship covered in polished crystal and mirror panels that reflect light, faceted angular hull, mysterious and glittering` | 双桅，半透明淡紫色帆 |
| H01H | 元素战舰 | `A living nature-magic warship whose hull is made of twisted living wood covered in moss, small trees growing on deck, mossy boulders and glowing green runes` | 双桅，叶片状绿色帆 |
| H01V | 田鼠（鼠式战舰） | `A compact, extremely heavily armored low-profile ironclad with one huge rotating gun turret in the middle, thick sloped steel armor, small but unstoppable` | 无帆（引擎加烟囱） |
| H005 | 鹦鹉螺（潜水艇） | `A Victorian brass submarine with a riveted cigar-shaped hull, nautilus-shell spiral ornaments, a conning tower with round portholes, side fins and a propeller` | 无帆 |
| H01N | 飞行的荷兰人 ⚠️ | `A spectral ghost galleon from sailor legends, rotting dark wood hull with faint green ghostly glow seeping through cracks, broken lanterns, crackling lightning crystals on deck` | 三桅，破烂的灰绿色鬼帆 |

### 大型（船长约 210）

| 编号 | 船 | 描述 | 帆的样式 |
|---|---|---|---|
| H00X | 腓尼基（远古战船） | `An ancient Mediterranean bronze-age war galley with a bronze ram, rows of oars, painted eyes on the bow, flaming braziers along the deck, surrounded by fire` | 单桅，红白条纹方帆 |
| H00V | 大天使（指挥舰） | `A majestic white command flagship with gilded angel-wing ornaments along the hull, a tall signal tower, large war drums on deck, radiant and noble` | 三桅，白金色方帆 |
| H00T | 死神（桨帆战船） | `A fast black-and-crimson war galley with dozens of long oars, a scythe-shaped curved ram blade at the bow, skull lanterns, menacing and swift` | 单桅，黑色方帆 |
| H011 | 黑色幽灵（高速战舰） | `A sleek matte-black high-speed stealth warship with a sharp angular wave-piercing hull, low profile, faint purple glowing seams` | 双桅，黑色三角帆 |
| H01L | 月光（新月战舰） | `An ancient eastern magic warship with a crescent-moon shaped hull, silver and deep blue lacquer, hanging paper lanterns, moon symbols and carved clouds` | 双桅，银蓝色扇形帆 |

### 巨大（船长约 255）

| 编号 | 船 | 描述 | 帆的样式 |
|---|---|---|---|
| H009 | 主宰者（战列舰） | `A colossal floating fortress battleship with thick dark armor plates, multiple decks of cannons, a heavy tower, and a carved kraken totem at the bow` | 三桅，深红色方帆 |
| H01O | 掘墓人（亡者之船） | `An undead ship whose hull is built from giant bones and ribs, exposed rib cage sides, green ghostly lanterns, a smoking volcanic vent in the middle of the deck, plague barrels` | 三桅，破烂黑帆 |
| H019 | 邓子龙（宝船） | `A huge Ming-dynasty Chinese treasure ship, multi-deck junk hull painted red and gold, a tall ornate stern castle with carved dragons, eye painted on the bow` | 五桅，红色中式竹撑帆 |
| H01P | 伊谢尔伦（移动要塞）⚠️ | `A slow mobile sea fortress: a round disc-shaped armored citadel floating on a wide hull, one giant central siege cannon, small airship docking platform on top` | 无帆 |
| H00R | 麦哲伦（重型战列舰） | `A heavy dreadnought battleship with three enormous main gun turrets, a tall armored bridge tower, thick belt armor, big-gun battleship design` | 无帆（引擎加烟囱） |
| H015 | 定远（铁甲战舰） | `A late 19th-century Chinese ironclad battleship, twin large armored gun barbettes placed diagonally, a central superstructure with two tall funnels, black hull with buff upper works` | 无帆（引擎加两根烟囱） |
| H00C | 黑珍珠 ⚠️ | `A large fearsome pirate galleon with a black-painted hull, a carved screaming-skull figurehead, rows of cannon ports, a tall stern castle with skull lanterns` | 三桅，黑色方帆 |

---

## 第 3 批：NPC 舰队（4 个模型）

NPC 船 I/II/III 型共用模型，靠阵营色和配件区分，所以只需要 4 个。

| 编号 | 名称 | 尺寸 | 描述（填入第 2 批的模板） |
|---|---|---|---|
| h00I | 海军小艇 | 船长约 100 | `A small standard-issue navy patrol boat, uniform military design, one light deck gun, simple and mass-produced` |
| h00B | 海军护卫舰 | 船长约 150 | `A standard navy frigate, uniform military paint scheme, two deck guns, a small bridge, mass-produced and practical` |
| h00H | 海军巡洋舰 | 船长约 200 | `A standard navy cruiser, uniform military design, a forward gun turret, a command bridge, sturdy and mass-produced` |
| h018 | 超级战舰 | 船长约 300 | `A gigantic super battleship, the pride of the navy, layered armored superstructure, many gun turrets, a massive armored prow` |

---

## 第 4 批：建筑（14 个）

模板（建筑不用"无桅杆"那段，但要求底座完整、不带地面）：

```
{DESCRIPTION}, standing on a small flat base, no ground, no terrain, {VIEW}, stylized low-poly 3D game asset, hand-painted textures, chunky slightly exaggerated proportions, warm stone, wood and weathered metal, clean readable silhouette, isolated on a plain light grey background, soft flat even lighting, no cast shadows, full object in frame, centered
```

`{VIEW}` 对建筑统一用 `three-quarter view from the front-left, camera slightly above`。需要换阵营色的部分（屋顶、旗帜）尽量画成中性色，引擎会上色。

| 编号 | 名称 | 优先级 | 描述 |
|---|---|---|---|
| n000 | 主基地 | 高 | `A grand harbor fortress headquarters, a thick-walled stone keep with a large neutral-grey roof, defensive cannons on the battlements, a harbor gate at the front` |
| n003 | 码头（船厂） | 高 | `A wooden shipyard dock with a slipway, a large wooden crane, scaffolding around a half-built hull frame, stacked timber` |
| h00K | 岸防炮塔 | 高 | `A round stone coastal artillery tower with a cannon on a rotating platform on top, sturdy and squat` |
| h00M | 岸防炮塔（高级） | 高 | `An upgraded reinforced coastal artillery tower with iron bands, two cannons on top and an observation post` |
| h012 | 高级能量之塔 | 高 | `A tall arcane energy tower of carved stone with a glowing blue crystal floating at the top, runes along the sides` |
| n001 | 武器商店 | 中 | `A small seaside weapon shop with cannons and cannonballs displayed out front, a wooden sign with a crossed-cannons emblem` |
| n002 | 装备商店 | 中 | `A small seaside outfitter shop with ship armor plates, rolled sails and steering wheels displayed out front` |
| n00Y | 改装中心 | 中 | `A shipwright workshop with a dry dock gantry, gears and tools, ship parts hanging from hooks` |
| n012 | 船首像商人 | 低 | `A small carving workshop with several colorful wooden ship figureheads displayed outside` |
| n011 | 武器研发中心 | 低 | `A brick weapons research workshop with a tall chimney, blueprints pinned on the walls, an experimental cannon prototype outside` |
| n005 | 中立港 | 中 | `A neutral trading port: a cluster of wooden piers, a harbor master's house, cranes and cargo crates` |
| n014 | 亚历山大港 | 中 | `An ancient Mediterranean port with white stone buildings, columns, and a small lighthouse tower` |
| n00U | 潜艇工厂 | 低 | `An industrial submarine factory hangar with a sloped launch ramp into the water, riveted iron walls, a smokestack` |
| — | 修理站 | 中 | `A small repair dock with a wooden frame, workers' tool sheds, stacks of planks and pulleys` |

---

## 第 5 批：海怪与野怪（之后再做）

| 编号 | 名称 | 描述 |
|---|---|---|
| n00L | 海怪 | `A giant kraken rising from below, huge tentacles curled upward, barnacle-covered head, menacing eyes` |
| n01E | 虎鲸 | `A stylized orca whale, black and white, swimming pose, friendly but powerful` |
| n016 | 多头蛇妖女王 | `A sea serpent queen with a coiled scaly serpent body and several hydra heads, wearing a coral crown` |
| ntrd | 龙龟 | `A colossal dragon turtle with a craggy rock-like shell, dragon head and clawed flippers` |
| nbzd | 金龙王 | `A golden sea dragon king, long coiled golden scaled body, flowing whiskers and a pearl` |
| nsel | 海元素 | `A sea elemental made of swirling seawater and foam in a roughly humanoid shape` |

海怪类模板去掉"no masts…"那段，加上 `creature, full body, neutral T-pose or simple standing pose`。

---

## 第 6 批：2D 图标（约 300 个，最后做）

图标直接用生图结果，不进 3D 流程。统一模板：

```
Game UI icon of {SUBJECT}, centered, bold readable shape, hand-painted fantasy style, rich colors, dark vignette background, square, no text, no border
```

需要的数量：船 31、武器 75、物品约 120、技能约 100。完整清单（每个图标的 `{SUBJECT}`）等前面几批定下画风后，我再从游戏数据里生成一份逐条的表给你。
