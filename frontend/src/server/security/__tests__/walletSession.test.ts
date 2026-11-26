/**
 * Tests for issue #36 — wallet session nonce replay protection,
 * sliding TTL, and explicit revocation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  mintWalletChallenge,
  verifyWalletChallenge,
  encodeWalletCookie,
  decodeWalletCookie,
  revokeWalletSession,
  WALLET_SESSION_COOKIE,
} from "@/server/security/walletSession";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type WalletSessionGlobal = typeof globalThis & {
  __cryptaraNonceStore?: Map<string, unknown>;
  __cryptaraRevokedSessions?: Map<string, unknown>;
};

/** Wipe the server-side nonce and revocation stores between tests. */
function clearNonceStores() {
  const g = globalThis as WalletSessionGlobal;
  g.__cryptaraNonceStore?.clear();
  g.__cryptaraRevokedSessions?.clear();
}

const EVM_WALLET = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const STELLAR_WALLET = "GBWMCCC3NHSKLAOJDBKKYW7SSH2PFTTNVFKWKH6DFYD4DQNEOG4NPNPG";
const NETWORK = "Test SDF Network ; September 2015";

// ---------------------------------------------------------------------------
// Issue #36.1 — single-use nonce (atomic consume)
// ---------------------------------------------------------------------------
describe("issue #36 — nonce single-use enforcement", () => {
  beforeEach(clearNonceStores);

  it("rejects a second verification attempt with the same nonce", async () => {
    const challenge = mintWalletChallenge({ walletAddress: EVM_WALLET, family: "evm", origin: "https://app.cryptara.io" });

    // First attempt: consume the nonce (we bypass crypto check by using the
    // mock path — nonce_already_used fires before signature verification).
    // We call verifyWalletChallenge once with a missing signature so the nonce
    // is consumed but the sig check fails; then call again.
    const firstResult = await verifyWalletChallenge({
      challenge,
      walletAddress: EVM_WALLET,
      family: "evm",
      signature: undefined,
      origin: "https://app.cryptara.io",
    });
    // Should fail on signature_missing, NOT nonce_already_used — nonce was consumed.
    expect(firstResult.error).toBe("signature_missing");

    // Second attempt with the same nonce must fail with nonce_already_used.
    const secondResult = await verifyWalletChallenge({
      challenge,
      walletAddress: EVM_WALLET,
      family: "evm",
      signature: "0x1234",
      origin: "https://app.cryptara.io",
    });
    expect(secondResult.ok).toBe(false);
    expect(secondResult.error).toBe("nonce_already_used");
  });

  it("rejects a nonce for a different wallet", async () => {
    const challenge = mintWalletChallenge({ walletAddress: EVM_WALLET, family: "evm", origin: "" });
    const result = await verifyWalletChallenge({
      challenge: { ...challenge, walletAddress: "0x1111111111111111111111111111111111111111" },
      walletAddress: "0x1111111111111111111111111111111111111111",
      family: "evm",
      origin: "",
    });
    // wallet_mismatch fires before the nonce check (challenge.walletAddress !== claimWallet)
    expect(result.ok).toBe(false);
    expect(result.error).toBe("wallet_mismatch");
  });
});

