import type { Metadata } from "next";
import Script from "next/script";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { WebVitalsReporter } from "@/components/WebVitalsReporter";
import { OfflineInteractionGuard } from "@/components/OfflineInteractionGuard";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { THEME_STORAGE_KEY } from "@/theme/useTheme";

export const metadata: Metadata = {
  title: "Cryptara | AI Crypto Guardian",
  description: "Multi-agent crypto portfolio intelligence and user-authorized execution for GOAT Network.",
  icons: {
    icon: "/brand/logo.png",
    shortcut: "/brand/logo.png",
    apple: "/brand/logo.png",
  },
  manifest: "/manifest.webmanifest",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#050505" },
  ],
};

const themeBootstrapScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k);var allowed=["light","dark","system","high-contrast"];var theme=allowed.indexOf(t)>=0?t:"dark";document.documentElement.setAttribute("data-theme",theme);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrapScript}
        </Script>
      </head>
      <body className="min-h-full bg-background text-foreground">
        <WebVitalsReporter />
        <ServiceWorkerRegister />
        <OfflineInteractionGuard />
        <ThemeProvider>
          <Web3Provider>{children}</Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
