# Lyfta 竞品调研 v2

> 包名 `com.lyfta`，原生 Android（View 体系），2026-10-26 在小米真机（384×853 dp）上按 brief v2 实测。账号已登录、引导已走完、Premium 免费试用已开通，所以付费功能对我都是解锁的；哪些属于 Premium 只能从 app 内的介绍页推断（见 §1）。
> 开测前账号里没有任何训练（首页显示「来完成你的第一次训练吧」），T1 是真正的「无历史」。偏好设置保持默认：「默认休息时间 = 关闭」、「上次训练的数据 = 任意训练」、「RPE 或 RIR 跟踪 = RIR」。

## 1. 概况

- **定位**：国外主流的「Strong / Hevy 式」力量记录 app，外加社交动态（关注、社区、点赞评论、排行榜、挑战）、计划市场（官方 / 教练 / 社区计划，带下载量和评分）、AI 小工具（进阶建议、推荐组次方案、AI 反馈）、身体测量和进度照片。记录界面本身简洁，周边功能很多。
- **付费**：免费 + **Lyfta Premium**。账号正处于试用期，订阅页只显示「你是 Premium 会员」+「管理你的订阅」，**app 里看不到价格**（价格在 Google Play 订阅页，规则不允许进）。Premium 介绍页列出的付费内容：配重片计算器、热身自动插入（「更快地记录你的训练」）、训练模板和计划、个人记录和进度追踪、身体围度、AI 建议（「智能追踪」）、高级洞察、找出薄弱肌群。没有广告；首页常驻「添加好友」横幅和挑战卡；设置里有「送好友 30 天 Premium」「优惠码」「推广伙伴」。
- **语言**：完整简体中文界面（另有英德法西意荷等十余种）。**动作名称全是英文**（Bench Press、Lever Chest Press…），搜索也要打英文。
- **登录**：要账号，数据在云端（设置里有「同步训练数据」「删除你的账户」「退出登录」）。**隐私默认是「所有人」可见**：每次完成的训练默认公开发到动态里。

## 2. 上手流程（未实测）

账号早已走完引导，无法重跑。能从现有数据反推的：
- 引导收集了身体数据：双杠臂屈伸的训练量按「体重 + 附加重量」计算，反推出资料里的体重约 84.5 kg（我后来又在「测量」里记了一条 75 kg，T1 时还没有）。
- 「我的 → 概览」里有「推荐目标：每周 4 次训练」，应来自引导里填的训练频率。
- 引导末尾应有试用 / 付费墙（用户已自行开通试用）。屏数、字段数、付费墙关闭方式都**未实测**。

## 3. 导航结构

底部 5 个标签：
- **首页**：动态流（▾ 切换「首页（关注）/ 社区 / 我的」），顶部是每周总结、连续打卡火焰、寻找好友、通知；中间穿插「添加好友」横幅和「推荐挑战」；右下角悬浮「▶ 开始新训练」（143×56 dp）。每条训练卡片的 ⋮ 菜单：编辑 / 再做一次 / 分享 / 保存到收藏 / 删除。
- **探索**：计划 / 动作 / 教练三栏。计划库按热门、为你推荐、流行、评分最高分区，显示下载量和评分；动作按部位进入；教练栏是教练发布的计划。
- **训练**：周日历条 + 今日训练卡 +「开始新训练 / 寻找计划」+「训练分析」（肌肉恢复 %、周连续、AI 反馈）。
- **训练库**：训练计划 / 训练模板 / 动作（收藏、自定义动作），右上角「创建」可建计划、模板、动作。
- **我的**：概览（训练次数和训练量对比、肌肉恢复、月度连续、目标、肌群雷达）/ 动作（每个动作的预估 1RM + 迷你曲线）/ 测量 / 照片；右上角分享、日历、设置。
- 训练进行中可以点左上角 ∨「最小化训练」，之后各页底部常驻「训练进行中　▶ 继续　✕ 放弃」条。

## 4. 功能地图与覆盖率

