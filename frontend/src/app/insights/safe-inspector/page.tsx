import { SafeInspectorWorkspace } from "@/components/research/safe-inspector/SafeInspectorWorkspace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Safe inspector",
  description: "Read Safe owners, threshold, modules, guard, and fallback handler.",
};

export default function SafeInspectorPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.18em]">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Safe inspector</h1>
        <p className="max-w-3xl text-sm">
          Owners, the confirmation threshold, enabled modules, the transaction guard, and the fallback handler are read
          at one pinned block. An unknown module is unreviewed, not labelled malicious.
        </p>
      </header>
      <SafeInspectorWorkspace />
    </main>
  );
}
