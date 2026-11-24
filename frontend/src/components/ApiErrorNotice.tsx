"use client";

import type { ApiClientError, RecoveryAction } from "@/lib/apiClient";

const recoveryLabels: Record<RecoveryAction, string> = {
  retry: "Retry the request",
  retry_after_delay: "Wait, then retry",
  reconnect: "Reconnect your wallet",
  switch_network: "Switch network",
  refresh_data: "Refresh the data",
  stop: "No automatic recovery",
};

/** Single UI surface for the structured API error envelope. */
export function ApiErrorNotice({
  error,
  onRetry,
  title = "Request failed",
}: {
  error: ApiClientError | null | undefined;
  onRetry?: () => void;
  title?: string;
}) {
  if (!error) return null;
  const canRetry = error.retryable && Boolean(onRetry);

  return (
    <section
      role="alert"
      aria-live="polite"
      className="rounded-xl border border-red-300/25 bg-red-500/10 p-3 text-xs text-red-200"
    >
      <div className="flex flex-wrap items-center gap-2 font-semibold">
        <span>{title}</span>
        <code className="rounded border border-red-300/20 bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">
          {error.code}
        </code>
      </div>
      <p className="mt-1 text-red-200/85">{error.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-red-200/70">
        <span>{error.retryable ? "Retryable" : "Not retryable"}</span>
        <span aria-hidden="true">·</span>
        <span>{recoveryLabels[error.recoveryAction] ?? recoveryLabels.stop}</span>
        {error.requestId ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{error.requestId}</span>
          </>
        ) : null}
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto rounded border border-red-300/30 px-2 py-0.5 font-medium text-red-100 hover:bg-red-400/15"
          >
            Try again
          </button>
        ) : null}
      </div>
    </section>
  );
}
