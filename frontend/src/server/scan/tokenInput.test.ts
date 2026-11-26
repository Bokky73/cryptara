import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeTokenInput } from "@/server/scan/tokenInput";

const address = "0x52908400098527886e0f7030069857d2e4169ee7";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const pairAddress = "0x0000000000000000000000000000000000000001";
const tokenAddress = "0x0000000000000000000000000000000000000002";
const contract = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeTokenInput", () => {
  it("normalizes a DexScreener EVM URL to a pair result", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).includes(`/latest/dex/pairs/base/${zeroAddress}`)) {
        return jsonResponse({
          pairs: [{
            chainId: "base",
            dexId: "aero",
            pairAddress,
            url: `https://dexscreener.com/base/${pairAddress}`,
            baseToken: { address: tokenAddress, symbol: "TOKEN", name: "Token" },
            priceUsd: "2",
            liquidity: { usd: 5000 },
            volume: { h24: 1000 },
          }],
        });
      }

      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await normalizeTokenInput(`https://dexscreener.com/base/${zeroAddress}`);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/pairs/base/${zeroAddress}`);
    expect(result).toMatchObject({
      chain: "base",
      contractAddress: tokenAddress,
      pairAddress,
      symbol: "TOKEN",
      source: "dexscreener_pair_url",
    });
  });

  it("routes DexScreener Stellar URLs through Stellar asset identity", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    vi.stubGlobal("fetch", fetchMock);

    const result = await normalizeTokenInput(`https://dexscreener.com/stellar/${contract}`);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      chain: "stellar-testnet",
      contractAddress: contract,
      assetKey: `contract:${contract}`,
      source: "contract_address",
    });
  });

  it("preserves non-Dex contract address input", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).includes("/latest/dex/search?q=")) {
        return jsonResponse({
          pairs: [{
            chainId: "base",
            dexId: "aero",
            pairAddress,
            baseToken: { address, symbol: "TOKEN" },
            liquidity: { usd: 100 },
          }],
        });
      }

      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await normalizeTokenInput(` ${address} `, "base");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`q=${address}`);
    expect(result).toMatchObject({
      chain: "base",
      contractAddress: address,
      pairAddress,
      symbol: "TOKEN",
      source: "contract_address",
    });
  });
});
