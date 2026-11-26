import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StellarHoldersPage from "@/app/insights/stellar-holders/page";
import { HolderDistribution } from "@/components/research/stellar-holders/HolderDistribution";
import { HolderDistributionError } from "@/server/research/stellar-holders/errors";
import { measureHolderDistribution } from "@/server/research/stellar-holders/service";
import {
  DIST,
  ISSUER_A,
  ISSUER_B,
  PUB_A,
  PUB_B,
  concentrated,
  partial,
  poolHeavy,
  readerFromFixtures,
  unavailable,
} from "./fixtures";

// The page renders AppShell, whose wallet providers are out of scope here.
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const fixtures = [concentrated, poolHeavy, partial, unavailable];

function installFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { asset?: string; network?: string };

    try {
      const report = await measureHolderDistribution(body, readerFromFixtures(fixtures));

      return { ok: true, status: 200, json: async () => ({ report }) } as unknown as Response;
    } catch (error) {
      const failure = error as HolderDistributionError;

      return {
        ok: false,
        status: 400,
        json: async () => ({ error: failure.code ?? "invalid_request", message: failure.message }),
      } as unknown as Response;
    }
  });
}

function measure() {
  fireEvent.submit(screen.getByRole("form", { name: /issued asset holder distribution/i }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stellar holder distribution page", () => {
  it("renders an accessible heading, labelled controls, and stacks them", async () => {
    const page = await StellarHoldersPage({ searchParams: Promise.resolve({ asset: concentrated.asset, network: "stellar-testnet" }) });
    render(page);

    expect(screen.getByRole("heading", { name: /stellar holder distribution/i })).toBeTruthy();
    expect(screen.getByLabelText("Asset")).toBeTruthy();
    expect(screen.getByLabelText("Network")).toBeTruthy();
    expect(screen.getByRole("button", { name: /measure distribution/i })).toBeTruthy();

    const form = screen.getByRole("form", { name: /issued asset holder distribution/i });
    expect(form.className).toContain("flex-col");
    expect(form.className).toContain("sm:flex-row");
    expect((screen.getByLabelText("Asset") as HTMLInputElement).value).toBe(concentrated.asset);
  });

  it("refuses to measure a blank asset", async () => {
    const fetchMock = installFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<HolderDistribution />);

    measure();

    expect((await screen.findByTestId("holder-error")).textContent).toMatch(/CODE:ISSUER/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the holder table, concentration, buckets, chart text, and a scrolling table", async () => {
    vi.stubGlobal("fetch", installFetch());
    render(<HolderDistribution initialAsset={concentrated.asset} initialNetwork="stellar-testnet" />);

    measure();

    const summary = await screen.findByTestId("concentration-summary");
    const accounts = within(summary).getByRole("heading", { name: "All trustline accounts" }).closest("article");
    const publicFloat = within(summary).getByRole("heading", { name: "Public float" }).closest("article");

    expect(accounts).toBeTruthy();
    expect(publicFloat).toBeTruthy();
    expect(within(accounts as HTMLElement).getByText(/3\/8/)).toBeTruthy();
    expect(within(accounts as HTMLElement).getByText(/73\/200/)).toBeTruthy();
    expect(within(publicFloat as HTMLElement).getByText(/1\/3/)).toBeTruthy();

    const tableScroll = screen.getByTestId("holder-table-scroll");
    expect(tableScroll.className).toContain("overflow-x-auto");
    expect(within(tableScroll).getByRole("table")).toBeTruthy();
    expect(within(tableScroll).getByText(DIST)).toBeTruthy();
    expect(within(tableScroll).getByText("Distribution")).toBeTruthy();
    expect(within(tableScroll).getByText("Outside public float")).toBeTruthy();

    expect(screen.getByTestId("distribution-text-alternative").textContent).toContain(DIST);
    expect(screen.getByTestId("bucket-trustlines").textContent).toContain("100.0000000");
    expect(screen.getByTestId("coverage-fraction").textContent).toBe("1/1");
  });

  it("shows pool supply apart from the two equal holders", async () => {
    vi.stubGlobal("fetch", installFetch());
    render(<HolderDistribution initialAsset={poolHeavy.asset} initialNetwork="stellar-testnet" />);

    measure();

    const buckets = await screen.findByTestId("supply-buckets");
    expect(within(buckets).getByTestId("bucket-liquidity_pools").textContent).toContain("80.0000000");
    expect(within(buckets).getByTestId("bucket-liquidity_pools").textContent).toContain("4/5");
    expect(within(buckets).getByTestId("bucket-trustlines").textContent).toContain("1/5");

    const summary = screen.getByTestId("concentration-summary");
    expect(within(summary).getAllByText(/0\/1/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("holder-table").textContent).not.toContain("pool-a");
  });

  it("states the fraction of supply covered when the recording is partial", async () => {
    vi.stubGlobal("fetch", installFetch());
    render(<HolderDistribution initialAsset={partial.asset} initialNetwork="stellar-testnet" />);

    measure();

    const notice = await screen.findByTestId("coverage-notice");
    expect(within(notice).getByText("partial")).toBeTruthy();
    expect(screen.getByTestId("coverage-fraction").textContent).toBe("1/4");
    expect(notice.textContent).toContain("1/4");
  });

  it("shows an unavailable provider without a fabricated holder table", async () => {
    vi.stubGlobal("fetch", installFetch());
    render(<HolderDistribution initialAsset={unavailable.asset} initialNetwork="stellar-testnet" />);

    measure();

    const notice = await screen.findByTestId("coverage-notice");
    expect(within(notice).getByText("unavailable")).toBeTruthy();
    expect(notice.textContent).toContain("HTTP 503");
    expect(screen.queryByTestId("concentration-summary")).toBeNull();
    expect(screen.getByTestId("holder-table").textContent).toMatch(/no positive trustline/i);
  });

  it("drops the previous issuer's holders when the asset changes", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { asset: string; network: string };
      const issuerB = body.asset.endsWith(ISSUER_B);
      const report = await measureHolderDistribution(body, {
        async readSupply() {
          return {
            ledger: issuerB ? 2 : 1,
            ledgerClosedAt: null,
            issued: issuerB ? "1.0000000" : "70.0000000",
            authorized: issuerB ? "1.0000000" : "70.0000000",
            authorizedToMaintainLiabilities: "0.0000000",
            unauthorized: "0.0000000",
            liquidityPools: "0.0000000",
            claimableBalances: "0.0000000",
            contracts: "0.0000000",
            numAccounts: 1,
          };
        },
        async readTrustlinePage() {
          return {
            records: [{ accountId: issuerB ? PUB_B : PUB_A, balance: issuerB ? "1.0000000" : "70.0000000" }],
            nextCursor: null,
          };
        },
        async readLiquidityPools() {
          return { records: [], truncated: false };
        },
        async readClaimableBalances() {
          return { records: [], truncated: false };
        },
        async readDistributionAccounts() {
          return { accounts: [], tomlRead: true };
        },
      });

      return { ok: true, status: 200, json: async () => ({ report }) } as unknown as Response;
    });

    vi.stubGlobal("fetch", fetchMock);
    render(<HolderDistribution initialAsset={`TWIN:${ISSUER_A}`} initialNetwork="stellar-testnet" />);

    measure();
    expect((await screen.findAllByText(PUB_A)).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Asset"), { target: { value: `TWIN:${ISSUER_B}` } });

    await waitFor(() => {
      expect(screen.queryAllByText(PUB_A)).toHaveLength(0);
    });

    measure();
    expect((await screen.findAllByText(PUB_B)).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(PUB_A)).toHaveLength(0);
  });
});
