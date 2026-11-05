import { WashVolumeWorkspace } from "@/components/research/wash-volume/WashVolumeWorkspace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Wash volume",
  description: "Show how much reported volume survives each wash-trading filter.",
};

export default function WashVolumePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.18em]">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Wash volume</h1>
        <p className="max-w-3xl text-sm">
          Filters for self-trades, shared funding, back-and-forth flow, and repeated round amounts are heuristic evidence.
          Each filter shows the trades it excludes.
        </p>
      </header>
      <WashVolumeWorkspace />
    </main>
  );
}
