"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useWalletSession } from "@/hooks/useWalletSession";
import AutoModeGuardrailPanel from "@/components/AutoModeGuardrailPanel";

type AutoModePolicy = {
  schemaVersion: 1;
  policyVersion: number;
  walletAddress: string;
  maxDailyValueUsd: number;
  maxRiskScore: number;
  maxTradePercent: number;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  allowedChains: string[];
  allowedAssets: string[];
  minStableReservePercent: number;
  stopConditions: {
    stopLossPercent: number;
    takeProfitPercent: number;
    pauseOnCriticalRisk: boolean;
    pauseOnSourceCoverageLoss: boolean;
  };
};

type AutoModeSnapshot = {
  walletAddress: string;
  policy?: AutoModePolicy;
  requestedEnabled: boolean;
  effectiveEnabled: boolean;
  explanationAcceptedAt?: string;
  authorizationStatus: "pending" | "authorized" | "cancelled" | "rejected" | "expired";
  authorization?: {
    status: string;
    allowanceUsd: number;
    expiresAt: string;
  };
  policyHash?: string;
  contractVerification: {
    status: "unverified" | "verified" | "failed";
    expectedAddress: string;
    observedAddress?: string;
    expectedNetwork: string;
    observedNetwork?: string;
    expectedVersion: string;
    observedVersion?: string;
    failureReason?: string;
  };
  blockers: string[];
  missingLimits: string[];
  activationPrerequisites: {
    ready: boolean;
    blockers: string[];
  };
  suggestedPolicy: AutoModePolicy;
};

type ExpansionConflict = {
  detail: string;
  reasons: string[];
};

const immutableBuyBlockers = [
  "Unknown or unresolved asset identity",
  "Critical contract risk",
  "Cannot-sell or honeypot signal",
  "Phishing signal or official identity conflict",
  "No connected source coverage",
];

const numberFields = [
  { key: "maxDailyValueUsd", label: "Maximum daily value (USD)", min: 0.01, max: undefined, step: 0.01 },
  { key: "maxRiskScore", label: "Maximum buy risk (0–100)", min: 0, max: 100, step: 1 },
  { key: "maxTradePercent", label: "Maximum trade (%)", min: 0.01, max: 100, step: 0.01 },
  { key: "maxSlippageBps", label: "Maximum slippage (bps)", min: 0, max: 10_000, step: 1 },
  { key: "maxPriceImpactBps", label: "Maximum price impact (bps)", min: 0, max: 10_000, step: 1 },
  { key: "minStableReservePercent", label: "Minimum stable reserve (%)", min: 0, max: 100, step: 0.01 },
] as const;

