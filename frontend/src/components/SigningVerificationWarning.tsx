"use client";

import type { SigningVerificationIssue } from "@/lib/signing/previewVerification";

/**
 * Security banner shared by every signing surface. It is intentionally
 * impossible to dismiss with "sign anyway": a failed check requires a fresh
 * prepare + simulation, never an override.
 */
export function SigningVerificationWarning({
  issues,
  onRefresh,
  refreshLabel = "Refresh Quote & Re-simulate",
}: {
  issues: SigningVerificationIssue[];
  onRefresh?: () => void;
  refreshLabel?: string;
}) {
  if (issues.length === 0) return null;

  const needsRefresh = issues.some((issue) => issue.refreshRequired);

  return (
    <div
      role="alert"
      data-testid="signing-verification-warning"
      className="mt-5 rounded-2xl border border-red-400/40 bg-red-500/12 px-4 py-3 text-sm text-red-100"
    >
      <div className="font-semibold">Signing blocked: payload does not match the reviewed preview</div>
      <div className="mt-1 opacity-85">
        Cryptara stopped before opening the wallet. No signature was requested.
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.field}-${index}`} data-testid={`verification-issue-${issue.code}`}>
            {issue.message}
          </li>
        ))}
      </ul>
      {onRefresh && needsRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="mt-3 rounded-full bg-red-400/20 px-3 py-1 text-xs font-semibold text-red-50 transition hover:bg-red-400/30"
        >
          {refreshLabel}
        </button>
      ) : null}
    </div>
  );
}
