import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function repoPath(relative: string) {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

const scopedFiles = [
  "src/components/AppShell.tsx",
  "src/components/AgentVerdictCard.tsx",
  "src/components/ApprovalFlowClient.tsx",
  "src/components/AutoModeGuardrailPanel.tsx",
  "src/components/OperationsSloPanel.tsx",
  "src/components/RecoveryClient.tsx",
  "src/components/RiskBreakdownCard.tsx",
  "src/components/TokenScanClient.tsx",
  "src/components/charts/AgentScoreTrendCardCanvas.tsx",
  "src/components/charts/TrendChartCanvas.tsx",
];

const forbiddenFormatting = /\.(?:toLocaleString|toLocaleDateString|toLocaleTimeString)\(|new Intl\.(?:DateTimeFormat|NumberFormat)\(/;
const failures: string[] = [];

for (const relative of scopedFiles) {
  const path = repoPath(relative);
  assert.ok(existsSync(path), `Expected file to exist: frontend/${relative}`);
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    if (forbiddenFormatting.test(line)) {
      failures.push(`frontend/${relative}:${index + 1} uses ad-hoc locale formatting`);
    }
  });
}

assert.deepEqual(failures, [], `Scoped components must use frontend/src/i18n/format.ts helpers:\n${failures.join("\n")}`);
console.log(`I18n source checks passed (${scopedFiles.length} scoped files)`);
