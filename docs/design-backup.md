# 数据安全设计：自动备份、重装恢复、CSV 导出、Strong / Hevy 导入

2026-10-20 · 对应 `docs/next-round-2026-10-20.md` §4、§7.4 · **状态：已确认（全部按建议），已实现**

这一轮做：本机自动快照 + 文件夹授权、重装后恢复、CSV 导出、Strong / Hevy CSV 导入。
不做：训记导入、WebDAV、Google Drive、百度 / 阿里云盘。不加 INTERNET 权限。

---

## 0. 调研结论

### 0.1 「选一次文件夹、长期读写」没有现成可用的插件，自写一个

| 候选 | 版本 / 许可 | 结论 |
|---|---|---|
| `@capacitor/filesystem`（已装） | 官方 | 不支持选文件夹，也不认 `content://` 树 URI |
| `@capawesome/capacitor-file-picker` | 8.1.1，MIT，Capacitor ≥8，10-19 刚更新 | 有 `pickDirectory()`，但源码里**没有** `takePersistableUriPermission`，也不能指定初始目录、不能在树里读写文件。重启 / 下次启动就没权限了 |
| `@capgo/capacitor-file-picker` | 8.2.7，MPL-2.0 | 同上，只发起 `ACTION_OPEN_DOCUMENT_TREE`，不持久化授权、不读写 |
| Capawesome File Manager | 付费订阅、闭源 | 能做，但闭源付费，不考虑 |

**自写一个小原生插件 `FitlogFolder`**（Java，放 `android/app/src/main/java/.../FitlogFolderPlugin.java`，在 `MainActivity` 里 `registerPlugin`）。只用 Android 框架自带的 `DocumentsContract` / `ContentResolver`，不引新依赖，不要任何权限声明（SAF 本身不需要存储权限）。

接口（约 250 行 Java + 60 行 TS 包装）：

| 方法 | 做什么 |
|---|---|
| `pickFolder({ initial: 'documents' \| 'documents/fitlog' })` | `ACTION_OPEN_DOCUMENT_TREE` + `EXTRA_INITIAL_URI`（API 26+）打开在「文档」或「文档/fitlog」；返回后 `takePersistableUriPermission(READ\|WRITE)`。返回 `{ treeUri, displayPath }`，用户取消返回 `{ cancelled: true }` |
| `ensureSubfolder(treeUri, 'fitlog')` | 选的是「文档」时在里面建 / 复用 `fitlog` 子目录（见 §2） |
| `hasAccess(treeUri)` | 查 `getPersistedUriPermissions()` 里还有没有它（用户可能在系统设置里收回） |
| `list(dirUri)` | 列文件：名字、大小、修改时间、文档 URI |
| `writeText(dirUri, name, text)` | 新建文件写入（不覆盖已有文件，见 §1.3） |
| `readText(docUri)` | 读回 |
| `delete(docUri)` | 删旧备份（只删自己命名规则内的文件） |

工作量：插件 + TS 包装 + 浏览器里的 mock 实现（给 e2e 用，见 §8）约半天；真机调通、重装恢复实测另算半天。

### 0.2 Strong 的 CSV

