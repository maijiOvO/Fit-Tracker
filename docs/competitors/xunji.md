# 训记（TrainNote）竞品调研 v2

> 包名 `com.trainnote.rn`，版本 7.00.406（React Native），2026-10-26 在小米真机（384×853 dp）上按 brief v2 复测。账号早已登录、引导早已走完，所以没有上手流程。
> 第一轮留下的测试数据已先清理：删了 10-26 的 2 场训练、取消了 5x5 计划（要输入一串数字确认）；AI 计划、「钢铁意志」挑战、自定义动作 BeltSquat 保留。
> 偏好设置保持默认：「打勾时弹出计时器 = 弹出」、「是否自动复制历史 = 直接复制」。

## 1. 概况

- **定位**：国内老牌力量训练记录 app，后来什么都往里加：训练记录、官方计划和 AI 计划、饮食、体重体脂、轻断食、经期、挑战与排行、朋友、教练版、手表端、给外部 Agent 调用的 Skill。核心记录做得扎实，整体很臃肿；偏好设置里专门有一页「元素设置」用来隐藏模块。
- **付费**：免费 + 训记 PRO，**¥28.00/月**（「按月付费，好用再买」）或 **¥88.00 永久**（「一次付费，终身使用」）。没有试用。付费页写明虚拟物品、购买后不退款，另有「我已完成付款，点击刷新会员」按钮。没有广告，也没有启动弹窗。
- **语言**：中文；「语言/Language」标着测试版。
- **登录**：要账号（「我的」页显示训记ID），数据在云端，能切换服务器节点。删除的数据进回收站，云端记录 15 天后自动清除，本地删除记录可以恢复。

## 2. 上手流程

不适用（已登录、已完成引导）。

## 3. 导航结构

底部 5 个标签，外加右下角一颗悬浮的绿色「训练」大按钮（62 dp）：

- **训练**（首页）：饮食记录卡（宏量环、早/午/晚/加餐/饮水/记体重，可关）→ 今日训练（第N练卡片；待开始的显示 GO!，进行中的显示完成百分比，已完成的显示时长）→ 今日安排（启动官方计划后才有）→ 官方计划 / 个人模版 / 个人计划(AI)。右上角有「朋友」和九宫格（扫码获取计划、过往心得、轨迹跟踪、HIIT工具、周期中心、教练记）。
- **挑战**：进行中 / 往期 / 排行。
- **动作**：动作库，左侧按部位、右侧按器械索引。
- **历史**：历史 | 统计；历史是月历，再分训练 / 体重&体脂 / 饮食。
- **我的**：PRO 横幅、经期、身体数据、轻断食、RM计算器、照片墙、备忘录、华为/OPPO 健康、分享、偏好设置、安卓悬浮窗倒计时、反馈、教练记、操作指南、语言、回收站、公众号、缓存、小工具、数据导出和导入、手表、Mac 登录、网络节点、协议。
- 「训练」悬浮按钮弹出：新建训练 / 新建有氧 / 新建HIIT / 新建休息 / 身体数据 / 经期记录。
- 训练中离开训练页，右下角会常驻一颗「训练进行中 04:48」胶囊，点它回到训练。

## 4. 功能地图与覆盖率

状态：已用 = 本轮或第一轮实际操作过（只在第一轮用过的标「v1」，第二轮补测的标「s2」）；被锁 = 碰到付费墙；进不去 = 要权限或会动到账号数据，停在入口；排除 = 社交或第三方授权，按约定不操作；未用 = 只看到入口。

| 功能 | 路径 | 免费/付费 | 状态 |
|---|---|---|---|
| 新建空训练 | 训练按钮 → 新建训练 | 免费 | 已用 |
| 新建有氧 / HIIT / 休息 | 训练按钮 | 免费 | 已用（s2） |
| 自定义数字键盘 | 点重量/次数格 | 免费 | 已用 |
| 热身组 | 键盘「热身组」/ 组号菜单 / 「…」菜单 | 免费 | 已用 |
| 递减组 | 键盘「递减组」，展开 递1/递2 子行 | 免费 | 已用 |
| 记录左右（单侧重量） | 键盘或卡片上「记录左右」 | 免费 | 已用 |
| RPE（6–10，0.5 一档） | 键盘「RPE」 | 免费 | 已用 |
| 一键改向上 / 向下 | 键盘 | 免费 | 已用（v1） |
| 加一组（键盘上） / 新增一组（卡片上） | 键盘 / 卡片 | 免费 | 已用 |
| 组备注、复制本组、手动开始休息 | 组行「…」 | 免费 | 已用（s2） |
| 简单/正常/困难 主观感受 | 卡片底部 | 免费 | 已用（s2） |
| 每组计时 | 卡片开关 | 免费 | 已用（s2） |
| 休息计时（全屏模态 / 悬浮圆） | 打勾自动 | 免费 | 已用 |
| 统一设置休息时间（热身 / 正式分开） | 训练页 设置 | 免费 | 已用（v1） |
| 语音播报 | 训练页 设置 | 免费 | 已用（s2） |
| 大字版、显示容量 | 训练页 设置 | 免费 | 已用（s2） |
| 写心得 | 训练页底栏 | 免费 | 已用（v1） |
| 杠铃片计算器 + 片库存（全局一套） | 组号 → 杠铃片设置 → 管理我的杠铃片 | 免费 | 已用 |
| 按动作切换单位 kg/lbs | 动作齿轮 → 切换单位 | 免费 | 已用（v1） |
| 动作记录类型（力量/有氧/仅次数/仅时间/自身加重/自重辅助/拉伸/Tabata） | 动作齿轮 | 免费 | 已用（v1） |
| 组间有氧、组间休息、备选动作、替换动作 | 动作齿轮 | 免费 | 已用（s2） |
| 动作排序 | 长按卡片 / 齿轮 → 动作排序 | 免费 | 已用 |
| 删除动作 / 删除组 | 齿轮 → 删除 / 「…」→ 删除 | 免费 | 已用 |
| 撤销 | — | — | 不存在 |
| 临时超级组 | 选动作页底部 | **付费**（动作库里「新增超级组」免费，见下） | 被锁 |
| 删除训练 | 训练页 设置 → 删除训练 | 免费 | 已用 |
| 崩溃后继续训练 | 偏好设置 | 免费 | 已用（T6 强杀后可续） |
| 完成并生成分享图 | 完成弹窗 | 免费（更多样式付费） | 已用（v1） |
| 动作库（部位 × 器械，胸约 110 个） | 动作标签 | 免费 | 已用 |
| 搜索（中文 / 英文 / 拼音） | 动作页搜索框 | 免费 | 已用 |
| 拍照识别器械 | 搜索框「识别」 | 免费 | 进不去（要相机权限，s2 在权限说明框拒绝） |
| 常用动作（带次数）/ 精选动作 | 动作页顶部 | 免费 | 已用 |
| 动作要点（视频、3D、真人示范、肌肉图） | 动作详情 → 要点 | 前 3 条免费，其余**付费** | 被锁 |
| 动作历史 + 每组 1RM 预测 | 卡片「动作历史」/ 动作详情 → 历史 | 免费 | 已用 |
| 单动作图表（容量/组数/最大重量/1RM 曲线） | 动作详情 → 图表 | **付费** | 被锁 |
| 置顶动作 | 动作详情 | 免费 | 已用（s2） |
| 自定义动作 | 动作页 + | 免费 | 已用（v1，BeltSquat） |
| 管理分类、新增超级组（动作库） | 动作页 + | 免费 | 已用（s2） |
| 官方计划（含 5x5、Candito） | 首页 官方计划 | 能启动，每日重量**付费** | 被锁 |
| AI 智能计划 | 首页 个人计划(AI) | 免费 3 天 1 次，PRO 每天 5 次 | 已用（v1） |
| 个人模版 / 存为模版 / 自动同步模版 | 历史当天 → 存为模版；首页 个人模版 | 免费（模版配色付费） | 已用（v1） |
| 复制到今天 / 复制到某天 | 历史当天底栏 | 免费 | 已用 |
| 编辑过去的训练 | 历史当天 → 编辑数据 | 免费 | 已用（v1） |
| 管理历史记录（多选删除） | 历史 → 设置 | 免费 | 已用 |
| 回收站 | 我的 → 回收站 | 免费 | 已用 |
| 统计（周/月/年/自定义，部位容量，最大重量与 PR） | 历史 → 统计 | 免费 | 已用 |
| 月报 / 年报 / 全新月报海报 | 历史 → 报表 | 免费（详细报表付费） | 已用（v1） |
| 身体数据（体重、体脂、围度） | 我的 / 训练按钮 | 免费 | 已用（v1） |
| 轻断食、经期、RM 计算器、备忘录 | 我的 | 免费（自定义断食时长 VIP） | 已用（s2） |
| 照片墙 | 我的 | 免费 | 进不去（上传只有相册 / 相机，要权限） |
| 饮食记录 | 首页饮食卡 | **付费** | 被锁（v1） |
| 挑战 / 排行 | 挑战标签 | 免费 | 已用（v1，钢铁意志） |
| 朋友 / 分享训记 | 首页、我的 | 免费 | 排除（社交） |
| 教练记（学员卡片、排课总表） | 我的 / 九宫格 | 5 名学员内免费，不限人数**付费** | 已用（s2，只看，未建学员） |
| 偏好设置（训练 / 软件 / 其他 / 元素设置） | 我的 → 偏好设置 | 免费 | 已用 |
| 主题 跟随系统/暗/亮 | 偏好设置 → 软件设置 | 免费 | 已用（v1） |
| 训练按钮大小（标准 / 大 / 特大） | 偏好设置 → 训练设置 | 免费 | 已用（s2） |
| 完成一个动作后自动打开下一个动作 | 偏好设置 → 训练设置 | 免费 | 已用（s2） |
| 其他训练偏好（输入框左右顺序、点计时器后打勾、复制每组备注、休息正计时、PR 标记、屏幕常亮、按钮振动） | 偏好设置 | 免费 | 未用（只看到开关） |
| 安卓悬浮窗倒计时（后台显示休息倒计时） | 我的 | 基础样式免费，卡片 / 悬浮球样式**付费** | 进不去（要系统悬浮窗权限） |
| 数据导出和导入（4 份 Agent Skill） | 我的 → 数据导出和导入 | **付费** | 被锁 |
| 华为 / OPPO 健康、手表、Mac 登录 | 我的 | 免费（手表不受限版付费） | 排除（授权） |
| 网络节点、缓存、小工具 | 我的 | 免费（增肌指南页挂着 ¥88 购买条） | 已用（s2；切节点、重传、清缓存、清模版没按） |
| 杠铃轨迹跟踪 | 首页九宫格 | 免费 | 进不去（要导入相册视频） |
| 扫码获取计划 | 首页九宫格 | 免费 | 进不去（相册 / 扫码，要权限） |
| 周期中心（训练预约安排） | 首页九宫格 | 免费 | 已用（s2，未保存） |
| 过往心得 | 首页九宫格 | 免费 | 已用（s2） |

