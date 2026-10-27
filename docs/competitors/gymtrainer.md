# 健身房训练（Gym Workout / Gym Log，Leap Fitness）竞品调研 v2

> 包名 `gymworkout.gym.gymlog.gymtrainer`，版本 1.6.5，原生 Android（View 体系，UI 树完整可读）。
> **本次在安卓模拟器上实测**（emulator-5554，1440×3200 @ 600 dpi，与真机同为 384×853 dp；系统语言英文，所以界面是英文）。APK 是从手机上 Play 安装的同版本侧载过来的；开测前 `pm clear`，是真正的首次启动。2026-10-26 按 brief v2 实测。
> 模拟器上 AdMob 只出「Test Ad」测试广告，广告**出现的时机和关闭方式**可信，广告内容不代表真机。

## 1. 概况

- **定位**：Leap Fitness 出品的「健身房版」训练 app。卖点是问卷生成的 30 天训练计划（4 套，按天解锁）+ 自建训练（Custom）+ 记录器。记录器做得很「大按钮」：一个 `LOG NEXT SET` 主按钮一路点下去。附带 510 个动作的图解库、1RM 记录页、周报和肌群热力图。没有社交、没有身体围度/照片、没有 AI 教练对话。
- **付费**：**全部功能免费，靠广告**。唯一的付费项是「Remove Ads」**一次性 $5.99**（划线原价 $10.79），没有订阅、没有锁功能。广告是全屏插页（AdMob），没见到横幅广告。
- **语言**：17 种界面语言，含简体中文 / 繁體中文（本次跟随系统为英文）。动作名称随语言走（本次为英文）。
- **登录**：**不需要**。欢迎页有一个可选的「Continue with your existing account」；「Me → Backup & Restore」要登录 Google 账号才能云同步。数据默认只在本机。

## 2. 上手流程（首次启动实测）

| # | 屏 | 问的是什么 | 输入方式 | 必填/可跳 | 默认值 | 我的操作 |
|---|---|---|---|---|---|---|
| 1 | 欢迎页 | — | `START` / 「Continue with your existing account」 | — | — | START |
| 2 | 性别 | Male / Female | 两张大卡片，点了直接进下一屏 | 必填 | 无 | Male |
| 3 | 主要目标 | 6 选 1（Get Stronger、Build Muscle Mass…） | 单选 + Next | 必填 | 无 | Build Muscle Mass |
| 4 | 重点部位 | 8 个标签（Back/Shoulder/Arm/Chest/Abs/Butt/Leg/Full Body） | 多选 + Next | 必填 | 无 | Full Body |
| 5 | 身高 | cm/ft 切换 + 竖向刻度尺 | 拖动刻度尺 | 有默认 | 175 cm | 拖到 178 |
| 6 | 当前体重 | kg/lbs + 横向刻度尺，实时显示 BMI | 拖动 | 有默认 | 75 kg | 保留 |
| 7 | 目标体重 | 刻度尺 +「REASONABLE TARGET! 你会减重 4%」 | 拖动 | 有默认 | 72 kg（增肌目标下也默认减重） | 保留 |
| 8 | 训练水平 | Beginner / Intermediate / Advanced | 单选 + Next | 必填 | 无 | Intermediate |
| 9 | **估算 1RM** | 基准动作（默认 Bench Press，可换）+「举 X kg 能做 Y 次」→ 实时算出 1RM | **系统数字键盘**，光标落在数字中间、原值不选中 | 可跳（底部「I'm a beginner and I don't know.」） | 30 kg × 5 → 35 | 填 60 × 8 → 76 kg |
| 10 | 训练频率 | 3/4/5 天/周、More Options + 每周起始日（7 选 1） | 两组单选，都选了 Next 才可点 | 必填 | 无 | 4 天、周一 |
| 11 | 器材 | All Equipment / Barbells / Dumbbells / Kettlebells / Weight Machines / None | 单选 + Next | 必填 | 无 | All Equipment |
| 12 | 训练地点 | Large Gym / Small Gym / Garage Gym / At Home | 单选 + Next | 必填 | 无 | Large Gym |
| 13 | 最大困难 | 3 选 1（缺动力 / 缺指导 / 容易腻） | 单选 + Next（没选时 Next 无反应） | 必填 | 无 | Lack clear workout guidance |
| 14 | 训练方式 | I want a plan / I'm still figuring it out / **I train my way（Just need a simple way to log my workouts）** | 单选 + Next | 必填 | 无 | I train my way |
| 15 | 假加载「Tailoring Your Experience…」 | 4 条进度条 + 4.9 分徽章 | 强制等待 | — | — | 等约 6–8 s |
| 16 | 「Your Custom Setup Is Ready!」 | 体重曲线（75 → 73 kg / 4 周）+ About You | `Start Now` | — | — | Start Now |
| 17 | **全屏插页广告** | — | 右上角 ✕ 约 5–8 s 后才出现（✕ 约 24×24 dp） | 必须等 | — | 等后点 ✕ |
| → | 落到 **Custom 标签**空状态「Create your first custom workout」 | | | | | |

另外两段「首次才有」的打扰，我在 explore 阶段先触发掉了，没计进 T1：
- **第一次在自建训练里加动作**之后弹「请给我们评分」（5 星 + RATE），用返回键关掉（+1 步）。
- **第一次开始训练**时有 7 步教学浮层（Hello → Log next set → 勾选框也能记组 → More actions → 休息计时默认关闭 → Edit your plan → ALL 一键记全部 → I got it! → 「Ready for your first training? GO!」）。右上角有 `Skip Guide`。跟着走约 9 次点击，跳过约 1–2 次。

