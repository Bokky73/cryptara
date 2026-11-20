# Environment Variables Reference

This document catalogs all environment variables used across Cryptara server runtimes, background scripts, and frontend client builds.

## Secrets Classification Matrix

| Variable | Visibility | Subsystem | Required (Live) | Default / Example | Description |
|---|---|---|---|---|---|
| `APP_MODE` | Server | Core | Yes | `production` / `development` | Operating mode |
| `LOG_LEVEL` | Server | Observability | No | `info` | Minimum log level (`debug`, `info`, `warn`, `error`) |
| `NEXT_PUBLIC_APP_URL` | Public | Client | Yes | `http://localhost:3000` | Canonical app URL |
| `NEXT_PUBLIC_GOAT_RPC_URL` | Public | EVM | Yes | `https://rpc.goat.network` | GOAT network public RPC |
| `SUPABASE_URL` | Server | Storage | Yes | `https://xyz.supabase.co` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Storage | Yes | `sb_secret_...` | Supabase privileged key |
| `GOPLUS_API_KEY` | Secret | Security | Recommended | - | GoPlus Token Security API key |
| `GOPLUS_APP_KEY` | Secret | Security | Optional | - | GoPlus App Key |
| `GOPLUS_APP_SECRET` | Secret | Security | Optional | - | GoPlus App Secret |
| `GOLDRUSH_API_KEY` | Secret | Portfolio | Optional | - | Covalent Goldrush multi-chain portfolio key |
| `ALCHEMY_API_KEY` | Secret | EVM | Optional | - | Alchemy EVM RPC / simulation key |
| `X402_PAY_TO` | Server | Payments | Yes (if x402 on) | `0x3ED3E9...` | Payment settlement address |
| `X402_PRICE_USD` | Server | Payments | Yes (if x402 on) | `$0.99` | Scan price in USD |
| `X402_NETWORK` | Server | Payments | Yes (if x402 on) | `eip155:8453` | Settlement network identifier |
| `X402_FACILITATOR_URL` | Server | Payments | Yes (if x402 on) | `https://api.cdp.coinbase.com/...` | Payment facilitator origin |
| `CDP_API_KEY_ID` | Secret | Payments | Yes (if CDP used) | - | Coinbase Developer Platform Key ID |
| `CDP_API_KEY_SECRET` | Secret | Payments | Yes (if CDP used) | - | Coinbase Developer Platform Key Secret |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Public | Stellar | Yes | `stellar-testnet` | Target Stellar network |
| `STELLAR_RPC_URL` | Server | Stellar | Yes | `https://soroban-testnet.stellar.org` | Primary Soroban RPC |
| `STELLAR_RPC_FALLBACK_URLS` | Server | Stellar | No | `https://...` | Comma-separated RPC fallbacks |
| `OTEL_TRACING_ENABLED` | Server | Observability | No | `0` | Enable OpenTelemetry tracing (1 or 0) |

> [!CAUTION]
> The server runtime must **NEVER** hold or store user private keys or seed phrases.
