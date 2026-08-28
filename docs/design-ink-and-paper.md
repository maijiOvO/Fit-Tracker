# 「墨与纸」视觉与动效规格

> 状态：**已定稿，P0–P5 已全部落地**。2026-08-27 定稿并实现。
> 这是 FitLog 视觉重设计的唯一事实来源。实现时照此文档写，与本文冲突的旧代码以本文为准。
>
> 配套可交互样机（真实渲染，含慢放对比）：
> - 方向提案 https://claude.ai/code/artifact/436c1694-4f28-4253-ada8-948cc5d1fd16
> - 动效样机 https://claude.ai/code/artifact/27d80ece-9b1e-4364-ac03-186efd450071

---

## 0. 一句话

把 App 从「一个记录工具」改写成**「我自己出版的一本训练月刊」**。
每次训练是一期（刊头写日期 + 期号 Vol.128），每个动作是一个栏目（一页稿纸），
每一组是账本上的一行，历史是往期目录，设置页是版权页，破 PR 是往这一页上盖一枚章。

材料只有三样：**纸**、**墨**、**朱砂**。圆角近直角，**全 App 唯一的圆是那枚印章**。

### 为什么是这个方向

病因诊断：现在的「死板」= 中文全部回落系统黑体 + 单一冷蓝 + 12/8/6 保守圆角，
三者叠出一种**「没有作者的 SaaS 感」**。本方向是三个候选里唯一在「作者感」这层给出答案的。

（落选：B「配重」器械感——健身房实用性最高但落进了「黑底橙 + 等宽 + LED」的时髦公版；
C「呼吸体」柔和生命体——落地最容易但正是「健康类 App 的默认长相」，且数字只给 22px，
打在唯一不可妥协的约束上。两者可嫁接的点见 §9。）

### 硬约束（任何决策不得违反）

1. 手机 21:9 竖屏、健身房单手、可能出汗手滑、光线不定。**抬眼 0.3 秒必须读到重量和次数。**
2. 纯中文 UI。深浅双主题都真实在用。
3. 交互骨架已打磨过一轮（底部弹层选动作、长按手势、重量继承、拖拽关闭），**保留不动**，改的是视觉层与「感觉」。
4. 单人自用，无社交/商业化包袱——可以大胆、个人化。

---

## 1. 现状诊断（实现前必修的三类死 bug）

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 1 | **`tailwindcss-animate` 从未安装**，`animate-in` / `slide-in-from-*` 全是死类 | 20 个文件；`package.json` 无此依赖，`tailwind.config.js` `plugins:[]`，index.css 也无等价定义 | 13 个弹窗 + 确认框 + toast + 训练页切换**全是硬切**，零动画 |
| 2 | **中文字体一个都没加载** | `index.html:26` 只有 Bricolage Grotesque / Inter / JetBrains Mono，均无 CJK 字形 | 纯中文 App 的所有中文都在用系统默认字体 |
| 3 | **`max-w-sm` 写成 `max-sm`**（无效类） | AddGoalModal:27 / EditGoalModal:27 / MeasurementModal:30 / WeightInputModal:31 | 这四个弹窗宽屏下全宽铺开 |
| 4 | **带透明度的令牌类全是死类**（P0 实测发现，已修） | 全库 82 处：`bg-base/80`×13、`bg-danger/10`×11、`bg-accent/10`×10、`ring-accent/25`… | Tailwind 3 遇到纯字符串颜色（`'var(--accent)'`）会静默丢弃 `/透明度` 修饰符，产物里一条 CSS 都没有。**顶栏与底栏实测 0% 不透明**，可读性全靠 backdrop-blur 撑着 |

其他系统性问题：

- **72 处硬编码 `text-white`**，五个弹窗的标题/数值在浅色主题下**看不见**（"先做深色、浅色靠反转"的遗留）。
- **裸圆角 169 处 vs 令牌圆角 100 处**（rounded-2xl 69 / xl 53 / lg 23 / full 24 vs card 28 / control 33 / chip 39）——令牌定的 12/8/6 早被架空。
- **15 个弹窗只有 1 个复用共享 Modal**，其余 14 个各自手搓：底色、模糊、内边距、标题字号（三档）、圆角（12/24/48px）、确认按钮阴影（四种写法）全不一致。
- **同一个「小标签」语义有 7 种写法**，9/10/11/12px 五档字号混用，大量对中文无效的 uppercase + 字距。
- **调色板四份拷贝**（index.css 令牌 / heatmap.css / LazyCharts.chartPalette / charts 死代码）。图表用脱离令牌的 slate/indigo 旧配色，不随主题变。
- **`ui-data-xl` / `ui-data-lg` 零使用**，而录入重量的输入框只有 14px——与「一眼可读」直接冲突。
- **浅色 `--text-tertiary` #8a8a8e 对比度仅 3.2:1**（AA 需 4.5:1）。
- 常驻栏 **backdrop-blur 4 处**压在滚动列表上（见 §7 性能）。
- `--shadow-elevated` 既做海拔又被当选中态标记，语义混用。
- 主题首帧逻辑双份维护（index.html 内联脚本 vs useTheme.ts），theme-color 色值硬编码三处。

---

## 2. 色彩令牌

**规则（永不违反）**：`card` 比 `base` **亮**（纸浮在桌面上），`inset` 比 `base` **暗**（压痕/凹槽）。
这直接根治现有的「SetCapsule 子组行 bg-card 浮在 bg-inset 上」「长按菜单 inset 套 card」等层级反转。

### 浅色 · 纸

```css
--bg-base:        #EFE9DC;  /* 装订底 / 桌面 */
--bg-card:        #FBF8F1;  /* 纸，比 base 亮 */
--bg-card-hover:  #F5F1E7;
--bg-inset:       #E7E0D0;  /* 压痕，比 base 暗 */
--divider:        #D9D0BC;
--rule-strong:    #B9AE97;  /* 刊头粗线（新增） */
--text-primary:   #1A1714;  /* 墨 */
--text-secondary: #554E45;
--text-tertiary:  #665E53;  /* card 6.02 / base 5.27 / inset 4.85 —— 三种底全过 AA。
                               初稿 #6F675C 只校过 card，对 --bg-inset 仅 4.24:1 */
--accent:         #B23A28;  /* 朱砂 / 红笔 */
--accent-soft:    #F4E3DD;
--accent-ink:     #8E2C1D;  /* 按压态 */
--text-on-accent: #FDFBF6;  /* 新增，杀掉 72 处硬编码 text-white */
--highlight:      #E3A81F;  /* 荧光笔黄，第二情绪色。⚠️ 只作底色：作文字对 card 仅 2.00:1 */
--text-on-highlight: #1A1714;  /* 新增。荧光底在深浅两主题里都是「亮底」，压不住 --text-primary
                                  （深色下 #EDE6D8 压 #D9A648 只有 1.78:1）。与 accent 同构 */
--highlight-soft: #F7EBCB;
--success:        #3F6B45;  --success-soft: #E2EBDF;
--warning:        #815709;  --warning-soft: #F6E9CC;
/* ↑ card 6.00 / base 5.26 / inset 4.84 / soft 5.29。初稿 #A8791B 作正文对 card 仅 3.66:1，
   而 text-warning 现有 7 处。芥黄本体保留在 --chart-3（非文本用途，3:1 即可）。 */
--danger:         #8E2C1D;  --danger-soft:  #F3DED8;
--scrim:          rgba(26,23,20,0.45);   /* 新增，统一 black/45 与 black/50 */
--focus-ring:     var(--accent);         /* 新增。聚焦是描边不是光晕（§5.3）：
                                            outline: 2px solid var(--focus-ring); outline-offset: 2px */
```

