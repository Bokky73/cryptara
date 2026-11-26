import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { SorobanAuthFootprintInspector } from "@/components/research/soroban-auth-footprint/SorobanAuthFootprintInspector";

export const metadata = { title: "Soroban auth footprint | Cryptara" };

export default function Page() {
  return (
    <InsightPageShell id="soroban-auth-footprint">
      <SorobanAuthFootprintInspector />
    </InsightPageShell>
  );
}