| 功能 | 路径 | 免费/付费 | 状态 |
|---|---|---|---|
| 上手引导（身体数据、目标、试用） | 首次启动 | 免费 | 排除（引导，已完成不能重跑） |
| 首页动态 + 关注/社区/我的 筛选 | 首页 ▾ | 免费 | 已用 |
| 每周总结卡 | 首页顶部 | 免费 | 已用 |
| 挑战（「十月 举起 50k」） | 首页 推荐挑战 | 免费 | 进不去（第二轮首页（关注 / 社区）、探索、我的、连续打卡、通知里都找不到挑战卡，见 §10） |
| 连续打卡 / 日历 | 首页火焰、我的 → 日历 | 免费 | 已用 |
| 寻找好友 / 邀请 / 排行榜 | 首页、动作详情 → 排行榜 | 免费 | 排除（社交） |
| 通知中心（全部/点赞/评论/关注/下载/请求） | 首页 🔔 | 免费 | 已用 |
| 开始空训练 | 首页悬浮钮 / 训练标签 | 免费 | 已用 |
| 再做一次（复制历史训练） | 首页训练卡 ⋮ | 免费 | 已用 |
| 训练分析（恢复 %、周连续、AI 反馈） | 训练标签 | AI 反馈疑似付费（无锁标，试用中分不出） | 已用（第二轮点了 AI 反馈） |
| 动作搜索 + 多选添加 | 训练中「+ 添加动作」 | 免费 | 已用 |
| 动作库筛选（器材 20 种、部位、收藏），共 1,000+ 个动作，带视频 | 添加动作 → 筛选 | 免费 | 已用 |
| 健身房档案（名称 + 颜色 + 可用器材，用于筛动作） | 筛选 → 添加健身房 | 未标 | 已用（建了 Test Gym） |
| 自定义动作（9 种类型：重量×次数、距离×时长、时长、哑铃×2、单/双腿交替、全自重、辅助自重、步数…） | 训练库 → 创建 → 动作 | 未标 | 已用（建了 Test Press） |
| 动作详情：关于（视频、目标肌肉）/ 历史 / 进度 / 纪录 / 排行榜 | 训练中 ⋮ → 视频和历史；我的 → 动作 | 进度、纪录属 Premium | 已用 |
| 自家数字键盘 +「下一步」 | 点重量/次数格 | 免费 | 已用 |
| 组类型 11 种（热身、Failure、左、右、Drop、Negative、半程、Myo、Feeder、Top、Back-off） | 点组号 | 免费 | 已用 |
| 「添加组」复制上一组 | 卡片底部 | 免费 | 已用 |
| 上次数据预填 +「上一个」列；来源可选 任意训练 / 同一模板 | 训练设置 | 免费 | 已用 |
| 热身计算器（按正式组重量生成 3 组热身并插入） | 动作 ⋮ → 添加热身组 | Premium | 已用 |
| 配重片计算器（每边片数，可加自定义杆和片） | 键盘「±」键 | Premium | 已用 |
| AI 建议：进阶（+2.5 kg）/ 推荐动作（3×12、3×10… 方案）/ 个人记录 | 键盘 ✨ 键 | Premium（智能追踪） | 已用 |
| 休息计时器：每个动作单独开关，热身组/正式组分开设时长 | 卡片「休息计时器：关闭」 | 免费 | 已用 |
| 休息计时器全屏页（±10 s、停止、倒计时/秒表）、全局声音/音量/振动/默认时长 | 顶栏计时胶囊；训练设置 | 免费 | 已用 |
| RPE / RIR | 训练设置里切换；记录时点次数格，自带键盘右侧「RIR」键 →「记录 RIR」面板选 5+ 到 0 | 未标 | 已用（复核补测；组行没有单独一列，入口只在次数键盘上） |
| 超级组（含「超级组自动滚动」） | 动作 ⋮ → 添加到超级组 | 未标 | 已用（第二轮 X-superset 交替记了 2 组） |
| 动作备注 / 置顶笔记 / 训练备注 / 训练照片（没有单组备注） | 卡片、⋮、更多 | 免费 | 已用（照片：拒绝相机权限，相册打开系统选择器后取消） |
| 替换动作 | 动作 ⋮ | 免费 | 已用（X-replace） |
| 单个动作单位（kg/lb） | 动作 ⋮ → 单位（kg） | 免费 | 已用（X-unit，用 lbs 记了 1 组） |
| 拖拽排序 | 长按动作卡 | 免费 | 已用 |
| 删除组（左滑 + 撤销 / 组号菜单删除） | 组行 | 免费 | 已用 |
| 移除动作 + 撤销 | 动作 ⋮ → 移除动作 | 免费 | 已用 |
| 暂停 / 最小化 / 取消训练 | 更多、左上 ∨ | 免费 | 已用 |
| 完成页（名称、描述、照片视频、日期、时长、活动类型、本次难度、私人笔记） | 完成 | 免费 | 已用 |
| 庆祝 + 分享卡轮播（10 张） | 保存后 | 免费 | 已用（只看不分享） |
| 编辑历史训练 | 训练卡 ⋮ → 编辑 | 免费 | 已用（打开后放弃更改） |
| 删除历史训练 | 训练卡 ⋮ → 删除 | 免费 | 已用（删了 T1 那场） |
| 保存到收藏（训练存为模板） | 训练卡 ⋮ | 疑似 Premium（无锁标） | 已用（存完又删了） |
| 训练模板（建模板时自动带上次组数和重量） | 训练库 → 创建 → 训练模板 | Premium | 已用（建了 Chest Test） |
| 训练计划（模板文件夹） | 训练库 → 创建训练计划 | Premium | 已用（建完又删了） |
| 开始计划（日程向导：开始日期、训练日、周数 → 训练标签显示「第 1 周，共 4 周」）/ 停止计划 | 计划 ⋮ → 开始计划 | 未标 | 已用（停止后删除） |
| 计划市场 / 教练计划（下载、评分、Physio Tip） | 探索 | Premium（模板和计划） | 已用（只看） |
| 我的 → 概览（对比卡、肌肉恢复、月历、目标、肌群雷达） | 我的 | 部分 Premium（高级洞察） | 已用 |
| 我的 → 动作（各动作预估 1RM + 迷你曲线） | 我的 → 动作 | 未标 | 已用 |
| 身体测量（体重、体脂、热量、十余项围度） | 我的 → 测量 | Premium（身体围度） | 已用（记了体重 75 kg） |
| 进度照片 | 我的 → 照片 | 未标 | 进不去（只给拍照一条路，要相机权限，按规则拒绝） |
| 单位 / 主题 / 语言 / 每周起始日 / 图表设置（热身组等是否计入肌群图） | 设置 | 免费 | 已用 |
| 隐私（所有人 / 关注者 / 仅自己，默认所有人） | 设置 | 免费 | 已用（只看） |
| 推送通知设置 | 设置 | 免费 | 已用（只看） |
| 导出 CSV | 设置 → 导出数据 | 免费（无锁标） | 已用（到系统分享面板为止） |
| 导入（网页工具） | 设置 → 导入数据 | 未标 | 排除（网页登录：跳 Chrome 的 my.lyfta.app 登录页） |
| 集成：Strava、Health Connect、Google Fit、Samsung Health | 设置 | 未标 | 排除（第三方授权） |
| 云同步 | 设置 → 同步训练数据 | 免费 | 已用 |
| 测试版功能（设定训练目标、以图片形式分享模板） | 设置 | — | 已用（只看） |
| 订阅页 / Premium 功能介绍 | 设置 → 你的 Lyfta 订阅 | — | 已用（只看，没进管理订阅） |
| 送好友 30 天 Premium | 设置 | — | 排除（邀请；只看了说明页） |
| 优惠码 / Lyfta 推广伙伴 | 设置 | — | 已用（只看：没输码，没加入） |
| Spotify / YouTube Music 按钮 | 训练设置 → 连接 … | 未标 | 已用（打开开关看到顶栏按钮；按钮会跳外部 app，没点；已关回） |
| AI 动作推荐（空训练里的「给我个惊喜！」） | 训练设置 → AI 动作推荐 | 未标 | 已用（生成一场后取消；已关回） |
| 详细训练视图（收起的卡片也列出每组） | 训练设置 | 未标 | 已用（已关回） |
| 保持屏幕常亮 / 个人记录通知（训练中 PR 横幅） | 训练设置 | 未标 | 已用（PR 横幅实测；屏幕常亮只看） |
| 更新体重（自重动作 ⋮） | 训练中动作 ⋮ | 未标 | 已用（打开后取消） |
| 私信 | 通知页右上 | — | 排除（社交） |
| Lyfta Coach（教练） | 探索 → 教练、设置 | — | 已用（只看） |

**覆盖率**（第二轮补测后）：共 64 项，排除 6 项（引导、社交 ×3、网页导入、第三方集成），已用 56 项，被锁 0 项（试用中全部解锁），进不去 2 项（挑战、进度照片）。
覆盖率 =（已用 + 被锁）/（总数 − 排除）= 56 / 58 = **97%**；不扣排除的原始口径 = 56 / 64 = **88%**。第一轮是 42 / 57 = 74%。

## 5. 核心记录交互

1. **布局**：和 Strong / Hevy 一个路子。每个动作一张卡：备注、休息计时器、表头「组 | 上一个 | Kg | 次数 | ✓」，下面是组行（行高约 67 dp，格子 72×48 dp，✓ 48×48 dp）。**动作卡是手风琴**：新加的动作是收起的（「0/3 已完成」），要点一下才展开；展开一个会收起其它。新加的动作排在最底下；动作多了以后，下一个卡片常在屏幕外，要先滑一下。
2. **输入**：点重量或次数格，弹出 app 自己的数字键盘（1–9、0、小数点、退格，右列是收起键盘、配重片计算器「±」、AI「✨」、**「下一步」**）。格子里的旧值是选中状态，直接打字就替换。**「下一步」在重量格跳到次数格，在次数格上直接把这组标为完成，并把焦点移到下一组的重量格**，所以连续记组时完全不用再点格子或 ✓。最后一个默认组完成后键盘自动收起。
3. **预填**：
   - 新动作默认 3 个空组（显示「–」），**同一场里不会复制上一组**：默认的 3 组即使和上一组一样也要重新打字。
   - 「+ 添加组」新加的那一行会以灰字带上上一组的数值，直接点 ✓ 就按这些数记下。
   - 有历史的动作：组数、重量、次数、**组类型（W）**全部按上次预填成灰字，「上一个」列显示「60kg x 8」。单独新加一个有历史的动作也一样（在 T1 之后专门验证过）。
   - 这台手机上点数字格时，系统自动填充会在格子下面弹出一个号码建议框，遮住下一行的格子（不是 app 本身的问题，但真实用户也会碰到）。
