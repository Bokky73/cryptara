"use client";

import Link from "next/link";
import { AlertTriangle, LockKeyhole, ShieldAlert, Wallet, ZapOff } from "lucide-react";
import { StatusBadge } from "@/components/a11y/StatusBadge";

export type GateReason =
  | "policy_disabled"
  | "testnet_only"
  | "wallet_required"
  | "kill_switch_active"
  | "unsupported_network"
  | string;

export interface FeatureGateNoticeProps {
  feature: string;
  detail?: string;
  reason?: GateReason;
  actionText?: string;
  actionHref?: string;
  onAction?: () => void;
}

const reasonConfig: Record<
  string,
  { label: string; tone: "neutral" | "warning" | "critical" | "success"; icon: React.ComponentType<{ className?: string }>; defaultDetail: string; actionSuggestion?: { text: string; href?: string } }
> = {
  policy_disabled: {
    label: "Policy Disabled",
    tone: "neutral",
    icon: LockKeyhole,
    defaultDetail: "This capability is disabled by operator policy or governance rules.",
    actionSuggestion: { text: "View Governance Queue", href: "/insights/governance-queue" },
  },
  testnet_only: {
    label: "Testnet Only",
    tone: "warning",
    icon: AlertTriangle,
    defaultDetail: "This feature is only enabled on testnets and is gated on mainnet/pubnet until full audit sign-off.",
    actionSuggestion: { text: "Switch to Testnet", href: "/operations" },
  },
  wallet_required: {
    label: "Wallet Required",
    tone: "warning",
    icon: Wallet,
    defaultDetail: "Connect and authenticate your wallet to access this capability.",
    actionSuggestion: { text: "Connect Wallet" },
  },
  kill_switch_active: {
    label: "Kill-Switch Active",
    tone: "critical",
    icon: ZapOff,
    defaultDetail: "Emergency kill-switch is engaged. Actions are halted to safeguard assets.",
    actionSuggestion: { text: "Inspect Incident Status", href: "/operations" },
  },
  unsupported_network: {
    label: "Unsupported Network",
    tone: "warning",
    icon: ShieldAlert,
    defaultDetail: "This feature is not supported on the currently selected network.",
  },
};

/**
 * Presentation-only notice for a disabled capability. Feature authorization is
 * enforced server-side; this component surfaces categorized reason states and next steps.
 */
export function FeatureGateNotice({
  feature,
  detail,
  reason = "policy_disabled",
  actionText,
  actionHref,
  onAction,
}: FeatureGateNoticeProps) {
  const config = reasonConfig[reason] ?? {
    label: reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    tone: "neutral" as const,
    icon: LockKeyhole,
    defaultDetail: detail ?? "This capability is temporarily disabled.",
  };

  const Icon = config.icon;
  const resolvedDetail = detail ?? config.defaultDetail;
  const resolvedActionText = actionText ?? config.actionSuggestion?.text;
  const resolvedActionHref = actionHref ?? config.actionSuggestion?.href;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/6 p-5" role="status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Icon className="h-5 w-5 text-[#f2c86d]" />
          <span className="text-base font-semibold text-white">{feature}</span>
          <StatusBadge tone={config.tone}>{config.label}</StatusBadge>
        </div>
        {resolvedActionText && (
          <div>
            {resolvedActionHref ? (
              <Link
                href={resolvedActionHref}
                className="inline-flex items-center rounded-lg border border-[#d9a441]/30 bg-[#d9a441]/10 px-3 py-1.5 text-xs font-medium text-[#f2c86d] transition hover:bg-[#d9a441]/20"
              >
                {resolvedActionText} →
              </Link>
            ) : onAction ? (
              <button
                type="button"
                onClick={onAction}
                className="inline-flex items-center rounded-lg border border-[#d9a441]/30 bg-[#d9a441]/10 px-3 py-1.5 text-xs font-medium text-[#f2c86d] transition hover:bg-[#d9a441]/20"
              >
                {resolvedActionText}
              </button>
            ) : null}
          </div>
        )}
      </div>
      <p className="mt-3 text-sm leading-6 text-white/60">{resolvedDetail}</p>
    </div>
  );
}
