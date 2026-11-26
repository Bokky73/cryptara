"use client";

import type { ErrorRecoveryProps } from "@/components/ErrorRecoveryPanel";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export default function OperationsError(props: ErrorRecoveryProps) {
  return <RouteErrorBoundary {...props} boundary="operations" healthHref="/api/health" />;
}
