"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

type Props = { state: { engaged: boolean; reason?: string; actor?: string } };

export function AutoModeGuardrailPanel({ state }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const reason = state.reason ?? t("autoKillSwitchReason");
  const actorSuffix = state.actor ? t("autoHaltedActorSuffix", { actor: state.actor }) : "";
  return (
    <section aria-label={t("autoGuardrailsAria")} className="rounded-xl border border-white/10 bg-black/30 p-3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between text-left text-xs font-medium text-white/80 transition hover:text-white"
      >
        <span className="flex items-center gap-2">
          {state.engaged ? (
            <ShieldAlert className="h-4 w-4 text-red-400" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          )}
          <span>{state.engaged ? t("autoModeHalted") : t("autoGuardrailsActive")}</span>
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-white/50" /> : <ChevronDown className="h-3.5 w-3.5 text-white/50" />}
      </button>
      {expanded ? (
        <p className="mt-2 text-xs leading-5 text-white/60">
          {state.engaged
            ? t("autoHaltedReason", { reason, actorSuffix })
            : t("autoNonCustodialNotice")}
        </p>
      ) : null}
    </section>
  );
}

export default AutoModeGuardrailPanel;
