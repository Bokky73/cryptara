# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | ✅ Critical fixes  |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Cryptara takes security seriously. If you discover a vulnerability, please
report it privately so the maintainers can assess and fix it before disclosure.

### Private reporting channels (in preferred order)

1. **GitHub private vulnerability disclosure** (recommended, if enabled):
   Navigate to the repository's **Security** tab → **Private vulnerability
   reporting** → **Report a vulnerability**.

   If the repository does not show a private-reporting button, the feature may
   not be enabled by the organization. In that case use option 2 below.

2. **Email**: `security@cryptara.xyz`
   > ⚠️ **Maintainer action required:** Replace the email address above with
   > the actual security contact **before the repository goes public**. If
   > GitHub private vulnerability reporting is enabled in the organisation
   > settings, that channel takes precedence over email.

### What to include

- Type of vulnerability (XSS, injection, signature bypass, access control, etc.)
- Steps to reproduce (minimal proof of concept preferred)
- Affected component(s) and version(s)
- Impact estimate
- Suggested fix (optional)

### Response SLA

We aim to acknowledge reports within **48 hours** and provide an initial
assessment within **5 business days**.

## Scope

- `frontend/` — Next.js client application
- `backend/contracts/` — EVM smart contracts (CryptaraVault)
- `soroban/contracts/` — Soroban smart contracts (Risk Registry)
- `scripts/` — Deployment, smoke-test, and monitoring scripts

### Out of scope

- Dependencies already reported upstream (npm, crates.io packages)
- Network-level DDoS on infrastructure we do not control (RPC endpoints, data
  APIs)
- Social engineering of maintainers or contributors
- Previously disclosed / known issues documented in the project roadmap

## Security boundaries

- **The server never holds user private keys.** All blockchain transactions
  require explicit wallet signing by the connected user wallet.
- **Auto-execute is disabled.** No transaction is sent without explicit user
  approval through their wallet.
- **Provider credentials** are server-side environment variables never exposed
  to the client bundle.
- **Approvals** are scoped per-transaction; infinite approvals are flagged as a
  risk.

## Verification

After a fix is deployed, the vulnerability is reproduced against the patched
environment before closing the advisory. Coordinated disclosure is preferred;
we allow a reasonable embargo period (default **90 days**) after a fix is
shipped before public disclosure.