### 深色 · 夜读牛皮（不做米色反转，独立叙事，暖色不掉）

```css
--bg-base:        #14120F;
--bg-card:        #1E1B16;
--bg-card-hover:  #26221B;
--bg-inset:       #0E0C0A;
--divider:        #332E25;
--rule-strong:    #4A4232;
--text-primary:   #EDE6D8;
--text-secondary: #B3A992;
--text-tertiary:  #948A78;   /* card 5.04 / base 5.49 / hover 4.65。初稿 #8A806E 对 card 4.41:1 */
--accent:         #E0674B;
--accent-soft:    #351712;
--accent-ink:     #ED7A5E;   /* 深底上「按下＝更浓的墨」读不出来，按压态改往亮走。on-accent 6.64:1 */
--text-on-accent: #17130F;   /* 朱砂底上必须深字，5.47:1 */
--highlight:      #D9A648;   --highlight-soft: #33280F;
--text-on-highlight: #17130F;   /* 8.36:1 on highlight */
--success:        #86B27C;   --success-soft: #1B2A1C;   /* 7.09:1 on card */
--warning:        #CE9B3C;   --warning-soft: #2C2314;   /* 6.85:1 on card */
--danger:         #E8776A;   --danger-soft:  #331611;   /* 5.95:1 on card */
--scrim:          rgba(0,0,0,.60);
--shadow-page:    0 1px 1px rgba(0,0,0,.35);
--shadow-overlay: 0 2px 6px rgba(0,0,0,.45), 0 18px 40px -24px rgba(0,0,0,.80);

/* 纸色系那五个图表色在深底上最低只有 2.31:1，深色需要自己一套（全部 ≥4.71:1） */
--chart-1: #C2705B;  --chart-2: #7FA6B0;  --chart-3: #C79A3E;
--chart-4: #94A97F;  --chart-5: #A79C8E;
```

### 图表序列色（新增，解决「全 App 只有一个色在做所有可视化」）

从竞赛杠铃片色降饱和成纸色系，**同时**供动作卡左缘 3px 条、历史列表锚点、图表分类三处使用：

```css
--chart-1: #8C4A3C;  /* 棕红 */
--chart-2: #3C5A62;  /* 墨青 */
--chart-3: #A8791B;  /* 芥黄 */
--chart-4: #5A6B4A;  /* 苔绿 */
--chart-5: #7A7268;  /* 灰白 */
```

### 验收条款（写进令牌层，不是建议）

> **任何 accent 底上的文字必须过 4.5:1 对比度。**
> （评审在落选方向里抓到过「白字压橙只有 2.9:1」的真 bug，这套意识必须继承。）

---

## 3. 字体

**中文与拉丁共用同一族**——这是修「中英混排两种气质割裂」的关键，不是加一个中文字体，
而是让 latin 也走 SC 族。

| 角色 | 字体 | 字重 | 用途 |
|---|---|---|---|
| 刊头 / 标题 | **Noto Serif SC** | 500 / 600 / 700 | 页面标题、动作名、栏目标题、弹窗标题 |
| 正文 / UI | **Noto Sans SC** | 400 / 500 / 600 / 700 | body 字体栈整体替换 |
| 数据 | **IBM Plex Mono** | 500 / 600 | 替换 JetBrains Mono。账本/打字机气质与衬线刊头同源（IBM Plex 是 serif+mono 同族设计）；JetBrains Mono 是 IDE 气质，与纸感冲突 |
| 印记 / 批注 | **Ma Shan Zheng** | 400 | 只用于印章的「记」「破」字、空状态手写批注 |

### ⚠️ 两个必须避开的坑（评审在方案原稿里抓到的真错误）

1. **`&text=` 子集参数作用于整个请求，不是某一族。**
   把 Ma Shan Zheng 的 `&text=` 和正文字体写进同一条 `css2` 请求，会把**正文字体也子集掉**，
   全站中文瞬间回落系统黑体——等于把整个方向自杀。**Ma Shan Zheng 必须单开一条 `<link>`。**

2. **规格里写了 600 字重就必须加载 600。**
   三个候选方向都犯过「只加载 500/700 却在规格里写 600」的错，那正是它们自己批评的伪加粗。

### 字号阶梯（写进 tailwind fontSize 令牌，终结「display 在 Tailwind、data 在 CSS、正文缺失」的三处断裂）

| 令牌 | 值 | 用途 |
|---|---|---|
| `data-xl` | 40px / 1 / 600 | PR、结束训练总结 |
| `data-lg` | **26px** / 1 / 600 | **组行重量与次数——从 14px 提上来，本案最关键的一个数字** |
| `data-md` | 22px / 1.1 / 600 | 卡片汇总、体重 |
| `headline` | 28px Serif 700 | 训练标题（现在 text-base 反而弱于动作名 text-lg，是倒挂） |
| `h2` | 17px Serif 600 | 动作名 |
| body | 15px / 1.7 / 400 | 正文 |
| label | 12px / 1.4 / 500 | 标签 |
| micro | 11px / 1.4 / 500 | **下限 11px，9/10px 全部作废** |

### 排印铁律（从落选方向 B 嫁接，比原方案更对）

- **中文永远 `letter-spacing: 0`，永不 uppercase。**
- **拉丁小标签保留 uppercase + `letter-spacing: .08em`**（KG / REPS / SET / PR / RPE / VOL）——
  这正是印刷品里拉丁小字的排法，一刀切废掉会把眉批标签的印刷味一并砍掉。
- 衬线**只用于 ≥17px 且字重 ≥600**；正文与所有 <15px 一律 Noto Sans SC；**数据永远等宽，绝不用衬线数字**。
- `font-variant-numeric: tabular-nums` 铺开到**所有**数字。

### 字体工程（不做这一步，整个方向在断网时归零）

- **必须自托管进 `dist/fonts/`**，不能走 `fonts.googleapis.com`：
  国内被墙 + 健身房地下室没信号 = 这个 App 的**核心场景**下字体拉不到。
  且 `sw.js:33` 明确跳过跨域请求，Service Worker 对当前策略**帮助为零**。
