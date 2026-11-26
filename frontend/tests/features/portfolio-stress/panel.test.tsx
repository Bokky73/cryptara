import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PortfolioStressPanel } from "@/components/PortfolioStressPanel";
import { clearStressPresets, readStressPresets } from "@/lib/stressPresets";
import { getDefaultRules } from "@/server/rules/defaultRules";
import { mockPortfolioFixture } from "@/server/portfolio/stressFixtures";

const WALLET = "0x1111111111111111111111111111111111111111";
const portfolio = { ...mockPortfolioFixture, walletAddress: WALLET };

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(getDefaultRules(WALLET)))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("recalculates when a slider moves and highlights breached rules", async () => {
  render(<PortfolioStressPanel portfolio={portfolio} />);
  const slider = screen.getByLabelText(/Market drawdown \(/);
  fireEvent.change(slider, { target: { value: "-80" } });
  const deep = screen.getByText(/Projected value/).textContent;
  fireEvent.change(slider, { target: { value: "-10" } });
  expect(screen.getByText(/Projected value/).textContent).not.toBe(deep);
  expect((await screen.findAllByText(/Meme exposure above maximum/)).length).toBeGreaterThan(0);
});

it("flags missing prices instead of showing zero impact", () => {
  render(<PortfolioStressPanel portfolio={{ ...portfolio, holdings: [{ ...portfolio.holdings[0], priceUsd: null, valueUsd: 0 }] }} />);
  expect(screen.getByText(/Missing inputs/)).toBeTruthy();
  expect(screen.getAllByText("Unknown").length).toBeGreaterThan(2);
});

it("does not evaluate thresholds when rules fail to load", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
  render(<PortfolioStressPanel portfolio={portfolio} />);
  expect(await screen.findByText(/thresholds were not evaluated/)).toBeTruthy();
});

it("saves, reloads and clears presets", () => {
  render(<PortfolioStressPanel portfolio={portfolio} />);
  fireEvent.change(screen.getByLabelText(/Liquidity haircut/), { target: { value: "45" } });
  fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "Crunch" } });
  fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
  expect(readStressPresets()).toMatchObject([{ name: "Crunch", params: { liquidityHaircutPercent: 45 } }]);
  clearStressPresets();
  expect(readStressPresets()).toEqual([]);
});