4. **完成一组**：点 ✓ 或在次数格按「下一步」，整行变绿，顶部「训练量 / 组」实时累加。**默认不开休息计时**（全局「默认休息时间 = 关闭」，卡片上写「休息计时器：关闭」），所以 T1 的第一次打勾什么也没弹。开了以后（每个动作单独设，热身组和正式组分开设时长），完成一组只在顶栏出现一个倒计时胶囊，不打断操作；点胶囊才进全屏计时页（±10 s、停止、秒表）。
5. **组类型**：点组号弹出 11 种类型和「删除该组」。热身组显示黄色 W，**训练量照算**（T1 第一组 40×10 记成 400 kg）。纪录页的「最大次数」也把热身组 40×10 算了进去。
6. **哑铃**：表头显示「x2 Kg」图标，输入单只重量，训练量按 ×2 算。
7. **自重**：Chest Dip 的重量列叫「(+Kg)」，空着就是纯自重，填 10 就是附加 10 kg；训练量按「资料体重 + 附加」算。但「我的 → 动作」里 Chest Dip 的预估 1RM 只有 13 kg，只按附加重量算。
8. **单位**：全局 kg/lb，另外每个动作可以单独切换单位（切到 lbs 后历史数按原值换算、不取整，60 kg 显示 132.28，见 §10）；配重片计算器能自定义杠铃杆和片（全局一套，不分健身房）。

## 6. 场景任务

目标尺寸取自 UI 树。**训练页滚动后，顶栏会出现一个每秒走动的计时器，uiautomator 拿不到空闲状态**，这时命中检测要么是空的（unknown），要么沿用上一次成功的旧 UI 树（报成 `card_root 176x256`、`fragment_container`、`rl_toolbar` 等）。T1 从 E2-s4 起、T3 的 E4/E5 大多受影响。下表的尺寸以截图里实际点到的控件为准：键盘数字键 85×46 dp、「下一步」85×38 dp、数字格 72×48 dp、✓ 48×48 dp、动作卡头 384×80 dp、「+ 添加组」352×42 dp。

### T1 首次训练（空训练，19 个正式组 + 1 个热身组）

动作在训练进行中逐个添加（选动作页支持多选，但我按 brief 每次加一个）。

| 阶段 | 动作序列 | 目标 | 尺寸 dp | 备注 |
|---|---|---|---|---|
| start（1） | 首页悬浮「开始新训练」 | 悬浮钮 | 143×56 | 立即开始计时，空训练，无弹窗 |
| E1-add（6） | 添加动作 → 搜索图标 → 打 `bench` → Bench Press 卡 → 「添加 1 个动作」→ 点开卡片 | 按钮 / 图标 / 结果卡 / 添加 / 卡头 | 352×48 / 48×48 / 176×256 / 352×52 / 384×80 | 实时过滤，第一个结果就是；系统键盘开着时也只露出 2 个结果；加完是收起的卡片 |
| E1-s1 热身（9） | 组号 → 热身 → 重量格 → 4 → 0 → 下一步 → 1 → 0 → 下一步 | 组号 / 类型按钮 / 格 / 键 | 48×48 / 172×52 / 72×48 / 85×46 | 第一次完成一组：没有休息计时（默认关），没有弹窗 |
| E1-s2 改重量（5） | 6 → 0 → 下一步 → 8 → 下一步 | 键 | 85×46 / 85×38 | 焦点已在下一组重量格 |
| E1-s3 同上（5） | 6 → 0 → 下一步 → 8 → 下一步 | | | 默认组是空的，要重打 |
| E1-s4 改次数（4） | + 添加组 → 次数格 → 7 → 下一步 | 352×42 / 72×48 | | 新组带着 60×8 |
| E2-add（6） | 同 E1，搜 `incline`，选第二个结果 Dumbbell Incline Bench Press | | | |
| E2-s1（9） | 重量格 → 2 → 2 → . → 5 → 下一步 → 1 → 0 → 下一步 | | | 表头「x2 Kg」 |
| E2-s2 同上（8） / s3 改次数（7） / s4 改次数（4） | 重打 22.5×10 / 重打 22.5×9 / 添加组 → 次数格 → 8 → 下一步 | | | |
| E3-add（6） | 同上，搜 `chest press`，选第一个 Lever Chest Press | | | 没有插片式（selectorized）推胸机，用杠杆式器械代替 |
| E3-s1（7） / s2 改重量（6） / s3 同上（6） / s4 改次数（4） | | | | |
| E4-add（6） | 同上，搜 `dip`，选 Chest Dip | | | |
| E4-s1 自重（4） | 次数格 → 1 → 2 → 下一步 | | | 重量留空 = 自重 |
| E4-s2 自重（4） | 下一步（跳过重量）→ 1 → 0 → 下一步 | | | |
| E4-s3 加重（5） | 1 → 0 → 下一步 → 8 → 下一步 | | | |
| E4-s4 同上（2） | + 添加组 → ✓ | | | 新组带着 +10×8 |
| E5-add（6） | 同上，搜 `cable`，选第二个 Cable Standing Fly | | | 第一个结果是 Cable Pushdown |
| E5-s1（7） / s2 同上（6） / s3 改重量（8） / s4 同上（2） | | | | 17.5 要按 4 个键 |
| finish（3） | 完成 → 保存 → 关闭庆祝页 ✕ | 82×34 / 352×52 / 42×42 | | 完成页可填名称、描述、照片、RPE，全是可选；保存后弹全屏「做得好！这是你的第 1 次训练」+ 10 张分享卡，[截图](shots/lyfta/07_finish_celebration.png) |

**合计 146 次操作**：点击 141 次，搜索打字 5 次共 31 个字母，没有滑动和长按。弹层：选动作页 ×5、自家键盘、组类型面板 ×1、完成页、庆祝页。

**每组开销（T1）**

| 类别 | 样本 | 平均操作数 |
|---|---|---|
| 首组（非热身、非自重） | E2-s1 9、E3-s1 7、E5-s1 7 | **7.7** |
| 同上一组 | 默认空组里重打：E1-s3 5、E2-s2 8、E3-s3 6、E5-s2 6；用「添加组」带过来：E4-s4 2、E5-s4 2 | 重打 **6.3**；添加组 **2.0**；合计 4.8 |
| 只改次数 | 添加组 + 改次数：E1-s4、E2-s4、E3-s4 各 4；默认空组里重打：E2-s3 7 | 添加组 **4.0**；重打 7；合计 4.75 |
| 改重量（本协议里同时改了次数） | E1-s2 5、E3-s2 6、E4-s3 5、E5-s3 8 | **6.0** |
| 热身组 | E1-s1 | **9** |
| 自重 | E4-s1 4、E4-s2 4 | **4.0**（加重组 5） |

能省的地方在「下一步」：焦点自动跳到下一组，所以连续记组时，每组只需要打数字加两次「下一步」。贵的地方是默认组为空：同上一组也得把数字全打一遍。换动作（add）每次 6 下，其中搜索打字 1 次。

### T3 第二次训练（首页训练卡 ⋮ → 再做一次）