- **子集化**：UI 文案是封闭集合（translations.ts + 动作库），实际用字约 700–1500，
  子集后每字重 60–150KB（完整版 8–10MB）。用构建脚本从源码扫字符，挂进 build 流程，
  否则新加文案会静默出现豆腐块（□）。
- **`font-display: optional`，不是 `swap`。** 中文兜底字体与目标字体度量差异大，
  一次晚到的 swap 会让整个滚动列表重排。`optional` 给约 100ms 阻塞期、超时用兜底且**本次永不再换**，
  布局抖动为零；而本地打包的字体几乎必赢这 100ms。
- 字体栈永远留系统兜底（用户自定义动作名可能含子集外的字）：
  `'Noto Sans SC','Noto Sans CJK SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif`
- `<link rel="preload" as="font" type="font/woff2" crossorigin>` 中文子集（`crossorigin` 即使同源也必须写）。
- 给兜底字体加度量覆写 `@font-face`（`size-adjust` / `ascent-override` / `descent-override`）。

---

## 4. 圆角 / 阴影 / 层级

```css
--radius-card:  4px;   /* 近直角 */
--radius-control: 3px;
--radius-chip:  2px;
--radius-sheet: 4px;   /* 弹层顶部，不再是 22px */
--radius-stamp: 4px;   /* 印章方印 */
```

**阴影 = 接触阴影。** 纸的阴影是极短偏移（0–2px）、几乎不模糊、面积小。
现在的 `0 1px 3px + 0 4px 12px` 是**塑料卡片**，必须重做：

```css
--shadow-page:    0 1px 1px rgba(26,23,20,.07);
--shadow-overlay: 0 2px 6px rgba(26,23,20,.10), 0 18px 40px -24px rgba(26,23,20,.30);
```

⚠️ **阴影只表达海拔，不再兼做选中态**（现有代码用 `shadow-elevated` 标记选中，语义混用）。

### 圆角迁移顺序（关键，不照做会「改一半比现在更乱」）

代码库一年来一直在自发加圆（裸圆角 169 处），本方向要反向压到近直角，是逆势替换。

> **第一步只改 `--radius-*` 三个令牌值 + 把 `tailwind.config.js` 的 borderRadius 改成 `var()`，
> 让存量 `rounded-card/control/chip`（100 处）自动跟随。
> 第二步再分批清理裸 `rounded-xl/2xl/lg/full`（169 处）。
> 绝不在同一次改动里既改令牌又扫 className。**

### z-index 收敛

现有 70/80/100/110/120/190/200 六层随手值 → 收敛为语义常量写进 `tailwind.config.js` 的 `zIndex`。

---

## 5. 动效

### 5.1 令牌（动效层是全库唯一还没令牌化的层）

```css
--dur-tap:    120ms;  /* 按压、无位移的颜色变化 */
--dur-base:   220ms;  /* 95% 的元件级过渡 */
--dur-exit:   180ms;  /* 退场（＝「划掉」那一笔的时长，语言自洽） */
--dur-page:   320ms;  /* 整屏 / 弹层 / 主题 */
--dur-stamp:  520ms;  /* 印章。全站只出现在结束训练与 PR */
--dur-reveal: 700ms;  /* 手写批注渗出这类可以慢的收尾 */

--ease-paper: cubic-bezier(.2,.8,.2,1);    /* 纸张落定，零过冲，95% 场合 */
--ease-stamp: cubic-bezier(.2,1.6,.35,1);  /* 盖章回弹，唯一允许过冲 */
--ease-ink:   cubic-bezier(.4,0,.2,1);     /* 墨迹渗开，给颜色与不透明度 */
--ease-leave: cubic-bezier(.5,0,.9,.7);    /* 加速离场 */

--press:    0.985;  /* 大面：卡片 / 主按钮 / 弹层行 */
--press-sm: 0.94;   /* 图标按钮 ≤44px */
--move:     1;      /* reduced-motion 下置 0，一个变量关掉全站位移 */
```

**收敛掉的随手值**：`active:scale` 五种（.90/.95/.97/.98/.99）→ 两档；
时长九种（150/200/300/350/500/550/1500/1600/2000ms）→ 六个令牌；
`transition-all` 约 80 处 → 显式属性（它会连带过渡 clip-path / grid-template-rows，与揭示动画直接打架，**必须清**）。

### 5.2 节奏总纲

> **落笔 → 渗墨 → 盖章。** 每条动效必须能归到这三个动词之一；归不进去的，说明它是从别的设计语言里抄来的，删掉。

- **落笔**（clip-path / scaleX 由一端展开）＝ 内容出现、进度、确认
- **渗墨**（背景色 / 墨色的一次涨落）＝ 瞬时反馈、状态变化
- **盖章**（scale + rotate 带过冲）＝ 全 App 只有两处：PR 印章、长按达成

### 5.3 逐场景规格

| 场景 | 做法 | 时长 / 曲线 |
|---|---|---|
| **写下一组** | 新行 `clip-path: inset(0 0 100% 0) → inset(0)` 自上而下揭示，同时 `grid-template-rows: 0fr→1fr` 撑开占位（否则下方按钮会先跳）。**继承来的重量不做滚动**——用淡墨 + 朱砂虚线表示「这是抄的，等你确认」，改了或确认了转实墨 | 220ms / `--ease-paper` |
| **划掉一组**（签名动作） | 1.5px 墨线从左横穿该行 → **停顿 20ms**（让眼睛确认）→ 行 `grid-template-rows: 1fr→0fr` + `clip-path` 从右往左收 | 180 + 20 + 220ms |
| **删除一个动作** | 整卡灰度化 + 朱砂线横穿栏目名 → 卡片 clip 从下往上收走；**兄弟卡片用 FLIP 上移补位**（400px 高的卡不能用高度动画，会 relayout 整列表） | 480ms |
| **落笔聚焦** | 输入框底部 2px 朱砂下划线从**中心向两端**展开。删掉 `focus-within:ring-*`（ring 是 Material 的东西，纸上没有光晕） | 160ms / `--ease-paper` |
| **墨色过冲** | **替代 `scale` 弹跳的技法**：元素落位时墨色瞬间加深、220ms 内回到目标浓度，**位置零位移**。笔尖压下时墨更浓，物理成立。用在「有东西因你的操作而改变、需要你注意到」的地方——主要是添加动作 | 220ms / `--ease-ink` |
| **添加动作的回声** | 动作名墨色过冲 + 整行渗墨一次，留下常驻的绿色左缘条（状态，非动画），**弹层不关** | 220 + 520ms |
| **长按进度** | 底边 1.5px 朱砂线向右画出（**不用圆环——唯一的圆是印章**）。**前 120ms 什么都不出**，否则每次普通点按都闪一下。同时**浮出标签说明会发生什么**（见 §6） | 120ms 延迟 + 380ms linear |
| **弹层开关** | 手势 1:1 跟手；**松手用速度投影判定**（`d.y > H*0.28 \|\| v > 0.6`），收尾时长 `clamp((H-y)/max(v,.8),120,260)`——甩得越快收尾越短。`pointerdown` 时从**进行中动画的当前位置**接管 = 真正的可中断 | 320ms 开 / 180ms 关 |
| **结束训练（刊末页）** | 翻到刊末页：期号（历史训练总数+1）、本期摘要、日期逐行 clip 揭示（stagger 60ms），总容量 count-up，底部朱砂线从中心展开＝付印。**必须可点击跳过** | 约 880ms |
| **PR 达成（签名时刻）** | **方案 A · 落章（已选定）**：朱砂印从 `translateY(-14px) scale(1.9) rotate(-8deg)` 落到 `translateY(0) scale(1) rotate(-4deg)`，`--ease-stamp` 带过冲；落定同帧挤墨扩散 + 重触感；随后小字 clip 揭示 + 数字 count-up；最后 rotate 微收束 | 约 1420ms，可跳过 |
| **主题切换** | View Transitions，**擦除形状是矩形不是圆**（圆形涟漪是 Material 签名动作，且违反「唯一的圆是印章」）：上下两条边同时向外推开的 `inset()`。`meta[theme-color]` **必须在动画开始那一刻就改**，否则状态栏晚 520ms 变色露馅 | 520ms |
| **Tab 切换** | **不做横向滑动**（dashboard/plan/profile 之间不存在空间方向关系，`slide-in-from-left/right` 是编造的空间隐喻）。先出后进、零重叠：旧 tab 淡出上移 4px → 换内容 → 新 tab 淡入上移 6px | 100 + 220ms |
| **列表 stagger** | `delay(i) = min(i,6) × 32ms`（**封顶第 7 项**，否则快速滚动时内容「追着你长出来」）。动作是 clip 揭示，不是 translateY——纸上的字是印出来的，不是飞进来的 | 220ms |
| **Toast** | 入场 `clip-path: inset(0 100% 0 0) → inset(0)` 从左往右印出；**底边加剩余时间线**（`scaleX(1→0)` linear，时长＝停留时长）——现在「撤销还剩多久」完全不可见 | — |