**汇总**
- 屏数：17（含 1 个假加载、1 个广告），之后落在空的 Custom 页。
- 字段数：16（性别、目标、部位、身高、体重、目标体重、水平、1RM 基准动作、1RM 重量、1RM 次数、每周天数、起始日、器材、地点、困难、训练方式）。可跳过的只有 1RM 那一屏（3 个字段），身高/体重/目标体重有默认值可以直接 Next，其余 10 个必须选。
- 引导阶段的操作数：34 次（27 次点击、1 次拖尺子、4 次键、2 次输入共 3 个字符），不含启动。
- 到记下第一组：引导 34 + T1 建训练并开练 23（T1-start 4 + 加 5 个动作 19）+ 第一组 7 = **64 次**；真实首次还要再加评分弹窗 1 次和教学浮层 1–9 次，约 **66–74 次**。如果只加卧推一个动作，大约少 15 次。
- **记一组真正需要的字段只有 2 个**（重量、次数），外加选一个动作。问卷里收集的 16 个字段，除了 1RM 用来给官方计划算重量，自建训练完全用不到。
- 付费墙：**0 次**（全程没有订阅推销）。广告：1 次全屏插页，必须等 ✕ 出现。系统权限弹窗：0 次（没要通知权限）。

截图：[欢迎页](shots/gymtrainer/ob01.png)、[1RM 估算](shots/gymtrainer/ob09.png)、[假加载](shots/gymtrainer/ob15.png)、[引导后的插页广告](shots/gymtrainer/ob16b.png)

## 3. 导航结构

底部 5 个标签：
- **Training**：顶部 PLAN / TRAINING 两栏。PLAN 是 4 套按问卷生成的 30 天计划（MUSCLE BUILDING、BUILD MUSCLE STAMINA…，左右滑切换），按天顺序解锁（锁图标表示还没到，不是付费锁）。TRAINING 是官方预设单次训练（Full Body / Chest / Back Workout…）。计划日详情页：器材「Default ✎」、「1RM (Bench Press) 76 kg ✎」、`START`、`Regenerate`、`Edit`。
- **Custom**：自建训练（模板）列表 + `NEW`。点卡片进详情（START / EDIT，⋮ 重命名 / 删除）。冷启动会回到上次停留的标签，本次一直是 Custom。
- **Exercises**：动作库（510 个，A–Z 分组），右上搜索、`All (510)` 筛选（部位 + 具体器材）、右下 `+` 新建自定义动作。
- **Report**：累计（训练次数 / 分钟 / 总量）、每周训练次数柱状图、本周日历、今日分钟和周均、肌群热力图「Training Frequency」、History 列表（View all）。
- **Me**：Backup & Restore（Google 登录同步）、My Profile、General Settings、Language、Dark Mode、Remove Ads、Rate us、Feedback、Share with friends。
- 训练中按左上 ← 弹「Pause」页：AWAY FOR A WHILE（保留进度稍后继续）/ RESTART / QUIT / RESUME。之后 Custom 页底部会常驻「New training 1 03:10　Continue」恢复条。

## 4. 功能地图与覆盖率

