import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia } from "wagmi/chains";
import { goatNetwork } from "./chains";

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : "http://localhost:3000");

export const wagmiConfig = getDefaultConfig({
  appName: "Cryptara",
  appDescription: "Multi-agent portfolio intelligence",
  appUrl,
  appIcon: `${appUrl}/brand/logo.png`,
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "cryptara-demo",
  chains: [goatNetwork, baseSepolia, base],
  ssr: true,
});
