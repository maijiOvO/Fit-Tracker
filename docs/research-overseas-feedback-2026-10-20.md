# 海外用户一手反馈：力量训练记录 App（2026-10-20）

> 目的：用英语圈用户的原话，验证或推翻 [market-research-2026-10-20.md](market-research-2026-10-20.md) 的判断。国内（训记等）另做。
> 结论先行，证据在后。引用都是**原文节选**（≤20 词，`…` 表示有删节），每条附链接。

## 0. 结论

1. **「一个动作在不同馆的器械上重量对不上」是真需求，而且正在升温**：2026 年 7–10 月，光 r/Hevy 一个版块就有约 25 条独立的帖子和评论提这件事。大家的变通办法都一样：把同一个动作复制成「Leg Press (gym80)」「Leg Press (TechnoGym)」几份，自己也说笨。
   **点赞数也证实了它不是小众诉求**：
   - 「换馆换器械后能重置 PR」一帖拿到 210 赞，置顶评论 106 赞；
   - Hevy 2025-09 的功能请求汇总帖里，「让我选今天在哪个馆」是第 4 高赞的请求（100 赞）。
   **但窗口在收窄**：Hevy 产品负责人 2026-07 公开说下一步要做「按馆算 PR」，2026-07 底已经上线了「给训练打馆标签」。不过截至 2026-09，用户说这个标签**只是装饰，不影响统计**。fitlog 的「器械纪录只和同馆比」现在仍是独一份，但别指望一直独占。
2. **用户最在意的是「别丢我的数据」和「别为基础功能收订阅」**。两者在 Google Play 低星评论里各有上百条。Strong 2025-03 强制改成账号制后，一批人多年的记录被清空。反过来，**纯本地的 FitNotes 也被骂过：用户换手机才发现备份要手动**。所以光有「不注册、本地存」还不够，**自动备份必须显眼**。
3. **AI 和社交在老练用户里普遍招嫌，但不至于劝退**。真正被反复夸的是：数字键盘直接输入、上次数值就在旁边、点一下完成一组。
4. **配片计算、自定义杠铃重、按器械设递增量、kg/lb 混用**：主动提的人不多（每个 App 个位数到十几条），但提的人都很具体、也很恼火。连 Strong 这种老牌 App 都在 2025 年改版时把杠铃重做坏过，而且到 2026 年 iOS 上还没有能用的配片计算。
   fitlog 的「就近取整到能挂出来的数」正好打中 Hevy 用户的一条原帖：「我只勾了 5 kg 以上的片，它还推荐 52.5」。

**对 fitlog 的一句话**：主打「换馆不乱账」，用「不注册 + 自动备份 + 导入 Strong/Hevy CSV」接住流失用户。不要上 AI 和社交。

## 1. 数据与方法

| 来源 | 量 | 一手 / 二手 | 说明 |
|---|---|---|---|
| Google Play 评论 | 6 个 App 共 4456 条（Strong 855、Hevy 940、FitNotes 901、JEFIT 875、Boostcamp 668、Liftosaur 217） | 一手 | 每个 App 取最新 400 条，再加 1/2/3 星各最新 200 条，**刻意偏向低星**。计数反映「抱怨什么」，不代表抱怨占多大比例。Liftosaur 低星总共只有 15 条 |
| Reddit 帖子 | 2314 帖（2023-01 起，17 个版块按标题关键词检索），其中 949 帖有正文 | 一手 | Reddit 官方接口和内置浏览器都打不开；Claude in Chrome 扩展这次没连上，所以改走 Arctic Shift 的公开存档接口 |
| Reddit 评论 | 讨论最多的 70 个记录器相关帖，共 3604 条有效评论；另按正文关键词补搜（different gyms、plate calculator、lifetime 等）约 800 条 | 一手 | 接口限流严重，**r/weightroom、r/homegym 覆盖很薄**，r/Hevy、r/strongapp、r/workout 最厚 |
| Reddit RSS（第二轮补抓） | 3083 帖（9 个版块 × 6–14 个查询，按相关度排序，带正文）：Fitness 509、xxfitness 462、weightroom 461、powerlifting 346、androidapps 335、fitness30plus 309、homegym 260、naturalbodybuilding 248、strongapp 153 | 一手 | 用 Reddit 公开的 search.rss 接口，不登录时约每分钟 1 次请求就 429，只能慢速抓。按相关度排序会捞回大量 2012–2018 的老帖；r/weightroom 的帖子正文几乎不聊 App（App 话题在每日讨论帖的评论里，RSS 抓不到） |
| Reddit 手动存档（第三轮） | 12 个关键帖，588 条评论 | 一手 | 作者用 old.reddit 手动存网页，由我解析；评论是完整的，点赞数可用 |
| Hacker News | Algolia 接口，5186 条评论，筛出 608 条跟举铁有关 | 一手 | 噪音大，计数只看量级 |
| Indie Hackers | 2 帖（内置浏览器打开；直接请求返回 403） | 二手为主 | 内容基本是开发者自述加客套评论，用户原声极少，只取作旁证（见 2.13） |
| App Store 美区 | — | — | 之前已拉过 Strong、Hevy 各 500 条，这次没重复 |

