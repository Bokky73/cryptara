"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Download, Save, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import type { PortfolioSnapshot, StressAssetImpact, UserRule } from "@/server/types";
import { applyStressScenario, evaluateStressThresholds } from "@/server/portfolio/stress";
import {
  buildCustomStressScenario,
  DEFAULT_CUSTOM_STRESS,
  DEPEG_ALL_STABLECOINS,
  holdingTarget,
  normalizeCustomStress,
  STRESS_LIMITS,
  STRESS_SCENARIOS,
  type CustomStressParams,
} from "@/server/portfolio/scenarios";
import { formatUsd } from "@/lib/format";
import { buildStressReport } from "@/lib/stressReport";
import { MAX_PRESET_NAME_LENGTH, MAX_STRESS_PRESETS, readStressPresets, writeStressPresets, type StressPreset } from "@/lib/stressPresets";

const CUSTOM_ID = "custom";
const BEFORE_COLOR = "#3987e5";
const AFTER_COLOR = "#d95926";
const MAX_CHART_ASSETS = 8;
const fieldClass = "h-11 rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus-visible:border-[#d9a441]/60 focus-visible:ring-2 focus-visible:ring-[#d9a441]/60";
const buttonClass = "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50";

const usd = (value: number | null) =>
  value === null ? "Unknown" : formatUsd(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number | null) => (value === null ? "Unknown" : `${value.toFixed(1)}%`);

type RulesState = { wallet: string; rules: UserRule | null };

function Slider({ label, value, limits, disabled, onChange }: {
  label: string;
  value: number;
  limits: { min: number; max: number; step: number };
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className={disabled ? "opacity-50" : undefined}>
      <div className="flex justify-between gap-3 text-sm">
        <label htmlFor={id} className="text-white/70">{label}</label>
        <output htmlFor={id} className="font-semibold tabular-nums text-white">{value}%</output>
      </div>
      <input
        id={id}
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        disabled={disabled}
        aria-valuetext={`${value}%`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 h-11 w-full accent-[#d9a441]"
      />
    </div>
  );
}

function ImpactChart({ impacts }: { impacts: StressAssetImpact[] }) {
  const priced = impacts
    .filter((asset) => asset.baseValueUsd !== null)
    .sort((a, b) => (b.baseValueUsd ?? 0) - (a.baseValueUsd ?? 0));
  const shown = priced.slice(0, MAX_CHART_ASSETS);
  const max = Math.max(0, ...shown.flatMap((asset) => [asset.baseValueUsd ?? 0, asset.stressedValueUsd ?? 0]));
  if (shown.length === 0 || max === 0) {
    return <p className="text-sm text-white/50">No priced holdings to chart.</p>;
  }
  return (
    <figure>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/70">
        <span className="font-semibold">Value before and after</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: BEFORE_COLOR }} />Before</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: AFTER_COLOR }} />After</span>
      </figcaption>
      <ul className="mt-3 space-y-3">
        {shown.map((asset, index) => (
          <li
            key={`${asset.key}:${index}`}
            title={`${asset.symbol}: ${usd(asset.baseValueUsd)} before, ${usd(asset.stressedValueUsd)} after`}
            className="grid gap-x-3 gap-y-1 sm:grid-cols-[6rem_minmax(0,1fr)_12rem] sm:items-center"
          >
            <span className="truncate text-sm text-white">{asset.symbol}</span>
            <span aria-hidden="true" className="grid gap-0.5">
              <span className="h-2.5 rounded-r" style={{ width: `${(asset.baseValueUsd ?? 0) / max * 100}%`, background: BEFORE_COLOR }} />
              <span className="h-2.5 rounded-r" style={{ width: `${(asset.stressedValueUsd ?? 0) / max * 100}%`, background: AFTER_COLOR }} />
            </span>
            <span className="text-xs tabular-nums text-white/70 sm:text-right">
              {usd(asset.baseValueUsd)} → {usd(asset.stressedValueUsd)}
            </span>
          </li>
        ))}
      </ul>
      {priced.length > shown.length && (
        <p className="mt-2 text-xs text-white/50">Largest {shown.length} of {priced.length} priced holdings. The table lists all of them.</p>
      )}
    </figure>
  );
}

