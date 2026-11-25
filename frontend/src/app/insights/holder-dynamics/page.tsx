import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { HolderDynamicsWorkspace } from "@/components/research/holder-dynamics/HolderDynamicsWorkspace";
export const metadata = { title: "Holder dynamics | Cryptara" };
export default function Page() {
  return <InsightPageShell id="holder-dynamics"><HolderDynamicsWorkspace /></InsightPageShell>;
}
