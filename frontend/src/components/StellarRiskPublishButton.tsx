"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Orbit, Shield, Hash, Fuel, Layers, Clock, FileText } from "lucide-react";
import { getStellarNetwork, normalizeStellarNetworkId } from "@/lib/stellar/config";
import { useStellarWallet } from "@/providers/StellarWalletProvider";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  verifyRiskPublicationPreview,
  type SigningVerificationIssue,
} from "@/lib/signing/previewVerification";
import { SigningVerificationWarning } from "@/components/SigningVerificationWarning";

type PublishStage = "idle" | "preview" | "simulating" | "preview_ready" | "signing" | "submitting" | "verifying" | "success" | "failed";

type PreviewData = {
  xdr: string;
  network: string;
  networkPassphrase: string;
  contractId: string;
  publisher: string;
  assetId: string;
  reportHash: string;
  expiresAt: number;
  fee: number;
  footprint: { readOnly: number; readWrite: number; hasRestoreEntry: boolean };
  simulationPassed: boolean;
  resourceUsage?: { instructions: number; readBytes: number; writeBytes: number };
  assetLabel: string;
  score: number;
  verdict: string;
};

type VerifyOutcome = {
  stage: string;
  hash: string;
  ledger?: number;
  events?: unknown[];
  onchainReportHash?: string;
  localReportHash?: string;
  hashMatch?: boolean;
  detail: string;
};

function shortHex(hex: string, chars = 8): string {
  return hex.length > chars * 2 + 3 ? hex.slice(0, chars) + "..." + hex.slice(-chars) : hex;
}

function toHashHex(value: string | undefined): string {
  return value?.toLowerCase().replace(/^sha256:/, "") ?? "";
}

