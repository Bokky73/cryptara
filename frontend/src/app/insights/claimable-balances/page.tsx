import { AppShell } from "@/components/AppShell";
import { ClaimableExplorer } from "@/components/research/claimable-balances/ClaimableExplorer";
export const metadata = { title: "Claimable balances | Cryptara" };
export default function Page() { return <AppShell><ClaimableExplorer /></AppShell>; }
