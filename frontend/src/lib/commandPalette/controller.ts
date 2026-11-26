import { useMemo, useState, useSyncExternalStore } from "react";
import { insightCommands } from "./insights";
import { routeCommands } from "./registry";
import { rankCommands } from "./ranking";
import { rememberCommand } from "./recent";
import { parseRecents, recentsSnapshot, recordScannedAsset, subscribeRecents } from "./persistedRecents";
import { detectScanTarget, scanCommand, scanHref } from "./scanTarget";
import { sessionCommands } from "./scope";
import { MAX_RESULTS, type Command, type PaletteScope, type SessionAsset } from "./schema";
// Parent keys this controller by wallet/network. Only visited insights and scanned assets are persisted.
export function usePaletteController(scope: PaletteScope | null, assets: readonly SessionAsset[]) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const stored = useSyncExternalStore(subscribeRecents, recentsSnapshot, () => "");
  const { scans, recentCommands } = useMemo(() => {
    const persisted = parseRecents(stored);
    const scans = new Map(persisted.scans.map(request => [scanCommand(request, "Recent").id, request]));
    const recentCommands: Command[] = [
      ...persisted.scans.map(request => scanCommand(request, "Recent")),
      ...persisted.insights.flatMap(slug => insightCommands.filter(command => command.id === `insight:${slug}`)).map(command => ({ ...command, group: "Recent" as const })),
    ];
    return { scans, recentCommands };
  }, [stored]);
  const commands = useMemo(() => {
    const recentIds = new Set(recentCommands.map(command => command.id));
    return [...recentCommands, ...routeCommands, ...insightCommands.filter(command => !recentIds.has(command.id)), ...sessionCommands(scope, assets)];
  }, [recentCommands, scope, assets]);
  const scanTarget = useMemo(() => detectScanTarget(query, scope), [query, scope]);
  const results = useMemo(() => {
    const ranked = rankCommands(commands, query, recent);
    if (!scanTarget) return ranked;
    const scan = scanCommand(scanTarget, "Scan");
    return [scan, ...ranked.filter(command => command.id !== scan.id)].slice(0, MAX_RESULTS);
  }, [commands, query, recent, scanTarget]);
  function activate(command: Command): string {
    setRecent(previous => rememberCommand(previous, command.id));
    const request = command.group === "Scan" ? scanTarget : scans.get(command.id);
    if (!request) return command.href;
    recordScannedAsset(request);
    // A fresh marker lets the same asset be scanned twice in a row.
    return scanHref(request, Date.now().toString(36));
  }
  return { query, setQuery: (value: string) => { setQuery(value); setSelected(0); }, scanTarget,
    results, selected: Math.min(selected, Math.max(0, results.length - 1)), setSelected, activate };
}
