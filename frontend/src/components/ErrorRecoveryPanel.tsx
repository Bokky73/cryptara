"use client";

import { useEffect, useState } from "react";
import { buildErrorDiagnostics, formatErrorDiagnostics, getErrorReference, logClientError } from "@/lib/errors/diagnostics";
import type { ApiErrorCode } from "@/server/api/errors";

export type ErrorRecoveryProps = {
  /** Client components may throw anything, so this is not necessarily an Error. */
  error: unknown;
  /** Re-fetches and re-renders the segment. Preferred over `reset`. */
  retry?: () => void;
  /** Re-renders without fetching again. */
  reset?: () => void;
  /** Where the error was caught; included in diagnostics. */
  boundary?: string;
  healthHref?: string;
};

export function recoveryForError(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: ApiErrorCode }).code : undefined;
  switch (code) {
    case "provider_timeout":
    case "stale_data":
      return { title: "Provider data unavailable", detail: "Live data could not be verified. Try loading this view again.", retry: true, href: "/dashboard", action: "Return to dashboard" };
    case "auth_error":
    case "wallet_rejection":
      return { title: "Wallet connection required", detail: "Return to the dashboard and reconnect your wallet.", retry: false, href: "/dashboard", action: "Reconnect wallet" };
    case "payment_failure":
    case "submission_failure":
    case "submit_failed":
    case "duplicate_payment":
      return { title: "Check the operation status", detail: "Review the existing operation before starting another payment or transaction.", retry: false, href: "/history", action: "Review history" };
    default:
      return { title: "This view is unavailable", detail: "The view could not be loaded. Its data must not be treated as complete.", retry: true, href: "/dashboard", action: "Return to dashboard" };
  }
}

const actionClassName = "rounded px-4 py-2 underline focus-visible:outline-2 focus-visible:outline-offset-4";
const buttonClassName = "rounded border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-4";

export function ErrorRecoveryPanel({ error, retry, reset, boundary = "app", healthHref = "/operations" }: ErrorRecoveryProps) {
  const recovery = recoveryForError(error);
  const { reference, requestId } = getErrorReference(error);
  const onRetry = retry ?? reset;
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  // Shown for manual copying when the clipboard is unavailable.
  const [manualCopy, setManualCopy] = useState<string | null>(null);

  useEffect(() => {
    logClientError(buildErrorDiagnostics(error, boundary));
  }, [boundary, error]);

  async function copyDiagnostics() {
    const text = formatErrorDiagnostics(buildErrorDiagnostics(error, boundary));
    try {
      await navigator.clipboard.writeText(text);
      setManualCopy(null);
      setCopyState("copied");
    } catch {
      setCopyState("idle");
      setManualCopy(text);
    }
  }

  return (
    <section role="alert" aria-live="assertive" className="mx-auto max-w-xl rounded-lg border border-red-300/30 bg-red-950 p-6 text-white">
      <h1 className="text-2xl font-semibold">{recovery.title}</h1>
      <p className="mt-3">{recovery.detail}</p>
      {reference || requestId ? (
        <dl className="mt-4 space-y-1 text-sm">
          {reference ? <div><dt className="inline">Reference: </dt><dd className="inline font-mono">{reference}</dd></div> : null}
          {requestId ? <div><dt className="inline">Request ID: </dt><dd className="inline font-mono">{requestId}</dd></div> : null}
        </dl>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-4">
        {recovery.retry && onRetry ? <button type="button" onClick={onRetry} className={buttonClassName}>Try again</button> : null}
        <a href={recovery.href} className={actionClassName}>{recovery.action}</a>
        {recovery.href === "/dashboard" ? null : <a href="/dashboard" className={actionClassName}>Return to dashboard</a>}
        <a href={healthHref} className={actionClassName}>Check system health</a>
        <button type="button" data-offline-allow onClick={() => void copyDiagnostics()} className={buttonClassName}>Copy diagnostics</button>
      </div>
      <p role="status" className="mt-3 text-sm">
        {copyState === "copied" ? "Diagnostics copied. Wallet addresses, tokens and cookies were removed." : ""}
      </p>
      {manualCopy ? (
        <label className="mt-3 block text-sm">
          Copy these diagnostics manually
          <textarea readOnly rows={8} value={manualCopy} className="mt-1 w-full rounded border bg-black p-2 font-mono text-xs" />
        </label>
      ) : null}
    </section>
  );
}
