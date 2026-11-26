"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { apiRequest, toApiClientError, type ApiClientError } from "@/lib/apiClient";
import { parseWatchlistCsvRows } from "@/server/discovery/watchlistCsv";
import type { WatchlistImportInput } from "@/server/discovery/watchlistImport";
import type { WatchlistEntry, WatchlistImportDryRunResult, WatchlistImportDryRunRowResult, WatchlistImportStrategy } from "@/server/types";
import { Modal } from "./Modal";

// Loaded on demand: address checksums need the Stellar SDK.
type Validator = typeof import("@/server/discovery/watchlistImport");
type LoadedFile = { name: string; inputs: WatchlistImportInput[]; validator: Validator };
type ImportResponse = { appliedCount: number; updatedCount: number; skippedCount: number; result: WatchlistImportDryRunResult };

const statusLabel: Record<WatchlistImportDryRunRowResult["status"], { text: string; tone: string }> = {
  valid: { text: "Valid", tone: "text-emerald-300" },
  duplicate: { text: "Duplicate", tone: "text-amber-300" },
  collision: { text: "Collision", tone: "text-amber-300" },
  invalid: { text: "Invalid", tone: "text-rose-300" },
};

function clientError(message: string): ApiClientError {
  return { kind: "client", code: "invalid_file", message, retryable: false, recoveryAction: "stop" };
}

async function loadFile(file: File): Promise<LoadedFile> {
  const validator = await import("@/server/discovery/watchlistImport");
  if (file.size > validator.MAX_WATCHLIST_IMPORT_BYTES) throw new Error("The file is larger than 5 MB.");

  const text = await file.text();
  let inputs: WatchlistImportInput[];
  if (file.name.toLowerCase().endsWith(".json")) {
    let data: { entries?: unknown };
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The file is not valid JSON.");
    }
    if (!Array.isArray(data?.entries)) throw new Error("The JSON file has no entries list.");
    inputs = data.entries.map((value: unknown) => ({ value }));
  } else if (file.name.toLowerCase().endsWith(".csv")) {
    inputs = parseWatchlistCsvRows(text, validator.MAX_WATCHLIST_IMPORT_ROWS);
  } else {
    throw new Error("Choose a .csv or .json file.");
  }
  if (inputs.length > validator.MAX_WATCHLIST_IMPORT_ROWS) throw new Error(`The file has more than ${validator.MAX_WATCHLIST_IMPORT_ROWS} rows.`);
  if (inputs.length === 0) throw new Error("The file has no rows to import.");
  return { name: file.name, inputs, validator };
}

function assetLabel({ row }: WatchlistImportDryRunRowResult) {
  return row.contractAddress ?? row.assetKey ?? row.pairAddress ?? row.symbol ?? "—";
}

