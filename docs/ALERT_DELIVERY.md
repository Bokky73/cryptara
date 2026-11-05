# Alert delivery adapters

Cryptara delivers triggered and recovered alerts through four channels:

| Channel | Behavior |
| --- | --- |
| `in_app` | Always `delivered`. Surfaced via `/api/alerts/alerts`. |
| `email` | Signed generic webhook (`ALERT_EMAIL_WEBHOOK_URL` + `ALERT_EMAIL_WEBHOOK_SECRET`). |
| `telegram` | Telegram Bot API `sendMessage`. |
| `discord` | Discord incoming webhook (`wait=true`). |

Adapters never claim `delivered` without a validated provider response.

## Configuration

Set server-only env vars (see `frontend/.env.example`):

- `ALERT_EMAIL_WEBHOOK_URL` / `ALERT_EMAIL_WEBHOOK_SECRET`
- `ALERT_TELEGRAM_BOT_TOKEN` / `ALERT_TELEGRAM_CHAT_ID`
- `ALERT_DISCORD_WEBHOOK_URL`
- `ALERT_FORCE_FAIL_CHANNELS` — chaos hook (`email,telegram`) for fixtures/staging
- `ALERT_DELIVERY_BACKOFF_MS=0` — disable retry sleeps in tests

Missing config yields `skipped`, not a false success.

## Email webhook signature

Each email webhook POST includes:

- `x-alert-timestamp` — ISO timestamp
- `x-alert-signature` — `sha256=<hex>`
- `x-idempotency-key` — stable fan-out key

Signature material: `HMAC_SHA256(secret, timestamp + "." + body)`.

Receivers should verify with a constant-time compare and reject stale timestamps.

## Retry policy

- Timeout, `429`, and `5xx` are retryable (bounded, default 3 attempts).
- Permanent `4xx` (except `429`), malformed success bodies, and cancellation are terminal.
- Terminal recipient/config errors are never retried.
- Wallet-scoped `POST /api/alerts/deliveries` with `{ deliveryId }` retries a non-terminal failed row.

## Privacy

Outbound payloads use `buildSanitizedAlertPayload` (wallet hints only). Error details are redacted before storage/UI — tokens, webhook URLs, chat IDs, emails, and wallet addresses must never appear in logs or audit rows.

## Tests

```bash
cd frontend
npm run test:alert-delivery   # fake transports only
npm run test:alerts           # engine + force-fail fixtures
```

Fixtures inject `setAlertDeliveryTransport(...)` and must not call live providers.
