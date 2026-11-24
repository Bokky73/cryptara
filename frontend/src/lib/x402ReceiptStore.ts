/**
 * Short-lived, client-side x402 payment receipt cache.
 *
 * Only the encoded x402 payment-signature header and its SHA-256 hash are
 * persisted. Wallet private keys, seed phrases and raw wallet signatures are
 * never written to this store. Entries live in sessionStorage (one browser
 * tab), expire automatically, and are cleared when the wallet disconnects or
 * changes account.
 */

const STORAGE_KEY = "cryptara:x402-receipts:v1";

/** Long enough to survive a slow settlement + one retry, short enough to limit exposure. */
export const X402_RECEIPT_TTL_MS = 10 * 60 * 1000;

export type X402RequestPayload = {
  query: string;
  chain?: string;
  walletAddress?: string;
};

export type X402ReceiptFingerprint = {
  targetToken: string;
  network: string;
  requestHash: string;
};

export type X402ReceiptEntry = X402ReceiptFingerprint & {
  /** Encoded x402 PAYMENT-SIGNATURE header, replayed only on the resume endpoint. */
  paymentSignature: string;
  paymentHeaderHash: string;
  payer?: string;
  status: "pending" | "settled";
  receiptId?: string;
  createdAt: number;
  expiresAt: number;
};

export type SavePendingX402PaymentInput = {
  fingerprint: X402ReceiptFingerprint;
  paymentSignature: string;
  paymentHeaderHash: string;
  payer?: string;
};

function canonicalJson(value: X402RequestPayload): string {
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([left], [right]) => left.localeCompare(right));

  return JSON.stringify(Object.fromEntries(entries));
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is required to hash x402 payment receipts.");

  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stable hash of the exact scan payload used to build the deep-scan URL. */
export function hashX402Request(payload: X402RequestPayload): Promise<string> {
  return sha256Hex(canonicalJson(payload));
}

/** Matches the server-side `hashPaymentHeader` (SHA-256 of the raw header value). */
export function hashX402PaymentHeader(header: string): Promise<string> {
  return sha256Hex(header);
}

export async function buildX402Fingerprint(payload: X402RequestPayload): Promise<X402ReceiptFingerprint> {
  return {
    targetToken: payload.query.trim().toLowerCase(),
    network: payload.chain ?? "base",
    requestHash: await hashX402Request(payload),
  };
}

function receiptKey({ targetToken, network, requestHash }: X402ReceiptFingerprint): string {
  return `${network}:${requestHash}:${targetToken}`;
}

function isReceiptEntry(value: unknown): value is X402ReceiptEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<X402ReceiptEntry>;
  return (
    typeof entry.targetToken === "string" &&
    typeof entry.network === "string" &&
    typeof entry.requestHash === "string" &&
    typeof entry.paymentSignature === "string" &&
    typeof entry.paymentHeaderHash === "string" &&
    (entry.status === "pending" || entry.status === "settled") &&
    typeof entry.createdAt === "number" &&
    typeof entry.expiresAt === "number"
  );
}

function writeStore(store: Record<string, X402ReceiptEntry>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private browsing / storage quota: receipts simply cannot be resumed.
  }
}

/** Reads the store, pruning malformed and expired entries on every access. */
function readStore(): Record<string, X402ReceiptEntry> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, X402ReceiptEntry>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const now = Date.now();
    const live = Object.entries(parsed).filter(
      ([key, entry]) => isReceiptEntry(entry) && entry.expiresAt > now && key === receiptKey(entry),
    );

    if (live.length !== Object.keys(parsed).length) {
      writeStore(Object.fromEntries(live));
    }

    return Object.fromEntries(live);
  } catch {
    return {};
  }
}

export function savePendingX402Payment(input: SavePendingX402PaymentInput): X402ReceiptEntry {
  const now = Date.now();
  const entry: X402ReceiptEntry = {
    ...input.fingerprint,
    paymentSignature: input.paymentSignature,
    paymentHeaderHash: input.paymentHeaderHash,
    payer: input.payer,
    status: "pending",
    createdAt: now,
    expiresAt: now + X402_RECEIPT_TTL_MS,
  };

  const store = readStore();
  store[receiptKey(entry)] = entry;
  writeStore(store);
  return entry;
}

export function markX402PaymentSettled(fingerprint: X402ReceiptFingerprint, receiptId?: string): X402ReceiptEntry | null {
  const store = readStore();
  const key = receiptKey(fingerprint);
  const entry = store[key];
  if (!entry) return null;

  const settled: X402ReceiptEntry = { ...entry, status: "settled", receiptId: receiptId ?? entry.receiptId };
  store[key] = settled;
  writeStore(store);
  return settled;
}

export function findRecentX402Receipt(fingerprint: X402ReceiptFingerprint): X402ReceiptEntry | null {
  return readStore()[receiptKey(fingerprint)] ?? null;
}

export function removeX402Receipt(fingerprint: X402ReceiptFingerprint): void {
  const store = readStore();
  delete store[receiptKey(fingerprint)];
  writeStore(store);
}

export function listX402Receipts(): X402ReceiptEntry[] {
  return Object.values(readStore());
}

export function clearX402Receipts(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures; the in-memory flow remains usable.
  }
}
