import { z } from "zod";
import {
  createContractIdentity,
  createWalletIdentity,
  getChainFamily,
  isStellarAccountAddress,
  isStellarContractAddress,
  isTransactionHashForChain,
  normalizeNetwork,
  resolveChainContext,
} from "@/lib/chainIdentity";

const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const safeChainPattern = /^[a-zA-Z0-9:_-]{1,40}$/;
const safeSymbolPattern = /^[a-zA-Z0-9$._-]{1,32}$/;
const safeSocialHandlePattern = /^@?[a-zA-Z0-9_]{2,30}$/;

export const walletAddressSchema = z.string().regex(evmAddressPattern, "Expected EVM wallet address").optional();
export const contractAddressSchema = z.string().regex(evmAddressPattern, "Expected EVM contract address").optional();
export const stellarWalletAddressSchema = z.string().refine(isStellarAccountAddress, "Expected Stellar G-address").optional();
export const stellarContractAddressSchema = z.string().refine(isStellarContractAddress, "Expected Stellar C-address").optional();
export const anyWalletAddressSchema = z.string().refine(
  (value) => evmAddressPattern.test(value) || isStellarAccountAddress(value),
  "Expected EVM or Stellar wallet address",
).optional();
export const chainIdSchema = z.string().regex(safeChainPattern, "Invalid chain id").optional();
export const chainFamilySchema = z.enum(["evm", "stellar"]);
export const networkSchema = z.string().min(1).max(64).transform((value) => value.trim());
export const tokenSymbolSchema = z.string().regex(safeSymbolPattern, "Invalid token symbol").optional();
export const socialHandleSchema = z.string().regex(safeSocialHandlePattern, "Invalid social handle").optional();
export const externalUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);

  return url.protocol === "https:" || url.protocol === "http:";
}, "Expected http(s) URL").optional();

export function validateWalletAddressForChain(value: string | undefined, chain?: string) {
  if (!value) return true;

  return getChainFamily(chain) === "stellar" ? isStellarAccountAddress(value) : evmAddressPattern.test(value);
}

export function validateContractAddressForChain(value: string | undefined, chain?: string) {
  if (!value) return true;

  return getChainFamily(chain) === "stellar" ? isStellarContractAddress(value) : evmAddressPattern.test(value);
}

export function validateTransactionHashForChain(value: string, chain?: string) {
  return isTransactionHashForChain(value, getChainFamily(chain));
}

export function validateChainScopedWallet(input: {
  chainFamily?: "evm" | "stellar";
  network?: string;
  walletAddress: string;
}) {
  try {
    const context = resolveChainContext({
      chainFamily: input.chainFamily,
      network: input.network ?? (isStellarAccountAddress(input.walletAddress) ? "stellar-testnet" : "legacy-evm"),
      identifier: input.walletAddress,
    });
    createWalletIdentity({ ...context, address: input.walletAddress });
    return true;
  } catch {
    return false;
  }
}

export function validateChainScopedContract(input: {
  chainFamily?: "evm" | "stellar";
  network?: string;
  contractAddress: string;
}) {
  try {
    const context = resolveChainContext({
      chainFamily: input.chainFamily,
      network: input.network,
      identifier: input.contractAddress,
    });
    createContractIdentity({ ...context, address: input.contractAddress });
    return true;
  } catch {
    return false;
  }
}

export function validateChainScopedTransaction(input: {
  chainFamily?: "evm" | "stellar";
  network?: string;
  txHash: string;
}) {
  try {
    const family = input.chainFamily ?? (input.txHash.startsWith("0x") ? "evm" : "stellar");
    const network = normalizeNetwork(
      input.network ?? (family === "evm" ? "legacy-evm" : "stellar-testnet"),
      family,
    );

    return isTransactionHashForChain(input.txHash, resolveChainContext({ chainFamily: family, network }).chainFamily);
  } catch {
    return false;
  }
}

export function normalizeSymbol(value?: string) {
  return value?.trim().replace(/^\$/, "").toUpperCase();
}

export function validateEndpointInput<T>(schema: z.ZodType<T>, value: unknown) {
  return schema.safeParse(value);
}

const forbiddenObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

export class UnsafeJsonPayloadError extends Error {
  constructor(public readonly path: string) {
    super(`Forbidden key "${path}" in request body`);
    this.name = "UnsafeJsonPayloadError";
  }
}

