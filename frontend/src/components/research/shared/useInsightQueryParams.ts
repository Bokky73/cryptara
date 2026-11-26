"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  parseInsightQuery,
  patchInsightQuery,
  validateInsightParam,
  type InsightQueryKey,
  type InsightQueryParams,
} from "./insightQuery";

const changedEvent = "cryptara:insight-query-changed";

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener(changedEvent, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(changedEvent, callback);
  };
}

const getSearch = () => window.location.search;

/**
 * Validated, shareable URL state for insights views. The URL is the only copy of
 * the state, so a reload or a shared link reproduces the same view.
 */
export function useInsightQueryParams() {
  // Subscribes to router navigations and supplies the search string during SSR.
  const routerSearch = useSearchParams()?.toString() ?? "";
  const search = useSyncExternalStore(subscribe, getSearch, () => (routerSearch ? `?${routerSearch}` : ""));
  const params = useMemo<InsightQueryParams>(() => parseInsightQuery(search), [search]);

  const setParams = useCallback((patch: Partial<Record<InsightQueryKey, string | null | undefined>>) => {
    const { pathname, search: current, hash } = window.location;
    const next = patchInsightQuery(current, patch);
    if (next === current) return;
    // Next.js integrates replaceState with its router; no server round trip.
    window.history.replaceState(null, "", `${pathname}${next}${hash}`);
    window.dispatchEvent(new Event(changedEvent));
  }, []);

  return { params, setParams };
}

/**
 * Drop-in replacement for `useState` on one form field. Seeds from the URL and
 * writes back valid values; text that is still invalid stays local to the field.
 */
export function useInsightParam<T extends string = string>(
  key: InsightQueryKey,
  // Not inferred from the literal, so `useInsightParam("asset", "")` is a string.
  fallback: NoInfer<T>,
  allowed?: readonly T[],
): [T, (value: T) => void] {
  const { params, setParams } = useInsightQueryParams();
  const accept = (value: string | undefined) =>
    value !== undefined && (!allowed || (allowed as readonly string[]).includes(value)) ? (value as T) : undefined;

  const urlValue = accept(params[key]);
  const [draft, setDraft] = useState({ text: urlValue ?? fallback, urlValue });
  let text = draft.text;

  // The URL changed from outside this field: navigation, or another consumer.
  if (draft.urlValue !== urlValue) {
    text = urlValue ?? fallback;
    setDraft({ text, urlValue });
  }

  function setValue(value: T) {
    const nextUrlValue = accept(validateInsightParam(key, value));
    setDraft({ text: value, urlValue: nextUrlValue });
    setParams({ [key]: nextUrlValue ?? null });
  }

  return [text, setValue];
}
