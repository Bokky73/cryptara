import type { Command } from "./schema";
export function resultAnnouncement(results: readonly Command[]) {
  return results.length ? `${results.length} results. Use arrow keys to select and Enter to open.` : "No matching pages, insights or session assets.";
}