function splitRoster(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function toLocalDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultExpiry() {
  return toLocalDateTime(new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString());
}

function blockerLabel(blocker: string) {
  return blocker
    .replace(/^missing_limit:/, "Missing required limit: ")
    .replace(/^immutable_buy_blocker:/, "Immutable buy blocker: ")
    .replaceAll("_", " ");
}

async function responseBody(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function StatusPill({ good, children }: { good: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
        good
          ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
          : "border-amber-300/30 bg-amber-300/10 text-amber-100"
      }`}
    >
      {good ? (
        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {children}
    </span>
  );
}

export function AutoModeOnboarding() {
  const { address, isConnected, isConnecting } = useWalletSession();
  const [snapshot, setSnapshot] = useState<AutoModeSnapshot | null>(null);
  const [draft, setDraft] = useState<AutoModePolicy | null>(null);
  const [allowedChainsText, setAllowedChainsText] = useState("");
  const [allowedAssetsText, setAllowedAssetsText] = useState("");
  const [explanationAccepted, setExplanationAccepted] = useState(false);
  const [allowanceUsd, setAllowanceUsd] = useState(0);
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [expansion, setExpansion] = useState<ExpansionConflict | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applySnapshot = useCallback((next: AutoModeSnapshot) => {
    setSnapshot(next);
    const policy = next.policy ?? next.suggestedPolicy;
    setDraft(policy);
    setAllowedChainsText(policy.allowedChains.join(", "));
    setAllowedAssetsText(policy.allowedAssets.join(", "));
    setExplanationAccepted(Boolean(next.explanationAcceptedAt));
    setAllowanceUsd(next.authorization?.allowanceUsd ?? policy.maxDailyValueUsd);
    setExpiresAt(next.authorization?.expiresAt ? toLocalDateTime(next.authorization.expiresAt) : defaultExpiry());
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!address) {
      setSnapshot(null);
      setDraft(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/auto-mode?walletAddress=${encodeURIComponent(address)}`, {
        credentials: "include",
        cache: "no-store",
        signal,
      });
      const body = await responseBody(response);
      if (!response.ok) {
        throw new Error(typeof body.detail === "string" ? body.detail : typeof body.error === "string" ? body.error : "Could not load auto mode.");
      }
      applySnapshot(body as AutoModeSnapshot);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Could not load auto mode.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [address, applySnapshot]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  async function savePolicy(confirmExpansion = false, requestedEnabled = true) {
    if (!address || !draft) return;
    setWorking("save");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/auto-mode", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          policy: {
            ...draft,
            walletAddress: address,
            allowedChains: splitRoster(allowedChainsText),
            allowedAssets: splitRoster(allowedAssetsText),
          },
          requestedEnabled,
          explanationAccepted,
          confirmExpansion,
        }),
      });
      const body = await responseBody(response);

      if (response.status === 409) {
        setExpansion({
          detail: typeof body.detail === "string" ? body.detail : "This change expands auto-mode authority.",
          reasons: Array.isArray(body.expansionReasons)
            ? body.expansionReasons.filter((item): item is string => typeof item === "string")
            : [],
        });
        return;
      }
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Could not save policy.");
      }

      applySnapshot(body as AutoModeSnapshot);
      setExpansion(null);
      setNotice(requestedEnabled
        ? "Policy saved. Auto mode remains off until wallet and contract authorization pass."
        : "Policy saved and auto mode turned off.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save policy.");
    } finally {
      setWorking(null);
    }
  }

  async function updateAuthorization(action: "authorize" | "cancel" | "reject") {
    if (!address) return;
    setWorking(action);
    setError(null);
    setNotice(null);

    try {
      const isoExpiry = new Date(expiresAt).toISOString();
      const response = await fetch("/api/auto-mode/authorization", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          action,
          ...(action === "authorize"
            ? { confirmationPhrase, allowanceUsd, expiresAt: isoExpiry }
            : {}),
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) {
        throw new Error(typeof body.detail === "string" ? body.detail : typeof body.error === "string" ? body.error : "Authorization failed.");
      }

      applySnapshot(body as AutoModeSnapshot);
      setConfirmationPhrase("");
      setNotice(action === "authorize"
        ? "The exact policy authorization was verified."
        : action === "cancel"
          ? "Authorization cancelled. Auto mode is off."
          : "Authorization rejected. Auto mode is off.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authorization failed.");
    } finally {
      setWorking(null);
    }
  }

  const policyComplete = Boolean(snapshot && snapshot.missingLimits.length === 0);
  const contractVerified = snapshot?.contractVerification.status === "verified";
  const activationReady = snapshot?.activationPrerequisites.ready === true;
  const canAuthorize = Boolean(
    isConnected &&
      snapshot?.requestedEnabled &&
      policyComplete &&
      contractVerified &&
      activationReady &&
      explanationAccepted &&
      confirmationPhrase === "AUTHORIZE AUTO MODE" &&
      allowanceUsd > 0 &&
      expiresAt &&
      !working,
  );
  return (
    <section aria-labelledby="auto-mode-heading" className="glass-panel rounded-lg border border-white/10 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#d9a441]">
            <LockKeyhole aria-hidden="true" className="h-4 w-4" />
            Explicit, limited authorization
          </div>
          <h2 id="auto-mode-heading" className="mt-2 text-2xl font-semibold">Auto mode onboarding</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
            Risk controls reduce exposure to known hazards, but they do not guarantee safety, returns, execution, or recovery of funds. Auto mode stays off unless every prerequisite below is verified.
          </p>
        </div>
        <StatusPill good={snapshot?.effectiveEnabled === true}>
          {snapshot?.effectiveEnabled ? "Auto mode on" : "Auto mode off"}
        </StatusPill>
      </div>

      {/* 3-Step Non-Custodial Safety Walkthrough */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#f2c86d]">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#d9a441]/20 text-xs font-bold text-[#f2c86d]">1</span>
            Set Hard Caps
          </div>
          <p className="mt-2 text-xs leading-5 text-white/60">
            Bound daily USD spend, maximum trade % and slippage limit to your onchain policy hash.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#f2c86d]">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#d9a441]/20 text-xs font-bold text-[#f2c86d]">2</span>
            Verify in Sandbox
          </div>
          <p className="mt-2 text-xs leading-5 text-white/60">
            Multi-agent pipeline simulates every trade first. Missing or stale signals halt automatically.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#f2c86d]">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#d9a441]/20 text-xs font-bold text-[#f2c86d]">3</span>
            Instant Kill-Switch
          </div>
          <p className="mt-2 text-xs leading-5 text-white/60">
            Server cannot custody private keys. Revoke or cancel authorization with 1 click anytime.
          </p>
        </div>
      </div>

      {snapshot ? (
        <div className="mt-4">
          <AutoModeGuardrailPanel
            state={{
              engaged: snapshot.requestedEnabled && !snapshot.effectiveEnabled,
              reason: snapshot.blockers[0],
            }}
          />
        </div>
      ) : null}

      {!isConnected ? (
        <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/8 p-4 text-sm text-amber-100">
          {isConnecting ? "Connecting wallet…" : "Connect and sign the wallet challenge to load a wallet-scoped policy."}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard label="Active policy version" value={snapshot?.policy ? `v${snapshot.policy.policyVersion}` : "Not authorized"} />
        <StatusCard
          label="Contract / network"
          value={snapshot?.contractVerification.observedAddress ?? snapshot?.contractVerification.expectedAddress ?? "Not configured"}
          detail={`${snapshot?.contractVerification.observedNetwork ?? snapshot?.contractVerification.expectedNetwork ?? "Network unavailable"} · ${snapshot?.contractVerification.observedVersion ?? snapshot?.contractVerification.expectedVersion ?? "version unknown"}`}
          good={contractVerified}
        />
        <StatusCard
          label="Allowance"
          value={snapshot?.authorization ? `$${snapshot.authorization.allowanceUsd.toLocaleString("en-US")}` : "None"}
          detail={`Authorization: ${snapshot?.authorizationStatus ?? "pending"}`}
        />
        <StatusCard
          label="Authorization expiration"
          value={snapshot?.authorization?.expiresAt ? new Date(snapshot.authorization.expiresAt).toLocaleString() : "Not authorized"}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void savePolicy(false, true);
          }}
          className="rounded-2xl border border-white/10 bg-white/4 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Required policy limits</h3>
              <p className="mt-1 text-xs leading-5 text-white/48">All values are explicit and bound to the next policy hash.</p>
            </div>
            <StatusPill good={policyComplete}>{policyComplete ? "Complete" : "Incomplete"}</StatusPill>
          </div>

          {draft ? (
            <>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {numberFields.map((field) => (
                  <label key={field.key} className="text-sm text-white/68">
                    <span>{field.label}</span>
                    <input
                      type="number"
                      required
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={draft[field.key]}
                      onChange={(event) => setDraft((current) => current
                        ? { ...current, [field.key]: Number(event.target.value) }
                        : current)}
                      className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none focus-visible:border-[#d9a441]/70 focus-visible:ring-2 focus-visible:ring-[#d9a441]/25"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-white/68">
                  <span>Allowed chains (comma separated)</span>
                  <input
                    required
                    value={allowedChainsText}
                    onChange={(event) => setAllowedChainsText(event.target.value)}
                    className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none focus-visible:border-[#d9a441]/70 focus-visible:ring-2 focus-visible:ring-[#d9a441]/25"
                  />
                </label>
                <label className="text-sm text-white/68">
                  <span>Allowed assets (comma separated)</span>
                  <input
                    required
                    value={allowedAssetsText}
                    onChange={(event) => setAllowedAssetsText(event.target.value)}
                    className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none focus-visible:border-[#d9a441]/70 focus-visible:ring-2 focus-visible:ring-[#d9a441]/25"
                  />
                </label>
              </div>

              <fieldset className="mt-5 border-t border-white/10 pt-4">
                <legend className="text-sm font-semibold">Mandatory stop conditions</legend>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm text-white/68">
                    <span>Stop loss (%)</span>
                    <input
                      type="number"
                      required
                      min={0.01}
                      max={100}
                      step={0.01}
                      value={draft.stopConditions.stopLossPercent}
                      onChange={(event) => setDraft((current) => current ? {
                        ...current,
                        stopConditions: { ...current.stopConditions, stopLossPercent: Number(event.target.value) },
                      } : current)}
                      className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none focus-visible:border-[#d9a441]/70 focus-visible:ring-2 focus-visible:ring-[#d9a441]/25"
                    />
                  </label>
                  <label className="text-sm text-white/68">
                    <span>Take profit (%)</span>
                    <input
                      type="number"
                      required
                      min={0.01}
                      step={0.01}
                      value={draft.stopConditions.takeProfitPercent}
                      onChange={(event) => setDraft((current) => current ? {
                        ...current,
                        stopConditions: { ...current.stopConditions, takeProfitPercent: Number(event.target.value) },
                      } : current)}
                      className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none focus-visible:border-[#d9a441]/70 focus-visible:ring-2 focus-visible:ring-[#d9a441]/25"
                    />
                  </label>
                </div>
                <div className="mt-4 space-y-3">
                  <RequiredCheckbox
                    label="Pause automatically when critical risk is detected"
                    checked={draft.stopConditions.pauseOnCriticalRisk}
                    onChange={(checked) => setDraft((current) => current ? {
                      ...current,
                      stopConditions: { ...current.stopConditions, pauseOnCriticalRisk: checked },
                    } : current)}
                  />
                  <RequiredCheckbox
                    label="Pause automatically when source coverage is lost"
                    checked={draft.stopConditions.pauseOnSourceCoverageLoss}
                    onChange={(checked) => setDraft((current) => current ? {
                      ...current,
                      stopConditions: { ...current.stopConditions, pauseOnSourceCoverageLoss: checked },
                    } : current)}
                  />
                </div>
              </fieldset>

              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-[#d9a441]/25 bg-[#d9a441]/7 p-4 text-sm leading-6 text-white/74">
                <input
                  type="checkbox"
                  required
                  checked={explanationAccepted}
                  onChange={(event) => setExplanationAccepted(event.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[#d9a441]"
                />
                <span>
                  I understand the limits, immutable blockers, expiration and cancellation behavior, and that this policy does not guarantee safety or financial outcomes.
                </span>
              </label>

              <button
                type="submit"
                disabled={!isConnected || working !== null}
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#d9a441]/40 bg-[#d9a441]/12 px-6 text-sm font-semibold text-[#f2c86d] transition hover:bg-[#d9a441]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {working === "save" ? "Saving policy…" : "Save policy and request auto mode"}
              </button>
            </>
          ) : (
            <p className="mt-4 text-sm text-white/52">Connect and verify a wallet to edit its policy.</p>
          )}
        </form>

        <div className="space-y-5">
          <article className="rounded-2xl border border-red-300/20 bg-red-400/6 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <ShieldAlert aria-hidden="true" className="h-5 w-5 text-red-200" />
              <h3 className="font-semibold text-red-100">Permanent buy blockers</h3>
            </div>
            <p className="mt-2 text-sm leading-6 text-red-100/70">No permissive custom profile can override these system checks.</p>
            <ul className="mt-4 space-y-2 text-sm text-red-50/85">
              {immutableBuyBlockers.map((blocker) => (
                <li key={blocker} className="flex gap-2"><span aria-hidden="true" className="text-red-300">●</span>{blocker}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
            <h3 className="font-semibold">Why auto mode is off</h3>
            {snapshot?.blockers.length ? (
              <ul className="mt-3 space-y-2 text-sm text-white/68">
                {snapshot.blockers.map((blocker) => (
                  <li key={blocker} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">{blockerLabel(blocker)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-white/52">No prerequisite failures reported.</p>
            )}
            {snapshot?.contractVerification.failureReason ? (
              <p className="mt-3 text-xs leading-5 text-amber-100/75">{snapshot.contractVerification.failureReason}</p>
            ) : null}
          </article>
        </div>
      </div>

      {expansion ? (
        <section aria-labelledby="expansion-heading" className="mt-5 rounded-2xl border-2 border-amber-300/45 bg-amber-300/10 p-4 sm:p-5">
          <h3 id="expansion-heading" className="font-semibold text-amber-100">Policy expansion requires explicit confirmation</h3>
          <p className="mt-2 text-sm leading-6 text-amber-50/80">{expansion.detail}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-50/80">
            {expansion.reasons.map((reason) => <li key={reason}>{blockerLabel(reason)}</li>)}
          </ul>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={working !== null}
              onClick={() => void savePolicy(true, true)}
              className="min-h-11 rounded-full bg-amber-200 px-5 text-sm font-semibold text-black disabled:opacity-50"
            >
              Confirm expansion and require new authorization
            </button>
            <button type="button" onClick={() => setExpansion(null)} className="min-h-11 rounded-full border border-white/15 px-5 text-sm font-semibold">
              Keep current policy
            </button>
          </div>
        </section>
      ) : null}

      <fieldset className="mt-5 rounded-2xl border border-white/10 bg-white/4 p-4 sm:p-5">
        <legend className="px-2 text-sm font-semibold">Wallet authorization for this exact policy</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm text-white/68">
            <span>Allowance (USD)</span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={allowanceUsd}
              onChange={(event) => setAllowanceUsd(Number(event.target.value))}
              className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none focus-visible:ring-2 focus-visible:ring-[#d9a441]/25"
            />
          </label>
          <label className="text-sm text-white/68">
            <span>Authorization expiration</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none focus-visible:ring-2 focus-visible:ring-[#d9a441]/25"
            />
          </label>
          <label className="text-sm text-white/68 sm:col-span-2 lg:col-span-1">
            <span>Type AUTHORIZE AUTO MODE</span>
            <input
              value={confirmationPhrase}
              onChange={(event) => setConfirmationPhrase(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="AUTHORIZE AUTO MODE"
              className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none focus-visible:ring-2 focus-visible:ring-[#d9a441]/25"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={!canAuthorize}
            onClick={() => void updateAuthorization("authorize")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-6 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            {working === "authorize" ? "Authorizing…" : "Authorize exact policy"}
          </button>
          <button
            type="button"
            disabled={!isConnected || working !== null}
            onClick={() => void updateAuthorization("cancel")}
            className="min-h-11 rounded-full border border-white/15 px-5 text-sm font-semibold disabled:opacity-50"
          >
            {working === "cancel" ? "Cancelling…" : "Cancel authorization"}
          </button>
          <button
            type="button"
            disabled={!isConnected || working !== null}
            onClick={() => void updateAuthorization("reject")}
            className="min-h-11 rounded-full border border-white/15 px-5 text-sm font-semibold text-white/70 disabled:opacity-50"
          >
            {working === "reject" ? "Rejecting…" : "Reject policy"}
          </button>
        </div>
        {!activationReady ? (
          <p className="mt-3 text-xs leading-5 text-amber-100/75">
            Authorization is intentionally unavailable until durable storage, shared execution enforcement, independent V3 contract verification, and an exact policy-bound wallet signature are integrated.
          </p>
        ) : !contractVerified ? (
          <p className="mt-3 text-xs leading-5 text-amber-100/75">Authorization is intentionally unavailable until the V3 contract, network and policy version are independently verified.</p>
        ) : null}
      </fieldset>

      <div aria-live="polite" aria-atomic="true" className="mt-4 min-h-6 text-sm">
        {error ? <p role="alert" className="text-red-200">{error}</p> : null}
        {!error && notice ? <p className="text-emerald-200">{notice}</p> : null}
        {!error && !notice && loading ? <p className="text-white/52">Refreshing wallet policy…</p> : null}
      </div>
    </section>
  );
}

function StatusCard({ label, value, detail, good }: { label: string; value: string; detail?: string; good?: boolean }) {
  return (
    <article className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-white/44">{label}</div>
      <div className="mt-1 break-all text-sm font-semibold">{value}</div>
      {detail ? <div className="mt-1 break-words text-xs text-white/48">{detail}</div> : null}
      {good !== undefined ? <div className="mt-2"><StatusPill good={good}>{good ? "Verified" : "Unverified"}</StatusPill></div> : null}
    </article>
  );
}

function RequiredCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-white/72">
      <input
        type="checkbox"
        required
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[#d9a441]"
      />
      <span>{label}</span>
    </label>
  );
}