共 66 项（「撤销」不存在，不计）：已用 52，被锁 6，进不去 5，未用 1，排除 2。**覆盖率 =（52 + 6）/（66 − 2）= 58 / 64 ≈ 91%**；按全部项目算 58 / 66 ≈ 88%。进不去的 5 项都卡在相机、相册或系统悬浮窗权限上。

## 5. 核心记录交互

1. **动作卡片是手风琴**：同一时间只展开一个。新加的动作是收起的，要先点开；点开下一个会把上一个收起，列表经常停在半截，第一组被挤出屏幕，还要再滑回来（T3 里 5 个动作有 3 个要额外滑动）。新加的动作排在列表最底下，前一个卡片展开时它在屏幕外。偏好设置里有「完成一个动作后，自动打开下一个动作」（默认关）：打开后最后一组打勾，当前卡片收起、下一张自动展开且第一组在屏幕内，[截图](shots/xunji/s2_auto_open_next.png)。T1/T3 是按默认值测的。
2. **输入**：点重量或次数格，弹出 app 自己的数字键盘（不是系统键盘），列表自动滚到键盘上方。格子里的旧值是选中状态，直接打字就替换。键盘左列是 kg/lbs、热身组、递减组、记录左右，右列是加一组、一键改向上、一键改向下、RPE。**没有「下一格」键**，填完重量要再点次数格。杠铃动作的重量格下方提示「杆+总片」；哑铃动作没有「单只还是两只」的提示，容量按单只算（22.5×10 = 225）。
3. **预填**：首次（无历史）全空。「新增一组」复制上一组的重量、次数**和组类型**：热身组之后加的组也带着「热」，要在键盘上再点一次「热身组」取消。T3 走「复制到今天」时，5 个动作、19 组（含热身标记）全部带过来。组行里**不显示上次的数字**，要点「动作历史」看。
4. **完成一组**：点大 ✓（约 52×42 dp），整行变绿，键盘收起。第一次打勾才开始计训练总时长；同时开始 60 s 休息倒计时。第一次是全屏模态（加一条让你开自启动、电池无限制的橙色横幅，见 [截图](shots/xunji/14_rest_modal_first_time.png)）；点过「最小化」后，以后都以右下角悬浮圆的形式出现，不打断操作，但会盖住键盘的「RPE」「一键改向下」和卡片上的「困难」。
5. **自重**：双杠臂屈伸默认是「自身加重」类型，重量格写成「+kg」，空着就是自重，卡片上显示「当前体重：70kg」（来自资料），容量按体重 + 附加计。[截图](shots/xunji/03_bodyweight_plus_kg.png)
6. **单位**：全局没有 kg/lb 设置；每个动作单独切，键盘上的 kg/lbs 键会换算并取整。

## 6. 场景任务

目标尺寸来自 UI 树的命中检测。这个 app 是 React Native，弹层和底层页面同时留在 UI 树里，**命中检测经常报成底层元素**（比如「讲解」「减脂塑形」）。下面写的尺寸以截图里看到的实际控件为准，tally 里的分档只能参考。

### T1 首次训练（空训练，19 组 + 1 热身组）

动作都在训练进行中逐个添加（app 也支持一次勾多个再「完成」）。