| 功能 | 路径 | 免费/付费 | 状态 |
|---|---|---|---|
| 上手问卷（16 字段，含 1RM 估算） | 首次启动 | 免费 | 已用 |
| 可选账号登录 | 欢迎页「Continue with your existing account」 | 免费 | 未用（规则不登录） |
| 生成的 30 天计划 ×4，按天解锁 | Training → PLAN | 免费 | 已用（开过 Day 1，重量按 1RM 自动填） |
| 计划日：改器材 / 改 1RM / Regenerate / Edit | 计划日详情 | 免费 | 未用（只看了入口） |
| 官方预设单次训练 | Training → TRAINING | 免费 | 已用（浏览） |
| 自建训练（模板）编辑器：加动作、加组、预填重量次数 | Custom → START / NEW | 免费 | 已用 |
| 模板重命名 / 删除 | 模板详情 ⋮ | 免费 | 已用（删除） |
| 从模板开始训练 | 模板详情 START | 免费 | 已用 |
| 动作搜索（子串匹配）+ 跨搜索多选 + 已选缩略图托盘 | Add exercises 弹层 | 免费 | 已用 |
| 动作筛选：部位 + 具体器材（Bicep Curl Machine、Back Extension Machine…） | 搜索框下 `All (n)` | 免费 | 已用 |
| 动作说明：准备 / 执行步骤 + 循环动图 + 个人笔记 | 点动作缩略图 → INSTRUCTIONS | 免费 | 已用 |
| 自定义动作（名称、照片、部位、器材；**不能选记录类型**） | Exercises → `+` | 免费 | 已用（建了 Weighted Dip） |
| 自家数字键盘（小数点、00、Next/Done、收起） | 点重量 / 次数格 | 免费 | 已用 |
| `LOG NEXT SET` 主按钮 / 行首勾选框 | 训练页底部 / 每组行首 | 免费 | 已用 |
| `ALL` 一键记完该动作所有未完成组 | 训练页左下 | 免费 | 已用（教学里） |
| Add a set（复制上一组数值） | 每个动作底部 | 免费 | 已用 |
| 左滑删组 | 组行左滑 → Delete | 免费 | 已用 |
| 「Recently used」历史数值芯片（点一下填入） | 聚焦重量 / 次数格时出现 | 免费 | 已用（看到，未点） |
| RPE（6–10，0.5 步进，附「还能再做 N 次」说明） | 次数键盘左下 `RPE` | 免费 | 已用 |
| 组类型（热身 / 递减等） | — | — | **不存在** |
| 配重片计算器（目标重量、杆重、可用片勾选、示意图） | 重量键盘左下 `+|||` | 免费 | 已用 |
| 休息计时：全局默认关；可全局开（默认 1:00）或按动作单独设；弹窗 -5s / +5s / SKIP + 下一个动作预览 | General Settings / 动作 ⋮ → Rest Timer | 免费 | 已用（用完已改回关闭） |
| 超级组 | 动作 ⋮ → Create Superset | 免费 | 已用（只打开了选择页） |
| 动作备注 / 替换 / 减组 | 动作 ⋮ → Add memo / Replace / Reduce sets | 免费 | 未用（看到入口） |
| 训练中调整动作顺序（长按动作标题拖动，没有拖柄） | 训练页 | 免费 | 已用 |
| 训练中加 / 删动作 | 训练页底部 Add exercises / ⋮ Remove exercise | 免费 | 已用 |
| 改训练计时（标题旁 ✎） | 训练页标题 | 免费 | 未用 |
| 暂停页：稍后继续 / 重来 / 放弃 / 继续 | 训练页 ← | 免费 | 已用 |
| 结束页：总量 +「相当于举起一头大象」+ 分享卡 | FINISH | 免费 | 已用（分享未点，规则） |
| 结束时「Update your workout?」把本次改动写回模板 | 结束后 | 免费 | 已用 |
| 中断恢复（Home / 强杀后 Continue 条） | — | 免费 | 已用 |
| 动作 RECORDS：最佳 1RM、最大重量、最大单日总量、按天的 1RM 柱状图、历次明细 | 点动作缩略图 → RECORDS | 免费 | 已用 |
| Report：累计、周次数图、本周日历、肌群热力图 | Report | 免费 | 已用 |
| 历史列表 + 详情（每组 1RM、Best 标记） | Report → History | 免费 | 已用 |
| 历史：Do it again / Save as a new workout / Delete | 历史 ⋮ / 详情底部 | 免费 | 未用（看到入口） |
| 编辑过去的训练 | — | — | **不存在**（详情只读，只能删） |
| My Profile（目标、部位、可用器材 48 项、1RM、水平、性别体重身高） | Me → My Profile | 免费 | 已用 |
| 可用器材清单（Popular / Free Weights / Bar & Benches / Weight Machines，「Update all workouts for me」） | My Profile → Available Equipment | 免费 | 已用（打开看了） |
| 单位（kg,cm / lbs,ft 全局二选一） | General Settings → Units | 免费 | 已用（看了，没改） |
| 音效、每周起始日、清缓存、删除所有数据、隐私政策 | General Settings | 免费 | 已用（看了；删除数据未点） |
| 17 种语言 | Me → Language | 免费 | 已用（看了列表） |
| 深色模式 | Me → Dark Mode | 免费 | 已用（开了又关） |
| 云备份 / 恢复 | Me → Backup & Restore | 免费，需 Google 登录 | 进不去（要登录 Google 账号） |
| 数据导出 CSV / JSON | — | — | **不存在** |
| 去广告 | Me → Remove Ads | **$5.99 一次性** | 被锁（付费） |
| 全屏插页广告 | 引导结束、放弃训练等时机 | — | 已用（观察到 2 次） |
| 评分弹窗 / Rate us | 首次加动作后自动弹；Me | 免费 | 已用（弹窗关掉了） |
| Feedback / Share with friends | Me | 免费 | 未用 |

不存在的功能：表中标「不存在」的 3 行（组类型、编辑历史训练、数据导出）不计入分母；另外也没有身体围度 / 照片、社交和第三方健康平台同步（没找到入口）。

**覆盖率**：表中 48 行，去掉 3 行「不存在」后为 45 行；已用 37 + 被锁 1 = 38 / 45 ≈ **84%**。未用 6 行（登录、计划日改参、备注 / 替换 / 减组、改计时、历史复用、Feedback / 分享）都已看到入口；进不去 1 行（云备份）。

## 5. 核心记录交互

- **建训练**：没有「空训练」，必须先在 Custom 建一个训练（编辑模式），加动作，`SAVE`，回列表点卡片，再点 `START`。每个动作默认 1 个空组。
- **训练页**：卡片式，每个动作可折叠。每组一行：○ 勾选框（59 dp）、组号、重量格（61×44 dp）、KG、次数格（61×44 dp）、Reps。底部是 `ALL`（51 dp）和大号 `LOG NEXT SET`（293×51 dp），绿色箭头标出「下一组」。
- **输入**：自家数字键盘（83×53 dp 的大键），重量模式有小数点，次数模式那个键换成 `RPE`。**直接点格子会全选原值**（输入即替换）；**键盘上的 `Next` 跳到次数格时不会全选**，光标停在末尾，输入会接在原值后面（10 → 108、15 → 1512）。这是本次最大的坑：我在 T1 里两次因此记错（见 §6）。
- **预填**：首组空白；`Add a set` 复制上一组的数值（灰字显示，未完成前都可改）；第二次起从模板来的组带着上次写回模板的数值。另外聚焦格子时出现「Recently used」芯片（历史上出现过的重量×次数组合，含已删除组的错误值）。训练页**没有「上次」一列**。
- **完成标记**：`LOG NEXT SET` 把绿色箭头所指的组标成绿色并前进；也可以点行首圆圈。完成后数值仍可直接改，不需要先取消勾选。如果下一组是空的，app 会自动滚到它并弹出键盘、焦点放在重量格。
- **新组的位置问题**：一个动作的计划组记完后，`LOG NEXT SET` 会跳到下一个动作，上一个动作折叠或滚出屏幕。按真实节奏「做一组记一组」时，每组都要先往回滑、再点 `Add a set`。
- **休息计时**：默认关。开了之后，每次记组弹出模态框（01:00、-5s / +5s、SKIP、下一个动作预览），会挡住训练页。
- **组类型**：没有（不能标热身）。**RPE** 有（6–10）。**自重 / 负重**：Chest Dip 只有次数列，无法记 +10 kg；自定义动作也不能选「负重自重」类型。
- **单位**：全局 kg 或 lbs，不能按动作或器械设置。总量统计里哑铃按单只重量算（22.5 kg × 次数，不乘 2）。
- 截图：[搜索多选托盘](shots/gymtrainer/t1_add5.png)、[自家键盘](shots/gymtrainer/t1_kgkeypad.png)、[LOG NEXT SET 教学](shots/gymtrainer/ex_guide2.png)、[休息计时弹窗](shots/gymtrainer/ex_rest_run.png)、[配重片计算器](shots/gymtrainer/ex_plate.png)

