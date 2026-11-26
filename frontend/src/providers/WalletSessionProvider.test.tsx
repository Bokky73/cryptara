import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWalletSession } from "@/hooks/useWalletSession";
import { captureOfflinePortfolio, captureOfflineScan, readOfflineState } from "@/lib/offlineStore";
import { SELECTED_WALLET_FAMILY_KEY, selectActiveChainFamily } from "@/lib/wallet/session";
import { WalletSessionProvider, useWalletSessionContext } from "@/providers/WalletSessionProvider";

const stellarAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const evmAddress = "0x1111111111111111111111111111111111111111";

const mocks = vi.hoisted(() => ({
  stellar: {
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    displayAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    network: "stellar-testnet",
    walletName: "Freighter",
    isConnected: true,
    isConnecting: false,
    isRestored: false,
    canSign: true,
    mismatchMessage: null,
    capabilities: { sign: true, reportsNetwork: true, accountSwitching: true, hardwareBacked: false },
    networkStatus: {
      kind: "match",
      expected: "stellar-testnet",
      walletNetwork: "stellar-testnet",
      message: null,
    },
    sessionNotice: null as string | null,
    signTransaction: async () => "signed-xdr",
  },
  signMessage: vi.fn<(input: { message: string }) => Promise<string>>(),
  evm: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
    chain: {
      name: "Base",
      unsupported: false,
      blockExplorers: { default: { url: "https://basescan.org" } },
    },
    connector: { name: "Coinbase Wallet" },
    isConnected: true,
    status: "connected",
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => mocks.evm,
  useSignMessage: () => ({ signMessageAsync: mocks.signMessage }),
}));

vi.mock("@/providers/StellarWalletProvider", () => ({
  useStellarWallet: () => mocks.stellar,
}));

function Harness() {
  const session = useWalletSessionContext();
  return (
    <div>
      <output data-testid="session">{JSON.stringify({
        family: session.family,
        activeChainFamily: session.activeChainFamily,
        address: session.address,
        chain: session.chain,
        walletType: session.walletType,
      })}</output>
      <button type="button" onClick={() => session.selectFamily("evm")}>EVM</button>
      <button type="button" onClick={() => session.selectFamily("stellar")}>Stellar</button>
    </div>
  );
}

const otherEvmAddress = "0x2222222222222222222222222222222222222222";
const otherStellarAddress = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const defaultEvm = mocks.evm;
const defaultStellar = mocks.stellar;

type FetchCall = { url: string; method: string; body: string };
let calls: FetchCall[] = [];
let onFetch: (call: FetchCall) => Promise<void> = async () => undefined;

function methodsFor(url: string) {
  return calls.filter((call) => call.url === url).map((call) => call.method);
}

const sessionUrl = "/api/wallet-session";
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

function tree(children = <Harness />) {
  return <WalletSessionProvider>{children}</WalletSessionProvider>;
}

function disconnectedEvm() {
  return { ...defaultEvm, address: undefined, chainId: undefined, chain: undefined, isConnected: false, status: "disconnected" } as unknown as typeof defaultEvm;
}

function disconnectedStellar(sessionNotice: string | null = null) {
  return { ...defaultStellar, address: undefined, displayAddress: undefined, network: undefined, isConnected: false, canSign: false, sessionNotice } as unknown as typeof defaultStellar;
}

function Consumer() {
  useWalletSession();
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.evm = defaultEvm;
  mocks.stellar = defaultStellar;
  mocks.signMessage.mockReset().mockResolvedValue("0xsignature");
  calls = [];
  onFetch = async () => undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? "GET", body: String(init?.body ?? "") };
    calls.push(call);
    await onFetch(call);
    return new Response(JSON.stringify({ nonce: "n", challenge: "message", challengeXdr: "xdr" }));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WalletSessionProvider", () => {

  it("keeps simultaneous EVM and Stellar accounts isolated behind explicit selection", async () => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "evm");
    render(<WalletSessionProvider><Harness /></WalletSessionProvider>);

    expect(screen.getByTestId("session").textContent).toContain(`"address":"${evmAddress}"`);
    expect(screen.getByTestId("session").textContent).not.toContain(stellarAddress);

    fireEvent.click(screen.getByRole("button", { name: "Stellar" }));
    expect(screen.getByTestId("session").textContent).toContain(`"address":"${stellarAddress}"`);
    expect(screen.getByTestId("session").textContent).not.toContain(evmAddress);

    fireEvent.click(screen.getByRole("button", { name: "EVM" }));
    expect(screen.getByTestId("session").textContent).toContain(`"address":"${evmAddress}"`);
  });

  it("restores only the explicitly selected family after remount", () => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "stellar");
    const first = render(<WalletSessionProvider><Harness /></WalletSessionProvider>);
    expect(screen.getByTestId("session").textContent).toContain('"family":"stellar"');
    first.unmount();

    render(<WalletSessionProvider><Harness /></WalletSessionProvider>);
    expect(screen.getByTestId("session").textContent).toContain('"family":"stellar"');
    expect(screen.getByTestId("session").textContent).toContain(`"address":"${stellarAddress}"`);
  });
});

