import type { Command } from "@/lib/commandPalette/schema";
export function ResultList({ results, selected, choose, select }: { results: Command[]; selected: number; choose: (command: Command) => void; select: (index: number) => void }) {
  return <ul id="command-results" role="listbox" aria-label="Search results" className="mt-4 max-h-[50dvh] overflow-y-auto">
    {results.map((command, index) => <li key={command.id} id={`command-result-${index}`} role="option" aria-selected={selected === index}
      onMouseMove={() => select(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(command)}
      className={`cursor-pointer rounded-lg border p-3 ${selected === index ? "border-[var(--color-focus)] bg-[var(--color-nav-hover-bg)]" : command.group === "Scan" ? "border-[var(--color-border)]" : "border-transparent"}`}>
      <span className="block font-medium">{selected === index ? "› " : ""}{command.label}</span>
      <span className="block break-words text-sm">{command.group} · {command.description}</span>
      {command.tags && <span className="mt-1 flex flex-wrap gap-1">{command.tags.map(tag => <span key={tag} className="rounded-full border border-[var(--color-border)] px-2 text-xs">{tag}</span>)}</span>}
    </li>)}
  </ul>;
}