| 阶段 | 动作序列 | 备注 |
|---|---|---|
| start（2） | 首页训练卡 ⋮（38×38）→ 再做一次（209×48） | 立刻开始一场新训练，5 个动作都在，全部收起，[截图](shots/lyfta/08_repeat_prefilled.png) |
| 每个动作 add（共 6） | E1–E3、E5：点卡头 1 次；E4：先滑一屏再点 2 次 | 展开后 4 组（含 W 热身、自重的 0 / +10）全部灰字预填，与上次一致 |
| 每组（20 × 1） | 只点 ✓ | 没有弹窗；一个动作做完不会自动展开下一个 |
| finish（3） | 完成 → 保存 → 关闭庆祝页 | 完成页时长自动算成 4m；首页卡片显示「记录 18」（银牌和铜牌，因为数字和上次一样） |

**合计 31 次**（点击 30、滑动 1），没有打字。每组开销：所有类别都是 **1.0**（只点 ✓）；换动作平均 1.2 次。

### T4 改错

- **改已完成的组 60×8 → 62.5×8（6 次）**：点重量格（72×48）→ 6 → 2 → . → 5 → 收起键盘（85×38）。这组保持完成状态。顶部训练量没有马上刷新（仍显示 1 360 kg），下一次操作后才变成 1 380。
- **删组**：两条路。
  - 点组号 → 「删除该组」（352×52），**2 次**，没有确认，也没有撤销条。
  - **组行左滑，1 次**：立刻删掉，底部弹出「已移除的组　撤销」，几秒后消失，[截图](shots/lyfta/09_swipe_delete_undo.png)。
- **撤销（1 次）**：点「撤销」（53×48），组恢复了；但顶部训练量又没刷新（显示 400 kg，实际 900）。没有全局撤销，只有删组和移除动作这两种操作有撤销条。

### T5 中途改计划

- **加 Overhead Press（6 次）**：添加动作 → 搜索 → 打 `overhead`（结果是两个三头肌臂屈伸）→ 再补打 ` press` → Barbell Seated Overhead Press → 添加。单打 `overhead` 找不到推举。
- **移到最上面（1 次长按拖动）**：这场是胸日，没有 Squat，所以改成拖到 Bench Press 上面。长按卡片后所有卡片收成一列，拖到顶部松手即可。注意：只长按不拖时，我的一次长按把 Dumbbell Incline 甩到了列表最底下。
- **移除（2 次）**：⋮ → 移除动作，没有确认，有「已移除 … 撤销」条。

### T6 中断

按 Home 等 5 s 再打开：还停在训练页，原样。强杀再打开：**直接回到进行中的训练**，计时接着走（0:04:25），组数据完整，顶部还多出一格「PR 3」。没有任何提示或恢复弹窗。

### T7 查看上次数据和进步

- **训练中（4 次）**：动作 ⋮ → 视频和历史 → 「历史」页（默认停在「关于」视频页，要再点一下）→ 「进度」页。历史页列出每场每组和 1RM、PR 奖章；进度页有「预估力量」（79 kg）和「训练量」曲线，[截图](shots/lyfta/10_progress_chart.png)。其实不用进这页：组行的「上一个」列一直显示上次的数字。
- **训练外（5 次）**：我的 → 动作（这一页已经能看到各动作的预估 1RM 和迷你曲线）→ Bench Press → 历史 → 进度。

### T8 导出

我的 → 设置 → 下滑 → 导出数据，共 4 次。弹窗「这会将你的所有训练数据下载为 CSV 文件」，只有 CSV 一种格式，没有锁标。我停在这个弹窗没有点「导出」，所以文件落到哪里**未实测**。导入要跳 Chrome 的 my.lyfta.app 网页工具并登录，app 内没有导入。

## 7. 亮点（值得 fitlog 借鉴）

1. **次数格上的「下一步」= 完成这组 + 跳到下一组重量格。** 连续记组时根本不用瞄准 ✓ 或下一个格子，手指一直停在键盘区。fitlog 的「一键记一组」可以对照：这里的代价是必须打数字，但焦点跟着走这一点值得学。
2. **「添加组」带上一组的数，单 ✓ 就记。** 同上一组只要 2 下。和 fitlog「行内显示上次」的思路一致，而且对同一场内也有效。
3. **左滑删组 + 撤销条；移除动作也有撤销条。** 删除零确认、可撤回，比确认弹窗轻得多，和 fitlog「只在代价高的误操作给撤销」的取向一致。
4. **强杀后直接回到进行中的训练，什么都不用点。** 可靠性体验好。
5. **组类型齐全但藏在组号里**（11 种，热身显示 W），不占主界面；热身计算器一键插入 3 组热身，对新手省事。
6. **健身房档案**（名称、颜色、可用器材）用来筛动作，这一点和 fitlog 的「健身房感知」有交集，但它不管片子和取整。fitlog 的「按健身房片库取整」仍然是差异点。
7. **超级组自动切换**：在 A 上点 ✓ 自动收起 A、展开 B，再点 ✓ 又切回 A，交替做时每组仍是 1 下，不用滑也不用找卡（§10）。
8. **替换动作自动按部位筛选**；「置顶笔记」跟着动作走（适合记座椅档位）；「详细训练视图」让收起的卡片也显示每组。

## 8. 痛点

1. **默认组是空的。** 第一次练某个动作，同一场里的第 2、3 组就算和上一组一样也要把数字重打一遍（平均 6.3 下），只有自己点「添加组」的新组才带数。
2. **手风琴卡片 + 新动作排在最底下**：每换一个动作都要先点开（T3 里还要滑一屏）；一个动作做完不会自动展开下一个。
3. **动作名全英文**，中文界面里搜索还得打英文；`overhead` 找不到推举，`cable` 第一个结果是下压。
4. **热身组算进训练量和「最大次数」纪录**，自重动作的 1RM 只按附加重量算（Chest Dip 显示 13 kg），数字可信度打折。
5. **训练量计数器不刷新**：改重量、撤销删除后顶部的训练量显示的还是旧值。
6. **社交噪音**：隐私默认「所有人」，每次训练自动发到动态；保存后必弹全屏庆祝 + 分享卡；首页常驻「添加好友」横幅、挑战卡、排行榜。
7. **很多基础工具是 Premium**：配重片计算器、热身计算器、模板和计划、进度和纪录、身体围度（据 Premium 介绍页）。免费用户能记，但「省事」的功能都要付费。
8. **要账号、数据在云端**，导入只能去网页；RPE/RIR 的输入藏在次数键盘的「RIR」键里，组行上看不出来（复核补测）。
9. **替换动作会悄悄丢掉已完成的组**：没有确认，也没有撤销条（§10）。
10. **单个动作切 lbs 后数字不取整**（132.28 lbs），按磅的器械每组都得手动改成能加载的重量。
11. **导出只能走系统分享**，文件名是随机数字；**AI 反馈在中文界面下给英文**，内容泛泛；进度照片只能现拍；完成页没有单场可见性开关，存一场就默认公开一场。

## 9. 与 fitlog 定位的对照

