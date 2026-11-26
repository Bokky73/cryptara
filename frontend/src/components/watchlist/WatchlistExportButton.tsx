"use client";

import { useMemo, useState } from "react";
import type { WatchlistEntry } from "@/server/types";
import { isSpreadsheetFormula, neutralizeSpreadsheetValue, WATCHLIST_CSV_HEADERS } from "@/server/discovery/watchlistCsv";
import { Modal } from "./Modal";

const MAX_PREVIEW_CELLS = 50;

/** CSV download with a preview of the cells changed to stop formula injection. */
export function WatchlistExportButton({ wallet, entries }: { wallet: string; entries: WatchlistEntry[] }) {
  const [open, setOpen] = useState(false);
  const changes = useMemo(() => entries.flatMap((entry, index) => {
    const record: Record<string, unknown> = entry;
    return WATCHLIST_CSV_HEADERS.flatMap((column) => {
      const value = record[column];
      return isSpreadsheetFormula(value)
        ? [{ row: index + 2, column, before: String(value), after: neutralizeSpreadsheetValue(String(value)) }]
        : [];
    });
  }), [entries]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-800 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700"
      >
        Export CSV
      </button>
      {open ? (
        <Modal title="Export watchlist CSV" onClose={() => setOpen(false)}>
          {changes.length === 0 ? (
            <p className="text-sm text-slate-300">No cells could run as spreadsheet formulas. Values are exported unchanged.</p>
          ) : (
            <>
              <p className="text-sm text-slate-300">
                {changes.length} {changes.length === 1 ? "cell" : "cells"} could run as a spreadsheet formula and will be
                exported as text with a leading apostrophe. Importing the file here removes it again.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead><tr><th scope="col" className="p-2">Line</th><th scope="col" className="p-2">Column</th><th scope="col" className="p-2">Value</th><th scope="col" className="p-2">Exported as</th></tr></thead>
                  <tbody>
                    {changes.slice(0, MAX_PREVIEW_CELLS).map((change) => (
                      <tr key={`${change.row}:${change.column}`} className="border-t border-slate-800">
                        <td className="p-2">{change.row}</td>
                        <td className="p-2">{change.column}</td>
                        <td className="break-all p-2 font-mono">{change.before}</td>
                        <td className="break-all p-2 font-mono text-emerald-300">{change.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {changes.length > MAX_PREVIEW_CELLS ? <p className="text-xs text-slate-400">Showing the first {MAX_PREVIEW_CELLS}.</p> : null}
            </>
          )}
          <a
            href={`/api/watchlist/export?wallet=${encodeURIComponent(wallet)}&format=csv`}
            download
            className="self-start rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500"
          >
            Download CSV
          </a>
        </Modal>
      ) : null}
    </>
  );
}
