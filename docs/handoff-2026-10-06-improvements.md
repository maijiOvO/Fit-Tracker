# 交接：9 条待优化（2026-10-06）

新对话从这里接着做。用户原始需求、已拍板的决定、每条的施工方案、现状和坑都在下面。
动 UI 之前先读 `CLAUDE.md`、`docs/design-ink-and-paper.md`，以及知识库 `_memory/fitlog/`（尤其是新加的 `demo-match-current-ui`）。

## 进度（2026-10-06 第二个会话，按 §5 顺序）

| 阶段 | 状态 | 提交 |
|---|---|---|
| 0 | 手机排版摸底完成，三处便宜的已修；备份 + 真实数据体检**等用户跑脚本**（见下） | `cfb0dc4` |
| 1 | 第 1、6 条 + renameTag 等同步标记，完成 | `a13450d` |
| 2 | demo `docs/demos/set-state.html` 已出，**等用户拍板**（±5 样子、待做行改过的格子墨色）再写代码 | `147c278` |
| 3 | 第 7 条完成（曾用名、偏好按显示名归并、卡片改名入口、三个内置改名） | `48a9efb` `a9f1daa` |
| 4 | 用户已认可 region-board **第三版**样式（「对应功能按照 demo 的样式做」）；新增候选入库仍要等真实数据去重 | — |

