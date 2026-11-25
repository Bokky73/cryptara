import { describe, expect, it } from "vitest";
import { createFormatters } from "./format";

const instant = "2026-01-01T22:30:00Z";

describe("createFormatters", () => {
  it.each(["UTC", "Europe/Istanbul", "America/New_York", "Asia/Tokyo"])("formats timestamps deterministically in %s", (timeZone) => {
    for (const locale of ["en", "tr"] as const) {
      const expected = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(instant));
      expect(createFormatters(locale, timeZone).dateTime(instant)).toBe(expected);
    }
  });

  it("formats short dates deterministically", () => {
    for (const locale of ["en", "tr"] as const) {
      const expected = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(instant));
      expect(createFormatters(locale, "UTC").shortDate(instant)).toBe(expected);
    }
    expect(createFormatters("en").shortDate("not-a-date")).toBe("—");
  });

  it("falls back to UTC for invalid time zones", () => {
    expect(createFormatters("en", "invalid-zone").dateTime(instant)).toBe(createFormatters("en", "UTC").dateTime(instant));
  });

  it("formats currency with explicit precision", () => {
    expect(createFormatters("en").currencyWithDigits(1234.567, 4)).toBe("$1,234.567");
    expect(createFormatters("tr").currencyWithDigits(1234.567, 2)).toBe(
      new Intl.NumberFormat("tr", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(1234.567),
    );
  });

  it("returns a dash for invalid numbers and timestamps", () => {
    const format = createFormatters("en");
    expect(format.number(Number.NaN)).toBe("—");
    expect(format.percent(Number.POSITIVE_INFINITY)).toBe("—");
    expect(format.currency(Number.NEGATIVE_INFINITY)).toBe("—");
    expect(format.compact(Number.NaN)).toBe("—");
    expect(format.dateTime("not-a-date")).toBe("—");
    expect(format.relative(Number.NaN, "day")).toBe("—");
  });
});
