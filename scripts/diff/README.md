# scripts/diff —— 重构期「行为不变」对照（不进 `check` / `e2e`，日常不用）

A、B 是两棵树（主仓 vs 工作树），先在同一提交上跑一遍必须零差异，再比重构前后；两棵树的 `.env.local` 要一样（VITE_* 会烙进产物），产物落 `test-artifacts/diff/`（已 gitignore）。
- `node scripts/diff/build-diff.mjs <A> <B>`：各 `vite build --minify false`，去哈希后逐文件比产物。自检：把 `src/constants/index.ts` 的 `KG_TO_LBS` 改一位小数 → 红。
- `node scripts/diff/net-diff.mjs`：把 build-diff 落下的差异行跨 chunk 抵消，只列净删 / 净增；不判红绿，是 build-diff 红了之后看「到底改了什么」的放大镜。
- `node scripts/diff/pure-diff.mjs <A> <B> [--seed N] [--per 8]`：esbuild 把 utils / services 打成包，固定种子夹具做签名 fuzz + 定向探针，比返回值和 localStorage / 内存 IndexedDB 终态。自检：同上改 `KG_TO_LBS` → 红。
- `node scripts/diff/charset-diff.mjs <A> <B>`：按 build-fonts 的收集范围比 CJK 字符集，A 有 B 没有的字就是会从字体子集里消失的字。自检：删掉一个只出现一次的汉字 → 红。
- `node scripts/diff/ui-diff.mjs http://localhost:3200 http://localhost:3100`：Playwright 同一套操作走两个 dev server（远端全 mock，不碰 NAS），比页面文本 / DOM 结构 / localStorage / 快照。自检：改一处 `data-testid` 或文案 → 红。
- 两个 dev server（PowerShell）：主仓 `npm --prefix <主仓路径> run dev -- --port 3200`；工作树里 `npm run dev -- --port 3100`（即 `.claude/launch.json` 的 fitlog-dev-alt）。
- 比不了的：手势 / 拖动手感、动画、Service Worker 缓存、真机字体渲染 —— 这些照 `docs/manual-check.md` 人看。
