# 批量建模任务三：树木、植物、岩石和杂物（交给 Codex 子代理）

地图上有 2154 个装饰物（doodad），约 90 种魔兽原版类型。重制版用下面 18 个低多边形模型覆盖它们，游戏里大量实例化（同一个模型会画上千次），所以要**面数少、材质少**。客户端按类型把原版 id 映射到这些模型，映射由另一个代理来做。

工具和 Aha 操作方法见 [batch-modeling.md](batch-modeling.md) 的「准备」和「驱动 Aha 的两种方式」。这一批**不需要概念图**，直接用文字说明建模。

## 边界

- 只改 `packages/client/public/models/doodads/` 和本文件末尾的进度表。
- 不要动 `packages/` 下的源码、其它文档和 `art/`。不要 git commit、不要切分支。`key.json` 不要打印或复制。
- Aha 里已有的工程不要删改。

## 每个模型

- 工程名 `doodad <名字>`，例如 `doodad tree_broadleaf_a`。
- 通用要求（每个都附上）：

  ```
  硬性要求：1）Y 轴向上，原点在底部中心，模型立在原点上（水生植物的原点在水面高度）。2）不要地面、底座和水面。3）风格：低多边形、手绘感、比例略夸张、颜色鲜明，像卡通海岛游戏；不用贴图，最多 3 个 MeshStandardMaterial（例如树干、树叶、花）。4）高度和面数按要求，宁少勿多。5）顶部轮廓要从斜上方俯视时好认。
  ```

- 拉取：`pnpm --filter @boom/art pull-aha "doodad <名字>" <名字> --kind doodads`

| 名字 | 说明 | 高度（米） | 面数上限 |
|---|---|---|---|
| tree_broadleaf_a | 圆润的阔叶树，几团块状树冠，暖绿色 | 1.6 | 500 |
| tree_broadleaf_b | 另一棵阔叶树，更高更瘦，树冠偏黄绿 | 1.8 | 500 |
| tree_pine_a | 卡通松树，三层锥形树冠，深绿 | 1.8 | 400 |
| tree_pine_b | 稍矮更胖的松树 | 1.4 | 400 |
| tree_palm_a | 弯曲树干的棕榈树，6–7 片大叶子，带两三个椰子 | 1.8 | 500 |
| tree_palm_b | 直一点、两根树干的棕榈树 | 1.6 | 600 |
| tree_dead | 枯树，几根扭曲的枝干，灰褐色 | 1.3 | 300 |
| bush_a | 圆形灌木丛 | 0.5 | 250 |
| bush_b | 带红色小浆果的灌木 | 0.5 | 300 |
| flowers | 一小片花丛，几种颜色的小花和叶子 | 0.3 | 300 |
| reeds | 水边芦苇，一簇细长叶子和几根香蒲 | 0.7 | 300 |
| lilypads | 几片浮在水面的荷叶，一朵粉色荷花 | 0.08 | 200 |
| seaweed | 浅水里露出的海草，几条弯曲的叶带 | 0.4 | 250 |
| rock_large | 一块大石头，棱角分明，灰色带青苔 | 0.8 | 200 |
| rocks_small | 三四块小石头一堆 | 0.35 | 200 |
| barrels_crates | 两个木桶和一个木箱堆在一起 | 0.5 | 400 |
| ruins_pillar | 一根断掉的古老石柱，旁边一块碎石 | 1.2 | 400 |
| shipwreck | 搁浅的小船残骸，半截船身和断桅 | 0.9 | 1200 |

检查：从斜上方看轮廓清楚、立在原点、面数不超。最多改 2 轮。18 个都有 `.glb` 和 `.json` 即完成，做不出来的跳过并写原因。最后给一个简短总结。

## 进度

