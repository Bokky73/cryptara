import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { ProxyInspector } from "@/components/research/proxy-inspector/ProxyInspector";
export const metadata = { title: "Proxy inspector | Cryptara" };
export default function Page() { return <InsightPageShell id="proxy-inspector"><ProxyInspector /></InsightPageShell>; }