**计数方法**：每个主题一条关键词正则。一条评论只要命中，就在这个主题下记 1 次。配片、单位、丢数据这几个词比较精确；「安卓/iOS」「社交」偏宽，只当参考。
Reddit 计数里**混着大量开发者自荐帖**（r/workout 尤其多），所以引用时只挑用户原话。

## 2. 痛点（按对 fitlog 的相关度排序）

次数格式：`GP x`＝Google Play 命中条数（大多是 ≤3 星）；`RD x`＝Reddit 帖子正文加评论命中；`HN x`。

### 2.1 同一个动作，各馆器械重量对不上 ★ fitlog 的主场

**次数**：r/Hevy 2026-07 至 10 月约 25 条独立提及（另有 4 个专门发帖）；r/powerlifting、r/homegym 各有零星几条；GP 不到 5 条。量不大，**但在 2026 年明显变多**，起因是 Hevy 上线了馆标签。

- 「At gym A I can do 250lbs. At gym B I can barely do 100lbs. So it's skewing my data」
  —— [r/Hevy 2026-07](https://www.reddit.com/r/Hevy/comments/1umaz02/_/oxbkwlc/)
- 「mixing two different leg press machines into one PR history genuinely breaks the data」
  —— [r/Hevy 2026-09](https://www.reddit.com/r/Hevy/comments/1wgt98j/_/pakwqpt/)
- 「There's got to be a better way… than setting up an entirely new exercise for each gym」
  —— [r/Hevy 2026-09](https://www.reddit.com/r/Hevy/comments/1wgxesa/_/pa3xju1/)
- 「the app should show my previous weight/reps/rpe for the machine at that gym」
  —— [r/homegym 2026-10](https://www.reddit.com/r/homegym/comments/1wzz28i/_/pegc1lv/)
- 「the poundage doesn't translate from brand to brand, or even the same brand at different gyms」
  —— [r/powerlifting 2026-06](https://www.reddit.com/r/powerlifting/comments/1ujf2ef/_/ouoeu9l/)
- 原帖 [We should have an option to reset PRs (changing gyms and machines)](https://www.reddit.com/r/Hevy/comments/1w1qekz/)（**210 赞**，约 37 条评论，2026-08）：换了台更重的高位下拉，PR「可能一年都破不了」。评论区：
  - 置顶（106 赞）：「This has been said before and I'm astonished it hasn't been implemented」（[p6msupg](https://www.reddit.com/r/Hevy/comments/1w1qekz/_/p6msupg/)）
  - 「I built a home gym so all my machines are different. I feel like I will never see another PR」（38 赞，[p6ndhei](https://www.reddit.com/r/Hevy/comments/1w1qekz/_/p6ndhei/)）
  - 「my max weight went from 190lbs to 40lbs」——新馆没有同款卷腹机（14 赞，[p6np1lb](https://www.reddit.com/r/Hevy/comments/1w1qekz/_/p6np1lb/)）
  - 有人提折中方案：保留终身 PR，另设一个可随时重置的「阶段最佳」（14 赞，[p6rd3bk](https://www.reddit.com/r/Hevy/comments/1w1qekz/_/p6rd3bk/)）
  - 更极端的做法：「my friend has deleted and recreated his account at least 3 times」（[p6r7mf5](https://www.reddit.com/r/Hevy/comments/1w1qekz/_/p6r7mf5/)）
- Hevy 功能请求汇总帖（[1n6ohrp](https://www.reddit.com/r/Hevy/comments/1n6ohrp/)，2025-09，188 条评论，联合创始人发起）：
  - 第 4 高赞（100 赞）：「I'd like to have "gym" Metadata… The cable machines at home are different than those at the gym」（[nc1pydz](https://www.reddit.com/r/Hevy/comments/1n6ohrp/_/nc1pydz/)）。Hevy 10 个月后上线了馆标签，可以看作对这条的回应。
  - 回复里有人认为该记的是**器械品牌**，不是馆：「not the gym is what matters but what machine (which manufacturer)」（15 赞，[nc33fxq](https://www.reddit.com/r/Hevy/comments/1n6ohrp/_/nc33fxq/)）。
- 「I use way different weights on the same machine at the two gyms I frequent」
  —— [r/Hevy 2026-07](https://www.reddit.com/r/Hevy/comments/1v8rx9k/_/p0drpjx/)
- 「I just changed gyms… Now I have new PRs that are not real」
  —— [r/Hevy 2026-09](https://www.reddit.com/r/Hevy/comments/1wgt98j/_/p9x8ic0/)
- 「50lbs in one cable machine is like 75 on another」（16 赞）
  —— [r/Hevy 2026-09](https://www.reddit.com/r/Hevy/comments/1wgxesa/_/p9xx39l/)
- Hevy 里一个不太为人知的变通：给每个馆建一套计划，把「上次数值」设成按计划取，就能看到「在这个馆上次多少」，不用复制动作（[p0gndvi](https://www.reddit.com/r/Hevy/comments/1v8rx9k/_/p0gndvi/)）。可见用户愿意折腾，说明需求真实。

**竞品动态**（一手，来自官方账号）：
- **Hevy 已上线馆标签**。2026-07-28 有用户发帖 [Woah gym feature is out!](https://www.reddit.com/r/Hevy/comments/1v8rx9k/)，评论里马上有人追问：这能把同一个动作在不同器械上的进度分开记吗，还是只是社交功能？
- **Hevy 的路线图**：产品负责人说下一步「we plan to set PRs per gym too」（[2026-07](https://www.reddit.com/r/Hevy/comments/1umaz02/_/oy4tn8b/)）；另一处原话是「maybe PRs per gym」（[2026-08](https://www.reddit.com/r/Hevy/comments/1vtp1v1/_/p4zs48g/)）。
- **到 2026-09 标签仍不影响数据**：用户发帖说它「purely cosmetic (shows on the post, no effect on stats or routines)」（[r/Hevy 2026-09](https://www.reddit.com/r/Hevy/comments/1wgt98j/)）。
  Hevy 官方在帖下回复（15 赞）：「the integration of gym selection / tagging into the workout experience is planned」（[p9x0pn0](https://www.reddit.com/r/Hevy/comments/1wgt98j/_/p9x0pn0/)）。
  馆的数据来自 Google 地图，家庭健身房只能选「private home gym」（[p0bjxho](https://www.reddit.com/r/Hevy/comments/1v8rx9k/_/p0bjxho/)），大学馆、楼里的馆经常搜不到。也就是说，**Hevy 的馆是「地点」，不是「器械档案」**。
- **Hevy 也是把馆当社交做的**：社区原帖想要「像 Instagram 那样给训练打地点」，好看谁在同一个馆练（[1v3pi77](https://www.reddit.com/r/Hevy/comments/1v3pi77/)）。
- **Alpha Progression 有 gym profiles**：每个馆可以隐藏没有的器械，并设定这个馆用 kg 还是 lb（[r/naturalbodybuilding 2025-09](https://www.reddit.com/r/naturalbodybuilding/comments/1n9il9c/_/ncrmoig/)）。之前的调研只点名了 MacroFactor Workouts，这里**再补一家**。
- **Fitbod 也有按馆的器械档案**：「I have a "Gym" setting and a "Garage" setting. I can even program what plates and dumbbell weights I own.」（[r/fitness30plus 2025-03](https://www.reddit.com/r/fitness30plus/comments/1jao2fa/_/mhntu2f/)）。常出差的用户也推荐它：「You can create profiles for the different gyms you frequent」（[r/xxfitness 2024-09](https://www.reddit.com/r/xxfitness/comments/1fskr95/_/lpl9mhk/)）。
  但 Fitbod 是 AI 排课 App（约 $99/年），器械档案是用来**生成训练**的，评论里没人提它会把纪录按馆分开。这家之前的调研没列，**要补进竞品表**。
- **HeavyTrack** 被提到能记「不同馆的器械变体」（[r/workout 2026-08](https://www.reddit.com/r/workout/comments/1vz0ltp/_/p6fkm45/)），但只有这一条，没核实。

**一位重度用户把下一步需求说得很清楚**：他常去 5 个馆，跨两个国家、两家连锁，自己用 Claude 写了个副业工具来管。他说器械要按阻力类型（挂片式 / 插销式）和品牌区分，否则「Impossible to do apples to apples」（[r/Hevy 2026-10](https://www.reddit.com/r/Hevy/comments/1vwg8lm/_/pgjafle/)）。

### 2.2 丢数据 / 同步 / 备份

**次数**：GP 250 条（Strong 62、JEFIT 63、FitNotes 53、Hevy 42、Boostcamp 28，均 ≤3 星）；RD 约 30；HN 32。这是**情绪最重**的主题。

- Strong 2025-03 强制改用账号，17 条评论集中在 3 月 4–5 日。例：「when I signed back into my account it was empty. Lost over 800 workouts」
  —— [GP Strong 1★ 2025-03-04](https://play.google.com/store/apps/details?id=io.strongapp.strong)（reviewId `37d9a4fc…`）
- 「app went to sync and lost 9 years of workouts」
  —— [GP JEFIT 3★ 2023-07](https://play.google.com/store/apps/details?id=je.fit)（`76419753…`）
- **本地 App 的反面教训**：「I lost all of my FitNote history… I was not aware this app has a manual back-up」
  —— [GP FitNotes 2★ 2021-03](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes)（`241991c1…`）
- **App 关停**也会把数据带走：「That app is now gone and so is all the data」
  —— [r/workout 2026-01](https://www.reddit.com/r/workout/comments/1qaycxs/_/nzdapod/)
- Hevy 退订后历史就看不到了：「unsubscribing has caused me to lose my entire workout history」
  —— [GP Hevy 1★ 2024-12](https://play.google.com/store/apps/details?id=com.hevy)（`0f13af20…`）

### 2.3 付费墙 / 订阅 vs 买断

**次数**：GP 447 条 ≤3 星（Strong 124、Boostcamp 107、JEFIT 103、Hevy 85），是**体量最大的主题**；RD 约 500 条（帖子 240 + 评论 259，含大量正面讨论）；HN 56。

- **基础功能被锁最招恨**：「The plate calculator was always free but… they close that off behind a paywall」
  —— [GP Boostcamp 1★ 2023-11](https://play.google.com/store/apps/details?id=com.bpmhealth.boostcamp)（`62f2fc71…`）
- 「I would be totally fine paying a premium 1 time fee」（145 人点赞）
  —— [GP Strong 3★ 2021-10](https://play.google.com/store/apps/details?id=io.strongapp.strong)（`5c79be64…`）
- **买断是 Hevy 用户付费的主要理由**：「Wouldn't have upgraded if it was a recurring subscription, but the lifetime plan was a no-brainer」
  —— [r/Hevy 2026-07](https://www.reddit.com/r/Hevy/comments/1uz2rpw/_/oy84icx/)
- 「Free only tracks your progress for 3 months and the limited (10) custom movements quickly fills up」
  —— [r/Hevy 2026-09](https://www.reddit.com/r/Hevy/comments/1wsct5c/_/pckee7h/)
- **跟 2.1 联动**：好几位 Hevy 用户说，买 Pro 是**为了给每个馆建一套动作和计划**（[pgr9fvc](https://www.reddit.com/r/Hevy/comments/1x5qt9q/_/pgr9fvc/)、[pacuzl7](https://www.reddit.com/r/Hevy/comments/1wihy7h/_/pacuzl7/)）。换句话说，多馆用户正撞在 Hevy 的免费上限上。
- **为「算法排课」付高价最招嘲讽**：帖子「The RP hypertrophy app costs more than my gym membership」下，最高赞评论是「This shit isn't that complicated.」（486 赞），其次是「the app isn't priced toward people who know how much they spend on a gym membership」（197 赞）
  —— [r/naturalbodybuilding 2025-03](https://www.reddit.com/r/naturalbodybuilding/comments/1j15v73/)。帖下替代品被提得最多的是 Liftin'（11 次）、Strong（10）、Excel 和表格（17）、Hevy（8）。
  也就是说，老练用户愿意为**好用的记录器**付钱，不愿为「帮我算加多少」付高价。fitlog 的就近取整是记录的一部分，不是算法教练，这个定位要守住。
- **价格参考**（一手，用户原话）：Hevy 买断约 $75；Strong 买断 $99–100，年付 $30。

### 2.4 配片计算 / 杠铃重 / 递增量 / 就近取整 ★ fitlog 的主场

**次数**：GP 配片和杠铃重约 27 条（宽口径），递增量约 13 条；RD 约 40 条（含 r/strongapp 20 条配片讨论）；HN 约 20 条。

- 「I only have plates from 5 kg upwards selected… but the auto-increments still suggest weights ending in .5」
  —— [r/Hevy 2026-10](https://www.reddit.com/r/Hevy/comments/1wxl7b0/)（原帖。**这正是 fitlog 就近取整解决的事**）
- 「None of my bars has a common weight (17kg, 25kg, etc) making the plate calculator worthless」
  —— [r/strongapp 2026-08](https://www.reddit.com/r/strongapp/comments/1vho3ob/_/p26w4uy/)
- 「crazy a basic feature like a functioning plate calculator is missing for iOS in 2026」
  —— [r/strongapp 2026-08](https://www.reddit.com/r/strongapp/comments/1vho3ob/_/p28s8zf/)
- 「removed the weight of the default bars so the plate load is completely incorrect」
  —— [GP Strong 1★ 2025-02](https://play.google.com/store/apps/details?id=io.strongapp.strong)（`e3591202…`）
- 「It regularly suggests increasing weight… in increments that are not possible for my equipment」
  —— [r/naturalbodybuilding 2025-01](https://www.reddit.com/r/naturalbodybuilding/comments/1i2qkw2/_/m7glf05/)（说的是 RP Hypertrophy）
- 「machines at the old school gym… only progress in 5kg increments」
  —— [GP Hevy 5★ 2026-10](https://play.google.com/store/apps/details?id=com.hevy)（`a7ba45bf…`）
- 「I have 2.25kg plates, that are not listed」
  —— [GP Strong 2★ 2020-01](https://play.google.com/store/apps/details?id=io.strongapp.strong)（`d8cf7463…`）
- 「When training in multiple gyms, Smith machine bars often vary in weight」——所以配片计算不准
  —— [r/strongapp 2025-07](https://www.reddit.com/r/strongapp/comments/1m0q2b5/)（功能请求原帖，提议「按动作设杠重」）
- 「the ability to add custom bars like my 52 lb trap bar」，还想要半磅片
  —— [r/strongapp 2025-01](https://www.reddit.com/r/strongapp/comments/1ht50x6/)
- 器械也有「空载重量」：「the leg press machine at my gym has a starting weight of 136lbs… so I dont look like an idiot, counting on my fingers」
  —— [r/Hevy 功能请求汇总帖 2025-09](https://www.reddit.com/r/Hevy/comments/1n6ohrp/_/nc4divn/)（Hevy 有杠铃预设，器械没有）
- Strong 的自定义杠重**安卓版已经有、iOS 还没有**（帖下用户贴图确认）
  —— [r/strongapp 2025-07](https://www.reddit.com/r/strongapp/comments/1m0q2b5/_/n3cuv5y/)。另一条评论：「SSB's, trap bars, axle bars, etc. all have different weights」（[n3b7stu](https://www.reddit.com/r/strongapp/comments/1m0q2b5/_/n3b7stu/)）
- 付了 Pro，训练到一半配片计算弹出升级提示：「get a pop up telling me I need to upgrade」
  —— [r/strongapp 2025-12](https://www.reddit.com/r/strongapp/comments/1ptxjvb/)（说明配片计算在训练中途是被频繁用到的）

### 2.5 kg / lb 混用

**次数**：GP 约 10 条，RD 约 10 条（第二轮 RSS 在 r/strongapp 又找到 4 条原帖），HN 3 条。量小，但场景很清楚：同一个馆里哑铃是 kg、器械是 lb；两个馆一个 kg 一个 lb；或者人在出差。

> **修正第一版**：Strong 和 Hevy 其实都支持**按动作**单独设单位，Strong 还能把已有记录实时换算。之前写的「主流是全局单位」不准确，只有 JEFIT 等是全局单位。
> fitlog 的真正差别是：单位跟着**馆和片子**走，而不是跟着动作走。同一个动作在 lb 馆记 lb、在 kg 馆记 kg，用户不用自己切。

- 「I work out at two different gyms. One uses pounds and one uses kg.」
  —— [r/strongapp 2024-08](https://www.reddit.com/r/strongapp/comments/1ey40ro/)（他喜欢 Strong 的实时换算，但嫌 Strong 别的地方，想找替代）
- 「all the dumbbells and machines are measured in pounds. However, we have calibrated kilo plates」
  —— [r/strongapp 2023-01](https://www.reddit.com/r/strongapp/comments/1044bcu/)
- **导出的坑**：「the csv file does not include a column for weight units」，导进 Hevy 后 lb 全被当成了 kg
  —— [r/strongapp 2026-03](https://www.reddit.com/r/strongapp/comments/1rpmgqy/)
- 老帖但场景典型：新馆全是 kg 片，JEFIT 只能按 5 lb 加，「I end up with 89 lbs」
  —— [r/Fitness 2015-10](https://www.reddit.com/r/Fitness/comments/3qa5wo/)

- 「all the dumbbells in my gym are in kilograms and all the machine plates in pounds」
  —— [GP FitNotes 3★ 2016](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes)（`7e922050…`）
- 「Lat pulldowns in Gym A is in lbs. Gym B is in kilograms」
  —— [r/Hevy 2026-10](https://www.reddit.com/r/Hevy/comments/1n6ohrp/_/pgokewh/)（功能请求汇总帖）
- 「if you change the system it doesn't convert, it just changes the label」
  —— [GP JEFIT 3★ 2024-01](https://play.google.com/store/apps/details?id=je.fit)（`13afdb7e…`）
- 「I switch between kg and lbs, based off the plates at the powerlifting gym」
  —— [r/strongapp 2023-08](https://www.reddit.com/r/strongapp/comments/146f6u7/_/jx5b426/)（这位用户说 Hevy 能按动作单独设单位，所以换了过去）

### 2.6 录一组要点几下 / 输入方式

**次数**：GP 约 75 条 ≤3 星（多为「更新后变麻烦」）；RD 约 100 条；HN 14。

- 「only Strong uses a number keypad instead of a wheel picker」——这是 Strong 老用户不走的理由
  —— [r/strongapp 2024-07](https://www.reddit.com/r/strongapp/comments/1e2ay2j/_/ld0xkvc/)
- 「Went from 1 click notes to 2 clicks now 3 clicks to get to a note」
  —— [GP JEFIT 2★ 2024-01](https://play.google.com/store/apps/details?id=je.fit)（`11eb0c43…`）
- 「show the last session's weight/reps right beside today's entry, let me correct an accidental tap」
  —— [r/workout 2026-10](https://www.reddit.com/r/workout/comments/1x6j7i2/_/pgw8t44/)
- 递减组难记：「a "3 sets" exercise can turn into 6-9 logged entries」
  —— [r/Hevy 2026-07](https://www.reddit.com/r/Hevy/comments/1umaz02/_/oxqkn1a/)（Hevy 官方回复：暂无计划）

### 2.7 离线 / 不注册 / 隐私

**次数**：GP 57 条 ≤3 星；RD 约 250 条（多数集中在 2026-09 Hevy 隐私政策更新那一帖）；HN 22。

- 「I can't even use this anymore because my new gym has bad reception」
  —— [GP Boostcamp 1★ 2025-02](https://play.google.com/store/apps/details?id=com.bpmhealth.boostcamp)（`bd3e6191…`）
- 「The point of privacy is consent and control, not having nothing to hide」
  —— [r/Hevy 2026-09](https://www.reddit.com/r/Hevy/comments/1wuht7b/_/pd4lwd3/)
- 「No account, no ads, no analytics, no cloud sync… Backups are files you create and control」——用户这样夸一款同类 App
  —— [r/workout 2026-08](https://www.reddit.com/r/workout/comments/1vz0ltp/_/p632ean/)
- 「I like that there is no account signup」
  —— [GP FitNotes 4★ 2026-04](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes)（`1349b728…`）
- 安卓用户的求助帖几乎就是 fitlog 的需求清单：「without sharing my data with 3rd party? Not gamified, free or one pay, no AI.」
  —— [r/androidapps 2026-08](https://www.reddit.com/r/androidapps/comments/1vi9z4m/)
- **不同声音**：同一帖里也有高赞反问「what personal data are you putting on the Hevy app」（71 赞）。可见隐私是**一部分人**的硬需求，不是大众卖点。

### 2.8 导入 / 导出 / 换 App

**次数**：GP 约 24 条 ≤3 星；RD 约 200 条（大量是「Hevy 能导入 Strong」）；HN 31。

- 「All of these apps use their own data schemas」（这位用户最后改用纸笔）
  —— [HN 2025-02](https://news.ycombinator.com/item?id=43044880)
- 「Easy CSV import/export would make trying it much less of a commitment」
  —— [r/workout 2026-10](https://www.reddit.com/r/workout/comments/1x6j7i2/_/pgw8t44/)
- 「I could easily import my Strong history」——Hevy 从 Strong 挖人就靠这个
  —— [r/strongapp 2024-07](https://www.reddit.com/r/strongapp/comments/1e2ay2j/_/ld5vvr0/)
- 小 App 的标准打法：「You can import your Hevy data, so you can move all your history over」
  —— [r/Hevy 2026-10](https://www.reddit.com/r/Hevy/comments/1wuht7b/_/pdds70d/)（Ironside 开发者自荐，一次性 NZ$6.99）
- **Strong 的 CSV 不带单位列**（见 2.5）。混用 kg/lb 的人一导入就错，而他们恰恰是 fitlog 的目标用户。

### 2.9 AI 与社交：老练用户大多嫌弃

**次数**：AI——GP 48 条 ≤3 星（JEFIT 35）、RD 约 300 条、HN 29；社交——GP 62 条 ≤3 星、RD 约 400 条、HN 68。

- 「AI? Hell no… if they ever force this garbage into the app I'll go back to doing it on paper」
  —— [r/Hevy 2026-09](https://www.reddit.com/r/Hevy/comments/1wfyzjm/_/p9r2n9z/)
- 「moved to Caliber after the incessant asking to use this stupid AI features」
  —— [GP JEFIT 1★ 2026-06](https://play.google.com/store/apps/details?id=je.fit)（`2b65153d…`）
- 「I don't like the social media aspect of hevy. I only want an app where I can log」（30 赞）
  —— [r/strongapp 2025-04](https://www.reddit.com/r/strongapp/comments/1jwqf1o/_/mmkn7tr/)
- 「Why is this sub so full of adverts for shitty vibecoded apps with "AI features"?」
  —— [r/workout 2026-09](https://www.reddit.com/r/workout/comments/1wucxph/_/pd244fj/)
- **反例要承认**：Hevy 的 ChatGPT 插件帖（102 条评论）里也有高赞好评，比如「I have the agent review my perfromance after every workout」（[r/Hevy](https://www.reddit.com/r/Hevy/comments/1wjugci/_/palwdnf/)）。
  所以准确的说法是：**AI 做成可选的外挂可以，硬塞进记录流程不行**。

### 2.10 被弃养 / 开发停滞的担忧

**次数**：GP 8 条，RD 约 15 条，HN 5。几乎全指向 Strong（2023–2025 年的长 beta 期间）。

- 「A dead app that is no longer being developed but still asking for money」（47 赞）
  —— [GP Strong 2★ 2024-03](https://play.google.com/store/apps/details?id=io.strongapp.strong)（`6820216d…`）
- 「I paid lifetime for Strong… Strong just kind of stopped evolving」
  —— [r/strongapp 2025-06](https://www.reddit.com/r/strongapp/comments/1lfx7sp/_/mysxh6s/)
- 「apps change so often that I don't know if I can expect to be using this app」（所以对买断犹豫）
  —— [r/Hevy 2026-09](https://www.reddit.com/r/Hevy/comments/1wrjare/_/pcd9cjp/)
- **真实停服案例**：bodybuilding.com 的 BodySpace 直接停了，「I had over 500 workouts tracked and chronicled within this app」
  —— [r/fitness30plus 2025-02](https://www.reddit.com/r/fitness30plus/comments/1im7mvg/)。帖下推荐最多的是 Hevy 和 Strong，**没有人提「导出」**，这些数据大概率就没了。

### 2.11 安卓 vs iOS

**次数**：真正说「安卓版比 iOS 差」的评论只有约 10 条，基本都是 Strong（GP）。其余大多是要 Health Connect、Wear OS、Garmin 支持。

- 「Omg it's really bad on android. Better ios version」
  —— [GP Strong 2★ 2024-02](https://play.google.com/store/apps/details?id=io.strongapp.strong)（`4a84cc72…`）
- HN 上常见的分法是「iOS 用 Strong，安卓用 FitNotes」（[HN](https://news.ycombinator.com/item?id=44604611)）。
- Apple Watch 是 Strong 留住 iOS 用户的主要理由（多条高赞）。**安卓这边手表的需求弱得多**，这对 fitlog 有利。

### 2.12 广告、更新后出 bug（参考）

- **广告**：集中在 JEFIT（GP 38 条 ≤3 星）和 Boostcamp（16 条）。
- **更新后出 bug**：JEFIT 134 条、Boostcamp 133 条、Hevy 88 条、Strong 79 条（≤3 星，口径宽）。例：「I used to build my own workouts but they were all erased after the update」（[GP JEFIT 2★ 2024-08](https://play.google.com/store/apps/details?id=je.fit)，`913b03b6…`）。

### 2.13 Indie Hackers（旁证，二手为主）

- 独立开发者做的 Gym Log：作者说起因是「tired of fitness apps requiring accounts and subscriptions for things that felt basic」。他最后决定不收费，因为订阅制逼他去决定把什么锁起来（[IH 2026-08](https://www.indiehackers.com/post/i-built-a-workout-app-then-decided-i-didn-t-want-to-monetize-it-6uX1E25TZbZgmo1xaWeZ)）。
  评论区有人建议「Hold onto your core selling point: no accounts, no subscriptions」，但这类评论读起来像套话，参考价值有限。
- Liftosaur 作者 2023 年复盘：换 App 时「I lost all my history after switching to a new app」，这是他自己动手做的起因之一。
  获客方面他写道：在很多 subreddit 自荐都被封，在评论里低调提一句反而有效；用户大多来自 Reddit（[IH 2023-02](https://www.indiehackers.com/post/liftosaur-weightlifting-tracker-app-for-coders-0f2c1d3837)）。
  这对 fitlog 发布有直接参考：Reddit 上 r/workout 一类版块对「vibecoded 新 App」的自荐帖普遍反感（见 2.9）。

## 3. 想要、但没人做好的功能

| 需求 | 证据强度 | 现状 | fitlog |
|---|---|---|---|
| **按馆分开记器械历史和 PR**，进馆就显示「这台机器上次多少」 | 强（2026 年 r/Hevy 约 25 条；「重置 PR」帖 210 赞；汇总帖第 4 高赞） | Hevy 只有装饰性的馆标签，官方说「已计划」；Alpha Progression、Fitbod 有馆档案，但只用来筛器械、定单位、生成训练 | ✅ 已有（器械纪录同馆比） |
| 器械空载重量（腿举滑台 136 lb、史密斯杠） | 中 | Hevy 只有杠铃预设；Strong 的自定义杠只有安卓版有 | ⚠️ 杠可以选，短杠也能自己调重（`src/utils/plates.ts` 的 `barWeight`）；挂片式器械的空载重量没找到对应设置，待确认 |
| 「终身 PR」和「阶段最佳」分开 | 弱到中（一条 14 赞的提议） | 无 | ❌ 可以考虑：伤后恢复、换动作形式都用得上 |
| **自动重量取整到能挂出来的数** | 中（具体抱怨约 10 条） | Hevy 的可选片设置不影响建议重量；RP 会推荐挂不出来的数 | ✅ 已有（就近取整） |
| 自定义杠铃重（17 kg、25 kg、EZ 杠）、自定义片（2.25 kg、1.25 kg） | 中 | Strong 改版时做坏过，iOS 到 2026 年仍不完整 | ✅ 已有（馆档案里配片） |
| **按馆 / 按片子定单位**，切单位时真换算 | 中 | Strong、Hevy 能按动作设单位（Strong 还能实时换算），但同一个动作换馆还得手动切；JEFIT 切单位只改标签不换算 | ✅ 已有（单位就是片子，跟馆走） |
| 导入时保留单位（Strong 的 CSV 没有单位列） | 中 | 导进 Hevy 后 lb 全变 kg | ❌ 做导入时必须处理：按动作让用户确认单位，或按数值规律提示 |
| 器械要能按品牌 / 阻力类型区分（Matrix vs Technogym，挂片 vs 插销，滑轮 2:1） | 弱到中（重度用户提） | 都靠复制动作改名 | ⚠️ 部分有：馆内单台器械可以单独设，但没有「品牌 / 型号」字段 |
| 单次训练「不计入 PR / 统计」的开关（出差、测 1RM） | 中（Hevy 官方说常被提） | 无 | ❌ 没有 |
| 换馆、换器械后「重置 PR」 | 中（原帖 29 条评论） | 无 | ✅ 等价已有：器械纪录按馆分开 |
| 不注册，但**自动、显眼**的备份 | 强（两个方向的丢数据都有） | FitNotes 是手动备份；云端 App 强制账号 | ⚠️ 本地优先已有；公众用户的自动备份还缺（见上一份调研 3.1） |
| CSV 导入导出，尤其能导入 Strong / Hevy | 强 | Hevy 能导入 Strong；小 App 都靠「能导 Hevy」拉人 | ❌ 只有自家 JSON |
| 一组里记多个重量（递减组） | 弱到中 | Hevy 暂无计划 | ✅ 已有（递减档跟着记录走） |
| 买断价，核心功能免费 | 强 | Hevy 买断约 $75、Strong 买断 $99；免费版限制计划数 / 动作数 / 图表时长 | 待定（fitlog 目前全免费） |

## 4. 对 fitlog 的启示

1. **对外文案的第一句就讲「换馆不乱账」**。用户自己的说法比「馆档案」好懂：
   - 「at gym A 250 lb, at gym B 100 lb」这种对比；
   - 「不用再建 Leg Press (gym80) 这种重复动作」。

   具体落地时，商店截图放「同一个动作在两个馆的两条纪录线」。英文文案可以针对现在最常见的变通做法写，比如 *no more duplicate exercises per gym*（写成成品语气，不照搬用户原句）。
2. **抢在 Hevy 做出按馆 PR 之前发**。Hevy 的路线是「先社交标签，再按馆 PR」，而且把馆当社交入口做。fitlog 能守住的差异是：
   - **按片取整**；
   - **单台器械的单位和递增量**；
   - **不用联网、不用注册**。

   这三样 Hevy 的路线图里都没出现。
3. **补「不计入纪录」开关**，用于出差训练和测 1RM，成本小。也可以考虑给器械加一个可选的「品牌 / 型号」备注，满足重度多馆用户。
   - 第三轮的点赞数显示，「换馆后 PR 再也破不了」是 Hevy 用户最有共鸣的痛点之一（210 赞）。fitlog 的「器械纪录按馆分开」直接解决它，**这一点要写进商店描述的第一屏**。
   - 挂片式器械（腿举、哈克深蹲）的**空载重量**有人明确要。可以评估加进馆档案的器械设置里。
4. **导入 Strong 和 Hevy 的 CSV，优先级应高于其它新功能**。最容易被 fitlog 打动的，正是被 Hevy 免费上限卡住、又不想订阅的多馆用户，导入是他们换过来的门槛。
   r/Hevy 上已经有人在要 Strong/Hevy 的导出样本做测试（[1wii247](https://www.reddit.com/r/Hevy/comments/1wii247/)），说明这是小开发者的标准动作。
   **注意 Strong 的 CSV 没有单位列**：导入流程要让用户按动作确认 kg/lb。这一步做对了，本身就能成为卖点，因为 Hevy 在这里会把 lb 当成 kg 导错。
9. **发布渠道别硬发自荐帖**。r/workout 等版块对新 App 自荐普遍反感，Liftosaur 作者也说自荐会被封。更稳的做法是：在 r/Hevy、r/strongapp 里「多馆怎么记」「kg/lb 混用」这类求助帖下，作为一个解法回答，并且说明自己是作者。
5. **自动备份要做到「不用想」**，并在首屏说明「数据在哪、多久备份一次」。FitNotes 的教训说明，光不注册不等于可靠。
6. **定价**：如果以后收费，**买断**是唯一不招骂的形式。参考价位在 Hevy $75、Strong $99 之下。
   配片、计时器、图表历史这类**基础功能不能锁**，这是最招恨的做法。
7. **不做 AI 教练、不做动态流**。可以在文案里明说「没有 AI、没有动态、没有广告」，这在 FitNotes 和 Strong 的好评里是被直接点名夸的点。
8. **安卓是机会**：安卓用户口碑最好的选择是 FitNotes，界面老、备份手动、没有多馆。Strong 的安卓版被嫌弃，Apple Watch 这条护城河在安卓不存在。

## 5. 局限

- Reddit 走的是第三方存档接口和公开 RSS，两边都限流严重。第二轮补抓了 r/weightroom、r/homegym、r/Fitness 等版块约 3000 帖正文，但**评论区仍然只有 r/Hevy、r/strongapp、r/workout 抓得比较全**。因此「多馆需求」的证据大多来自 Hevy 用户。这可能高估了它的普遍性，但这些用户恰恰是 fitlog 的目标人群。
  - 试过但走不通的路径：Reddit 官方 .json 接口（403）；内置浏览器打开 reddit.com / old.reddit.com（被安全策略拦截）；Reddit 镜像站 redlib（要过人机验证，按规则不绕）；pullpush.io（限流）；Arctic Shift 的大版块全文搜索（服务端超时 / 422）。
  - Claude in Chrome 扩展对 Reddit 同样不可用（扩展提示「Claude 无法协助处理此页面上的内容」）；申请 Reddit 官方 API 应用也没成功（创建按钮无响应，疑似需要先过 Reddit 的接口审批）。
  - 最后由作者手动把 12 个关键帖用 old.reddit 存成网页，共解析出 588 条评论（Hevy 功能请求汇总帖 242 条、RP App 定价帖 198 条、重置 PR 帖 37 条等）。点赞数是存档当时的数。原始网页在仓库的 `investigations/`（未提交）。
  - r/weightroom、r/Fitness 每日讨论帖的评论区仍然没覆盖。
- Google Play 样本刻意偏向低星，所以只能比较不同主题之间的相对量，不能当成满意度。
- 正则计数是关键词级的，精度不一；「安卓 / iOS」和「社交」两项偏宽。
- Hevy 馆标签的现状（是否已影响统计）只来自 2026-09 用户帖，**没有在 App 里核实**。
- 原始数据和脚本在本会话的 scratchpad，没有放进仓库。
