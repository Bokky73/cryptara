"use client";

import { useState } from "react";
import { CheckCircle2, Download, ShieldCheck } from "lucide-react";
import { auditBundleToCsv } from "@/lib/audit/auditCsv";
import type { AuditBundle } from "@/server/privacy/auditBundle";

/** Categories included verbatim vs. redacted in the audit bundle. */
const PREVIEW = {
  included: ["decision action + score", "approval transitions", "transaction lifecycle + timestamps", "evidence digests", "network identity"],
  redacted: ["wallet addresses", "balances & strategies", "provider payloads", "secrets & signed XDR", "internal notes"],
} as const;

const REDACTION_NOTICE =
  "PII redaction is ON: wallet identifiers are one-way hashed; wallet addresses, balances, strategies, provider payloads, secrets, signed XDR and internal notes are excluded.";

type ExportFormat = "json" | "csv";

function downloadFile(payload: string, mime: string, extension: ExportFormat) {
  const blob = new Blob([payload], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cryptara-audit-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function AuditExportButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [confirmed, setConfirmed] = useState(false);
  const [lastExport, setLastExport] = useState<string>();

  async function handleExport() {
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet-privacy/audit-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { bundle?: AuditBundle; hash?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "export_failed");
        return;
      }
      if (!data.bundle || typeof data.hash !== "string") {
        setError("Malformed export response.");
        return;
      }

      const hash = data.hash;
      if (format === "csv") {
        downloadFile(auditBundleToCsv(data.bundle, hash), "text/csv;charset=utf-8", "csv");
      } else {
        downloadFile(JSON.stringify({
          bundle: data.bundle,
          hash,
          redaction: {
            status: "redacted",
            excluded: PREVIEW.redacted,
            note: REDACTION_NOTICE,
          },
        }, null, 2), "application/json", "json");
      }
      setLastExport(`Redacted ${format.toUpperCase()} bundle downloaded (hash ${hash.slice(0, 12)}…). ${REDACTION_NOTICE}`);
      setOpen(false);
      setConfirmed(false);
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

      {lastExport ? (
        <p role="status" className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {lastExport}
        </p>
      ) : null}

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

          <fieldset className="mt-4">
            <legend className="text-xs font-medium text-white/80">File format</legend>
            <div className="mt-2 flex gap-2">
              {(["json", "csv"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={format === option}
                  onClick={() => setFormat(option)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold uppercase transition ${
                    format === option
                      ? "border-purple-400/60 bg-purple-600/25 text-white"
                      : "border-white/15 text-white/60 hover:text-white"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>

          <p role="status" className="mt-3 rounded-md border border-amber-300/20 bg-amber-400/8 px-2.5 py-2 text-[11px] leading-4 text-amber-200">
            {REDACTION_NOTICE}
          </p>

          <label className="mt-3 flex items-start gap-2 text-[11px] leading-4 text-white/70">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5"
            />
            I confirm this export is redacted and contains no raw wallet addresses, balances, strategies, provider payloads, secrets or signed XDR.
          </label>

          {error ? <p role="alert" className="mt-2 text-xs text-red-400">{error}</p> : null}
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={busy || !confirmed}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-purple-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {busy ? "Exporting…" : `Download ${format.toUpperCase()} bundle`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
