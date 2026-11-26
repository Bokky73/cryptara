import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { VaultAccountingWorkbench } from "@/components/research/vault-accounting/VaultAccountingWorkbench";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "ERC-4626 vault accounting",
  description: "Read a vault's share price, underlying balance, and deposit rounding before you deposit.",
};

export default function VaultAccountingPage() {
  return (
    <InsightPageShell id="vault-accounting">
      <VaultAccountingWorkbench />
    </InsightPageShell>
  );
}