## 6. 场景任务

### T1 首次训练（空历史，自建）

路径：Custom → START（新建「New training 1」编辑模式）→ Add exercises → 依次搜 5 个动作、跨搜索多选 → `ADD 5 EXERCISES` → SAVE → 点卡片 → START → 逐组记录 → FINISH → 结果页 FINISH →「Update your workout?」点 Update all changes → 落到 Report。
- **本 app 的自然流程是先建好清单再开练**（没有空训练），所以 5 个动作都在编辑器的同一个多选弹层里加完。
- `cable` 搜出 63 条，第一屏没有胸部飞鸟；`cable fly`、`crossover` 都是 0 条（搜索是对名称做整串子串匹配，名称格式是「X Fly · Cable」）。改用 `chest fly` 找到 Standing Chest Fly · Cable（这个关键词是 explore 阶段找到的）。
- 键盘开着时，结果列表到第 3 行就被「已选托盘 + ADD 按钮」挡住，Chest Dip 必须先收起键盘才能点到。
- 没有预填（空历史）；热身组只能当普通组记；Chest Dip 只记了次数（BW 和 +10 kg 都记不了）。

| 阶段 | 动作序列 | 目标尺寸 dp | 备注 |
|---|---|---|---|
| T1-start | 点 START → (加动作后) SAVE → 点模板卡片 → START | 293×51、351×51、354×222、344×51 | 4 次 |
| E1-add | Add exercises → 点搜索框 → 输入 bench → 点 Bench Press · Barbell（第 2 条） | 384×59、310×43、—、346×91 | 系统键盘 |
| E2-add | 点清除 ✕ → 输入 incline → 点结果 | **16×16**、—、346×91 | 清除钮太小 |
| E3-add | ✕ → chest press → 点结果 | 16×16、346×91 | |
| E4-add | ✕ → dip → 收起键盘 → 点 Chest Dip | 16×16、—、346×91 | 被托盘挡 |
| E5-add | ✕ → 点搜索框 → chest fly → 点结果 → ADD 5 EXERCISES | 16×16、310×43、346×91、343×51 | |
| E1-s1 40×10 | 点重量格 → 4 0 → Next → 1 0 → LOG NEXT SET | 61×44、83×53…、293×51 | 7 次 |
| E1-s2 60×8 | Add a set → 点重量格 → 6 0 → Next → 8 → LOG | 351×51、61×44… | 7 次。实测记成了 60×**108**（Next 不全选），改正过程已作废 |
| E1-s3 60×8 | Add a set → LOG | 351×51、293×51 | 2 次（复制正确） |
| E1-s4 60×7 | 上滑 → Add a set → 点次数格 → 7 → LOG | 滑 213 dp | 新组加在屏幕外，要先滑回去 |
| E2-s1 22.5×10 | （键盘已自动弹出）2 2 . 5 → Next → 1 0 → LOG | 83×53 | 8 次 |
| E2-s2 / E3-s3 / E4-s4 | 上滑 → Add a set → LOG | | 各 3 次 |
| E2-s3、E2-s4、E3-s4 | 上滑 → Add a set → 点次数格 → 1 位数 → LOG | | 各 5 次 |
| E3-s1 50×12 | 5 0 → Next → 1 2 → LOG | | 6 次 |
| E3-s2 55×10 | 上滑 → Add a set → 点重量 → 5 5 → 点次数 → 1 0 → LOG | | 9 次 |
| E4-s1 12 次 | 1 2 → LOG | | 3 次（只有次数格） |
| E4-s2 10 次 / E4-s3 8 次 | 上滑 → Add a set → 点次数 → 数字 → LOG | | 6 / 5 次；+10 kg 记不了 |
| E5-s1 15×15 | 1 5 → Next → 1 5 → LOG | | 6 次 |
| E5-s2 15×15 | Add a set → LOG | | 2 次（最后一个动作不用滑） |
| E5-s3 17.5×12 | Add a set → 点重量 → 1 7 . 5 → Next → ⌫ → 2 → LOG | | 10 次。第一次尝试（键盘开着时直接点次数格）焦点没切过去，记成 17.51×15；第二次变成 1512。两次都已作废重做 |
| E5-s4 17.5×12 | Add a set → LOG | | 2 次 |
| T1-finish | 顶栏 FINISH（76×28 dp，不确认）→ 结果页 FINISH → Update all changes | **76×28**、343×51、307×45 | 3 次 |

**tally 汇总（T1 全部阶段，已作废的不计）**：128 次操作 = 112 次点击 + 10 次滑动 + 5 次输入（35 个字符）+ 1 次按键；其中建训练和加动作 23 次，20 组共 102 次，收尾 3 次。约 23 分钟（含驱动开销）。结果页总量 5678 kg，和我算的一致（数据最终全部正确）。

**每组开销（T1，操作数 = 点击 + 滑动）**