1. **一组的输入成本**：Lyfta 首组约 7.7 下，同上一组 2–6 下；fitlog 的目标是同上一组 1 下、无键盘。Lyfta 靠「下一步」把打字流程压得很顺，但没有绕开键盘。
2. **第二次练同一套**：Lyfta 的「再做一次」让每组降到 1 下（只点 ✓），和 fitlog 带出上次数字的设计基本打平；差别在换动作（点开卡片、偶尔要滑）。
3. **数据归属**：Lyfta 要登录、云端、默认公开，导出只有 CSV、导入走网页；fitlog 本地优先、不登录、免费 CSV/JSON 导出和 Strong/Hevy 导入，这一点差异最大。
4. **健身房感知**：Lyfta 的健身房只是「器材清单 → 筛动作」，配重片计算器是全局一套且收费；单个动作能切 kg/lb，但换算后不取整（60 kg → 132.28 lbs）。fitlog 按健身房的片库取整、每台器械单独设单位和步进，覆盖的正是 Lyfta 没做的部分。
5. **不做的事**：Lyfta 有的社交动态、排行榜、挑战、AI 建议 / AI 生成训练 / AI 反馈、计划市场、视频库、音乐跳转，正好都在 fitlog「刻意不做」的清单上；Lyfta 证明这些可以不打扰记录主流程（AI 藏在键盘一个键里，AI 推荐和音乐按钮默认关），但默认公开和保存后的庆祝页确实是额外负担。
6. **超级组**：Lyfta 的自动切换让交替做两个动作时每组仍是 1 下，fitlog 做超级组时可以拿这个当下限。

## 10. 补测（第二轮）

2026-10-26 晚在同一台手机上补测第一轮没用过的功能（日志 `lyfta_s2`）。会改变记录成本的四项各开了一个 `X-` 阶段，只记一个代表性动作。没有保存任何新训练：完成页没有单场可见性开关，而隐私默认「所有人」，保存就等于公开发到动态，所以补测用的训练最后都取消了。

**单个动作单位（X-unit，免费）**。动作 ⋮ →「单位（kg）」→ 弹窗选 kg / lbs，只影响这个动作。切到 lbs 后表头变成「Lbs」，历史预填按原值直接换算，**不取整**：40 kg → 88.18、60 kg → 132.28 lbs（[截图](shots/lyfta/s2_01_per_exercise_lbs.png)）。按磅的器械要自己把 132.28 改成 135：点格子 → 1 3 5 →「下一步」×2，共 6 下。顶部训练量仍按 kg 累计（135 lbs × 8 = 489.9 kg）。完成这组时顶部滑出一个不挡操作的 PR 横幅「预估 1RM - 78 kg」。对 fitlog 来说，这正是「每台器械单独设单位 + 按可加载重量取整」要解决的问题：Lyfta 能换单位，但不知道这台器械实际能加载哪些重量。

**备注（X-notes，免费）**。三种：卡片上的「添加备注…」（只属于这一场，120×34 dp 的小字段）、⋮ →「添加置顶笔记」（带图钉的独立框，跟着动作走，适合记座椅档位；实测在训练被取消后仍然保留，下次加这个动作就会显示）、更多 →「添加备注」（整场备注，出现在训练顶部，带拍照图标）。都用系统键盘，每条都是 点字段 + 打字 + 收键盘 3 步。**没有单组备注**：组号面板里只有组类型和「删除该组」。

**超级组（X-superset，免费）**。⋮ →「添加到超级组」→ 底部列出本场其他动作 → 点一个，共 3 下。两张卡左侧出现橙色竖条，别的不变。默认开启的「超级组自动滚动」很顺：在 A 上点 ✓，A 自动收起、B 自动展开；在 B 上点 ✓ 又切回 A，不用滑也不用点卡头，有预填时每组仍然只要 1 下（[截图](shots/lyfta/s2_02_superset_autoswitch.png)）。这比普通模式下「手风琴卡片要手动点开」反而更省。

**替换动作（X-replace，免费）**。⋮ →「替换动作」→「替换为」选择页，**自动按原动作的部位筛好**（筛选角标 1、胸部高亮），最近做过的排最前（[截图](shots/lyfta/s2_03_replace_prefiltered.png)）。点一张卡立即替换，共 3 下。代价：**原动作已完成的组被直接丢掉**，没有确认也没有撤销条（训练量 1 983.9 → 969.9 kg，组数 3 → 2），超级组关系也一并解除。新动作带着自己的历史预填，点开后单 ✓ 即可记组。

**训练设置里的开关（免费）**。「详细训练视图」打开后，收起的卡片下面也列出每组（W 88.18lbs x 10 次、✓ 1 135lbs x 8 次…）和备注，一眼看全场（[截图](shots/lyfta/s2_04_detailed_view_notes.png)）。另有「保持屏幕常亮」「个人记录通知」（就是上面的 PR 横幅）。「连接 Spotify / YouTube Music」只是在训练页顶栏放一个跳转按钮（绿色 Spotify 图标，48×48 dp），会打开外部 app，按规则没点。补测完这些开关都关回默认。

**AI 动作推荐（「给我个惊喜！」，无锁标）**。在训练设置里打开「AI 动作推荐」后，空训练的「+ 添加动作」旁多一个 ✨ 按钮 → 底部弹出「训练向导」，可以打字描述，也可以直接点「给我个惊喜！ 🎉」。约 5 秒后生成 5 个动作 × 3 组，只有次数没有重量（Pull-up 3×8，Bent Over Row、Straight Back Seated Row、Barbell Curl、Dumbbell Hammer Curl 各 3×10），[截图](shots/lyfta/s2_05_ai_surprise_workout.png)。当天已经练过胸，这次给的是背 + 二头，可能参考了近期训练（只试了一次，不确定）。训练分析里的「AI 反馈」点开约 5 秒出结果：**中文界面下给的是英文**，内容很泛（建议下次加点背部动作之类）。

**训练存为模板、训练计划（Premium 介绍页列了模板和计划，app 里没有锁标）**。训练卡 ⋮ →「保存到收藏」1 下，没有提示，模板直接出现在训练库的「收藏」里，保留组数、次数区间和重量区间（「3 组 • 7 - 10 次 • 40 - 60kg」）。「训练计划」本质是模板文件夹：起名 → 在里面新建模板（不能挑已有模板）→ 计划 ⋮ →「开始计划」走 6 屏向导（说明 → 开始日期 → 选训练日〔个数等于模板数〕→ 周数 4/6/8/12/自定义 → 你的计划已就绪 → 计划预览 → 开始计划），之后训练标签顶部显示「第 1 周，共 4 周」和本周完成数。计划 ⋮ 里还有「分享计划链接」「分享到社区」（没用）。停止计划要确认；删除计划会连同里面的模板一起删，并提示「此操作无法撤销」。

**删除历史训练、暂停、导出**。训练卡 ⋮ →「删除」→ 确认弹窗，删后每周总结立即从 2 场变成 1 场，没有撤销。「暂停训练」让顶栏计时停住变暗，菜单项变成「继续训练」。导出点「导出」后约 1–2 秒弹出**系统分享面板**，文件名是随机数字（「export822469722896579547.csv」），app 内没有「存到文件夹」，只能分享给别的 app；我在分享面板上关掉了，什么都没发。点「完成」时如果有没填完的组，会弹「你还没有填写这些动作的全部字段」，要选「仍然完成」或「继续训练」。

