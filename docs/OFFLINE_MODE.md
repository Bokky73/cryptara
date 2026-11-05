# Offline Mode

Cryptara is installable through `frontend/public/manifest.webmanifest` and `frontend/public/sw.js`.

The service worker caches only the application shell and static assets. It does not cache `/api/*` responses, POST requests, risk verdicts, quotes, prices, payment responses, or execution previews. When navigation fails offline, the worker serves `/offline`, which reads locally captured last-known scan and portfolio summaries from `localStorage`.

Offline data is always read-only and stamped with capture time plus staleness. Returning online does not immediately re-enable actions. Once the app has observed an offline state, the UI sets a session refresh lock; scan, execute, approve, pay, and rule-change controls remain disabled until the user presses the explicit refresh action.

Cache versions live in `frontend/src/sw/cacheVersion.ts` and `frontend/public/sw.js`. Bumping the version creates a new shell cache, and the activation handler deletes all superseded cache names.

Verification:

1. Build and serve the frontend.
2. Load `/dashboard` or `/scan` online and complete a successful portfolio or token scan capture.
3. Switch the browser offline and reload.
4. Confirm `/offline` appears with capture timestamps and stale labels.
5. Confirm state-changing controls are disabled.
6. Reconnect and confirm the banner requires an explicit refresh before actions re-enable.