export function WatchlistImportForm({ wallet, existing }: { wallet: string; existing: WatchlistEntry[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <h3 className="font-semibold text-white">Bulk Import</h3>
      <p className="mt-1 text-xs text-slate-400">Check every row of a CSV or JSON file before anything is saved.</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Import watchlist
      </button>
      {open ? <ImportDialog wallet={wallet} existing={existing} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function ImportDialog({ wallet, existing, onClose }: { wallet: string; existing: WatchlistEntry[]; onClose: () => void }) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [strategy, setStrategy] = useState<WatchlistImportStrategy>("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [outcome, setOutcome] = useState<ImportResponse | null>(null);
  const [dragging, setDragging] = useState(false);
  const latestFile = useRef(0);

  // Excluding a row can make a later duplicate the original, so the included
  // rows are classified on their own and excluded rows keep their position.
  const rows = useMemo(() => {
    if (!file) return [];
    const all = file.validator.previewWatchlistImport(file.inputs, existing).results;
    const includedIndexes = all.filter(({ index, status }) => status !== "invalid" && !excluded.has(index)).map(({ index }) => index);
    const included = file.validator.previewWatchlistImport(includedIndexes.map((index) => file.inputs[index]), existing).results;
    const byIndex = new Map(included.map((result, position) => [includedIndexes[position], result]));
    return all.map((result) => ({ ...(byIndex.get(result.index) ?? result), index: result.index, included: byIndex.has(result.index) }));
  }, [excluded, existing, file]);

  const includedRows = rows.filter((row) => row.included);
  const counts = {
    valid: rows.filter((row) => row.status === "valid").length,
    duplicate: rows.filter((row) => row.status === "duplicate").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
  };

  async function choose(selected: File | undefined) {
    if (!selected || busy) return;
    const request = ++latestFile.current;
    setError(null);
    setFile(null);
    setExcluded(new Set());
    try {
      const loaded = await loadFile(selected);
      if (request === latestFile.current) setFile(loaded);
    } catch (cause) {
      if (request === latestFile.current) setError(clientError(cause instanceof Error ? cause.message : "The file could not be read."));
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void choose(event.dataTransfer.files[0]);
  }

  function toggle(index: number) {
    setExcluded((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }

  async function apply() {
    if (busy || includedRows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setOutcome(await apiRequest<ImportResponse>(
        `/api/watchlist/import?wallet=${encodeURIComponent(wallet)}&strategy=${strategy}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: includedRows.map(({ row }) => row) }),
        },
      ));
    } catch (cause) {
      setError(toApiClientError(cause));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    if (outcome) window.location.reload();
    onClose();
  }

  if (outcome) {
    return (
      <Modal title="Import complete" onClose={close}>
        <p role="status" className="text-sm text-emerald-300">
          {outcome.appliedCount} imported, {outcome.updatedCount} updated, {outcome.skippedCount} skipped.
        </p>
        <ul className="space-y-1 text-xs text-slate-300">
          {outcome.result.results.map((result) => (
            <li key={result.index}>
              Row {includedRows[result.index]?.index + 1}: <span className="break-all font-mono">{assetLabel(result)}</span> — {result.outcome}
            </li>
          ))}
          {rows.filter((row) => !row.included).map((row) => (
            <li key={`excluded-${row.index}`}>
              Row {row.index + 1}: <span className="break-all font-mono">{assetLabel(row)}</span> — not imported
              {row.status === "invalid" ? ` (${row.errors.join(" ")})` : " (excluded)"}
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  return (
    <Modal title="Import watchlist" onClose={close}>
      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="import-dropzone"
        className={`rounded-xl border border-dashed p-6 text-sm text-slate-300 ${dragging ? "border-emerald-400 bg-emerald-500/10" : "border-slate-600"}`}
      >
        <label className="block">
          <span className="mb-2 block">Drop a CSV or JSON file here, or choose one.</span>
          <input
            type="file"
            accept=".csv,.json"
            aria-label="Watchlist file"
            disabled={busy}
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              // Allows choosing the same file again after correcting it.
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {error ? <ApiErrorNotice error={error} title="Import failed" /> : null}

      {file ? (
        <>
          <p role="status" className="text-sm text-slate-200">
            {file.name}: {counts.valid} valid, {counts.duplicate} duplicate, {counts.invalid} invalid. Nothing has been saved yet.
          </p>
          {counts.invalid > 0 ? <p className="text-xs text-rose-300">Invalid rows are excluded from the import.</p> : null}

          <fieldset className="text-sm text-slate-200" disabled={busy}>
            <legend className="mb-1 font-medium">When an asset is a duplicate</legend>
            <label className="mr-6 inline-flex items-center gap-2">
              <input type="radio" name="strategy" checked={strategy === "skip"} onChange={() => setStrategy("skip")} />
              Skip it
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="strategy" checked={strategy === "update"} onChange={() => setStrategy("update")} />
              Update its symbol, name, pair, and note
            </label>
          </fieldset>

          <div className="max-h-80 overflow-auto rounded-lg border border-slate-800" tabIndex={0} role="region" aria-label="Import preview">
            <table className="w-full text-left text-xs text-slate-300">
              <thead>
                <tr>
                  <th scope="col" className="p-2">Include</th><th scope="col" className="p-2">Row</th><th scope="col" className="p-2">Chain</th>
                  <th scope="col" className="p-2">Asset</th><th scope="col" className="p-2">Symbol</th><th scope="col" className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.index} data-testid={`import-row-${row.index + 1}`} className={`border-t border-slate-800 ${row.status === "invalid" ? "bg-rose-500/10" : row.status === "duplicate" ? "bg-amber-500/5" : ""}`}>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`Include row ${row.index + 1}`}
                        checked={row.included}
                        disabled={busy || row.status === "invalid"}
                        onChange={() => toggle(row.index)}
                      />
                    </td>
                    <td className="p-2">{row.index + 1}</td>
                    <td className="p-2">{row.row.chain ?? "—"}</td>
                    <td className="break-all p-2 font-mono">{assetLabel(row)}</td>
                    <td className="p-2">{row.row.symbol ?? "—"}</td>
                    <td className="p-2">
                      <span className={`font-semibold ${statusLabel[row.status].tone}`}>{statusLabel[row.status].text}</span>
                      {row.errors.length > 0 ? <span className="block">{row.errors.join(" ")}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy || includedRows.length === 0}
            className="self-start rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Importing…" : `Import ${includedRows.length} ${includedRows.length === 1 ? "row" : "rows"}`}
          </button>
        </>
      ) : null}
    </Modal>
  );
}
