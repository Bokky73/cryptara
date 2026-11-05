import { defineConfig } from "@playwright/test";
import {resolve} from "node:path";
export default defineConfig({
  testDir: ".", testMatch: "journey.spec.ts", workers: 1,
  reporter: "list", use: { baseURL: "http://localhost:3196", browserName: "chromium", trace: "retain-on-failure" },
  webServer: { command: "node node_modules/next/dist/bin/next dev -p 3196", cwd: resolve(__dirname,"../../.."), port: 3196, timeout: 180000,
    env: { APP_MODE: "test", NEXT_PUBLIC_APP_MODE: "test", NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "cryptara-demo" } },
});