export function StellarRiskPublishButton({
  network,
  assetKey,
  assetLabel,
  score,
  verdict,
  report,
  expectedHash,
}: {
  network?: string;
  assetKey?: string;
  assetLabel: string;
  score: number;
  verdict: string;
  report: unknown;
  /** Canonical snapshot hash to compare against the registry publication. */
  expectedHash?: string;
}) {
  const stellar = useStellarWallet();
  const { actionsDisabled } = useOnlineStatus();
  const networkId = normalizeStellarNetworkId(network);
  const config = getStellarNetwork(networkId ?? undefined);
  const [stage, setStage] = useState<PublishStage>("idle");
  const [error, setError] = useState<string>();
  const [verificationIssues, setVerificationIssues] = useState<SigningVerificationIssue[]>([]);
  const [preview, setPreview] = useState<PreviewData>();
  const [verifyOutcome, setVerifyOutcome] = useState<VerifyOutcome>();
  const [txHash, setTxHash] = useState<string>();
  const [verifyProgress, setVerifyProgress] = useState<string>("");
  const [now, setNow] = useState<number>(() => Date.now());

  // Refresh the clock periodically so expiry display updates
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(interval);
  }, []);

  if (!networkId || !assetKey || !config) return null;

  function checkPreview(data: PreviewData): SigningVerificationIssue[] {
    return verifyRiskPublicationPreview({
      preview: data,
      network: networkId,
      expectedPublisher: stellar.address ?? undefined,
      expectedContractId: config.registryContractId,
    }).issues.filter((issue) => issue.blocking);
  }

  async function startPreview() {
    if (actionsDisabled) return;
    if (!stellar.address) {
      await stellar.connect().catch(() => undefined);
      return;
    }
    if (stellar.network !== networkId) {
      setError("Wallet is on " + stellar.network + "; switch it to " + networkId + ".");
      setStage("failed");
      return;
    }

    try {
      setError(undefined);
      setVerificationIssues([]);
      setStage("simulating");
      const previewResponse = await fetch("/api/stellar/registry/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: networkId,
          publisher: stellar.address,
          assetKey,
          assetLabel,
          score,
          verdict,
          report,
          evidenceUri: "",
        }),
      });
      const data = await previewResponse.json() as PreviewData & { error?: string };
      if (!previewResponse.ok || !data.xdr) {
        throw new Error(data.error ?? "Could not prepare registry transaction preview.");
      }
      setVerificationIssues(checkPreview(data));
      setPreview(data);
      setStage("preview_ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to prepare preview.");
      setStage("failed");
    }
  }

  async function signAndSubmit() {
    if (actionsDisabled || !preview || !stellar.address) return;

    try {
      setError(undefined);

      // Decode and compare the XDR before the wallet is opened.
      const issues = checkPreview(preview);
      if (issues.length > 0) {
        setVerificationIssues(issues);
        setError("Signing blocked: the prepared XDR does not match the reviewed publication preview.");
        setStage("failed");
        return;
      }

      // Check if the preview has expired using the UI's refreshable clock.
      if (now > preview.expiresAt) {
        throw new Error("Preview has expired (prepared > 120s ago). Click 'Start preview' again.");
      }

      setVerificationIssues([]);
      setStage("signing");

      const signedXdr = await stellar.signTransaction(preview.xdr, networkId);
      setStage("submitting");

      const submitResponse = await fetch("/api/stellar/registry/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: networkId, signedXdr }),
      });
      const submitted = await submitResponse.json() as { hash?: string; status?: string; error?: string };
      if (!submitResponse.ok || !submitted.hash) {
        throw new Error(submitted.error ?? "Signed transaction could not be submitted.");
      }

      setTxHash(submitted.hash);
      setStage("verifying");
      setVerifyProgress("Waiting for network confirmation...");

      // Poll for verification
      const verifyResponse = await fetch("/api/stellar/registry/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: networkId,
          hash: submitted.hash,
          localReportHash: preview.reportHash,
          assetKey,
        }),
      });
      const outcome = await verifyResponse.json() as VerifyOutcome & { ok?: boolean; error?: string };
      if (!verifyResponse.ok) {
        throw new Error(outcome.error ?? "Verification failed.");
      }

      setVerifyOutcome(outcome);

      if (outcome.stage === "success") {
        setStage("success");
      } else if (outcome.stage === "failed") {
        setError(outcome.detail);
        setStage("failed");
      } else {
        setVerifyProgress(outcome.detail);
        setStage("failed");
      }

      // Record in history (fire and forget)
      fetch("/api/stellar/registry/history", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }).catch(() => undefined);

    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Risk publication failed.");
      setStage("failed");
    }
  }

  const showStartButton = stage === "idle" || stage === "failed";
  const isSimulating = stage === "simulating";
  const previewExpired = preview && now > preview.expiresAt;
  const isTestnet = networkId.includes("testnet");
  const expectedHashHex = toHashHex(expectedHash);
  const snapshotMatchesPayload = Boolean(expectedHashHex && preview && expectedHashHex === preview.reportHash.toLowerCase());
  const snapshotMatchesOnChain = Boolean(expectedHashHex && verifyOutcome?.onchainReportHash
    && expectedHashHex === toHashHex(verifyOutcome.onchainReportHash));

  // Determine current active step (1-4)
  const currentStep =
    stage === "idle" ? 1 :
    stage === "simulating" || stage === "preview_ready" ? 1 :
    stage === "signing" ? 2 :
    stage === "submitting" ? 3 :
    4;

  const steps = [
    { num: 1, label: "Preview Payload" },
    { num: 2, label: "Sign in Wallet" },
    { num: 3, label: "Submit to Soroban" },
    { num: 4, label: "Verify On-Chain Hash" },
  ];

  return (
    <div className="mt-4 space-y-4">
      {/* 4-Step Stepper Header */}
      <div className="rounded-xl border border-white/10 bg-black/40 p-3">
        <div className="grid grid-cols-4 gap-2">
          {steps.map((s) => {
            const isDone = currentStep > s.num || stage === "success";
            const isActive = currentStep === s.num && stage !== "success";

            return (
              <div key={s.num} className="flex flex-col items-center text-center">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition ${
                    isDone
                      ? "bg-emerald-500 text-black"
                      : isActive
                      ? "bg-[#d9a441] text-black ring-2 ring-[#d9a441]/40"
                      : "border border-white/20 bg-white/5 text-white/40"
                  }`}
                >
                  {isDone ? "✓" : s.num}
                </div>
                <span
                  className={`mt-1 text-[10px] font-medium leading-tight ${
                    isDone
                      ? "text-emerald-300"
                      : isActive
                      ? "text-[#f2c86d]"
                      : "text-white/40"
                  }`}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Link href="/insights/storage-lifetime" className="inline-flex rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:text-white">
          Inspect contract storage lifetime
        </Link>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
            isTestnet
              ? "border border-amber-400/40 bg-amber-400/15 text-amber-300"
              : "border border-purple-400/40 bg-purple-400/15 text-purple-200"
          }`}
        >
          {isTestnet ? "Stellar Testnet" : "Stellar Pubnet"}
        </span>
      </div>
      {/* Preview button */}
      {showStartButton && (
        <button
          type="button"
          onClick={() => void startPreview()}
          disabled={isSimulating || actionsDisabled}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#a99aff]/35 bg-[#7b61ff]/12 px-5 text-sm font-semibold text-white transition hover:bg-[#7b61ff]/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSimulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Orbit className="h-4 w-4 text-[#a99aff]" />}
          {stellar.address ? "Start preview" : "Connect Stellar wallet"}
        </button>
      )}

      {/* Simulating state */}
      {stage === "simulating" && (
        <div className="flex items-center gap-2 text-sm text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          Simulating transaction and preparing preview...
        </div>
      )}

      {/* Preview panel */}
      {stage === "preview_ready" && preview && (
        <div className="rounded-lg border border-[#d9a441]/25 bg-[#d9a441]/8 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#f2c86d]">
            <Shield className="h-4 w-4" />
            Publication preview
          </div>

          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="text-white/60">Asset ID</span>
              <span className="font-mono text-xs text-white" title={preview.assetId || assetKey}>{preview.assetId || assetKey}</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="text-white/60">Asset Label</span>
              <span className="font-mono text-white">{preview.assetLabel}</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="text-white/60">Score / Confidence</span>
              <span className="font-mono text-white">{preview.score}/100 · 9500 bps (95%)</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="text-white/60">Verdict</span>
              <span className="font-mono text-white uppercase text-emerald-300 font-semibold">{preview.verdict}</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="flex items-center gap-1 text-white/60"><Hash className="h-3 w-3" /> Report hash</span>
              <span className="font-mono text-xs text-white/80" title={preview.reportHash}>{shortHex(preview.reportHash, 8)}</span>
            </div>
            {expectedHash ? (
              <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
                <span className="flex items-center gap-1 text-white/60"><Hash className="h-3 w-3" /> Snapshot hash</span>
                <span className={`text-xs font-semibold ${snapshotMatchesPayload ? "text-emerald-300" : "text-amber-300"}`}>
                  {snapshotMatchesPayload ? "Matches payload" : "Payload differs"}
                  <span className="ml-2 font-mono font-normal text-white/60" title={expectedHash}>{shortHex(expectedHashHex, 6)}</span>
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="flex items-center gap-1 text-white/60"><Fuel className="h-3 w-3" /> Fee</span>
              <span className="font-mono text-white">{preview.fee} stroops</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="flex items-center gap-1 text-white/60"><Layers className="h-3 w-3" /> Footprint</span>
              <span className="font-mono text-white">{preview.footprint.readOnly} read-only, {preview.footprint.readWrite} read-write{preview.footprint.hasRestoreEntry ? " + restore" : ""}</span>
            </div>
            {preview.resourceUsage && (
              <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
                <span className="flex items-center gap-1 text-white/60"><FileText className="h-3 w-3" /> Resources</span>
                <span className="font-mono text-xs text-white/80">
                  {preview.resourceUsage.instructions.toLocaleString()} instr, {preview.resourceUsage.readBytes.toLocaleString()}B read, {preview.resourceUsage.writeBytes.toLocaleString()}B write
                </span>
              </div>
            )}
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="flex items-center gap-1 text-white/60"><Clock className="h-3 w-3" /> Expiry</span>
              <span className="font-mono text-xs text-white/80">
                {previewExpired ? "EXPIRED" : new Date(preview.expiresAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="text-white/60">Contract</span>
              <span className="font-mono text-xs text-white/80" title={preview.contractId}>{shortHex(preview.contractId, 6)}</span>
            </div>
          </div>

          {verificationIssues.length > 0 ? (
            <SigningVerificationWarning
              issues={verificationIssues}
              onRefresh={() => void startPreview()}
              refreshLabel="Re-prepare Publication Preview"
            />
          ) : null}

          {previewExpired ? (
            <div className="flex items-center gap-2 rounded-md bg-red-900/20 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Preview expired. Click &quot;Start preview&quot; again to get a fresh preview.
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signAndSubmit()}
              disabled={actionsDisabled || verificationIssues.length > 0}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#7b61ff] px-5 text-sm font-semibold text-white transition hover:bg-[#7b61ff]/80"
            >
              Sign with wallet &amp; submit
            </button>
          )}
        </div>
      )}

      {/* Signing / submitting / verifying states */}
      {["signing", "submitting", "verifying"].includes(stage) && (
        <div className="rounded-lg border border-[#d9a441]/25 bg-[#d9a441]/8 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" />
            {stage === "signing" ? "Waiting for wallet signature..." :
             stage === "submitting" ? "Submitting to Stellar network..." :
             "Verifying onchain: " + (verifyProgress || "checking...")}
          </div>
          {txHash && (
            <div className="flex items-center gap-1 text-xs text-[#a99aff]">
              <ExternalLink className="h-3 w-3" />
              <a href={config.explorerUrl + "/tx/" + txHash} target="_blank" rel="noreferrer" className="hover:underline">
                View on {config.name} explorer
              </a>
            </div>
          )}
        </div>
      )}

      {/* Success state */}
      {stage === "success" && verifyOutcome && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Published on Stellar {networkId === "stellar-pubnet" ? "Pubnet" : "Testnet"}
          </div>

          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
              <span className="text-white/60">Hash match</span>
              <span className={verifyOutcome.hashMatch === true ? "text-emerald-300" : verifyOutcome.hashMatch === false ? "text-red-300" : "text-white/60"}>
                {verifyOutcome.hashMatch === true ? "Verified" : verifyOutcome.hashMatch === false ? "MISMATCH" : "Could not verify"}
              </span>
            </div>
            {expectedHash ? (
              <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
                <span className="text-white/60">Snapshot hash on-chain</span>
                <span className={verifyOutcome.onchainReportHash ? (snapshotMatchesOnChain ? "text-emerald-300" : "text-red-300") : "text-white/60"}>
                  {!verifyOutcome.onchainReportHash ? "Not returned" : snapshotMatchesOnChain ? "Verified" : "MISMATCH"}
                </span>
              </div>
            ) : null}
            {verifyOutcome.ledger && (
              <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
                <span className="text-white/60">Ledger</span>
                <span className="font-mono text-white">{verifyOutcome.ledger}</span>
              </div>
            )}
            {verifyOutcome.events && verifyOutcome.events.length > 0 && (
              <div className="flex items-center justify-between rounded-md bg-black/24 px-3 py-2">
                <span className="text-white/60">Events emitted</span>
                <span className="font-mono text-white">{verifyOutcome.events.length}</span>
              </div>
            )}
          </div>

          <div className="text-xs text-white/52 leading-relaxed">
            {verifyOutcome.detail}
          </div>

          {txHash && (
            <a
              href={config.explorerUrl + "/tx/" + txHash}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#a99aff] hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              View transaction on Stellar explorer
            </a>
          )}

          {verifyOutcome.hashMatch === false && (
            <div className="flex items-start gap-2 rounded-lg border-2 border-red-500 bg-red-950/80 p-4 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div className="space-y-1">
                <span className="font-bold text-red-100">
                  CRITICAL INTEGRITY MISMATCH: On-chain hash does not match local report payload!
                </span>
                <p>
                  Expected hash <code className="font-mono bg-black/40 px-1">{shortHex(verifyOutcome.localReportHash ?? "", 8)}</code>,
                  but registry ledger returned <code className="font-mono bg-black/40 px-1">{shortHex(verifyOutcome.onchainReportHash ?? "", 8)}</code>.
                </p>
                <p className="text-white/70">
                  <strong>Remediation:</strong> Do not rely on this on-chain record for automated execution. Check Soroban TTL diagnostics, re-canonicalize report JSON, and republish.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {stage === "failed" && error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-900/15 p-3 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <div className="leading-relaxed">{error}</div>
        </div>
      )}

      {/* Error from old flow */}
      {error && !["failed", "idle"].includes(stage) && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-900/15 p-3 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <div className="leading-relaxed">{error}</div>
        </div>
      )}
    </div>
  );
}
