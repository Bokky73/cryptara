import { describe, expect, it } from "vitest";
import {
  escapeWatchlistCsv,
  isSpreadsheetFormula,
  neutralizeSpreadsheetValue,
  parseWatchlistCsv,
  parseWatchlistCsvRows,
} from "@/server/discovery/watchlistCsv";
import { previewWatchlistImport, validateWatchlistImportRow, watchlistAssetKey } from "@/server/discovery/watchlistImport";

const evm = "0x1111111111111111111111111111111111111111";
const issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const contract = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const row = (extra: Record<string, unknown>) => ({ version: "1.0.0", chain: "base", ...extra });

describe("validateWatchlistImportRow", () => {
  it.each([
    ["EVM contract", { contractAddress: evm }],
    ["EVM alias and mainnet", { chain: "Base-Mainnet", network: "mainnet", contractAddress: evm }],
    ["CAIP-2 chain", { chain: "eip155:8453", contractAddress: evm }],
    ["native XLM", { chain: "stellar", network: "pubnet", assetType: "native" }],
    ["classic asset", { chain: "stellar", network: "testnet", assetType: "classic", assetKey: "USDC", issuer }],
    ["form-created classic asset", { chain: "stellar-public", network: "stellar-public", assetType: "classic", assetKey: `USDC:${issuer}`, symbol: "USDC", issuer }],
    ["Soroban contract", { chain: "stellar-testnet", assetType: "sac", contractAddress: contract }],
  ])("accepts a %s", (_label, extra) => {
    expect(validateWatchlistImportRow(row(extra)).errors).toEqual([]);
  });

  it.each([
    ["invalid address", { contractAddress: "0x123" }, "Invalid EVM contract address."],
    ["unknown chain", { chain: "dogechain", contractAddress: evm }, 'Unknown chain "dogechain".'],
    ["unknown network", { network: "sepolia", contractAddress: evm }, 'Unknown network "sepolia".'],
    ["conflicting network", { network: "ethereum", contractAddress: evm }, "Chain and network do not match."],
    ["unknown Stellar network", { chain: "stellar", network: "futurenet", assetType: "native" }, 'Unknown network "futurenet".'],
    ["missing chain", { chain: "", contractAddress: evm }, "Missing chain."],
    ["missing asset", {}, "Missing contract address or other asset identifier."],
    ["symbol-only Stellar asset", { chain: "stellar", assetKey: "USDC" }, "Stellar assets need a full CODE:ISSUER or a contract address."],
    ["bad issuer checksum", { chain: "stellar", assetKey: "USDC", issuer: `${issuer.slice(0, -1)}A` }, "Invalid Stellar issuer address."],
    ["bad contract checksum", { chain: "stellar", contractAddress: `${contract.slice(0, -1)}B` }, "Invalid Stellar contract address."],
    ["SAC without a contract", { chain: "stellar", assetType: "sac" }, "Missing Stellar contract address."],
    ["old version", { version: "0.9", contractAddress: evm }, "Unknown or unsupported schema version."],
    ["unknown source", { contractAddress: evm, source: "evil" }, "Unknown source."],
    ["non-text field", { contractAddress: evm, note: { a: 1 } }, "note must be text."],
    ["long note", { contractAddress: evm, note: "x".repeat(281) }, "note is longer than 280 characters."],
  ])("rejects a row with %s", (_label, extra, message) => {
    expect(validateWatchlistImportRow(row(extra)).errors).toContain(message);
  });

  it.each([null, "text", 3, []])("rejects the non-object %o", (value) => {
    expect(validateWatchlistImportRow(value).errors).toEqual(["Row is not an object."]);
  });
});

describe("watchlistAssetKey", () => {
  it("ignores how the chain and address are spelled", () => {
    expect(watchlistAssetKey({ chain: "base", contractAddress: `0x${"AB".repeat(20)}` }))
      .toBe(watchlistAssetKey({ chain: "eip155:8453", network: "mainnet", contractAddress: `0x${"ab".repeat(20)}` }));
    expect(watchlistAssetKey({ chain: "stellar", network: "public", assetKey: "usdc", issuer }))
      .toBe(watchlistAssetKey({ chain: "stellar-public", assetKey: `USDC:${issuer}` }));
  });

  it("separates networks and issuers", () => {
    const key = (network: string, code: string) => watchlistAssetKey({ chain: "stellar", network, assetKey: code, issuer });
    expect(new Set([key("testnet", "USDC"), key("pubnet", "USDC"), key("pubnet", "EURC")]).size).toBe(3);
  });
});

describe("previewWatchlistImport", () => {
  it("separates valid, duplicate, repeated, and malformed rows", () => {
    const other = `0x${"22".repeat(20)}`;
    const result = previewWatchlistImport([
      { value: row({ contractAddress: evm }) },
      { value: row({ contractAddress: other }) },
      { value: row({ contractAddress: other }) },
      { value: row({ contractAddress: "nope" }) },
      { value: null, error: "Expected 3 columns but found 2." },
    ], [{ chain: "base", contractAddress: evm }]);

    expect(result.results.map((entry) => entry.status)).toEqual(["duplicate", "valid", "duplicate", "invalid", "invalid"]);
    expect(result.results[0].errors).toEqual(["Already in your watchlist."]);
    expect(result.results[2].errors).toEqual(["Repeats an earlier row in this file."]);
    expect(result.results[4].errors).toEqual(["Expected 3 columns but found 2."]);
    expect(result).toMatchObject({ validCount: 1, duplicateCount: 2, invalidCount: 2, totalRows: 5 });
  });
});

describe("CSV safety", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "＝1"])("neutralizes and restores %j", (value) => {
    expect(isSpreadsheetFormula(value)).toBe(true);
    expect(neutralizeSpreadsheetValue(value)).toBe(`'${value}`);
    expect(parseWatchlistCsv(`version,chain,note\n1.0.0,base,${escapeWatchlistCsv(value)}`)[0].note).toBe(value);
  });

  it("leaves ordinary values alone", () => {
    expect(neutralizeSpreadsheetValue("USD Coin")).toBe("USD Coin");
    expect(isSpreadsheetFormula(undefined)).toBe(false);
  });

  it("reports a short row without losing the others", () => {
    const rows = parseWatchlistCsvRows("version,chain,note\n1.0.0,base\n1.0.0,base,ok");
    expect(rows[0].error).toContain("Expected 3 columns");
    expect(rows[1].value?.note).toBe("ok");
  });
});
