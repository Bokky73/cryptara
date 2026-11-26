import { describe, expect, it } from "vitest";
import { isSupportedScanNetwork, parseTokenQuery } from "@/lib/tokenQuery";

const lowerEvm = "0x52908400098527886e0f7030069857d2e4169ee7";
const checksumEvm = "0x52908400098527886E0F7030069857D2E4169EE7";
const badChecksumEvm = "0x52908400098527886E0F7030069857D2E4169Ee7";
const issuer = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const contract = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const zeroAddress = "0x0000000000000000000000000000000000000000";

describe("parseTokenQuery", () => {
  it("accepts lowercase EVM addresses and normalizes them", () => {
    expect(parseTokenQuery(`  ${lowerEvm}  `)).toEqual({
      ok: true,
      kind: "evm-address",
      query: checksumEvm,
      address: checksumEvm,
    });
  });

  it("accepts all-uppercase and valid mixed-case EVM addresses", () => {
    expect(parseTokenQuery(`0x${lowerEvm.slice(2).toUpperCase()}`)).toMatchObject({ ok: true, address: checksumEvm });
    expect(parseTokenQuery(checksumEvm)).toEqual({
      ok: true,
      kind: "evm-address",
      query: checksumEvm,
      address: checksumEvm,
    });
  });

  it("warns but permits mixed-case EVM addresses with a bad checksum", () => {
    expect(parseTokenQuery(badChecksumEvm)).toEqual({
      ok: true,
      kind: "evm-address",
      query: checksumEvm,
      address: checksumEvm,
      warning: "invalid_evm_checksum",
    });
    expect(parseTokenQuery(badChecksumEvm, { chain: "base" }).suggestedChain).toBeUndefined();
  });

  it("rejects malformed EVM addresses", () => {
    expect(parseTokenQuery("0x1234")).toEqual({ ok: false, code: "invalid_evm_address" });
    expect(parseTokenQuery(`0x${"z".repeat(40)}`)).toEqual({ ok: false, code: "invalid_evm_address" });
  });

  it("accepts Stellar classic assets including native XLM", () => {
    expect(parseTokenQuery(`USD:${issuer}`)).toEqual({
      ok: true,
      kind: "stellar-classic",
      query: `USD:${issuer}`,
      address: issuer,
      suggestedChain: "stellar-testnet",
    });
    expect(parseTokenQuery("XLM")).toMatchObject({ ok: true, kind: "stellar-classic", query: "XLM", address: "XLM", suggestedChain: "stellar-testnet" });
    expect(parseTokenQuery("native")).toMatchObject({ ok: true, kind: "stellar-classic", query: "XLM", address: "XLM", suggestedChain: "stellar-testnet" });
    expect(parseTokenQuery("XLM", { chain: "stellar-pubnet" })).toMatchObject({ suggestedChain: "stellar-pubnet" });
  });

  it("accepts Soroban contract IDs", () => {
    expect(parseTokenQuery(contract)).toEqual({
      ok: true,
      kind: "soroban-contract",
      query: contract,
      address: contract,
      suggestedChain: "stellar-testnet",
    });
  });

  it("rejects truncated Stellar issuers and contract IDs", () => {
    expect(parseTokenQuery(`USD:${issuer.slice(0, 40)}`)).toMatchObject({ ok: false, code: "invalid_stellar_asset" });
    expect(parseTokenQuery(contract.slice(0, 40))).toMatchObject({ ok: false, code: "invalid_stellar_asset" });
    expect(parseTokenQuery("TOO-LONG-ASSET-CODE:GABC")).toMatchObject({ ok: false, code: "invalid_stellar_asset" });
  });

  it("parses DexScreener EVM pair URLs", () => {
    const url = `https://dexscreener.com/base/${zeroAddress}`;

    expect(parseTokenQuery(url)).toEqual({
      ok: true,
      kind: "dexscreener-url",
      query: url,
      address: zeroAddress,
      suggestedChain: "base",
      pairAddress: zeroAddress,
    });
    expect(parseTokenQuery(`https://www.dexscreener.com/token/${lowerEvm}`, { chain: "base" })).toMatchObject({
      ok: true,
      kind: "dexscreener-url",
      address: checksumEvm,
      suggestedChain: "base",
    });
  });

  it("parses DexScreener Stellar URLs", () => {
    const url = `https://dexscreener.com/stellar/${contract}`;

    expect(parseTokenQuery(url)).toEqual({
      ok: true,
      kind: "dexscreener-url",
      query: url,
      address: contract,
      suggestedChain: "stellar-testnet",
      pairAddress: contract,
    });
  });

  it("rejects malicious hosts, non-HTTPS URLs, and unsupported Dex chains", () => {
    expect(parseTokenQuery(`https://dexscreener.com.evil.test/base/${zeroAddress}`)).toEqual({ ok: false, code: "invalid_dexscreener_url" });
    expect(parseTokenQuery(`http://dexscreener.com/base/${zeroAddress}`)).toEqual({ ok: false, code: "invalid_dexscreener_url" });
    expect(parseTokenQuery("https://dexscreener.com/solana/abc")).toEqual({ ok: false, code: "unsupported_dexscreener_chain" });
    expect(parseTokenQuery("https://dexscreener.com/base/nope")).toEqual({ ok: false, code: "invalid_dexscreener_url" });
  });

  it("keeps bare symbols backwards compatible", () => {
    expect(parseTokenQuery(" MEME ")).toEqual({ ok: true, kind: "symbol", query: "MEME", address: "" });
  });

  it("rejects empty and oversized input", () => {
    expect(parseTokenQuery("   ")).toEqual({ ok: false, code: "empty" });
    expect(parseTokenQuery("a".repeat(261))).toEqual({ ok: false, code: "too_long" });
    expect(parseTokenQuery("a".repeat(260))).toMatchObject({ ok: true, kind: "symbol" });
  });

  it("checks supported scan networks", () => {
    expect(isSupportedScanNetwork("base")).toBe(true);
    expect(isSupportedScanNetwork("stellar")).toBe(true);
    expect(isSupportedScanNetwork("unknown-chain")).toBe(false);
    expect(isSupportedScanNetwork()).toBe(false);
  });
});
