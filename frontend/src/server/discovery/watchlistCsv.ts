export const WATCHLIST_CSV_HEADERS = ["version", "chain", "network", "assetType", "contractAddress", "pairAddress", "symbol", "tokenName", "assetKey", "issuer", "source", "note", "createdAt"] as const;

// Full-width forms are included because spreadsheets may normalize them.
const FORMULA_PREFIX = /^[=+\-@\t\r\n＝＋－＠]/;

/** Whether a spreadsheet could evaluate the value as a formula. */
export function isSpreadsheetFormula(value: unknown): boolean {
  return value !== null && value !== undefined && FORMULA_PREFIX.test(String(value));
}

/** Prefix risky values with an apostrophe so spreadsheets show them as text. */
export function neutralizeSpreadsheetValue(value: string): string {
  // Escape apostrophes too, making the spreadsheet protection reversible.
  return value.startsWith("'") || FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function escapeWatchlistCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = neutralizeSpreadsheetValue(String(value));
  return `"${text.replace(/"/g, '\"\"')}"`;
}

export type WatchlistCsvRow = { value: Record<string, string> | null; error?: string };

/**
 * Parse a watchlist CSV, reporting rows with the wrong column count instead of
 * rejecting the file. Throws when the file's structure cannot be trusted.
 */
export function parseWatchlistCsvRows(input: string, maxRows = 1000): WatchlistCsvRow[] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const endField = () => { row.push(field); field = ""; closed = false; };
  const endRow = () => {
    endField();
    if (row.some(value => value !== "")) rows.push(row);
    row = [];
    if (rows.length > maxRows + 1) throw new Error("Too many CSV rows");
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += ch;
    } else if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || ch === '"') throw new Error("Malformed CSV quoting");
      field += ch;
    }
  }
  if (quoted) throw new Error("Unterminated CSV quote");
  if (field !== "" || closed || row.length > 0) endRow();
  if (!rows.length) throw new Error("CSV header is required");
  const headers = rows.shift()!.map(header => header.trim());
  const allowed = new Set<string>(WATCHLIST_CSV_HEADERS);
  if (new Set(headers).size !== headers.length || headers.some(h => !allowed.has(h)) || !headers.includes("version") || !headers.includes("chain")) throw new Error("Invalid CSV headers");
  return rows.map((values) => {
    if (values.length !== headers.length) {
      return { value: null, error: `Expected ${headers.length} columns but found ${values.length}.` };
    }
    return {
      value: Object.fromEntries(headers.map((header, i) => [header, values[i].replace(/^'(?=['=+\-@\t\r\n＝＋－＠])/, "")])),
    };
  });
}

/** Strict form: any malformed row rejects the file. */
export function parseWatchlistCsv(input: string, maxRows = 1000): Record<string, string>[] {
  return parseWatchlistCsvRows(input, maxRows).map(({ value, error }, index) => {
    if (!value) throw new Error(`CSV row ${index + 2}: ${error}`);
    return value;
  });
}
