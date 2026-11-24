import { NextResponse } from "next/server";
import { normalizeStellarNetworkId } from "@/lib/stellar/config";
import { createCacheKey, getOrLoad, RISK_REGISTRY_CACHE_TAG, serverCache, stellarRiskCacheTag } from "@/server/cache";
import { withCacheStatus } from "@/server/cache/strategy";
import { readRiskRecord } from "@/server/stellar/riskRegistry";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const network = normalizeStellarNetworkId(params.get("network") ?? undefined);
  const assetKey = params.get("assetKey")?.trim();
  if (!network || !assetKey || assetKey.length > 180) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const cached = await getOrLoad({
      store: serverCache,
      key: createCacheKey({ chainFamily: "stellar", network, resource: "risk-record", params: { assetKey } }),
      loader: () => readRiskRecord(network, assetKey),
      ttlMs: 60_000,
      staleMs: 60_000,
      tags: [RISK_REGISTRY_CACHE_TAG, stellarRiskCacheTag(network, assetKey)],
    });
    if (cached.state === "negative") {
      return NextResponse.json({ error: "risk_registry_unavailable" }, { status: 503 });
    }
    return withCacheStatus(NextResponse.json({ record: cached.value }), cached.state);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read risk record" }, { status: 502 }); }
}
