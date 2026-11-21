import assert from "node:assert/strict";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Percent over budget before the check hard-fails (15 % grace window). */
const BUDGET_OVERAGE_THRESHOLD_PCT = 15;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const budgetsPath = path.join(repoRoot, "docs", "performance", "budgets.json");
const nextDir = path.join(frontendRoot, ".next");

type PerformanceBudgets = {
  version: number;
  profiles: Record<string, unknown>;
  bundles: {
    initialJsKb: Record<string, number>;
    routeChunkKb: Record<string, number>;
  };
  webVitals: {
    lcpMs: Record<string, number>;
    inpMs: Record<string, number>;
    cls: Record<string, number>;
    ttfbMs: Record<string, number>;
  };
  apiLatencyMs: Record<string, { p50: number; p95: number }>;
  timeToFirstMeaningfulRiskResultMs: Record<string, number>;
};

function loadBudgets(): PerformanceBudgets {
  if (!existsSync(budgetsPath)) {
    throw new Error(
      `Budgets file not found at ${path.relative(repoRoot, budgetsPath)}. ` +
        "Create docs/performance/budgets.json (see docs/PERFORMANCE_BUDGETS.md) before running test:perf.",
    );
  }

  const raw = readFileSync(budgetsPath, "utf8");

  try {
    return JSON.parse(raw) as PerformanceBudgets;
  } catch (error) {
    throw new Error(`docs/performance/budgets.json is not valid JSON: ${(error as Error).message}`);
  }
}

/** Fails fast (throws) rather than silently passing if a required budget key is missing. */
function validateBudgetsShape(budgets: PerformanceBudgets) {
  for (const key of ["profiles", "bundles", "webVitals", "apiLatencyMs", "timeToFirstMeaningfulRiskResultMs"] as const) {
    assert.ok(key in budgets, `docs/performance/budgets.json is missing required top-level key "${key}".`);
  }

  assert.ok(budgets.bundles?.initialJsKb && Object.keys(budgets.bundles.initialJsKb).length > 0, 'budgets.json bundles.initialJsKb must define at least one profile.');
  assert.ok(budgets.bundles?.routeChunkKb && Object.keys(budgets.bundles.routeChunkKb).length > 0, 'budgets.json bundles.routeChunkKb must define at least one profile.');

  for (const key of ["lcpMs", "inpMs", "cls", "ttfbMs"] as const) {
    assert.ok(budgets.webVitals?.[key] && Object.keys(budgets.webVitals[key]).length > 0, `budgets.json webVitals.${key} must define at least one profile.`);
  }

  assert.ok(budgets.apiLatencyMs && Object.keys(budgets.apiLatencyMs).length > 0, "budgets.json apiLatencyMs must define at least one route.");
  assert.ok(budgets.apiLatencyMs["scan:token"], 'budgets.json apiLatencyMs["scan:token"] is required (see docs/PERFORMANCE_BUDGETS.md).');

  for (const [route, thresholds] of Object.entries(budgets.apiLatencyMs)) {
    assert.equal(typeof thresholds?.p50, "number", `budgets.json apiLatencyMs["${route}"].p50 must be a number.`);
    assert.equal(typeof thresholds?.p95, "number", `budgets.json apiLatencyMs["${route}"].p95 must be a number.`);
  }

  assert.ok(
    budgets.timeToFirstMeaningfulRiskResultMs && Object.keys(budgets.timeToFirstMeaningfulRiskResultMs).length > 0,
    "budgets.json timeToFirstMeaningfulRiskResultMs must define at least one profile.",
  );
}

function bytesToKb(bytes: number) {
  return Math.round((bytes / 1024) * 10) / 10;
}

function findJsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Route chunks live under a chunk-directory path segment named "app" (both
 * webpack and turbopack place per-route code there); everything else in
 * static/chunks is treated as shared/initial JS. This is a best-effort
 * classification — see docs/PERFORMANCE_BUDGETS.md for the measurement
 * conditions a maintainer should reproduce manually before trusting a
 * borderline result.
 */
function isRouteChunk(filePath: string) {
  const segments = filePath.split(path.sep);
  return segments.includes("app");
}