function assertNoPrototypePollution(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrototypePollution(entry, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (forbiddenObjectKeys.has(key)) {
        throw new UnsafeJsonPayloadError(`${path}.${key}`);
      }

      assertNoPrototypePollution((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

/**
 * Parses a raw JSON request body, rejecting prototype-pollution keys before
 * handing the value to a Zod schema. Returns a discriminated result so route
 * handlers can map failures onto canonical error envelopes.
 */
export function parseJsonBody(raw: string): { ok: true; value: unknown } | { ok: false; error: UnsafeJsonPayloadError | SyntaxError } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: error instanceof SyntaxError ? error : new SyntaxError("Invalid JSON body") };
  }

  try {
    assertNoPrototypePollution(parsed);
  } catch (error) {
    return { ok: false, error: error as UnsafeJsonPayloadError };
  }

  return { ok: true, value: parsed };
}

/**
 * Wraps a Zod object schema in `.strict()` so unknown keys are rejected rather
 * than silently stripped or coerced.
 */
export function jsonBodySchema<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

const paginationShape = {
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(256).optional(),
};

const addressListSchema = z.array(anyWalletAddressSchema.unwrap()).max(100);

// /api/scan
export const scanRequestSchema = jsonBodySchema({
  address: anyWalletAddressSchema.unwrap(),
  chain: chainIdSchema,
  network: networkSchema.optional(),
  chainFamily: chainFamilySchema.optional(),
  includeHistory: z.boolean().optional(),
});

// /api/agent/*
export const agentChatRequestSchema = jsonBodySchema({
  message: z.string().min(1).max(4000),
  conversationId: z.string().max(128).optional(),
  walletAddress: anyWalletAddressSchema,
  chain: chainIdSchema,
  network: networkSchema.optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const agentActionRequestSchema = jsonBodySchema({
  action: z.string().min(1).max(64),
  walletAddress: anyWalletAddressSchema,
  chain: chainIdSchema,
  network: networkSchema.optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

// /api/execute/*
export const executeRequestSchema = jsonBodySchema({
  walletAddress: anyWalletAddressSchema.unwrap(),
  chain: chainIdSchema,
  network: networkSchema.optional(),
  chainFamily: chainFamilySchema.optional(),
  contractAddress: contractAddressSchema,
  action: z.string().min(1).max(64),
  amount: z.string().max(78).optional(),
  tokenSymbol: tokenSymbolSchema,
  params: z.record(z.string(), z.unknown()).optional(),
});

export const executeSimulateRequestSchema = jsonBodySchema({
  walletAddress: anyWalletAddressSchema.unwrap(),
  chain: chainIdSchema,
  network: networkSchema.optional(),
  chainFamily: chainFamilySchema.optional(),
  contractAddress: contractAddressSchema,
  action: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()).optional(),
});

// /api/alerts/*
export const alertCreateRequestSchema = jsonBodySchema({
  walletAddress: anyWalletAddressSchema,
  chain: chainIdSchema,
  network: networkSchema.optional(),
  type: z.enum(["price", "transaction", "balance", "contract"]),
  threshold: z.string().max(78).optional(),
  tokenSymbol: tokenSymbolSchema,
  enabled: z.boolean().optional(),
});

export const alertUpdateRequestSchema = jsonBodySchema({
  enabled: z.boolean().optional(),
  threshold: z.string().max(78).optional(),
  tokenSymbol: tokenSymbolSchema,
});

// /api/watchlist/*
export const watchlistCreateRequestSchema = jsonBodySchema({
  walletAddress: anyWalletAddressSchema.unwrap(),
  chain: chainIdSchema,
  network: networkSchema.optional(),
  label: z.string().max(64).optional(),
});

export const watchlistUpdateRequestSchema = jsonBodySchema({
  label: z.string().max(64).optional(),
  addresses: addressListSchema.optional(),
});

// /api/rules/*
export const ruleCreateRequestSchema = jsonBodySchema({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  walletAddress: anyWalletAddressSchema,
  chain: chainIdSchema,
  network: networkSchema.optional(),
  condition: z.record(z.string(), z.unknown()),
  action: z.record(z.string(), z.unknown()).optional(),
});

export const ruleUpdateRequestSchema = jsonBodySchema({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  condition: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).optional(),
});

export const listQuerySchema = z.object(paginationShape).strict();

export type ScanRequestInput = z.infer<typeof scanRequestSchema>;
export type AgentChatRequestInput = z.infer<typeof agentChatRequestSchema>;
export type AgentActionRequestInput = z.infer<typeof agentActionRequestSchema>;
export type ExecuteRequestInput = z.infer<typeof executeRequestSchema>;
export type ExecuteSimulateRequestInput = z.infer<typeof executeSimulateRequestSchema>;
export type AlertCreateRequestInput = z.infer<typeof alertCreateRequestSchema>;
export type AlertUpdateRequestInput = z.infer<typeof alertUpdateRequestSchema>;
export type WatchlistCreateRequestInput = z.infer<typeof watchlistCreateRequestSchema>;
export type WatchlistUpdateRequestInput = z.infer<typeof watchlistUpdateRequestSchema>;
export type RuleCreateRequestInput = z.infer<typeof ruleCreateRequestSchema>;
export type RuleUpdateRequestInput = z.infer<typeof ruleUpdateRequestSchema>;
export type ListQueryInput = z.infer<typeof listQuerySchema>;
