import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WatchlistExportButton, WatchlistImportForm } from "@/components/WatchlistClient";
import type { WatchlistEntry } from "@/server/types";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const existing: WatchlistEntry[] = [{
  id: "w1", walletAddress: "0xme", identityKey: "k", chain: "base", contractAddress: address("1"),
  source: "manual", note: "=HYPERLINK(1)", createdAt: "2026-01-01T00:00:00.000Z",
}];
const csv = [
  "version,chain,contractAddress,symbol",
  `1.0.0,base,${address("1")},DUP`,
  `1.0.0,base,${address("2")},NEW`,
  `1.0.0,base,${address("2")},AGAIN`,
  "1.0.0,base,0xbad,BAD",
  `1.0.0,nowhere,${address("3")},NET`,
  "1.0.0,base",
].join("\n");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function openWizard() {
  render(<WatchlistImportForm wallet="0xme" existing={existing} />);
  fireEvent.click(screen.getByRole("button", { name: "Import watchlist" }));
}

function file(text: string, name = "list.csv") {
  const result = new File([text], name);
  // jsdom does not implement Blob.text.
  Object.defineProperty(result, "text", { value: async () => text });
  return result;
}

async function choose(selected: File) {
  await act(async () => { fireEvent.change(screen.getByLabelText("Watchlist file"), { target: { files: [selected] } }); });
}

const rowText = (number: number) => screen.getByTestId(`import-row-${number}`).textContent ?? "";
const include = (number: number) => screen.getByLabelText(`Include row ${number}`) as HTMLInputElement;

describe("import wizard", () => {
  it("previews every row with its problem before sending anything", async () => {
    openWizard();
    await choose(file(csv));
    await screen.findByText(/1 valid, 2 duplicate, 3 invalid/);

    expect(rowText(1)).toContain("Already in your watchlist.");
    expect(rowText(3)).toContain("Repeats an earlier row");
    expect(rowText(4)).toContain("Invalid EVM contract address.");
    expect(rowText(5)).toContain('Unknown chain "nowhere"');
    expect(rowText(6)).toContain("Expected 4 columns");
    expect(include(4).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a dropped file", async () => {
    openWizard();
    await act(async () => { fireEvent.drop(screen.getByTestId("import-dropzone"), { dataTransfer: { files: [file(csv)] } }); });
    expect(await screen.findByTestId("import-row-1")).toBeTruthy();
  });

  it("promotes a repeated row when the original is excluded", async () => {
    openWizard();
    await choose(file(csv));
    await screen.findByTestId("import-row-2");
    fireEvent.click(include(2));
    expect(rowText(3)).toContain("Valid");
  });

  it("sends only included rows with the chosen strategy and reports each outcome", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { entries } = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        appliedCount: 1, updatedCount: 1, skippedCount: 0,
        result: { results: entries.map((row: object, index: number) => ({ index, row, status: "valid", errors: [], outcome: index ? "imported" : "updated" })) },
      }));
    });
    openWizard();
    await choose(file(csv));
    await screen.findByTestId("import-row-1");
    fireEvent.click(include(3));
    fireEvent.click(screen.getByLabelText(/Update its symbol/));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Import 2 rows" })); });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/watchlist/import?wallet=0xme&strategy=update");
    expect(JSON.parse(init.body).entries.map((row: { symbol: string }) => row.symbol)).toEqual(["DUP", "NEW"]);

    const dialog = screen.getByRole("dialog", { name: "Import complete" });
    expect(dialog.textContent).toContain("1 imported, 1 updated, 0 skipped");
    expect(dialog.textContent).toContain("not imported (Invalid EVM contract address.)");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(6);
  });

  it.each([
    ["unterminated quote", 'version,chain\n"1.0.0,base', "list.csv", /Unterminated CSV quote/],
    ["wrong headers", "a,b\n1,2", "list.csv", /Invalid CSV headers/],
    ["bad JSON", "{", "list.json", /not valid JSON/],
    ["JSON null", "null", "list.json", /no entries list/],
    ["no rows", "version,chain\n", "list.csv", /no rows/],
    ["other type", "x", "list.exe", /Choose a .csv or .json/],
  ])("explains a file with %s", async (_label, text, name, message) => {
    openWizard();
    await choose(file(text, name));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("keeps the preview when the server rejects the import", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    openWizard();
    await choose(file(csv));
    await screen.findByTestId("import-row-1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Import 3 rows" })); });
    expect(screen.getByText("Import failed")).toBeTruthy();
    expect(screen.getByTestId("import-row-1")).toBeTruthy();
  });

  it("closes on Escape and restores focus", async () => {
    render(<WatchlistImportForm wallet="0xme" existing={[]} />);
    const opener = screen.getByRole("button", { name: "Import watchlist" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

describe("export preview", () => {
  it("lists neutralized cells before downloading", () => {
    render(<WatchlistExportButton wallet="0xme" entries={existing} />);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(screen.getByText("=HYPERLINK(1)")).toBeTruthy();
    expect(screen.getByText("'=HYPERLINK(1)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download CSV" }).getAttribute("href")).toContain("format=csv");
  });
});
