# FitLog AI

> A fitness logbook designed for people who actually train.
> Workouts, PRs, body metrics, schedule and an AI training assistant — all yours, all local-first.

🌐 **Live demo:** [fit.myronhub.com](https://fit.myronhub.com)
📱 **Android:** Capacitor build — APK available from [Releases](../../releases)

---

## Screenshots

> Drop your screenshots into `docs/screenshots/` and they will render below. See [`docs/screenshots/README.md`](docs/screenshots/README.md) for what to capture.

| PR Hub | Workout |
|:---:|:---:|
| ![PR Hub](docs/screenshots/01-pr-hub.png) | ![Workout](docs/screenshots/02-workout.png) |

| Schedule | AI Assistant |
|:---:|:---:|
| ![Schedule](docs/screenshots/03-schedule.png) | ![Assistant](docs/screenshots/04-assistant.png) |

---

## What it does

- **PR Hub** — personal-record tracking across exercises, body parts and equipment.
- **Workout logger** — sets, reps, sub-sets, pyramid templates, rest timer with sound + haptics.
- **Body data** — bodyweight log, measurements, calendar heatmap over time.
- **Goals** — set training goals; an auto-updater watches your sessions and updates progress.
- **Schedule** — week / month view, plan future sessions, mark as done / skipped.
- **AI Assistant** — read-only access to your workouts, PRs, body data and goals; can write schedule entries with your approval.
- **Bilingual** — English / 中文 throughout (`translations.ts`).
- **Local-first** — IndexedDB + `fitlog_*` localStorage keys. Works fully offline.
- **Optional sync** — push/pull a single JSON snapshot to any HTTP server you control.

## Tech stack

| Layer | Choices |
|---|---|
| UI | React 19 · TypeScript · Tailwind CSS |
| Build | Vite 6 · `tsc --noEmit` typecheck |
| Mobile | Capacitor 8 (Android) · `@capacitor/haptics` · `@capacitor/local-notifications` |
| AI | `@google/genai` (Gemini) · optional OpenAI-compatible chat completions endpoint |
| Storage | IndexedDB (via `services/db.ts`) · localStorage prefs · tombstones for sync-aware deletes |
| Data viz | `recharts` (lazy-loaded) · `react-calendar-heatmap` |
| Offline | Service Worker (`sw.js`) + Web App Manifest |
| Testing | Playwright e2e smoke (`npm run e2e`) |

## Architecture notes

```
App.tsx                    # entry — lazy-loaded tabs, context providers
src/components/            # UI: Dashboard, PlanTab, AssistantTab, charts, …
src/contexts/              # AuthProvider, GoalsProvider, ScheduleProvider, …
src/hooks/                 # useTheme, etc.
services/
├─ db.ts                   # IndexedDB schema + access layer
├─ fitlogRemote.ts         # JSON-snapshot HTTP client
├─ fitlogRemoteSync.ts     # pull-and-merge logic
├─ fitlogSyncScheduler.ts  # debounced push
├─ fitlogTombstones.ts     # delete propagation across devices
├─ fitlogSolo.ts           # single-user identity helpers
├─ gemini.ts               # AI provider integration
├─ goalAutoUpdater.ts      # watches sessions, updates goal progress
└─ goalRecommendationEngine.ts
```

Charts are lazy-loaded behind `LazyCharts.tsx` so the first-paint bundle stays small. AI tool calls (read training data / write schedule) live behind explicit user approval gates in `AssistantTab.tsx`.

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
npm run build                    # production bundle
npm run preview                  # serve the production build
npm run e2e                      # Playwright smoke test
```

### Android build

See [`RELEASE-GUIDE.md`](RELEASE-GUIDE.md) and [`android-release-build-guide.md`](android-release-build-guide.md).

## Personal sync API (optional)

If `VITE_API_URL` and `VITE_API_KEY` are both set, the app can push/pull a single JSON snapshot to an HTTP server you control:

- **Endpoint:** `{VITE_API_URL}{VITE_FITLOG_STATE_PATH}` (default path `/api/fitlog/state`)
- **Auth:** `Authorization: Bearer {VITE_API_KEY}`
- **Methods:** `GET` returns `{ schemaVersion: 2, ... }` or `404` for empty remote; `PUT` sends the merged local snapshot.

Without these vars, syncing is skipped and the app stays local-only.

> **Note on `VITE_*` variables:** Vite inlines them into the client bundle at build time, so any value with the `VITE_` prefix is visible to anyone who opens the deployed site in DevTools. Keep server-side authoritative logic — `VITE_API_KEY` should only authorize the *intended* endpoints, not be trusted for sensitive operations.

## Project status

This is a personal project, used daily by the author. Bug reports and PRs welcome. License: [MIT](LICENSE) (add a `LICENSE` file if missing).

---

Made with React, TypeScript, and a lot of training sessions.