| 类别 | 组 | 平均 |
|---|---|---|
| 首组（该动作第一组） | E1-s1 7、E2-s1 8、E3-s1 6、E4-s1 3、E5-s1 6 | **6.0** |
| 同上组（复制上一组） | E1-s3 2、E2-s2 3、E3-s3 3、E4-s4 3、E5-s2 2、E5-s4 2 | **2.5** |
| 只改次数 | E1-s4 5、E2-s3 5、E2-s4 5、E3-s4 5 | **5.0** |
| 改重量（+次数） | E1-s2 7、E3-s2 9、E5-s3 10 | **8.7** |
| 热身 | E1-s1 7（没有热身类型，只能当普通组） | 7 |
| 自重 | E4-s1 3、E4-s2 6、E4-s3 5、E4-s4 3（负重部分记不了） | 4.3 |

「同上组」要 2–3 次而不是 1 次：`LOG NEXT SET` 只会走计划里已有的组，不会自动续一组；记完计划组后又会跳到下一个动作。

### T3 第二次（同一训练）

路径：Custom → 点模板卡片 → START → `LOG NEXT SET` × 20 → 底部 FINISHED → 结果页 FINISH。T1 结束时选了「Update all changes」，所以模板里 20 组的数值都和这次一样，每组 1 次点击，没有任何输入。没再弹「更新模板」，也没有广告。

| 阶段 | 动作 | 目标尺寸 dp |
|---|---|---|
| T3-start | 点模板卡片 → START | 354×222、344×51 |
| 每组 ×20 | LOG NEXT SET | 293×51 |
| T3-finish | FINISHED（底部大按钮，所有组完成后出现）→ FINISH | 354×51、343×51 |

**tally 汇总**：24 次点击，0 输入。**每组开销：所有类别都是 1.0**（首组、同上组、改次数、改重量、热身、自重全部 1 次），前提是模板里的值和这次一样。数值来源是**模板**，不是「上次训练」：如果 T1 时选了 Keep current，T3 就要重新输入；如果这次重量变了，就要回到 T1 的改值成本（5–10 次）。

另外两条更快的路：`ALL` 一次记完一个动作的全部组，整场 5 下；Report → History → 训练 ⋮ → `Do it again` 可以从历史复制（未实测）。

### T4 改错

在进行中的训练里：点第 2 组（已完成）重量格 → 6 2 . 5 → 收起键盘 → 第 3 组左滑 → Delete。tally：8 次（7 次点击 + 1 次滑动）。直接点格子会全选，改完立即生效，组仍是完成状态。删组**没有确认，也没有撤销**；整个 app 没有撤销，能「撤回」的只有取消勾选一组。

### T5 改计划

训练页滑到底 → Add exercises → 搜 overhead → 选 Overhead Press · Barbell → ADD → **长按动作标题拖到 Incline 上方**（可以重排，但没有拖柄提示；这次训练里没有 Squat，就以 Incline 为目标）→ ⋮ → Remove exercise → YES。tally：10 次（7 次点击、1 次滚动、1 次输入 8 个字符、1 次长按拖动）。

### T6 中断

- 按 Home 等 5 秒再打开：直接回到训练页，状态完整，计时器继续走。
- 强杀后打开：蓝色启动页加载 8–14 秒，落到 Custom 页，底部出现恢复条「New training 1　03:10　Continue」；点 Continue 后训练完整恢复（62.5 kg 的修改、删掉的组都在），计时按墙钟继续。[截图](shots/gymtrainer/t6_3.png)

### T7 查看历史 / 1RM

- **训练中**：点动作缩略图 → 底部弹层切到 RECORDS → DONE 关闭，共 3 次。RECORDS 里有 BEST 1RM 76 kg、MAX. WEIGHT 60 kg、MAX. VOLUME 3560 kg（同一天两场加在一起）、按天的 1RM 柱状图，以及历次训练明细（同重量同次数的组合并成「2 Sets」，每行附 1RM）。[截图](shots/gymtrainer/t7_2.png)
- **训练外**：Exercises 标签 → 搜索 → 输入 bench → 点结果 → RECORDS，共 4 次点击加 5 个字符。搜索页会先显示 RECENT 列表，但系统键盘自动弹出，把列表下半部挡住了，卧推正好在被挡的位置。
- 训练页本身看不到上次的数值，只能靠「Recently used」芯片间接看到。

### T8 导出

**没有导出**。Me → Backup & Restore 直接弹出 Google 账号选择器（云同步），停在这里。没有 CSV / JSON / 文件导出入口；结果页的「Copy text / Save Image」只是分享卡。tally：3 次（2 次点击 + 返回）。

## 7. 亮点（值得 fitlog 借鉴）

1. **一个大按钮「LOG NEXT SET」**（293×51 dp，固定在屏幕底部，拇指区）加绿色箭头标出下一组。数值已经对的时候，每组只要按一下大按钮，不用找行。和 fitlog「一键记一组、不要求精准点击」完全同向，可以参考它的「下一组指针 + 固定主按钮」做法。
2. **结束时「Update your workout?」差异对话框**：逐个动作列出「模板 0 kg × 0 → 本次 40 × 10…」，一键写回模板。下一次按模板练就全程 1 次点击一组。这个「把这次的实际表现变成下次默认」的确认方式透明、可控。
3. **中断恢复做得扎实**：强杀后首页常驻恢复条，带已用时长，点一下就恢复到完全一致的状态。
4. **自家数字键盘里的情境键**：重量模式的左下角是配重片计算器，次数模式是 RPE（6–10 加文字解释）。工具放在输入的地方，不占训练页空间。
5. **配重片计算器可勾选可用片**（0.5–25 kg）并改杆重。思路接近 fitlog 的「按健身房实际可装重量」，但它不会反过来约束输入值。

## 8. 痛点

