import { describe, expect, it } from "vitest";
import { messageCatalogs, messages, type MessageKey } from "./messages";

const placeholderPattern = /\{(\w+)\}/g;

function placeholderNames(value: string): string[] {
  return Array.from(value.matchAll(placeholderPattern), (match) => match[1]).sort();
}

describe("message catalogs", () => {
  it("has exact key parity between locales", () => {
    expect(Object.keys(messageCatalogs.en).sort()).toEqual(Object.keys(messageCatalogs.tr).sort());
  });

  it("has non-empty translations in both locales", () => {
    for (const [key, english] of Object.entries(messageCatalogs.en)) {
      expect(english.trim(), `Missing English value for ${key}`).not.toBe("");
      expect(messageCatalogs.tr[key as MessageKey].trim(), `Missing Turkish value for ${key}`).not.toBe("");
    }
  });

  it("keeps placeholders aligned across locales", () => {
    for (const [key, english] of Object.entries(messageCatalogs.en)) {
      expect(placeholderNames(english), `Placeholder mismatch for ${key}`).toEqual(
        placeholderNames(messageCatalogs.tr[key as MessageKey]),
      );
    }
  });

  it("interpolates variables without changing literal placeholders", () => {
    const translate = messages("tr");
    const key: MessageKey = "scanComplete";
    expect(translate(key, { symbol: "USDC", score: 72 })).toBe("Tarama tamamlandı. USDC riski 100 üzerinden 72.");
    expect(translate(key, { symbol: "USDC" })).toContain("{score}");
  });

  it("rejects unknown keys", () => {
    expect(() => messages("en")("missing" as MessageKey)).toThrow("Unknown translation key");
  });
});
