import type { Page } from "@playwright/test";
import { EVM_WALLET } from "./tokens";

export async function installMockEvmWallet(page: Page, options: { address?: string; chainId?: number } = {}) {
  const address = options.address ?? EVM_WALLET;
  const chainId = options.chainId ?? 8453;

  await page.addInitScript(({ walletAddress, walletChainId }) => {
    window.__GR_E2E_WALLET__ = {
      family: "evm",
      address: walletAddress,
      chainId: walletChainId,
      chainName: "Base",
    };
    window.localStorage.setItem("cryptara:selected-wallet-family:v1", "evm");
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: {
        isMetaMask: true,
        chainId: `0x${walletChainId.toString(16)}`,
        request: async ({ method }: { method: string }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [walletAddress];
          if (method === "eth_chainId") return `0x${walletChainId.toString(16)}`;
          if (method === "personal_sign" || method === "eth_signTypedData_v4") return "0xe2e_mock_signature";
          return null;
        },
        on: () => undefined,
        removeListener: () => undefined,
      },
    });
  }, { walletAddress: address, walletChainId: chainId });
}

export async function mockEvmWalletSession(page: Page, address = EVM_WALLET) {
  await page.route("**/api/wallet-session/nonce", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        nonce: "e2e-evm",
        challenge: "e2e",
        family: "evm",
        walletAddress: address,
        issuedAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2024-01-01T01:00:00.000Z",
        network: null,
      }),
    }),
  );
  await page.route("**/api/wallet-session", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    } else if (method === "DELETE") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    } else {
      await route.continue();
    }
  });
}
