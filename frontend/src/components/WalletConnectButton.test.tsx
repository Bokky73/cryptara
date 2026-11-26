import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WalletConnectButton } from "@/components/WalletConnectButton";

vi.mock("next/dynamic", async () => {
  const { WalletSessionDialog } = await import("./wallet/WalletSessionDialog");
  return { default: () => WalletSessionDialog };
});

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  selectFamily: vi.fn(),
  openConnectModal: vi.fn(),
}));

vi.mock("@/components/NetworkMismatchNotice", () => ({ NetworkMismatchNotice: () => null }));
vi.mock("@/components/WalletBadge", () => ({ WalletBadge: () => null }));

vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: {
    Custom: ({ children }: { children: (state: object) => React.ReactNode }) => children({
      account: undefined,
      chain: undefined,
      mounted: true,
      openAccountModal: vi.fn(),
      openChainModal: vi.fn(),
      openConnectModal: mocks.openConnectModal,
    }),
  },
}));

vi.mock("@/hooks/useWalletSession", () => ({
  useWalletSession: () => ({
    family: null,
    selectedFamily: null,
    selectFamily: mocks.selectFamily,
    address: undefined,
    chain: undefined,
    walletType: undefined,
    explorerUrl: undefined,
    signerCapability: "unavailable",
    isConnecting: false,
    isRestored: false,
    connectedFamilies: { evm: false, stellar: false },
    stellar: {
      connect: mocks.connect,
      isConnecting: false,
      mobileAvailable: true,
      isRestored: false,
      displayAddress: undefined,
      error: undefined,
      mismatchMessage: null,
    },
  }),
}));

describe("WalletConnectButton", () => {
  beforeEach(() => {
    mocks.connect.mockClear();
    mocks.selectFamily.mockClear();
  });

  it("is keyboard accessible and closes the selector with Escape", async () => {
    render(<WalletConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    await screen.findByRole("dialog", { name: "Wallet session" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close wallet selector" })));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Wallet session" })).toBeNull());
  });

  it("routes the mobile-compatible flow to WalletConnect", async () => {
    render(<WalletConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mobile Stellar wallet/ }));

    expect(mocks.selectFamily).toHaveBeenCalledWith("stellar");
    expect(mocks.connect).toHaveBeenCalledWith("wallet_connect");
  });
});
