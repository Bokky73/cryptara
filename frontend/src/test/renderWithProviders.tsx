import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/config";
import { ThemeProvider } from "@/theme/ThemeProvider";

export function renderWithProviders(
  ui: ReactElement,
  options: { locale?: Locale; timeZone?: string } & Omit<RenderOptions, "wrapper"> = {},
): RenderResult {
  const { locale = "en", timeZone = "UTC", ...renderOptions } = options;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale={locale} timeZone={timeZone}>
            {children}
          </I18nProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