**照片**。训练里的「添加照片」可选「相机」或「相册」：相机要系统权限（拒绝后 app 再弹一个「需要权限」，引导去设置）；相册走系统照片选择器，不需要权限（我直接取消了）。「我的 → 照片」（进度照片）空状态提示「每周从同一角度拍照」，**＋ 只能拍照**，拒绝相机权限后什么也不发生，所以记为「进不去」。

**更新体重**。自重动作（Chest Dip）的 ⋮ 里多一项「更新体重」，弹窗里的「你的体重（kg）」是**空的**，不会预填测量里的 75 kg。和 §5 的发现对得上：训练量按资料体重（约 84.5 kg）算，资料体重和测量体重是两套数据。

**挑战、推广页**。第一轮在首页看到的「十月 举起 50k」挑战卡，这次在首页（关注 / 社区两种筛选都滑到底）、探索、我的、连续打卡页、通知里都没找到，也没有别的入口，记为「进不去」。「送好友 30 天 Premium」是一页说明加「立即分享」（文案写着「赠送一份免费的 7 天 30 天 Lyfta 访客通行证」，7 天和 30 天同时出现，像是文案 bug），按排除规则没点。「优惠码」是底部输入框加「验证代码」。「Lyfta 推广伙伴」是内嵌的英文网页（推广者给 30% 折扣、拿 30% 分成），加入就算同意条款，没点。

**补测中的中断**。设置计划向导时手机来了电话，通话界面盖住 Lyfta 约 2 分钟。我停手等待，期间两下点击落在通话界面上，已作废（`void 2`），带号码的截图已删除。通话结束后计划页原样未动，继续补测。

## 截图

[键盘与「下一步」完成一组](shots/lyfta/01_keypad_next_completes_set.png) · [组类型面板](shots/lyfta/02_set_type_sheet.png) · [哑铃 x2](shots/lyfta/03_dumbbell_x2.png) · [自重 (+Kg)](shots/lyfta/04_bodyweight_plus_kg.png) · [添加组带上一组的数](shots/lyfta/05_add_set_copies_previous.png) · [单加一个有历史的动作也预填](shots/lyfta/06_history_prefill.png) · [保存后的庆祝页](shots/lyfta/07_finish_celebration.png) · [再做一次后的预填](shots/lyfta/08_repeat_prefilled.png) · [左滑删组 + 撤销](shots/lyfta/09_swipe_delete_undo.png) · [进度曲线](shots/lyfta/10_progress_chart.png) · [导出 CSV](shots/lyfta/11_export_csv.png) · [Premium 功能介绍](shots/lyfta/12_premium_features.png) · [休息计时胶囊](shots/lyfta/13_rest_timer_pill.png) · [热身计算器](shots/lyfta/14_warmup_calculator.png) · [健身房档案](shots/lyfta/15_gym_profile.png) · [AI 进阶建议](shots/lyfta/16_ai_progression.png)

## 附录：`tally lyfta` 原始输出

说明：`explore` 阶段包含功能地图、建模板 / 自定义动作 / 健身房 / 测量、开过两次又取消的探索训练。T4 有两条删组路径（`T4-delete` 菜单删、`T4-swipedel` 左滑删），汇总时取左滑。命中检测里的 `unknown` 和明显不对的标签（`card_root 176x256`、`fragment_container`、`rl_toolbar`）见 §6 开头的说明。

