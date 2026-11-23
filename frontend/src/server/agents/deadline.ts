export const DEFAULT_RUN_TIMEOUT_MS = 30_000;
export class AgentDeadlineError extends Error {
  constructor() { super("Agent run deadline exhausted; no complete signal is available."); this.name = "AgentDeadlineError"; }
}
export function createRunDeadline(timeoutMs = DEFAULT_RUN_TIMEOUT_MS): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new RangeError("Invalid agent run timeout");
  return performance.now() + timeoutMs;
}
export async function withinAgentDeadline<T>(deadline: number, timeoutMs: number, task: (signal: AbortSignal, remainingMs: number) => Promise<T>): Promise<T> {
  const remainingMs = Math.min(timeoutMs, deadline - performance.now());
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) throw new AgentDeadlineError();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new AgentDeadlineError()); controller.abort(); }, remainingMs);
    });
    const result = await Promise.race([task(controller.signal, remainingMs), timeout]);
    if (performance.now() >= deadline) throw new AgentDeadlineError();
    return result;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * Derive the per-call budget (in ms) from the remaining orchestration deadline,
 * capped at `capMs`. Returns 0 when the deadline is already exhausted or inputs
 * are invalid, so callers can short-circuit without duplicating the math.
 */
export function remainingBudgetMs(deadline: number, capMs: number): number {
  if (!Number.isFinite(deadline) || !Number.isFinite(capMs) || capMs <= 0) return 0;
  const remaining = deadline - performance.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.min(capMs, remaining);
}

/**
 * Run `fn` with a strict AbortController budget derived from the remaining
 * orchestration deadline (capped at `capMs`). The signal aborts when the budget
 * elapses; the returned promise rejects with `AgentDeadlineError` if the budget
 * is already exhausted or the task outlives the budget.
 */
export async function withDeadlineSignal<T>(
  deadline: number,
  capMs: number,
  fn: (signal: AbortSignal, budgetMs: number) => Promise<T>,
): Promise<T> {
  const budgetMs = remainingBudgetMs(deadline, capMs);
  if (budgetMs <= 0) throw new AgentDeadlineError();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new AgentDeadlineError()); controller.abort(); }, budgetMs);
    });
    return await Promise.race([fn(controller.signal, budgetMs), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}