import { AppShell } from "@/components/AppShell";
import { AllowanceInventory } from "@/components/research/allowance-inventory/AllowanceInventory";

export const metadata = { title: "Allowance inventory | Cryptara" };

export default function AllowanceInventoryPage() {
  return (
    <AppShell>
      <AllowanceInventory />
    </AppShell>
  );
}
