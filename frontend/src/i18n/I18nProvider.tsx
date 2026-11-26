"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import { createFormatters } from "./format";
import { messages, type Translate } from "./messages";

export type I18nValue = {
  locale: Locale;
  timeZone: string;
  t: Translate;
  format: ReturnType<typeof createFormatters>;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, timeZone, children }: I18nValue & { children: ReactNode }) {
  const value = useMemo<I18nValue>(() => ({
    locale,
    timeZone,
    t: messages(locale),
    format: createFormatters(locale, timeZone),
  }), [locale, timeZone]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