| 阶段 | 动作序列 | 目标 | 尺寸 dp | 备注 |
|---|---|---|---|---|
| start（2） | 训练按钮 → 新建训练 | 悬浮钮 / 菜单图标 | 62 / ~50 | 菜单弹层不在 UI 树里 |
| E1-add（7） | 加动作 → 搜索框 → 打 `bench` → 回车 → 杠铃卧推 → 完成(1) → 点开卡片 | 底栏 / 搜索框 / 结果卡 / 完成 / 卡片 | 52×55 / 121×38 / ~132×143 / 192×43 / 360×92 | 搜索实时过滤；回车只为收起系统键盘；加完是收起的空卡片，没有预填 |
| E1-s1 热身（8） | 重量格 → 4 → 0 → 热身组 → 次数格 → 1 → 0 → ✓ | 格 / 键 / ✓ | 54×42 / 69×48 / 52×42 | 自家键盘；第一次打勾启动总计时和悬浮休息计时 |
| E1-s2 改重量（8） | 新增一组 → 重量格 → 6 → 0 → 热身组(取消) → 次数格 → 8 → ✓ | | 新增一组 ~160×41 | 新组继承了「热」，要手动取消 |
| E1-s3 同上（2） | 新增一组 → ✓ | | | |
| E1-s4 改次数（4） | 新增一组 → 次数格 → 7 → ✓ | | | |
| E2-add（8） | 加动作 → 搜索框 → `incline` → 回车 → 下滑一屏 → 上斜哑铃卧推 → 完成 → 点开卡片 | | | 结果按器械分组，杠铃排前面，哑铃的要滑一屏 |
| E2-s1（9） | 重量格 → 2 → 2 → . → 5 → 次数格 → 1 → 0 → ✓ | | | |
| E2-s2（2） / s3（4） / s4（4） | 同上 / 改次数 / 改次数 | | | |
| E3-add（8） | 加动作 → 搜索框 → `chest press` → 回车 → 右侧索引「器」→ 器械推胸 → 完成 → 点开卡片 | 索引字母 | **32×20** | 「器械推胸」被悍马机、哑铃、绳索结果压在后面，靠右侧小索引跳 |
| E3-s1（7） / s2 改重量（8） / s3（2） / s4（4） | | | | |
| E4-add（7） | 加动作 → 搜索框 → `dip` → 回车 → 双杠臂屈伸（自重组）→ 完成 → 点开卡片 | | | 第一次在探索时 `dip` 被中文输入法转成「低频」，切到英文后才行 |
| E4-s1 自重（4） | 次数格 → 1 → 2 → ✓ | | | 重量留空 = 自重 |
| E4-s2 自重改次数（5） | 新增一组 → 次数格 → 1 → 0 → ✓ | | | |
| E4-s3 加重（7） | 新增一组 → +kg 格 → 1 → 0 → 次数格 → 8 → ✓ | | | |
| E4-s4（2） | 新增一组 → ✓ | | | |
| E5-add（9） | 加动作 → 搜索框 → `cable` → 回车 → 下滑 → 绳索十字夹胸 → 完成 → 下滑训练页 → 点开卡片 | | | 新卡片在屏幕外，要滑下去才看得到 |
| E5-s1（7） / s2（2） / s3 改重量（10） / s4（2） | | | | 17.5 要打 4 个键 |
| finish（2） | 完成 → 完成训练 | 60×35 / 文字按钮 | | 弹窗主按钮是「完成并生成分享图」，[截图](shots/xunji/04_finish_dialog.png)；完成后直接回首页，没有总结页 |

**合计：144 次操作**（点击 131、搜索打字 5 次共 31 个字母、回车 5 次、滑动 3 次），无长按。弹层：选动作页 ×5、自家键盘、完成弹窗；休息计时全程是悬浮圆（因第一轮已最小化过，新用户第一次会是全屏模态）。

**每组开销（T1）**

| 类别 | 样本 | 平均操作数 |
|---|---|---|
| 首组（非热身非自重） | E2 9、E3 7、E5 7 | **7.7** |
| 同上一组 | E1-s3、E2-s2、E3-s3、E4-s4、E5-s2、E5-s4 | **2.0** |
| 只改次数 | E1-s4、E2-s3、E2-s4、E3-s4 | **4.0** |
| 改重量（本协议里同时改了次数） | E1-s2 8、E3-s2 8、E4-s3 7、E5-s3 10 | **8.3** |
| 热身组 | E1-s1 | **8** |
| 自重 | E4-s1 4、E4-s2 5 | **4.5**（加重组 7） |

### T3 第二次训练（历史 → 复制到今天）

| 阶段 | 动作序列 | 备注 |
|---|---|---|
| start（4） | 历史标签 → 日历上的 26 号（51×94）→ 复制到今天（86×43）→ 首页「第1练 GO!」卡片（352×82） | 复制后自动回首页，多出一张待开始的卡片；进去后 5 个动作全部收起，[截图](shots/xunji/06_copy_to_today_collapsed.png) |
| 每个动作 add（共 9） | E1 点开 1；E2 滑 + 点开 + 滑回 3；E3 滑 + 点开 2；E4 点开 1；E5 滑 + 点开 2 | 手风琴切换后第一组常被挤出屏幕 |
| 每组（19 × 1） | 只点 ✓ | 数字（含热身标记、自重 +kg）全部预填且吻合 |
| finish（2） | 完成 → 完成训练 | |

**合计 34 次**（点击 30、滑动 4），0 打字。每组开销：所有类别都是 **1.0**（只点 ✓）；「换动作」平均 1.8 次。新的一次如果数字要变，单格修改的成本同 T4（点格 + 打数字 + 收键盘或直接点 ✓）。

### T4 改错

改已完成的组 60×8 → 62.5×8：点重量格 → 6 → 2 → . → 5 → 收起键盘 = **6 次**，组保持已完成，容量即时更新。删除一组：「…」→ 删除 = **2 次**，没有确认，也没有提示。**没有撤销**（训练页设置里也没有）。合计 8 次。

### T5 中途改计划

加动作 → 搜 `overhead`（站姿杠铃推举排第一）→ 完成：6 次；排序：长按卡片进入独立的排序层（提示「请长按每一个动作条进行拖拽排序」）→ 长按拖动一行 → 保存当前排序：3 次（拖动是一次长按拖拽；本次没有深蹲，拖到器械推胸上方代替）；删除：齿轮 → 删除，2 次，无确认。合计 **11 次**（含 1 次长按、1 次长按拖拽、8 个字母）。

### T6 中断

- 按 Home 等 5 秒再打开：回到同一训练页，计时一直在走，数据完整。
- 强制停止再打开：**落在首页，不自动回到训练，也没有提示**；进行中的训练显示为「第3练 11%」卡片（[截图](shots/xunji/07_after_force_stop.png)）。点进去所有修改都在，但**训练计时停住了**（停在强杀前约 20 秒的值，要点 ▶ 才继续）。

### T7 查看上次数据和进步

- **训练中**：点开卡片 → 动作历史 → （看到每次训练的每组和 1RM 预测，[截图](shots/xunji/08_exercise_history_1rm.png)）→ 图表 → 关闭 = **4 次**。图表是**付费锁**：用一张假数据图（02/14–08/25、容量纪录 3000 kg）加「点击开启训记Pro，解锁动作图表」遮着，[截图](shots/xunji/09_chart_locked.png)。
- **训练外**：动作标签 → 杠铃卧推卡片（先进「要点」页，满屏视频讲解预告）→ 历史 → 图表 → 关闭 = **5 次**（若从训练页出来还要先点「最小化」，计 6 次）。统计页的「最大重量与 PR」免费给出每个动作的最大重量和 1RM 预测。

### T8 导出

我的 → 下滑 → 数据导出和导入 = 3 次。页面是 4 份「Skill」（设置管理 / 训练 / 饮食 / 身体），写着「会员专属能力」「开通会员后，即可连接数据并使用 4 份 Skill」，用途是让外部 AI Agent 用 Key 读写数据。**没有任何免费的 CSV / JSON / 文件导出**；历史设置里的「管理历史记录」只有多选删除。结论：导出 = 付费，而且不是文件。[截图](shots/xunji/10_export_agent_skill.png)

## 7. 亮点（值得 fitlog 借鉴）

1. **键盘即操作面板**：数字键盘旁边直接切热身组、递减组、左右、RPE、加一组、一键改上下。组类型和 RPE 不用开菜单。[截图](shots/xunji/01_keypad.png)
2. **复制到今天**：重复上一次训练只要 4 次点击就到训练页，之后每组只点 ✓（T3 共 34 次，比 T1 少 76%）。
3. **自重动作的「+kg」格**：空着就是自重，填数就是附加重量，体重从资料里取，容量也算对。和 fitlog「器械感知」的思路一致。
4. **RPE 选择带解释**：选 8 时显示「RPE 8: 剩余 2 次」，次数格右上角出现小标。
5. **回收站**：训练删了能恢复（云端 15 天、本地可恢复）。强杀后进行中的训练也不丢。
6. **杠铃片计算器**：画出单边配片，片库存可增减规格。[截图](shots/xunji/13_plate_calc.png)
7. **为健身房环境调目标尺寸**：「训练按钮大小」三档（标准 / 大 / 特大）专门放大输入格和 ✓，说明里写着「老花、手抖、手指粗」；训练页另有「大字版」。两者都不改键盘。见第 10 节的尺寸表。
8. **备选动作**：给动作预设一个备选（器械被占时用），卡片上点一下就切过去，两边的组各自保留，切回主动作数据还在。

