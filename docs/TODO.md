# 待办

2026-10-20 整理。来源有三处：`docs/archive/handoff-2026-10-07-remaining.md` §4 / §5 里还没做完的、
`docs/design-plates.md` §4 阶段二与 §5 真机项，以及零散记下的几件小事。
带反引号 id 的条目，根因、场景、证据都在 `docs/archive/audit-2026-10-06-details.md`，搜 id 就能找到。
那份明细里的行号是 10-06 的，代码后来改动很多，**动手前以下面「现状」一栏为准**，再自己核一遍。

做完一条就从这里删掉，落点写进提交说明。

## 数据会错的

| id | 问题 | 现状（2026-10-20 核对） |
|---|---|---|
| `new-ex-no-part-prefill` / `new-exercise-ignores-current-part` | 从选动作弹层点「新动作」不带当前部位 / 细分；在有氧轴上建也默认力量训练 | 仍在。`App.tsx` `openCreateCustomExerciseModal` 把部位、细分清空，类别固定 `STRENGTH`；弹层只传名字 |
| `prefs-deleted-keys-resurrect` | 离线清空的备注、删掉的标签改名 / 覆盖层键，下次拉取会被合并回来；本机空数组被当成「没数据」整组取远端 | 仍在。`services/fitlogRemote.ts` `pickObject` 本机赢时仍是 `{...remote, ...local}`，`pickArray` 空数组仍回落远端；prefs 没有键级墓碑 |
| `import-merged-by-sync` | 联着同步时导入备份不是「整个替换」：重载后的拉取把服务器数据又并回来 | 仍在。`useImportData` 导入后直接 `location.reload()`，没有先推送或打新时间戳 |
| `measure-edit-leaks-into-add` | 围度：编辑一条后取消，再点「添加」打开的仍是「修改记录」，保存会覆盖旧数据 | 仍在。`App.tsx` 里 `MeasurementModal` 的 `onClose` 只关窗，`onShowMeasureModal` 直接 `setShowMeasureModal(true)`，都不清 `editingMeasurementId` |
| `measure-new-entry-unit-blank` | 新加一条围度时单位是空的 | 仍在。`useMeasurementLog.openAddMeasurementEntry` 里 `unit: ''` |
| `goal-weight-autoupdate-kg` | 记体重时把 kg 数写进 lbs 目标的当前值，也不取整 | 仍在。`useWeightLog.ts` 写的是 `currentValue: weightKg` |
| `e2e-plan-in-real-data` | 真实数据里残留一条 e2e 计划 `E2E_PLAN_1779439703540`（2026-05-22） | 数据问题，代码核不了。**删生产数据前先问用户**，按「改生产数据」流程走（拉最新 → 整份备份 → 开发库演练 → 确认后写 → 回读） |
| `en-duplicate-renamed` / `en-renamed-duplicate` | 英文界面出现两个同名自建动作：中文改过名的，英文名没跟着改 | 代码已修（自建动作改名两种语言一起改，旧名留作别名）。**已有数据没修**：改名前只写了 `cn` 的覆盖层（如自建 `1779420343792`）在英文下可能仍重名，要一次性修正或在弹层里区分 |

## 显示 / 统计

| id | 问题 | 现状 |
|---|---|---|
| `weight-30d-delta-wrong` | 首页体重的「30 天」差值其实是跟第一条记录比 | 仍在。`Dashboard.tsx` 里倒序后 `find` 找到的是截止日前最老的一条，找不到时也回落到第一条 |
| `cardio-default-weight-reps` | 有氧动作没配记录维度时默认「重量 × 次数」 | 仍在。`ExercisePrefsContext` 回落 `['weight', 'reps']`，不看类别 |
| `pr-list-weight-only` | PR 列表：自重 / 带符号负荷已能正确显示，**还缺搜索** | 搜索仍没有。`Dashboard.tsx` 直接 `bestLifts.map`，没有搜索框也没分组 |
| `pr-edit-loses-place` | 在 PR 历史里点编辑，返回后 PR 卡被收起；编辑页也不定位到那个动作 | 仍在。`App.tsx` 里 `onEnterEditWorkout` 仍把 `selectedPRProject` 清掉 |

## 「杠铃片」阶段二（`docs/design-plates.md` §4）

阶段一和馆档案已落地（2.0.0）。片库设置随馆档案做掉了（选馆弹窗里按馆登记片子），其余还没开始：

- 记录时间线的器材缩略图
- 计划页
- 我的：上片里程碑、热力图的镁粉点
- 选动作弹层里的器材图标
- 自定义器材的画法
- 底部导航的部位印章扇改造

## 等真机验证

- 竖向拖动重量和页面滚动会不会打架（`design-plates.md` §5）。
- 得意黑在 20px 动作名上的观感（同上）。
- 触屏点进组格时，「点进去即全选」会不会被那一下触摸收掉（交互成本第三轮 A1 留下的）。

## 等用户决定

- 自建部位「激活背阔」「激活中下背」各只挂 1 个动作，要不要转成背部下的「热身」细分（审查总报告第五节第 7 条）。
  `docs/archive/exercise-cleanup-2026-10-06.md` 第 1–3 条写过这个方案，交接文档说 10-07 已按那份清单整理过生产数据；
  先在真实数据里确认这两个部位是不是已经没了，没了就把这条删掉。
- 审查总报告第三节「候选删除的常驻说明文字」（`teaching-text-candidates`）：「· 单选」「· 多选」「· 数字为使用数」、空训练的提示语，删不删。
  目前都还在（如 `EditExerciseTagsModal.tsx` 的「· 单选」）。

## 其它小事

- **安卓返回键**：没装 `@capacitor/app`，系统返回键没有接管（关弹层 / 退出编辑这类返回语义靠不上）。接的时候注意和「按返回只离开页面、不丢进行中的训练」的现有约定对齐。
- **`.env.local` 清掉旧键**：本机 `.env.local` 里还留着已经不用的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_GEMINI_API_KEY`，代码里没有任何地方读它们；
  另有一条 `FITLOG_API_KEY_DEV`：这是服务端（`docs/archive/nas-server-prompt.md`）的变量名，客户端只认 `VITE_API_KEY_DEV`，仓库里也没有脚本读它。
  如果本意是给开发端点配 key，要改名成 `VITE_API_KEY_DEV`，否则开发环境会回落到生产 key、失去服务端的端点隔离。
  文件不进仓库，只能在本机改。
