# 交接：审查剩余项（2026-10-07）

> **已归档（2026-10-20）。** 第一至三节和第三轮都已落地；第四、五节没做完的条目挪到了 `docs/TODO.md`，以那边为准。

上一个会话把用户 9 条 + 第二轮 2.1–2.6 做完、修了「练到一半接不回工作台」，发布了 **v1.1.0**（tag `v1.1.0` → `6823153`），
手机上装的是 personal 1.1.0。用户已在真机上确认手感没问题（审查第四节那几条真机项不用再测）。
这份文档列剩下的活，按顺序做；每条的根因、位置、证据在 `docs/audit-2026-10-06-details.md`，按反引号里的 id 搜。

## 先读

- `CLAUDE.md`（项目约定：给用户的命令是 PowerShell 5.1 语法、一块一条；知识库先查后动手；写回知识库的时机）
- `docs/audit-2026-10-06.md`：审查总报告。第五节是用户已拍板的决定
- `docs/handoff-2026-10-06-improvements.md`：「第二轮」一节是上轮所有拍板与代码落点
- `docs/design-ink-and-paper.md`：视觉规格；做 demo 时**照现有组件搬**，规格里没落地的视觉不夹带（知识库 `demo-match-current-ui`）

## 现状要点（动手前必须知道的）

- **工作台模型**（`src/utils/workbench.ts`）：全场一个指针，指针以上＝做完或跳过；指针由组状态推出、不存状态。
  组状态：做完（ghost=false）/ 待做（ghost）/ 跳过（ghost + skipped）。交替组＝`Exercise.altGroup` 相同、在数组里挨着。
  改了这里跑 `npm run check:workbench`（11 条纯函数自检，e2e 测不到这些）。
- **进行中的训练**（`WorkoutContext.findInProgress / restoreInProgress / hasDoneSets`）：按返回只离开页面；启动时接回 12 小时内动过、没结束的那场；
  一组都没做完的空场不进时间线、不计数。`App.tsx` 的 `inProgress`＝不在编辑旧训练 && 工作台有动作。
- **编辑旧训练**会把 `currentWorkout` 换成那场旧训练；退出编辑时重置工作台并 `restoreInProgress()`（`useWorkoutMutations.handleNewWorkoutBack`）。改编辑语义时别弄丢进行中的那场。
- **带正负的负荷**（`src/utils/load.ts`）：weight 存非负，号在组上的 `bodyweightMode`；纪录 / 容量按带符号算。
- **撤销开关**（`src/utils/undoPref.ts`）：删组 / 删训练里的动作默认**不给**撤销条；e2e 的 init 里把它打开了（原有用例测的是开着时的撤销）。
- **动作库**：做法（`ExerciseVariant`，可带 region / tags）、并入（`mergeExerciseInto`，`mergedInto` + `variantAliases`）、每个部位第一列「热身」。
  生产数据 10-07 已按 `docs/exercise-cleanup-2026-10-06.md` 整理过（写之前的整份备份在仓库外 `fitlog-backups/`）。

## 要做的（按顺序）

### 1. 编辑旧训练（会悄悄改历史，最要紧）

> **10-07 已做完（未提交）**。用户拍板四条：返回有改动才问「放弃这次的修改？」[放弃修改] / [继续编辑]；
> 「保存修改」不确认（只有改过数没点完成的组才问）、不加撤销、存完 toast「已保存」回来源页；编辑中被杀 / 刷新草稿丢掉；
> 新训练顶栏不再挂「未保存」，编辑态有差异才亮「已修改」。
> 落点：`WorkoutContext.setDraftWorkoutId`（自动落盘 / 切后台 / pagehide 都跳过草稿）+ `saveEditedWorkout`（不动 finishedAt）；
> `useWorkoutMutations` 进编辑时 `structuredClone`、`editKey`（按入册后的样子比，键排序）现算 `hasUnsavedChanges`、`exitEditing`；
> 结束 / 保存 / 判改动共用 `toRecordedExercises`。e2e 新增 `seeded-edit-history-draft`（退回逻辑后会红）。
> 期号：续练（「继续这场」）再结束仍会 +1（`edit-or-resume-finish-copy-and-vol` 的后一半），没动。

