"use client";

import { useState } from "react";
import { Download, ShieldCheck } from "lucide-react";

/** Categories included verbatim vs. redacted in the audit bundle. */
const PREVIEW = {
  included: ["decision action + score", "approval transitions", "transaction lifecycle + timestamps", "evidence digests", "network identity"],
  redacted: ["wallet addresses", "balances & strategies", "provider payloads", "secrets & signed XDR", "internal notes"],
} as const;

function downloadBundle(payload: string) {
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cryptara-audit-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function AuditExportButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet-privacy/audit-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "export_failed");
        return;
      }
      downloadBundle(JSON.stringify(data, null, 2));
      setOpen(false);
    } catch {
      setError("export_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/7 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-purple-400"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        Audit export
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Audit bundle privacy preview"
          className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-white/10 bg-[#14141d] p-4 shadow-xl"
        >
          <p className="text-xs text-white/50">
            Export a verifiable, privacy-preserving audit bundle of your decisions, approvals, and transaction lifecycle.
          </p>
          <div className="mt-3 space-y-2 text-xs">
            <div>
              <p className="font-medium text-emerald-400">Included</p>
              <ul className="mt-1 list-inside list-disc text-white/60">
                {PREVIEW.included.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-amber-400">Redacted</p>
              <ul className="mt-1 list-inside list-disc text-white/60">
                {PREVIEW.redacted.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
          <button
            type="button"
            onClick={handleExport}
            disabled={busy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-purple-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-purple-500 disabled:opacity-60"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {busy ? "Exporting…" : "Download bundle"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