- 备份 / 体检脚本：`C:\Users\30257\AppData\Local\Temp\claude\D--Users-30257-Desktop-personal-project-fitlog\2c346cc1-170d-4af1-8987-0304fa95040a\scratchpad\pull-exercise-library.mjs`
  （只读 GET；完整快照 + 动作库摘要写到仓库外 `D:\Users\30257\Desktop\personal project\fitlog-backups\`）。
- 摸底脚本入库了：`scripts/layout-survey.mjs`（mock 后端夹具，4 宽 × 中英 × kg/lbs）。
  没修、留给用户定的：全 App 大量 9–10.5px 字（时间线副行、底栏标签、弹层标签 9px、月份标题 10px），与规格「下限 11px」冲突，属视觉改动；
  三指标有氧行在 360 宽能放下但很挤；四指标 + lbs 六位数在 360 会触到 11px 下限被截。
- e2e：本机 Playwright 浏览器版本与 node_modules 对不上，跑时 `E2E_CHROMIUM` 指向 `ms-playwright\chromium_headless_shell-1228\...\chrome-headless-shell.exe`。

## 0. 现状（第一个会话结束时）

- 代码一行没改。唯一产物：`docs/demos/region-board.html`（第 3 条的 demo，第二版，**未提交**）。
  在线版：https://claude.ai/artifact/GuYHyn4grFDMd2N7Wxhgwe（私有）。
  发布用的是去掉 `<!doctype>/<html>/<head>/<body>` 的副本（Artifact 要求），仓库里那份是完整文档。
- git：除了 demo，工作区原本就有 `android/app/capacitor.build.gradle`、`android/capacitor.settings.gradle` 两个改动（不是我改的，别动）。
- 用户已确认：**其余各条按下面的推荐方案做**；第 3 条的**交互理解正确**，第一版 demo「太丑」，第二版改成照现有组件的样子（用户还没对第二版表态）。
- 被挡住的一步：只读拉 NAS 生产快照（`scripts/fitlogEnvArgs.mjs` 的 `--prod`）被自动模式权限拦了（Production Reads），**不要绕**。
  已写好的只读脚本：`C:\Users\30257\AppData\Local\Temp\claude\...\scratchpad\pull-exercise-library.mjs`（临时目录，可能已清）；
  需要用户放行或自己跑。用途：拿到真实自建动作 → 第 3 条新增候选去重 + 第 9 条数据体检。
- 顺带发现：本地 dev server 打开应用时 `GET /api/fitlog/state-dev` 返回 403
  （`this key is not allowed on /api/fitlog/state-dev`），开发环境同步不通，与本次无关，未处理。

## 1. 用户的 9 条原话（需求）

1. 转换重量单位后，只有再次滑动的时候先自动 round 到整数，再继续顺延原本滑动增减重量的逻辑
2. 新增 +5 -5 按钮，按当前单位 ±5，不管单位换算
3. 每个部位细分动作候选：选胸后上面出现一行 上胸 中胸 下胸 中缝 外轮廓，每个下面一列具体动作；标签逻辑一起优化
4. 组数数字实心逻辑优化 / 长按短按删除逻辑混乱，优化「这组做到哪了」系列功能
5. 检查手机端排版
6. 递减组默认减当前单位的 5（磅就 −5 磅，kg 就 −5kg）
7. 支持修改已有动作名称
8. 每个动作或器械支持不同练法，同一动作不同练法要能区分
9. 以上改动都要适配已有数据

## 2. 已拍板的决定（全部按推荐）

| # | 决定 |
|---|---|
| 1 | 只对「换算残留」取整：显示值**不是 0.5 的倍数**才算（132.28、61.24 取整；62.5、132.5 保留）。切单位、打字都不取整 |
| 2 | ±5 只在「下一组」那行露出（休息书签正下方那行）；残留值 ±5 前不取整（按用户原话，只有滑动取整） |
| 3 | 一个动作只落一列（单选细分）；自建动作没标的先进「未细分」；有氧/自由不分细分 |
| 4 | **只有点组号（或点「竭」）才算做完**，改值不再自动描实；删组统一**单击 + 撤销条**，取消长按 400ms |
| 7 | 理解为「改动作库里的名字，历史/PR/图表/备注/设置跟着走」（用户确认） |
| 8 | 一条记录只选一种练法（组合就起组合名如「窄握·暂停」）；新练法没历史时底稿空着，不借别的练法 |

## 3. 关键现状（读代码确认过的根因）

- 实心组号 = 「不是底稿」：`index.css` `.ledger-row.is-inked .set-num`（约 1078 行），`SetCapsule.tsx` 里 `!isGhost && !readOnly` 就挂 `is-inked`。
  新动作第一行、「添加组」（`NewWorkoutTab.tsx` onAddSet，克隆末行并剥 ghost）一出现就是实心。点非底稿行组号只闪「按住加子组」。
- 删除：底稿行「−」单击即抹，正式行长按 400ms，都没撤销；递减子组同理（`SetCapsule.tsx` SubSetRow）。
- 滑动：`useValueScrub.ts` 约 187 行 `Math.round((next + sign*step)*10)/10`，132.28 → 133.3 → 134.3。
  显示值来自 `formatWeight`（kg×2.20462 保留两位）。
- 递减默认：`SetCapsule.tsx` `handleAddSubSet` 用 −20% 取整 0.5kg（与单位无关，lbs 下出 105.82）。
- 改名（`ExercisePrefsContext.tsx`）四个坑：
  1. `resolveName` 只认原名 + 当前覆盖名 → 改第二次后，第一次改名期间的历史认不回来；
  2. 备注 / 动作设置（metric configs）/ 收藏按名字存，改名后全失效（有氧会变回重量×次数）；
  3. 覆盖层 `name` 整对象替换（`useExercisePickerData.ts` 约 58 行 `{...ex, ...override}` + 过滤 `ex.name[lang]`）→ 中文下改名后英文模式弹层里消失；
  4. `renameTag` 不调 `markPrefsUpdated` 也不推送；`renameExercise`/`addCustomExercise`/`deleteLibraryExercise` 也没 `markPrefsUpdated`。
- 统计口径不一致：`useFilteredExercises.ts` bestLifts 按存的原名聚合；收藏在弹层按解析名、在 `Dashboard.tsx`（约 337 行）按原名；`ScheduleView.tsx` 约 414 行直接显示原名。
- 同步：prefs 合并是逐 key 枚举（`FitlogSyncedPrefs` / read / write / `mergeFitlogPrefs` 四处，`services/fitlogRemote.ts`）。
  **新数据一律放进已有容器**（`exerciseOverrides[defId]`、`customExercises`、`customTags`），不新增 prefs key；备份 v2 是整份快照，自动带上。
- 弹层搜索被部位锁死：`ExercisePickerSheet` 结果 = 搜索 ∩ 部位 ∩ 器材，从印谱进来就选着部位，搜别的部位的动作提示「动作库里没有」。
- 有氧动作挂在腿部 / 背部（跑步机、划船机等 bodyPart=subLegs/subBack），会混进部位筛选。

## 4. 施工方案（逐条）

### 1 滑动先取整
`useValueScrub` 只在每次拖动的**第一档**：若当前值是残留（非 0.5 倍数）→ 往右 ceil、往左 floor，消耗这一档；之后照常 ±1/2/5/10。母组和子组共用。

### 6 递减组 −5
`handleAddSubSet`：取上一行（上一档递减，没有就母组）**显示值**，残留先 floor，再 −5 当前单位，下限 0，换回 kg 存。只影响新加的档。

### 4 组行状态与手势（+ 第 2 条一起做）
- 每行只有 待做（虚线印，复用 `ghost` 字段，旧数据零迁移）/ 做完（实心）。底稿、「添加组」新行、新动作第一行都从待做开始。
- 点组号：做完 ⇄ 待做随时切（不再限「零编辑才可退回」，`fromGhost` 可停写，读到忽略）；全零行点不实；点「竭」= 做完，取消竭只清竭。
- 改值只改值。为结束确认需要「改过但没点完成」的行：加工作台专用标记（如 `touched`），结束时剥掉；结束确认文案写明「N 组改过但没点完成，会丢弃」，可返回补点。
- 删组/子组：单击删除 + `toastUndo`，全部行一致。
- 长按组号加递减保留；短按不闪提示；长按完成后时间戳吞掉随后那次 click。
- 刊头分母、底栏组数、休息书签都按「不是底稿」算，自动跟着对。
- ±5：只在休息书签下方那一行露出 −5 / +5（当前单位，下限 0）。
- 要同步改规格 §6.6、§12.6。**新交互先出可玩 demo**（`docs/demos/`，照现有界面样子），用户拍板再写代码。

### 7 改名可靠化（第 3、8 条的地基，先做）
- 定义加曾用名 `aliases`（放 `exerciseOverrides[defId]`），改名时推入旧名；`resolveName` 认原名 + 曾用名 + 现名。**不改写任何历史记录**。
- 改名时把 notes / metricConfigs / starred 的键从旧名搬到新名；覆盖层 name 按语言合并；改名、改标签名都 `markPrefsUpdated` + 推送；与别的动作现名/曾用名重名时拒绝。
- 收口：bestLifts、收藏、Dashboard 历史筛选、计划页显示都按解析名。
- 入口：训练卡 ⋯ 菜单加「重命名」（弹层长按菜单里已有）。
- 内置动作改名（如「杠铃上斜卧推」→「上斜杠铃卧推」、疑似笔误「哑卧臂屈伸」→「仰卧臂屈伸」）旧名写进内置定义的 aliases。

### 3 部位细分 + 标签逻辑（照 demo 第二版）
- 数据：`ExerciseDefinition.region?: string`；系统细分表放 constants；自建细分进 `customTags`（新 category `region` + `parentPart`）。effective region 不属于当前部位就当未细分。
- 细分表（初稿，demo 总表里有完整动作清单）：胸 上胸/中胸/下胸/中缝/外轮廓；肩 前束/中束/后束；背 背阔/中背/斜方/下背；臂 二头/三头/前臂；腿 股四头/腘绳/臀/小腿/内收；核心 上腹/下腹/腹斜/稳定；全身/有氧/自由不分。
- 规则：换做法就换列的（上斜/下斜、低位/高位绳索、宽距）拆独立动作；只换手感的归第 8 条练法。
- 新增约 45 个候选内置动作（demo 里标「新」）——**入库前必须拿真实自建动作去重**（依赖 §0 被挡的那一步）。
- 弹层：选了有细分的部位且没在搜索 → 吸顶的细分表头 + 每列小卡（**用户定：跟部位/器材 chip 同一套样式**，灰底无边框粗体，已添加＝朱砂实底，不另起配色）；未细分用现有动作行列在下面；列内排序 收藏→最近→其余。搜索跨部位（当前部位组在前、「其他部位」在后）。有氧不进细分列。
- 长按菜单第一行「归到细分」；编辑标签 / 新动作弹窗加「细分」节（随部位联动，可内联新建）；标签管理加「细分标签」节（按部位分组，改名/新建/删自建，删除走撤销、动作回未细分）；搜索索引加细分名和曾用名。
- 等用户对 demo 第二版表态 / 贴回「复制修改」再落代码。

### 8 练法
- 定义上 `variants: {id, name}[]`（放 `exerciseOverrides[defId]`）+ `defaultVariantId`；记录上 `variantId` + 当时的 `variantName`。没带练法的旧记录归默认练法，不改历史。
- 训练卡刊头下眉批行显示练法，点开切换/新建；全是底稿时切换会重铺该练法上次的底稿。
- 底稿预填、PR、PR 列表、趋势图、时间线按「动作 + 练法」区分，显示「高位下拉 · 宽握」；备注与动作设置按动作共享。
- 少量内置练法预设（随第 3 条总表一起给用户审）。卡片切换交互先出 demo。

### 5 手机排版
- 开工前摸底：360 / 384（用户手机）/ 393 / 412 × 中英 × kg/lbs，JS 探针查横向溢出、截断、触达 <44px、字号 <11px、重叠；出清单，便宜的当场修。
- 已知风险：刊头右侧数字不换行挤动作名；3 指标以上账本行 375 下溢出；弹层两行 chip 铺开在 375 宽占约 255px；训练页顶栏英文 360 可能挤；弹层动作行标签 9px。
- 收尾回归一轮 + 真机 CDP 走查（见记忆 `phone-webview-cdp`）。

### 9 兼容已有数据（每步都守）
只加可选字段；不批量改写历史；新数据进已有同步容器；开工前导出完整备份；真实数据拷进 dev 环境逐阶段对照（训练 id 集合、组数、各动作 PR、图表序列）。新增中文文案要重切字体子集（`npm run build:fonts`）。e2e 补用例（旧格式数据做夹具），别信「全绿」。

## 5. 顺序

| 阶段 | 内容 | 先出 demo |
|---|---|---|
| 0 | 备份、真实数据体检（等放行）、手机排版摸底 | — |
| 1 | 第 1、6 条 + renameTag 等同步小 bug | — |
| 2 | 第 4 + 2 条 | 是 |
| 3 | 第 7 条 | — |
| 4 | 第 3 条（等 demo 确认） | 已有 |
| 5 | 第 8 条 | 卡片切换 |
| 6 | 第 5 条回归 + 真机 + 规格文档 | — |

每阶段单独提交。给用户的命令必须是 PowerShell 5.1 语法、一块一条（见 `CLAUDE.md`）。

## 6. 这次学到的（已写进知识库）

- `troubleshooting/功能 demo 照规格文档重画视觉，用户嫌丑——先照现有组件搬.md`
- `_memory/fitlog/demo-match-current-ui.md`：demo 照现在 App 搬（先看 `test-artifacts/*.png` 和组件真实类名），规格里没落地的视觉改动不夹进功能 demo，交付前同宽对照截图。
- 浏览器面板截图常超时，用 JS 探针核对。
