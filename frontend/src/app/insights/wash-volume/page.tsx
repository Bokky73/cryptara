import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { WashVolumeWorkspace } from "@/components/research/wash-volume/WashVolumeWorkspace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Wash volume",
  description: "Show how much reported volume survives each wash-trading filter.",
};

export default function WashVolumePage() {
  return (
    <InsightPageShell
      id="wash-volume"
      title="Wash volume"
      description="Filters for self-trades, shared funding, back-and-forth flow, and repeated round amounts are heuristic evidence. Each filter shows the trades it excludes."
    >
      <WashVolumeWorkspace />
    </InsightPageShell>
  );
}
