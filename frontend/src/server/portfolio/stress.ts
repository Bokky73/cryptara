import type {
  PortfolioSnapshot,
  PortfolioStressResult,
  PortfolioStressDelta,
  StressAssetImpact,
  StressLiquidityStatus,
  StressMissingInput,
  TokenHolding,
  UserRule,
} from "../types";
import { holdingTarget, type PortfolioStressScenario } from "./scenarios";
import { getKnownTokenClass } from "./tokenRegistry";

function matchesTarget(holding: TokenHolding, target: string): boolean {
  if (target === "all") return true;
  if (target === "non_stablecoins") return getKnownTokenClass(holding.symbol) !== "stablecoin";
  if (target === "stablecoins") return getKnownTokenClass(holding.symbol) === "stablecoin";
  if (target === "memecoins") return getKnownTokenClass(holding.symbol) === "meme";
  if (target === "stellar_native") {
    const chain = holding.chainId ?? holding.chainName ?? "";
    return holding.assetKind === "native" && (chain.toLowerCase().startsWith("stellar") || (!chain && holding.tokenAddress === "stellar:native"));
  }
  if (target.startsWith("holding:")) return holdingTarget(holding) === target;
  return holding.symbol === target || holding.tokenAddress === target;
}

/** A zero price on a positive balance is a provider gap, not evidence of zero exposure. */
function hasUsablePrice(holding: TokenHolding): holding is TokenHolding & { priceUsd: number } {
  return holding.priceStatus !== "unavailable"
    && typeof holding.priceUsd === "number" && Number.isFinite(holding.priceUsd) && holding.priceUsd > 0
    && Number.isFinite(holding.balance) && Number.isFinite(holding.valueUsd);
}

function liquidityStatus(holding: TokenHolding): StressLiquidityStatus {
  if (holding.stellarRisk) return holding.stellarRisk.liquidity === "known" ? "known" : "missing";
  return Number.isFinite(holding.signals?.liquidityRisk) ? "estimated" : "missing";
}

function share(value: number, total: number): number | null {
  return total > 0 ? value / total * 100 : null;
}

export function applyStressScenario(
  snapshot: PortfolioSnapshot,
  scenario: PortfolioStressScenario
): PortfolioStressResult {
  const assumptions: string[] = [];
  const affectedHoldings = new Set<string>();

  const assetImpacts: StressAssetImpact[] = [];
  const missingInputs: StressMissingInput[] = [];

  let originalValueUsd = 0;
  let stressedValueUsd = 0;

  const stressedHoldings = snapshot.holdings.map((holding) => {
    const liquidity = liquidityStatus(holding);
    const key = holdingTarget(holding);
    if (liquidity === "missing") {
      missingInputs.push({ key, symbol: holding.symbol, input: "liquidity", detail: "No liquidity evidence. The actual exit cost may exceed the modelled haircut." });
    }

    const impact: StressAssetImpact = {
      key,
      symbol: holding.symbol,
      chain: holding.chainName ?? holding.chainId ?? null,
      tokenClass: getKnownTokenClass(holding.symbol),
      riskScore: holding.riskScore,
      priceStatus: "missing",
      liquidityStatus: liquidity,
      baseValueUsd: null,
      stressedValueUsd: null,
      deltaUsd: null,
      deltaPercent: null,
      baseAllocationPercent: null,
      stressedAllocationPercent: null,
    };
    assetImpacts.push(impact);

    if (holding.balance === 0) {
      // A zero balance is genuinely worth zero, whatever its price.
      Object.assign(impact, { priceStatus: "priced", baseValueUsd: 0, stressedValueUsd: 0, deltaUsd: 0, deltaPercent: 0 });
      return { ...holding };
    }

    if (!hasUsablePrice(holding)) {
      missingInputs.push({ key, symbol: holding.symbol, input: "price", detail: "No usable price. Excluded from totals; its impact is unknown, not zero." });
      return { ...holding };
    }

    const baseValueUsd = holding.valueUsd;
    originalValueUsd += baseValueUsd;
    let newPriceUsd = holding.priceUsd;
    let exitMultiplier = 1;
    let changed = false;

    for (const change of scenario.changes) {
      if (matchesTarget(holding, change.target)) {
        
        if (change.type === "liquidity_haircut" && change.multiplier !== undefined) {
          exitMultiplier *= change.multiplier;
          assumptions.push(`Applied a uniform ${Math.round((1 - change.multiplier) * 100)}% liquidity haircut to exit value (Target: ${change.target}); pool depth is not simulated`);
          changed = true;
        } else if (change.type === "price_multiplier" && change.multiplier !== undefined) {
          newPriceUsd = newPriceUsd * change.multiplier;
          assumptions.push(`Applied ${change.multiplier}x multiplier to ${holding.symbol} (Target: ${change.target})`);
          changed = true;
        } else if (change.type === "fixed_price" && change.fixedUsd !== undefined) {
          newPriceUsd = change.fixedUsd;
          assumptions.push(`Fixed price of ${holding.symbol} to $${change.fixedUsd} (Target: ${change.target})`);
          changed = true;
        } else if (change.type === "depeg" && change.fixedUsd !== undefined) {
          newPriceUsd = change.fixedUsd;
          assumptions.push(`Depegged ${holding.symbol} to $${change.fixedUsd} (Target: ${change.target})`);
          changed = true;
        }
      }
    }

    if (changed && (newPriceUsd !== holding.priceUsd || exitMultiplier !== 1)) {
      affectedHoldings.add(holding.symbol);
    }
    
    // Scale the reported value rather than re-deriving it, so a holding no shock touches shows no change.
    const priceRatio = newPriceUsd / holding.priceUsd;
    const newValueUsd = baseValueUsd * priceRatio * exitMultiplier;
    stressedValueUsd += newValueUsd;
    impact.priceStatus = "priced";
    impact.baseValueUsd = baseValueUsd;
    impact.stressedValueUsd = newValueUsd;
    impact.deltaUsd = newValueUsd - baseValueUsd;
    impact.deltaPercent = baseValueUsd > 0 ? (newValueUsd - baseValueUsd) / baseValueUsd * 100 : 0;
    
    return {
      ...holding,
      priceUsd: newPriceUsd,
      valueUsd: newValueUsd,
    };
  });
  
  for (const impact of assetImpacts) {
    if (impact.baseValueUsd !== null) impact.baseAllocationPercent = share(impact.baseValueUsd, originalValueUsd);
    if (impact.stressedValueUsd !== null) impact.stressedAllocationPercent = share(impact.stressedValueUsd, stressedValueUsd);
  }
  for (const [index, holding] of stressedHoldings.entries()) {
    const priced = assetImpacts[index].priceStatus === "priced";
    holding.allocationPercent = priced && stressedValueUsd > 0 ? holding.valueUsd / stressedValueUsd * 100 : 0;
  }

  const valueDeltaUsd = stressedValueUsd - originalValueUsd;
  const percentageDelta = originalValueUsd !== 0 ? (valueDeltaUsd / originalValueUsd) * 100 : 0;
  
  const originalRiskScore = snapshot.riskScore;
  const stressedRiskScore = snapshot.riskScore; // Stays same for now
  
  const delta: PortfolioStressDelta = {
    originalValueUsd,
    stressedValueUsd,
    valueDeltaUsd,
    percentageDelta,
    originalRiskScore,
    stressedRiskScore,
    riskScoreDelta: stressedRiskScore - originalRiskScore,
  };
  
  const stressedSnapshot: PortfolioSnapshot = {
    ...snapshot,
    totalValueUsd: snapshot.totalValueUsd + valueDeltaUsd,
    holdings: stressedHoldings,
  };
  
  const uniqueAssumptions = Array.from(new Set(assumptions));

  return {
    assetImpacts,
    missingInputs,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    baseSnapshot: snapshot,
    stressedSnapshot,
    delta,
    assumptions: uniqueAssumptions,
    affectedHoldings: Array.from(affectedHoldings),
  };
}

