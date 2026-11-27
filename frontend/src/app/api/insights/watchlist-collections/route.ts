import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/server/security/rateLimit";
import { listWatchlist } from "@/server/discovery/watchlist";
import { COLLECTION_LIMITS, CollectionsError, type OwnerScope } from "@/server/research/watchlist-collections/schema";
import { createMemoryCollectionsRepository } from "@/server/research/watchlist-collections/memoryRepository";
import { runCollectionsCommand } from "@/server/research/watchlist-collections/service";
import type { CollectionsRepository } from "@/server/research/watchlist-collections/repository";

/**
 * Wallet-scoped CRUD over collection metadata.
 *
 * Authorization is the feature's own: every command carries its owner, the
 * service filters every read and write by that owner, and an id belonging to
 * another wallet produces `not_found` rather than `forbidden` — so the endpoint
 * cannot be used to discover which ids exist.
 *
 * Nothing here creates, changes or removes a watched asset. The watchlist is
 * read once, to check that a membership points at something that exists.
 */
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" } as const;

/**
 * One repository for the process.
 *
 * The memory implementation is the default; a deployment with PostgreSQL wires
 * `createPostgresCollectionsRepository` here against its pool. Both are covered
 * by the same conformance suite, so the swap changes durability and nothing
 * else.
 */
let repository: CollectionsRepository | null = null;

function getRepository(): CollectionsRepository {
  repository ??= createMemoryCollectionsRepository();

  return repository;
}

/** Test seam: lets the conformance harness drive the real handler. */
export function setCollectionsRepository(next: CollectionsRepository | null) {
  repository = next;
}

async function watchlistEntryIds(owner: OwnerScope): Promise<string[]> {
  const entries = await listWatchlist(owner.walletAddress);
  return entries
    .filter((entry) => (entry.network ?? entry.chain ?? "").toLowerCase() === owner.network.toLowerCase())
    .map((entry) => entry.id);
}

export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimit(request, { namespace: "watchlist-collections", limit: 60, windowMs: 60_000 });

  if (rateLimited) {
    return rateLimited;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(declaredLength) && declaredLength > COLLECTION_LIMITS.maxRequestBytes) {
    return NextResponse.json({ error: "payload_too_large", limitBytes: COLLECTION_LIMITS.maxRequestBytes }, { status: 413 });
  }

  let body: unknown;

  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await runCollectionsCommand(body, {
      repository: getRepository(),
      now: () => new Date().toISOString(),
      newId: (kind) => `${kind}-${crypto.randomUUID()}`,
      listWatchlistEntryIds: watchlistEntryIds,
    });

    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    if (error instanceof CollectionsError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: error.status, headers: noStore },
      );
    }

    return NextResponse.json({ error: "collections_command_failed" }, { status: 500, headers: noStore });
  }
}