- `edit-history-cannot-discard`：每改一下都 `persistCurrentWorkout` 立刻写库，返回时点「放弃」什么都没放弃。
- `edit-history-false-unsaved`：什么都没改也亮「未保存」、返回还问。
- `edit-resets-finishedAt-resume-prompt` / `edit-history-end-semantics`：点「结束训练」改写 finishedAt、期号 +1、刊末页重放；10 分钟内再点开始训练会问「继续」那场旧的，选了就把今天的记录记进旧日期。
- 方向（审查建议，未拍板细节）：编辑态先改内存草稿、显式「保存」才写库，「放弃」真的丢；结束按钮在编辑态叫「保存修改」、不动 finishedAt、不出刊末页。
  注意 `set-update-mutates-shared-objects`：工作台的组更新已改成不可变写法（NewWorkoutTab.updateSet），但 `handleEditWorkout` 只做浅拷贝 —— 实现「放弃」时要深拷一份原样。
  拿不准的交互（比如编辑态的按钮文案、要不要撤销）先问用户，必要时出 demo。

### 2. 首选项（用户已拍板，先修两处底座）

> **10-07 底座（审查分批的第 1 批）已做完（未提交）**：
> - `services/appPrefs.ts`：一个对象 + 一个时间戳（`fitlog_app_prefs` / `fitlog_app_prefs_last_update`），合并＝新的一方整体赢、缺的字段用另一方补；
>   单位、语言已迁进去（旧字段 `fitlog_unit` / `fitlog_lang` 照写）。**以后的首选项只往 `AppPrefs` 里加字段**，读写合并不用再动。
> - `UserSettingsContext`：`changeUnit` / `changeLang`＝用户改（记 appPrefs + 推送）；`setUnit` / `setLang` 只是套用同步来的值。
> - `writePrefsToLocalStorage` 把合并后的 `prefsLastUpdateMs` 写回本机；旧格式备份导入时把单位 / 语言写进 appPrefs。
> - 头像：缩成 256×256 JPEG、只存 `fitlog_avatar_data_url` 一份（`fitlog_current_user` 不再带）；启动时把旧的大图缩一次（真机第一次打开新版就会缩）；换头像打 prefs 时间戳。
> - `appStorage.setItem` 写失败发一次 `fitlog:storage-write-failed`，App 弹提示。删了 `useUserSettings.ts`。
> - 重置账户**没有**清 appPrefs（单位 / 语言本来就不随重置清，清了反而和界面不一致）。
> - 自检 `npm run check:prefs`（哨兵 `scripts/prefsSentinel.ts` 用 `satisfies Required<FitlogSyncedPrefs>`，加了 key 不补哨兵 tsc 就红）；
>   e2e 新增 `seeded-unit-survives-stale-remote`、`seeded-avatar-small-single-copy`（都验过退回旧行为会红）。
> - 下一步是首选项弹层本身（第 2 批），先出 demo。

- 底座：`unit-lang-sync-revert`（切单位 / 语言不打时间戳、不推送，同步会翻回去）、`avatar-bloats-storage`（头像 base64 两份约 210 万字符，撑爆 localStorage）。
- 首选项本身：审查总报告第一节第 3 点（入口在「我的」页一行 + 整页底部弹层；第一批：±步长、递减每档 —— **kg 和 lbs 共用一个数**（用户定）、
  滑动手感、有氧默认记录项、距离单位、外观 / 动效 / 语言 / 周起始日、振动、删组撤销开关搬进来、数据区）。
- 存储：新增**一个** `appPrefs` 对象、自带时间戳（`customTags` / `exerciseOverrides` 共用一个时间戳整块比较，塞进去会互相覆盖）；要改的四处见明细。

### 3. 计划页挑动作换成训练页同一个弹层（用户已拍板）

- `plan-picker-legacy-library`、`plan-library-double-confirm`：删掉旧全屏动作库和它的「管理」模式，换成 `ExercisePickerSheet`（它已支持 `targetLabel`，可以加一个多选 / 目标参数）。
- 顺带：安排训练加到 3–4 个动作后保存按钮出屏、`plan-target-weight-unit`（目标重量没换算）、`plan-session-leaks-schedule-id`。