## 8. 痛点

1. **手风琴卡片 + 新动作在列表底部**：每换一个动作都要先点开，常常还要滑动找第一组；T1 加动作平均 7.8 次。偏好里的「自动打开下一个动作」能省掉按顺序练时的这一步，但默认关，而且藏在偏好设置第二屏。
2. **「新增一组」连组类型一起复制**：热身组之后的正式组会被错标成热身，必须手动取消，容易记错容量。
3. **组行里没有上次数据**：要点「动作历史」进另一个弹层才能对照。
4. **英文搜索结果排序差**：`chest press` 时器械推胸排在悍马机、绳索后面，要靠 32×20 dp 的索引字母跳；系统中文输入法会把 `dip` 转成「低频」。
5. **锁数据**：单动作进步图表、计划重量、训练中的「临时超级组」、导出都要 PRO（动作库里「新增超级组」免费，存好后照常加进训练，只是要提前建；[付费页](shots/xunji/11_paywall.png)、[超级组锁](shots/xunji/12_superset_locked.png)、[计划重量锁](shots/xunji/15_plan_weights_locked.png)）；图表锁用假数据冒充，容易误导。
6. **没有撤销**，删组、删动作也都不确认。
7. **强杀后**不回到训练，计时停住且不提示。
8. **臃肿**：首页一半是（付费的）饮食卡和官方计划，完成弹窗把「生成分享图」放成主按钮，休息计时首次弹全屏并顺带要电池权限。第二轮补测又看到经期、轻断食、照片墙、备忘录、教练排课、杠铃轨迹视频分析、HIIT 计时、性能诊断，「我的」页有 30 多个入口；「小工具」里还有「一键清理个人模版」「历史体重全部置0」这类修数据的按钮。
9. **替换动作会覆盖已记录的组**：已打勾的 3 组 60 kg 换成别的动作后，全部变回未完成、重量改成「智能重量推荐」的 20 kg，组备注和组间有氧也丢了，没有撤销。（详见第 10 节）

## 9. 与 fitlog 定位的对照

1. **重复训练**：训记靠「复制到今天」把稳态成本压到每组 1 次点击，这是 fitlog 必须对标的数字；fitlog 的优势要落在「不用点开卡片、不用滑动找组、上次就在行内」。
2. **首次记录**：训记首组约 8 次、改重量约 8 次，主要花在「点格 + 逐位打数字 + 点次数格」。fitlog 不强制键盘、一下记一组，在 T1 类场景上有明显空间。
3. **数据归属**：训记要登录、云端存储，导出只有付费的 Agent Skill。fitlog 免费 CSV/JSON 导出 + 自动备份，差异最直接。
4. **器械感知**：训记只有一套全局片库存、按动作切单位；fitlog 按健身房配片和舍入、按器械设单位和步进，更进一步。
5. **不锁功能**：训记把进步图表、训练中的临时超级组、计划重量、导出锁在 ¥28/月或 ¥88 永久后面；fitlog 全部免费。
6. **可借鉴**：键盘上切组类型和 RPE、自重「+kg」格、回收站、备选动作、「自动打开下一个动作」，都不违背「纯粹记录」。
7. **大按钮**：训记用「训练按钮大小」三档 + 「大字版」照顾健身房里的手抖、出汗、看不清，但只放大格子和 ✓，键盘、「新增一组」、组行「…」（约 17×6 dp 的三个点）都不变。fitlog 要讲「不用精准点击」，应当拿整条记录路径上最小的那个目标来比，不只比 ✓。

## 10. 补测（第二轮）

2026-10-26 下午补测第一轮没用过的功能，日志是 `xunji_s2`。会改变记录成本的功能各开一个 `X-…` 阶段记一组；其余在 explore 里操作。朋友、分享训记、华为 / OPPO 健康、手表、Mac 登录按约定排除。补测中建的训练、超级组、分类、备忘录、断食和经期记录都已删除，偏好恢复成原值。

### 10.1 目标尺寸：训练按钮大小 × 大字版

「训练按钮大小」在 我的 → 偏好设置 → 训练设置（第二屏），说明写着「改变『输入框』和『打勾』按钮的大小，能够适配各种复杂情况：老花、手抖、手指粗」，本机默认是「大」。「大字版」是训练页右下角 设置 里的开关，对所有训练生效。每档都记了一组 60×8（点重量格 → 6 → 0 → 点次数格 → 8 → ✓），尺寸来自 UI 树命中检测，标「约」的是看截图量的：

| 设置 | 重量 / 次数格 | ✓ | 键盘数字键 | 新增一组 | 记一组首组的点击数 |
|---|---|---|---|---|---|
| 标准 | 54×30 dp | 52×30 dp | 69×48 dp | 160×41 dp | 6 |
| 大（默认） | 54×42 dp | 52×42 dp | 69×48 dp | 160×41 dp | 6 |
| 特大 | 54×50 dp | 53×50 dp | 69×48 dp | — | 6 |
| 大 + 大字版 | 66×54 dp | 约 55×53 dp | 69×48 dp | 160×41 dp | 改次数一组 4（新增一组 → 次数格 → 7 → ✓） |

结论：两项设置都只放大格子和 ✓（「按钮大小」只加高度，「大字版」宽高和字号一起加），点击数不变，自家键盘、「新增一组」、组行「…」都不变。组行「…」只是三个点（约 17×6 dp），UI 树测不到实际热区。改「按钮大小」对已经打开的训练不生效，要新开一场才看得到。[截图：大字版 + 组备注](shots/xunji/s2_bigfont_setnote.png) · [截图：按钮大小设置](shots/xunji/s2_button_size_pref.png)

### 10.2 组行「…」：组备注、复制本组、手动开始休息

点组行最右的「…」弹出菜单：手动开始休息计时 / 复制本组 / 热身组 / 递减组 / 输入组备注 / 删除（每项 157×48 dp）。**组备注**：点「输入组备注」弹系统键盘，写完点空白处收起，灰字显示在该组下方；成本是 2 次点击 + 打字 + 1 次收起。偏好里有「是否复制每组备注」，管「复制历史」时带不带备注。**复制本组**：把这一组复制到该动作的**最后**（不是紧跟在下面），未打勾，备注不复制，共 2 次点击。**手动开始休息计时**：不打勾也能启动和打勾后一样的 60 s 悬浮圆。三项都免费，都藏在一个很小的「…」后面。

### 10.3 每组计时、简单 / 正常 / 困难

**每组计时**是卡片上的开关。打开后每组 ✓ 旁显示「01:00」，点 ✓ 不再直接完成，而是弹出全屏 TRAINING TIMER：先「准备」5 s，再「训练计时」60 s，按钮有 跳过 / 连续播放 / 最小化。计时结束或点「跳过」才算完成，之后照常开始休息倒计时。记力量组时每组多 1 次点击或多等一分钟，适合平板支撑这类计时动作。计时时长点秒表图标进「动作-时间设置」改（一个浅色网页，在暗色 app 里很突兀）。偏好里还有「是否在点击计时器之后打勾本组」。**简单 / 正常 / 困难**是每个**动作**一个三选一（不是每组），点一下就选上，不弹窗。

### 10.4 动作齿轮：组间有氧、组间休息、备选动作、替换动作

**组间有氧**：从约 10 个动作（原地跑等）里选一个，填秒数，卡片上多一行「原地跑(30s)」。**组间休息**：给这个动作单独设热身组 / 正式组的休息秒数（系统键盘）。**备选动作**：从动作库选一个，卡片底部出现它的缩略图；点一下整张卡切到备选动作，两边各有各的组，「备选动作(1)」展开后点「主动作」能切回，数据都在，适合器械被占的时候。**替换动作**：新页面先选训练场景（健身房 / 纯器械 / 在家哑铃）和身体状况（只是不想做 / 腰不舒服 / 膝盖痛…），给出 8 个推荐（附「发力模式几乎一致」之类的理由）。点一个立刻替换（X-replace：齿轮约 17×17 dp → 替换动作 175×48 dp → 推荐项 352×106 dp，共 3 次）。**问题**：已打勾的 3 组 60 kg 全部变回未完成，重量被「智能重量推荐」改成 20 kg（toast 要长按才关），组备注和组间有氧也没了，没有撤销。[截图](shots/xunji/s2_replace_exercise.png)

