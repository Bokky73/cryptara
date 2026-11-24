import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  X402_RECEIPT_TTL_MS,
  buildX402Fingerprint,
  clearX402Receipts,
  findRecentX402Receipt,
  hashX402PaymentHeader,
  listX402Receipts,
  markX402PaymentSettled,
  removeX402Receipt,
  savePendingX402Payment,
} from "@/lib/x402ReceiptStore";

const fingerprint = {
  targetToken: "0xabc123",
  network: "base",
  requestHash: "a".repeat(64),
};

const otherFingerprint = {
  ...fingerprint,
  targetToken: "0xdef456",
};

describe("x402 receipt store", () => {
  beforeEach(() => {
    clearX402Receipts();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  it("derives a stable fingerprint scoped to token, network and payload", async () => {
    const payload = { query: "  MEME ", chain: "base", walletAddress: "" };
    const first = await buildX402Fingerprint(payload);
    const second = await buildX402Fingerprint(payload);
    const differentNetwork = await buildX402Fingerprint({ ...payload, chain: "arbitrum" });
    const differentPayload = await buildX402Fingerprint({ ...payload, query: "AERO" });

    expect(first).toEqual(second);
    expect(first.targetToken).toBe("meme");
    expect(first.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(differentNetwork.network).not.toBe(first.network);
    expect(differentPayload.requestHash).not.toBe(first.requestHash);
  });

  it("stores only the payment header and its hash, never wallet secrets", async () => {
    const paymentHeader = "base64-encoded-payment-signature";
    await savePendingX402Payment({
      fingerprint,
      paymentSignature: paymentHeader,
      paymentHeaderHash: await hashX402PaymentHeader(paymentHeader),
      payer: "0xPayer",
    });

    const stored = window.sessionStorage.getItem("cryptara:x402-receipts:v1") ?? "";
    expect(stored).toContain(paymentHeader);
    expect(stored).not.toContain("PRIVATE_KEY_MUST_NEVER_BE_STORED");
    expect(findRecentX402Receipt(fingerprint)?.status).toBe("pending");
    expect(findRecentX402Receipt(otherFingerprint)).toBeNull();
  });

  it("marks a receipt settled with the server receipt id", () => {
    savePendingX402Payment({
      fingerprint,
      paymentSignature: "signature",
      paymentHeaderHash: "b".repeat(64),
    });

    const settled = markX402PaymentSettled(fingerprint, "x402_receipt_1");

    expect(settled?.status).toBe("settled");
    expect(settled?.receiptId).toBe("x402_receipt_1");
    expect(findRecentX402Receipt(fingerprint)?.status).toBe("settled");
  });

  it("expires entries after the TTL and removes them on read", () => {
    savePendingX402Payment({
      fingerprint,
      paymentSignature: "signature",
      paymentHeaderHash: "c".repeat(64),
    });

    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000 + X402_RECEIPT_TTL_MS + 1);

    expect(findRecentX402Receipt(fingerprint)).toBeNull();
    expect(listX402Receipts()).toHaveLength(0);
    expect(window.sessionStorage.getItem("cryptara:x402-receipts:v1")).toBe("{}");
  });

  it("clears one receipt or all receipts", () => {
    savePendingX402Payment({ fingerprint, paymentSignature: "one", paymentHeaderHash: "d".repeat(64) });
    savePendingX402Payment({ fingerprint: otherFingerprint, paymentSignature: "two", paymentHeaderHash: "e".repeat(64) });

    removeX402Receipt(fingerprint);
    expect(listX402Receipts()).toHaveLength(1);

    clearX402Receipts();
    expect(listX402Receipts()).toHaveLength(0);
  });
});
