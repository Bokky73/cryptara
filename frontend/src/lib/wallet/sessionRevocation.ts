/**
 * Coordinates the server-side wallet session with wallet identity changes.
 *
 * The session is a single HttpOnly cookie, so every challenge and revocation in
 * the tab has to be ordered against every other one. The epoch increments on
 * each revocation; work started under an older epoch must not establish a
 * session.
 */

let epoch = 0;
let pendingRevocation: Promise<void> = Promise.resolve();
let challengeQueue: Promise<void> = Promise.resolve();

export function getSessionEpoch() {
  return epoch;
}

async function deleteServerSession() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/wallet-session", {
        method: "DELETE",
        credentials: "include",
        keepalive: true,
      });
      if (response.ok) return;
    } catch {
      // Retried once; the epoch already prevents reuse within this tab.
    }
  }
}

/** Invalidate in-flight challenges immediately and clear the session cookie. */
export function revokeWalletSession(): Promise<void> {
  epoch += 1;
  pendingRevocation = pendingRevocation.then(deleteServerSession);
  return pendingRevocation;
}

/** Remove a cookie minted by a claim that lost a race with a revocation. */
export function discardStaleSession(): Promise<void> {
  pendingRevocation = pendingRevocation.then(deleteServerSession);
  return pendingRevocation;
}

/** Run one challenge at a time, only after outstanding revocations settle. */
export function enqueueChallenge(task: () => Promise<void>): Promise<void> {
  const run = challengeQueue.then(() => pendingRevocation).then(task);
  challengeQueue = run.catch(() => undefined);
  return run;
}
