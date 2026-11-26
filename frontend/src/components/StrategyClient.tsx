"use client";

import { AutoModeOnboarding } from "@/components/AutoModeOnboarding";
import { RuleForm } from "@/components/RuleForm";
import { useWalletSessionContext } from "@/providers/WalletSessionProvider";
import type { StrategyPreset } from "@/server/rules/presets";
import type { UserRule } from "@/server/types";

type StrategyClientProps = {
  initialRules: UserRule;
  presets: StrategyPreset[];
  chains: { id: string; name: string; chainFamily: string }[];
  categories: string[];
};

export function StrategyClient({ initialRules, presets, chains, categories }: StrategyClientProps) {
  const session = useWalletSessionContext();
  const walletAddress = session.isConnected ? session.address : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="flex flex-col gap-2 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d9a441]">Strategy</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Risk rules and auto mode</h1>
        </div>
        <span className="text-sm text-white/46">
          {walletAddress ? `Wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Wallet authorization required"}
        </span>
      </section>
      <RuleForm
        initialRules={initialRules}
        presets={presets}
        chains={chains}
        categories={categories}
        walletAddress={walletAddress}
      />
      <AutoModeOnboarding />
    </div>
  );
}
