/**
 * Accessibility budget gate — issue #105
 *
 * Runs axe-core against the three core routes and fails the job when
 * critical or serious violations are found, which corresponds to an
 * approximated Accessibility score below the >= 95 budget target.
 *
 * CLS is measured via the Layout Instability API and checked against
 * the 0.1 budget defined in docs/performance/budgets.json.
 *
 * Results are posted to $GITHUB_STEP_SUMMARY when running in CI.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

// Routes to audit — must all load without authentication in test mode.
const AUDIT_ROUTES = ["/", "/scan", "/dashboard"];

// Max critical/serious axe violations before we fail (0 = strict).
const MAX_CRITICAL_VIOLATIONS = 0;
const MAX_SERIOUS_VIOLATIONS = 0;

// CLS budget from docs/performance/budgets.json (desktop profile).
const CLS_BUDGET = 0.1;

type AxeViolation = {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  nodes: unknown[];
};

type AxeResult = {
  violations: AxeViolation[];
  passes: unknown[];
  incomplete: unknown[];
};

function writeStepSummary(rows: string[][]): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const lines = [
    "## Accessibility & CLS budget\n",
    "| Route | Critical | Serious | Moderate | CLS | Status |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.join(" | ")} |`),
    "",
  ];
  appendFileSync(summaryFile, lines.join("\n") + "\n");
}

// Accumulate per-route results for the step summary table.
const summaryRows: string[][] = [];

test.afterAll(() => {
  if (summaryRows.length > 0) writeStepSummary(summaryRows);
});

for (const route of AUDIT_ROUTES) {
  test(`a11y budget: ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });

    // Inject axe-core from the local node_modules copy installed by npm ci.
    const axePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../node_modules/axe-core/axe.min.js",
    );
    await page.addScriptTag({ path: axePath });

    // Run axe and collect results.
    const results = await page.evaluate<AxeResult>(() =>
      // @ts-expect-error – axe is injected at runtime
      window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      }),
    );

    const critical = results.violations.filter((v) => v.impact === "critical");
    const serious = results.violations.filter((v) => v.impact === "serious");
    const moderate = results.violations.filter((v) => v.impact === "moderate");

    // Measure CLS over a 1-second observation window.
    const cls = await page.evaluate<number>(() => {
      return new Promise((resolve) => {
        let cumulativeCls = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            // LayoutShift entries carry a `value` property.
            cumulativeCls += (entry as unknown as { value: number }).value;
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        // Allow layout to settle, then resolve.
        setTimeout(() => {
          observer.disconnect();
          resolve(cumulativeCls);
        }, 1000);
      });
    });

    const clsOk = cls <= CLS_BUDGET;
    const a11yOk = critical.length <= MAX_CRITICAL_VIOLATIONS && serious.length <= MAX_SERIOUS_VIOLATIONS;
    const status = a11yOk && clsOk ? "✅" : "❌";

    summaryRows.push([
      route,
      String(critical.length),
      String(serious.length),
      String(moderate.length),
      cls.toFixed(3),
      status,
    ]);

    // Print diagnostic detail before asserting so failures are readable in CI logs.
    if (critical.length > 0 || serious.length > 0) {
      console.error(`\n[a11y-budget] violations on ${route}:`);
      for (const v of [...critical, ...serious]) {
        console.error(`  [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`);
      }
    }

    expect(
      critical.length,
      `${route}: ${critical.length} critical axe violation(s) found — budget allows ${MAX_CRITICAL_VIOLATIONS}`,
    ).toBeLessThanOrEqual(MAX_CRITICAL_VIOLATIONS);

    expect(
      serious.length,
      `${route}: ${serious.length} serious axe violation(s) found — budget allows ${MAX_SERIOUS_VIOLATIONS}`,
    ).toBeLessThanOrEqual(MAX_SERIOUS_VIOLATIONS);

    expect(
      cls,
      `${route}: CLS ${cls.toFixed(3)} exceeds the ${CLS_BUDGET} budget from docs/performance/budgets.json`,
    ).toBeLessThanOrEqual(CLS_BUDGET);
  });
}