| 名字 | 工程名 | 版本 | 面数 | 备注 |
|---|---|---|---|---|
| tree_broadleaf_a | doodad tree_broadleaf_a (`c1a6e603-6cfa-408f-85b8-ddb0fcafe428`) | v1 (`de4d53b6-0e25-4b80-8793-7882047b9f02`) | 476 | 已检查、采用、拉取；高 1.6 m；2 材质、无贴图 |
| tree_broadleaf_b | doodad tree_broadleaf_b (`d696672c-58fc-4a27-bc32-3011347284a7`) | v1 (`7c1250a3-b264-4025-938b-6c42d7050b92`) | 326 | 已检查、采用、拉取；高 1.8 m；2 材质、无贴图 |
| tree_pine_a | doodad tree_pine_a (`b7f697cf-f610-4e5f-8019-1b0fb4712383`) | v1 (`24f54f79-d6e6-4b0b-ab36-67e63fd13680`) | 88 | 已检查、采用、拉取；高 1.8 m；2 材质、无贴图 |
| tree_pine_b | doodad tree_pine_b (`8195e529-672b-4680-9f60-fe3b218b691b`) | v2 (`87c2a20a-8ce3-4b63-8e0f-d4d7cec47182`) | 172 | 已检查、采用、拉取；高 1.4 m；2 材质、无贴图 |
| tree_palm_a | doodad tree_palm_a (`d7c5dc36-506d-4b02-a1c5-3e70ad628471`) | v1 (`78ac33d4-e797-49e8-9b5e-6e24651e72cd`) | 466 | 已检查、采用、拉取；高 1.8 m；3 材质、无贴图 |
| tree_palm_b | doodad tree_palm_b (`4a9c0c1f-8352-4bce-ae52-fe7cf496a456`) | v1 (`f8058316-a4e0-4d0a-a638-679212b814ef`) | 540 | 已检查、采用、拉取；高 1.6 m；2 材质、无贴图 |
| tree_dead | doodad tree_dead (`f976419f-5fd9-4e4a-aaab-310a0e686023`) | v1 (`207c5c70-d3e1-4594-a937-c946bc5cdd50`) | 282 | 已检查、采用、拉取；高 1.3 m；1 材质、无贴图 |
| bush_a | doodad bush_a (`cda8e10e-acf3-43e3-8093-aaa33f3ab04a`) | v1 (`15a35141-19fc-4be8-b98a-7a0139615e8d`) | 224 | 已检查、采用、拉取；高 0.5 m；1 材质、无贴图 |
| bush_b | doodad bush_b (`46864a85-f54d-4953-95c8-bc033643e513`) | v1 (`8bd3be49-75f2-4c79-8c90-3656b79473c9`) | 264 | 已检查、采用、拉取；高 0.5 m；3 材质、无贴图 |
| flowers | doodad flowers (`11e2e88d-8efe-4481-bb2e-745d68a85a2e`) | v1 (`c123f752-9f36-4c05-8939-54033f18c717`) | 259 | 已检查、采用、拉取；高 0.3 m；3 材质、无贴图 |
| reeds | doodad reeds (`546935c7-5472-452c-b230-d9d7a5ba120d`) | v1 (`7f1810c5-158c-421b-9a01-8e83790b87b3`) | 264 | 已检查、采用、拉取；高 0.7 m；3 材质、无贴图 |
| lilypads | doodad lilypads (`3837a35d-73e4-4935-a48c-d5653c684e4b`) | v1 (`b239b1d2-e7bf-46eb-aac3-eee55e97c4a3`) | 152 | 已检查、采用、拉取；高 0.08 m；3 材质、无贴图 |
| seaweed | doodad seaweed (`619f12f3-98fc-4bef-bb53-ca683484765a`) | v1 (`1a6068a6-3366-4be3-879f-5f0d9aa21e59`) | 200 | 已检查、采用、拉取；高 0.4 m；1 材质、无贴图 |
| rock_large | doodad rock_large (`dde29d06-14c2-4433-9140-e2a7d9ab7bb0`) | v1 (`f05f2873-ccc7-4374-b961-754c4109027d`) | 60 | 已检查、采用、拉取；高 0.8 m；2 材质、无贴图 |
| rocks_small | doodad rocks_small (`7de04549-fb1e-45e9-91d4-4150e09e5225`) | v1 (`9449149d-fa70-4564-87f5-26885585c487`) | 168 | 已检查、采用、拉取；高 0.35 m；1 材质、无贴图 |
| ruins_pillar | doodad ruins_pillar (`a6a79c10-b049-4026-9ccb-2fc541967cce`) | v1 (`56a07650-4542-496d-b1b0-46a356bfdb85`) | 244 | 已检查、采用、拉取；高 1.2 m；3 材质、无贴图 |
| barrels_crates | doodad barrels_crates (`18619dbc-8dc8-4f6b-a1b5-03e41305ceda`) | v4 (`c9776ac8-f589-466e-99b5-114adaf49ac3`) | 370 | 已检查、采用、拉取；高 0.5 m；3 材质、无贴图；两轮修正原点，烘焙部件变换避免工坊归一化偏移 |
| shipwreck | doodad shipwreck (`9fb392ad-b156-4b1a-9c6d-6f1af40150f7`) | v1 (`c1c27f2b-a721-4aed-9b9f-9624368c4fc4`) | 832 | 已检查、采用、拉取；高 0.9 m；3 材质、无贴图 |

完成核验（2026-10-27）：18/18，均在 Aha 3D 工坊以 Three.js / 默认 gpt6.1sol 建模，已逐个检查斜上方缩略图、采用并拉取，无跳过。18 对 GLB/JSON 已核对采用版本与文件字节一致性、实际三角面数、1–3 个材质、无贴图、指定高度、Y 向上和底部中心原点（水生植物 Y=0 为水面）；GLB 校验错误均为 0。18 个独立模型合计 5,387 个三角面，GLB 合计 767,720 字节。只修改本进度表和 `packages/client/public/models/doodads/`，未改源码、未提交。
