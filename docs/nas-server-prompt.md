# 交给 NAS 上 Claude Code 的提示词

客户端（本仓库）已经完成隔离改造，服务端还差两层。把下面 `---` 之间的内容
整段复制给 NAS 上的 Claude Code 即可。

改完后回到本机验证：

```bash
npm run check-remote && npm run check-remote -- --prod
```

---

我的 NAS 上跑着一个给健身 App（fitlog）做数据同步的小服务，经 Tailscale Serve
暴露。请先找到它的代码（大概率是个 Node/Python 的小 HTTP 服务，或者 Docker
容器里的一个 handler），读懂现有实现，然后做下面四项改造。

## 现有接口契约

两个端点，各自持久化一份独立的 JSON 快照：

- `GET/PUT /api/fitlog/state`      —— 真实用户数据（手机 APK 在用）
- `GET/PUT /api/fitlog/state-dev`  —— 开发测试数据

鉴权：`Authorization: Bearer <API_KEY>`，目前两个端点共用同一把 key。
Body 是一整份 JSON 快照，形如：

```json
{
  "schemaVersion": 2,
  "env": "prod",
  "clientExportedAt": "2026-08-27T10:00:00.000Z",
  "workouts": [...], "goals": [...], "weightLogs": [...],
  "customMetrics": [...], "prs": [...], "customExerciseDefsFromDb": [...],
  "scheduledWorkouts": [...], "assistantConversations": [...],
  "prefs": {...}, "tombstones": {...}
}
```

客户端刚刚升级，从现在起每个请求会多带一个头：`X-Fitlog-Env: dev | prod`，
并且 PUT 的 body 里带 `"env": "dev" | "prod"`。老客户端可能两者都没有。

## 改造 1：每次 PUT 前先备份（最重要，请先做这个）

这是整套方案的兜底 —— 万一还是写错了，能恢复。

- 在覆盖快照之前，把**当前**快照另存一份，文件名带时间戳，例如
  `state.2026-08-27T10-00-00Z.json`，放在同目录的 `backups/` 子目录里。
- 两个端点各自独立备份，互不混用目录。
- 只保留最近 30 份，更旧的自动删除（按文件名时间戳排序，不要按 mtime）。
- 当前快照不存在（首次写入）时跳过备份，不要因此报错。
- 备份失败必须让整个 PUT 失败并返回 5xx —— **不能备份失败还照样覆盖**。

## 改造 2：两把 key，各自绑定端点

- 生成两把互不相同的 key。环境变量名建议 `FITLOG_API_KEY_PROD` /
  `FITLOG_API_KEY_DEV`（沿用你现有的配置方式即可）。
- `FITLOG_API_KEY_PROD` 只能访问 `/api/fitlog/state`；
  `FITLOG_API_KEY_DEV` 只能访问 `/api/fitlog/state-dev`。
- 用错端点一律返回 **403**，body 里写清楚原因，例如
  `{"error":"this key is not allowed on /api/fitlog/state"}`。
  不要返回 401，也不要静默改路由 —— 我要的是响亮的失败。
- key 比对用**定长比较**（如 Node 的 `crypto.timingSafeEqual`），别用 `===`。
- 迁移期兼容：如果 `FITLOG_API_KEY_DEV` 没配置，允许 prod key 同时访问两个端点，
  但每次都在日志里打一条 WARN，提醒这层防护没生效。

## 改造 3：校验环境标记与端点一致

在 PUT 的处理里，覆盖数据之前先校验：

- 端点 `/api/fitlog/state` 期望 `prod`，`/api/fitlog/state-dev` 期望 `dev`。
- 若 `X-Fitlog-Env` 头存在但与期望值不符 → 返回 **409**，不写入。
- 若 body 里的 `env` 字段存在但与期望值不符 → 返回 **409**，不写入。
- 两者都不存在（老客户端）→ 放行，但在写入前把 `env` 补成期望值再落盘，
  并打一条 INFO 日志。
- 拒绝时日志要记全：端点、收到的 env、来源 IP、时间。

## 改造 4：GET 也带上环境标记

`GET` 返回的 JSON 里确保有 `env` 字段（等于该端点对应的值）。
客户端会校验它，不符就拒绝把数据落到本地 —— 这是最后一道防线。

## 额外要求

- **不要**修改任何现有快照的业务字段，只允许补 `env`。
- 改完后写一个 `README` 或注释，说明两把 key 分别是什么、备份在哪、怎么从备份恢复
  （恢复步骤要能照着一步步做）。
- 请给我一段可以直接跑的验证命令，覆盖这些场景：
  1. prod key + `/api/fitlog/state` GET → 200
  2. prod key + `/api/fitlog/state-dev` GET → 403
  3. dev key + `/api/fitlog/state` PUT → 403
  4. dev key + `/api/fitlog/state-dev` PUT + `X-Fitlog-Env: prod` → 409
  5. 一次正常 PUT 之后，`backups/` 里多出一份带时间戳的文件

改造过程中如果需要重启服务，先告诉我，不要直接重启 —— 手机可能正在同步。
