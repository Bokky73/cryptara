import { VenueTimelineWorkspace } from "@/components/research/venue-timeline/VenueTimelineWorkspace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Venue timeline",
  description: "Map where a token is and was tradable across configured venues.",
};

export default function VenueTimelinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.18em]">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Venue timeline</h1>
        <p className="max-w-3xl text-sm">
          Listings, pauses, and delistings are matched by chain and contract address. An unreachable venue stays unknown.
        </p>
      </header>
      <VenueTimelineWorkspace />
    </main>
  );
}
