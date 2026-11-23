import { NextResponse } from "next/server";
import { jsonError } from "@/server/api/errors";
import { withApiHandler } from "@/server/api/withApiHandler";
import { scanTokenBodySchema } from "@/server/security/inputValidation";
import { gateFeature } from "@/server/features/evaluator";
import { withCacheHeaders } from "@/server/cache/strategy";
import { runTokenScan } from "@/server/scan/tokenScan";
import { buildServerTimingHeader, createPhaseTimer, recordApiTiming } from "@/server/observability/timing";
import { createCacheKey, getOrLoad, serverCache, walletCacheTag, resourceCacheTag } from "@/server/cache";

const API_TIMING_ROUTE = "scan:token";

export const POST = withApiHandler(
  {
    schema: scanTokenBodySchema,
    rateLimit: "tokenScan",
    maxBodyBytes: 8 * 1024,
    routeName: API_TIMING_ROUTE,
  },
  async ({ data, requestStartedAt }) => {
    const scanGate = gateFeature("scan_token", data.walletAddress ?? "");
    if (!scanGate.enabled) {
      return jsonError({
        code: "feature_disabled",
        message: "This feature is not available for the requested account.",
        status: 403,
        details: { feature: "scan_token", detail: scanGate.detail },
      });
    }

    const timer = createPhaseTimer();
    const chainFamily = data.chain?.startsWith("stellar") ? "stellar" : "evm";
    const cached = await getOrLoad({
      store: serverCache,
      key: createCacheKey({ chainFamily, network: data.chain ?? "legacy-evm", walletAddress: data.walletAddress, resource: "scan", params: { query: data.query } }),
      loader: () => runTokenScan(data.query, data.chain, data.walletAddress, timer),
      ttlMs: 15_000,
      staleMs: 30_000,
      tags: [resourceCacheTag("scan"), data.walletAddress ? walletCacheTag(data.walletAddress) : "anonymous"],
    });
    if (cached.state === "negative") {
      return jsonError({ code: "provider_timeout", message: "Scan provider is temporarily unavailable.", status: 503 });
    }
    const result = cached.value;
    const timing = timer.finish();

    recordApiTiming(API_TIMING_ROUTE, performance.now() - requestStartedAt);

    const response = withCacheHeaders(NextResponse.json({ ...result, timing }), "scan");
    response.headers.set("X-Cache-Status", cached.state);
    response.headers.set("Server-Timing", buildServerTimingHeader(timing));

    return response;
  },
);
