import { AppShell } from "@/components/AppShell";
import { NetworkSettingsExplorer } from "@/components/research/network-settings/NetworkSettingsExplorer";

export const metadata = { title: "Network settings | Cryptara" };

export default function Page() {
  return (
    <AppShell>
      <NetworkSettingsExplorer />
    </AppShell>
  );
}
