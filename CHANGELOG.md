# 更新日志

本文件记录 Fit Tracker 的阶段性变更。
新条目放在最上面，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

---

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
