# FitLog AI

Fitness log PWA built with React and Vite. Data lives in IndexedDB plus `fitlog_*` localStorage keys.

## Run locally

1. `npm install`
2. Copy [`.env.example`](.env.example) to `.env` or `.env.local` and set `GEMINI_API_KEY` if you use AI features.
3. `npm run dev`

## Personal sync API (optional)

If `VITE_API_URL` and `VITE_API_KEY` are both set, the app can push/pull a single JSON snapshot to your HTTP server:

- **URL:** `{VITE_API_URL}{VITE_FITLOG_STATE_PATH}` (env path defaults to `/api/fitlog/state`)
- **Auth:** header `Authorization: Bearer {VITE_API_KEY}`
- **Methods:** `GET` returns `{ schemaVersion: 2, ... }` or **404** for empty remote; `PUT` sends the merged local snapshot (`schemaVersion` must be **2**).

Without these vars, syncing is skipped and the app stays local-only.

## Scripts

| Command           | Purpose        |
|-------------------|----------------|
| `npm run dev`     | Vite dev server |
| `npm run build`   | Production build |
| `npm run typecheck` | `tsc --noEmit` |
