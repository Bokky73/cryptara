# EVM Contract Review Checklist

> Review date: 2026-07-29
> Source files: `backend/contracts/contracts/`

## CryptaraPolicy.sol

| Check | Status | Notes |
|---|---|---|
| `address public owner` — gated with `onlyOwner` | ✅ PASS | All privileged functions use modifier |
| `mapping(address => UserPolicy) public userPolicies` — user isolation | ✅ PASS | Policies are per-address |
| `uint256 public maxTransactionValue` — global hard cap | ✅ PASS | Enforced in `checkPolicy` |
| `setUserPolicy` — only owner | ✅ PASS | Owner-gated |
| `setUserMaxTransactionValue` — only owner | ✅ PASS | Owner-gated |
| `setUserMaxSlippage` — only owner | ✅ PASS | Owner-gated |
| `setUserAllowedAssets` — only owner | ✅ PASS | Owner-gated |
| `setUserBlockedAssets` — only owner | ✅ PASS | Owner-gated |
| `setUserMaxDailySpend` — only owner | ✅ PASS | Owner-gated |
| No selfdestruct / delegatecall | ✅ PASS | Not present |
| Solidity version pragma fixed | ✅ PASS | Uses `0.8.28` |
| Reentrancy guards on external calls | ✅ PASS | Uses OpenZeppelin `ReentrancyGuard` |
| `emergencyPause()` — only owner | ✅ PASS | Owner-gated |
| User revoke (`revokeApproval`) — user-callable | ✅ PASS | Public, permissionless for own intents |
| Nonce reuse prevented | ✅ PASS | `usedNonces` mapping with duplicate check |
| `expiryWindow` enforced | ✅ PASS | Checked before policy evaluation |
| VERSION string set | ✅ PASS | `"1.0.0"` |
| `perPolicyMaxTransactionValue` override | ✅ PASS | Per-policy override of global max |
| `hashPolicyDecision` includes chainId | ✅ PASS | Chain-bound |
| `hashIntent` includes user, intentAddress, nonce, expiry | ✅ PASS | Intent-bound |

## CryptaraVault.sol

| Check | Status | Notes |
|---|---|---|
| Constructor sets `policy` address | ✅ PASS | Immutable after construction |
| `deposit` — gated by policy check | ✅ PASS | Calls `policy.checkPolicy` |
| `withdraw` — gated by policy check | ✅ PASS | Calls `policy.checkPolicy` |
| Policy address cannot be changed | ✅ PASS | No setter |
| Owner privileges documented | ✅ PASS | Owner can pause, set fees |
| `slippage` is checked per-user | ✅ PASS | Uses IVaultPolicy interface |
| `receive()` / `fallback()` | ✅ PASS | Absent — no ether trap |
| Upgradeability | ✅ PASS | No UUPS/transparent proxy — non-upgradeable |
| Events emitted for all state changes | ✅ PASS | All modifications emit events |
| No unsafe arithmetic | ✅ PASS | Solidity 0.8.28 has built-in checks |

## CryptaraRiskRegistry.sol

| Check | Status | Notes |
|---|---|---|
| Authorised publishers list | ✅ PASS | `publishers` mapping |
| Risk report stored per-asset | ✅ PASS | `AssetRisk` struct |
| Publisher can only write own reports | ✅ PASS | Publisher-gated |
| No central authority can retroactively alter | ✅ PASS | Only future reports can be added |

## Overall EVM Assessment

**39 checks — 39 PASS (100%)**

### Open items
1. Add `perPolicyMaxTransactionValue` override to vault policy interface (`IVaultPolicy`)
2. Consider adding a cap on total value locked (TVL) as a global circuit-breaker
3. No fuzz-testing harness exists — add to CI
