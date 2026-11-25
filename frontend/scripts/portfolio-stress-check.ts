import assert from "node:assert/strict";
import { applyStressScenario, evaluateStressThresholds } from "../src/server/portfolio/stress";
import { allTokensFixture, mockPortfolioFixture } from "../src/server/portfolio/stressFixtures";
import { buildCustomStressScenario, holdingTarget, normalizeCustomStress, STRESS_SCENARIOS } from "../src/server/portfolio/scenarios";

function runTests() {
  console.log("=== Portfolio Stress Testing ===");
  console.log(`Testing with base portfolio value: $${mockPortfolioFixture.totalValueUsd.toFixed(2)}`);
  
  for (const scenario of STRESS_SCENARIOS) {
    console.log(`\n--- Running Scenario: ${scenario.name} ---`);
    console.log(`Description: ${scenario.description}`);
    
    const result = applyStressScenario(mockPortfolioFixture, scenario);
    
    console.log(`Scenario ID: ${result.scenarioId} v${result.scenarioVersion}`);
    console.log(`Base Value: $${result.delta.originalValueUsd.toFixed(2)}`);
    console.log(`Stressed Value: $${result.delta.stressedValueUsd.toFixed(2)}`);
    console.log(`Delta: $${result.delta.valueDeltaUsd.toFixed(2)} (${result.delta.percentageDelta.toFixed(2)}%)`);
    console.log(`Affected Holdings: ${result.affectedHoldings.join(", ") || "None"}`);
    
    console.log("Assumptions:");
    for (const assumption of result.assumptions) {
      console.log(`  - ${assumption}`);
    }
  }

  console.log("\n=== Extended Test: Portfolio with XLM ===");
  const stellarScenario = STRESS_SCENARIOS[0]; // Just picking market crash
  const xlmResult = applyStressScenario(allTokensFixture, stellarScenario);
  console.log(`Base Value: $${xlmResult.delta.originalValueUsd.toFixed(2)}`);
  console.log(`Stressed Value: $${xlmResult.delta.stressedValueUsd.toFixed(2)}`);
  console.log(`Delta: $${xlmResult.delta.valueDeltaUsd.toFixed(2)} (${xlmResult.delta.percentageDelta.toFixed(2)}%)`);
  console.log(`Affected Holdings: ${xlmResult.affectedHoldings.join(", ") || "None"}`);
}

function runCustomScenarioTests() {
  const base = mockPortfolioFixture;
  const run = (params: Parameters<typeof buildCustomStressScenario>[0], snapshot = base) =>
    applyStressScenario(snapshot, buildCustomStressScenario(params));
  const off = { marketDrawdownPercent: null, liquidityHaircutPercent: 0, depegTarget: null };
  const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  const total = base.holdings.reduce((sum, h) => sum + h.valueUsd, 0);
  const usdc = base.holdings.find((h) => h.symbol === "USDC")!;

  // Deterministic, and no shock means no change.
  const params = { marketDrawdownPercent: -40, liquidityHaircutPercent: 15, depegTarget: holdingTarget(usdc), depegPercent: 25 };
  const before = JSON.stringify(base);
  assert.deepEqual(run(params), run(params));
  assert.equal(JSON.stringify(base), before);
  assert.equal(run(off).delta.valueDeltaUsd, 0);
  near(run(params).delta.stressedValueUsd, ((total - usdc.valueUsd) * 0.6 + usdc.valueUsd * 0.75) * 0.85);

  // Bounds hold for out-of-range and malformed input.
  assert.equal(normalizeCustomStress({ marketDrawdownPercent: -500 }).marketDrawdownPercent, -80);
  assert.equal(normalizeCustomStress({ marketDrawdownPercent: 5 }).marketDrawdownPercent, -10);
  assert.equal(normalizeCustomStress({ liquidityHaircutPercent: Number.NaN }).liquidityHaircutPercent, 0);
  assert.equal(normalizeCustomStress({ depegTarget: "all" }).depegTarget, null);

  // A single-asset depeg is chain-qualified.
  const twin = { ...usdc, chainId: "other-chain" };
  const twins = run({ ...off, depegTarget: holdingTarget(usdc), depegPercent: 50 }, { ...base, holdings: [usdc, twin] });
  assert.deepEqual(twins.assetImpacts.map((a) => a.deltaPercent), [-50, 0]);

  // Missing inputs are flagged, never reported as zero impact.
  for (const gap of [{ priceUsd: null }, { priceUsd: 0, valueUsd: 0 }, { priceUsd: Number.NaN }, { priceStatus: "unavailable" as const }]) {
    const result = run(params, { ...base, holdings: [{ ...usdc, ...gap }] });
    assert.equal(result.assetImpacts[0].deltaUsd, null);
    assert.equal(result.delta.originalValueUsd, 0);
    assert.equal(result.missingInputs.some((m) => m.input === "price"), true);
  }
  const illiquid = run(params, { ...base, holdings: [{ ...usdc, stellarRisk: { authorized: true, authorizationRequired: false, revocable: false, clawbackEnabled: false, liquidity: "unknown", dataStatus: "partial" } }] });
  assert.equal(illiquid.missingInputs[0].input, "liquidity");

  // user_rules thresholds: a 100% USDC depeg pushes the stable reserve below its floor.
  const breaches = evaluateStressThresholds(run({ ...off, depegTarget: "stablecoins", depegPercent: 100 }), { maxRiskScore: 100, maxMemeExposurePercent: 100, minStableReservePercent: 15 });
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].rule, "minStableReservePercent");
  assert.equal(breaches[0].crossedByStress, true);
  console.log("\nCustom scenario checks passed");
}

runTests();
runCustomScenarioTests();
