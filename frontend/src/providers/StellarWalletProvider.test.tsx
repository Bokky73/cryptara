import { act, fireEvent, render, screen } from "@testing-library/react";
import { Networks, KitEventType, type KitEventStateUpdated, type KitEventWalletSelected } from "@creit.tech/stellar-wallets-kit/types";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StellarWalletProvider, useStellarWallet } from "@/providers/StellarWalletProvider";
import { STELLAR_DISPLAY_SESSION_KEY } from "@/lib/wallet/session";
import type { StellarWalletAdapter } from "@/lib/stellar/wallet-adapter";

vi.mock("@/lib/stellar/wallet-adapter", () => ({
  createStellarWalletAdapter: vi.fn(),
}));

const testAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const otherAddress = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

async function click(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
}

function mockAdapter() {
  let stateCallback: ((event: KitEventStateUpdated) => void) | undefined;
  let walletCallback: ((event: KitEventWalletSelected) => void) | undefined;
  let disconnectCallback: (() => void) | undefined;

  return {
    emitAddress(address: string | undefined, networkPassphrase = Networks.TESTNET) {
      stateCallback?.({ eventType: KitEventType.STATE_UPDATED, payload: { address, networkPassphrase } });
    },
    emitDisconnect() {
      disconnectCallback?.();
    },
    observe: vi.fn<NonNullable<StellarWalletAdapter["observe"]>>(async () => null),
    mobileWalletId: "wallet_connect",
    init: vi.fn<StellarWalletAdapter["init"]>(),
    onStateUpdated(callback) {
      stateCallback = callback;
      return () => { stateCallback = undefined; };
    },
    onWalletSelected(callback) {
      walletCallback = callback;
      return () => { walletCallback = undefined; };
    },
    onDisconnect(callback) {
      disconnectCallback = callback;
      return () => { disconnectCallback = undefined; };
    },
    connect: vi.fn<StellarWalletAdapter["connect"]>(async (walletId = "lobstr") => {
      walletCallback?.({
        eventType: KitEventType.WALLET_SELECTED,
        payload: { id: walletId },
      });
      stateCallback?.({
        eventType: KitEventType.STATE_UPDATED,
        payload: { address: testAddress, networkPassphrase: Networks.TESTNET },
      });
      return {
        address: testAddress,
        wallet: { id: walletId, name: walletId === "freighter" ? "Freighter" : walletId === "wallet_connect" ? "WalletConnect" : "LOBSTR" },
      };
    }),
    selectWallet: vi.fn<StellarWalletAdapter["selectWallet"]>(),
    getNetwork: vi.fn<StellarWalletAdapter["getNetwork"]>(async () => ({ network: "TESTNET", networkPassphrase: Networks.TESTNET })),
    signTransaction: vi.fn<StellarWalletAdapter["signTransaction"]>(async () => ({ signedTxXdr: "signed-xdr" })),
    openProfile: vi.fn<StellarWalletAdapter["openProfile"]>(async () => undefined),
    disconnect: vi.fn<StellarWalletAdapter["disconnect"]>(async () => {
      disconnectCallback?.();
    }),
  } satisfies StellarWalletAdapter & Record<string, unknown>;
}

function Harness() {
  const wallet = useStellarWallet();
  const [result, setResult] = useState("");

  return (
    <div>
      <output data-testid="state">
        {JSON.stringify({
          address: wallet.address,
          displayAddress: wallet.displayAddress,
          walletId: wallet.walletId,
          network: wallet.network,
          connected: wallet.isConnected,
          restored: wallet.isRestored,
          canSign: wallet.canSign,
          error: wallet.error,
          notice: wallet.sessionNotice,
          connecting: wallet.isConnecting,
        })}
      </output>
      <button type="button" onClick={() => void wallet.connect("freighter").catch(() => undefined)}>desktop</button>
      <button type="button" onClick={() => void wallet.connect("wallet_connect").catch(() => undefined)}>mobile</button>
      <button type="button" onClick={() => void wallet.signTransaction("unsigned-xdr").then(setResult).catch((error: Error) => setResult(error.message))}>sign</button>
      <button type="button" onClick={() => void wallet.disconnect()}>disconnect</button>
      <output data-testid="result">{result}</output>
    </div>
  );
}

