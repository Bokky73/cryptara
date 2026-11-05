import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import type { IStorageAdapter } from "@/server/storage/adapters/types";
import type { ProviderAdapterResult } from "@/server/providers/adapter";
import { extractResultCode, redactSpanAttributes } from "./redact";
import { noopSpan } from "./noop";

const TRACER_NAME = "cryptara";

function toSpanAttributes(attributes: Record<string, unknown>): Record<string, string | number | boolean> {
  const redacted = redactSpanAttributes(attributes);
  const normalized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(redacted)) {
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      normalized[key] = value;
      continue;
    }
    normalized[key] = JSON.stringify(value);
  }

  return normalized;
}

export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

export function getActiveTraceId(): string | undefined {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  if (!traceId || /^0+$/.test(traceId)) return undefined;
  return traceId;
}

function endSpan(span: Span | undefined) {
  (span ?? trace.getActiveSpan() ?? noopSpan).end();
}

function recordSpanError(span: Span | undefined, error: unknown) {
  const activeSpan = span ?? trace.getActiveSpan() ?? noopSpan;
  const code = extractResultCode(error);
  if (code) activeSpan.setAttribute("error.code", code);

  const message = error instanceof Error ? error.message : String(error);
  activeSpan.recordException(error instanceof Error ? error : new Error(message));
  activeSpan.setStatus({ code: SpanStatusCode.ERROR, message });
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);

  return new Promise<T>((resolve, reject) => {
    tracer.startActiveSpan(name, { attributes: toSpanAttributes(attributes) }, async (span) => {
      const activeSpan = span ?? trace.getActiveSpan() ?? noopSpan;
      try {
        resolve(await operation(activeSpan));
      } catch (error) {
        recordSpanError(activeSpan, error);
        reject(error);
      } finally {
        endSpan(activeSpan);
      }
    });
  });
}

export async function withRouteSpan<T>(
  routeName: string,
  attributes: Record<string, unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(`route.${routeName}`, { "http.route": routeName, ...attributes }, async (span) => {
    const result = await operation();
    if (result instanceof Response && !result.ok) {
      span.setAttribute("http.status_code", result.status);
    }
    return result;
  });
}

export async function withAgentSpan<T>(
  agent: string,
  attributes: Record<string, unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(`agent.${agent}`, { "agent.name": agent, ...attributes }, async () => operation());
}

export async function withProviderSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(name, attributes, operation);
}

export async function withRpcSpan<T>(
  rpcKind: "stellar_rpc" | "stellar_data_api" | "evm_rpc",
  network: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  return withSpan(`rpc.${rpcKind}`, { "rpc.kind": rpcKind, "chain.network": network }, async () => operation());
}

export function annotateProviderResult<T>(span: Span, result: ProviderAdapterResult<T>) {
  span.setAttributes(
    toSpanAttributes({
      "provider.ok": result.ok,
      "provider.attempts": result.attempts,
      "provider.fallback_rank": result.fallbackRank,
      "provider.circuit_state": result.circuitState,
      "provider.elapsed_ms": result.elapsedMs,
      "provider.error_code": result.error?.code,
      "cache.policy": result.source.cache?.policy,
      "cache.hit": result.source.cache?.hit,
    }),
  );
  if (!result.ok && result.error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: result.error.code });
  }
}

export function wrapStorageAdapter(adapter: IStorageAdapter): IStorageAdapter {
  const wrapMethod = <Args extends unknown[], Result>(
    operation: string,
    method: (...args: Args) => Promise<Result>,
  ) => {
    return (...args: Args) =>
      withSpan(`storage.${adapter.provider}.${operation}`, { "storage.provider": adapter.provider, "storage.operation": operation }, async () =>
        method(...args),
      );
  };

  return new Proxy(adapter, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || property === "constructor") return value;
      return wrapMethod(String(property), value.bind(target));
    },
  });
}