export type StressThresholds = Pick<UserRule, "maxRiskScore" | "maxMemeExposurePercent" | "minStableReservePercent">;

export type StressThresholdBreach = {
  rule: keyof StressThresholds;
  label: string;
  /** Holdings responsible for the breach. */
  keys: string[];
  baseValue: number | null;
  stressedValue: number | null;
  limit: number;
  /** False when the rule was already breached before the shock. */
  crossedByStress: boolean;
};

/** Evaluates user_rules against a stress result. Allocations cover priced holdings only. */
export function evaluateStressThresholds(result: PortfolioStressResult, rules: StressThresholds): StressThresholdBreach[] {
  const breaches: StressThresholdBreach[] = [];
  const sumShare = (tokenClass: string, field: "baseAllocationPercent" | "stressedAllocationPercent") => {
    const priced = result.assetImpacts.filter((asset) => asset[field] !== null);
    if (priced.length === 0) return null;
    return priced.filter((asset) => asset.tokenClass === tokenClass).reduce((sum, asset) => sum + (asset[field] ?? 0), 0);
  };
  const keysOf = (tokenClass: string) => result.assetImpacts.filter((asset) => asset.tokenClass === tokenClass).map((asset) => asset.key);

  const memeBase = sumShare("meme", "baseAllocationPercent");
  const memeStressed = sumShare("meme", "stressedAllocationPercent");
  if (memeStressed !== null && memeStressed > rules.maxMemeExposurePercent) {
    breaches.push({
      rule: "maxMemeExposurePercent", label: "Meme exposure above maximum", keys: keysOf("meme"),
      baseValue: memeBase, stressedValue: memeStressed, limit: rules.maxMemeExposurePercent,
      crossedByStress: memeBase === null || memeBase <= rules.maxMemeExposurePercent,
    });
  }

  const minStable = rules.minStableReservePercent;
  if (minStable !== undefined) {
    const stableBase = sumShare("stablecoin", "baseAllocationPercent");
    const stableStressed = sumShare("stablecoin", "stressedAllocationPercent");
    if (stableStressed !== null && stableStressed < minStable) {
      breaches.push({
        rule: "minStableReservePercent", label: "Stable reserve below minimum", keys: keysOf("stablecoin"),
        baseValue: stableBase, stressedValue: stableStressed, limit: minStable,
        crossedByStress: stableBase === null || stableBase >= minStable,
      });
    }
  }

  // Token risk scores are not re-modelled by a shock, so these are pre-existing breaches.
  for (const asset of result.assetImpacts) {
    if (asset.riskScore > rules.maxRiskScore) {
      breaches.push({
        rule: "maxRiskScore", label: `${asset.symbol} risk score above maximum`, keys: [asset.key],
        baseValue: asset.riskScore, stressedValue: asset.riskScore, limit: rules.maxRiskScore, crossedByStress: false,
      });
    }
  }
  return breaches;
}
