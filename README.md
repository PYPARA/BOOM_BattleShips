<div align="center">

# BOOM 海战

**把《BOOM_海战》7.876 的舰队交锋，带到浏览器里。**

TypeScript · Three.js · 单人对战 AI · 网页重制版

![Status](https://img.shields.io/badge/status-试玩开发中-orange)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=nodedotjs&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-11.9.0-F69220?logo=pnpm&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-3D-000000?logo=threedotjs&logoColor=white)

[在线试玩](https://boom-battleships.vercel.app) · [玩法与操作](#玩法与操作) · [部署网页版](#部署网页版)

![BOOM 海战主视觉](packages/client/public/ui/keyart.webp)

<sub>游戏主视觉插画，实际画面以运行版本为准。</sub>

</div>

## 关于游戏

这是一款基于《魔兽争霸 III》自定义地图 **《BOOM_海战》7.876** 制作的 3D 网页重制游戏。驾驶战舰驶出母港，跟随己方舰队推进，通过战斗赚取金钱、购买武器与装备、升级技能和更换船只，最终摧毁敌方主基地。

当前版本面向**电脑浏览器上的单人 AI 对战**，最多可进行你与 9 名电脑玩家组成的 **5 对 5** 海战。游戏仍在开发和打磨中，欢迎试玩。

## 试玩看点

- **从小艇到主力战舰**：多种船型、武器、装备与船只技能，围绕射程、机动和生存搭配自己的打法。
- **三种游戏模式**：快速战斗、联赛标准、商船任务；既能直接推线，也能体验贸易与地图任务。
- **可调整的电脑对战**：简单、普通、困难三档 AI，自选南北阵营、电脑队友和对手数量。
- **有变化的海域**：NPC 舰队、野怪与 Boss、战争迷雾、昼夜变化和天气效果。
- **完整的对局流程**：主菜单、加载进度、新手提示、商店、计分板、胜负结算与再来一局。
- **3D 海战表现**：海面与船尾迹、炮火与技能特效、合成音效和音乐，以及低 / 中 / 高三档画质。

## 开始试玩

**[点击在线试玩 →](https://boom-battleships.vercel.app)**

使用电脑浏览器打开即可游玩，无需下载安装。也可以按下面的步骤在本地启动；Vercel 部署方式见[部署网页版](#部署网页版)。

### 本地启动

需要 **Node.js 24 或更高版本**、**pnpm 11.9.0**。

```bash
git clone https://github.com/PYPARA/BOOM_BattleShips.git
cd BOOM_BattleShips
pnpm install
pnpm dev
```

打开终端显示的本地地址，通常是 **http://localhost:5173**。

运行游戏无需安装《魔兽争霸 III》，也无需配置 AI 服务密钥。电脑对手在本地运行，仓库已包含启动所需的提取数据和游戏资源，首次试玩不需要执行 `pnpm extract`。

### 第一局怎么玩

1. 在主菜单选择「快速战斗」和「简单」难度，保留电脑队友后开始游戏。
2. 左键点击母港里的商店，开船靠近后购买武器或装备；技能图标出现 `+` 时可以学习技能。
3. 选中自己的船，右键点击海面，跟随己方舰队沿航线推进。
4. 击沉敌船、舰队或野怪来赚取金钱和经验，受损后回母港修理站修理。
5. 继续升级装备、更换船只，摧毁敌方主基地即可获胜。

资源会在菜单后台加载，底部进度条显示加载情况。画面卡顿时可以先降低画质，再开始一局。

## 玩法与操作

### 游戏模式

| 模式 | 适合体验 | 主要规则 |
| --- | --- | --- |
| 快速战斗 | 第一局试玩、快速交锋 | 更高工资、1.5 倍经验；一方玩家全灭时临时开放西侧航道；无商船和潜水艇 |
| 联赛标准 | 常规推进与装备成长 | 标准工资，西侧航道常开；无商船和潜水艇 |
| 商船任务 | 贸易、探索和任务 | 开放商船贸易、地图任务与潜艇工厂，队友之间可以赠送金钱 |

### 常用操作

| 操作 | 按键 / 鼠标 |
| --- | --- |
| 选择船只、查看单位或打开商店 | 鼠标左键 |
| 框选己方船只 | 左键拖动 |
| 航行 | 选中船只后右键点击海面 |
| 平移镜头 | 方向键 / 鼠标移到屏幕边缘 / 中键拖动 |
| 缩放镜头 | 鼠标滚轮 |
| 镜头回到选中的船只 | `Space` |
| 释放技能 | 点击技能图标，或按图标标注的快捷键；需要目标时再左键选择 |
| 学习技能 | 点击技能图标上的 `+` |
| 使用物品 | `1`–`6`，或点击物品图标 |
| 出售物品 | 靠近商店后，右键点击物品栏中的物品 |
| 查看计分板 | 按住 `Tab` |
| 打开设置 / 暂停对局 | `F10`，或点击齿轮按钮 |
| 取消施法目标 / 清除选择 | `Esc` |

商店需要主动点击建筑打开，船只靠近后才能买卖。把鼠标停在商品、技能或单位上，可以查看数值、购买条件与效果说明。

### 当前版本说明

- 当前支持单人对战 AI，尚未提供多人联机。
- 操作围绕键盘和鼠标设计，手机触控操作尚未适配。
- 部分原版规则、技能与任务采用了简化实现，内容和数值还在持续核对；具体进度见[开发计划](docs/PLAN.md)。
- 游戏支持 WebGPU，并提供 WebGL2 后端；遇到渲染问题时，可在地址后加 `?webgl` 尝试 WebGL2。
- 画质设置在下一局生效；音乐和音效在首次点击页面后启动。

## 部署网页版

使用 **Vercel** 托管静态客户端，当前单人 AI 对战无需额外游戏服务器。

### 从 GitHub 导入

1. 将代码推送到 GitHub，在 Vercel 中新建项目并导入本仓库。
2. 保持 **Root Directory 为仓库根目录**，按下表填写构建配置。
3. 添加构建环境变量 `ENABLE_EXPERIMENTAL_COREPACK=1`，让 Vercel 使用根目录 `package.json` 中指定的 `pnpm@11.9.0`。
4. 点击 **Deploy**，构建完成后即可通过分配的域名试玩和分享。

| 配置项 | 值 |
| --- | --- |
| Framework Preset | `Other` |
| Root Directory | 仓库根目录（默认） |
| Node.js Version | `24.x` |
| Install Command | `corepack pnpm install --frozen-lockfile` |
| Build Command | `pnpm build` |
| Output Directory | `packages/client/dist` |
| Environment Variables | `ENABLE_EXPERIMENTAL_COREPACK=1` |

项目使用 pnpm workspace，构建需要访问 `packages/client`、`packages/sim`、`packages/ai` 和 `packages/gamedata`，因此根目录保持在仓库根部。Vercel 部署使用默认资源路径，无需设置 GitHub Pages 的仓库路径前缀。

Corepack 的包管理器版本选择与构建配置可参考 [Vercel 包管理器文档](https://vercel.com/docs/package-managers)和[构建设置文档](https://vercel.com/docs/builds/configure-a-build)。

### 本地预览发布版本

发布前可以先在本地构建并预览：

```bash
pnpm build
pnpm --filter @boom/client preview
```

打开终端显示的预览地址，通常是 **http://localhost:4173**。构建产物位于 `packages/client/dist`，需要通过 HTTP / HTTPS 访问。

## 开发与项目结构

项目使用 pnpm workspace 管理。模拟核心与画面分离，以固定 **20 tick/s** 运行，电脑玩家复用同一套游戏规则。

| 路径 | 内容 |
| --- | --- |
| [`packages/client/`](packages/client/) | Three.js 客户端、界面、音效与渲染资源 |
| [`packages/sim/`](packages/sim/) | 游戏模拟：运动、寻路、战斗、技能与任务 |
| [`packages/ai/`](packages/ai/) | 电脑玩家：购物、学习技能、推线、撤退与施法 |
| [`packages/gamedata/`](packages/gamedata/) | 游戏数据、类型定义与提取结果 |
| [`tools/extract/`](tools/extract/) | 原始地图解析与数据提取工具 |
| [`tools/art/`](tools/art/) | 美术资源生成与处理工具 |
| [`data/`](data/) | 原始地图与用于核对的 CSV 数据 |
| [`docs/`](docs/) | 开发计划、游戏机制与美术规范 |

```bash
pnpm dev        # 启动客户端开发服务器
pnpm build      # 构建静态网站
pnpm test       # 运行项目测试
pnpm typecheck  # 检查各包的 TypeScript 类型
pnpm extract    # 从原始地图重新提取数据（按需执行）
```

`pnpm extract` 将更新 `packages/gamedata/generated/`，并在 `data/raw/` 生成原始文件和带中文注释的 `war3map.annotated.j`；`data/raw/` 不提交到仓库。

更多资料：[开发计划](docs/PLAN.md) · [游戏规则](docs/mechanics/README.md) · [船只技能数据](docs/mechanics/ship-skills.md) · [美术规范](docs/art/README.md)

## 致谢

感谢《BOOM_海战》原地图作者与玩家社区。本项目以 7.876 为复刻基准，属于非官方重制；原地图、名称及相关内容的权利归各自权利人所有。
