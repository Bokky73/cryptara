import { AppShell } from "@/components/AppShell";
import { PathPaymentInspector } from "@/components/research/path-payment/PathPaymentInspector";

export const metadata = { title: "Path-payment inspector | Cryptara" };

export default function Page() {
  return (
    <AppShell>
      <PathPaymentInspector />
    </AppShell>
  );
}