### 5.4 数字动画规则

> **数字只在「因为用户刚做的这个动作而改变」时才动；页面加载时呈现的数字一律不动。**

| 动 | 不动 |
|---|---|
| 底栏「N 动作 · M 组」 | **输入框里的重量/次数**（正在输入，插值是撒谎） |
| 弹层「本次已加 N」 | 只读历史值（印刷品不会自己变） |
| 刊末页总容量 / 总组数 | 时间线分组统计（是页面事实，不是事件结果） |
| PR 数字 `prev → next` | Dashboard 体重摘要（打开就在那） |
| | 计时器 / 秒表（等宽数字**逐秒硬切**本身就是正确的时间表现） |
| | Recharts（`isAnimationActive={false}`） |

### 5.5 三个现有动画的去留

| 动画 | 处置 | 理由 |
|---|---|---|
| `anim-add-flash` 0.55s | **改造**为 `anim-ink-mark` | 职责对的（点行即添加需要非模态确认）。三处要改：①用了蓝色 accent → 换朱砂 9%；②`scale` 是玩具语言 → 删掉 transform，改常驻 3px 边杠 + 一次渗墨；③0.55s 随手值 → `--dur-stamp`。现有的 `remove → offsetWidth → add` 强制重排触发法**保留**，写得对 |
| `anim-ring` 1.6s | **废弃** | ①它是 Material 的 ripple/pulse——「辐射」，纸上没有辐射源；②1.6s 用在中高频操作上（研究给的预算是 ≤120ms）；③逐帧动画 `box-shadow` ≈ 96 帧重绘；④它的职责（定位新卡）应由**卡片自己的入场**承担 |
| `anim-chip-pop` `scale(1→1.18→1)` | **废弃**，能力迁移到墨色过冲 | 18% 过冲 = 典型玩具感（**Apple 系统默认过冲只有约 1%**）。它想表达「这个数变了」，用墨色浓度表达同一件事且不引起布局注意力抖动 |

三个都是同一个毛病：**用「尺寸/光晕的变化」表达「状态的变化」**。
墨与纸里，状态变化只能用**墨的深浅**和**线的有无**表达。

### 5.6 reduced-motion

**reduced-motion ≠ 无动画，而是无位移/无缩放/无旋转。** 颜色与不透明度过渡保留，它们不引发前庭反应。

```css
@media (prefers-reduced-motion: reduce){
  :root{ --move: 0; --dur-page:120ms; --dur-stamp:150ms; --dur-reveal:200ms; }
}
:root[data-reduced-motion="1"]{ --move: 0; /* 同上 */ }
```

所有 transform 写成 `translateY(calc(12px * var(--move)))`，一个变量关掉全站位移。

⚠️ **必须在「我的」里加一个应用内三态开关**（跟随系统 / 开 / 关）：
Android 的 `prefers-reduced-motion` 映射自「设置→无障碍→移除动画」，但
**开发者选项里的「动画程序时长缩放 = 关闭」也会触发它**，而很多人为了「让手机更快」关掉了它——
那会静默关掉你所有动效。且部分 OEM 皮肤有自己的开关，不写这个值。

**唯一例外**：长按进度线在 reduced-motion 下**仍然要画**。它是功能性进度指示不是装饰，
去掉等于让用户回到「盲等 500ms」。（这条要写在代码注释里。）

### 5.7 触觉

Android 绝大多数机器只有一颗马达，**振幅控制需要 `hasAmplitudeControl()`，很多中低端机返回 false**——
此时 Light/Medium/Heavy **手感完全一致**。

> **不要设计依赖「用户能分辨轻/中/重」的触觉语言。按两档设计：一下「点击感」、一下「确认感」，靠时长区分。**

纯 Android 自用 App 用 `navigator.vibrate` 比 `@capacitor/haptics` **更好**：延迟更低（不走 bridge，插件约 5–20ms）、
零依赖、`VIBRATE` 权限已在 Manifest 里（normal permission，安装即授予）。

时间对齐五条：
1. **先发震动再启动画**（马达机械启动延迟 ERM 约 10–30ms，天然落后）。
2. 脉冲锚在**语义时刻**（状态提交那一帧），不是动画起点，**更不是 `transitionend`**。
3. 绝不在 rAF / 滚动回调里调，**去抖 ≥50–60ms**。
4. 必须在用户手势的同一个任务里调，否则被静默丢弃。
5. **给一个全局开关**——安静的健身房里会自己嗡嗡的 App 很讨人嫌。

```ts
export const H = { tap: 8, pick: 12, longpress: 14, threshold: 6,
                   seal: [0,18,40,12], error: [20,60,20] } as const;
```

---

## 6. 关键组件

### 6.1 SetCapsule = 账本行（改动最狠也最值）

- 行**不再是填充盒**：去掉背景与边框，只留 `border-bottom`，`min-height: 52px`。
  从「一堆灰色胶囊」变成账本横线，**同屏噪音直接减半**。
