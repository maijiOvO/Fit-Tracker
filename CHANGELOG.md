# 更新日志

本文件记录 Fit Tracker 的阶段性变更。
新条目放在最上面，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [unreleased] – 2026-10-19

### 新增（换馆重量，2026-10-20，规格见 `docs/design-plates.md`「换馆重量」）

- **底稿先抄同一个馆的上一次**：本馆没练过才抄别的馆的，卡头写明「底稿 · 在 fit4less 10/5」。换做法同样本馆优先；换馆时还没动过的卡按新馆重新挑底稿。
- **这台是插销还是挂片，按馆设**：动作卡 ⋯ 里「在 X，这台是 插销 / 挂片」，在某个馆改一次就记住，按那种形式画大图、取整、± 一档；动作不用拆成两个做法。
- **自定义片**：编辑馆档案时可以加一种片（八角片、自带的微调片），按馆的单位存，另一种单位的片帮你换算（kg 馆里的 45 lb 片 = 20.4）。取整精度从每边 0.25 收细到 0.05。
- **两层备注**：通用备注之外多一条本馆备注（凳子档位、挂钩孔位），只在这个馆显示，排在通用备注前面。旧备注全部保留为通用备注。
- **挂片式器械的空载**：选成挂片的器械可以填空载（滑台、史密斯杠自重，器械上标了就填，不知道就空着），大图说明给出「加空载共 x」做参考；记录照旧只算片子。
- 新设置存在 `appPrefs.gymKinds` / `gymNotes` / `gymTares`，不新增同步键；按键合并、删除写墓碑，另一台设备的旧表盖不掉新设的。

### 新增（数据安全，2026-10-20）

- **自动备份到手机文件夹**：第一次练完会请你选一个文件夹（系统窗口打开在「文档」，点「使用此文件夹」即可，App 在里面建 `fitlog`）。之后每次结束训练、以及每天第一次打开（数据有变化时）自动写一份完整快照；卸载 App 文件也还在。可以选 SD 卡或被同步软件同步的文件夹，App 仍然不联网。
- 备份写完会读回来核对，条数全对上才算成功；失败、没权限都会在设置里用红字写明原因。保留最近 14 天每天一份、再往前每月一份留 12 个月；训练次数比上次少一半以上时不清理旧备份。
- **重装后恢复**：首页空状态和首次启动提示里有「以前用过 fitlog？从备份恢复」，选回备份文件夹后先显示摘要（几次训练、最后一次哪天）再确认。本地已有数据时可以选「合并（推荐）」或「用备份覆盖」，合并不会把删掉的训练捞回来。
- **导出 CSV**：一行一组，UTF-8 带 BOM，Excel 直接打开不乱码；可以分享出去，也可以存进备份文件夹。
- **从 Strong / Hevy 导入 CSV**：Strong 的文件没写单位时按动作选 kg / lb（显示每个动作的最重重量帮你判断）；热身组默认不导；同一份文件导两次不会重复；导入前存可撤销的副本。
- 原生侧新增 `FitlogFolder` 插件（存储访问框架，长期授权），不申请任何存储或联网权限。设计见 `docs/design-backup.md`。

### 新增 / 修正（配重片刻度与递减，2026-10-20）

- **配重片可以从任意重量起**：龙门架 / 固定器械的大图说明栏左边多了「最轻 12.5 · 每格 5 lb」，点开就地改最轻一格和每格，只影响这个馆的这一台；取整、±、大图刻度都按「最轻一格 + 每格 × n」走。
- **修正：递减档取整后会和主组一样重**（例：上次 22 → 16.6 lb，在每格 10 lb 的馆或切到 kg 后两档都成了 20）。抄参考、切单位 / 换馆、改一档后，递减档仍比上一档轻、递增档仍更重，吸到一样就往原方向挪一格。
- 「底稿」改叫「参考」（卡头「参考 · 10/9」、时间线「复制为今天的训练 · 作参考」）。
- e2e 新增 `seeded-stack-start-and-drop-order`（67/67）。

### 修正（龙门架标签，2026-10-20）

