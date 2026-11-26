import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as exportRoute } from "@/app/api/watchlist/export/route";
import { POST } from "@/app/api/watchlist/import/route";
import { applyWalletCookie, readWalletSessionCookie, WALLET_SESSION_COOKIE } from "@/server/security/walletSession";
import type { WatchlistEntry } from "@/server/types";

const storage = vi.hoisted(() => ({
  entries: [] as unknown[],
  add: vi.fn((inputs: unknown[]) => ({ appliedCount: inputs.length })),
  update: vi.fn(),
}));
vi.mock("@/server/storage", () => ({
  addWatchlistEntriesBulk: storage.add,
  ensureStorageReady: async () => undefined,
  listWatchlistEntries: () => storage.entries,
  updateWatchlistEntryDetails: storage.update,
}));
vi.mock("@/server/discovery/watchlist", () => ({ listWatchlist: () => storage.entries }));

const wallet = `0x${"a".repeat(40)}`;
const address = (digit: string) => `0x${digit.repeat(40)}`;
const row = (digit: string, symbol: string) => ({ version: "1.0.0", chain: "base", contractAddress: address(digit), symbol });

/** The cookie exactly as a browser would return it. */
function issuedCookie(sessionWallet: string) {
  return applyWalletCookie(NextResponse.json({}), sessionWallet).headers.get("set-cookie")!.split(";")[0];
}

function call(entries: unknown[], query = "", sessionWallet: string | null = wallet) {
  return POST(new NextRequest(`https://app.test/api/watchlist/import?wallet=${wallet}${query}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionWallet ? { cookie: issuedCookie(sessionWallet) } : {}),
    },
    body: JSON.stringify({ entries }),
  }));
}

beforeEach(() => {
  storage.entries = [{ id: "w1", chain: "base", contractAddress: address("1"), identityKey: "any" } as WatchlistEntry];
  storage.add.mockClear();
  storage.update.mockClear();
});

describe("session cookie", () => {
  const read = (cookie: string) => readWalletSessionCookie(new NextRequest("https://app.test/", { headers: { cookie } }));

  it("round-trips the cookie the server issues", () => {
    expect(read(issuedCookie(wallet))).toBe(wallet);
  });

  it.each([`v2%3A${wallet}%3A0000000000000000`, "%E0%A4%A", `v1%3A${wallet}`])("rejects the forged or malformed value %s", (value) => {
    expect(read(`${WALLET_SESSION_COOKIE}=${value}`)).toBeUndefined();
  });
});

describe("watchlist import route", () => {
  it.each([["no session", null, 401], ["another wallet's session", `0x${"b".repeat(40)}`, 403]])("rejects %s", async (_label, session, status) => {
    expect((await call([row("2", "NEW")], "", session)).status).toBe(status);
    expect(storage.add).not.toHaveBeenCalled();
  });

  it("requires the owner's session to export", async () => {
    const response = await exportRoute(new NextRequest(`https://app.test/api/watchlist/export?wallet=${wallet}`));
    expect(response.status).toBe(401);
  });

  it("skips duplicates by default", async () => {
    const body = await (await call([row("1", "OLD"), row("2", "NEW"), row("2", "AGAIN")])).json();
    expect(body).toMatchObject({ appliedCount: 1, updatedCount: 0, skippedCount: 2 });
    expect(storage.update).not.toHaveBeenCalled();
    expect(storage.add.mock.calls[0][0]).toEqual([expect.objectContaining({ symbol: "NEW", walletAddress: wallet })]);
  });

  it("updates existing and repeated rows on request", async () => {
    const body = await (await call([row("1", "OLD"), row("2", "NEW"), row("2", "AGAIN")], "&strategy=update")).json();
    expect(body.result.results.map((entry: { outcome: string }) => entry.outcome)).toEqual(["updated", "imported", "updated"]);
    expect(storage.update).toHaveBeenCalledWith("w1", { symbol: "OLD" });
    expect(storage.add.mock.calls[0][0]).toEqual([expect.objectContaining({ symbol: "AGAIN" })]);
  });

  it("applies nothing when any row is invalid", async () => {
    const response = await call([row("2", "NEW"), { ...row("3", "BAD"), chain: "nowhere" }], "&strategy=update");
    expect(response.status).toBe(400);
    expect(storage.add).not.toHaveBeenCalled();
    expect(storage.update).not.toHaveBeenCalled();
  });

  it("does not write on a dry run", async () => {
    expect(await (await call([row("2", "NEW")], "&dry_run=true")).json()).toMatchObject({ validCount: 1 });
    expect(storage.add).not.toHaveBeenCalled();
  });

  it.each([["strategy", [], "&strategy=overwrite", 400], ["row count", Array(1001).fill(row("2", "X")), "", 413]])("bounds the %s", async (_label, entries, query, status) => {
    expect((await call(entries, query)).status).toBe(status);
  });
});