```
== lyfta / phase explore
   ops: {'launch': 1, 'tap': 215, 'scroll': 16, 'key': 47, 'text': 19, 'swipe': 13, 'long': 3}  typed chars: 120  voided: 1
   tap/long target min-side: {'unknown': 218}
   swipe distances (dp): [235, 213, 569, 569, 256, 256, 256, 256, 256, 256, 214, 249, 355]
   note: Extra check: adding Bench Press (has history) in a new workout prefills all 4 sets with last numbers incl. W warm-up type (grey, one ✓ accepts), plus 上一个 column shows 40kg x 10 etc
   note: Long-press on a card collapses all cards into a drag list (drag reorder). My plain long press dropped Dumbbell Incline at the bottom
   note: 导入数据 opens Chrome at my.lyfta.app/auth/login?returnUrl=/import-tool (web import tool, needs web login). Did not log in
   note: 同步训练数据: re-sync then jumps back to home feed
   note: Privacy default 谁可以看到你的训练 = 所有人 (public). Beta: 设定训练目标, 以图片形式分享模板. Theme light/dark/system. 12+ languages. Units global kg/lbs, km/mi, cm/in
== lyfta / phase T1-start
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
   note: Started from 首页 floating 开始新训练: workout starts immediately, timer running, empty workout
== lyfta / phase T1-E1-add
   ops: {'tap': 5, 'text': 1}  typed chars: 5  voided: 0
   tap/long target min-side: {'ge48dp': 5}
   note: Bench added collapsed (0/3 已完成, 3 empty sets by default), must tap card to expand. No prefill (dash placeholders), 上一个 column empty
== lyfta / phase T1-E1-s1
   ops: {'tap': 9}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3, '32-47dp': 4, 'unknown': 2}
   note: Warm-up via tap set number -> sheet 选择组类型 -> 热身 (row shows W). Custom keypad, 下一步 on weight jumps to reps, 下一步 on reps marks set done and moves focus to next set weight. Rest timer default off -> no popup on first check. Warm-up counted in 训练量 (400 kg).
== lyfta / phase T1-E1-s2
   ops: {'tap': 5}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 4, 'unknown': 1}
   note: Next set row stays empty (dash), no copy of the previous set within session: same-as-previous set must be retyped
== lyfta / phase T1-E1-s3
   ops: {'tap': 5}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 4, 'unknown': 1}
   note: Last default set done -> keypad closes. Set 4 needs 添加组 (only 3 default sets)
== lyfta / phase T1-E1-s4
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 2, 'ge48dp': 1, 'unknown': 1}
   note: 添加组 adds a row prefilled with a copy of the previous set (60x8, not done). Tapping a filled field selects value, typing replaces.
== lyfta / phase T1-E2-add
   ops: {'tap': 5, 'text': 1}  typed chars: 7  voided: 0
   tap/long target min-side: {'ge48dp': 5}
   note: E2 Dumbbell Incline Bench Press: weight header shows dumbbell icon x2 Kg = per-hand entry, volume doubles. New card collapses Bench (accordion).
== lyfta / phase T1-E2-s1
   ops: {'tap': 9}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1, '32-47dp': 6, 'unknown': 2}
== lyfta / phase T1-E2-s2
   ops: {'tap': 8}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 6, 'unknown': 2}
== lyfta / phase T1-E2-s3
   ops: {'tap': 7}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 4, 'ge48dp': 1, 'unknown': 2}
   note: hit-test for the . key was misreported as rl_toolbar 384x792 (real target . key 85x46dp)
== lyfta / phase T1-E2-s4
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 4}
   note: uiautomator fails (could not get idle state) while workout page is scrolled and the header ticking timer shows -> hit null. Real targets: keypad keys 85x46dp, 下一步 85x38dp, fields 72x48dp, 添加组 352x42dp
== lyfta / phase T1-E3-add
   ops: {'tap': 5, 'text': 1}  typed chars: 11  voided: 0
   tap/long target min-side: {'unknown': 2, 'ge48dp': 3}
   note: E3: closest = Lever Chest Press (first result for chest press, plate-loaded lever machine, no selectorized variant in top results). Card tap hit misreported as fragment_container, real target card header row 384x80dp
== lyfta / phase T1-E3-s1
   ops: {'tap': 7}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1, 'unknown': 6}
   note: hit-test uses a stale dump when uiautomator fails (reported card_root / fragment_container). E3 s1 real targets: weight field 72x48, keys 85x46, 下一步 85x38
== lyfta / phase T1-E3-s2
   ops: {'tap': 6}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 6}
== lyfta / phase T1-E3-s3
   ops: {'tap': 6}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 6}
== lyfta / phase T1-E3-s4
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 4}
== lyfta / phase T1-E4-add
   ops: {'tap': 5, 'text': 1}  typed chars: 3  voided: 0
   tap/long target min-side: {'unknown': 2, 'ge48dp': 3}
   note: Chest Dip weight column header (+Kg): bodyweight + added, empty = BW
== lyfta / phase T1-E4-s1
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1, 'unknown': 3}
   note: BW set: tapped reps field directly, 下一步 completed with weight empty. Focus jumps to next set (+Kg) field
== lyfta / phase T1-E4-s2
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 4}
== lyfta / phase T1-E4-s3
   ops: {'tap': 5}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 5}
== lyfta / phase T1-E4-s4
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 2}
   note: 添加组 row shows previous set values in grey, a single ✓ accepts them (same-as-previous = 2 taps when adding a set)
== lyfta / phase T1-E5-add
   ops: {'tap': 5, 'text': 1}  typed chars: 5  voided: 0
   tap/long target min-side: {'unknown': 2, 'ge48dp': 3}
== lyfta / phase T1-E5-s1
   ops: {'tap': 7}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1, 'unknown': 6}
== lyfta / phase T1-E5-s2
   ops: {'tap': 6}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 6}
== lyfta / phase T1-E5-s3
   ops: {'tap': 8}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 8}
== lyfta / phase T1-E5-s4
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 2}
== lyfta / phase T1-finish
   ops: {'tap': 3}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 1, 'ge48dp': 1, '32-47dp': 1}
   note: Finish page 完成训练: auto name 晨间训练, description, photo/video, date, duration 25m, activity type, session RPE (optional), 保存
   note: After save: fullscreen 做得好！ share-card carousel (10 cards: streak etc) with 分享 button, closed via X top-left 42dp
== lyfta / phase T3-start
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1, 'ge48dp': 1}
   note: 再做一次 from home feed card ⋮ menu: new workout with 5 exercises, all collapsed, 0/4 已完成 each
== lyfta / phase T3-E1-add
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E1-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E1-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E1-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E1-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
   note: No auto-advance to next exercise after last set, no rest popup (timer off)
== lyfta / phase T3-E2-add
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E2-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E2-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E2-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E2-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E3-add
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 1}
== lyfta / phase T3-E3-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E3-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E3-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E3-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E4-add
   ops: {'swipe': 1, 'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
   swipe distances (dp): [285]
   note: Chest Dip prefill shows 0 in (+Kg) for BW sets, 上一个 shows '- x 12'
== lyfta / phase T3-E4-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E4-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E4-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E4-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E5-add
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
   note: T3 hit-test entries in E4/E5 come from stale dumps (uiautomator idle failure while header timer ticks). Real targets: ✓ 48x48dp, card header 384x80dp
== lyfta / phase T3-E5-s1
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E5-s2
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E5-s3
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-E5-s4
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T3-finish
   ops: {'tap': 3}  typed chars: 0  voided: 0
   tap/long target min-side: {'32-47dp': 2, 'ge48dp': 1}
== lyfta / phase T4-edit
   ops: {'tap': 6}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1, '32-47dp': 5}
   note: Edit done set: tap weight field (value selected), type 62.5, close keypad key. Set stays done. 训练量 header did not update (still 1 360 kg, should be 1 380)
== lyfta / phase T4-delete
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   note: Delete set: tap set number -> 删除该组 at bottom of sheet. No confirm, no undo snackbar, no global undo found. 训练量 refreshed to 1 380 now
== lyfta / phase T4-swipedel
   ops: {'swipe': 1}  typed chars: 0  voided: 0
   swipe distances (dp): [235]
== lyfta / phase T4-undo
   ops: {'tap': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
   note: Swipe-left on a set row deletes it immediately with snackbar 已移除的组 撤销 (few seconds). Undo restored the set. 训练量 header stale after undo (400 kg shown, real 900)
== lyfta / phase T5-add
   ops: {'tap': 4, 'text': 2}  typed chars: 14  voided: 0
   tap/long target min-side: {'ge48dp': 4}
   note: 'overhead' alone returned triceps extensions first, needed 'overhead press'. Picked Barbell Seated Overhead Press
   note: No Squat in this chest workout: target = move OHP to top, above Bench Press
== lyfta / phase T5-move
   ops: {'longdrag': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 1}
== lyfta / phase T5-remove
   ops: {'tap': 2}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 2}
   note: Remove exercise: ⋮ -> 移除动作, no confirm, snackbar 已移除 ... 撤销
== lyfta / phase T6
   ops: {'key': 1, 'launch': 2}  typed chars: 0  voided: 0
   note: Home+relaunch: workout page as left. Force-stop+relaunch: opens straight into the in-progress workout, timer continued (0:04:25), sets intact, header now also shows PR 3
== lyfta / phase T7-in
   ops: {'tap': 4}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 4}
   note: In-workout lookup: ⋮ -> 视频和历史 opens 关于 tab (video) by default, 历史 tab lists past sessions with per-set 1RM and PR medals, 进度 tab charts 预估力量 (79kg) and 训练量
== lyfta / phase T7-out
   ops: {'tap': 5}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 4, 'unknown': 1}
   note: 动作 tab hit reported text 30x20, real tab 72x52dp
== lyfta / phase T8
   ops: {'tap': 3, 'scroll': 1}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 3}
   note: Export dialog: 这会将你的所有训练数据下载为 CSV 文件 (取消/导出). No Pro lock shown. Stopped before 导出 (would create a file), result after tap not tested
```

### 第二轮：`tally lyfta_s2` 原始输出

说明：`explore` 含所有只看 / 不改变记录成本的补测；`void 2` 是来电时落在通话界面上的两下点击。X-unit 里 `unknown` 3 次分别是 lbs 选项、键盘「3」、第二次「下一步」（UI 树没取到），实际尺寸是 317×48、85×46、85×38 dp。

