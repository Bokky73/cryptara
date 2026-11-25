"use client";

import type { ErrorRecoveryProps } from "@/components/ErrorRecoveryPanel";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export default function AlertsError(props: ErrorRecoveryProps) {
  return <RouteErrorBoundary {...props} boundary="alerts" />;
}
