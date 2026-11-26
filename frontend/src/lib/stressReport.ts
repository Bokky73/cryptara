import type { PortfolioStressResult } from "@/server/types";
import type { StressThresholdBreach } from "@/server/portfolio/stress";
import { formatUsd, shortAddress } from "@/lib/format";

const cents = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const usd = (value: number | null) => (value === null ? "Unknown" : formatUsd(value, cents));
const percent = (value: number | null) => (value === null ? "Unknown" : `${value.toFixed(2)}%`);
// Token symbols are issuer-controlled text.
const cell = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\|`*_[\]<>#]/g, "\\$&");

export function buildStressReport(
  result: PortfolioStressResult,
  scenarioName: string,
  breaches: StressThresholdBreach[] | null,
): string {
  const { delta } = result;
  const list = (items: string[], empty: string) => (items.length ? items.map((item) => `- ${item}`) : [`- ${empty}`]);
  return [
    "# Cryptara portfolio stress report",
    "",
    `- Wallet: ${shortAddress(result.baseSnapshot.walletAddress)}`,
    `- Snapshot: ${result.baseSnapshot.createdAt}`,
    `- Scenario: ${cell(scenarioName)} (${result.scenarioId} v${result.scenarioVersion})`,
    `- Priced value: ${usd(delta.originalValueUsd)} → ${usd(delta.stressedValueUsd)} (${percent(delta.originalValueUsd > 0 ? delta.percentageDelta : null)})`,
    "",
    "## Assets",
    "",
    "| Asset | Chain | Before | After | Change | Allocation before | Allocation after | Liquidity |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...result.assetImpacts.map((asset) =>
      `| ${[cell(asset.symbol), cell(asset.chain ?? "Unknown"), usd(asset.baseValueUsd), usd(asset.stressedValueUsd), percent(asset.deltaPercent), percent(asset.baseAllocationPercent), percent(asset.stressedAllocationPercent), asset.liquidityStatus].join(" | ")} |`),
    "",
    "## Risk thresholds",
    "",
    ...(breaches === null
      ? ["- Not evaluated: rules were unavailable."]
      : list(breaches.map((b) => `${cell(b.label)}: ${b.stressedValue?.toFixed(2) ?? "Unknown"} (limit ${b.limit}; ${b.crossedByStress ? "crossed under stress" : "already breached"})`), "No configured threshold is breached.")),
    "",
    "## Missing inputs",
    "",
    ...list(result.missingInputs.map((m) => `${cell(m.symbol)} ${m.input}: ${m.detail}`), "None."),
    "",
    "## Assumptions",
    "",
    ...list(result.assumptions.map(cell), "No shock applied."),
    "",
  ].join("\n");
}
