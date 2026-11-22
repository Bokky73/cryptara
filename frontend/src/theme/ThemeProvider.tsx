"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ThemeContext,
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  getStoredTheme,
  isThemeMode,
  resolveTheme,
  type ThemeMode,
} from "@/theme/useTheme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark" | "high-contrast">(() => resolveTheme(getStoredTheme()));

  useEffect(() => {
    applyThemeToDocument(theme);
    queueMicrotask(() => setResolvedTheme(resolveTheme(theme)));

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => {
      applyThemeToDocument("system");
      setResolvedTheme(resolveTheme("system"));
    };

    syncSystemTheme();
    media.addEventListener("change", syncSystemTheme);

    return () => media.removeEventListener("change", syncSystemTheme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") {
      return;
    }

    const contrastMedia = window.matchMedia("(prefers-contrast: more)");
    const syncContrast = () => {
      applyThemeToDocument("system");
      setResolvedTheme(resolveTheme("system"));
    };

    syncContrast();
    contrastMedia.addEventListener("change", syncContrast);

    return () => contrastMedia.removeEventListener("change", syncContrast);
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY || !isThemeMode(event.newValue)) {
        return;
      }

      setThemeState(event.newValue);
    };

    window.addEventListener("storage", onStorage);

    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme: setThemeState,
    }),
    [theme, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
