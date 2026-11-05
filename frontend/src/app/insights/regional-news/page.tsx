import { AppShell } from "@/components/AppShell";
import { RegionalNewsWorkspace } from "@/components/research/regional-news/RegionalNewsWorkspace";

export const metadata = {
  title: "Regional news | Cryptara",
  description: "Regional source coverage with language and translation evidence.",
};

export default function Page() {
  return (
    <AppShell>
      <RegionalNewsWorkspace />
    </AppShell>
  );
}
