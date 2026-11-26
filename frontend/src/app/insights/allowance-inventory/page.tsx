import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { AllowanceInventory } from "@/components/research/allowance-inventory/AllowanceInventory";

export const metadata = { title: "Allowance inventory | Cryptara" };

export default function AllowanceInventoryPage() {
  return (
    <InsightPageShell id="allowance-inventory">
      <AllowanceInventory />
    </InsightPageShell>
  );
}