- **「绳索」改叫「龙门架」**（中英文都是：龙门架 / Cable Machine），它是唯一的龙门架标签；馆档案里「龙门架 / 绳索一档」改成「龙门架一档」。
- **标成「健身房器材」的力量动作自动改成龙门架**：这个标签原本给跑步机、单车用，之前被改名叫「龙门架」后标到了龙门架动作上，而负荷判断不认它，这些动作全被当成纯数字——不按馆取整、⋯ 里没有「插销 / 挂片」和「一档多重」、纪录不按馆比。启动和拉远端时就地纠正（只动力量动作；「器械 + 健身房器材」只去掉多余的那个），并删掉「健身房器材 → 龙门架」那条改名。不推进时间戳，可以反复跑（`src/utils/cableTagMigration.ts`）。
- 编辑 / 新建力量动作、做法时，器材里不再出现「健身房器材」（有氧动作照旧能选）。
- e2e 新增 `seeded-gym-tag-becomes-cable`。

### 变更

- **配色改版**：浅色改成纯白底、卡片是白底上的浅灰块；新增五套可选强调色（青 / 浅蓝 / 紫 / 玫红 / 橙），在设置 → 显示 → 强调色里切换，都避开杠铃片的红蓝黄绿白。
- 深色底跟着强调色走：青、浅蓝配蓝黑底，紫、玫红、橙配纯黑底。
- 按钮按功能分深浅：主操作用实色，筛选标签用淡底，链接和图标用压深一档的强调色（保证 4.5:1 对比度）；分段切换改成凸起滑块。
- 冷启动底色（`index.html`、Capacitor、manifest）同步成新底色。规格见 `docs/design-plates.md` §1。

## [2.0.0] – 2026-10-18

### 变更

- **「杠铃片」新界面**：替换「墨与纸」，规格改以 `docs/design-plates.md` 为准。灰阶令牌，字体换成得意黑 + Barlow Condensed；训练页动作卡顶部画出器材和配片，大图也能拖动改重量，打破纪录实时显示 PB。
- 杠铃按真实尺寸画，片子按登记时的单位算，每个动作记住自己用的杠。
- **馆档案**：按健身房登记片子和器械档位，单位就是片子；加动作、加组、底稿带动、递减都就近取整到这个馆有的重量，切馆时没做完的组按新档案重新取整。配重片 / 挂片器械的纪录只和同一个馆比。
- 训练页删组、删递减档、删动作改成单击即删，不再弹撤销条（删整场训练、删体重等不在训练现场的操作照旧可撤销）。
- 计划编辑器选动作改用训练页同一个弹层，旧的全屏动作库删掉。
- 底稿跟随改成保持差值，递减档和普通组走同一套继承；去掉「跳过」。
- 改名入口放到明面上：动作面板和交替组成员面板都能直接改名。
- 修正：编辑旧训练时点组号只动那一组；改过数的组做完再退回仍记得改过；时间线天粒度下本周记录标「本周」、一天多场不再起组头。
- 版本：`versionCode 5` / `versionName 2.0.0`，覆盖安装。

## [1.2.0] – 2026-10-11

### 变更

- **交互成本一轮**：点组号即选中并把指针挪到它下面；点进格子即全选，回车跳下一格；改一组的值会带动后面没改过的同值底稿；选中行加「递减」按钮；时长弹窗可直接打字；卡头时间点开改动作时间。
- 选动作弹层底部固定「完成 · 本次已加 N」，本次加过的再点即取消；训练名还是自动填的部位名时，换部位会同步改名。
- 开新一场不再弹「继续刚才那场」，改到时间线长按菜单里（刚结束 10 分钟内）；卡头「底稿 · 日期」可展开看上次做了什么。
- 编辑旧训练改在草稿上进行；首选项底座修正；头像。
- 版本：`versionCode 4` / `versionName 1.2.0`。

## [1.1.0] – 2026-10-07

### 变更

