"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const blockedSelector = [
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "a[href^='/api']",
  "[data-state-changing]",
].join(",");

export function OfflineInteractionGuard() {
  const { actionsDisabled, isOffline } = useOnlineStatus();
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.offlineLocked = actionsDisabled ? "true" : "false";

    let timer: NodeJS.Timeout;

    const block = (event: Event) => {
      if (!actionsDisabled) return;
      const target = event.target instanceof Element ? event.target.closest(blockedSelector) : null;
      if (!target || target.closest("[data-offline-allow]")) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const reason = isOffline
        ? "Action paused: You are currently offline. Live scans, transactions, and signatures require a network connection to protect against stale data."
        : "Action paused: Network connection restored. Please click 'Refresh now' on the banner to synchronize fresh state.";

      setBlockedNotice(reason);
      clearTimeout(timer);
      timer = setTimeout(() => setBlockedNotice(null), 4000);
    };

    document.addEventListener("click", block, true);
    document.addEventListener("submit", block, true);

    return () => {
      document.removeEventListener("click", block, true);
      document.removeEventListener("submit", block, true);
      clearTimeout(timer);
    };
  }, [actionsDisabled, isOffline]);

  if (!blockedNotice) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-5 right-5 z-50 max-w-md rounded-xl border border-amber-400/40 bg-black/90 p-4 shadow-2xl backdrop-blur-md text-xs text-amber-100 flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2"
    >
      <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
      <div className="flex-1">
        <div className="font-semibold text-amber-300">Offline Protection Active</div>
        <div className="mt-1 leading-relaxed text-white/80">{blockedNotice}</div>
      </div>
      <button
        type="button"
        data-offline-allow
        onClick={() => setBlockedNotice(null)}
        className="text-white/40 hover:text-white text-xs px-1"
        aria-label="Dismiss alert"
      >
        ✕
      </button>
    </div>
  );
}