- 卡片组区加稿纸横纹：`repeating-linear-gradient(to bottom, transparent 0 51px, var(--divider) 51px 52px)`。
- **数值输入 14px → 26px** IBM Plex Mono 600 tabular-nums，`background: transparent; border: 0`，
  `caret-color: var(--accent)`。单位缩成 11px 内嵌右下角，删掉 10px 表头副行。
- **父子共用网格变量**根治错位：卡片上写 `style={{'--cols': '44px repeat(N,1fr) 44px'}}`，
  父行与子组行都用 `grid-template-columns: var(--cols)`（删掉写死的 `grid-cols-4`），
  表头 padding 与行统一 `0 12px`（修 `px-2` vs `p-3` 的 4px 错位）。
- 组号做成 36×36 可长按胶囊；删组热区补到 44×44（现在是 35px 固定列里的 16px 图标，
  与页面其他处精心维护的 `min-h-[44px]` 自相矛盾）。
- 子组行去掉 `bg-card` 反转，改 `border-left: 2px solid var(--divider); padding-left: 10px` 的引文式缩进。

### 6.2 ExerciseCard = 一页稿纸

- 头部＝刊头行：左 Serif 600 17px 动作名，右 mono 12px「第3个 · 24组 · 1.2t」，下方双线分隔。
- 负重/辅助 chip 改**眉批标记**（虚线描边），用 `::before{inset:-10px}` 把 44px 热区补出来。
- **删除动作只保留一处**（移进刊头右侧 ⋯ 溢出菜单），底部只剩通栏「＋ 添加组」虚线按钮。
- 齿轮与 chip 两个 metric 入口合并为单入口。

### 6.3 ExercisePickerSheet

- 面板顶部 `border-top: 2px solid var(--accent)`＝一条朱砂书脊（代替原来靠圆角找存在感）。
- **chip 动物园收敛为两级、用形态而非高度区分**：统一 `min-height: 40px` 同字号
  （现在是 38/34/36 三种相邻堆叠）。单选轴选中＝墨色实底；多选轴选中＝朱砂描边。
  **选中态一律不加 shadow。**
- **只读信息标签改眉批式**（12px + 虚线下划线），不再是胶囊——原 9px uppercase 全废。
  规则：**真正需要点的才配拥有边框，纯只读信息不配。**
- 分组标题：Serif 600 15px + 前置 12px 朱砂短横，去 uppercase/tracking。

### 6.4 长按手势（两处共用一个 hook）

| 手势 | 产物 | 频率 |
|---|---|---|
| 长按**组号** | 给这一组加一条**递减子组**（drop set） | 极低 |
| 长按**弹层动作行** | 该动作的管理菜单（编辑标签/重命名/删除） | 极低 |

> **原则：高频动作绝不藏进长按。**「添加组」「添加动作」始终是可见按钮。

⚠️ **长按必须自我解释**：进度线开始画的同时，旁边**浮出标签说明会发生什么**（如「加子组」）。
手势保持零常驻 UI 成本，但按住即自解释；半路松手那一闪，正好把手势教给用户。
（实测：不加标签时，连设计者本人都不记得这个手势是干嘛的。）

### 6.5 图表与热力图 = 版画插图

- **去掉渐变面积填充**（塑料感来源），改 1.75px 墨线 + 45° 斜线 pattern（1px、8% 不透明、间距 6px）。
- **末点常驻数值标签**（6px 实心方块 + 右侧 mono 13px）——现在读任何数值都必须点 tooltip，
  出汗手滑场景下这是最差的读数路径。
- PR 参考线：`stroke-dasharray: 2 4` 朱砂虚线 + 右端「PR 102.5」角标。
- 轴字 10px → 12px；tooltip 底改 `var(--bg-card)`（现在深底白字在浅色主题下也不变）；
  metricKey 本地化为中文；数值智能去零（80 而非 80.00）；`animationDuration` 1500 → 400。
- **所有颜色改 `getComputedStyle` 读 CSS 变量**，删 `charts/` 死代码目录与 `chartPalette` 硬编码。
- **热力图自绘替换 `react-calendar-heatmap`**（现在靠 `!important` + `translateX(45px)` 魔法数字硬撑）：
  `display:grid; grid-template-columns:repeat(7,1fr)`，格子色用
  `color-mix(in srgb, var(--accent) calc(var(--lvl)*22%), var(--bg-inset))` 派生；
  **强度改按当日总组数分档（0 / 1-8 / 9-16 / 17-24 / 25+），不是场数**——
  单人自用一天几乎只有 1 场，按场数分档会退化成二值图；加今日标记、图例、连续天数。

### 6.6 弹窗统一

14 个手搓弹窗全部收进 `Modal.tsx`，加 `variant='center' | 'sheet'`。

- **不装 `tailwindcss-animate`。** 装插件只是把死类救活成「不对的活类」——
  20 个文件里的 `slide-in-from-bottom-5` / `zoom-in` 在新语言下**没有一个是对的**，
  救活了还得逐个改。且它**完全不解决退场**（13 个 modal 全是 `if(!open) return null`，元素直接消失）。
- 需要 `useDismissAnimation(open, exitMs)` 把 `mounted` 与 `open` 解耦。
- center 入场＝`paper-drop`（一张纸轻轻落下并摆正）；退场只用 opacity，**不要反向播 clip**（那看起来像倒带）。
- sheet 复用 ExercisePickerSheet 已跑通的手势骨架。
- 统一 `<ModalFooter>`：取消 `flex:1` 描边 / 确认 `flex:2` 实心，`min-height: 52px`，
  **去掉全部 `shadow-blue-600/*` 彩色阴影**（本方向确认按钮不发光）。
- **危险操作不靠颜色区分**（朱砂既是品牌色又是危险色，这是本方向最大的结构性风险）：
  靠**形态与位置**——accent 只以细描边、下划线、印记小面积出现；
  danger 只以「全宽实心 + 划掉图标 + 明确文案」出现且仅存在于确认弹窗内；
  列表里的删除入口一律降级为 ⋯ 菜单内的墨色文字项；
  **删除组必须长按 400ms 才真删**（出汗手滑场景下，只靠颜色和文案不够）。
  退路：若实测仍别扭，accent 降为墨青 `#3C5A62`，朱砂只保留给印章与 PR。

---

## 7. 工程约束（Capacitor Android WebView）

### 7.1 立刻可做的纯收益项

