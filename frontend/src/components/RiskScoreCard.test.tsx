import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskBreakdownCard } from "@/components/RiskBreakdownCard";
import { RiskScoreCard } from "@/components/RiskScoreCard";
import type { RiskBreakdownItem, RiskReport, TokenHolding } from "@/server/types";
import { renderWithProviders } from "@/test/renderWithProviders";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigation.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a>,
}));

function report(overrides: Record<string, unknown> = {}): RiskReport {
  return {
    id: "report-1",
    chain: "goat",
    symbol: "GOAT",
    buyRisk: 12,
    confidence: 88,
    verdict: "buy_small",
    summary: "Reviewed",
    topReasons: [],
    input: {} as RiskReport["input"],
    agentCards: [],
    sources: [],
    missingData: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as RiskReport;
}

function holding(): TokenHolding {
  return {
    tokenAddress: "native",
    symbol: "GOAT",
    name: "Goat",
    balance: 10,
    priceUsd: 1,
    valueUsd: 10,
    allocationPercent: 100,
    riskScore: 20,
    riskLevel: "low" as TokenHolding["riskLevel"],
    isVerified: true,
    signals: {
      scamRisk: 0,
      websiteTrustRisk: 0,
      contractRisk: 0,
      whaleSellRisk: 0,
      liquidityRisk: 0,
      xSentimentRisk: 0,
      holderConcentrationRisk: 0,
      priceVolatilityRisk: 0,
      portfolioExposureRisk: 0,
    },
  };
}

const breakdownItems: RiskBreakdownItem[] = [
  { key: "contract", label: "Ownership", score: 85, severity: "critical", finding: "Mint key is centralized" },
  { key: "liquidity", label: "Liquidity", score: 55, severity: "warning", finding: "Pool is thin" },
  { key: "website", label: "Website", score: 12, severity: "low", finding: "Domain verified" },
  { key: "scam", label: "Scam signals", score: 0, severity: "low", finding: "Data unavailable from provider" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RiskScoreCard", () => {
  it.each([
    [12, "Favorable", "Low"],
    [55, "Caution", "Medium"],
    [88, "Avoid", "High"],
  ])("renders score %i with its verdict and risk level", (score, verdict, level) => {
    renderWithProviders(<RiskScoreCard score={score} />);

    expect(screen.getByText(`${score}/100`)).toBeTruthy();
    expect(screen.getByText(`Verdict: ${verdict}`)).toBeTruthy();
    expect(screen.getByText(`Risk level: ${level}`)).toBeTruthy();
    expect(screen.getByRole("img", {
      name: `Portfolio risk score ${score} out of 100, ${level} risk, verdict ${verdict}`,
    })).toBeTruthy();
  });

  it("bounds out-of-range scores", () => {
    renderWithProviders(<RiskScoreCard score={140} />);
    expect(screen.getByText("100/100")).toBeTruthy();
    expect(screen.getByText("Verdict: Avoid")).toBeTruthy();
  });

  it("distinguishes low confidence from a healthy confidence score", () => {
    const degraded = renderWithProviders(<RiskScoreCard score={30} report={report({ confidence: 42 })} />);
    expect(screen.getByText("Confidence: 42% — low, treat with caution")).toBeTruthy();
    degraded.unmount();

    renderWithProviders(<RiskScoreCard score={30} report={report({ confidence: 91 })} />);
    expect(screen.getByText("Confidence: 91%")).toBeTruthy();
  });

  it("discloses missing data separately from strengths", () => {
    renderWithProviders(
      <RiskScoreCard
        score={88}
        report={report({
          criticalFlags: ["Mint key is centralized"],
          warnings: ["Thin liquidity"],
          strengths: ["Verified contract"],
          missingSources: ["News provider", "Volume provider"],
        })}
      />,
    );

    expect(screen.getByText("Mint key is centralized")).toBeTruthy();
    expect(screen.getByText("Thin liquidity")).toBeTruthy();
    expect(screen.getByText("Verified contract")).toBeTruthy();
    expect(screen.getByText("Missing data (not the same as safe): News provider, Volume provider")).toBeTruthy();
  });

  it("does not imply missing data when no report is available", () => {
    renderWithProviders(<RiskScoreCard score={10} />);
    expect(screen.queryByText(/Missing data/)).toBeNull();
    expect(screen.queryByText(/Confidence:/)).toBeNull();
  });

  it("opens and dismisses the weighted breakdown for a populated portfolio", () => {
    renderWithProviders(<RiskScoreCard score={30} holdings={[holding()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Show risk score breakdown" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Concentration risk" })).toBeTruthy();
    expect(screen.getAllByRole("meter")).toHaveLength(7);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("progressively discloses agent details", () => {
    renderWithProviders(<RiskScoreCard score={55} />);

    expect(screen.queryByText("Contract Guard")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show agent details" }));
    expect(screen.getByText("Contract Guard")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide agent details" }));
    expect(screen.queryByText("Contract Guard")).toBeNull();
  });
});

describe("RiskBreakdownCard", () => {
  it("groups findings by severity and marks unavailable providers as missing", () => {
    renderWithProviders(<RiskBreakdownCard items={breakdownItems} />);

    expect(screen.getByRole("heading", { name: "Why this is risky" })).toBeTruthy();
    expect(screen.getByText("Critical flags")).toBeTruthy();
    expect(screen.getByText("Warnings")).toBeTruthy();
    expect(screen.getByText("Strengths")).toBeTruthy();
    expect(screen.getByText("85/100")).toBeTruthy();
    expect(screen.getByText("55/100")).toBeTruthy();
    expect(screen.getByText("Data missing")).toBeTruthy();
    expect(screen.queryByText("0/100")).toBeNull();
    expect(screen.getByRole("link", { name: "Inspect proxy implementation" }).getAttribute("href"))
      .toBe("/insights/proxy-inspector");
  });

  it("renders an empty state when no findings are available", () => {
    renderWithProviders(<RiskBreakdownCard items={[]} />);
    expect(screen.getByRole("heading", { name: "Why this is risky" })).toBeTruthy();
    expect(screen.queryByText("Critical flags")).toBeNull();
  });
});
