"use client";

import type { ErrorRecoveryProps } from "@/components/ErrorRecoveryPanel";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export default function StrategyError(props: ErrorRecoveryProps) {
  return <RouteErrorBoundary {...props} boundary="strategy" />;
}
