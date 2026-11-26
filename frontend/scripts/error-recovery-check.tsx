import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorRecoveryPanel, recoveryForError } from "../src/components/ErrorRecoveryPanel";
async function main() {
  const secret = "0x" + "a".repeat(40);
  const error = Object.assign(new Error(secret), { code: "provider_timeout" as const, digest: secret });
  assert.equal(recoveryForError(error).title, "Provider data unavailable");
  for (const code of ["payment_failure", "submission_failure", "duplicate_payment"] as const) assert.equal(recoveryForError(Object.assign(new Error(), { code })).retry, false);
  // Segments whose fallback renders AppShell need wallet providers and are covered
  // by src/components/ErrorRecoveryPanel.test.tsx.
  for (const segment of ["", "agent/", "watchlist/", "rules/", "discovery/", "snapshots/[id]/"]) {
    const { default: Boundary } = await import(`../src/app/${segment}error.tsx`);
    const html = renderToStaticMarkup(createElement(Boundary, { error, reset() {} }));
    assert.ok(html.includes("Provider data unavailable"), segment);
    assert.ok(!html.includes(secret), segment);
  }
  const html = renderToStaticMarkup(createElement(ErrorRecoveryPanel, { error: Object.assign(new Error(), { code: "submission_failure" as const }), reset() { throw new Error("No automatic retry"); } }));
  assert.ok(!html.includes("Try again"));
  console.log("Route recovery rendering checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
