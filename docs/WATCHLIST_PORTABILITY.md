# Watchlist Portability Specification

This document details the bulk import and export formats for Cryptara watchlists.

## 1. JSON Schema

JSON format uses schema version `1.0.0`:

```json
{
  "version": "1.0.0",
  "walletAddress": "0x1234...abcd",
  "exportedAt": "2026-11-20T12:00:00Z",
  "entries": [
    {
      "chain": "ethereum",
      "network": "mainnet",
      "assetIdentifier": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "symbol": "USDC",
      "name": "USD Coin",
      "addedAt": "2026-11-20T11:30:00Z"
    }
  ]
}
```

## 2. CSV Schema & Column Specifications

Watchlist CSV exports use standard UTF-8 CSV formatting:

| Column | Type | Example | Description |
|---|---|---|---|
| `chain` | string | `ethereum` or `stellar` | Target blockchain family |
| `network` | string | `mainnet`, `testnet` | Target network environment |
| `assetIdentifier` | string | `0x...` or `USDC:GA5Z...` | Contract address or SEP-41 token |
| `symbol` | string | `USDC` | Asset ticker symbol |
| `name` | string | `USD Coin` | Human-readable token name |
| `addedAt` | ISO 8601 string | `2026-11-20T11:30:00Z` | Timestamp when entry was added |

### Example CSV:
```csv
chain,network,assetIdentifier,symbol,name,addedAt
ethereum,mainnet,0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48,USDC,USD Coin,2026-11-20T11:30:00Z
stellar,pubnet,USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN,USDC,USD Coin,2026-11-20T11:31:00Z
```

## 3. Duplicate Handling & Collision Neutralization

- Assets are compared by chain, network, and address, however the row spells them.
- A row that repeats a saved asset, or an earlier row in the file, is a duplicate.
- `strategy=skip` (default) leaves the first copy unchanged. `strategy=update`
  overwrites its symbol, token name, pair address, and note with non-empty values.
- **Formula Injection Mitigation**: Cells beginning with `=`, `+`, `-`, `@`, their
  full-width forms, a tab, or a line break are exported with a leading single quote
  (`'`). Importing removes it. The Export CSV dialog previews every affected cell.

## 4. Dry-Run Import

Test imports before persisting by adding query parameter `?dry_run=true` to the import endpoint:
```bash
POST /api/watchlist/import?dry_run=true
```

A dry run and the browser preview use the same validation
(`frontend/src/server/discovery/watchlistImport.ts`). Applying an import with any
invalid row fails without saving anything; the import wizard excludes those rows
first. Import and export both require the wallet's own session.
