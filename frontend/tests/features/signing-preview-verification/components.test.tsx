import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalFlowClient } from "@/components/ApprovalFlowClient";
import { TransactionPreview } from "@/components/TransactionPreview";
import {
  EVM_WALLET,
  TAMPERED_EVM_DATA,
  createEvmFixture,
} from "./fixtures";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const mocks = vi.hoisted(() => ({
  evmSignTransaction: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: EVM_WALLET, chainId: 48816, chain: { name: "goat" } }),
  useWalletClient: () => ({ data: { account: EVM_WALLET, signTransaction: mocks.evmSignTransaction } }),
  useChainId: () => 48816,
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock("@/providers/StellarWalletProvider", () => ({
  useStellarWallet: () => ({
    address: undefined,
    network: "stellar-testnet",
    isConnected: false,
    signTransaction: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWalletSession", () => ({
  useWalletSession: () => ({ address: EVM_WALLET }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => ({ actionsDisabled: false }),
}));

function approvalResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      allowed: true,
      walletOk: true,
      networkOk: true,
      expired: false,
      actionSafe: true,
      payload,
    }),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.evmSignTransaction.mockResolvedValue("0xsigned");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client-side signing verification UI", () => {
  it("renders a security warning and disables review for a tampered prepared payload", async () => {
    const { preview, payload } = await createEvmFixture();
    const tampered = { ...payload, data: TAMPERED_EVM_DATA };

    render(
      <TransactionPreview
        preview={preview}
        payload={tampered}
        walletAddress={EVM_WALLET}
        onRefresh={() => undefined}
      />,
    );

    expect(await screen.findByTestId("signing-verification-warning")).toBeTruthy();
    expect(screen.getByTestId("verification-issue-simulation_hash_mismatch")).toBeTruthy();
    expect((screen.getByRole("button", { name: /review in wallet/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("stops the approval flow before a wallet prompt when the approval response is tampered with", async () => {
    const { preview, payload } = await createEvmFixture();
    const tampered = { ...payload, data: TAMPERED_EVM_DATA };
    const fetchMock = vi.fn(async () => approvalResponse(tampered));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ApprovalFlowClient
        idempotencyKey="exec:fixture:1"
        walletAddress={EVM_WALLET}
        chainFamily="evm"
        network="goat"
        preview={preview}
      />,
    );

    expect(await screen.findByTestId("signing-verification-warning")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();

    const reviewButton = screen.getByRole("button", { name: /review in wallet/i }) as HTMLButtonElement;
    expect(reviewButton.disabled).toBe(true);
    fireEvent.click(reviewButton);

    expect(mocks.evmSignTransaction).not.toHaveBeenCalled();
  });
});
