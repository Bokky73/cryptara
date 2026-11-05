import type { Page } from "@playwright/test";
import { STELLAR_WALLET } from "./tokens";

export async function installMockStellarWallet(
  page: Page,
  options: { address?: string; network?: "stellar-testnet" | "stellar-pubnet" } = {},
) {
  const address = options.address ?? STELLAR_WALLET;
  const network = options.network ?? "stellar-testnet";

  await page.addInitScript(({ walletAddress, walletNetwork }) => {
    window.__GR_E2E_WALLET__ = {
      family: "stellar",
      address: walletAddress,
      network: walletNetwork,
      walletName: "Freighter (e2e)",
    };
    window.localStorage.setItem("cryptara:selected-wallet-family:v1", "stellar");
    window.localStorage.setItem(
      "cryptara:stellar-display-session:v1",
      JSON.stringify({
        version: 1,
        walletId: "freighter",
        walletName: "Freighter (e2e)",
        adapter: "freighter",
        address: walletAddress,
        network: walletNetwork,
      }),
    );
  }, { walletAddress: address, walletNetwork: network });
}

export async function mockStellarWalletSession(page: Page, address = STELLAR_WALLET) {
  await page.route("**/api/wallet-session/nonce", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        nonce: "e2e-stellar",
        challengeXdr: "AAAAAgAAAABeMock=",
        family: "stellar",
        walletAddress: address,
        issuedAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2024-01-01T01:00:00.000Z",
        network: "Test SDF Network ; September 2015",
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
