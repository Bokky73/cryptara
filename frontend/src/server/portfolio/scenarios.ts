export type StressTarget = "all" | "stablecoins" | "memecoins" | "stellar_native" | string;

export type StressChange = {
  type: "price_multiplier" | "fixed_price" | "depeg" | "liquidity_haircut";
  target: StressTarget;
  multiplier?: number;
  fixedUsd?: number;
};

export type PortfolioStressScenario = {
  id: string;
  name: string;
  description: string;
  version: number;
  changes: StressChange[];
};

export const STRESS_SCENARIOS: PortfolioStressScenario[] = [
  {
    id: "market_crash_20",
    name: "20% Market Crash",
    description: "Broad market decline of 20% across all assets except stablecoins.",
    version: 2,
    changes: [
      {
        type: "price_multiplier",
        target: "non_stablecoins",
        multiplier: 0.8,
      }
    ],
  },
  {
    id: "stablecoin_depeg",
    name: "Stablecoin Depeg (80c)",
    description: "Major stablecoins depeg and drop to $0.80.",
    version: 1,
    changes: [
      {
        type: "depeg",
        target: "stablecoins",
        fixedUsd: 0.8,
      },
    ],
  },
  {
    id: "memecoin_crash",
    name: "Memecoin Collapse",
    description: "Meme coins lose 90% of their value.",
    version: 1,
    changes: [
      {
        type: "price_multiplier",
        target: "memecoins",
        multiplier: 0.1,
      },
    ],
  },
];

/** Bounds for the interactive scenario builder. All values are whole percentages. */
export const STRESS_LIMITS = {
  marketDrawdownPercent: { min: -80, max: -10, step: 1 },
  liquidityHaircutPercent: { min: 0, max: 90, step: 1 },
  depegPercent: { min: 1, max: 100, step: 1 },
} as const;

/** Depeg target that applies to every stablecoin rather than one holding. */
export const DEPEG_ALL_STABLECOINS = "stablecoins";
const HOLDING_TARGET_PREFIX = "holding:";

export type CustomStressParams = {
  /** Null switches the correlated market shock off. */
  marketDrawdownPercent: number | null;
  liquidityHaircutPercent: number;
  /** Null switches the depeg off; otherwise a `holdingTarget()` or DEPEG_ALL_STABLECOINS. */
  depegTarget: string | null;
  depegPercent: number;
};

export const DEFAULT_CUSTOM_STRESS: CustomStressParams = {
  marketDrawdownPercent: -30,
  liquidityHaircutPercent: 0,
  depegTarget: null,
  depegPercent: 20,
};

/** Chain-qualified, so equal symbols or native addresses on two chains stay distinct. */
export function holdingTarget(holding: { chainId?: string; chainName?: string; tokenAddress: string }): string {
  return `${HOLDING_TARGET_PREFIX}${holding.chainId ?? holding.chainName ?? ""}:${holding.tokenAddress}`;
}

function bounded(value: unknown, limits: { min: number; max: number }, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

/** Clamps untrusted input (stored presets, form values) into the supported range. */
export function normalizeCustomStress(input: Partial<CustomStressParams>): CustomStressParams {
  const { depegTarget } = input;
  return {
    marketDrawdownPercent: input.marketDrawdownPercent === null
      ? null
      : bounded(input.marketDrawdownPercent, STRESS_LIMITS.marketDrawdownPercent, -30),
    liquidityHaircutPercent: bounded(input.liquidityHaircutPercent, STRESS_LIMITS.liquidityHaircutPercent, 0),
    depegTarget: typeof depegTarget === "string"
      && (depegTarget === DEPEG_ALL_STABLECOINS || depegTarget.startsWith(HOLDING_TARGET_PREFIX)) ? depegTarget : null,
    depegPercent: bounded(input.depegPercent, STRESS_LIMITS.depegPercent, 20),
  };
}

export function buildCustomStressScenario(input: Partial<CustomStressParams>): PortfolioStressScenario {
  const params = normalizeCustomStress(input);
  const changes: StressChange[] = [];
  if (params.marketDrawdownPercent !== null) {
    changes.push({ type: "price_multiplier", target: "non_stablecoins", multiplier: (100 + params.marketDrawdownPercent) / 100 });
  }
  if (params.depegTarget) {
    // Relative to the current price, so an already depegged asset is never restored towards $1.
    changes.push({ type: "price_multiplier", target: params.depegTarget, multiplier: (100 - params.depegPercent) / 100 });
  }
  if (params.liquidityHaircutPercent > 0) {
    changes.push({ type: "liquidity_haircut", target: "all", multiplier: (100 - params.liquidityHaircutPercent) / 100 });
  }
  return { id: "custom", name: "Custom scenario", description: "User-defined shocks.", version: 1, changes };
}
