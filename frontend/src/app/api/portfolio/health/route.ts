import { NextResponse } from "next/server";
import { apiCacheStrategy } from "@/server/cache/strategy";
import { getAgentReadiness, getEnvHealth } from "@/server/env/validation";
import { getPortfolioProviderHealth } from "@/server/portfolio/getPortfolio";
import { getSecurityHealth } from "@/server/security/policy";
import { getStorageCounts, getStorageHealth } from "@/server/storage";

export async function GET() {
  return NextResponse.json({
    providers: getPortfolioProviderHealth(),
    env: getEnvHealth(),
    agentReadiness: getAgentReadiness(),
    storage: await getStorageHealth(),
    storageCounts: await getStorageCounts(),
    security: getSecurityHealth(),
    cache: apiCacheStrategy,
    mockFallbacksEnabled: false,
    fallbackOrder: ["Stellar RPC + data API", "GoldRush/Covalent", "Alchemy", "Public EVM RPC", "GOAT RPC", "Unavailable empty portfolio"],
    checkedAt: new Date().toISOString(),
  });
}