### 10.5 语音播报

训练页 设置 → 语音播报：页面先提示主要用于自重训练，然后可以按动作设每次间隔、组间休息、换动作的秒数。「开始播报」进入全屏跟练，语音数次数（显示 0/8、60 kg）；点 × 弹「提前结束」确认。退出后训练总计时停住了，要手动继续。超级组卡片底部直接有「语音设置 / 语音播报」两个按钮。跟练是一种引导式训练，不是减少记录点击的辅助。

### 10.6 置顶动作、管理分类、新增超级组

**置顶**：动作详情顶部的图钉点一下，这个动作就进入所在部位列表最上方的「置顶」组（动作页和选动作页都有），再点一下取消。**动作页右上 +** 有三项：新增动作 / 新增超级组 / 管理分类。**管理分类**：23 个内置分类排成网格（右上角「-」），自定义分类带 ×；「新增分类」弹窗输入名称，长按拖动排序，删除会确认「删除之后，该分类下的动作不会删除」。**新增超级组（免费）**：在库里选两个以上动作 → 组合 → 起名（默认「A+B」）→ 保存到左侧「超级组」分类，之后像普通动作一样加进训练。卡片上每轮一个 ✓，每个动作各有一行重量 / 次数格，键盘里没有「热身组」键。记一轮 60×8 + 40×8 共 11 次点击（X-superset-round）。所以超级组只是训练中**临时**组合要付费，提前在库里建好是免费的。[截图](shots/xunji/s2_superset_card.png)

### 10.7 自动打开下一个动作

偏好设置 → 训练设置 →「完成一个动作后，自动打开下一个动作」（默认「不自动」）。改成「自动」后，最后一组打勾时当前卡片收起，下一张自动展开，第一组就在屏幕里。这正好省掉第 8 节痛点 1 里「点开下一张、再滑回第一组」那一步，但默认关着，很难找到。同一页还有「输入框位置（左 kg 右次 / 左次右 kg）」「完成一组该动作就统计为完成」「『+-』时间时是否改变动作的休息时间」，另一页有「休息计时器类型 倒计时 / 正计时」和「PR 标记」。[截图](shots/xunji/s2_auto_open_next.png)

### 10.8 有氧、HIIT、休息日

**新建有氧**：可以自己填名称，也可以从「选择有氧运动」里挑（常用 / 有氧 / 球类 / 力量 / 身心 / 户外 / 水上 / 冰雪 / 其他，可搜索）。下面是类型（匀速有氧）、目标时间、日期；记录字段随运动变（通用：距离 / 消耗 / 平均心率；步行：再加步数和节奏）。「开始」进入全屏计时，暂停后「继续」或「长按结束」（按 1.5 s 不够，3.5 s 才结束），结束后今日训练里多一张卡；也可以「直接完成训练」，不计时只填数据。**新建 HIIT**：间歇计时器，「训记默认模版」是运动 10 s / 休息 10 s、3 个动作（箭步走 / 深蹲跳 / 自重深蹲）× 2 轮、热身和放松各 30 s，总计 02:50，自带屏幕常亮。开始后大字倒计时并显示「下一个」，「退出训练」直接退出，没留记录。**新建休息**：休息日标题、常用理由（休息日 / 有事 / 月经 / 生病 / 受伤 / 没心情 / 没动力 / 压力大 / 天气不好 / 加班，最多再加 10 个自定义）、日期和日历标签颜色。三项都免费。

### 10.9 轻断食、经期、RM 计算器、备忘录、照片墙

**轻断食**：12:12 / 14:10 / 16:8 免费，「自定义」要 VIP；可以「马上开始」或「到点开始」（计划 20:00），圆环倒计时，「结束断食」确认后切到「进食期间」倒计时。历史记录能补录，左滑编辑或删除（「删除后无法恢复」）。**经期**：日历标出经期 / 预测 / 卵泡期 / 排卵期 / 黄体期；先选日期再打开「月经来了」，按「经期长度 5 天 / 周期 28 天」标出 5 天，并给出建议（「尽可能停止力量训练和高强度有氧」）和心得框；可以在偏好里整块隐藏。**RM 计算器**：输入重量和次数（系统键盘）→ 1–30RM 对照表（60×8 → 1RM 74.9，8RM 59.9）。它是独立工具，和训练记录不连通。**备忘录**：标题 + 支持 markdown 的正文，自动识别抖音 / 微博 / 小红书链接，可以加图；删除要进详情 → 编辑 → 删除 → 确认。**照片墙**：空墙 + 悬浮 +，填「添加图片」和「上传到日期」，上传方式只有相册 / 相机，没授权，停在这里。

### 10.10 教练记、首页九宫格、我的页杂项

**教练记**：学员卡片网格，顶栏有 新版 / 课表 / 转移 / 筛选。免费最多 5 名学员（「当前学员 0/5」，PRO 不限人数）。「新增学员」要填照片、姓名（必填）、性别、训记 ID（选填，填了会关联对方账号）、分组，没有建。「课表」是排课总表，一周 05:00–23:00 的格子，粒度 1 小时或 30 分钟。**首页九宫格**里另有：扫码获取计划（相册 / 扫码，取消了）、过往心得（训练后心得按时间汇总，目前空）、杠铃轨迹跟踪（导入事先拍好的视频，准心对准杠端分析路径，要读相册，没继续）、HIIT 工具、周期中心（其实是「训练预约安排」，按周一到周日排模版或 AI 计划的某天）。**我的页**：「网络节点」可选 智能 / 国内（当前）/ 海外；「缓存」能重新上传本地训练记录（「当前有 12 条」，5 分钟冷却）和清除缓存，都没按，怕把删掉的训练传回去或退出登录；「小工具」分四组：训练工具（增肌指南长文，底部常驻「购买训记永久VIP(88元)」条；新建 HIIT）、修复与清理（解决支付卡顿、一键清理个人模版〔标危险〕、历史体重全部置0、历史白屏修复按钮）、诊断（性能诊断，手动开启后记录 CPU / 内存 / 掉帧，导出到微信）、迁移（卓易通密码、教练记数据转移、旧设备数据迁移）。**安卓悬浮窗倒计时**：切到后台时用系统悬浮窗继续显示休息倒计时，要系统悬浮窗权限，没开；样式里「基础」免费，「卡片」和「悬浮球」锁着。**拍照识别器械**：先弹 app 自己的「权限使用说明」（相机，照片会发到识别服务），选了「暂不授权」。

### 10.11 对 fitlog 定位的意义

- 训记在**健身房环境**上下了功夫（按钮三档、大字版、悬浮窗倒计时、屏幕常亮），但只做在 ✓ 和格子上；fitlog 如果要宣称「不用精准点击」，键盘、加组、组菜单这些目标也要一起达标。
- 能降低记录成本的选项（自动打开下一个动作、备选动作、手动休息）都存在，但默认关或藏在小目标后面；训记的默认路径比它的能力差。fitlog 应当把最省事的行为设成默认。
- 记录以外的模块（断食、经期、照片墙、备忘录、教练排课、轨迹视频、HIIT、休息日、性能诊断、修数据按钮）证实了「臃肿」：「我的」页有 30 多个入口。这些都是 fitlog 明确不做的。
- 「替换动作」会悄悄覆盖已记录的组，是训记少见的数据风险。fitlog 做「换动作」时，已完成的组必须保留。

## 截图

