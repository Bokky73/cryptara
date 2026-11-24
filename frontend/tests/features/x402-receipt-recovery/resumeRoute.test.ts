import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getReceiptMock = vi.fn();
const runTokenScanMock = vi.fn();
const checkRateLimitMock = vi.fn();

const config = {
  protectedResource: "/api/x402/deep-scan",
  network: "eip155:84532",
  asset: "USDC",
  payTo: "0x000000000000000000000000000000000000dEaD",
  paymentExpirySeconds: 300,
};

vi.mock("@/server/storage", () => ({
  getX402PaymentReceiptByHeaderHash: (...args: unknown[]) => getReceiptMock(...args),
}));
vi.mock("@/server/scan/tokenScan", () => ({
  runTokenScan: (...args: unknown[]) => runTokenScanMock(...args),
}));
vi.mock("@/server/security/rateLimit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));
vi.mock("@/server/x402/config", () => ({
  getX402RuntimeConfig: () => config,
}));

import { POST } from "@/app/api/x402/deep-scan/resume/route";
import { stableJsonHash } from "@/server/x402/guards";

const paymentHeaderHash = "a".repeat(64);
const scan = { symbol: "MEME", overallRiskScore: 42 };
const requestBody = { query: "MEME", chain: "base" };

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/x402/deep-scan/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function matchingReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "x402_receipt_1",
    paymentHeaderHash,
    requestBodyHash: stableJsonHash(requestBody),
    protectedResource: config.protectedResource,
    network: config.network,
    asset: config.asset,
    payTo: config.payTo,
    verificationStatus: "verified",
    paymentExpiry: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("POST /api/x402/deep-scan/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitMock.mockReturnValue(null);
    runTokenScanMock.mockResolvedValue(scan);
    getReceiptMock.mockReturnValue(matchingReceipt());
  });

  it("reuses a verified receipt to return the scan without settling another payment", async () => {
    const response = await POST(makeRequest({ paymentHeaderHash, ...requestBody }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scan).toEqual(scan);
    expect(body.premium).toMatchObject({ unlocked: true, resumed: true, receiptId: "x402_receipt_1" });
    expect(runTokenScanMock).toHaveBeenCalledWith("MEME", "base", undefined);
  });

  it("refuses a receipt bound to a different scan payload", async () => {
    getReceiptMock.mockReturnValue(matchingReceipt({ requestBodyHash: stableJsonHash({ query: "OTHER", chain: "base" }) }));

    const response = await POST(makeRequest({ paymentHeaderHash, ...requestBody }));

    expect(response.status).toBe(403);
    expect(runTokenScanMock).not.toHaveBeenCalled();
  });

  it("returns a recoverable error when no receipt exists", async () => {
    getReceiptMock.mockReturnValue(null);

    const response = await POST(makeRequest({ paymentHeaderHash, ...requestBody }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("receipt_not_found");
    expect(runTokenScanMock).not.toHaveBeenCalled();
  });
});
