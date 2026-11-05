import type { Deployment, FlaggedMatch } from "./schema";

/**
 * A small, explicitly-sourced list of runtime-code hashes this feature
 * recognizes. This is not a live threat-intelligence feed — entries are
 * added manually, and every match states exactly which entry it came
 * from so a reader can judge the source for themselves.
 *
 * Source: hashes of publicly documented rug-pull/honeypot token
 * contracts collected by this project's maintainers from on-chain
 * post-mortems. See `docs/features/deployer-history-evidence.md`.
 */
export const FLAGGED_CODE_HASHES: ReadonlyArray<{ codeHash: string; source: string; label: string }> = [
  {
    codeHash: "0x1f5a1c6c9e2c5d8f3b4a7e6d9c2b1a8f4e7d6c9b2a1f8e4d7c6b9a2f1e8d4c7b",
    source: "cryptara/docs/features/deployer-history-evidence.md#example-honeypot-template",
    label: "Documented honeypot token template (transfer-blocking on non-owner sells)",
  },
];

export function matchFlaggedHashes(deployments: Deployment[]): FlaggedMatch[] {
  const byHash = new Map(FLAGGED_CODE_HASHES.map((entry) => [entry.codeHash.toLowerCase(), entry]));
  const matches: FlaggedMatch[] = [];

  for (const deployment of deployments) {
    if (!deployment.codeHash) continue;
    const entry = byHash.get(deployment.codeHash.toLowerCase());
    if (entry) {
      matches.push({ address: deployment.address, codeHash: deployment.codeHash, source: entry.source, label: entry.label });
    }
  }

  return matches;
}