describe("StellarWalletProvider", () => {
  it("restores display state without connecting, requesting access, or signing", async () => {
    const adapter = mockAdapter();
    window.localStorage.setItem(STELLAR_DISPLAY_SESSION_KEY, JSON.stringify({
      version: 1,
      walletId: "freighter",
      walletName: "Freighter",
      adapter: "freighter",
      address: testAddress,
      network: "stellar-testnet",
    }));

    render(<StellarWalletProvider adapter={adapter}><Harness /></StellarWalletProvider>);

    expect((await screen.findByTestId("state")).textContent).toContain(`"displayAddress":"${testAddress}"`);
    expect(screen.getByTestId("state").textContent).toContain('"connected":false');
    expect(screen.getByTestId("state").textContent).toContain('"restored":true');
    expect(adapter.init).toHaveBeenCalledWith(expect.objectContaining({ selectedWalletId: "freighter" }));
    expect(adapter.connect).not.toHaveBeenCalled();
    expect(adapter.signTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["desktop Freighter", "desktop", "freighter"],
    ["mobile WalletConnect", "mobile", "wallet_connect"],
  ])("connects the %s flow through its selected adapter", async (_label, button, walletId) => {
    const adapter = mockAdapter();
    render(<StellarWalletProvider adapter={adapter}><Harness /></StellarWalletProvider>);

    await click(button);

    expect(adapter.connect).toHaveBeenCalledWith(walletId);
    expect((await screen.findByTestId("state")).textContent).toContain(`"walletId":"${walletId}"`);
    expect(screen.getByTestId("state").textContent).toContain('"connected":true');
  });

  it("surfaces connect cancellation and adapter errors", async () => {
    const adapter = mockAdapter();
    adapter.connect.mockRejectedValueOnce(new Error("The user closed the modal."));
    render(<StellarWalletProvider adapter={adapter}><Harness /></StellarWalletProvider>);

    await click("desktop");

    expect((await screen.findByTestId("state")).textContent).toContain('"error":"The user closed the modal."');
    expect(screen.getByTestId("state").textContent).toContain('"connected":false');
  });

  it("blocks a network mismatch before signing and explains recovery", async () => {
    const adapter = mockAdapter();
    adapter.getNetwork
      .mockResolvedValueOnce({ network: "TESTNET", networkPassphrase: Networks.TESTNET })
      .mockResolvedValueOnce({ network: "PUBLIC", networkPassphrase: Networks.PUBLIC });
    render(<StellarWalletProvider adapter={adapter}><Harness /></StellarWalletProvider>);
    await click("desktop");

    await click("sign");

    expect((await screen.findByTestId("result")).textContent).toContain("switch it to stellar-testnet");
    expect(adapter.selectWallet).toHaveBeenCalledWith("freighter");
    expect(adapter.signTransaction).not.toHaveBeenCalled();
  });

  it("re-selects the wallet for each approval and clears state on disconnect", async () => {
    const adapter = mockAdapter();
    render(<StellarWalletProvider adapter={adapter}><Harness /></StellarWalletProvider>);
    await click("desktop");
    await click("sign");

    expect((await screen.findByTestId("result")).textContent).toContain("signed-xdr");
    expect(adapter.selectWallet).toHaveBeenCalledWith("freighter");
    expect(adapter.signTransaction).toHaveBeenCalledWith("unsigned-xdr", {
      address: testAddress,
      networkPassphrase: Networks.TESTNET,
    });

    await click("disconnect");
    expect(screen.getByTestId("state").textContent).toContain('"connected":false');
    expect(window.localStorage.getItem(STELLAR_DISPLAY_SESSION_KEY)).toBeNull();
  });

  it("discards the session when the account changes inside the wallet", async () => {
    const adapter = mockAdapter();
    render(<StellarWalletProvider adapter={adapter}><Harness /></StellarWalletProvider>);
    await click("desktop");
    expect(window.localStorage.getItem(STELLAR_DISPLAY_SESSION_KEY)).toContain(testAddress);

    await act(async () => adapter.emitAddress(otherAddress));

    const state = screen.getByTestId("state").textContent;
    expect(state).toContain('"connected":false');
    expect(state).toContain("account selected in");
    expect(state).not.toContain(otherAddress);
    expect(window.localStorage.getItem(STELLAR_DISPLAY_SESSION_KEY)).toBeNull();
  });

  it.each([
    ["account switch", { address: otherAddress, networkPassphrase: Networks.TESTNET as string }, "account selected in"],
    ["network switch", { address: testAddress, networkPassphrase: Networks.PUBLIC as string }, "switched network"],
    ["unsupported network", { address: testAddress, networkPassphrase: "Unknown Network" }, "switched network"],
  ])("detects a silent %s when the window regains focus", async (_label, observed, notice) => {
    const adapter = mockAdapter();
    render(<StellarWalletProvider adapter={adapter}><Harness /></StellarWalletProvider>);
    await click("desktop");

    adapter.observe.mockResolvedValue(observed);
    await act(async () => { window.dispatchEvent(new Event("focus")); });

    const state = screen.getByTestId("state").textContent;
    expect(state).toContain('"connected":false');
    expect(state).toContain(notice);
    expect(window.localStorage.getItem(STELLAR_DISPLAY_SESSION_KEY)).toBeNull();
  });

  it("keeps the session when the wallet reports the same state or cannot answer", async () => {
    const adapter = mockAdapter();
    render(<StellarWalletProvider adapter={adapter}><Harness /></StellarWalletProvider>);
    await click("desktop");

    adapter.observe.mockResolvedValueOnce({ address: testAddress, networkPassphrase: Networks.TESTNET });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    adapter.observe.mockRejectedValueOnce(new Error("locked"));
    await act(async () => { window.dispatchEvent(new Event("focus")); });

    expect(screen.getByTestId("state").textContent).toContain('"connected":true');
  });

  it("does not resurrect a session when a disconnect wins the race with connect", async () => {
    const adapter = mockAdapter();
    let release: (value: { network: string; networkPassphrase: string }) => void = () => undefined;
    adapter.getNetwork.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    render(<StellarWalletProvider adapter={adapter}><Harness /></StellarWalletProvider>);

    await click("desktop");
    expect(screen.getByTestId("state").textContent).toContain('"connecting":true');
    await act(async () => adapter.emitDisconnect());
    await act(async () => release({ network: "TESTNET", networkPassphrase: Networks.TESTNET }));

    const state = screen.getByTestId("state").textContent;
    expect(state).toContain('"connected":false');
    expect(state).toContain('"connecting":false');
    expect(window.localStorage.getItem(STELLAR_DISPLAY_SESSION_KEY)).toBeNull();
  });
});
