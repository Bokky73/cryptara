"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";

type Props = { state: { engaged: boolean; reason?: string; actor?: string } };

export function AutoModeGuardrailPanel({ state }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label="Auto Mode guardrails" className="rounded-xl border border-white/10 bg-black/30 p-3">
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
          <span>{state.engaged ? "Auto Mode halted by guardrails" : "Non-custodial guardrails active"}</span>
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-white/50" /> : <ChevronDown className="h-3.5 w-3.5 text-white/50" />}
      </button>
      {expanded ? (
        <p className="mt-2 text-xs leading-5 text-white/60">
          {state.engaged
            ? `${state.reason ?? "Emergency kill-switch engaged"}${state.actor ? ` by ${state.actor}` : ""}. Execution halted.`
            : "All actions require explicit wallet signature verification. Server cannot custody funds or sign transactions."}
        </p>
      ) : null}
    </section>
  );
}

export default AutoModeGuardrailPanel;
