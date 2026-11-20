import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === "development";

// WalletConnect relay and verification endpoints
const walletConnectOrigins = "https://*.walletconnect.com https://*.walletconnect.org https://relay.walletconnect.com https://verify.walletconnect.com";
// RainbowKit asset CDN
const rainbowKitOrigins = "https://assets.coingecko.com https://tokens.1inch.io https://raw.githubusercontent.com";
// Stellar Horizon and Soroban RPC endpoints
const stellarOrigins = "https://horizon.stellar.org https://horizon-testnet.stellar.org https://mainnet.sorobanrpc.com https://soroban-rpc.testnet.stellar.gateway.fm https://soroban-rpc.mainnet.stellar.gateway.fm https://horizon.stellar.lobstr.co";
// EVM RPC endpoints (Base, GOAT Network)
const evmRpcOrigins = "https://rpc.goat.network https://mainnet.base.org https://sepolia.base.org https://*.base.org";
// WalletConnect explorer and metadata API
const walletConnectApiOrigins = "https://explorer-api.walletconnect.com https://api.web3modal.org";

const cspHeader = [
  "default-src 'self'",
  // Scripts: allow self + inline (required for Next.js runtime chunks) + eval in dev only
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Styles: RainbowKit injects inline styles
  "style-src 'self' 'unsafe-inline'",
  // Images: wallet icons and token logos arrive from various CDNs
  `img-src 'self' blob: data: ${rainbowKitOrigins} https://*.walletconnect.com`,
  // Fonts: self only
  "font-src 'self'",
  // XHR/fetch: all RPC, API, and wallet relay endpoints
  `connect-src 'self' wss://*.walletconnect.com wss://*.walletconnect.org ${walletConnectOrigins} ${walletConnectApiOrigins} ${stellarOrigins} ${evmRpcOrigins}`,
  // Frames: WalletConnect modal uses an iframe for QR and deep-link flows
  `frame-src 'self' https://*.walletconnect.com https://*.walletconnect.org`,
  // Service worker: same origin only
  "worker-src 'self' blob:",
  // Manifests
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // frame-ancestors is handled by X-Frame-Options; include both for defence-in-depth
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: cspHeader,
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        // Apply to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
