import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/server/security/rateLimit";
import { listDiscoveryCandidates } from "@/server/discovery/pipeline";
import { fetchLiveDiscoveryCandidates, isOfflineSnapshot } from "@/server/discovery/sources";

const bodySchema = z.object({
  chain: z.string().min(1).max(64).optional(),
  provider: z.enum(["dexscreener", "stellar_market", "manual"]).default("manual"),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function encodeCursor(candidate: { chain: string; pairAddress: string }): string {
  return Buffer.from(JSON.stringify({ chain: candidate.chain, pairAddress: candidate.pairAddress }), "utf8")
    .toString("base64url");
}

function decodeCursor(cursor: string): { chain: string; pairAddress: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.chain !== "string" || typeof parsed?.pairAddress !== "string") {
      return null;
    }
    return { chain: parsed.chain, pairAddress: parsed.pairAddress };
  } catch {
    return null;
  }
}

function compareCandidates(
  a: { chain: string; pairAddress: string },
  b: { chain: string; pairAddress: string },
): number {
  if (a.chain !== b.chain) {
    return a.chain < b.chain ? -1 : 1;
  }
  if (a.pairAddress !== b.pairAddress) {
    return a.pairAddress < b.pairAddress ? -1 : 1;
  }
  return 0;
}

export async function POST(request: Request) {
  const rateLimited = checkRateLimit(request, { namespace: "discovery:candidates", limit: 30, windowMs: 60_000 });

  if (rateLimited) {
    return rateLimited;
  }

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse({
    ...(typeof body === "object" && body !== null ? body : {}),
    cursor: url.searchParams.get("cursor") ?? (body as { cursor?: unknown })?.cursor,
    limit: url.searchParams.get("limit") ?? (body as { limit?: unknown })?.limit,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;

  if (parsed.data.cursor && !cursor) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  const candidates = await listDiscoveryCandidates(parsed.data.chain, {
    listCandidates: async (chain) => {
      const live = await fetchLiveDiscoveryCandidates(chain);
      const filteredByProvider = parsed.data.provider === "manual"
        ? live.candidates
        : live.candidates.filter((candidate) => candidate.source === parsed.data.provider);

      return filteredByProvider;
    },
  });

  const ordered = [...candidates].sort(compareCandidates);
  const startIndex = cursor
    ? ordered.findIndex((candidate) => compareCandidates(candidate, cursor) > 0)
    : 0;
  const pageStart = startIndex === -1 ? ordered.length : startIndex;
  const page = ordered.slice(pageStart, pageStart + parsed.data.limit);
  const hasMore = pageStart + parsed.data.limit < ordered.length;
  const nextCursor = hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null;

  return NextResponse.json({
    candidates: page,
    nextCursor,
    origin: {
      source: page.some((candidate) => isOfflineSnapshot(candidate))
        ? "offline_snapshot"
        : "live_provider",
      fetchedAt: new Date().toISOString(),
    },
  });
}
