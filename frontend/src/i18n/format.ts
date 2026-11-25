import { resolveTimeZone, type Locale } from "./config";
export function createFormatters(locale: Locale, timeZone = "UTC") {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: resolveTimeZone(timeZone) });
  const shortDate = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: resolveTimeZone(timeZone) });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return {
    number: (value: number) => Number.isFinite(value) ? number.format(value) : "—",
    percent: (fraction: number) => Number.isFinite(fraction) ? percent.format(fraction) : "—",
    currency: (value: number) => Number.isFinite(value) ? currency.format(value) : "—",
    currencyWithDigits: (value: number, maximumFractionDigits: number) =>
      Number.isFinite(value)
        ? new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits }).format(value)
        : "—",
    compact: (value: number) => Number.isFinite(value) ? compact.format(value) : "—",
    dateTime: (instant: string) => Number.isFinite(Date.parse(instant)) ? date.format(new Date(instant)) : "—",
    shortDate: (instant: string) => Number.isFinite(Date.parse(instant)) ? shortDate.format(new Date(instant)) : "—",
    relative: (value: number, unit: Intl.RelativeTimeFormatUnit) => Number.isFinite(value) ? relative.format(value, unit) : "—",
  };
}