function checkBundleSizes(budgets: PerformanceBudgets, failures: string[], notes: string[]) {
  if (!existsSync(nextDir)) {
    notes.push("SKIP bundle size checks: no .next build output found. Run `npm run build` first for a full check.");
    return;
  }

  const chunksDir = path.join(nextDir, "static", "chunks");
  const chunkFiles = findJsFiles(chunksDir);

  if (chunkFiles.length === 0) {
    notes.push("SKIP bundle size checks: .next exists but no chunk files were found under .next/static/chunks.");
    return;
  }

  const routeChunks = chunkFiles.filter(isRouteChunk);
  const sharedChunks = chunkFiles.filter((file) => !isRouteChunk(file));

  const initialJsKb = bytesToKb(sharedChunks.reduce((total, file) => total + statSync(file).size, 0));
  const initialBudgetKb = Math.max(...Object.values(budgets.bundles.initialJsKb));
  const initialOverPct = initialBudgetKb > 0 ? ((initialJsKb - initialBudgetKb) / initialBudgetKb) * 100 : 0;

  if (initialOverPct > BUDGET_OVERAGE_THRESHOLD_PCT) {
    failures.push(
      `Initial (shared) JS is ${initialJsKb}KB, exceeding the ${initialBudgetKb}KB budget by ${initialOverPct.toFixed(1)}% (threshold ${BUDGET_OVERAGE_THRESHOLD_PCT}%). ` +
        "Check for newly added dependencies pulled into every route, or code that should be dynamically imported.",
    );
  } else if (initialJsKb > initialBudgetKb) {
    notes.push(`WARN Initial JS: ${initialJsKb}KB is over the ${initialBudgetKb}KB budget by ${initialOverPct.toFixed(1)}% (within ${BUDGET_OVERAGE_THRESHOLD_PCT}% grace).`);
  } else {
    notes.push(`Initial JS: ${initialJsKb}KB (budget ${initialBudgetKb}KB, ${sharedChunks.length} shared chunk file(s)).`);
  }

  const routeChunkBudgetKb = Math.max(...Object.values(budgets.bundles.routeChunkKb));
  const routeChunkResults = routeChunks.map((file) => {
    const kb = bytesToKb(statSync(file).size);
    const overPct = routeChunkBudgetKb > 0 ? ((kb - routeChunkBudgetKb) / routeChunkBudgetKb) * 100 : 0;
    return { file, kb, overPct };
  });

  const hardFails = routeChunkResults.filter((r) => r.overPct > BUDGET_OVERAGE_THRESHOLD_PCT);
  const softWarns = routeChunkResults.filter((r) => r.overPct > 0 && r.overPct <= BUDGET_OVERAGE_THRESHOLD_PCT);

  for (const entry of hardFails) {
    failures.push(
      `Route chunk ${path.relative(nextDir, entry.file)} is ${entry.kb}KB, exceeding the ${routeChunkBudgetKb}KB budget by ${entry.overPct.toFixed(1)}% (threshold ${BUDGET_OVERAGE_THRESHOLD_PCT}%). ` +
        "Consider splitting the route, lazy-loading a heavy component, or moving logic server-side.",
    );
  }
  for (const entry of softWarns) {
    notes.push(`WARN route chunk ${path.relative(nextDir, entry.file)}: ${entry.kb}KB is over budget by ${entry.overPct.toFixed(1)}% (within grace).`);
  }
  if (hardFails.length === 0 && routeChunks.length > 0) {
    notes.push(`Checked ${routeChunks.length} route chunk file(s) against the ${routeChunkBudgetKb}KB budget: none exceed the ${BUDGET_OVERAGE_THRESHOLD_PCT}% failure threshold.`);
  } else if (routeChunks.length === 0) {
    notes.push("No route-specific chunk files were identified to check individually (only shared chunks were found).");
  }
}

function writeStepSummary(notes: string[], failures: string[]) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const lines: string[] = ["## Bundle size budget\n"];

  if (notes.length > 0) {
    lines.push("| Status | Detail |");
    lines.push("|---|---|");
    for (const note of notes) {
      const icon = note.startsWith("WARN") ? "⚠️" : note.startsWith("SKIP") ? "⏭️" : "✅";
      lines.push(`| ${icon} | ${note.replace(/^(WARN|SKIP)\s+/, "")} |`);
    }
    lines.push("");
  }

  if (failures.length > 0) {
    lines.push("### ❌ Failures\n");
    for (const failure of failures) {
      lines.push(`- ${failure}`);
    }
    lines.push("");
  } else {
    lines.push("**Result: ✅ All bundle checks passed.**\n");
  }

  appendFileSync(summaryFile, lines.join("\n") + "\n");
}

async function main() {
  const failures: string[] = [];
  const notes: string[] = [];

  const budgets = loadBudgets();
  validateBudgetsShape(budgets);
  notes.push("docs/performance/budgets.json structural validation passed.");

  checkBundleSizes(budgets, failures, notes);

  for (const note of notes) {
    console.log(`[test:perf] ${note}`);
  }

  writeStepSummary(notes, failures);

  if (failures.length > 0) {
    console.error("\n[test:perf] Performance budget check FAILED:\n");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    console.error("\nSee docs/PERFORMANCE_BUDGETS.md for measurement conditions and how to approve an intentional budget change.");
    process.exitCode = 1;
    return;
  }

  console.log("\n[test:perf] Performance budget check passed.");
}

void main();