[自家键盘](shots/xunji/01_keypad.png) · [新组继承热身标记](shots/xunji/02_new_set_copies_warmup.png) · [自重 +kg](shots/xunji/03_bodyweight_plus_kg.png) · [完成弹窗](shots/xunji/04_finish_dialog.png) · [历史当天](shots/xunji/05_history_day.png) · [复制到今天后全部收起](shots/xunji/06_copy_to_today_collapsed.png) · [强杀后首页](shots/xunji/07_after_force_stop.png) · [动作历史与 1RM](shots/xunji/08_exercise_history_1rm.png) · [图表锁](shots/xunji/09_chart_locked.png) · [导出要会员](shots/xunji/10_export_agent_skill.png) · [付费页](shots/xunji/11_paywall.png) · [超级组锁](shots/xunji/12_superset_locked.png) · [杠铃片计算器](shots/xunji/13_plate_calc.png) · [首次休息模态](shots/xunji/14_rest_modal_first_time.png) · [计划重量锁](shots/xunji/15_plan_weights_locked.png)

第二轮：[大字版 + 组备注](shots/xunji/s2_bigfont_setnote.png) · [训练按钮大小设置](shots/xunji/s2_button_size_pref.png) · [替换动作](shots/xunji/s2_replace_exercise.png) · [自动打开下一个动作](shots/xunji/s2_auto_open_next.png) · [库里建的超级组记一轮](shots/xunji/s2_superset_card.png)

## 附录：`tally xunji` 原始输出

说明：T5 的长按拖拽是用 adb `motionevent` 直接发的（`swipe` 无法触发长按拖动），没进日志，需另计 1 次。`explore` 阶段包含清理旧数据和功能复核。

```
== xunji / phase explore
   ops: {'launch': 1, 'tap': 104, 'text': 12, 'swipe': 18, 'key': 7}  typed chars: 59  voided: 0
   tap/long target min-side: {'unknown': 104}
   swipe distances (dp): [285, 355, 213, 213, 213, 213, 213, 213, 213, 213, 213, 213, 213, 213, 427, 427, 427, 427]
   note: Prefs defaults: 打勾时弹出计时器=弹出, 自动复制历史=直接复制 (kept). Deleted 2 workouts of 2026-10-26, cancelled 5x5 plan (type-to-confirm '9056' dialog). Kept AI plan, challenge, BeltSquat.
   note: T3 done: 复制到今天 path. Now setting up a workout in progress for T4-T7 (copy again, check bench sets)
== xunji / phase T1-start
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1, 'lt32dp': 1}
   note: FAB menu overlay not in UI tree: hit-test for 新建训练 wrongly reports 减脂塑形; real target is icon ~70px shot (~50dp) + label
== xunji / phase T1-E1-add
   ops: {'tap': 5, 'text': 1, 'key': 1}  typed chars: 5  voided: 0
   tap/long target min-side: {'ge48dp': 3, '32-47dp': 2}
   note: Search: typed 'bench' (IME already in English mode; switched once in explore), pressed keyboard 搜索/enter to hide keyboard (live filter)
   note: Exercise added collapsed (accordion card), no prefill (0.0/0.0, 1组) - must tap card to expand
== xunji / phase T1-E1-s1
   ops: {'tap': 8}  typed chars: 0  voided: 6
   tap/long target min-side: {'32-47dp': 3, 'ge48dp': 4, 'lt32dp': 1}
   note: App's own keypad (not system keyboard); list auto-scrolls so active row sits above keypad; field hint 杠+总片
   note: my mis-tap (typed 1 instead of 4); voided fix-up
   note: Set marked done: whole row turns green, workout timer starts on first check, rest timer starts as floating circle bottom-right (60s), no modal (minimized form remembered from earlier use). Warm-up set excluded from volume.
== xunji / phase T1-E1-s2
   ops: {'tap': 8}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 1, 'ge48dp': 5, '32-47dp': 2}
   note: 新增一组 copies previous set incl. warm-up flag (row2 = 热 40x10); must un-toggle warm-up
   note: Floating rest timer overlaps keypad RPE/一键改向下 keys
== xunji / phase T1-E1-s3
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1, 'unknown': 1}
== xunji / phase T1-E1-s4
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2, 'lt32dp': 1, '32-47dp': 1}
== xunji / phase T1-E2-add
   ops: {'tap': 5, 'text': 1, 'key': 1, 'swipe': 1}  typed chars: 7  voided: 1
   tap/long target min-side: {'ge48dp': 3, '32-47dp': 2}
   swipe distances (dp): [285]
   note: incline search: results grouped by equipment, barbell first; 上斜哑铃卧推 needs one scroll
== xunji / phase T1-E2-s1
   ops: {'tap': 9}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 7, 'lt32dp': 1, 'unknown': 1}
   note: Dumbbell weight field: no per-hand/total hint (barbell had 杠+总片); entered 22.5 as per hand. Has 记录左右 toggle on card.
== xunji / phase T1-E2-s2
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1, 'unknown': 1}
   note: Dumbbell volume counted as 22.5x10=225 (not x2)
== xunji / phase T1-E2-s3
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2, 'lt32dp': 1, 'unknown': 1}
== xunji / phase T1-E2-s4
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, 'unknown': 1}
== xunji / phase T1-E3-add
   ops: {'tap': 6, 'text': 1, 'key': 1}  typed chars: 11  voided: 0
   tap/long target min-side: {'32-47dp': 3, 'unknown': 1, 'ge48dp': 2}
   note: chest press search: 器械推胸 not near top (dumbbell/cable/悍马 groups first); used right-edge equipment index letter 器 (32x20dp) to jump
== xunji / phase T1-E3-s1
   ops: {'tap': 7}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 2, 'lt32dp': 1, 'ge48dp': 4}
== xunji / phase T1-E3-s2
   ops: {'tap': 8}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 3, 'ge48dp': 4, 'unknown': 1}
== xunji / phase T1-E3-s3
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1, 'unknown': 1}
== xunji / phase T1-E3-s4
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, 'unknown': 1}
== xunji / phase T1-E4-add
   ops: {'tap': 5, 'text': 1, 'key': 1}  typed chars: 3  voided: 0
   tap/long target min-side: {'32-47dp': 3, 'ge48dp': 2}
== xunji / phase T1-E4-s1
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, 'unknown': 1}
   note: 双杠臂屈伸 is type 自身加重: +kg field (blank=BW), shows 当前体重 70kg (from profile); volume counts BW+added
== xunji / phase T1-E4-s2
   ops: {'tap': 5}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 2, 'ge48dp': 3}
== xunji / phase T1-E4-s3
   ops: {'tap': 7}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 2, 'ge48dp': 5}
== xunji / phase T1-E4-s4
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 2}
== xunji / phase T1-E5-add
   ops: {'tap': 5, 'text': 1, 'key': 1, 'swipe': 2}  typed chars: 5  voided: 3
   tap/long target min-side: {'32-47dp': 3, 'ge48dp': 2}
   swipe distances (dp): [285, 285]
   note: My tap meant to expand new card hit dips' 新增一组 (layout differed) -> extra set 5; voided and removing it
   note: New card added below the expanded previous card, off-screen -> scroll needed before expanding
== xunji / phase T1-E5-s1
   ops: {'tap': 7}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 7}
== xunji / phase T1-E5-s2
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
== xunji / phase T1-E5-s3
   ops: {'tap': 10}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 10}
== xunji / phase T1-E5-s4
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
== xunji / phase T1-finish
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   note: Finish dialog: primary button 完成并生成分享图, secondary text 完成训练, 取消
   note: Back on home; 第1练 0:30 已完成, 动作5 组数19 (warm-up not counted). No summary screen.
== xunji / phase T3-start
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, '32-47dp': 1}
   note: 复制到今天 returns to home automatically; new pending card 第1练 with GO! (listed above the completed one)
   note: All 5 exercises prefilled with T1 sets (incl. warm-up flag), all cards collapsed
== xunji / phase T3-E1-add
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== xunji / phase T3-E1-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
== xunji / phase T3-E1-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
== xunji / phase T3-E1-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
== xunji / phase T3-E1-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
== xunji / phase T3-E2-add
   ops: {'swipe': 2, 'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
   swipe distances (dp): [285, 178]
   note: Expanding next card collapses previous (accordion) and leaves list scrolled so row 1 is off-screen; scroll back needed
== xunji / phase T3-E2-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== xunji / phase T3-E2-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== xunji / phase T3-E2-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1}
== xunji / phase T3-E2-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1}
== xunji / phase T3-E3-add
   ops: {'swipe': 1, 'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
   swipe distances (dp): [355]
== xunji / phase T3-E3-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== xunji / phase T3-E3-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== xunji / phase T3-E3-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
== xunji / phase T3-E3-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
== xunji / phase T3-E4-add
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1}
== xunji / phase T3-E4-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== xunji / phase T3-E4-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== xunji / phase T3-E4-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== xunji / phase T3-E4-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== xunji / phase T3-E5-add
   ops: {'swipe': 1, 'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
   swipe distances (dp): [355]
== xunji / phase T3-E5-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
== xunji / phase T3-E5-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
== xunji / phase T3-E5-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1}
== xunji / phase T3-E5-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1}
== xunji / phase T3-finish
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 2}
== xunji / phase T4
   ops: {'tap': 8}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 3, 'ge48dp': 5}
   note: Edit done set: tap value -> keypad (value pre-selected, typing replaces) -> type 62.5 -> hide keypad (keypad-hide button); saved instantly, set stays done, volume updates
   note: Set delete via row ... menu -> 删除: no confirm, no toast, no undo anywhere (workout 设置 sheet has no undo either)
== xunji / phase T5
   ops: {'tap': 7, 'text': 1, 'key': 1, 'long': 1}  typed chars: 8  voided: 1
   tap/long target min-side: {'ge48dp': 4, '32-47dp': 3, 'unknown': 1}
   note: Overhead press: search 'overhead' -> 站姿杠铃推举 first result; added at bottom of list (6th), off-screen, no feedback
   note: adb swipe can't drag here (needs hold first). Performed ONE long-press-and-drag via raw adb motionevent (not auto-logged): count as 1 long-press drag of 站姿杠铃推举 row (row ~384x58dp) to 2nd position
   note: Drag result: 站姿杠铃推举 landed 3rd (above 器械推胸; no squat in this workout so 器械推胸 stands in). Sort page is a separate overlay list, needs 保存当前排序
   note: Exercise delete via gear -> 删除: no confirm, no undo
== xunji / phase T6
   ops: {'key': 1, 'launch': 2, 'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
   note: After home+relaunch: same workout screen, timer kept running (05:07), all data intact
   note: After force-stop: opens on home (no auto-resume, no prompt); in-progress workout shown as 第3练 with progress 11%; no floating 训练进行中 pill visible
   note: Resumed: all edits/deletes intact, but workout timer PAUSED at 04:48 (was 05:07 before kill; ~20s lost, needs manual play)
== xunji / phase T7
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2, '32-47dp': 1, 'lt32dp': 1}
   note: 动作历史 sheet: per-session sets + 1RM预测 per set (incl. current workout at top). Free.
   note: 图表 tab: PRO lock - sample/fake chart (records 3000kg/150kg/180kg, dates 02/14..08/25 not user data) behind '点击开启训记Pro，解锁动作图表'
== xunji / phase T7-outside
   ops: {'tap': 6}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, 'lt32dp': 3}
== xunji / phase T8
   ops: {'tap': 6, 'swipe': 1, 'key': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 4, 'lt32dp': 1, '32-47dp': 1}
   swipe distances (dp): [355]
   note: 数据导出和导入 = 4 Agent Skills (设置/训练/饮食/身体), '会员专属能力'; no CSV/JSON/file export
   note: 管理历史记录 = list with multi-select delete only. T8 conclusion: no free file export found
```

