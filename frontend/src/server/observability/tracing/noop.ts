import type { Span } from "@opentelemetry/api";

export const noopSpan: Span = {
  spanContext: () => ({
    traceId: "00000000000000000000000000000000",
    spanId: "0000000000000000",
    traceFlags: 0,
  }),
  setAttribute: () => noopSpan,
  setAttributes: () => noopSpan,
  addEvent: () => noopSpan,
  addLink: () => noopSpan,
  addLinks: () => noopSpan,
  setStatus: () => noopSpan,
  updateName: () => noopSpan,
  end: () => undefined,
  isRecording: () => false,
  recordException: () => undefined,
};

export function runWithoutRecording<T>(operation: () => T): T {
  return operation();
}
