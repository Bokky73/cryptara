"use client";

import type { ErrorRecoveryProps } from "@/components/ErrorRecoveryPanel";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export default function AgentsError(props: ErrorRecoveryProps) {
  return <RouteErrorBoundary {...props} boundary="agents" />;
}