## 附录：`tally xunji_s2` 原始输出（第二轮补测）

说明：补测途中误用了 `void 0`，脚本把它当成「作废之前全部动作」，所以 `X-baseline-set`、`X-bigfont-set` 两个阶段显示 0 次操作，`X-setnote` 少了前 2 次，explore 的 voided 也是这么来的。这三项已在 `-redo` 阶段重做，以 `-redo` 为准。`X-btnsize-*`、`X-settimer-set`、`X-copyset`、`X-replace`、`X-superset-round` 不受影响。

```
== xunji_s2 / phase explore
   ops: {'tap': 240, 'text': 9, 'swipe': 20, 'long': 7, 'scroll': 49, 'key': 8}  typed chars: 41  voided: 22
   tap/long target min-side: {'unknown': 247}
   swipe distances (dp): [285, 213, 355, 178, 355, 285, 355, 285, 355, 355, 498, 498, 39, 213, 249, 213, 284, 498, 213, 284]
   note: 语音播报: workout 设置 -> 语音播报: disclaimer (only for bodyweight), per-exercise rep interval/rest/next-exercise seconds, 开始播报 -> fullscreen follow-along player counting reps 0/8(60kg); X -> 提前结束 dialog; after exit workout timer paused at 00:53
   note: 复制本组: appends copy at end of exercise (not below source), undone, weight/reps copied, set note NOT copied
   note: 手动开始休息计时: starts the same floating 60s rest circle without marking set done
   note: 每组计时 stopwatch icon -> 动作-时间设置 page (light-themed web page in dark app): 训练时间/准备时间 统一设置 + per-set
   note: 简单/正常/困难: per-exercise radio (one per exercise, not per set), tap fills circle; no prompt
   note: 备选动作: picker; alt shows as thumbnail at card bottom (清除/x); tapping it swaps card to the alt exercise with its own empty sets (main sets hidden, header 0/1组), 备选动作(1) expands 主动作/备选动作 thumbnails, tap 主动作 to swap back; data kept. 组间休息(设置): per-exercise 热身组/正式组 seconds page (system keyboard). 组间有氧: pick 1 of ~10 cardio moves + seconds, shown as row '原地跑(30s)' on card
   note: 替换动作: page with 训练场景 (健身房/纯器械/在家哑铃) + 身体状况筛选 (只是不想做/腰不舒服/膝盖痛...) and 推荐替代动作(8) with reasons; tap one -> replaced instantly, set count kept, done flags cleared, weights reset to 智能重量推荐 20kg toast (保守起始建议, 长按关闭提示)
   note: After replace: the 3 done 60kg sets became undone 20/8,20/7,20/7 - logged weights overwritten; set note, 组间有氧 gone. Toast stays until long-press
   note: 训练按钮大小 (偏好设置 > 训练设置): 标准/大/特大, found at 大 (baseline measurements so far were at 大 with 大字版 off). Also found: 输入框位置 左kg右次/左次右kg, 完成一个动作后自动打开下一个动作 (不自动 default), 是否在点击计时器之后打勾本组, 是否复制每组备注
   note: Button size change not applied to open workout until reopened
   note: 完成一个动作后自动打开下一个动作=自动: after the last set of bench was checked, bench card collapsed and the next card (dips) expanded automatically with row 1 visible on screen - fixes the accordion extra tap (off by default)
   note: 置顶: 动作详情 header pin icon -> exercise appears in a 置顶 group at top of its body-part list (per body part), one tap toggle
   note: 新增超级组 (动作页 +): free; pick exercises -> 组合 -> name dialog (default A+B) -> saved under left category 超级组 (bottom of list), card shows both names
   note: 管理分类: 23 built-in categories with '-' badge, custom with x; 新增分类 dialog (system keyboard); long-press drag to sort; delete custom -> confirm '删除之后，该分类下的动作不会删除'. Created and deleted Gym2
   note: 识别: in-app pre-permission dialog 权限使用说明 (相机权限, 拍照识别健身器械, photo sent to recognition service) -> declined 暂不授权
   note: 经期: select a date first, then 月经来了 toggle -> marks 5-day period (from 经期长度 5 / 周期 28 settings), shows 写心得 box and advice text (stop strength training, eat iron). Toggle needs a date selected first (tapping 今 path didn't work)
   note: 轻断食: preset 14:10 (dropdown), 马上开始 / 到点开始 (planned 20:00), ring countdown 断食期间 -> 结束断食 confirm -> switches to 进食期间 countdown; 历史记录 sheet with 补录, swipe to edit/删除记录. Started+ended+deleted record; state back to 准备开始
   note: 断食计划 sheet: 12:12 / 14:10 / 16:8 / 自定义 (VIP 可自定义断食时长), 开始时间, 结束提醒
   note: RM计算器: weight + reps (system keyboard) -> 开始计算 -> table 1-30RM with % (60x8 -> 1RM 74.9, 80%=59.9; percentages fixed table); free, standalone (not linked to logs)
   note: 照片墙: empty wall + FAB -> 添加图片 / 上传到日期 / 完成; 上传方式 相册/相机 -> stopped (needs photo/camera permission); returned
   note: 备忘录: title + markdown body (links auto-tagged: 抖音/微博/小红书), images; list shows created/updated dates; delete via detail -> 编辑 -> 删除 -> confirm. Created+deleted test memo
   note: 教练记: coach mode - student cards grid, free up to 5 students (PRO unlocks unlimited), top bar 新版/课表/转移/筛选; 新增学员 form: photo, 姓名(required), 性别, 训记ID(optional, links student account), 分组. Not created (would link another person)
   note: 教练记 课表: weekly 排课总表 05:00-23:00 grid, 1h/30min granularity
   note: 缓存: 重新上传训练记录 (12 local records re-uploadable, 5 min cooldown) + 清除缓存 (fix stubborn bugs) + hidden __DD输出. Not pressed: re-upload could resurrect deleted workouts / clear may log out
   note: 小工具: 训练工具 (增肌指南 = article page with 购买训记永久VIP(88元) bar; 新建HIIT), 修复与清理 (解决支付卡顿, 一键清理个人模版[危险], 历史体重全部置0, 历史白屏修复按钮), 诊断工具 (性能诊断: opt-in CPU/内存/掉帧 log, export to WeChat), 账号与登录 (卓易通密码设置), 迁移与恢复 (教练记数据转移, 旧设备数据迁移). Destructive ones not pressed
   note: 网络节点: 智能选择/国内服务器(current)/海外服务器; not switched
   note: 新建有氧: name + 选择有氧运动 (categories 常用/有氧/球类/力量/身心/户外/水上/冰雪/其他, search), 类型 匀速有氧, 时间 1min, 日期, 记录方式 auto by sport (步行记录: 距离/步数/消耗/心率...), 开始 -> full-screen timer, 暂停 -> 继续 / 长按结束 (~3s hold). Or 直接完成训练 (log without timer)
   note: 新建HIIT: interval timer page (训记默认模版 switcher, 运动时长/间歇, 动作数 3 (箭步走/深蹲跳/自重深蹲), 循环 2, 每轮休息, 热身/放松, 屏幕常亮, total 02:50) -> 开始 shows phase countdown + 下一个; 退出训练 exits immediately (no record). HIIT模版 button for saved templates
   note: 新建休息: 休息日标题, 常用理由 chips (休息日/有事/月经/生病/受伤/没心情/没动力/压力大/天气不好/加班 + 自定义 up to 10), 日期, colour for calendar tag. Cancelled (not saved)
   note: 轨迹跟踪 (九宫格): 杠铃轨迹跟踪 - pick a pre-recorded video, aim crosshair at bar end, analyse path. Needs media access -> not used. 九宫格 also: 扫码获取计划 (camera), 过往心得, HIIT工具, 周期中心, 教练记
   note: 周期中心 = 训练预约安排: weekday tabs 周一..周日/自定义, + picks a template/AI-plan day to schedule on a weekday. Not saved. 过往心得: list of post-workout notes (empty)
   note: 安卓悬浮窗倒计时 (new row): rest countdown as system overlay when app is backgrounded; needs SYSTEM_ALERT_WINDOW (打开系统悬浮窗权限页 - not granted); styles 基础(free) / 卡片 / 悬浮球 (锁定=PRO); 高画质版/性能版
   note: Restored prefs: 训练按钮大小=大, 自动打开下一个动作=不自动; 大字版 off; no workout in progress; fasting idle; period cleared; pin removed; superset & category & memo deleted
   note: LOG FIX: an earlier 'void 0' voided ALL prior actions (python [-0:] slice). Redoing X-baseline-set, X-bigfont-set, X-setnote below as -redo phases
   note: 扫码获取计划: dialog 相册/扫码/取消 (import a plan someone shared as QR) -> cancelled (needs camera/photos)
== xunji_s2 / phase X-baseline-set
   ops: {}  typed chars: 0  voided: 6
== xunji_s2 / phase X-bigfont-set
   ops: {}  typed chars: 0  voided: 4
   note: 大字版 on: weight/reps cells 54x42 -> 66x54dp, check 52x42 -> 55x53dp, fonts larger; keypad unchanged (digits 69x48dp); 新增一组 unchanged 160x41dp
== xunji_s2 / phase X-setnote
   ops: {'text': 1, 'tap': 1}  typed chars: 11  voided: 2
   tap/long target min-side: {'32-47dp': 1}
   note: row ... menu target: UI tree unavailable; visible glyph is 3 dots ~17x6dp (hit area unknown, recorded below as visible size of the second-to-last action is not settable); system keyboard opens for set note
== xunji_s2 / phase X-copyset
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1, 'ge48dp': 1}
== xunji_s2 / phase X-settimer-set
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   note: 每组计时 on: each check box shows timer 60; tapping check opens TRAINING TIMER modal: 准备 5s countdown then 训练计时 60s, buttons 跳过 / 连续播放 / minimize; set marked done only after timer ends or 跳过, then normal rest timer starts. Cost +1 tap (跳过) or waiting
== xunji_s2 / phase X-replace
   ops: {'tap': 3}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 1, 'ge48dp': 2}
== xunji_s2 / phase X-btnsize-XL-set
   ops: {'tap': 6}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 6}
   note: 训练按钮大小=特大 (大字版 off): weight/reps cells 54x50dp, check 53x50dp (vs 大 54x42 / 52x42): only height grows; keypad unchanged 69x48dp
== xunji_s2 / phase X-btnsize-std-set
   ops: {'tap': 6}  typed chars: 0  voided: 1
   tap/long target min-side: {'lt32dp': 3, 'ge48dp': 3}
   note: 训练按钮大小=标准: cells 54x30dp, check 52x30dp (vs 大 42dp tall, 特大 50dp tall). Keypad 69x48 in all three
== xunji_s2 / phase X-superset-round
   ops: {'tap': 11}  typed chars: 0  voided: 0
   tap/long target min-side: {'lt32dp': 5, 'ge48dp': 6}
   note: Superset card (from library superset): one round = rows A and B each with kg/reps cells + one check for the round; keypad lacks 热身组 key; 4 bottom buttons 新增一组/动作历史/语音设置/语音播报. One round 60x8 + 40x8 = 10 taps. Volume 800
== xunji_s2 / phase X-baseline-set-redo
   ops: {'tap': 6}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 3, 'ge48dp': 3}
   note: baseline 训练按钮大小=大, 大字版 off: cells 54x42dp, check 52x42dp, keypad digits 69x48dp; first set 60x8 = 6 taps
== xunji_s2 / phase X-bigfont-set-redo
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1, 'ge48dp': 1, 'unknown': 2}
   note: 大字版 on (redo): cells 66x54dp, check ~55x53dp (screenshot-measured, UI tree unavailable this time); reps-only change = 3 taps after 新增一组
== xunji_s2 / phase X-setnote-redo
   ops: {'tap': 3, 'text': 1}  typed chars: 11  voided: 0
   tap/long target min-side: {'lt32dp': 1, 'ge48dp': 1, '32-47dp': 1}
```