1. **删掉常驻栏上的 `backdrop-blur-*`，保留不透明度。**
   位置：`AppHeader.tsx:33`、`TabNavigation.tsx:36`、`NewWorkoutTab.tsx:131,292`。
   训练主界面同屏常驻 2–3 层 backdrop-filter，下面是滚动列表——每个滚动帧都要重新光栅化 +
   24px 高斯模糊，**滚动走不了 GPU 快速路径**（那种「滚起来有点黏」的来源）。
   而这些栏已经 90–95% 不透明，24px 模糊只贡献约 5% 可见像素。**视觉几乎无差别，性能质变。**

   ⚠️ **前置条件（P0 实测补充）**：上面这句「已经 90–95% 不透明」在修复 §1 第 4 类死 bug 之前**是错的**——
   `bg-base/90` 与 `bg-base/95` 当时生成零条 CSS，两个栏实测 `background-color: rgba(0,0,0,0)`，
   全靠那层模糊撑可读性。**必须先让透明度类真正生效，再删 backdrop-blur**，顺序反了会得到全透明的常驻栏。
   （弹窗遮罩上的可以留——背景静止，只付一次成本。但**模糊层与淡入层要分离**，
   否则淡入期间每帧都在重新模糊。）
2. `capacitor.config.ts` 加 `android: { minWebViewVersion: 115 }`（本文所有技术的最高门槛）
   和 `backgroundColor: '#FBF8F1'`（消除冷启动白闪）。
3. `index.css` 的 `ring-flash` / `add-flash` 改成只动 transform + opacity。
4. hover 规则用 `@media (hover: hover)` 包住（触屏上 hover 状态会粘住）。

### 7.2 技术选型结论

| 技术 | 结论 | 要点 |
|---|---|---|
| View Transitions | ✅ 用 | Chrome/WebView 111+，无需 flag。**React 19.2 稳定版没有 `<ViewTransition>`**（只在 canary），手写包装 + `flushSync`。**懒加载 chunk 必须先预热再启动 VT**，否则快照里是 spinner。`view-transition-name` 全局唯一，重复直接抛错。时长 ≤250ms（过渡期间整页冻结） |
| Web Animations API | ✅ 用 | 可中断的唯一途径。**React 里根本不要用 `commitStyles`**（元素不在渲染树时抛错；写进 inline style 后 React 不会清）。让最终状态由 React state 持有，`fill:'none'`，`finished.catch(()=>{})` |
| FLIP | ✅ 用 | 性价比最高（最终只动 transform）。`useLayoutEffect` 里做；**读写要分批**（先读完所有 rect 再统一写）；滚动容器里要一并记录 `scrollTop` |
| scroll-driven animations | ✅ 用 | Chrome 115+。**完全跑在合成器线程**，严格优于 IntersectionObserver。keyframes 里只能有 transform/opacity；`animation-fill-mode: both` 必需 |
| `interpolate-size` | ✅ 用（优于 `grid 0fr→1fr`） | Chrome 129+，不需要 grid 包装层，不支持时自然退化。给容器加 `contain: layout paint` |
| `@property` + conic-gradient | ⚠️ 谨慎 | 支持没问题（Chrome 85+）但**每帧逐像素重绘**。单个小环可以，**列表里 8 个必掉帧**。进度环优先用 SVG `stroke-dashoffset` |
| `clip-path` 动画 | ⚠️ 走 paint 但比 layout 便宜得多 | 单元素单次没问题；滚动列表里逐项别用。`polygon()` 之间插值要求点数完全相同 |
| `mask-image` | ✅ 静态 / ⚠️ 动画 | 静态遮罩 GPU 很擅长；动画 position/size 是每帧重绘 |
| `mix-blend-mode` | ❌ 别用 | 需要回读 backdrop，与 backdrop-filter 同类病。用 `color-mix()` 有 95% 观感、0 成本 |
| `box-shadow` 动画 | ❌ 别用 | 每帧重绘且失效区域大于元素本身。正确做法：伪元素画一次静态阴影，只动 opacity/transform |
| `filter: blur` 动画 | ⚠️ 能上合成器但开销随半径快增 | 全屏元素上会掉帧。用两层（清晰/预模糊）交叉淡入代替 |
| 动画库 | ❌ **不引入** | 入口 chunk 已 665KB/249KB gzip，而 LazyCharts 为省 107KB 特意懒加载。Framer Motion 现实落点 50–60KB gzip **且无法懒加载**（动画组件在顶层外壳上）。**自己写约 150 行**：`animate()` / `useFlip()` / `withViewTransition()` / `haptics`，总成本约 1KB。`linear()` easing（Chrome 113+）可在构建期生成弹簧曲线字符串 |

### 7.3 合成器安全 / 危险属性

- ✅ **安全**（不触发 layout/paint）：`transform`（含独立 `translate`/`rotate`/`scale`）、`opacity`。
- ⚠️ 能上合成器但有开销：`filter`、`backdrop-filter`。
- ❌ **触发 Layout**：`width` `height` `padding` `margin` `top/left/right/bottom` `border-width`
  `font-size` `line-height` `flex-*` `grid-template-*` `gap` `position` `display`。
- ❌ **触发 Paint**：`background-*` `color` `border-color` `border-radius` `box-shadow`
  `text-shadow` `clip-path` `mask-*` `mix-blend-mode`。

**零工具判定法**：动画播放中在 Console 粘
`const t=performance.now(); while(performance.now()-t<1500){}`。
**动画在这 1.5 秒主线程冻结中继续流畅 = 在合成器上；卡住 = 不在。**

`will-change` 只在动画开始前加、`finished` 后立刻删（常驻会吃显存，中低端机几十个常驻图层会撑爆纹理内存）。

### 7.4 已知待办（非动效，但会咬人）

- `android/app/src/main/assets/public/` 的产物**比 `dist/` 旧**（文件哈希对不上，且缺 
  Dashboard/LazyCharts/PlanTab 等懒加载 chunk）。**出包前必须 `npx cap sync`。**
- `manifest.json` 图标指向 `https://img.icons8.com/...`，离线拿不到，换本地文件。
- `.env.local` 的 `VITE_API_KEY`（prod）需换成 NAS 迁移后的新 key，否则 `build:release` 出的 APK 对
  `/api/fitlog/state` 会 403（日常开发走 dev key 不受影响）。
- `.env.local` 里 `VITE_SUPABASE_*` / `VITE_GEMINI_API_KEY` / `FITLOG_API_KEY_DEV` 是遗留，可清。

---

## 8. 落地顺序

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | 令牌层：颜色/圆角/阴影/动效时长全部收进 CSS 变量，`tailwind.config.js` 改引用 `var()`；补齐语义色第二层；tertiary 提到 AA | ✅ 已完成 |
| **P1** | 修三类死 bug（20 个文件的死动画类、4 处 `max-sm`、72 处 `text-white`）+ **换中文字体栈（自托管子集）** | ✅ 已完成 |
| **P2** | 录入核心：SetCapsule 账本行（14px→26px）、ExerciseCard 刊头版式、长按进度 + 标签 | ✅ 已完成 |
| **P3** | 弹窗收拢：`Modal` 原语（center/sheet/full）+ 15 个 modal 迁移 + z 轴收敛 + 圆角迁移第二步 | ✅ 已完成 |
| **P4** | 图表与热力图：调色板收敛、末点常驻读数、PR 参考线、热力图自绘 | ✅ 已完成 |
| **P5** | 动效与签名时刻：`prDetect.ts` + 刊末页 + PR 盖章 + 数字滚动 + 退场动画 | ✅ 已完成 |

