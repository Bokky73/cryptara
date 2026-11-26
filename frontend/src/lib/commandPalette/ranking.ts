import { normalizeSearch } from "./normalize";
import { MAX_QUERY_LENGTH, MAX_RESULTS, type Command } from "./schema";

type SearchIndex = { label: string; haystack: string; words: string[] };
// Commands are immutable, so each is normalized once rather than on every keystroke.
const indexes = new WeakMap<Command, SearchIndex>();
function indexOf(command: Command): SearchIndex {
  let index = indexes.get(command);
  if (!index) {
    const label = normalizeSearch(command.label);
    const haystack = normalizeSearch([command.label, command.description, ...command.keywords].join(" "));
    index = { label, haystack, words: normalizeSearch([command.label, ...command.keywords].join(" ")).split(/[\s-]+/) };
    indexes.set(command, index);
  }
  return index;
}

/** True when the strings differ by at most one insertion, deletion or substitution. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const skipA = a.length >= b.length ? 1 : 0;
  const skipB = b.length >= a.length ? 1 : 0;
  return a.slice(i + skipA) === b.slice(i + skipB);
}

/** Short tokens must match literally; fuzzing them would match nearly everything. */
function fuzzyToken(token: string, words: readonly string[]): boolean {
  return token.length >= 4 && words.some(word => word[0] === token[0] && withinOneEdit(token, word));
}

function scoreQuery(index: SearchIndex, normalized: string, tokens: readonly string[]): number {
  if (index.label === normalized) return 100;
  if (index.label.startsWith(normalized)) return 80;
  if (index.haystack.split(" ").includes(normalized)) return 60;
  if (tokens.every(token => index.haystack.includes(token))) return 40;
  return tokens.every(token => index.haystack.includes(token) || fuzzyToken(token, index.words)) ? 20 : -1;
}

export function rankCommands(commands: readonly Command[], query: string, recent: readonly string[] = []): Command[] {
  const normalized = normalizeSearch(query.slice(0, MAX_QUERY_LENGTH));
  const tokens = normalized.split(" ").filter(Boolean);
  return commands.map((command, index) => {
    const score = normalized ? scoreQuery(indexOf(command), normalized, tokens)
      : recent.includes(command.id) ? 20 - recent.indexOf(command.id) : 0;
    return { command, score, index };
  }).filter(row => row.score >= 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, MAX_RESULTS).map(row => row.command);
}