- **训练页工作台**：全场一个指针，组只分待做 / 做完，点组号才算做完；支持交替组；练法（同一动作的不同做法分开记录、分开算纪录）。
- **部位细分**：添加动作弹层按部位分细分格（最多 4 列，每个部位第一列「热身」），可长按拖到细分；「整理」成为动作库唯一的编辑入口，可自定义细分、把动作并入另一个动作。
- 改名更可靠：保留曾用名，偏好按显示名归并，训练卡上能直接改名；新增 36 个内置动作。
- 练到一半离开能接回工作台；一组都没做完的空场不进时间线。
- 修正审查中发现的一批数据问题：印章单位、日期选择器、组号、递减照抄、删除墓碑、撤销认错动作、热力图归日等。
- 版本：`versionCode 3` / `versionName 1.1.0`。

## [1.0.1] – 2026-09-20

### 变更

- **递减子组与普通组对齐**：递减档的重量 / 次数格支持横向拖动改值；删除改为长按 400ms（底稿里的一点即抹）。
- **递减档跟着记录走**：上次做过递减的组，底稿预填时连同递减档一起照抄；「添加组」复制上一组时也带上递减档。没有记录时手动加一档仍按 -20%，但改为从上一档往下降（原来永远按母组算，第二档与第一档相同）。
- **选部位直达该部位动作**：开练时选「练胸」（页内印谱或按住 + 号扇开），添加动作弹层打开即停在胸部栏，并清掉上次的器材筛选。
- **添加动作弹层整张可下拉收起**：手指在弹层任何位置下拉即可关闭；列表不在顶部时先让列表回滚。鼠标仍只在抓手与头部拖动。
- 修正：子组行原先只在挂载时读一次数据，外部更新（底稿、撤销、同步）后不刷新。
- 版本：`versionCode 2` / `versionName 1.0.1`。
- 验证：`npm run typecheck`、`npm run e2e`（35/35）、`npm run build`；浏览器合成触摸事件逐项验过，personal 包真机试用通过。

## [unreleased] – 2026-09-13

### 变更

- 网页 demo 默认浅色「墨与纸」，首帧初始化与 React 主题状态保持一致，不跟随系统深色。保留本次体验中的深色/跟随系统切换；刷新清空演示状态后恢复浅色。Android 与非演示构建的默认行为不变。
- 验证：`npm run typecheck`、`npm run build:demo`、`node scripts/check-demo-theme.mjs`；浏览器实测浅色首屏、切深色与刷新恢复浅色。

## [unreleased] – 2026-08-27

### 变更

- **后端迁移：Vultr VPS → 家庭 NAS（Tailscale Serve）**
  - 新地址：`https://hometj.taild995c6.ts.net`
  - 旧地址：`https://fitlog.myronhub.com`（VPS 仍在运行，可随时回滚）
  - 接口路径、鉴权方式（`Authorization: Bearer <SERVER_AUTH_KEY>`）、
    请求/响应格式、CORS 行为**均未改变**。
  - 地址改为可配置：`services/fitlogRemote.ts` 导出 `DEFAULT_API_BASE_URL`，
    `.env.local` 的 `VITE_API_URL` 优先级更高，可用于回滚。
  - ⚠️ 必须使用主机名，不可用 Tailscale IP `100.106.208.88` ——
    Tailscale Serve 按 Host 头路由，直接打 IP 返回 404。
  - ⚠️ 新地址仅在设备连接 Tailscale 时可达，公网无法访问。
  - 证书为 Let's Encrypt 正式签发，Android **无需** `usesCleartextTraffic`
    或 `networkSecurityConfig`（项目本来也没有配置，本次未改动）。
- 同步失败与助手网络错误新增提示「请检查 Tailscale 是否已连接」。
- `scripts/e2e-smoke.mjs` 移除写死的旧 VPS IP `149.28.138.105`，
  改为按 `E2E_API_BASE` / `VITE_API_URL` / 默认值解析。

---

## [unreleased] – 2026-05-22

阶段性大版本：移除 Supabase 单人化、新增训练计划、智能助手、UI 改版与 HTTPS 部署。

### 项目背景

