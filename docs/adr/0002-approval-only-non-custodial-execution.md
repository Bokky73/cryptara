# ADR 0002: Approval-Only Non-Custodial Execution

## Status
Accepted

## Context
Automated transaction execution platforms introduce immense key-management vulnerabilities, custodial liabilities, and regulatory risks.

## Decision
Cryptara strictly implements an approval-only, non-custodial execution model:
1. `serverCanSign: false` is enforced across the entire codebase and verified in CI deploy checks.
2. The server never generates, stores, transmits, or has access to user private keys.
3. The platform only prepares, previews, and simulates transactions.
4. Every onchain action requires explicit user approval and signing in the user's connected wallet (MetaMask, Rabby, Freighter, WalletConnect).

## Consequences
- **Positive**: Zero custody risk, zero server-side key exposure surface, full user self-sovereignty.
- **Trade-off**: Requires user presence for each transaction execution.
