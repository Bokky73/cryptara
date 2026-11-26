import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { VenueTimelineWorkspace } from "@/components/research/venue-timeline/VenueTimelineWorkspace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Venue timeline",
  description: "Map where a token is and was tradable across configured venues.",
};

export default function VenueTimelinePage() {
  return (
    <InsightPageShell
      id="venue-timeline"
      title="Venue timeline"
      description="Listings, pauses, and delistings are matched by chain and contract address. An unreachable venue stays unknown."
    >
      <VenueTimelineWorkspace />
    </InsightPageShell>
  );
}