1. **`Next` 不全选，直接点格子才全选**：同一个键盘两种行为。复制来的值后面会接上新输入（10 → 108、15 → 1512），而且会被直接记下来，没有任何合理性校验（108 次照样记，「Recently used」里还会永久留着这些错值）。T1 里我两次因此记错。
2. **键盘开着时点另一个格子，焦点有时切不过去**：第一次点次数格，数字还是进了重量格（17.5 → 17.51，弹「Character limit reached」）。
3. **按「做一组记一组」的节奏，加组很绕**：计划组记完后 app 跳到下一个动作，上一个动作折叠或滚出屏幕；新加的组也加在视口外。每多一组都要「上滑 → Add a set → LOG」，同上组 2–3 次、改次数 5 次、改重量 8–10 次。
4. **没有空训练**：开练前必须建模板、保存、再点开。也没有组类型（热身）、负重自重、按器械设单位、编辑历史训练、数据导出。
5. **广告和打扰**：引导结束马上一个全屏插页（✕ 要等 5–8 秒），第一次放弃训练又是一个；第一次加动作就弹评分；17 屏问卷里有假加载，还有一屏「最大困难」纯营销调研；冷启动 5–14 秒蓝屏加载条。去广告要 $5.99。
6. **小目标**：搜索清除钮 16×16 dp（每换一个动作都要点），顶栏 FINISH 76×28 dp，广告 ✕ 约 24 dp。

## 9. 与 fitlog 定位的对照

1. **「一键记一组」它只做到一半**：模板值正确时（T3）确实每组 1 次，比 fitlog 的目标还省；但只要数值和上次不同、或要多加一组，就退回「找格子 + 键盘 + 防 Next 陷阱」，T1 平均每组 5.1 次。fitlog 主打的「上次数值就在行里 + 不强制键盘」正好打在它的薄弱处。
2. **预填来源是模板，不是「上次」**：它靠结束时手动确认写回模板；fitlog 直接显示上次的数值，不需要这一步，也不会出现「选了 Keep current 下次就全空」。
3. **可靠性**：中断恢复和 fitlog 一样扎实，但**没有导出**，备份只能登录 Google 云同步。fitlog 的免费 CSV / JSON 导出和本地自动备份在这一点上明显更好。
4. **不锁功能但有广告**：功能全免费、去广告是一次性买断，这一点和 fitlog「不锁功能」接近；但插页广告和评分弹窗正好违背「最纯粹的记录」。
5. **器械感知只有表面**：它有很细的器材清单（48 项、具体到机型）和配重片计算器，但只用来生成计划和挑动作，不会按健身房可装重量取整，也不能按器械设单位。fitlog 的「按健身房实际可装重量」在这里没有对手。
6. **臃肿程度中等**：没有社交和 AI 对话，但有 17 屏问卷、生成计划、热力图，以及「相当于举起一头大象」这类激励文案。

## 附录：`tally gymtrainer` 原始输出

（phase explore / onboard / T1–T8；已作废的操作不计入 ops。）

