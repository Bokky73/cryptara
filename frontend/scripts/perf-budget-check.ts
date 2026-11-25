import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const REQUIRED_PROFILES = ["desktop", "constrainedMobile"] as const;

type PerformanceProfile = (typeof REQUIRED_PROFILES)[number];

type PerformanceBudgets = {
  version: number;
  profiles: Record<string, unknown>;
  bundles: {
    initialJsKb: Record<PerformanceProfile, number>;
    routeChunkKb: Record<PerformanceProfile, number>;
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

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const budgetsPath = path.join(repoRoot, "docs", "performance", "budgets.json");
const nextDir = path.join(frontendRoot, ".next");

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

function validateBudgetsShape(budgets: PerformanceBudgets) {
  for (const key of ["profiles", "bundles", "webVitals", "apiLatencyMs", "timeToFirstMeaningfulRiskResultMs"] as const) {
    assert.ok(key in budgets, `docs/performance/budgets.json is missing required top-level key "${key}".`);
  }

  for (const profile of REQUIRED_PROFILES) {
    assert.ok(budgets.profiles?.[profile], `budgets.json profiles.${profile} is required.`);
    assert.equal(typeof budgets.bundles?.initialJsKb?.[profile], "number", `budgets.json bundles.initialJsKb.${profile} must be a number.`);
    assert.equal(typeof budgets.bundles?.routeChunkKb?.[profile], "number", `budgets.json bundles.routeChunkKb.${profile} must be a number.`);

    for (const key of ["lcpMs", "inpMs", "cls", "ttfbMs"] as const) {
      assert.equal(typeof budgets.webVitals?.[key]?.[profile], "number", `budgets.json webVitals.${key}.${profile} must be a number.`);
    }

    assert.equal(
      typeof budgets.timeToFirstMeaningfulRiskResultMs?.[profile],
      "number",
      `budgets.json timeToFirstMeaningfulRiskResultMs.${profile} must be a number.`,
    );
  }

  assert.ok(budgets.apiLatencyMs && Object.keys(budgets.apiLatencyMs).length > 0, "budgets.json apiLatencyMs must define at least one route.");
  assert.ok(budgets.apiLatencyMs["scan:token"], 'budgets.json apiLatencyMs["scan:token"] is required (see docs/PERFORMANCE_BUDGETS.md).');

  for (const [route, thresholds] of Object.entries(budgets.apiLatencyMs)) {
    assert.equal(typeof thresholds?.p50, "number", `budgets.json apiLatencyMs["${route}"].p50 must be a number.`);
    assert.equal(typeof thresholds?.p95, "number", `budgets.json apiLatencyMs["${route}"].p95 must be a number.`);
  }
}

function bytesToKb(bytes: number) {
  return Math.round((bytes / 1024) * 10) / 10;
}

function normalizeChunk(file: string) {
  return file.replace(/^\.?[/\\]+/, "").replace(/\\/g, "/");
}

function isJsFile(file: string) {
  return file.endsWith(".js");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${path.relative(frontendRoot, filePath)} is not valid JSON: ${(error as Error).message}`);
  }
}

function findManifests(root: string, fileName: string): string[] {
  if (!existsSync(root)) return [];

  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...findManifests(fullPath, fileName));
    } else if (entry.isFile() && entry.name === fileName) {
      results.push(fullPath);
    }
  }

  return results;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)].filter((filePath) => existsSync(filePath));
}

function addJsFiles(target: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;

  for (const file of value) {
    if (typeof file === "string" && isJsFile(file)) target.add(normalizeChunk(file));
  }
}

function addJsFilesFromRecordValues(target: Set<string>, value: unknown) {
  addJsFiles(target, Object.values(asRecord(value)));
}

function collectLazyFiles(value: unknown, target: Set<string>) {
  if (Array.isArray(value)) {
    for (const entry of value) collectLazyFiles(entry, target);
    return;
  }

  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.files)) addJsFiles(target, record.files);

  for (const [key, child] of Object.entries(record)) {
    if (key === "files" || typeof child !== "object" || child === null) continue;
    collectLazyFiles(child, target);
  }
}

function collectBuildManifest(
  filePath: string,
  sharedChunks: Set<string>,
  pageChunks: Map<string, Set<string>>,
) {
  const manifest = readJson(filePath) as Record<string, unknown>;
  const root = asRecord(manifest);
  const serverRoot = path.join(nextDir, "server");
  const routeKey = filePath.startsWith(serverRoot)
    ? path.relative(serverRoot, path.dirname(filePath)).replace(/\\/g, "/") || "/"
    : path.relative(nextDir, path.dirname(filePath)).replace(/\\/g, "/") || "/";
  const files = new Set<string>();

  addJsFilesFromRecordValues(files, root.pages);

  for (const key of ["rootMainFiles", "polyfillFiles", "lowPriorityFiles"] as const) {
    addJsFiles(files, root[key]);
    addJsFiles(sharedChunks, root[key]);
  }

  for (const params of Object.values(asRecord(root.pagesChunkGroupBootstrapParams))) {
    addJsFiles(files, asRecord(params).otherChunks);
  }

  if (files.size > 0) {
    const combined = pageChunks.get(routeKey) ?? new Set<string>();
    for (const file of files) combined.add(file);
    pageChunks.set(routeKey, combined);
  }
}

function collectLoadableManifest(filePath: string, lazyChunks: Set<string>) {
  collectLazyFiles(readJson(filePath), lazyChunks);
}

function chunkSizeKb(file: string) {
  return bytesToKb(gzipSync(readFileSync(path.join(nextDir, file))).length);
}

function checkBundleSizes(budgets: PerformanceBudgets, failures: string[], notes: string[], allowSkip: boolean) {
  if (!existsSync(nextDir)) {
    const message = "no .next build output found. Run `npm run build` first for a full check (or pass --allow-skip).";
    if (allowSkip) {
      notes.push(`SKIP bundle size checks: ${message}`);
    } else {
      failures.push(`Bundle size checks could not run: ${message}`);
    }
    return;
  }

  const buildManifestPaths = uniquePaths([
    path.join(nextDir, "app-build-manifest.json"),
    path.join(nextDir, "build-manifest.json"),
    ...findManifests(path.join(nextDir, "server"), "build-manifest.json"),
  ]);
  const loadableManifestPaths = uniquePaths([
    path.join(nextDir, "react-loadable-manifest.json"),
    ...findManifests(path.join(nextDir, "server"), "react-loadable-manifest.json"),
  ]);

  if (buildManifestPaths.length === 0 && loadableManifestPaths.length === 0) {
    const message = ".next exists but no build or loadable manifests were found. Run `npm run build` first (or pass --allow-skip).";
    if (allowSkip) {
      notes.push(`SKIP bundle size checks: ${message}`);
    } else {
      failures.push(`Bundle size checks could not run: ${message}`);
    }
    return;
  }

  const sharedChunks = new Set<string>();
  const pageChunks = new Map<string, Set<string>>();
  const lazyChunks = new Set<string>();

  for (const filePath of buildManifestPaths) collectBuildManifest(filePath, sharedChunks, pageChunks);
  for (const filePath of loadableManifestPaths) collectLoadableManifest(filePath, lazyChunks);

  const routeUsage = new Map<string, number>();
  for (const files of pageChunks.values()) {
    for (const file of files) routeUsage.set(file, (routeUsage.get(file) ?? 0) + 1);
  }

  const initialChunks = new Set<string>(sharedChunks);
  for (const [file, count] of routeUsage) {
    if (count > 1) initialChunks.add(file);
  }
  if (pageChunks.size === 1 && sharedChunks.size === 0) {
    for (const files of pageChunks.values()) {
      for (const file of files) initialChunks.add(file);
    }
  }
  for (const file of lazyChunks) initialChunks.delete(file);

  const routeChunks = new Map<string, string[]>();
  for (const [page, files] of pageChunks) {
    routeChunks.set(page, [...files].filter((file) => !initialChunks.has(file) && !lazyChunks.has(file)));
  }

  const measuredChunks = new Set<string>([...initialChunks, ...[...routeChunks.values()].flat(), ...lazyChunks]);
  if (measuredChunks.size === 0) {
    const message = `build manifests were found (${buildManifestPaths.length} build, ${loadableManifestPaths.length} loadable) but no JS chunks were measured.`;
    if (allowSkip) {
      notes.push(`SKIP bundle size checks: ${message}`);
    } else {
      failures.push(`Bundle size checks could not run: ${message}`);
    }
    return;
  }

  for (const file of measuredChunks) {
    if (!existsSync(path.join(nextDir, file))) {
      failures.push(`Build manifest refers to a missing chunk: ${file}. Run npm run build again.`);
    }
  }

  notes.push(`Measured ${buildManifestPaths.length} build manifest(s) and ${loadableManifestPaths.length} loadable manifest(s).`);

  const initialFiles = [...initialChunks].filter((file) => existsSync(path.join(nextDir, file)));
  const largestInitialKb = initialFiles.reduce((largest, file) => Math.max(largest, chunkSizeKb(file)), 0);
  const totalInitialKb = bytesToKb(initialFiles.reduce((total, file) => total + gzipSync(readFileSync(path.join(nextDir, file))).length, 0));

  for (const [profile, budgetKb] of Object.entries(budgets.bundles.initialJsKb)) {
    const detail = `measured ${totalInitialKb}KB gzip across ${initialFiles.length} shared chunk(s), largest ${largestInitialKb}KB`;

    if (budgetKb > 0 && totalInitialKb > budgetKb) {
      const overPct = ((totalInitialKb - budgetKb) / budgetKb) * 100;
      failures.push(
        `[${profile}] Initial JS is ${totalInitialKb}KB, exceeding the ${budgetKb}KB budget by ${overPct.toFixed(1)}% (${detail}). ` +
          "Check for newly added dependencies pulled into every route, or code that should be dynamically imported.",
      );
    } else {
      notes.push(`[${profile}] Initial JS ${detail} (budget ${budgetKb}KB).`);
    }
  }

  const routeSizes = new Map<string, { file: string; kb: number }[]>();
  for (const [page, files] of routeChunks) {
    routeSizes.set(
      page,
      files
        .filter((file) => existsSync(path.join(nextDir, file)))
        .map((file) => ({ file, kb: chunkSizeKb(file) })),
    );
  }

  const lazySizes = [...lazyChunks]
    .filter((file) => existsSync(path.join(nextDir, file)))
    .map((file) => ({ file, kb: chunkSizeKb(file) }));

  for (const [profile, budgetKb] of Object.entries(budgets.bundles.routeChunkKb)) {
    const routeOverBudget = [...routeSizes.values()].flat().filter(({ kb }) => budgetKb > 0 && kb > budgetKb);
    const lazyOverBudget = lazySizes.filter(({ kb }) => budgetKb > 0 && kb > budgetKb);

    for (const entry of routeOverBudget) {
      failures.push(
        `[${profile}] Route chunk ${entry.file} is ${entry.kb}KB gzip, exceeding the ${budgetKb}KB budget by ${(((entry.kb - budgetKb) / budgetKb) * 100).toFixed(1)}%. ` +
          "Consider splitting the route, lazy-loading a heavy component, or moving logic server-side.",
      );
    }

    for (const entry of lazyOverBudget) {
      failures.push(
        `[${profile}] Lazy chunk ${entry.file} is ${entry.kb}KB gzip, exceeding the ${budgetKb}KB budget by ${(((entry.kb - budgetKb) / budgetKb) * 100).toFixed(1)}%. ` +
          "Consider splitting the dynamically imported module or removing heavy dependencies from it.",
      );
    }

    const routeChecked = [...routeSizes.values()].flat().length;
    if (routeChecked === 0) {
      notes.push(`[${profile}] No route-specific chunk files were identified in the build manifests.`);
    } else if (routeOverBudget.length === 0) {
      notes.push(`[${profile}] Checked ${routeChecked} route chunk file(s) against the ${budgetKb}KB budget: none exceed the budget.`);
    }

    if (lazySizes.length === 0) {
      notes.push(`[${profile}] No lazy chunk files were identified in the build manifests.`);
    } else if (lazyOverBudget.length === 0) {
      notes.push(`[${profile}] Checked ${lazySizes.length} lazy chunk file(s) against the ${budgetKb}KB budget: none exceed the budget.`);
    }
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
  const allowSkip = process.argv.includes("--allow-skip");

  const budgets = loadBudgets();
  validateBudgetsShape(budgets);
  notes.push("docs/performance/budgets.json structural validation passed.");

  checkBundleSizes(budgets, failures, notes, allowSkip);

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