- 单用户健身追踪 PWA，React + Vite + Tailwind + IndexedDB + Capacitor。
- 个人服务器 `149.28.138.105`，绑定域名 `fitlog.myronhub.com`（Cloudflare DNS，灰云直连）。
- HTTPS 通过 nginx + Let's Encrypt 签发；`3000` 端口已从 ufw 收回。
- 后端：`/var/www/my-fitness-backend/server.js`（Express + openai SDK）
  - 仅 `LISTEN 127.0.0.1:3000`，由 nginx 反代。
  - `SERVER_AUTH_KEY` 鉴权；`LLM_API_KEY` 调用上游模型。
  - 路径：
    - `POST /api/chat`：SSE 流式，OpenAI 兼容透传，**不再在 server 端拼 system**。
    - `GET / PUT /api/fitlog/state`：单 JSON 快照。

### 新增

- **HTTP 快照同步**：取代 Supabase，远端 `GET / PUT` 一份 JSON。
- **训练计划**：日程表 + 训练目标合并到「训练计划」Tab，计划完成后用户可标记 `faithful / modified`。
- **智能助手（AI Assistant）**
  - 底部 nav 改 5 列，位置在「我的」左侧。
  - 读权限：workouts、PR、goals、body metrics、exercise library、user settings。
  - 写权限：仅 `create_schedule / update_schedule / delete_schedule`；`update / delete` 需用户「应用」确认。
  - 流式 SSE 渲染、自动取名、对话新建/重命名/清空/删除（删除带 tombstone）。
  - 对话同步到远端 snapshot；Profile 提供「同步智能助手对话」开关。
- **系统提示词规则**：未显式索取时不主动产出计划，最多以一句反问试探（`assistantContextSnapshot.ts` 末尾 Planning policy）。
- **Nordic Minimal UI** + 跟随系统主题（深色/浅色）。
- **Playwright e2e**：`scripts/e2e-smoke.mjs`，32/32 通过。
- 部署文档：`RELEASE-GUIDE.md`、`android-release-build-guide.md`、`install-java.md`。

### 变更

- 客户端默认路径 `VITE_ASSISTANT_PATH=/api/chat`，默认模型 `deepseek-chat`，可被 `VITE_ASSISTANT_MODEL` 覆盖。
- IndexedDB 版本 bump 至 7，新增 `assistantConversations` store，缺少 store 时自动 force-upgrade。

### 移除

- Supabase 接入与认证 UI（`AuthUI.tsx`、`services/supabase.ts`、`hooks/useAuth.ts`）。
- 仓库内的 verification scripts、各类 `*-summary.md`、`metadata.json` 等遗留文档。

### 关键文件入口

| 模块 | 路径 |
|------|------|
| 助手 UI | `src/components/AssistantTab.tsx` |
| 助手运行时（消息回路） | `src/components/AssistantRuntime.tsx` |
| 助手对话上下文 | `src/contexts/AssistantContext.tsx` |
| SSE 客户端 | `services/assistant/assistantClient.ts` |
| 工具定义/执行/权限 | `services/assistant/assistantTools.ts` |
| 系统提示词摘要 | `services/assistant/assistantContextSnapshot.ts` |
| 日程上下文 | `src/contexts/ScheduleContext.tsx` |
| 日程视图 / 编辑器 | `src/components/ScheduleView.tsx` / `ScheduleEditorModal.tsx` |
| 远端同步 | `services/fitlogRemote.ts` / `fitlogRemoteSync.ts` / `fitlogSyncScheduler.ts` |
| Tombstones | `services/fitlogTombstones.ts` |

### 配置

- `.env.local`
  - `VITE_API_URL=https://fitlog.myronhub.com`
  - `VITE_API_KEY=<同服务器 SERVER_AUTH_KEY>`
  - 可选：`VITE_ASSISTANT_PATH=/api/chat`、`VITE_ASSISTANT_MODEL=deepseek-chat`

### Git

- 主开发分支：`personal_use`，已推送到 `origin/personal_use`。
- 关键 commit：`31caf8d feat: single-user sync, training plan, AI assistant, and UI refresh`。