export function PortfolioStressPanel({ portfolio }: { portfolio: PortfolioSnapshot }) {
  const [scenarioId, setScenarioId] = useState(CUSTOM_ID);
  const [params, setParams] = useState<CustomStressParams>(DEFAULT_CUSTOM_STRESS);
  // Rendered only after a wallet loads on the client, so reading storage here cannot mismatch SSR output.
  const [presets, setPresets] = useState<StressPreset[]>(readStressPresets);
  const [presetName, setPresetName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [rulesState, setRulesState] = useState<RulesState | null>(null);
  const fieldId = useId();
  const wallet = portfolio.walletAddress;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ walletAddress: wallet });
    if (/^G[A-Z2-7]{55}$/.test(wallet)) query.set("chainFamily", "stellar");
    fetch(`/api/rules?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Rules unavailable");
        return response.json() as Promise<UserRule | null>;
      })
      .then((rules) => {
        const valid = rules && Number.isFinite(rules.maxRiskScore) && Number.isFinite(rules.maxMemeExposurePercent);
        setRulesState({ wallet, rules: valid ? rules : null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setRulesState({ wallet, rules: null });
      });
    return () => controller.abort();
  }, [wallet]);

  const rulesLoaded = rulesState?.wallet === wallet;
  const rules = rulesLoaded ? rulesState.rules : null;
  const isCustom = scenarioId === CUSTOM_ID;
  // A preset may name a holding this wallet does not own.
  const depegMissing = params.depegTarget !== null
    && params.depegTarget !== DEPEG_ALL_STABLECOINS
    && !portfolio.holdings.some((holding) => holdingTarget(holding) === params.depegTarget);

  const scenario = useMemo(
    () => STRESS_SCENARIOS.find((item) => item.id === scenarioId) ?? buildCustomStressScenario(params),
    [scenarioId, params],
  );
  const result = useMemo(() => applyStressScenario(portfolio, scenario), [portfolio, scenario]);
  const breaches = useMemo(() => (rules ? evaluateStressThresholds(result, rules) : null), [result, rules]);
  const { delta } = result;
  const hasPriced = delta.originalValueUsd > 0;

  function update(patch: Partial<CustomStressParams>) {
    setParams((current) => normalizeCustomStress({ ...current, ...patch }));
  }

  function persist(next: StressPreset[], message: string) {
    if (!writeStressPresets(next)) {
      setNotice("This browser blocked local storage, so nothing was saved.");
      return false;
    }
    setPresets(next);
    setNotice(message);
    return true;
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const others = presets.filter((preset) => preset.name !== name);
    if (others.length >= MAX_STRESS_PRESETS) {
      setNotice(`Up to ${MAX_STRESS_PRESETS} presets can be saved. Delete one first.`);
      return;
    }
    if (persist([...others, { name, params }], `Saved preset “${name}” on this device.`)) setPresetName("");
  }

  function exportReport() {
    const blob = new Blob([buildStressReport(result, scenario.name, breaches)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cryptara-stress-${scenario.id}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const deltaColor = delta.valueDeltaUsd < 0 ? "text-red-400" : delta.valueDeltaUsd > 0 ? "text-emerald-400" : "text-white/70";
  const DeltaIcon = delta.valueDeltaUsd < 0 ? TrendingDown : TrendingUp;

  return (
    <section className="glass-panel mt-5 rounded-[28px] p-5" aria-label="Portfolio Stress Testing">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Stress Testing</h2>
          <p className="mt-1 text-sm text-white/50">Simulate market conditions on your portfolio.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)} className={fieldClass} aria-label="Stress test scenario">
            <option value={CUSTOM_ID} className="bg-[#101012]">Custom scenario</option>
            {STRESS_SCENARIOS.map((item) => (
              <option key={item.id} value={item.id} className="bg-[#101012]">{item.name}</option>
            ))}
          </select>
          <button type="button" onClick={exportReport} className={buttonClass}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export report
          </button>
        </div>
      </div>

      {isCustom && (
        <div className="mt-5 space-y-5 rounded-2xl border border-white/5 bg-black/20 p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Slider
                label="Market drawdown (all non-stablecoins)"
                value={params.marketDrawdownPercent ?? -30}
                limits={STRESS_LIMITS.marketDrawdownPercent}
                disabled={params.marketDrawdownPercent === null}
                onChange={(value) => update({ marketDrawdownPercent: value })}
              />
              <label className="mt-1 inline-flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={params.marketDrawdownPercent !== null}
                  onChange={(event) => update({ marketDrawdownPercent: event.target.checked ? -30 : null })}
                />
                Apply market drawdown
              </label>
            </div>
            <Slider
              label="Liquidity haircut (exit value)"
              value={params.liquidityHaircutPercent}
              limits={STRESS_LIMITS.liquidityHaircutPercent}
              onChange={(value) => update({ liquidityHaircutPercent: value })}
            />
            <div>
              <label htmlFor={`${fieldId}-depeg`} className="block text-sm text-white/70">Depeg asset</label>
              <select
                id={`${fieldId}-depeg`}
                value={params.depegTarget ?? ""}
                onChange={(event) => update({ depegTarget: event.target.value || null })}
                className={`${fieldClass} mt-2 w-full`}
              >
                <option value="" className="bg-[#101012]">None</option>
                <option value={DEPEG_ALL_STABLECOINS} className="bg-[#101012]">All stablecoins</option>
                {depegMissing && <option value={params.depegTarget ?? ""} className="bg-[#101012]">Not in this portfolio</option>}
                {portfolio.holdings.map((holding, index) => (
                  <option key={`${holdingTarget(holding)}:${index}`} value={holdingTarget(holding)} className="bg-[#101012]">
                    {holding.symbol} · {holding.chainName ?? holding.chainId ?? "unknown chain"} · {holding.tokenAddress.slice(0, 8)}
                  </option>
                ))}
              </select>
              {depegMissing && <p className="mt-2 text-xs text-amber-200">The depeg asset is not held here, so that shock has no effect.</p>}
            </div>
            <Slider
              label="Depeg below current price"
              value={params.depegPercent}
              limits={STRESS_LIMITS.depegPercent}
              disabled={params.depegTarget === null}
              onChange={(value) => update({ depegPercent: value })}
            />
          </div>

          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              savePreset();
            }}
          >
            <input
              value={presetName}
              maxLength={MAX_PRESET_NAME_LENGTH}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="Preset name"
              aria-label="Preset name"
              className={`${fieldClass} min-w-0 flex-1`}
            />
            <button type="submit" disabled={!presetName.trim()} className={buttonClass}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save preset
            </button>
          </form>
          {presets.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Saved presets">
              {presets.map((preset) => (
                <li key={preset.name} className="inline-flex items-center rounded-full border border-white/10">
                  <button type="button" onClick={() => setParams(preset.params)} className="min-h-11 min-w-11 px-3 text-sm text-white hover:underline">
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete preset ${preset.name}`}
                    onClick={() => persist(presets.filter((item) => item.name !== preset.name), `Deleted preset “${preset.name}”.`)}
                    className="min-h-11 min-w-11 px-3 text-white/60 hover:text-white"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {notice && <p role="status" className="text-sm text-white/70">{notice}</p>}
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {hasPriced
          ? `Projected value ${usd(delta.stressedValueUsd)}, change ${delta.percentageDelta.toFixed(1)} percent. ${result.missingInputs.length} missing inputs.`
          : "Projected impact unknown. No priced holdings."}
      </p>

      <div className="mt-5 space-y-5 rounded-2xl border border-white/5 bg-black/20 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-sm text-white/50">Original Value</div>
            <div className="mt-1 text-2xl font-semibold">{usd(hasPriced ? delta.originalValueUsd : null)}</div>
          </div>
          <div>
            <div className="text-sm text-white/50">Stressed Value</div>
            <div className="mt-1 text-2xl font-semibold">{usd(hasPriced ? delta.stressedValueUsd : null)}</div>
          </div>
          <div>
            <div className="text-sm text-white/50">Delta</div>
            {hasPriced ? (
              <div className={`mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold ${deltaColor}`}>
                {delta.valueDeltaUsd !== 0 && <DeltaIcon className="h-5 w-5" aria-hidden="true" />}
                {delta.valueDeltaUsd < 0 ? "-" : delta.valueDeltaUsd > 0 ? "+" : ""}
                {usd(Math.abs(delta.valueDeltaUsd))}
                <span className="text-lg">({delta.percentageDelta > 0 ? "+" : ""}{delta.percentageDelta.toFixed(2)}%)</span>
              </div>
            ) : (
              <div className="mt-1 text-2xl font-semibold">Unknown</div>
            )}
          </div>
        </div>

        {result.missingInputs.length > 0 && (
          <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-200">
            <h3 className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Missing inputs: results are incomplete
            </h3>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {result.missingInputs.map((missing, index) => (
                <li key={`${missing.key}:${missing.input}:${index}`}>{missing.symbol} {missing.input}: {missing.detail}</li>
              ))}
            </ul>
          </div>
        )}

        <ImpactChart impacts={result.assetImpacts} />

        <div>
          <h3 className="text-sm font-semibold text-white/70">Concentration and thresholds</h3>
          {breaches === null ? (
            <p className="mt-2 text-sm text-amber-200">
              {rulesLoaded ? "Your rules could not be loaded, so thresholds were not evaluated." : "Loading your rules…"}
            </p>
          ) : breaches.length === 0 ? (
            <p className="mt-2 text-sm text-white/50">No threshold in your rules is breached by the priced holdings.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-red-200">
              {breaches.map((breach) => (
                <li key={`${breach.rule}:${breach.keys.join()}`} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {breach.label}: {breach.stressedValue?.toFixed(1) ?? "unknown"} (limit {breach.limit}), {breach.crossedByStress ? "crossed under stress" : "already breached before stress"}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 overflow-x-auto" role="region" aria-label="Stressed concentration table" tabIndex={0}>
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-white/50">
                <tr>
                  {["Asset", "Change", "Allocation before", "Allocation after", "Liquidity", "Threshold"].map((heading) => (
                    <th key={heading} scope="col" className="py-2 pr-4 font-medium">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.assetImpacts.map((asset, index) => {
                  const hits = breaches?.filter((breach) => breach.keys.includes(asset.key)) ?? [];
                  return (
                    <tr key={`${asset.key}:${index}`} className={`border-t border-white/10 ${hits.length ? "bg-red-500/10" : ""}`}>
                      <th scope="row" className="py-2 pr-4 font-medium text-white">
                        {asset.symbol}
                        {asset.chain && <span className="block text-xs font-normal text-white/50">{asset.chain}</span>}
                      </th>
                      <td className="py-2 pr-4 tabular-nums">{percent(asset.deltaPercent)}</td>
                      <td className="py-2 pr-4 tabular-nums">{percent(asset.baseAllocationPercent)}</td>
                      <td className="py-2 pr-4 tabular-nums">{percent(asset.stressedAllocationPercent)}</td>
                      <td className="py-2 pr-4">{asset.liquidityStatus}</td>
                      <td className="py-2 pr-4">
                        {hits.length ? hits.map((hit) => hit.label).join("; ") : breaches === null || asset.priceStatus === "missing" ? "Not evaluated" : "Within rules"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {result.assumptions.length > 0 && (
          <div className="border-t border-white/10 pt-4">
            <h3 className="text-sm font-semibold text-white/70">Assumptions</h3>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-white/50">
              {result.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
