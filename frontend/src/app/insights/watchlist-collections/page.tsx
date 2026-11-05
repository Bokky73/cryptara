import Link from "next/link";
import { CollectionWorkspace } from "@/components/research/watchlist-collections/CollectionWorkspace";
import { listWatchlist } from "@/server/discovery/watchlist";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Watchlist collections",
  description: "Group the assets you watch into collections, tag them, and save the filters you use most.",
};

export default async function WatchlistCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;
  const account = params.account ?? null;
  const network = params.network ?? "ethereum";

  const availableEntryIds = account
    ? listWatchlist(account)
        .filter((entry) => (entry.network ?? entry.chain ?? "").toLowerCase() === network.toLowerCase())
        .map((entry) => entry.id)
    : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Watchlist collections</h1>
        <p className="max-w-3xl text-sm text-muted">
          A flat watchlist stops being useful once it holds more than a screenful. Collections group the assets you already
          watch, tags cut across those groups, and a saved view remembers a filter you return to. All of it is metadata that
          sits beside the watchlist: an asset&rsquo;s identity stays in one place, deleting a collection removes the grouping and
          never the asset, and everything here belongs to one wallet on one network — the same address on another network is a
          different set.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/watchlist" className="underline underline-offset-2">
            Back to the watchlist
          </Link>
        </p>
      </header>

      <CollectionWorkspace account={account} network={network} availableEntryIds={availableEntryIds} />
    </main>
  );
}