**验收标准**：随手打开任意组件文件，搜不到 `transition-all`、`active:scale-9`、
`duration-[0-9]`、`animate-in`；搜到的每个时长都是六个令牌之一，每条缓动都是四个令牌之一。

**实测（P5 完成时）**：`transition-all` 0 / `active:scale-9*` 0 / `duration-[数字]` 0 /
`animate-in` 0 / `text-white` 0 / `z-[数字]` 0 / 裸 `rounded-2xl|xl|lg|md|sm` 0。
`transitionDuration.DEFAULT` 与 `transitionTimingFunction.DEFAULT` 也指向令牌，
所以连没写 duration 的 `transition-*` 都落在六个令牌里，不必为此再扫一遍 className。

---

## 9. PR 检测（P5 的前置，现在完全不存在）

`useExerciseStats.bestLifts` 已算了「历史最大单组重量」，但**保存流程完全不调用它**。

判定口径（必须写死，否则仪式会贬值）：

| 规则 | 内容 |
|---|---|
| weight | 该动作历史 `max(sets.weight)`，本次更大 → PR |
| volume | 该动作**单次训练**总容量 `Σ(weight × reps)`，本次更大 → PR |
| reps | **仅**当 activeMetrics 不含 weight（自重类）时启用 |
| 历史为空 | **不算 PR**（否则第一次训练全是 PR，签名时刻当场贬值） |
| 编辑旧训练 | `editingWorkoutId !== null` 时**不触发**（在改历史，语义混乱） |
| 同时命中 | weight 优先于 volume（更硬） |
| 阈值 | 提升 < 0.5kg **或** < 1% 不算（挡住 kg⇄lbs 换算的浮点噪声反复触发） |
| 数量上限 | **最多 2 枚印**；>2 时第一枚取提升幅度最大者，第二枚合并为「另 N 项刷新」 |

> **非 PR 日也必须有收尾。** 90% 的训练不刷 PR，只为 PR 设计仪式是原方案最大的功能性空白。
> 刊末页与 PR 盖章共用同一套组件，PR 时才升级为完整盖章序列。

---

## 10. 已定的决策 / 待验证项

### 实现期新增的几条硬约束（都是踩过才写下来的）

- **Modal 必须 portal 到 body。** z-index 只在同一层叠上下文里比较，
  而页面里到处是会建层叠上下文的东西（opacity 动画、transform、backdrop-filter）。
  就地渲染时 PlanTab 根节点的 `animate-fade-in` 把 z-100 的弹窗关进了局部上下文，
  底部导航（z-50，全局层）直接盖住保存按钮。
- **任何动 transform 的包装层里都不能塞 `position: fixed` 子元素。**
  带 transform 的元素会成为 fixed 后代的包含块，`inset-0` 会改为对着它解析。
  NewWorkoutTab 踩过：弹层被顶出视口。
- **带透明度的令牌类曾全是死类。** Tailwind 3 遇到纯字符串颜色会静默丢弃
  `/透明度` 修饰符，全库 82 处一条 CSS 都没生成过。已用 `color-mix` 颜色函数修复。
  这也是 §7.1「删 backdrop-blur」的前置条件——修之前那两个栏实测 0% 不透明。
- **rAF 可能一帧都不跑**（页面没在合成帧 / WebView 被切后台），数字滚动必须有超时兜底，
  否则读数会永远停在起始值，看起来就是「算错了」。
- **dev server 不会重载 `tailwind.config.js`。** 改完 config 必须重启，
  否则新工具类全部静默失效，而 e2e 跑的正是 dev server——绿是虚的。
  另：连续多次写同一文件时 Vite watcher 会漏掉最后一次转译，需 touch 触发失效。

### 已定

- ✅ 主方向：**A 墨与纸**（评审 39 分，反 generic 最彻底）
- ✅ PR 印章：**方案 A · 落章**（从上方落下带过冲；已排除方案 B「硬切 + 印泥渗开」）
- ✅ 递减子组默认值：**重量 −20%（取整 0.5kg）、次数同母组**（旧默认「重量不变、次数 −5」已修，见 `SetCapsule.tsx`）
- ✅ 长按只承载低频动作，且**必须带自我解释标签**
- ✅ 不装 `tailwindcss-animate`，不引入动画库
- ✅ 中文文案语气：去命令式，改陈述与肯定（「今天多记住了一点」而非「训练已保存」）

### 待真机验证

- 长按加子组：标签方案够不够；若仍别扭，退路是挪进 ⚙ 动作设置弹窗（可发现性高一档，代价是多点两下）
- 朱砂同时作品牌色与危险色：若实测别扭，accent 退为墨青 `#3C5A62`
- 暖色深色主题（`#14120F`）在部分廉价屏上会偏绿
- 纸感语言在组间休息、力竭前最后一组这类高肾上腺素时刻是否显得太文雅
  （对冲手段是 26px 大数字与朱砂印章两处「重击」；若不够，计时器单独开一套更强的视觉）

---

## 11. 实现时反复踩到的坑（真实教训）

1. **同一元素上两个动画会打架。** 本轮样机里踩了三次：
   `.row.struck` 被 `.row.entering` 盖住（划掉线看不见）；
   `.ex.flash` 被 `.sheet.on .ex` 盖住（渗墨看不见，因为后者选择器权重更高）。
   → 入场动画结束后**摘掉 entering 类**；反馈类动画的选择器权重要显式压过入场规则。
2. **Chrome 的滚动锚定（scroll anchoring）会让页面莫名漂移。**
   往一个滚动容器里插入行时，即使不调用任何滚动 API，页面也会自己往下跳一行的高度。
   → 容器加 `overflow-anchor: none`。
3. **`rAF` 与 CSS 过渡在隐藏标签页里不推进。** 调试时若发现动画「不动」，先查 `document.visibilityState`。

---

## 12. P5 之后（操作层）

P0–P5 解决的是**视觉层**。本节记的是之后往**操作层**加的东西 ——
诊断是：风格全长在「响应层」（你做一个通用动作 → App 用墨与纸的方式回应），
动词本身一个都没变。实测佐证：`onClick` 176 处，`onPointerMove` **2** 处。

> §0 硬约束 3 当初写的是「交互骨架保留不动」。那时划得对（要先解决 SaaS 感）。
> 本节是有意解冻那一层。

### 12.1 训练部位选择（进页第一步）

点加号 → 空白页先问「今天练哪里」→ 六选一 → 名称自动填好 → 正常加动作。
移除了原来「进页 120ms 后自动弹动作选择器」。

**图标＝六枚朱文印**：胸 / 肩 / 背 / 腿 / 臂 / **制**。
前五枚取标签里区别性的那个字；「其他」取「制」（自制／自定）。
三列两行铺成一版，像一页印谱。