// ---------------------------------------------------------------------------
// Issue #36.2 — nonce TTL
// ---------------------------------------------------------------------------
describe("issue #36 — nonce TTL enforcement", () => {
  beforeEach(clearNonceStores);

  it("rejects a challenge whose expiresAt is in the past", async () => {
    const challenge = mintWalletChallenge({ walletAddress: EVM_WALLET, family: "evm", origin: "" });
    // Backdate the challenge expiry to 1 second ago.
    const expired = { ...challenge, expiresAt: new Date(Date.now() - 1000).toISOString() };

    const result = await verifyWalletChallenge({
      challenge: expired,
      walletAddress: EVM_WALLET,
      family: "evm",
      origin: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("challenge_expired");
  });

  it("rejects a nonce that has been evicted from the store due to TTL", async () => {
    const challenge = mintWalletChallenge({ walletAddress: EVM_WALLET, family: "evm", origin: "" });

    // Manually expire the nonce store entry.
    const g = globalThis as WalletSessionGlobal;
    const store = g.__cryptaraNonceStore!;
    const entry = store.get(challenge.nonce) as { expiresAt: number } | undefined;
    if (entry) {
      store.set(challenge.nonce, { ...entry, expiresAt: Date.now() - 1 });
    }

    const result = await verifyWalletChallenge({
      challenge,
      walletAddress: EVM_WALLET,
      family: "evm",
      origin: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("nonce_already_used");
  });
});

// ---------------------------------------------------------------------------
// Issue #36.3 — origin binding
// ---------------------------------------------------------------------------
describe("issue #36 — EVM origin binding", () => {
  beforeEach(clearNonceStores);

  it("rejects a claim from a different origin than the challenge was issued for", async () => {
    const challenge = mintWalletChallenge({
      walletAddress: EVM_WALLET,
      family: "evm",
      origin: "https://app.cryptara.io",
    });

    const result = await verifyWalletChallenge({
      challenge,
      walletAddress: EVM_WALLET,
      family: "evm",
      origin: "https://evil.example.com", // attacker's origin
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("origin_mismatch");
  });

  it("accepts a claim from the same origin the challenge was issued for", async () => {
    // We only test up to the sig check since we don't have a real private key,
    // but origin must NOT be in the rejection set.
    const challenge = mintWalletChallenge({
      walletAddress: EVM_WALLET,
      family: "evm",
      origin: "https://app.cryptara.io",
    });

    const result = await verifyWalletChallenge({
      challenge,
      walletAddress: EVM_WALLET,
      family: "evm",
      signature: undefined, // fail on sig check, NOT on origin
      origin: "https://app.cryptara.io",
    });
    // Must fail on signature_missing, not origin_mismatch
    expect(result.error).toBe("signature_missing");
    expect(result.error).not.toBe("origin_mismatch");
  });
});

// ---------------------------------------------------------------------------
// Issue #36.4 — Stellar network passphrase binding
// ---------------------------------------------------------------------------
describe("issue #36 — Stellar network passphrase binding", () => {
  beforeEach(clearNonceStores);

  it("rejects a claim with a different network passphrase", async () => {
    const challenge = mintWalletChallenge({
      walletAddress: STELLAR_WALLET,
      family: "stellar",
      network: NETWORK,
    });

    // Claim using mainnet passphrase against a testnet challenge.
    const result = await verifyWalletChallenge({
      challenge,
      walletAddress: STELLAR_WALLET,
      family: "stellar",
      signedTxXdr: "not-real-xdr",
      network: "Public Global Stellar Network ; September 2015", // wrong network
    });
    // The nonce is consumed with the testnet network, so a different-network
    // consume attempt returns nonce_already_used (network mismatch in consumeNonce).
    expect(result.ok).toBe(false);
    // Either nonce_already_used (consume failed due to network mismatch) or
    // network_passphrase_mismatch — both are correct outcomes.
    expect(["nonce_already_used", "network_passphrase_mismatch"]).toContain(result.error);
  });
});

// ---------------------------------------------------------------------------
// Issue #36.5 — explicit session revocation
// ---------------------------------------------------------------------------
describe("issue #36 — explicit session revocation", () => {
  beforeEach(clearNonceStores);

  it("decodeWalletCookie returns undefined for a revoked token", () => {
    const cookie = encodeWalletCookie(EVM_WALLET);

    // Before revocation: valid.
    expect(decodeWalletCookie(cookie)).toBe(EVM_WALLET);

    // Revoke.
    revokeWalletSession(cookie, "test_revocation");

    // After revocation: invalid.
    expect(decodeWalletCookie(cookie)).toBeUndefined();
  });

  it("revocation does not affect other session tokens", () => {
    const cookieA = encodeWalletCookie(EVM_WALLET);
    const cookieB = encodeWalletCookie("0x1111111111111111111111111111111111111111");

    revokeWalletSession(cookieA, "revoke_a_only");

    expect(decodeWalletCookie(cookieA)).toBeUndefined();
    expect(decodeWalletCookie(cookieB)).toBe("0x1111111111111111111111111111111111111111");
  });

  it("revoking an empty or malformed cookie is a no-op and does not throw", () => {
    expect(() => revokeWalletSession("")).not.toThrow();
    expect(() => revokeWalletSession("not:a:valid:cookie:value")).not.toThrow();
  });

  it("revoked token stays revoked after re-encode of same wallet", () => {
    const cookieA = encodeWalletCookie(EVM_WALLET);
    revokeWalletSession(cookieA, "test");
    expect(decodeWalletCookie(cookieA)).toBeUndefined();

    // A freshly minted cookie for the same wallet (different HMAC signature
    // because encodeWalletCookie is deterministic — same wallet → same sig)
    // should also be revoked because the token key is `wallet:sig`.
    const cookieB = encodeWalletCookie(EVM_WALLET);
    expect(cookieB).toBe(cookieA); // deterministic encoding
    expect(decodeWalletCookie(cookieB)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Existing cookie encode/decode round-trips (regression guard)
// ---------------------------------------------------------------------------
describe("walletSession cookie encode/decode", () => {
  beforeEach(clearNonceStores);

  it("round-trips an EVM wallet address", () => {
    const cookie = encodeWalletCookie(EVM_WALLET);
    expect(decodeWalletCookie(cookie)).toBe(EVM_WALLET);
  });

  it("returns undefined for a tampered cookie", () => {
    const cookie = encodeWalletCookie(EVM_WALLET);
    const tampered = cookie.slice(0, -4) + "XXXX";
    expect(decodeWalletCookie(tampered)).toBeUndefined();
  });

  it("returns undefined for a missing cookie", () => {
    expect(decodeWalletCookie(null)).toBeUndefined();
    expect(decodeWalletCookie(undefined)).toBeUndefined();
    expect(decodeWalletCookie("")).toBeUndefined();
  });
});
