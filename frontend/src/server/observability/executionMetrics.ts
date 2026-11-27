/**
 * Execution-specific metrics — provider latency/error rate, stale quotes,
 * simulation failures, policy blocks, wallet rejection, submission failure,
 * confirmation time, and storage write failure.
 *
 * Issue #18: V2 Execution Observability.
 */

import type { AgentRunRecord } from "@/server/types";
import { listTransactionRecords } from "@/server/storage";
import { listAuditEvents, type AuditOutcome, type ExecutionAuditEventKind } from "@/server/observability/executionAudit";

// ── Helpers ────────────────────────────────────────────────────────

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

// ── Metric types ───────────────────────────────────────────────────

export type ExecutionMetricsSnapshot = {
  /** Provider-level metrics. */
  providers: {
    /** Total quote requests and failure/stale rate. */
    quote: {
      total: number;
      stale: number;
      unavailable: number;
      successRate: number;
      staleRate: number;
    };
    /** Total simulation requests and failure rate. */
    simulation: {
      total: number;
      failed: number;
      failureRate: number;
    };
    /** Provider latency percentiles (p50, p95). */
    latencyMs: {
      p50: number;
      p95: number;
      sampleSize: number;
    };
  };
  /** Policy evaluation outcomes. */
  policy: {
    total: number;
    blocked: number;
    blockRate: number;
  };
  /** User wallet approval outcomes. */
  approval: {
    total: number;
    rejected: number;
    rejectionRate: number;
  };
  /** Submission outcomes. */
  submission: {
    total: number;
    failed: number;
    failureRate: number;
  };
  /** Confirmation metrics (from transaction records). */
  confirmation: {
    totalConfirmed: number;
    totalFailed: number;
    confirmationTimeMs: {
      p50: number;
      p95: number;
      sampleSize: number;
    };
    failureRate: number;
  };
  /** Storage write metrics. */
  storage: {
    total: number;
    failed: number;
    failureRate: number;
  };
  /** Sample metadata. */
  sample: {
    auditEventCount: number;
    transactionRecordCount: number;
    agentRunCount: number;
  };
};

// ── Computed metrics ───────────────────────────────────────────────

function countEventsByKind(kind: ExecutionAuditEventKind): number {
  return listAuditEvents({ kind }).length;
}

function countEventsByOutcome(outcome: AuditOutcome, kind?: ExecutionAuditEventKind): number {
  const events = listAuditEvents({ kind });
  return events.filter((e) => e.outcome === outcome).length;
}

export async function getExecutionMetrics(agentRuns: AgentRunRecord[] = []): Promise<ExecutionMetricsSnapshot> {
  // Provider metrics from audit events
  const quoteTotal = countEventsByKind("quote_received") + countEventsByKind("quote_stale") + countEventsByKind("quote_unavailable");
  const quoteStale = countEventsByKind("quote_stale");
  const quoteUnavailable = countEventsByKind("quote_unavailable");

  const simTotal = countEventsByKind("simulation_passed") + countEventsByKind("simulation_failed");
  const simFailed = countEventsByKind("simulation_failed");

  const policyTotal = countEventsByKind("policy_evaluated");
  const policyBlocked = countEventsByKind("policy_blocked");

  const approvalTotal = countEventsByKind("approval_granted") + countEventsByKind("approval_rejected");
  const approvalRejected = countEventsByKind("approval_rejected");

  const submissionTotal = countEventsByKind("submission_broadcast") + countEventsByKind("submission_failed");
  const submissionFailed = countEventsByKind("submission_failed");

  const storageTotal = countEventsByKind("persistence_written") + countEventsByKind("persistence_failed");
  const storageFailed = countEventsByKind("persistence_failed");

  // Latency from audit events with measured latency
  const allLatencies = listAuditEvents()
    .filter((e) => typeof e.latencyMs === "number" && e.latencyMs > 0)
    .map((e) => e.latencyMs!)
    .sort((a, b) => a - b);

  // Confirmation metrics from transaction records
  // TransactionRecord type doesn't include V2 lifecycle fields at the TS level,
  // but runtime records from the lifecycle manager carry them.
  const transactions = await listTransactionRecords();
  const confirmed = transactions.filter((t) => {
    const lifecycle = (t as Record<string, unknown>).lifecycleStatus as string | undefined;
    return lifecycle === "confirmed";
  });
  const failedTx = transactions.filter((t) => {
    const lifecycle = (t as Record<string, unknown>).lifecycleStatus as string | undefined;
    return lifecycle === "failed";
  });

  const confirmationTimes = confirmed
    .map((t) => {
      const record = t as Record<string, unknown>;
      const submittedAt = record.submittedAt as string | undefined;
      const terminalAt = record.terminalAt as string | undefined;
      return submittedAt && terminalAt ? new Date(terminalAt).getTime() - new Date(submittedAt).getTime() : undefined;
    })
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);

  const terminalTx = confirmed.length + failedTx.length;

  return {
    providers: {
      quote: {
        total: quoteTotal,
        stale: quoteStale,
        unavailable: quoteUnavailable,
        successRate: percent(quoteTotal - quoteStale - quoteUnavailable, quoteTotal),
        staleRate: percent(quoteStale, quoteTotal),
      },
      simulation: {
        total: simTotal,
        failed: simFailed,
        failureRate: percent(simFailed, simTotal),
      },
      latencyMs: {
        p50: percentile(allLatencies, 50),
        p95: percentile(allLatencies, 95),
        sampleSize: allLatencies.length,
      },
    },
    policy: {
      total: policyTotal,
      blocked: policyBlocked,
      blockRate: percent(policyBlocked, policyTotal),
    },
    approval: {
      total: approvalTotal,
      rejected: approvalRejected,
      rejectionRate: percent(approvalRejected, approvalTotal),
    },
    submission: {
      total: submissionTotal,
      failed: submissionFailed,
      failureRate: percent(submissionFailed, submissionTotal),
    },
    confirmation: {
      totalConfirmed: confirmed.length,
      totalFailed: failedTx.length,
      confirmationTimeMs: {
        p50: percentile(confirmationTimes, 50),
        p95: percentile(confirmationTimes, 95),
        sampleSize: confirmationTimes.length,
      },
      failureRate: percent(failedTx.length, terminalTx),
    },
    storage: {
      total: storageTotal,
      failed: storageFailed,
      failureRate: percent(storageFailed, storageTotal),
    },
    sample: {
      auditEventCount: listAuditEvents().length,
      transactionRecordCount: transactions.length,
      agentRunCount: agentRuns.length,
    },
  };
}

// Integrated with SLO requirements