⚠️ **Ma Shan Zheng 只有 7015 字，是纯简体字库。**
想用的其实是「擬」（自拟其题，草案意味正好呼应虚线印框），但它不在字库里 ——
擬 設 別 創 約 號 題 一概没有，只有对应的简化字。选「制」还有一个额外好处：
它繁简同形，和 胸肩背腿臂 一样没有简化字的时代感，整版在字形上是一致的。
**挑印文之前先查源字体的 cmap**，别等上机才发现掉回了黑体。

走到这一步试过两版，都留在 git 里：

1. **手绘示意人形**（提交 b63ca51）—— 五个部位靠几根示意线区分，
   胸和背几乎只能靠一条脊柱线分辨。是「能认出来」，不是「设计过」。
2. **真实解剖人形**（提交 00da68a）—— react-native-body-highlighter 的肌群路径（MIT），
   专业、准确，但 60px 下人形只是一层灰底噪、朱砂块浮在上面，
   读起来是「一张医学示意图」，不是这个 App 自己的东西。

印章赢在它是**这套语言里已经存在的符号**，用它说话不需要翻译。

⚠️ **印章出现第二处就有稀释签名时刻的风险**，靠刻法分开 ——
这是刻印里真实存在的阴刻／阳刻之别：

| | PR 落章 | 部位印 |
|---|---|---|
| 形制 | 白文（实心朱砂底、字挖成纸色） | 朱文（纸底、朱砂框、朱砂字） |
| 尺寸姿态 | 64×64、旋转 -4°、落章过冲 | 52×52、正置、静止 |
| 频率 | 极罕见 | 每次开练 |

⚠️ **加印文必须同时改 `SEAL_CHARS` 并重跑 `npm run build:fonts`。**
Ma Shan Zheng 是按字切的子集，漏了这步字会静默掉回系统黑体。

⚠️ **印章字体必须 `font-display: block` 且预加载，不能用 `optional`。**
`optional` 的语义是「没赶上极短的阻塞窗口就整页用回退字体、且永不替换」——
正文该这样，但印章的全部意义就是那个字形，落成黑体等于这个设计没了。
实测踩过：重建子集后手机首次加载，六枚印全是黑体；
同样的道理，**PR 那枚落章在冷启动时多半也一直是黑体**，只是太罕见没被发现。

**何时询问**（四个条件缺一不可）：还没有动作 / 不是在编辑旧训练 /
标题为空（从计划开始的训练已带名字）/ 本次还没选过。
第四条存**训练 id** 而不是布尔值：换一次训练自然重新问，
而本次中途把动作删光不会把已选过的界面又弹回来。

### 12.2 力竭标记

`SetLog.toFailure?: boolean`。渐进超负荷唯一可靠的信号，此前完全没记。

**它和 PR 印章不是一类事实，所以不共用一套语言：**

| | 力竭 | 破 PR |
|---|---|---|
| 谁判定 | **你上报** —— App 算不出「你是不是真推不动了」 | **系统判定** —— 你没按任何按钮，是举起来的 |
| 配得上什么 | 一个**记号**（眉批式朱砂「竭」） | 一场**仪式**（落章） |
| 可逆 | 是，再点一次取消 | 否 |

> **仪式感属于「事实的产生」，不属于「界面的操作」。**
> 仪式一旦可以被主动触发，就退化成装饰 —— 这是印章成立而别处不成立的原因。

**做成可见开关，不做隐藏手势**：它是用户上报的数据，本来就该像别的字段一样看得见；
且这一行的两个长按（组号加子组、减号删组）都已占用，第三个长按语义会打架。
再点一次取消 —— 删组不可逆所以必须长按 400ms，力竭可逆所以点一下就够。

⚠️ 字形用 `font-display` 不是 `font-seal`：Ma Shan Zheng 的子集只切了
`SEAL_CHARS`（`'记破新纪录今天多住了一点'`），**没有「竭」**；且印章字体该留给印章本身。
加中文字要跑 `npm run build:fonts`（`collectCharset()` 扫源码），
**dev server 不会自动重建子集**，不跑这步手机上会掉回系统字体。

**列宽**：`36px repeat(N, minmax(0,1fr)) [36|26]px 44px`。
力竭列不取 44（两个 44 并排挤爆指标列）；N≥3 时收到 26 ——
那种配置在 375px 上**本来就装不下**（26px 的「102.5」要 78px，
3 指标每列只有 79px、输入框约 64px，加这一列之前就已在溢出）。
`1fr` → `minmax(0,1fr)`：1fr 的自动最小值是 min-content，数字撑不下时整行会横向溢出。

### 12.3 重量横向拖动改值

整个重量格就是 scrub 区：点一下照旧聚焦输入框（键盘路径没变），横向拖则改值。
**每 10px 落一档，档位由速度决定：1 / 2 / 5 / 10。**
甩得快是双重加成（触发的档位更多、每档也更值钱），慢下来立刻回到 ×1，
末端精调不用切模式。步长按**显示单位**走，kg 里的 1 就是 1kg，不做换算。

不做独立轨道：行只有 52px 高、列宽已吃紧，切轨道要么挤指标列要么撑高行，
两个都撞硬约束 1。整格当热区是唯一零成本的位置，且零永久视觉噪音 ——
刻度与档位角标只在拖动时长出来。

⚠️ 三个必须做的兜底：

1. **横向位移 ≥12px 才认定是拖动**，不是常见的 6。这个热区同时是输入框的点击区，
   出汗手滑时一次「点」很容易带出 6px 位移，误判成 scrub 的代价是把重量改错。
2. **`touch-action: pan-y` 而不是 `none`** —— 整个截掉会让手指落在重量上时列表滚不动。
3. **吞掉拖完那次 click 要用时间戳，不能用布尔开关。** 布尔开关是粘滞的：
   手势若以 `pointercancel` 结束（来电、系统手势打断），后面根本没有 click 来清它，
   那个 `true` 会一直挂着，把用户**下一次**正常点击吃掉 —— 表现为「点重量没反应」，
   且极难复现。

⚠️ **速度计算里 `dt<1` 必须钳到 1。** 高刷屏上多次 move 可能落在同一毫秒，
`dt` 算 0 会把「甩得最快」读成「速度为 0」，档位当场掉回 ×1 —— 正好反了。

震动沿用 `haptic()` 自带的 55ms 全局去抖（§5.7 第 3 条），没有另加。
副作用：换档那记「确认感」可能被紧邻的档位震动吃掉，属去抖的固有取舍。

**待真机调**：速度阈值 `0.55 / 1.3 / 2.5` px/ms 是按台机手感定的初值，
真机手速与屏幕密度不同。

### 12.4 已否决

- **滑动划掉一组**：保留点击。让人为一个已有明确入口的低频操作走一段距离，收益是零。
  手势化的收益来自**隐喻贴合度**，不是省一次点击。
- **组间休息计时器**：做过，不好用，已删。不要再提。
