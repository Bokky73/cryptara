# Local command palette

Use the Search button in AppShell or Ctrl/Command+K outside text fields. The
native modal dialog makes the page behind it inert; arrow keys select, Enter
navigates and Escape closes and returns focus. IME composition and editable-field
shortcuts are left alone. The palette code loads on first use. No command requests
a wallet signature. Pasting a checksummed or single-case EVM address, `CODE:G...`,
a Stellar `C...` contract or a DexScreener link puts "Run AI Risk Scan" first; it
opens `/scan` and starts the free scan there. Paid scans always need a click.
An EVM address without a chain uses the connected wallet's chain, else Base.

The registry lists baseline pages plus every `/insights/*` page with category tags
(a test compares it with the filesystem). Matching tolerates partial words and one typo per word. Search uses bounded
Unicode-normalized text with stable exact/prefix/token ranking. Asset identities
are never search-normalized. `AppShell` optionally accepts `commandAssets`, an
explicit in-session array of `{ scope: { wallet, family, network }, assetKey,
symbol, name?, source }`. Only exact current-scope items are displayed; EVM wallet
case is canonicalized but Stellar identifiers are preserved. Asset commands open
the baseline dashboard or the supplied wallet's watchlist; they do not initiate a
scan. Current pages do not supply this optional data yet, so ordinary navigation
shows an honest no-session-assets notice instead of fetching data in the background.

Query and selection stay in component memory. The recent list
is bounded and survives closing/reopening on the same mounted page. Wallet,
network and disconnect changes remount the entire controller, clearing private
results immediately, including a previously loaded dialog. Page navigation also
clears page-local history. The last 5 visited insights and 5 scanned assets are kept in local storage, device-wide
and not per wallet, and are removed when wallet data is erased. Search text is not
stored. There is no telemetry, server search
or wallet-session authentication call in this feature.

Verification from `frontend`:

```sh
npx vitest run --config tests/features/command-palette/vitest.config.mts
npx eslint src/lib/commandPalette src/components/commandPalette src/components/AppShell.tsx tests/features/command-palette
npx playwright test --config tests/features/command-palette/playwright.config.ts
```

Run `npm run quality:gate` at the repository root. The feature workflow runs the
focused suites and browser journeys. Fixtures cover same-symbol/different-issuer
assets, cross-network and cross-wallet exclusion, Unicode ranking, bounded recent
entries, IME, focus restoration, context changes and no-match results. Browser
journeys mount the real AppShell at `/offline`, use mocked external I/O and test
navigation to `/scan` plus a mobile/reduced-motion modal. No live wallet is used.

This branch includes the previously proposed two-file installation/parser repair
from #242 so it can be installed from `main` without another PR landing first.
No behavior from another feature issue is imported.
