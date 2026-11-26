import { MAX_QUERY_LENGTH } from "@/lib/commandPalette/schema";
export function SearchInput({ value, onChange, activeId, scanLabel }: { value: string; onChange: (value: string) => void; activeId?: string; scanLabel?: string }) {
  return <div><label htmlFor="command-search" className="block text-sm font-medium">Search pages, insights and assets, or paste a token</label>
    <input id="command-search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results"
      aria-activedescendant={activeId} aria-describedby="command-help" value={value} maxLength={MAX_QUERY_LENGTH}
      onChange={event => onChange(event.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…, CODE:G…, or a DexScreener link"
      className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]" />
    <p role="status" className="mt-2 text-sm empty:hidden">{scanLabel ? `${scanLabel} detected. Press Enter to run a free AI risk scan.` : ""}</p>
  </div>;
}