```
== lyfta_s2 / phase explore
   ops: {'launch': 1, 'tap': 143, 'key': 23, 'scroll': 87, 'text': 2, 'swipe': 1}  typed chars: 11  voided: 2
   tap/long target min-side: {'unknown': 143}
   swipe distances (dp): [263]
   note: set-number sheet has only set types + 更多 + 删除该组: no per-set note field
   note: after replace: Lever Chest Press card collapsed (0/4 已完成, 4 sets from history), superset link removed (no orange bar), position kept
   note: 暂停训练: header timer freezes/dims (6:05), menu item becomes 继续训练; no banner
   note: workout 添加照片 → 相机 / 相册. 相机: system camera permission prompt → denied → in-app '需要权限 … 存储和相机权限' with 设置/取消. 相册: opens system photo picker (安全访问, no permission needed) → cancelled without picking
   note: workout note: 更多 → 添加备注 inserts a 296x72dp multi-line field at top of workout (system keyboard)
   note: workout settings: 详细训练视图 ON → collapsed cards list each set inline (W 88.18lbs x 10 次, ✓ 1 135lbs x 8 次 …) + note; 连接 Spotify ON → green Spotify icon in top bar (not tapped, would launch Spotify); also toggles 保持屏幕常亮, 超级组自动滚动 (on by default), 个人记录通知
   note: 完成 with unfinished sets → dialog '你还没有填写这些动作的全部字段：• Bench Press • Lever Chest Press' 仍然完成 / 继续训练
   note: finish page has no visibility/privacy toggle; not saving this workout (privacy default 所有人 would publish it to feed) → will discard
   note: AI 动作推荐 ON → empty workout shows ✨ '给我个惊喜！' (48x48dp) next to + 添加动作 → sheet '训练向导' free-text '你在找哪种类型的训练？' + '给我个惊喜！ 🎉' → ~5 s later 5 exercises x 3 sets with reps only (Pull-up 3x8, Bent Over Row, Straight Back Seated Row, Barbell Curl, Dumbbell Hammer Curl 3x10), no weights; ignores that a chest workout was done today? (back/biceps). No lock badge.
   note: 训练卡 ⋮ → 保存到收藏: 1 tap, no confirmation/toast captured; creates template '晨间训练' (5 个动作) in 训练库 → 训练模板 → 收藏 folder (now 2 templates)
   note: template from workout keeps sets, rep ranges and weight ranges (Bench Press 3 组 • 7 - 10 次 • 40 - 60kg; total 19 组, ~1小时)
   note: PHONE CALL screen in foreground (active call ~17 s) — stopped touching the phone; screenshot with number deleted. Last 2 taps (4周 radio, 继续) voided as possibly disrupted
   note: after ~2 min: call ended (mCallState=0), Lyfta back on top; plan screen unchanged (my 2 taps had landed on the call screen, not Lyfta). Resuming.
   note: plan flow: 训练库 → 创建训练计划 → name dialog (default 我的计划 #1) → plan = folder of templates; '将训练模板添加到训练计划' opens template builder (new template, not pick existing); plan ⋮: 开始计划 / 编辑计划 / 分享计划链接 / 分享到社区 / 删除计划. 开始计划 wizard: intro → start date (今天/明天/周一/自定义) → training days (choose N = #templates) → length (4/6/8/12 周/自定义, default 8) → 你的计划已就绪 summary → 计划预览 week list → 开始计划. 6+ screens, no lock badge.
   note: 训练 tab → 训练分析 → AI 反馈 card: ~5 s → sheet 'AI 训练分析 / 分析完成' with English generic text (Today's Highlights / Keep Going / Next Tip: add back exercises) although UI is Chinese; 明白了！ to close. No lock.
   note: 我的 → 照片: empty state '进度照片 / 提示：每周从同一角度拍照。' + floating 添加照片 → directly system camera permission (no gallery choice offered); back re-prompted; denied with 拒绝且不再询问 → silently back to page, nothing else
   note: 送好友 30 天 Premium page: '赠送一份免费的 7 天 30 天 Lyfta 访客通行证' (text shows both 7 and 30 — UI glitch) + 立即分享 (not tapped)
   note: 优惠码: bottom sheet '输入你的优惠码' + field + 验证代码 (nothing entered)
   note: Lyfta 推广伙伴: in-app webview (English) 'Give 30% off. Earn 30% back.' Join the affiliate program (agree to terms) — not tapped
   note: 导出 → ~1-2 s → system share sheet (ChooserActivity) with single file 'export822469722896579547.csv' (random numeric name); no in-app save-to-folder; closed via 关闭, nothing sent
   note: delete history workout: card ⋮ → 删除 → '确定要删除“晨间训练”吗？' 删除/取消 → gone, weekly summary 2→1 workouts; no undo bar
   note: plan cleanup: plan ⋮ (active) → 停止计划 (confirm, history kept) → 删除计划 ('确定要删除这个训练计划及其所有训练模板吗？此操作无法撤销。')
   note: bodyweight exercise ⋮ → 更新体重 → dialog field '你的体重（kg）' EMPTY (not prefilled with 75 kg measurement or profile weight) + 更新体重/取消; cancelled
   note: cleanup check: new workout + Bench Press → pinned note 'grip81' still there although the s2 workout was cancelled (pinned note saved per exercise immediately); weight unit back to Kg (per-exercise lbs did not persist after discarding)
== lyfta_s2 / phase X-unit
   ops: {'tap': 8}  typed chars: 0  voided: 0
   tap/long target min-side: {'unknown': 3, 'ge48dp': 2, '32-47dp': 3}
   note: Bench Press ⋮ → 单位（kg） opened dialog: 为“Bench Press”选择重量单位 kg / lbs / 取消 (setup taps were explore: ⋮ + 单位)
   note: lbs mode: previous-session prefill converted raw: 40kg->88.18lbs, 60kg->132.28lbs (no rounding to 2.5/5 lb plates); header Lbs
   note: X-unit result: set 1 logged as 135 lbs x 8 (typed 1,3,5 + 下一步 x2 = 5 taps; tap on '3' had no UI tree, key 85x46dp). Volume counter converts to kg (489.9 kg). PR popup at top: 'Bench Press 预估 1RM - 78 kg' (non-blocking banner). Focus moved to set 2 weight cell.
== lyfta_s2 / phase X-notes
   ops: {'tap': 4, 'text': 2, 'key': 2}  typed chars: 15  voided: 0
   tap/long target min-side: {'32-47dp': 2, 'ge48dp': 2}
   note: exercise note field opens SYSTEM keyboard (Sogou), inline single-line field under exercise name
   note: note saved as 'seat4' (IME dropped the space; adb artifact). Exercise note total: tap field + type + back = 3 actions
   note: pinned note: ⋮ → 添加置顶笔记 adds a separate field '置顶笔记…' (304x43dp, pin icon) above the per-session note; 2 taps + type + back
== lyfta_s2 / phase X-superset
   ops: {'tap': 5}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 5}
   note: superset: ⋮ → 添加到超级组 → sheet '超级组“Bench Press”搭配：' list → tap Chest Dip; both cards get an orange left bar, no other layout change
   note: after ✓ on Bench set 2: Bench card auto-collapsed and Chest Dip card auto-expanded (superset auto-switch), no scrolling needed
   note: after ✓ Chest Dip set 1: switched back to Bench (expanded) automatically. Superset steady state = 1 tap per set incl. switching (when prefilled). Note: superset sets the alternation; the orange bar is the only visual marker
== lyfta_s2 / phase X-replace
   ops: {'tap': 5}  typed chars: 0  voided: 0
   tap/long target min-side: {'ge48dp': 5}
   note: 替换为 screen: same picker as add, pre-filtered to the replaced exercise's muscle group (胸部, filter badge 1), 最近完成 first
   note: tap on replacement card replaces immediately (no confirm, no undo bar seen). The completed Chest Dip set 1 was DROPPED: volume 1983.9 -> 969.9 kg, sets 3 -> 2
   note: replaced exercise expanded with its own history prefill (50x12, 55x10...) in kg; ✓ logs set 1
```
