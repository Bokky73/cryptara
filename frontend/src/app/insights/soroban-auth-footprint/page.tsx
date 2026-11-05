import { AppShell } from "@/components/AppShell";
import { SorobanAuthFootprintInspector } from "@/components/research/soroban-auth-footprint/SorobanAuthFootprintInspector";

export const metadata = { title: "Soroban auth footprint | Cryptara" };

export default function Page() {
  return (
    <AppShell>
      <SorobanAuthFootprintInspector />
    </AppShell>
  );
}