没有官方文档，以下来自几个开源导入器的实现（[ryot](https://github.com/IgnisDa/ryot) 的 strong-app 导入器、iron-fitness 的样本说明）互相印证：

- **分隔符**：安卓版导出用 `;`，iOS 版用 `,`。按表头那行判断。
- 列：`Date; Workout Name; Duration; Exercise Name; Set Order; Weight; Reps; Distance; Seconds; Notes; Workout Notes; RPE`。
  不同版本的变体：`Duration (sec)`、`Weight (kg)`、`Distance (m)`；有的版本多出 `Weight Unit` / `Distance Unit` 列。
- `Date`：`2024-03-14 18:05:12`（本地时间，无时区）。同一场训练的每一行 `Date` 相同，按它分组。
- `Duration`：`1h 5m` 这类文字，或 `Duration (sec)` 下的秒数。
- `Set Order`：数字 = 正式组；`W` 热身、`F` 力竭、`D` 递减；`Rest Timer`、`Note` 是非组行，跳过。
- **单位**：只有表头是 `Weight` 且没有 `Weight Unit` 列时才不知道单位 —— 这正是已知的坑，导入时按动作让用户确认（§6.3）。表头带 `(kg)` / `(lbs)` 或有 `Weight Unit` 列就直接用。
- Hevy 官方说明 Strong 的导出要是英文界面导出的才认 —— 中文界面导出的表头可能是中文，第一版只认英文表头，认不出就明说。

### 0.3 Hevy 的 CSV

来自 [liftosaur](https://github.com/astashov/liftosaur)（`importFromHevy.ts`）、ryot、LiftShift 的实现：

- 逗号分隔、字段带双引号。
- 列：`title, start_time, end_time, description, exercise_title, superset_id, exercise_notes, set_index, set_type, weight_kg | weight_lbs, reps, distance_km | distance_miles, duration_seconds, rpe`。
- **单位看表头**：`weight_kg` 还是 `weight_lbs` —— 跟导出人当时的设置走，整份文件一个单位，不用问。
- `start_time`：`18 Oct 2025, 08:47` 这种英文月份格式（也兼容 ISO）。按 `title + start_time` 分组。
- `set_type`：`normal` / `warmup` / `failure` / `dropset`。

---

## 1. 自动备份

### 1.1 时机

- **训练结束后**：`finishWorkout` 保存成功后排一次（防抖 5 秒，连续操作只写一份）。
- **每天兜底**：App 启动 / 回到前台时，如果距上次成功备份超过 24 小时**且**数据有变化，写一份。
  「有变化」= 快照指纹（各表条数 + 最大 `updatedAt`）和上次备份时记下的不同。没变就不写，免得一堆一模一样的文件。
- **导入 / 恢复之后**：立刻写一份，留住新状态。
- **空数据不自动备份**：本地 0 次训练时不写、也不清理旧文件。重装后还没恢复那段时间如果照常备份 + 清理，会拿空快照把好备份挤掉。

不做后台定时任务（WorkManager）：训练记录只会在 App 打开时产生，上面三个时机已经覆盖。

### 1.2 内容

完整快照，**只走 `buildBackupFile()`**，和手动导出同一份 JSON（含 `prs`、`scheduledWorkouts`、`prefs`、墓碑）。不另列字段。

### 1.3 命名与写法

- 文件名：`fitlog-backup-2026-10-20-1832.json`（本地时间到分钟）。dev 数据环境写成 `fitlog-dev-backup-…`，恢复列表里会标出来，避免把测试数据恢复进正式环境。
- **永远新建，不覆盖**：写新文件 → 读回核对 → 通过之后才清理旧的。不在原文件上截断重写，写到一半崩了也不会毁掉已有的那份。

### 1.4 「备份成功」的判据

写完立刻 `readText` 读回 → `parseBackupFile` → 逐项比对条数（训练、体重、目标、计划、PR、自定义动作）和 `exportedAt` 一致，**全部对上才算成功**，才更新「上次备份」、才清理旧文件。

任何一步失败都记成失败并如实显示原因：没选文件夹 / 权限被收回 / 写入失败 / 读回不一致。失败时不清理任何旧文件。

### 1.5 保留几份

- 同一天只留最新一份；
- 最近 **14 天**每天一份；
- 再往前每月留一份（当月最早那份），留 **12 个月**。

满打满算约 26 个文件；按现在几百 KB 一份，总共十几 MB。

**清理保险**：新备份的训练次数比上一份少一半以上时（误删、数据出事），这次只写不清理，设置页提示「这次备份的训练次数比上次少很多，旧备份都保留着」。只删符合 `fitlog-backup-*.json` 命名的文件，用户自己放进来的文件不碰。

---

## 2. 首次引导：选备份文件夹

- 时机：**第一次结束训练之后**弹一次（这时才有值得保护的东西）；设置页里随时可以选。单机版的首次启动提示（`FirstRunNotice`）里加一句「训练记录可以自动备份到手机文件夹，卸载也不丢」。
- 弹窗文案大意：「让训练记录卸载 App 也不丢？选一个文件夹，之后每次练完自动存一份。」按钮：「选择文件夹」/「以后再说」。
- 系统选择器**打开在「文档」**，用户直接点「使用此文件夹」，App 在里面建 `fitlog` 子目录 —— 用户不用自己新建文件夹。
  - 选中的文件夹本身叫 `fitlog`，或里面已经有 fitlog 备份 → 直接用它；
  - 否则在里面建 / 复用 `fitlog` 子目录。
- 用户也可以选 SD 卡、坚果云 / Syncthing 同步的目录，这样 App 不联网也能做到云端备份。设置页「更换文件夹」旁边一句话说明这个用法。
- 选完立刻做第一份备份并核对，弹窗里显示结果（成功：「已备份到 文档/fitlog」；失败：原因）。

## 3. 重装后恢复

1. 启动时本地 0 次训练、也没设过备份文件夹（原生平台）→ 首页空状态出一张卡：「以前用过 fitlog？从备份恢复」。设置页的「从备份恢复」任何时候都能用。
2. 点了 → 系统选择器**打开在「文档/fitlog」** → 点「使用此文件夹」（选「文档」也行，按 §2 的规则找到 `fitlog`）。
3. App 列出能解析的备份，默认取最新一份，先显示摘要：
   「找到备份：312 次训练，最后一次 10 月 18 日 · 备份于 10 月 18 日 21:04」，下面「换一份」可以展开列表（每份标日期、训练次数，dev 备份单独标出）。
   也认旧的手动导出文件 `FitTracker_Backup_*.json`。
4. 确认 → 恢复 → 这个文件夹自动设成备份文件夹（授权刚拿到，省得再选一次）→ 重载。

### 3.1 覆盖还是合并

- **本地没有数据**（重装的典型情况）：直接覆盖，走现有 `applyBackup()`（先存回滚槽再写）。
- **本地已有数据**（设置页里主动恢复，或者重装后先练了一次才想起来恢复）：
  - 备份是新格式（带墓碑）→ 两个选项：**「合并（推荐）」** 走 `mergeLocalWithRemote(local, backup)` —— 和服务端同步同一套按 id 取较新 + 墓碑过滤，删掉过的不会被捞回来；**「用备份覆盖」** 走 `applyBackup()`。
  - 备份是旧格式（没有墓碑）→ 只给覆盖（按 id 合并会把删掉的训练捞回来，现有 `useImportData` 注释里写着这条）。
  - 两条路都先存回滚槽，设置页「撤销上次导入」照常可用。

## 4. 设置页的展示

PrefsSheet 现有的「数据」区改成：

```
自动备份
  上次备份：今天 18:32 · 文档/fitlog · 共 12 份        ← 成功：普通颜色
  上次备份失败：没有文件夹权限 [重新选择]               ← 失败：红色，带原因和动作
  未开启 · 卸载 App 会丢失全部记录 [选择文件夹]          ← 没选过
  [立即备份]  [更换文件夹]  [从备份恢复]

导出
  [导出 CSV（Excel 可直接打开）]
  [导出完整备份（JSON）]        ← 现有按钮
导入
  [从 Strong / Hevy 导入]
  [从备份文件恢复]              ← 现有按钮
  撤销上次导入                  ← 现有
```

「上次备份」只来自读回核对通过的那次；时间、位置、份数都是实际值。备份文件夹 URI 和备份状态存在本机 localStorage（按数据环境加前缀），**不进同步快照**：它是这台手机的设置，不该跟到另一台。
浏览器里（非原生）不显示自动备份区，其余照常。

## 5. CSV 导出

- **一行一组**（递减子组也各占一行，标「递减」）。按日期升序。
- 编码 **UTF-8 带 BOM**、CRLF 换行、按 RFC 4180 加引号 —— Windows Excel 双击打开中文不乱码。
- 文件名：`fitlog-训练记录-2026-10-20.csv`。走现有 `saveTextFile`（分享面板）；设了备份文件夹时多一个「存到备份文件夹」。
- 表头跟 App 语言（中文 / 英文）。列：

| 列 | 例 | 说明 |
|---|---|---|
| 日期 | 2026-10-18 | 单独一列，Excel 认得是日期 |
| 开始时间 | 18:05 | |
| 训练 | 推日 | 训练标题 |
| 场地 | F4L | 没有留空 |
| 动作 | 杠铃卧推 | 当前语言的名字 |
| 做法 | 窄握 | 没有留空 |
| 部位 | 胸 | |
| 细分 | 中下胸 / 上胸 | 主细分在前，多个用「 / 」隔开（2026-10-21 加） |
| 组序 | 1 | 子组写 `2.1`、`2.2` |
| 类型 | 正式 / 递减 | |
| 重量 | 100 | 按登记时的单位（`plateUnit`），辅助为负 |
| 单位 | kg | |
| 重量(kg) | 100 | 统一换算成 kg，方便直接算 |
| 次数 | 5 | |
| 力竭 | 是 | |
| 时长(秒) | | 有氧 / 计时组 |
| 距离 | | |
| 距离单位 | | |
| 训练备注 | | 每行都带，方便筛选 |

- 体重、围度这一轮不进 CSV（完整数据在 JSON 备份里）；要的话下一轮加第二个文件。
- 附「怎么交给 AI 分析」的说明：放在导出成功的提示里一句话，不做单独页面。

## 6. Strong / Hevy 导入

### 6.1 流程

1. 设置页「从 Strong / Hevy 导入」→ 选 CSV 文件 → 自动识别来源（按表头特征：Hevy 有 `exercise_title` + `set_type`；Strong 有 `Exercise Name` + `Set Order`）。认不出就明说「只认 Strong / Hevy 英文界面导出的 CSV」。
2. 解析 → 进确认页（§6.3）→ 确认后写入 → 显示「已导入 N 次训练」→ 写一份自动备份。

### 6.2 映射

| 来源 | fitlog |
|---|---|
| 一场训练（Strong 按 `Date`，Hevy 按 `title + start_time`） | 一条 `WorkoutSession`，`date` / `startTime` / `endTime`（Strong 用 Duration 推算）、`title`、`notes` |
| 动作名 | 先按英文名 / 曾用名对内置动作（「Bench Press (Barbell)」这类括号里的器材一并比对）；对不上就**新建自定义动作**。导错的可以事后用现有的「并入另一个动作」合过去 |
| 正式组 | `SetLog`：`weight` 换算成 kg 存，`plateUnit` 记来源单位 |
| 力竭组（Strong `F` / Hevy `failure`） | 正式组 + `toFailure: true` |
| 递减组（Strong `D` / Hevy `dropset`） | 挂到前一个正式组的 `subSets` |
| 热身组（`W` / `warmup`） | **默认不导入**（fitlog 没有热身组概念，混进去会拉低容量统计的意义），确认页可以勾选「热身组也导入（当正式组）」 |
| `Seconds` / `duration_seconds`、`Distance` | `duration`、`distance` / `distanceUnit` |
| RPE、单组备注 | 并进该动作那一场的备注（fitlog 没有 RPE 字段，不丢原文） |
| `Rest Timer`、`Note` 行 | 跳过 |

**重复导入不重复**：训练 id 由「来源 + 开始时间 + 标题」算哈希得出，同一份文件导两次只是覆盖那几条，不会翻倍。

**写入语义**：只新增 / 覆盖导入的那些训练和新建的自定义动作，现有数据不动；写之前存回滚槽，可撤销。

### 6.3 确认页（单位确认）

```
从 Strong 导入 · 148 次训练 · 2023-05-02 至 2026-09-30
⚠ 这份文件没有写单位，请确认每个动作当时用的是 kg 还是 lb

全部设为  [kg] [lb]
──────────────────────────────────────
卧推（杠铃）  ← Bench Press (Barbell)   62 组 · 最重 225   [kg|lb]
深蹲（杠铃）  ← Squat (Barbell)          58 组 · 最重 315   [kg|lb]
Cable Fly    新建自定义动作               20 组 · 最重 40    [kg|lb]
...
☐ 热身组也导入（当正式组）
               [导入 148 次训练]
```

- 单位默认取 App 当前单位；每个动作一个开关。显示「最重 X」是为了让人一眼看出来（225 kg 卧推显然不对）。
- 单位已知（Hevy、带单位列的 Strong）时不出单位开关，只显示一行「单位：lb（来自文件）」。

## 7. 动哪些文件（尽量不碰另一个会话在改的地方）

- 新增：`services/fitlogFolder.ts`（插件包装 + web mock）、`services/fitlogAutoBackup.ts`（时机、命名、核对、保留）、`services/fitlogCsvExport.ts`、`services/fitlogCsvImport.ts`（解析 + 映射，纯函数）、`src/hooks/useAutoBackup.ts`、恢复 / 导入确认的两个组件、`android/.../FitlogFolderPlugin.java`。
- 改：`PrefsSheet.tsx` 数据区、`ProfileTab.tsx`（若数据入口在这）、`WorkoutContext.finishWorkout` 后加一行触发、`MainActivity.java` 注册插件、首页空状态加恢复卡、`FirstRunNotice` 加一句、`CHANGELOG`。
- **不改** `types.ts` / `AppPrefs` / `FitlogSyncedPrefs`：备份状态存本机，不进同步。

## 8. 验证

- `npm run typecheck`、`npm run e2e`、`npm run build`。
- e2e：插件在浏览器里有 mock 实现（内存里的「文件夹」），用来测：结束训练 → 自动备份 → 读回核对 → 保留规则；清空数据 → 恢复卡 → 摘要 → 恢复后条数一致；故意让 mock 读回内容不一致 → 必须显示失败。CSV 导出解析回来逐行比对；Strong（`;` 与 `,` 两种）/ Hevy 样本导入后条数、单位换算正确。
- 真机（android-build 技能，打完解包核对是本次代码）：选文件夹 → 文件真的出现在「文档/fitlog」（adb 列目录核对）→ **卸载重装** → 两下点击恢复 → 条数一致。
  **卸载重装只在测试包 / dev 数据环境上做**，动手前先确认手机上的真实数据有一份核对过的备份。

## 决定（2026-10-20 用户确认：全部按建议）

1. 备份时机：训练结束 + 每天兜底（有变化才写）。
2. 保留：14 天每天一份 + 12 个月每月一份。
3. 本地已有数据时恢复：新格式给「合并（推荐）/ 覆盖」，旧格式只能覆盖。
4. 热身组默认不导入。
5. CSV 表头跟 App 语言走。

## 实现与验证（2026-10-20）

- 代码：`services/fitlogFolder.ts`（插件包装 + 浏览器 mock）、`fitlogAutoBackup.ts`、`fitlogCsvExport.ts`、`fitlogCsvImport.ts`；
  `src/hooks/useDataSafety.ts`；`src/components/data/*`；原生 `FitlogFolderPlugin.java`。
- `npm run typecheck`、`npm run build` 通过；`scripts/e2e-smoke.mjs` 64/64，`scripts/e2e-backup.mjs` 10/10
  （保留规则、读回不一致 / 没权限报失败、卸载后恢复、合并不捞回墓碑、CSV 行数与 BOM、Strong 两种分隔符、Hevy 单位、重复导入不翻倍）。
- 真机（小米 15 Ultra，Android 16，solo 独立测试包 `com.myron.fittracker.backuptest`，无联网权限）：
  选文件夹 → `/sdcard/Documents/fitlog/` 出现备份，adb 读出是完整快照、4 场训练；CSV 存进同一目录，带 BOM；
  **卸载 → 文件还在 → 重装 → 首次提示里点「从备份恢复」→ 系统选择器直接打开在 Documents › fitlog → 使用此文件夹 → 允许 →
  摘要「找到备份：4 次训练，最后一次 10 月 19 日」→ 恢复 → 4 场全部回来**，文件夹自动接上、补写一份备份、同日旧份按规则清理。
- 真机没测：Strong / Hevy 导入走的是和 JSON 导入同一个 `<input type=file>`（那条路 2026-09 已在真机验过），只在浏览器里测了。

## 后续

- 体重 / 围度进 CSV（第二个文件）。
- 训记导入、WebDAV、云盘：这一轮不做。
