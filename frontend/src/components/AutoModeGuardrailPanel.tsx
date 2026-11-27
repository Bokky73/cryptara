"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KillSwitchState = {
  engaged: boolean;
  reason?: string;
  actor?: string;
  engagedAt?: string;
};

export type BudgetMeters = {
  /** USD spent today against the daily cap */
  dailySpentUsd: number;
  /** Daily cap in USD from the active policy */
  maxDailyValueUsd: number;
  /** Max single-transaction USD cap */
  maxSingleTxUsd: number;
  /** Max slippage in basis points */
  maxSlippageBps: number;
  /** ISO-8601 string when authorization expires */
  authorizationExpiresAt?: string;
};

type Props = {
  /** Kill-switch state to seed the panel; updated via BroadcastChannel / polling */
  state: KillSwitchState;
  /** Optional scope for per-chain polling. Defaults to evm / legacy-evm. */
  chainFamily?: "evm" | "stellar";
  network?: string;
  /** Live budget numbers rendered as progress meters */
  budget?: BudgetMeters;
};

// ---------------------------------------------------------------------------
// BroadcastChannel channel name – must match whatever server-sent event or
// other tab uses when it confirms the kill-switch has fired.
// ---------------------------------------------------------------------------
const KILL_SWITCH_CHANNEL = "cryptara:kill-switch";
const KILL_SWITCH_LS_KEY = "cryptara_kill_switch";
/** Re-poll the server every 400 ms while engaged so we catch reenables fast */
const ENGAGED_POLL_MS = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBps(bps: number) {
  return `${(bps / 100).toFixed(2)} %`;
}

function pct(spent: number, cap: number) {
  if (!cap || cap <= 0) return 0;
  return Math.min(100, (spent / cap) * 100);
}