### 4. 剩下的 bug

先在代码里核一下是否已被前几轮顺手修掉（标了「核对」的尤其）。

- 数据：`new-ex-no-part-prefill` / `new-exercise-ignores-current-part` / `new-exercise-category-leaks-from-plan`；
  离线删除与导入 `prefs-deleted-keys-resurrect`、`import-merged-by-sync`；`measure-edit-leaks-into-add`、`measure-new-entry-unit-blank`、`goal-weight-autoupdate-kg`。
- 显示 / 统计：首页体重 delta 跟第一条比（总报告第二节）、`distance-speed-no-conversion`、`cardio-default-weight-reps`、`en-duplicate-renamed` / `en-renamed-duplicate`、
  `pr-list-weight-only`（自重已改成带正负显示，还差搜索 —— 核对）、`pr-edit-loses-place`。
- 手感：`input-appends-not-replaces`、改了第 1 组后面底稿不跟、`unsaved-indicator-misleading`、撤销按钮太小、`time-marginalia-opens-duration`、`exercise-delete-undo-stale`（核对）。
- 其余小项：总报告第三节按区域列的那些；`e2e-plan-in-real-data`（真实数据里一条 E2E 残留计划，删生产数据前问用户）。

### 5. 等用户决定（问一句就行，别自己定）

- `android/app/capacitor.build.gradle`、`android/capacitor.settings.gradle` 一直有未提交改动，不是我们改的：提交还是丢弃。
- 总报告第三节「候选删除的常驻说明文字」那几条，删不删。

## 第三轮（2026-10-11 起）：前端交互成本

用户在真机上多次健身后开的一轮，主题是「违反直觉的操作」和「交互成本大、能用更便宜的操作顶掉的」。第一条已做（未提交）：

- **点组号＝选中这一组 + 指针挪到它正下方**（`workbench.tapSetNum`，UI 在 `NewWorkoutTab.tapSetNum`）。
  以前要「先选中、再点一下才做完」，挪指针得精确拖书签（瞄起点、瞄终点两次精确操作）；现在一次点击顶掉这两样。
  语义：待做 → 像拖指针一样扫到它（同卡经过的做完、全零的跳过；别的卡沿用「当前卡剩下的跳过、那张卡挪上来」再扫）；
  刚做完的再点＝退回；更上面的做完组再点＝指针挪回去、后面的退回待做（值保留）；全零的只选中不动指针；跳过的原地补做。
  拖书签保留。自检 `npm run check:workbench` 加了 5 条；e2e `set-state-gestures` 改成新语义并加了「扫下去 / 挪回去」断言（退回旧逻辑会红）。
- **A1–A5 已做（未提交，2026-10-11，清单见 `audit-2026-10-11-interaction-cost.md`）**：
  - A1 点进格子即全选（`SetCapsule.selectOnFocus`，选中放下一帧）；次数格 `inputMode=numeric`；回车 / 「下一步」跳同一行下一格，最后一格收键盘（`focusNextOnEnter`）；
    `useKeyboardScroll` 只在格子不在可视视口里才滚。**真机要验的一点**：触屏点进去那一下会不会把全选收掉。
  - A2 改值带动后面「待做、没手动改过、原值相同」的底稿（`workbench.applySetUpdate`，`NewWorkoutTab.updateSet` 唯一入口；重量 / 次数各算各的，跟着变的不记 touched）。
  - A3 选中行 ±5 条右端「递减」按钮＝加一档递减（长按组号保留）。
  - A4 时长弹窗三个数字改成可打字的输入框（箭头保留）。
  - A5 卡头「12:13」改为打开 `ExerciseDateTimePickerModal` 改动作时间（`onOpenExerciseTime` 一路从 App 传下来），不再误开第 1 组时长。
  - 踩坑：全选之后鼠标在选中文字上按住拖＝原生拖放，Playwright 的 `mouse.move` 被卡死（e2e 卡在 `scrub-weight-residue-and-drop-set` 不报错）。
    修法是横拖手柄 `onDragStart` preventDefault（`useValueScrub.handlers`）。知识库有记。
  - 自检 +1（跟随规则 5 种情况）；e2e `set-state-gestures` 加了打字替换 / 跟随 / 回车 / 递减按钮的断言。
