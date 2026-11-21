"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { UserRule } from "@/server/types";
import type { StrategyPreset } from "@/server/rules/presets";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: string }
  | { status: "error"; message: string; issues?: { field: string; message: string }[] };

type LimitField = {
  key: keyof UserRule;
  label: string;
  /** Rendered after the input so the unit is announced with the value. */
  unit: "%" | "USD" | "bps";
  max: number;
  step: number;
  hint: string;
};

/**
 * Every editable limit, in the order the form presents them.
 *
 * Sizing limits come first because they bound the blast radius of any single
 * mistake; portfolio-shape limits follow.
 */
const LIMIT_FIELDS: LimitField[] = [
  {
    key: "maxBuyRisk",
    label: "Max Buy Risk",
    unit: "%",
    max: 100,
    step: 1,
    hint: "Highest Buy Risk score you are willing to act on.",
  },
  {
    key: "maxTradePercent",
    label: "Max trade size",
    unit: "%",
    max: 100,
    step: 1,
    hint: "Largest share of portfolio value one trade may move.",
  },
  {
    key: "maxTradeValueUsd",
    label: "Max trade value",
    unit: "USD",
    max: 1_000_000_000,
    step: 50,
    hint: "Hard ceiling for a single trade, whatever the portfolio is worth.",
  },
  {
    key: "maxDailyValueUsd",
    label: "Max daily value",
    unit: "USD",
    max: 1_000_000_000,
    step: 100,
    hint: "Total value of trades prepared in a rolling 24 hours.",
  },
  {
    key: "minLiquidityUsd",
    label: "Min liquidity",
    unit: "USD",
    max: 1_000_000_000,
    step: 1_000,
    hint: "Pools below this liquidity are never eligible.",
  },
  {
    key: "maxSingleTokenExposurePercent",
    label: "Max single-token exposure",
    unit: "%",
    max: 100,
    step: 1,
    hint: "Largest share of portfolio value one token may represent.",
  },
  {
    key: "minStableReservePercent",
    label: "Min stable reserve",
    unit: "%",
    max: 100,
    step: 1,
    hint: "Share of portfolio value that must stay in stables.",
  },
  {
    key: "maxMemeExposurePercent",
    label: "Max meme exposure",
    unit: "%",
    max: 100,
    step: 1,
    hint: "Largest share of portfolio value allowed in meme assets.",
  },
  {
    key: "maxSlippageBps",
    label: "Max slippage",
    unit: "bps",
    max: 10_000,
    step: 10,
    hint: "Slippage ceiling applied when a quote is requested. 100 bps = 1%.",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  meme: "Meme",
  unaudited: "Unaudited",
  low_liquidity: "Low liquidity",
  new_launch: "New launch",
  high_concentration: "High holder concentration",
  rebasing: "Rebasing",
  algorithmic_stable: "Algorithmic stable",
  privacy: "Privacy",
};

export type RuleFormProps = {
  initialRules: UserRule;
  presets: StrategyPreset[];
  chains: { id: string; name: string; chainFamily: string }[];
  categories: string[];
  /** Wallet the profile belongs to; the form is read-only without one. */
  walletAddress?: string;
  /** Injectable for tests. Defaults to the real endpoint. */
  save?: (rule: UserRule) => Promise<Response>;
};

function defaultSave(rule: UserRule) {
  return fetch("/api/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
}

export function RuleForm({
  initialRules,
  presets,
  chains,
  categories,
  walletAddress,
  save = defaultSave,
}: RuleFormProps) {
  const [rules, setRules] = useState<UserRule>(initialRules);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [assetDraft, setAssetDraft] = useState("");
  const [assetError, setAssetError] = useState<string | null>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const { actionsDisabled } = useOnlineStatus();

  const isReadOnly = !walletAddress || actionsDisabled;
  const fieldIssues = useMemo(() => {
    if (saveState.status !== "error" || !saveState.issues) {
      return new Map<string, string>();
    }

    return new Map(saveState.issues.map((issue) => [issue.field.split(/[.[]/)[0], issue.message]));
  }, [saveState]);

  const update = useCallback(<K extends keyof UserRule>(key: K, value: UserRule[K]) => {
    // Any edit invalidates a previous "Saved" badge, so the badge can never
    // describe state the user has since changed.
    setSaveState((current) => (current.status === "saved" ? { status: "idle" } : current));
    setRules((current) => ({ ...current, [key]: value }));
  }, []);

  /**
   * Apply a preset.
   *
   * Only the limits the preset actually defines are overwritten. The user's
   * chains, blocked assets and blocked categories are explicit choices, so
   * picking a different preset never discards them.
   */
  function applyPreset(preset: StrategyPreset) {
    if (isReadOnly) return;
    setSaveState({ status: "idle" });
    setRules((current) => ({
      ...current,
      ...preset.limits,
      maxRiskScore: preset.limits.maxBuyRisk,
      profileId: preset.id,
    }));
  }

  function addBlockedAsset() {
    if (isReadOnly) return;
    const value = assetDraft.trim();

    if (!value) {
      setAssetError("Enter an asset key first.");
      assetInputRef.current?.focus();
      return;
    }

    if (rules.blockedAssets.includes(value)) {
      setAssetError("That asset is already blocked.");
      return;
    }

    setAssetError(null);
    setAssetDraft("");
    update("blockedAssets", [...rules.blockedAssets, value]);
    assetInputRef.current?.focus();
  }

  function removeBlockedAsset(key: string) {
    if (isReadOnly) return;
    update(
      "blockedAssets",
      rules.blockedAssets.filter((entry) => entry !== key),
    );
  }

  function toggleChain(id: string) {
    if (isReadOnly) return;
    update(
      "allowedChains",
      rules.allowedChains.includes(id)
        ? rules.allowedChains.filter((chain) => chain !== id)
        : [...rules.allowedChains, id],
    );
  }

  function toggleCategory(id: string) {
    if (isReadOnly) return;
    update(
      "blockedCategories",
      rules.blockedCategories.includes(id)
        ? rules.blockedCategories.filter((category) => category !== id)
        : [...rules.blockedCategories, id],
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isReadOnly) {
      return;
    }

    setSaveState({ status: "saving" });

    try {
      const response = await save({ ...rules, walletAddress });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        // A failed write is never reported as saved.
        setSaveState({
          status: "error",
          message: typeof payload.error === "string" ? payload.error : `Save failed (${response.status})`,
          issues: Array.isArray(payload.issues) ? payload.issues : undefined,
        });
        return;
      }

      if (payload.rule) {
        setRules(payload.rule as UserRule);
      }

      setSaveState({ status: "saved", at: new Date().toISOString() });
    } catch (error) {
      setSaveState({
        status: "error",
        message: error instanceof Error ? error.message : "Save failed. Your changes were not stored.",
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <fieldset disabled={isReadOnly} className="contents">
        <legend className="sr-only">Strategy profile</legend>

        <section aria-labelledby={`${formId}-preset-heading`} className="glass-panel rounded-lg p-5 sm:p-6">
          <h2 id={`${formId}-preset-heading`} className="text-xl font-semibold">
            Strategy
          </h2>
          <p className="mt-1 text-sm text-white/64">
            Presets set the limits below. Changing any limit switches the profile to Custom and keeps your value.
          </p>

          <div role="radiogroup" aria-labelledby={`${formId}-preset-heading`} className="mt-4 grid gap-3 sm:grid-cols-3">
            {presets.map((preset) => {
              const selected = rules.profileId === preset.id;
              const limits = preset.limits;

              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => applyPreset(preset)}
                  className={`min-h-11 rounded-xl border p-4 text-left transition ${
                    selected ? "border-[#d9a441] bg-[#d9a441]/10 ring-1 ring-[#d9a441]/40" : "border-white/10 bg-white/4 hover:border-white/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="block text-sm font-semibold text-white">{preset.label}</span>
                    {selected && <span className="rounded-full bg-[#d9a441]/20 px-2 py-0.5 text-[10px] font-bold text-[#f2c86d]">Active</span>}
                  </div>
                  <span className="mt-1 block text-xs text-white/60">{preset.summary}</span>
                  <div className="mt-3 border-t border-white/8 pt-2 text-[11px] text-white/50 space-y-0.5">
                    <div>• Buy Risk: &le; {limits.maxBuyRisk}/100</div>
                    <div>• Max trade: {limits.maxTradePercent}% (${limits.maxTradeValueUsd})</div>
                    <div>• Max slippage: {(limits.maxSlippageBps / 100).toFixed(2)}% ({limits.maxSlippageBps} bps)</div>
                    <div>• Stable reserve: &ge; {limits.minStableReservePercent}%</div>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-sm" aria-live="polite">
            Active profile: <strong>{rules.profileId === "custom" ? "Custom" : rules.profileId}</strong>
            <span className="text-white/46"> (preset version {rules.presetVersion})</span>
          </p>
        </section>

        <section aria-labelledby={`${formId}-limits-heading`} className="glass-panel rounded-lg p-5 sm:p-6">
          <h2 id={`${formId}-limits-heading`} className="text-xl font-semibold">
            Limits
          </h2>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {LIMIT_FIELDS.map((field) => {
              const inputId = `${formId}-${String(field.key)}`;
              const hintId = `${inputId}-hint`;
              const issue = fieldIssues.get(String(field.key));

              return (
                <div key={String(field.key)}>
                  <label htmlFor={inputId} className="block text-sm font-medium">
                    {field.label}
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      id={inputId}
                      name={String(field.key)}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={field.max}
                      step={field.step}
                      value={Number(rules[field.key] ?? 0)}
                      aria-describedby={issue ? `${hintId} ${inputId}-error` : hintId}
                      aria-invalid={issue ? true : undefined}
                      onChange={(event) =>
                        update(field.key, Number(event.target.value) as UserRule[typeof field.key])
                      }
                      className="h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-white outline-none focus:border-[#d9a441]"
                    />
                    <span aria-hidden className="w-16 text-right text-xs text-white/60">
                      {field.unit === "bps" ? `${Number(rules[field.key] ?? 0)} bps (${(Number(rules[field.key] ?? 0) / 100).toFixed(2)}%)` : field.unit}
                    </span>
                  </div>
                  <p id={hintId} className="mt-1 text-xs text-white/48">
                    {field.hint}
                  </p>
                  {field.key === "maxSlippageBps" && Number(rules[field.key] ?? 0) > 300 && (
                    <p className="mt-1 text-xs text-amber-300">
                      ⚠️ High slippage warning: &gt; 3.00% (300 bps) increases vulnerability to sandwich attacks.
                    </p>
                  )}
                  {field.key === "maxBuyRisk" && Number(rules[field.key] ?? 0) > 80 && (
                    <p className="mt-1 text-xs text-amber-300">
                      ⚠️ Elevated risk warning: scores &gt; 80 allow highly speculative or unverified contracts.
                    </p>
                  )}
                  {issue ? (
                    <p id={`${inputId}-error`} className="mt-1 text-xs text-red-300">
                      {issue}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section aria-label="Plain-English Strategy Summary" className="rounded-2xl border border-[#d9a441]/30 bg-[#d9a441]/8 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#f2c86d]">
            <span>Plain-English Rule Summary</span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-white/80 leading-relaxed">
            <p>
              • <strong>Buy Risk Ceiling:</strong> Only tokens with Buy Risk score &le; <strong>{rules.maxBuyRisk}/100</strong> are eligible for recommendation.
            </p>
            <p>
              • <strong>Trade Sizing:</strong> Single trades capped at <strong>{rules.maxTradePercent}%</strong> of portfolio value (max <strong>${rules.maxTradeValueUsd?.toLocaleString()}</strong>), with a 24h rolling limit of <strong>${rules.maxDailyValueUsd?.toLocaleString()}</strong>.
            </p>
            <p>
              • <strong>Execution &amp; Slippage:</strong> Slippage tolerance is set to <strong>{((rules.maxSlippageBps ?? 100) / 100).toFixed(2)}%</strong> ({rules.maxSlippageBps} bps) across <strong>{rules.allowedChains.length}</strong> permitted chain{rules.allowedChains.length === 1 ? "" : "s"}.
            </p>
            <p>
              • <strong>Portfolio Safeguards:</strong> At least <strong>{rules.minStableReservePercent}%</strong> must remain in stablecoins; meme asset exposure cannot exceed <strong>{rules.maxMemeExposurePercent}%</strong>.
            </p>
            <p>
              • <strong>Liquidity Minimum:</strong> Pools must hold at least <strong>${rules.minLiquidityUsd?.toLocaleString()}</strong> in verified pool liquidity.
            </p>
            <p className="text-[11px] text-[#f2c86d]/80 pt-1 border-t border-white/8">
              • <strong>Non-Custodial Invariant:</strong> Every transaction proposal requires explicit wallet approval; server-side signing is disabled.
            </p>
          </div>
        </section>

        <section aria-labelledby={`${formId}-chains-heading`} className="glass-panel rounded-lg p-5 sm:p-6">
          <h2 id={`${formId}-chains-heading`} className="text-xl font-semibold">
            Allowed chains
          </h2>
          <p className="mt-1 text-sm text-white/64">
            A chain that is not selected is never eligible for a prepared trade.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {chains.map((chain) => {
              const inputId = `${formId}-chain-${chain.id}`;

              return (
                <div key={chain.id} className="flex min-h-11 items-center gap-2">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={rules.allowedChains.includes(chain.id)}
                    onChange={() => toggleChain(chain.id)}
                    className="h-5 w-5 accent-[#d9a441]"
                  />
                  <label htmlFor={inputId} className="text-sm">
                    {chain.name}
                    <span className="ml-1 text-xs text-white/40">({chain.chainFamily})</span>
                  </label>
                </div>
              );
            })}
          </div>
          {fieldIssues.get("allowedChains") ? (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {fieldIssues.get("allowedChains")}
            </p>
          ) : null}
        </section>

        <section aria-labelledby={`${formId}-assets-heading`} className="glass-panel rounded-lg p-5 sm:p-6">
          <h2 id={`${formId}-assets-heading`} className="text-xl font-semibold">
            Blocked assets
          </h2>
          <p className="mt-1 text-sm text-white/64">
            Use <code>evm:base:0x…</code>, <code>classic:USDC:GA…</code>, <code>contract:C…</code> or{" "}
            <code>native</code>. A bare EVM address is rejected because it is ambiguous across chains.
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              ref={assetInputRef}
              id={`${formId}-asset-input`}
              type="text"
              value={assetDraft}
              placeholder="evm:base:0x…"
              aria-label="Asset key to block"
              aria-describedby={assetError ? `${formId}-asset-error` : undefined}
              aria-invalid={assetError ? true : undefined}
              onChange={(event) => {
                setAssetDraft(event.target.value);
                setAssetError(null);
              }}
              onKeyDown={(event) => {
                // Enter adds the row instead of submitting the whole form.
                if (event.key === "Enter") {
                  event.preventDefault();
                  addBlockedAsset();
                }
              }}
              className="h-11 flex-1 rounded-md border border-white/15 bg-black/30 px-3 text-sm"
            />
            <button
              type="button"
              onClick={addBlockedAsset}
              className="h-11 rounded-md border border-white/20 px-4 text-sm font-medium hover:border-white/40"
            >
              Add
            </button>
          </div>
          {assetError ? (
            <p id={`${formId}-asset-error`} role="alert" className="mt-2 text-sm text-red-300">
              {assetError}
            </p>
          ) : null}
          {fieldIssues.get("blockedAssets") ? (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {fieldIssues.get("blockedAssets")}
            </p>
          ) : null}

          <ul className="mt-4 space-y-2">
            {rules.blockedAssets.length === 0 ? (
              <li className="text-sm text-white/46">No blocked assets.</li>
            ) : (
              rules.blockedAssets.map((key) => (
                <li
                  key={key}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-white/10 px-3"
                >
                  <code className="truncate text-xs">{key}</code>
                  <button
                    type="button"
                    onClick={() => removeBlockedAsset(key)}
                    aria-label={`Remove ${key} from blocked assets`}
                    className="h-9 shrink-0 rounded-md px-3 text-sm text-white/64 hover:text-white"
                  >
                    Remove
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        <section aria-labelledby={`${formId}-categories-heading`} className="glass-panel rounded-lg p-5 sm:p-6">
          <h2 id={`${formId}-categories-heading`} className="text-xl font-semibold">
            Blocked categories
          </h2>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {categories.map((category) => {
              const inputId = `${formId}-category-${category}`;

              return (
                <div key={category} className="flex min-h-11 items-center gap-2">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={rules.blockedCategories.includes(category)}
                    onChange={() => toggleCategory(category)}
                    className="h-5 w-5 accent-[#d9a441]"
                  />
                  <label htmlFor={inputId} className="text-sm">
                    {CATEGORY_LABELS[category] ?? category}
                  </label>
                </div>
              );
            })}
          </div>
        </section>

        <section className="glass-panel rounded-lg p-5 sm:p-6">
          <h2 className="text-xl font-semibold">Execution</h2>
          <div className="mt-3 flex min-h-11 items-center gap-2">
            <input
              id={`${formId}-auto-execute`}
              type="checkbox"
              checked={false}
              disabled
              readOnly
              aria-describedby={`${formId}-auto-execute-note`}
              className="h-5 w-5"
            />
            <label htmlFor={`${formId}-auto-execute`} className="text-sm text-white/64">
              Automatic execution
            </label>
          </div>
          <p id={`${formId}-auto-execute-note`} className="mt-2 text-sm text-[#d9a441]">
            Automatic execution is disabled. Every transaction requires wallet approval.
          </p>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={isReadOnly || saveState.status === "saving"}
            className="h-11 rounded-full bg-[#d9a441] px-6 text-sm font-semibold text-black transition hover:bg-[#f2c86d] disabled:opacity-50"
          >
            {saveState.status === "saving" ? "Saving…" : "Save strategy"}
          </button>

          {/* Success is announced politely; a failure is assertive. */}
          <p aria-live="polite" className="text-sm text-emerald-300">
            {saveState.status === "saved" ? "Saved" : null}
          </p>
          {saveState.status === "error" ? (
            <p role="alert" className="text-sm text-red-300">
              {saveState.message}
            </p>
          ) : null}
        </div>

        {isReadOnly ? (
          <p className="text-sm text-white/56">
            {actionsDisabled ? "Strategy changes are disabled until connectivity returns and the page is refreshed." : "Connect a wallet to load and save a strategy profile."}
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
