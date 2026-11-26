"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TransactionRecord } from "@/server/types";

/** Lifecycle statuses that will never change — polling stops once all visible
 *  transactions reach one of these. */
const TERMINAL_STATUSES = new Set<TransactionRecord["lifecycleStatus"]>([
  "confirmed",
  "failed",
  "replaced",
  "dropped",
  "expired",
  "user_rejected",
]);

export function isTerminalStatus(status: TransactionRecord["lifecycleStatus"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Exponential-backoff intervals (ms): 3 s → 6 s → 12 s, then cap at 12 s. */
function nextInterval(attempt: number): number {
  return Math.min(3_000 * 2 ** attempt, 12_000);
}

type Options = {
  /** Wallet address forwarded to the API as a filter. */
  walletAddress?: string;
  /** Called with fresh records whenever a poll succeeds. */
  onUpdate: (records: TransactionRecord[]) => void;
  /** Maximum number of consecutive fetch failures before the hook gives up. */
  maxErrors?: number;
};

type PollerState = {
  /** Whether a fetch is in-flight. */
  fetching: boolean;
  /** Error message from the last failed fetch, or null. */
  error: string | null;
};

/**
 * Polls `/api/transactions` with exponential backoff (3 s → 6 s → 12 s).
 *
 * Polling pauses automatically when the browser tab is hidden and resumes on
 * visibility restore.  It stops entirely once every transaction in the latest
 * snapshot has reached a terminal status, or when the caller unmounts.
 *
 * Returns `{ fetching, error }` for UI feedback and an `invalidate()` helper
 * the parent can call to trigger an immediate re-fetch (e.g. after a new
 * transaction is submitted).
 */
export function usePendingTxPoller({ walletAddress, onUpdate, maxErrors = 5 }: Options): PollerState & {
  invalidate: () => void;
} {
  const [state, setState] = useState<PollerState>({ fetching: false, error: null });

  // Mutable refs so the interval callback always sees fresh values without
  // needing to be torn down and re-created on each render.
  const attemptRef = useRef(0);
  const errorCountRef = useRef(0);
  const allTerminalRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const walletRef = useRef(walletAddress);

  // Keep refs in sync with props on each render.
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });
  useEffect(() => {
    walletRef.current = walletAddress;
  }, [walletAddress]);

  const fetchNow = useCallback(async () => {
    if (allTerminalRef.current) return;
    if (document.visibilityState === "hidden") return;

    setState((prev) => ({ ...prev, fetching: true }));

    const params = new URLSearchParams();
    if (walletRef.current) params.set("walletAddress", walletRef.current);

    try {
      const res = await fetch(`/api/transactions?${params.toString()}`, {
        credentials: "same-origin",
        headers: { "Cache-Control": "no-store" },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const records: TransactionRecord[] = await res.json();
      onUpdateRef.current(records);

      errorCountRef.current = 0;

      // Stop polling once every record is in a terminal state.
      if (records.length > 0 && records.every((r) => isTerminalStatus(r.lifecycleStatus))) {
        allTerminalRef.current = true;
        setState({ fetching: false, error: null });
        return;
      }

      setState({ fetching: false, error: null });
    } catch (err) {
      errorCountRef.current += 1;
      const message = err instanceof Error ? err.message : "Polling failed.";
      setState({ fetching: false, error: message });

      if (errorCountRef.current >= (maxErrors ?? 5)) {
        // Too many consecutive errors — stop polling silently.
        allTerminalRef.current = true;
        return;
      }
    }

    // Schedule next tick with backoff.
    const delay = nextInterval(attemptRef.current);
    attemptRef.current = Math.min(attemptRef.current + 1, 2); // cap exponent at 2 (12 s)
    timerRef.current = setTimeout(() => void fetchNow(), delay);
  }, [maxErrors]);

  // Resume polling when the tab becomes visible again.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && !allTerminalRef.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        attemptRef.current = 0; // reset backoff on resume
        void fetchNow();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [fetchNow]);

  // Kick off the first fetch on mount.
  useEffect(() => {
    void fetchNow();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchNow]);

  const invalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    allTerminalRef.current = false;
    attemptRef.current = 0;
    errorCountRef.current = 0;
    void fetchNow();
  }, [fetchNow]);

  return { ...state, invalidate };
}