- **B1–B3、C1–C4 已做（未提交，2026-10-11；B4 按「单人自用不写教学文字」不做）**：
  - B1 弹层底部固定「完成 · 本次已加 N」（`picker-done`，整理态不显示）；B2 本次打开里加过的卡再点＝取消（`App.handlePickFromSheet` 按「动作::做法」记栈，
    `onPickExercise` 返回 false 时弹层不播添加动画）；连带进来的交替搭档弹 6 秒「已连带加入 X，撤销」（`addExerciseToWorkout` 的 `opts.onCreated`）；
    B3 训练名还是「练胸」这种自动填的（`BodyPartPicker.isPartTitle`）时，弹层换部位 chip 同步改名（`onPartChange`）。
  - C1 开新一场不再弹「继续刚才那场？」（`startWorkoutGuarded` 直接 proceed）；「继续这场」挪到时间线长按菜单，刚结束 10 分钟内才有（`timeline-resume`，`RESUME_WINDOW_MS` 导出）；
    结束确认去掉「当前单位」「将被添加到历史记录」两行。
  - C2 卡头「底稿 · M/D」（`prefill-from`）点开一行「上次 M/D · 60×8、60×8 kg」（`prefill-last`）；来源靠 `App.lastSessionFor` 按 `prefillFrom` 日期 + 名字找。
    注意：e2e 的 `timeline-copy-to-today` 注释说早先有过一条「底稿 · 上次 X月X日」眉批后来删了；这次是用户在交互成本审查里点头重加的，带展开。
  - C3 时间线卡片点按不再闪「按住出菜单」（`hint={false}`，hook 没动）。
  - C4 首页空状态「新建训练」走 `createNewWorkout()`；日程「标记跳过」给撤销条；进编辑时工作台有进行中的一场就 toast 一句；交替卡刊头补了拖排序的进度线；删 PR 记录 / 删体重记录去掉确认框（留撤销条）。
  - e2e：`seeded-picker-toggle-done-bar-prefill`（B1/B2/C2）、`open-workout-via-fab` 改成断言不弹窗、`resume-recent-workout` / `seeded-resumed-emptied-keeps-workout` 改走长按菜单；
    长按 helper 先把卡片滚到视口中间（贴顶会被吸顶页头盖住，按下去落在页头上）。60/60。

## 验证与交付

- 改完：`npx tsc --noEmit -p .`、`npm run check:workbench`、e2e（`localhost:3000` 起 `fitlog-dev`，`E2E_CHROMIUM` 指向
  `%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-1228\…\chrome-headless-shell.exe`；接口在测试里全部 mock，不碰 NAS）、`npm run build`。
  **e2e 全绿 ≠ 测到了**：改了行为先想「哪条用例会红」，测不到的补用例或补自检。
- 实机走查用独立开发库：`node scripts/dev-with-local-db.mjs --reset`（3100 端口，种子是生产快照拷贝），launch.json 里叫 `fitlog-devdb`。
- 装手机：走 `android-build` skill。手机上是**签名版 personal**，别走 debug 包（签名不一致要卸载）：
  `npm run build:release; npx cap sync android; npm run apk:personal` 再 `adb install -r`。
  **装之前解包确认含本次新文案、看 APK 修改时间**；每次用带时间戳的新日志文件名（后台 gradle 会锁住旧日志，构建没跑却读到旧的「完成」，项目记忆 `apk-build-verify-content`）。
- 改生产数据：先拉最新、整份备份到 `fitlog-backups/`、开发库演练、用户确认后再写，写完回读核对。
- 提交 / 推送 / 发版都等用户开口；发版走 `docs/release-signing.md` 的七步清单（下一版 versionCode 4）。
- 拍板、踩坑、被用户纠正时按 `CLAUDE.md` 写回知识库。
