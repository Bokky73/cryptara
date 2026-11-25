import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { IssuerControlInspector } from "@/components/research/issuer-control/IssuerControlInspector";

export const metadata = { title: "Issuer control inspector | Cryptara" };

export default function Page() {
  return (
    <InsightPageShell id="issuer-control">
      <IssuerControlInspector />
    </InsightPageShell>
  );
}
