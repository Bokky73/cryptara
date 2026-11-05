import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

let initialized = false;

export function isTracingEnabled(): boolean {
  return process.env.OTEL_TRACING_ENABLED === "1" && Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;

  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key && value) headers[key] = value;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function normalizeOtlpEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1/traces") ? trimmed : `${trimmed}/v1/traces`;
}

export async function initializeTracing(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!isTracingEnabled()) return;

  if (process.env.OTEL_LOG_LEVEL === "debug") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const [{ NodeTracerProvider }, { BatchSpanProcessor }, { OTLPTraceExporter }, { Resource }, { ATTR_SERVICE_NAME }] =
    await Promise.all([
      import("@opentelemetry/sdk-trace-node"),
      import("@opentelemetry/sdk-trace-base"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
    ]);

  const exporter = new OTLPTraceExporter({
    url: normalizeOtlpEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? ""),
    headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  });

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim() || "cryptara-frontend",
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register();
}
