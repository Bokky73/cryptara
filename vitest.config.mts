import { createRequire } from "node:module";

// Keep `npx --prefix frontend vitest run ...` working from the repository root
// while reusing the frontend's installed toolchain and alias configuration.
const require = createRequire(new URL("./frontend/package.json", import.meta.url));
const { defineConfig } = require("vitest/config") as typeof import("vitest/config");
const react = (require("@vitejs/plugin-react") as typeof import("@vitejs/plugin-react")).default;

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    restoreMocks: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