describe("selectActiveChainFamily", () => {
  const none = { evmConnected: false, stellarConnected: false, stellarRestored: false };

  it.each([
    [null, none, null],
    [null, { ...none, evmConnected: true, stellarConnected: true }, "stellar"],
    ["evm", { ...none, evmConnected: true, stellarConnected: true }, "evm"],
    ["evm", { ...none, stellarConnected: true }, "evm"],
    [null, { ...none, evmConnected: true, stellarRestored: true }, "evm"],
    [null, { ...none, stellarRestored: true }, "stellar"],
    ["bitcoin", { ...none, evmConnected: true }, "evm"],
  ])("resolves %s with %o to %s", (selected, availability, expected) => {
    expect(selectActiveChainFamily(selected, availability)).toBe(expected);
  });
});

describe("session invalidation", () => {
  function capture(walletAddress: string) {
    captureOfflinePortfolio({ walletAddress, holdings: [], riskScore: 1 } as never);
  }

  function renderEvm() {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "evm");
    return render(tree());
  }

  function portfolioIds() {
    return readOfflineState().portfolios.map((entry) => entry.id);
  }

  it("does not revoke anything on first connection", async () => {
    renderEvm();
    await settle();
    expect(methodsFor(sessionUrl)).toEqual([]);
  });

  it("revokes the session and clears cached data when the EVM account switches", async () => {
    capture("0x1111111111111111111111111111111111111111".toUpperCase().replace("0X", "0x"));
    capture(otherEvmAddress);
    captureOfflineScan({ chain: "base", symbol: "PUB" } as never);
    captureOfflineScan({ chain: "base", symbol: "MINE", holder: evmAddress } as never);
    const view = renderEvm();

    mocks.evm = { ...defaultEvm, address: otherEvmAddress };
    view.rerender(tree());
    await settle();

    expect(methodsFor(sessionUrl)).toEqual(["DELETE"]);
    expect(portfolioIds()).toEqual([otherEvmAddress]);
    expect(readOfflineState().scans.map((entry) => entry.data.symbol)).toEqual(["PUB"]);
    expect(JSON.stringify({ ...window.localStorage }).toLowerCase()).not.toContain(evmAddress);
  });

  it("clears data and falls back to the remaining wallet on EVM disconnect", async () => {
    capture(evmAddress);
    const view = renderEvm();

    mocks.evm = disconnectedEvm();
    view.rerender(tree());
    await settle();

    expect(methodsFor(sessionUrl)).toEqual(["DELETE"]);
    expect(portfolioIds()).toEqual([]);
    expect(window.localStorage.getItem(SELECTED_WALLET_FAMILY_KEY)).toBeNull();
    expect(screen.getByTestId("session").textContent).toContain('"activeChainFamily":"stellar"');
  });

  it("keeps the session across an EVM chain switch and a transient reconnect", async () => {
    capture(evmAddress);
    const view = renderEvm();

    mocks.evm = { ...defaultEvm, chainId: 1 };
    view.rerender(tree());
    mocks.evm = { ...disconnectedEvm(), status: "reconnecting" };
    view.rerender(tree());
    mocks.evm = defaultEvm;
    view.rerender(tree());
    await settle();

    expect(methodsFor(sessionUrl)).toEqual([]);
    expect(portfolioIds()).toEqual([evmAddress]);
  });

  it("revokes on a Stellar account switch without moving to the EVM signer", async () => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "stellar");
    capture(stellarAddress);
    const view = render(tree());

    mocks.stellar = disconnectedStellar("The account changed. Reconnect to continue.");
    view.rerender(tree());
    await settle();

    expect(methodsFor(sessionUrl)).toEqual(["DELETE"]);
    expect(portfolioIds()).toEqual([]);
    expect(screen.getByTestId("session").textContent).toContain('"activeChainFamily":"stellar"');
    expect(screen.getByTestId("session").textContent).not.toContain(evmAddress);
  });

  it("revokes on a direct Stellar reconnect to another account", async () => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "stellar");
    const view = render(tree());
    mocks.stellar = { ...defaultStellar, address: otherStellarAddress, displayAddress: otherStellarAddress };
    view.rerender(tree());
    await settle();
    expect(methodsFor(sessionUrl)).toEqual(["DELETE"]);
  });

  it("revokes on a Stellar network switch but keeps the wallet's cache", async () => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "stellar");
    capture(stellarAddress);
    const view = render(tree());
    mocks.stellar = { ...defaultStellar, network: "stellar-pubnet" };
    view.rerender(tree());
    await settle();
    expect(methodsFor(sessionUrl)).toEqual(["DELETE"]);
    expect(portfolioIds()).toEqual([stellarAddress]);
  });

  it("falls back to EVM when the active Stellar wallet is disconnected", async () => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "stellar");
    const view = render(tree());
    mocks.stellar = disconnectedStellar();
    view.rerender(tree());
    await settle();
    expect(screen.getByTestId("session").textContent).toContain('"activeChainFamily":"evm"');
  });

  it("clears the cache but keeps the session when the inactive wallet disconnects", async () => {
    capture(stellarAddress);
    const view = renderEvm();
    mocks.stellar = disconnectedStellar();
    view.rerender(tree());
    await settle();
    expect(methodsFor(sessionUrl)).toEqual([]);
    expect(portfolioIds()).toEqual([]);
  });

  it("removes service worker page copies addressed to the wallet", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      keys: async () => ["shell"],
      open: async () => ({
        keys: async () => [{ url: `https://app.test/watchlist?wallet=${evmAddress}` }, { url: "https://app.test/scan" }],
        delete: async (request: { url: string }) => { deleted.push(request.url); return true; },
      }),
    });
    const view = renderEvm();
    mocks.evm = disconnectedEvm();
    view.rerender(tree());
    await settle();
    expect(deleted).toEqual([`https://app.test/watchlist?wallet=${evmAddress}`]);
  });
});

