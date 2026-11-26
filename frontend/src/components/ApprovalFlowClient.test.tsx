import { webcrypto } from "node:crypto";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalFlowClient } from "@/components/ApprovalFlowClient";
import type { TransactionPreview } from "@/server/types";
import { renderWithProviders } from "@/test/renderWithProviders";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const fixture = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111",
  contract: "0x2222222222222222222222222222222222222222",
  actionsDisabled: false,
  signTransaction: vi.fn(),
  switchChainAsync: vi.fn(),
  verificationIssues: [] as Array<{
    code: string;
    field: string;
    message: string;
    blocking: boolean;
    refreshRequired: boolean;
  }>,
}));

const ADDRESS = fixture.address;
const CONTRACT = fixture.contract;

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: fixture.address, chainId: 48816, chain: { name: "goat" } }),
  useChainId: () => 48816,
  useWalletClient: () => ({ data: { account: fixture.address, signTransaction: fixture.signTransaction } }),
  useSwitchChain: () => ({ switchChainAsync: fixture.switchChainAsync }),
}));

vi.mock("@/providers/StellarWalletProvider", () => ({
  useStellarWallet: () => ({
    address: undefined,
    network: "stellar-testnet",
    isConnected: false,
    signTransaction: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWalletSession", () => ({ useWalletSession: () => ({ address: ADDRESS }) }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => ({ actionsDisabled: fixture.actionsDisabled }) }));
vi.mock("@/lib/signing/previewVerification", () => ({
  verifyPreparedPayloadAgainstPreview: async () => ({
    ok: fixture.verificationIssues.length === 0,
    issues: fixture.verificationIssues,
  }),
}));
vi.mock("@/lib/stellar/config", () => ({ normalizeStellarNetworkId: () => undefined }));

function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 403, json: async () => body } as Response;
}

function approval(payload: unknown) {
  return { allowed: true, walletOk: true, networkOk: true, expired: false, actionSafe: true, payload };
}

function preview(simulation: TransactionPreview["simulation"] = {
  provider: "not_required",
  status: "not_required",
  checks: [],
  detail: "Simulation not required",
  simulatedTxHash: "",
}) {
  return {
    title: "Swap",
    action: "swap",
    network: "goat",
    targetContract: CONTRACT,
    estimatedValueUsd: 100,
    currentRiskScore: 10,
    projectedRiskScore: 10,
    requiresApproval: true,
    audit: { approvalRequired: true, serverCanSign: false },
    simulation,
  } as TransactionPreview;
}

function payload(buyRisk = 20, confidence = 92) {
  return {
    chainFamily: "evm",
    to: CONTRACT,
    data: "0x",
    value: "0",
    chainId: 48816,
    displayParams: {
      buyRisk,
      confidence,
      valueUsd: 100,
      youSend: "1 GOAT",
      minReceive: "0.9 USDC",
      verified: true,
      targetContract: CONTRACT,
      action: "swap",
    },
  };
}

const fetchMock = vi.fn();

function renderFlow(props: { preview?: TransactionPreview | null; onComplete?: (hash: string) => void } = {}) {
  return renderWithProviders(
    <ApprovalFlowClient
      idempotencyKey="exec:fixture:1"
      walletAddress={ADDRESS}
      chainFamily="evm"
      network="goat"
      preview={"preview" in props ? props.preview : preview()}
      onComplete={props.onComplete}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.actionsDisabled = false;
  fixture.verificationIssues = [];
  fixture.signTransaction.mockResolvedValue("0xsigned");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApprovalFlowClient", () => {
  it("enables signing only after validation of a reviewed payload", async () => {
    fetchMock
      .mockResolvedValueOnce(response(approval(payload())))
      .mockResolvedValueOnce(response({ hash: "0xhash" }));
    const onComplete = vi.fn();

    renderFlow({ onComplete });
    const button = await screen.findByRole("button", { name: "Review in Wallet" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(button);
    await waitFor(() => expect(fixture.signTransaction).toHaveBeenCalledOnce());
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("0xhash"));

    const submitBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(submitBody).toMatchObject({ userApproved: true, chainFamily: "evm", idempotencyKey: "exec:fixture:1" });
  });

  it("blocks signing when the reviewed preview is missing", async () => {
    fetchMock.mockResolvedValue(response(approval(payload())));
    renderFlow({ preview: null });

    expect(await screen.findByTestId("signing-verification-warning")).toBeTruthy();
    expect(screen.getByTestId("verification-issue-malformed_payload")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Review in Wallet" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(fixture.signTransaction).not.toHaveBeenCalled();
  });

  it("blocks signing when validation returns no prepared payload", async () => {
    fetchMock.mockResolvedValue(response(approval(undefined)));
    renderFlow();

    expect(await screen.findByTestId("signing-verification-warning")).toBeTruthy();
    expect(screen.getByText(/No prepared payload was returned/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review in Wallet" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks signing when simulation failed", async () => {
    fixture.verificationIssues = [{
      code: "simulation_not_passed",
      field: "simulation",
      message: "Simulation reverted",
      blocking: true,
      refreshRequired: true,
    }];
    fetchMock.mockResolvedValue(response(approval(payload())));
    renderFlow({
      preview: preview({
        provider: "eth_call",
        status: "failed",
        checks: [],
        detail: "Simulation reverted",
        simulatedTxHash: "0xabc",
      }),
    });

    expect(await screen.findByTestId("verification-issue-simulation_not_passed")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review in Wallet" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.signTransaction).not.toHaveBeenCalled();
  });

  it("blocks signing when the connected network does not match the request", async () => {
    fetchMock.mockResolvedValue(response({
      allowed: false,
      walletOk: true,
      networkOk: false,
      expired: false,
      actionSafe: true,
      blockedReason: "Connected network does not match",
    }, false));

    renderFlow();
    const button = await screen.findByRole("button", { name: "Review in Wallet" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({ connectedNetwork: "goat", connectedWallet: ADDRESS });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);
    expect(fixture.signTransaction).not.toHaveBeenCalled();
  });

  it("requires explicit acknowledgement for high-risk transactions", async () => {
    fetchMock.mockResolvedValue(response(approval(payload(90, 40))));
    renderFlow();

    const button = await screen.findByRole("button", { name: "Review in Wallet" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole("alert").textContent).toContain("High-risk transaction");

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it("keeps signing disabled while provider actions are offline", async () => {
    fixture.actionsDisabled = true;
    fetchMock.mockResolvedValue(response(approval(payload())));
    renderFlow();

    const button = await screen.findByRole("button", { name: "Review in Wallet" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
