import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { parseInsightQuery, patchInsightQuery } from "@/components/research/shared/insightQuery";
import { useInsightParam, useInsightQueryParams } from "@/components/research/shared/useInsightQueryParams";

const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(navigation.search) }));

const token = "0x1111111111111111111111111111111111111111";
const account = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const NETWORKS = ["ethereum", "base"] as const;

beforeEach(() => { navigation.search = ""; });

function visit(search: string) {
  navigation.search = search.replace("?", "");
  window.history.replaceState(null, "", `/insights/x${search}`);
}

function Harness() {
  const [asset, setAsset] = useInsightParam("asset", "");
  const [network, setNetwork] = useInsightParam<(typeof NETWORKS)[number]>("network", "ethereum", NETWORKS);
  return (
    <>
      <input aria-label="Asset" value={asset} onChange={(event) => setAsset(event.target.value)} />
      <select aria-label="Network" value={network} onChange={(event) => setNetwork(event.target.value as "base")}>
        {NETWORKS.map((id) => <option key={id}>{id}</option>)}
      </select>
    </>
  );
}

const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe("parseInsightQuery", () => {
  it("reads every supported parameter", () => {
    expect(parseInsightQuery(`?asset=${token}&network=base&chainFamily=evm&window=7d&compare=USDC:${account}`)).toEqual({
      asset: token, network: "base", chainFamily: "evm", window: "7d", compare: `USDC:${account}`,
    });
  });

  it("drops invalid values and a family that contradicts a Stellar network", () => {
    expect(parseInsightQuery("?asset=<script>&network=A%20B&chainFamily=btc&window=2y&compare=0x12_")).toEqual({});
    expect(parseInsightQuery("?network=stellar-pubnet&chainFamily=evm")).toEqual({ network: "stellar-pubnet" });
  });

  it.each([["account", account], ["secret key", `S${account.slice(1)}`]])("never treats a Stellar %s as an asset", (_label, secret) => {
    expect(parseInsightQuery(`?asset=${secret}`)).toEqual({});
    expect(patchInsightQuery("", { asset: secret })).toBe("");
  });

  it("patches its own keys and preserves others", () => {
    expect(patchInsightQuery("?target=1&network=base", { network: "ethereum", window: "7d" })).toBe("?target=1&network=ethereum&window=7d");
    expect(patchInsightQuery("?target=1&network=base", { network: null })).toBe("?target=1");
  });
});

describe("useInsightParam", () => {
  it("restores the same state on every load of a shared link", () => {
    visit(`?asset=${token}&network=base`);
    const first = render(<Harness />);
    expect([value("Asset"), value("Network")]).toEqual([token, "base"]);
    first.unmount();
    render(<Harness />);
    expect([value("Asset"), value("Network")]).toEqual([token, "base"]);
  });

  it("hydrates server markup without a mismatch", async () => {
    visit(`?asset=${token}&network=base`);
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(<Harness />);
    expect(container.querySelector("input")?.value).toBe(token);
    const onRecoverableError = vi.fn();
    const root = await act(async () => hydrateRoot(container, <Harness />, { onRecoverableError }));
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("select")?.value).toBe("base");
    await act(async () => root.unmount());
    container.remove();
  });

  it("writes valid values to the URL and keeps incomplete text local", () => {
    visit("?target=keep");
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Network"), { target: { value: "base" } });
    fireEvent.change(screen.getByLabelText("Asset"), { target: { value: token } });
    expect(window.location.search).toBe(`?target=keep&network=base&asset=${token}`);

    fireEvent.change(screen.getByLabelText("Asset"), { target: { value: account } });
    expect(value("Asset")).toBe(account);
    expect(window.location.search).toBe("?target=keep&network=base");
  });

  it("falls back for a network the view does not support", () => {
    visit("?network=stellar-pubnet");
    render(<Harness />);
    expect(value("Network")).toBe("ethereum");
  });

  it("follows back and forward navigation", () => {
    visit("?network=base");
    render(<Harness />);
    act(() => {
      window.history.replaceState(null, "", "/insights/x?network=ethereum");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(value("Network")).toBe("ethereum");
  });

  it("keeps several consumers in sync", () => {
    function Reader() {
      return <output>{JSON.stringify(useInsightQueryParams().params)}</output>;
    }
    render(<><Harness /><Reader /></>);
    fireEvent.change(screen.getByLabelText("Network"), { target: { value: "base" } });
    expect(screen.getByRole("status").textContent).toBe('{"network":"base"}');
  });
});