describe("useWalletSession challenges", () => {
  it("prompts once for several consumers and re-authenticates after a switch", async () => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "evm");
    const consumers = <><Consumer /><Consumer /></>;
    const first = { ...defaultEvm, address: "0x3333333333333333333333333333333333333333" };
    mocks.evm = first;
    const view = render(tree(consumers));
    await settle();
    expect(mocks.signMessage).toHaveBeenCalledTimes(1);

    mocks.evm = { ...first, address: otherEvmAddress };
    view.rerender(tree(consumers));
    await settle();

    expect(mocks.signMessage).toHaveBeenCalledTimes(2);
    expect(methodsFor(sessionUrl)).toEqual(["POST", "DELETE", "POST"]);
    expect(calls.at(-1)?.body).toContain(otherEvmAddress);
  });

  it("never claims a session when the wallet disconnects while signing", async () => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "evm");
    mocks.stellar = disconnectedStellar();
    mocks.evm = { ...defaultEvm, address: "0x4444444444444444444444444444444444444444" };
    let sign: (value: string) => void = () => undefined;
    mocks.signMessage.mockImplementationOnce(() => new Promise((resolve) => { sign = resolve; }));
    const view = render(tree(<Consumer />));
    await settle();
    expect(mocks.signMessage).toHaveBeenCalledTimes(1);

    mocks.evm = disconnectedEvm();
    view.rerender(tree(<Consumer />));
    await settle();
    await act(async () => sign("0xlate"));
    await settle();

    expect(methodsFor(sessionUrl)).toEqual(["DELETE"]);
  });

  it("deletes a session whose claim was already in flight when the wallet disconnected", async () => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, "evm");
    mocks.stellar = disconnectedStellar();
    mocks.evm = { ...defaultEvm, address: "0x5555555555555555555555555555555555555555" };
    let finishClaim: () => void = () => undefined;
    onFetch = async (call) => {
      if (call.url === sessionUrl && call.method === "POST") await new Promise<void>((resolve) => { finishClaim = resolve; });
    };
    const view = render(tree(<Consumer />));
    await settle();
    expect(methodsFor(sessionUrl)).toEqual(["POST"]);

    mocks.evm = disconnectedEvm();
    view.rerender(tree(<Consumer />));
    await settle();
    await act(async () => finishClaim());
    await settle();

    expect(methodsFor(sessionUrl)).toEqual(["POST", "DELETE", "DELETE"]);
  });
});
