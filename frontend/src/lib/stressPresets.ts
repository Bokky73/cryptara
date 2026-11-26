import { normalizeCustomStress, type CustomStressParams } from "@/server/portfolio/scenarios";

const STORE_KEY = "cryptara:stress-presets:v1";
export const MAX_STRESS_PRESETS = 10;
export const MAX_PRESET_NAME_LENGTH = 40;

export type StressPreset = { name: string; params: CustomStressParams };

export function readStressPresets(): StressPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item?.name === "string" && item.name.trim() && typeof item.params === "object" && item.params)
      .slice(0, MAX_STRESS_PRESETS)
      .map((item) => ({ name: item.name.slice(0, MAX_PRESET_NAME_LENGTH), params: normalizeCustomStress(item.params) }));
  } catch {
    return [];
  }
}

/** Returns false when the browser refuses the write, so the UI never claims a preset was saved. */
export function writeStressPresets(presets: StressPreset[]): boolean {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(presets.slice(0, MAX_STRESS_PRESETS)));
    return true;
  } catch {
    return false;
  }
}

export function clearStressPresets() {
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    // Storage is unavailable, so there is nothing to clear.
  }
}
