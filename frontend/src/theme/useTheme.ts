"use client";

import { createContext, useContext } from "react";

export const THEME_STORAGE_KEY = "cryptara-theme";

export const themeModes = ["light", "dark", "system", "high-contrast"] as const;

export type ThemeMode = (typeof themeModes)[number];

export type ThemeContextValue = {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark" | "high-contrast";
  setTheme: (theme: ThemeMode) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}

export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return themeModes.includes(value as ThemeMode);
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

export function resolveTheme(theme: ThemeMode): "light" | "dark" | "high-contrast" {
  if (theme === "high-contrast") {
    return "high-contrast";
  }

  if (theme === "light") {
    return "light";
  }

  if (theme === "dark") {
    return "dark";
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }

  return "dark";
}

export function applyThemeToDocument(theme: ThemeMode) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = resolveTheme(theme) === "light" ? "light" : "dark";
}