function MeterBar({ label, value, max, format }: { label: string; value: number; max: number; format: (v: number) => string }) {
  const ratio = pct(value, max);
  const color = ratio >= 90 ? "bg-red-400" : ratio >= 70 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-white/60">
        <span>{label}</span>
        <span className="font-medium text-white/80">
          {format(value)} <span className="text-white/40">/ {format(max)}</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${ratio}%` }}
          role="progressbar"
          aria-valuenow={Math.round(ratio)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  );
}

function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    function compute() {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (!Number.isFinite(diff) || diff <= 0) {
        setRemaining("Expired");
        return;
      }
      const totalSec = Math.floor(diff / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      if (days > 0) setRemaining(`${days}d ${hours}h`);
      else if (hours > 0) setRemaining(`${hours}h ${mins}m`);
      else setRemaining(`${mins}m ${secs.toString().padStart(2, "0")}s`);
    }
    compute();
    const id = window.setInterval(compute, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  if (!remaining) return null;
  const expired = remaining === "Expired";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-white/60">
        <span>Authorization expiry</span>
        <span className={`font-medium ${expired ? "text-red-400" : "text-white/80"}`}>{remaining}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${expired ? "bg-red-400 w-full" : "bg-[#d9a441]"}`}
          style={expired ? undefined : {
            width: `${Math.max(0, Math.min(100, (1 - (new Date(expiresAt).getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000)) * 100))}%`,
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AutoModeGuardrailPanel({ state: initialState, chainFamily = "evm", network = "legacy-evm", budget }: Props) {
  const { format } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [liveState, setLiveState] = useState<KillSwitchState>(initialState);
  // Track whether the kill-switch fired in *this* tab (vs another tab) for
  // the confirmation banner.
  const [crossTabAlert, setCrossTabAlert] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------
  // Write to localStorage so tabs without BroadcastChannel support also
  // pick up the state change via storage events.
  // ------------------------------------------------------------------
  const persistToStorage = useCallback((s: KillSwitchState) => {
    try {
      localStorage.setItem(KILL_SWITCH_LS_KEY, JSON.stringify({ ...s, network, chainFamily }));
    } catch {
      // storage unavailable – ignore
    }
  }, [network, chainFamily]);

  // ------------------------------------------------------------------
  // Apply a new state received from any source (server poll / broadcast
  // / storage event).
  // ------------------------------------------------------------------
  const applyState = useCallback((next: KillSwitchState, fromOtherTab = false) => {
    setLiveState(next);
    persistToStorage(next);
    if (next.engaged && fromOtherTab) {
      setCrossTabAlert(true);
      setExpanded(true);
    }
  }, [persistToStorage]);

  // ------------------------------------------------------------------
  // Poll the kill-switch endpoint.  When engaged we poll faster so the
  // "reenabled" state propagates within 400 ms.
  // ------------------------------------------------------------------
  const poll = useCallback(async () => {
    try {
      const params = new URLSearchParams({ chainFamily, network });
      const res = await fetch(`/api/auto-mode/kill-switch?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as KillSwitchState;
      setLiveState((prev) => {
        const changed = prev.engaged !== data.engaged;
        if (changed) {
          persistToStorage(data);
          // Broadcast to other open tabs.
          channelRef.current?.postMessage(data);
        }
        return data;
      });
    } catch {
      // Network failure – keep last known state.
    }
  }, [chainFamily, network, persistToStorage]);

  // ------------------------------------------------------------------
  // Schedule next poll.  While engaged: every 400 ms.  While clear:
  // every 5 s (background keep-alive).
  // ------------------------------------------------------------------
  const schedulePoll = useCallback(() => {
    if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(async () => {
      await poll();
      schedulePoll();
    }, liveState.engaged ? ENGAGED_POLL_MS : 5_000);
  }, [poll, liveState.engaged]);

  // ------------------------------------------------------------------
  // Set up BroadcastChannel + localStorage fallback on mount.
  // ------------------------------------------------------------------
  useEffect(() => {
    // BroadcastChannel – preferred; falls back to null if unavailable.
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(KILL_SWITCH_CHANNEL);
      channel.addEventListener("message", (event: MessageEvent<KillSwitchState>) => {
        const payload = event.data;
        if (
          payload &&
          typeof payload.engaged === "boolean" &&
          // Only react to messages scoped to the same chain/network.
          (payload as KillSwitchState & { network?: string; chainFamily?: string }).network === network
        ) {
          applyState(payload, true);
        }
      });
      channelRef.current = channel;
    } catch {
      channelRef.current = null;
    }

    // localStorage fallback – catches tabs that opened before BroadcastChannel
    // support was available, or in environments where it's blocked.
    function onStorageChange(event: StorageEvent) {
      if (event.key !== KILL_SWITCH_LS_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue) as KillSwitchState & { network?: string };
        if (payload.network === network) applyState(payload, true);
      } catch {
        // malformed – ignore
      }
    }
    window.addEventListener("storage", onStorageChange);

    // Kick off initial poll + schedule.
    void poll();

    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorageChange);
      if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainFamily, network]);

  // Re-schedule whenever engaged state flips so the interval adjusts.
  useEffect(() => {
    schedulePoll();
    return () => {
      if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current);
    };
  }, [schedulePoll]);

  const engaged = liveState.engaged;

  return (
    <section aria-label="Auto Mode guardrails" className="rounded-xl border border-white/10 bg-black/30 p-3">
      {/* Cross-tab kill-switch alert banner */}
      {crossTabAlert && engaged ? (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-200"
        >
          <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
          <span>
            Kill-switch engaged in another tab.
            {liveState.actor ? ` Triggered by ${liveState.actor}.` : ""}
            {" "}All execution is halted across all open tabs.
          </span>
          <button
            type="button"
            aria-label="Dismiss alert"
            onClick={() => setCrossTabAlert(false)}
            className="ml-auto shrink-0 text-red-300/60 hover:text-red-200"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left text-xs font-medium text-white/80 transition hover:text-white"
      >
        <span className="flex items-center gap-2">
          {engaged ? (
            <ShieldAlert className="h-4 w-4 text-red-400" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          )}
          <span>{engaged ? "Auto Mode halted by guardrails" : "Non-custodial guardrails active"}</span>
        </span>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 text-white/50" aria-hidden="true" />
          : <ChevronDown className="h-3.5 w-3.5 text-white/50" aria-hidden="true" />}
      </button>

      {/* Expanded content */}
      {expanded ? (
        <div className="mt-3 space-y-4">
          {/* Kill-switch description */}
          <p className="text-xs leading-5 text-white/60">
            {engaged
              ? `${liveState.reason ?? "Emergency kill-switch engaged"}${liveState.actor ? ` by ${liveState.actor}` : ""}. Execution halted.`
              : "All actions require explicit wallet signature verification. Server cannot custody funds or sign transactions."}
          </p>

          {/* Budget meters – only shown when policy data is available */}
          {budget ? (
            <div
              className="space-y-3 rounded-lg border border-white/8 bg-white/3 p-3"
              aria-label="Live guardrail budget meters"
            >
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wide">Live guardrail meters</p>

              <MeterBar
                label="Daily spend"
                value={budget.dailySpentUsd}
                max={budget.maxDailyValueUsd}
                format={format.currency}
              />

              <MeterBar
                label="Max single-tx cap"
                value={budget.maxSingleTxUsd}
                max={budget.maxDailyValueUsd}
                format={format.currency}
              />

              <div className="space-y-1">
                <div className="flex justify-between text-xs text-white/60">
                  <span>Max slippage</span>
                  <span className="font-medium text-white/80">{formatBps(budget.maxSlippageBps)}</span>
                </div>
              </div>

              {budget.authorizationExpiresAt ? (
                <ExpiryCountdown expiresAt={budget.authorizationExpiresAt} />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default AutoModeGuardrailPanel;
