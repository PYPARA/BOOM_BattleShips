# BOOM 海战复刻

用 TypeScript + Three.js 复刻魔兽争霸 III 地图《BOOM_海战》7.876。计划见 [docs/PLAN.md](docs/PLAN.md)，从地图里整理出的游戏规则见 [docs/mechanics/](docs/mechanics/README.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `data/` | 原始地图 `qcloud_20120392.w3x` 和早期手工整理的 CSV（测试用它们核对提取结果） |
| `tools/extract/` | 地图解析工具：MPQ、SLK、TXT、w3a、w3e、wpm、doo、war3map.j |
| `packages/gamedata/` | 提取出的游戏数据（`generated/*.json`）和类型定义 |
| `packages/sim/` | 游戏模拟核心（纯 TypeScript，固定每秒 20 tick，可脱离画面运行）：船只运动、寻路 |
| `packages/client/` | Three.js 客户端：地形、海面、占位模型、选择与航行、小地图 |
| `docs/mechanics/` | 游戏规则文档；`ship-skills.md` 由提取工具自动生成 |
| `docs/art/` | 美术规范与风格手册 |

## 常用命令

需要 Node 24 和 pnpm。

```bash
pnpm install
```

```bash
pnpm extract
```

重新从地图提取数据，输出到 `packages/gamedata/generated/`，并在 `data/raw/` 下解出原始文件和带中文注释的脚本 `war3map.annotated.j`（不提交）。

```bash
pnpm dev
```

```bash
pnpm test
```

```bash
pnpm typecheck
```