```
> tap 162 1130
> wait 1
> tally gymtrainer
== gymtrainer / phase explore
   ops: {'tap': 159, 'key': 19, 'text': 14, 'swipe': 5, 'long': 1, 'launch': 1, 'scroll': 4}  typed chars: 98  voided: 0
   tap/long target min-side: {'unknown': 160}
   swipe distances (dp): [213, 217, 291, 249, 249]
   note: Rate-us dialog (5 stars + RATE) popped right after adding the first exercise to a custom workout, ~3 min into app use; dismissed with back
   note: Backup & Restore = Google account chooser (Google sign-in -> cloud sync); not signed in, dismissed
   note: First workout start shows a coach-mark guide with an (Example Exercise) 5x20kgx5, Skip Guide button top-right (consumed in explore, so T1 will not show it)
   note: Guide = 7 coach marks (Hello, Log next set, Log a set checkbox, More actions, rest timer off by default, Edit your plan (sets 30x3 demo), Log all sets ALL) + I got it! => ~8 taps if followed, 1 tap via Skip Guide
   note: AD #2: interstitial after QUIT (discard) workout
   note: AD #2 close X visible at ~5 s
   note: cold launch: blue splash with progress bar ~5-8 s (ad-loading style), lands on last tab Custom; no app-open ad seen
   note: second QUIT: no ad (interstitials appear frequency-capped)
   note: custom exercise: name/photo/bodypart/equipment; no tracking-type choice; Weighted Dip with Dip Machine equipment still reps-only
   note: plan Day 1 workout: weights prefilled from 1RM (e.g. 60 kg x 8, 4 sets)
== gymtrainer / phase onboard
   ops: {'launch': 1, 'tap': 27, 'swipe': 1, 'key': 4, 'text': 2}  typed chars: 3  voided: 3
   tap/long target min-side: {'ge48dp': 23, '32-47dp': 3, 'lt32dp': 1}
   swipe distances (dp): [243]
   note: Screen 1 Welcome: START button + Continue with your existing account (login optional link). Leap Fitness brand.
   note: Screen 2 gender: Male/Female cards, no skip visible
   note: Screen 3 main goal: 6 options single-select + Next; progress bar ~10%
   note: Screen 4 focus areas: 8 chips multi-select + Next
   note: Screen 5 height: vertical ruler, default 175 cm, cm/ft toggle
   note: Screen 6 weight: horizontal ruler default 75 kg (kept), kg/lbs toggle, BMI 23.7 shown
   note: Screen 7 target weight: ruler default 72 kg (kept; odd for build-muscle goal)
   note: Screen 8 fitness level: 3 options
   note: Screen 9 Estimate your 1RM: benchmark exercise picker (Bench Press), weight field 30 kg, reps 5 -> 1RM 35 computed; skip link I m a beginner and I don t know
   note: System numeric keyboard opened, cursor lands mid-text; existing value not selected
   note: 1RM estimated 76 kg from 60x8
   note: Screen 10 frequency: 3/4/5 days/More options + week start day (7 options); Next disabled until both chosen
   note: Screen 11 equipment: All/Barbells/Dumbbells/Kettlebells/Weight Machines/None
   note: Screen 12 location: Large Gym/Small Gym/Garage Gym/At Home
   note: Screen 13 biggest challenge: 3 options
   note: Next does nothing until an option is chosen (required)
   note: Screen 14 How would you like to train: I want a plan / still figuring / I train my way (Just need a simple way to log) -> chose I train my way
   note: Screen 15 fake loading Tailoring Your Experience (4 progress bars, ~6-8 s forced wait, 4.9 rating badge)
   note: Screen 16 Your Custom Setup Is Ready: weight curve 75->73 kg in 4 weeks, About You, Start Now
   note: AD #1: full-screen interstitial (Google AdMob, shows Test Ad on emulator) right after Start Now; close X appeared top-right after ~5-8 s
   note: Onboarding done: landed on Custom tab (empty state Create your first custom workout + START). No paywall, no permission prompt, no login so far.
== gymtrainer / phase T1-start
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 4}
   note: No empty/quick workout exists: the app flow is build-first (Custom tab -> START builds a custom workout New training 1 in Edit mode, then SAVE, open, START). Exercises added in the builder via multi-select dialog.
   note: builder: each exercise added with 1 empty set; left at defaults
== gymtrainer / phase T1-E1-add
   ops: {'tap': 3, 'text': 1}  typed chars: 5  voided: 0
   tap/long target min-side: {'ge48dp': 2, '32-47dp': 1}
   note: system keyboard (text) opens for search
   note: Bench Press · Barbell is 2nd result under Bench Fly · Dumbbell
== gymtrainer / phase T1-E2-add
   ops: {'tap': 2, 'text': 1}  typed chars: 7  voided: 0
   tap/long target min-side: {'lt32dp': 1, 'ge48dp': 1}
   note: search clear X is 16x16dp; ADD n EXERCISES button floats above keyboard at y~717 overlapping the 3rd result row
== gymtrainer / phase T1-E3-add
   ops: {'tap': 2, 'text': 1}  typed chars: 11  voided: 0
   tap/long target min-side: {'lt32dp': 1, 'ge48dp': 1}
== gymtrainer / phase T1-E4-add
   ops: {'tap': 2, 'text': 1, 'key': 1}  typed chars: 3  voided: 1
   tap/long target min-side: {'lt32dp': 1, 'ge48dp': 1}
   note: Chest Dip row partly hidden behind the floating ADD button; tapped its upper edge
   note: with keyboard open the result list is clipped at ~3rd row by a selected-exercise thumbnail tray + ADD button; must close keyboard to reach Chest Dip
== gymtrainer / phase T1-E5-add
   ops: {'tap': 4, 'text': 1}  typed chars: 9  voided: 0
   tap/long target min-side: {'lt32dp': 1, '32-47dp': 1, 'ge48dp': 2}
   note: keyword cable gives 63 results with no chest fly in first screen (cable fly / crossover give 0: search is substring on name, names are X Fly · Cable); used chest fly, found in explore
== gymtrainer / phase T1-E1-s1
   ops: {'tap': 7}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1, 'ge48dp': 6}
   note: workout opens with first exercise expanded, 1 empty set row (KG / Reps), no prefill; warm-up set type does not exist -> logged 40x10 as normal set
   note: app keypad (not system): digits, dot, backspace, hide, Next, plate-calculator key
   note: set logged: row turns green, no rest timer (off by default), app auto-expands next exercise because bench had only 1 planned set; FINISH appears in header
== gymtrainer / phase T1-E1-s2
   ops: {'tap': 7}  typed chars: 0  voided: 4
   tap/long target min-side: {'ge48dp': 6, '32-47dp': 1}
   note: FRICTION: after Add a set the app keypad stays/opens but focus is on Incline set 1 KG (the field focused after previous LOG), not the new bench set 2; typed 60 into wrong exercise, fixed
   note: focusing a field shows a Recently used: 40 kg x 10 Reps chip (tap to fill)
   note: new set row shows previous values greyed as hint; typing replaces
== gymtrainer / phase T1-E1-s3
   ops: {'tap': 2}  typed chars: 0  voided: 10
   tap/long target min-side: {'ge48dp': 2}
   note: TRAP: in s2 Next moved focus to Reps which held copied 10 with caret at end, typing 8 gave 108 and set was logged 60x108 (my error not caught before LOG); fixing now (voided)
   note: direct tap on a field selects its content (typing replaces); keypad Next does NOT select (typing appends) -> fixed set 2 to 60x8; redoing s3 cleanly
   note: Add a set copies previous set values (shown grey until done)
   note: after LOG, app scrolls to next exercise whose set is empty and auto-opens app keypad on its KG
== gymtrainer / phase T1-E1-s4
   ops: {'tap': 4, 'swipe': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 2, 'ge48dp': 2}
   swipe distances (dp): [213]
   note: new bench set added offscreen above the viewport; had to scroll up to reach it
== gymtrainer / phase T1-E2-s1
   ops: {'tap': 8}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 8}
   note: keypad already open with focus on Incline set1 KG (auto)
== gymtrainer / phase T1-E2-s2
   ops: {'swipe': 1, 'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   swipe distances (dp): [213]
== gymtrainer / phase T1-E2-s3
   ops: {'swipe': 1, 'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, '32-47dp': 1}
   swipe distances (dp): [213]
== gymtrainer / phase T1-E2-s4
   ops: {'swipe': 1, 'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, '32-47dp': 1}
   swipe distances (dp): [213]
== gymtrainer / phase T1-E3-s1
   ops: {'tap': 6}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 6}
== gymtrainer / phase T1-E3-s2
   ops: {'swipe': 1, 'tap': 8}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 6, '32-47dp': 2}
   swipe distances (dp): [213]
== gymtrainer / phase T1-E3-s3
   ops: {'swipe': 1, 'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   swipe distances (dp): [213]
== gymtrainer / phase T1-E3-s4
   ops: {'swipe': 1, 'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, '32-47dp': 1}
   swipe distances (dp): [213]
== gymtrainer / phase T1-E4-s1
   ops: {'tap': 3}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3}
   note: Chest Dip is reps-only (no weight field): BW and +10 kg cannot be recorded; logging reps only
== gymtrainer / phase T1-E4-s2
   ops: {'swipe': 1, 'tap': 5}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 4, '32-47dp': 1}
   swipe distances (dp): [213]
== gymtrainer / phase T1-E4-s3
   ops: {'swipe': 1, 'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, '32-47dp': 1}
   swipe distances (dp): [213]
   note: set 3 should be +10 kg x 8: weight impossible on Chest Dip; logged 8 reps
== gymtrainer / phase T1-E4-s4
   ops: {'swipe': 1, 'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   swipe distances (dp): [213]
== gymtrainer / phase T1-E5-s1
   ops: {'tap': 6}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 6}
== gymtrainer / phase T1-E5-s2
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
== gymtrainer / phase T1-E5-s3
   ops: {'tap': 10}  typed chars: 0  voided: 27
   tap/long target min-side: {'ge48dp': 9, '32-47dp': 1}
   note: E5 s3 went wrong: reps tap while keypad open did not move focus (list had re-scrolled), result 17.51x15 logged; voided whole s3 and redoing
   note: FRICTION/BUG: switching from KG to Reps by tapping while app keypad is open is unreliable here: first tap did not move input focus (digit went to KG -> 17.51, toast Character limit reached), second tap focused Reps but appended to copied 15 -> 1512. Voided; redoing
   note: Next to Reps keeps copied 15 with caret at end; one backspace -> 1, then 2 -> 12
== gymtrainer / phase T1-E5-s4
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
== gymtrainer / phase T1-finish
   ops: {'tap': 3}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1, 'ge48dp': 1, '32-47dp': 1}
   note: FINISH (header, 76x28dp) goes straight to result page, no confirm: TOTAL WEIGHT LIFTED 5678 kg (= sum of logged sets; dumbbell weight counted once, not x2), share row Instagram/WhatsApp/Save Image/Copy text/More, FINISH button
   note: Update your workout? dialog: diff of template vs done sets per exercise (0 kg x 0 -> logged values); Update all changes / Keep current -> chose Update
   note: after finish: lands on Report tab; no ad shown at finish this time
== gymtrainer / phase T3-start
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   note: T3: Custom tab -> template card -> START; all 20 sets prefilled from template (updated at T1 finish), not from history; no last-time column
== gymtrainer / phase T3-E1-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E1-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E1-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E1-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E2-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E2-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E2-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E2-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E3-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E3-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E3-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E3-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E4-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E4-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E4-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E4-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E5-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E5-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E5-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-E5-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== gymtrainer / phase T3-finish
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   note: bottom FINISHED button (354x51dp) also finishes once all sets done; result card WELL DONE 2nd workout, 20 sets 5678 kg
== gymtrainer / phase T4
   ops: {'tap': 7, 'swipe': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1, 'ge48dp': 6}
   swipe distances (dp): [291]
   note: tap done set KG -> app keypad, content selected; Recently used chips: 60x7, 60x8, 40x10
   note: edit saved in place (no confirm), set stays done
   note: swipe-left Delete removes the set instantly: no confirm, no undo/snackbar; no undo anywhere (only unticking a done set)
== gymtrainer / phase T5
   ops: {'scroll': 1, 'tap': 7, 'text': 1, 'longdrag': 1}  typed chars: 8  voided: 1
   tap/long target min-side: {'ge48dp': 4, '32-47dp': 4}
   note: no Squat in this workout; reorder target = move Overhead Press above Incline
   note: reorder: long-press exercise header and drag (no visible handle), works; dropped above Incline
   note: exercise menu: Add memo, Replace, Rest Timer Off, Remove exercise, Create Superset
== gymtrainer / phase T6
   ops: {'key': 1, 'launch': 2, 'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
   note: home + relaunch after 5 s: back in workout, state intact, timer kept running
   note: after force-stop: splash ~8-14 s, then Custom tab with resume bar at bottom: New training 1 03:10 + Continue
   note: workout fully recovered incl. edits/deletions
== gymtrainer / phase T7-in
   ops: {'tap': 3}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2, '32-47dp': 1}
   note: in-workout: tap exercise thumbnail -> bottom sheet INSTRUCTIONS/RECORDS; RECORDS: BEST 1RM 76, MAX WEIGHT 60, MAX VOLUME 3560 (both same-day sessions summed), 1RM bar chart per day, HISTORY per session with sets grouped and per-row 1RM; DONE closes
== gymtrainer / phase T7-out
   ops: {'tap': 4, 'text': 1}  typed chars: 5  voided: 2
   tap/long target min-side: {'ge48dp': 2, '32-47dp': 2}
   note: search opens RECENT list; Bench Press visible without typing
   note: search field auto-opens system keyboard covering the lower RECENT rows (Bench Press row hidden under keyboard)
   note: same INSTRUCTIONS/RECORDS sheet (with video play button ivPlay)
== gymtrainer / phase T8
   ops: {'tap': 2, 'key': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   note: no data export (CSV/JSON) anywhere; Backup & Restore only offers Google account sign-in (cloud sync); stopped at account chooser
```
