import { AppShell } from "@/components/AppShell";
import { AuthorityHistory } from "@/components/research/authority-history/AuthorityHistory";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Authority history | Cryptara",
  description:
    "Read-only Ownable and AccessControl change history at explicit EVM blocks, with proxy admin kept separate.",
};

export default function AuthorityHistoryPage() {
  return (
    <AppShell>
      <AuthorityHistory />
    </AppShell>
  );
}
