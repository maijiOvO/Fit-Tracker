# Fit Tracker

> A fitness logbook designed for people who actually train.
> Workouts, PRs, body metrics and schedule — all yours, all local-first.

🌐 **Live demo:** [fit.myronhub.com](https://fit.myronhub.com)
📱 **Android:** Capacitor build — APK available from [Releases](../../releases)

---

## Screenshots

> Drop your screenshots into `docs/screenshots/` and they will render below. See [`docs/screenshots/README.md`](docs/screenshots/README.md) for what to capture.

| PR Hub | Workout |
|:---:|:---:|
| ![PR Hub](docs/screenshots/01-pr-hub.png) | ![Workout](docs/screenshots/02-workout.png) |

| Schedule |  |
|:---:|:---:|
| ![Schedule](docs/screenshots/03-schedule.png) |  |

---

## What it does

- **PR Hub** — personal-record tracking across exercises, body parts and equipment.
- **Workout logger** — sets, reps, sub-sets, pyramid templates.
- **Body data** — bodyweight log, measurements, calendar heatmap over time.
- **Goals** — set training goals; an auto-updater watches your sessions and updates progress.
- **Schedule** — week / month view, plan future sessions, mark as done / skipped.
- **Bilingual** — English / 中文 throughout (`translations.ts`).
- **Local-first** — IndexedDB + `fitlog_*` localStorage keys. Works fully offline.
- **Optional sync** — push/pull a single JSON snapshot to any HTTP server you control.

## Tech stack

| Layer | Choices |
|---|---|
| UI | React 19 · TypeScript · Tailwind CSS |
| Build | Vite 6 · `tsc --noEmit` typecheck |
| Mobile | Capacitor 8 (Android) |
| Storage | IndexedDB (via `services/db.ts`) · localStorage prefs · tombstones for sync-aware deletes |
| Data viz | `recharts` (lazy-loaded) · `react-calendar-heatmap` |
| Offline | Service Worker (`sw.js`) + Web App Manifest |
| Testing | Playwright e2e smoke (`npm run e2e`) |

## Architecture notes

```
App.tsx                    # entry — lazy-loaded tabs, context providers
src/components/            # UI: Dashboard, PlanTab, charts, …
src/contexts/              # AuthProvider, GoalsProvider, ScheduleProvider, …
src/hooks/                 # useTheme, etc.
services/
├─ db.ts                   # IndexedDB schema + access layer
├─ fitlogRemote.ts         # JSON-snapshot HTTP client
├─ fitlogRemoteSync.ts     # pull-and-merge logic
├─ fitlogSyncScheduler.ts  # debounced push
├─ fitlogTombstones.ts     # delete propagation across devices
├─ fitlogSolo.ts           # single-user identity helpers
├─ appEnv.ts               # dev / prod data-environment resolution
└─ appStorage.ts           # namespaced localStorage
```

Charts are lazy-loaded behind `LazyCharts.tsx` so the first-paint bundle stays small.

## Run locally

**Prerequisites:** Node.js 20+, npm.

```bash
npm install
cp .env.example .env.local       # then fill in keys you need
npm run dev                      # http://localhost:5173
```

All env keys are **optional** — the app runs fully offline without them. See [`.env.example`](.env.example) for what each one unlocks.

```bash
npm run typecheck                # tsc --noEmit
npm run build                    # dev-env bundle (safe for local preview)
npm run build:release            # prod-env bundle — the ONLY build fit for the APK
npm run preview                  # serve the built bundle
npm run e2e                      # Playwright smoke test (never touches the real backend)
npm run check-remote             # server reachability — dev endpoint; add -- --prod for real data
npm run remote-detail            # dump the remote snapshot — same --prod rule
```

### Android build

See [`RELEASE-GUIDE.md`](RELEASE-GUIDE.md) and [`android-release-build-guide.md`](android-release-build-guide.md).

## Personal sync API (optional)

If `VITE_API_KEY` is set, the app can push/pull a single JSON snapshot to an HTTP server you control:

- **Base URL:** `VITE_API_URL`, falling back to `DEFAULT_API_BASE_URL` in [`services/fitlogRemote.ts`](services/fitlogRemote.ts)
- **Endpoint:** `/api/fitlog/state` (prod) or `/api/fitlog/state-dev` (dev) — chosen by the data environment, not configurable
- **Auth:** `Authorization: Bearer {VITE_API_KEY}` (prod) / `{VITE_API_KEY_DEV}` (dev)
- **Methods:** `GET` returns `{ schemaVersion: 2, env, ... }` or `404` for empty remote; `PUT` sends the merged local snapshot.

Without `VITE_API_KEY`, syncing is skipped and the app stays local-only — the default base URL alone does **not** enable remote sync.

## Data environments (dev vs. real user data)

Development never shares storage with real user data. Everything is namespaced
by a single resolved environment — see [`services/appEnv.ts`](services/appEnv.ts).

| | `dev` | `prod` |
|---|---|---|
| Server endpoint | `/api/fitlog/state-dev` | `/api/fitlog/state` |
| IndexedDB | `FitLogDB-dev` | `FitLogDB` |
| localStorage | keys prefixed `dev:` | unprefixed |
| API key | `VITE_API_KEY_DEV` | `VITE_API_KEY` |

**How the environment is resolved** (higher wins, and cannot be overridden by lower):

1. Running inside a Capacitor native container (the phone APK) → **`prod`, locked**
2. Built with `VITE_FITLOG_ENV=prod`, i.e. `npm run build:release` → **`prod`, locked**
3. Anything else (`npm run dev`, `npm run preview`, any browser) → switchable, **defaults to `dev`**

Defaulting to `dev` is deliberate. Guessing `prod` wrong destroys real data and is
irreversible; guessing `dev` wrong only hides real data temporarily. Rules 1 and 2
back each other up: a mis-stamped APK is rescued by the native check, and a failed
native check is rescued by the stamp.

**Layers that make a mistake impossible rather than unlikely:**

- Storage is physically partitioned, so dev records can't be merged into the real
  snapshot even if the endpoint were resolved wrong.
- Every remote read/write funnels through one `remoteFetch()` that asserts the
  path matches the environment and throws otherwise.
- Snapshots carry an `env` stamp; the client refuses to apply one that doesn't match.
- Switching environments cancels the pending debounced push first, then swaps the
  database, and rolls back on any failure — no window where old data meets a new endpoint.
- The release build scripts refuse to package a `dist` that isn't stamped `prod`
  (`dist/fitlog-build-env.json`).
- `npm run e2e` aborts and fails on any request that escapes to the real backend.

Server-side enforcement (per-endpoint API keys + versioned backups before every
write) is tracked in [`docs/nas-server-prompt.md`](docs/nas-server-prompt.md).

### Backend host

The backend runs on a home NAS exposed via **Tailscale Funnel**:

| | |
|---|---|
| Default | `https://hometj.taild995c6.ts.net` |

- Use the **hostname**, never the Tailscale IP `100.106.208.88` — Tailscale routes by `Host` header, so requests straight to the IP return `404`.
- **Funnel means this endpoint is reachable from the public internet** — the phone does not need to be on the tailnet. Treat the API key as the only thing standing between the open internet and the data.
- Emergency takedown: `tailscale funnel --https=443 off` on the NAS.
- The certificate is issued by Let's Encrypt, so Android needs no `usesCleartextTraffic` or `networkSecurityConfig` entry.
- There is **no rollback host any more**: the old `fitlog.myronhub.com` VPS was destroyed on 2026-08-29.

> **Note on `VITE_*` variables:** Vite inlines them into the client bundle at build time, so any value with the `VITE_` prefix is visible to anyone who opens the deployed site in DevTools. Keep server-side authoritative logic — `VITE_API_KEY` should only authorize the *intended* endpoints, not be trusted for sensitive operations.

### Demo build

`npm run build:demo` produces a public, offline, single-session build — for letting
people try the app in a browser without touching any real data.

| | |
|---|---|
| Flag | `VITE_FITLOG_DEMO=true` (injected only by `.env.demo`) |
| IndexedDB | `FitLogDB-demo` |
| `localStorage` prefix | `demo:` |
| Build stamp | `dist/fitlog-build-env.json` → `{"env":"demo"}` |

What the flag actually does:

- `isRemoteConfigured()` returns `false`, so every sync path (scheduler, pull, push,
  the sync button) takes its existing no-op branch.
- `remoteFetch()` — the single exit for all remote I/O — throws outright. This second
  guard is the one that matters: the first is a convention a new call site could forget,
  this one cannot be bypassed.
- Because that guard is a build-time constant, the `fetch` call becomes dead code and
  the minifier drops it — **taking the inlined `VITE_API_KEY` with it**. A demo bundle
  contains no credential even if one is present in `.env.local`. Verify with
  `grep -c Bearer dist/assets/*.js` → `0`.
- On boot, before React mounts, the demo IndexedDB and every `demo:`-prefixed
  `localStorage` key are wiped, so each visit starts clean.

⚠️ Never set `VITE_API_KEY` / `VITE_API_KEY_DEV` in the demo deployment's environment.

## Project status

This is a personal project, used daily by the author. Bug reports and PRs welcome. License: [MIT](LICENSE) (add a `LICENSE` file if missing).

---

Made with React, TypeScript, and a lot of training sessions.
