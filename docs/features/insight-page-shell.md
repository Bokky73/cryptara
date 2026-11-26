# Insight page shell and URL state

Insights views share a frame and a URL state hook, both in
`frontend/src/components/research/shared/`.

## What each piece does

| Piece | Purpose |
| --- | --- |
| `InsightPageShell` | AppShell navigation, heading, freshness stamp, empty state, and a boundary around the workbench |
| `useInsightPageStatus` | Lets a workbench report `capturedAt` and `empty` to the shell |
| `useInsightParam` | Replaces `useState` for one form field and syncs it with the URL |
| `useInsightQueryParams` | Reads and patches all shared parameters together |
| `app/insights/error.tsx` | Route fallback for failures outside the workbench, including unmigrated pages |

## Parameters

| Key | Accepted values |
| --- | --- |
| `asset`, `compare` | EVM contract, Soroban contract, `CODE:ISSUER`, symbol, or pair such as `ETH/USDC` |
| `network` | Lowercase network ID, optionally restricted by the view |
| `chainFamily` | `evm` or `stellar`; ignored when it contradicts a Stellar network |
| `window` | `1h`, `24h`, `7d`, `30d`, `90d` |

Invalid values are dropped. Bare Stellar accounts and secret keys are never
accepted as assets, so they are not written to a shared link. Do not add wallet
addresses as parameters.

## Migrating a page

1. Replace `<AppShell>` or `<main>` and its header in `page.tsx` with
   `<InsightPageShell id="route-slug" title="..." description="...">`. Omit
   `title` when the workbench renders its own `h1`.
2. Replace the matching `useState` calls in the workbench:

   ```tsx
   const [network, setNetwork] = useInsightParam("network", "ethereum", NETWORKS);
   const [asset, setAsset] = useInsightParam("asset", "");
   ```

3. Where the response has a capture time or an empty result, call
   `useInsightPageStatus({ capturedAt, empty })`.
4. Run the feature's vitest suite and `tests/features/insight-page-shell`.

## Migrated pages

`allowance-inventory`, `balance-reconciliation`, `cctp-transfers`,
`holder-dynamics`, `issuer-control`, `proxy-inspector`, `quorum-map`,
`rpc-consistency`, `signing-inspector`, `soroban-auth-footprint`,
`stellar-holders`, `tx-failure-diagnostics`, `vault-accounting`,
`venue-timeline`, `wash-volume`.

The repository has no route traffic data. This batch is the seven modules named
in issue #11 plus eight with network or asset fields worth sharing.
`signing-inspector` uses the shell only: its context stays in its existing
server-read parameters. Remaining pages are still covered by the route boundary.
