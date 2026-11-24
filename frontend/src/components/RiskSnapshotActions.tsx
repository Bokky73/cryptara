"use client";

import { AlertTriangle, Check, CheckCircle2, Copy, Download, FileLock2, Loader2, ShieldX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { RiskSnapshotDocument } from "@/server/snapshots/schema";
import type { RiskSnapshotCreateResponse, TokenScanResult } from "@/server/types";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { hashRiskSnapshotInBrowser } from "@/lib/snapshots/clientHash";

type HashVerification =
  | { status: "verifying" }
  | { status: "verified"; computed: string }
  | { status: "mismatch"; computed: string }
  | { status: "unavailable"; detail: string };

type Props = {
  source?: TokenScanResult;
  snapshotId?: string;
  shareUrl?: string;
  downloadUrl?: string;
  /** The public document rendered on this page, used for in-browser hashing. */
  document?: RiskSnapshotDocument;
  /** Canonical hash stored with the snapshot (the value published on-chain). */
  expectedHash?: string;
  /** Both snapshot ids needed to seed the side-by-side comparison view. */
  comparisonIds?: { left: string; right: string };
};

export function RiskSnapshotActions({ source, snapshotId, shareUrl, downloadUrl, document, expectedHash, comparisonIds }: Props) {
  const [created, setCreated] = useState<RiskSnapshotCreateResponse>();
  const [busy, setBusy] = useState<"create" | "revoke">();
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [verification, setVerification] = useState<HashVerification | undefined>();
  const { actionsDisabled } = useOnlineStatus();
  const activeId = created?.id ?? snapshotId;
  const activeShareUrl = created?.shareUrl ?? shareUrl ?? (activeId ? `/snapshots/${activeId}` : undefined);
  const activeDownloadUrl = created?.downloadUrl ?? downloadUrl ?? (activeId ? `/api/snapshots/${activeId}?download=1` : undefined);

  useEffect(() => {
    if (!document || !expectedHash) return;
    let cancelled = false;
    setVerification({ status: "verifying" });
    hashRiskSnapshotInBrowser(document)
      .then((computed) => {
        if (cancelled) return;
        setVerification(computed === expectedHash
          ? { status: "verified", computed }
          : { status: "mismatch", computed });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setVerification({
          status: "unavailable",
          detail: cause instanceof Error ? cause.message : "Web Crypto verification is unavailable.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [document, expectedHash]);

  async function createSnapshot() {
    if (actionsDisabled || !source) return;
    setBusy("create");
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: source }),
      });
      const body = await response.json() as RiskSnapshotCreateResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Snapshot could not be created.");
      setCreated(body);
      setMessage("Snapshot created. Save the revocation token before leaving this page.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Snapshot could not be created.");
    } finally {
      setBusy(undefined);
    }
  }

  async function copyRevocationToken() {
    if (!created?.revocationToken) return;
    try {
      await navigator.clipboard.writeText(created.revocationToken);
      setTokenCopied(true);
      setMessage("Revocation token copied. Store it securely; it cannot be shown again after this page is closed.");
      window.setTimeout(() => setTokenCopied(false), 2_000);
    } catch {
      setError("The revocation token could not be copied.");
    }
  }

  async function copyShareLink() {
    if (!activeShareUrl) return;
    try {
      await navigator.clipboard.writeText(new URL(activeShareUrl, window.location.origin).toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("The share link could not be copied. Open it and copy the browser address instead.");
    }
  }

  async function revokeSnapshot() {
    if (actionsDisabled || !created?.revocationToken) return;
    setBusy("revoke");
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/snapshots/${created.id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revocationToken: created.revocationToken }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Snapshot could not be revoked.");
      }
      setCreated(undefined);
      setMessage("Snapshot revoked. Its public report now fails closed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Snapshot could not be revoked.");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {source && !created ? (
          <button type="button" onClick={() => void createSnapshot()} disabled={Boolean(busy) || actionsDisabled} className="inline-flex h-11 items-center gap-2 rounded-full border border-[#d9a441]/40 px-5 text-sm font-semibold text-[#f2c86d] transition hover:bg-[#d9a441]/10 disabled:opacity-50">
            {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileLock2 className="h-4 w-4" />}
            Create private-safe snapshot
          </button>
        ) : null}
        {activeShareUrl ? (
          <button type="button" onClick={() => void copyShareLink()} className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 px-5 text-sm font-semibold text-white/80 transition hover:bg-white/8">
            {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy share link"}
          </button>
        ) : null}
        {activeDownloadUrl ? (
          <a href={activeDownloadUrl} className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 px-5 text-sm font-semibold text-white/80 transition hover:bg-white/8">
            <Download className="h-4 w-4" /> Download JSON
          </a>
        ) : null}
        {created?.revocationToken ? (
          <button type="button" onClick={() => void copyRevocationToken()} className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 px-5 text-sm font-semibold text-white/80 transition hover:bg-white/8">
            {tokenCopied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
            {tokenCopied ? "Token copied" : "Copy revoke token"}
          </button>
        ) : null}
        {created?.revocationToken ? (
          <button type="button" onClick={() => void revokeSnapshot()} disabled={Boolean(busy) || actionsDisabled} className="inline-flex h-11 items-center gap-2 rounded-full border border-red-300/25 px-5 text-sm font-semibold text-red-200 transition hover:bg-red-400/10 disabled:opacity-50">
            {busy === "revoke" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
            Revoke
          </button>
        ) : null}
      </div>
      {verification ? (
        <div role="status" aria-live="polite" className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${
            verification.status === "verified"
              ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
              : verification.status === "mismatch"
                ? "border-red-300/35 bg-red-400/10 text-red-200"
                : "border-white/15 bg-white/5 text-white/60"
          }`}>
            {verification.status === "verifying" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : verification.status === "verified" ? <CheckCircle2 className="h-3.5 w-3.5" />
              : verification.status === "mismatch" ? <ShieldX className="h-3.5 w-3.5" />
              : <AlertTriangle className="h-3.5 w-3.5" />}
            {verification.status === "verifying" ? "Verifying hash in browser…"
              : verification.status === "verified" ? "Canonical hash verified"
              : verification.status === "mismatch" ? "Hash mismatch"
              : "Verification unavailable"}
          </span>
          {verification.status === "verified" || verification.status === "mismatch" ? (
            <span className="break-all font-mono text-white/45">{verification.computed}</span>
          ) : null}
          {verification.status === "unavailable" ? (
            <span className="text-white/50">{verification.detail}</span>
          ) : null}
        </div>
      ) : null}
      {activeId ? (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
          {comparisonIds ? (
            <Link
              href={`/insights/report-comparison?left=${encodeURIComponent(comparisonIds.left)}&right=${encodeURIComponent(comparisonIds.right)}`}
              className="underline underline-offset-2 hover:text-white"
            >
              Compare with latest scan
            </Link>
          ) : null}
          <Link
            href={`/insights/report-comparison?right=${encodeURIComponent(activeId)}`}
            className="underline underline-offset-2 hover:text-white"
          >
            {comparisonIds ? "Compare with another snapshot" : "Compare this snapshot with an earlier one"}
          </Link>
        </p>
      ) : null}
      {created ? <p className="mt-3 break-all text-xs text-white/48">Hash: {created.hash}</p> : null}
      <p className="mt-3 text-xs leading-5 text-white/42">Snapshots exclude wallet, strategy, transaction-plan, internal-note, and provider-secret fields by default.</p>
      <div aria-live="polite" className={`mt-2 text-sm ${error ? "text-red-200" : "text-emerald-200"}`}>{error ?? message}</div>
    </div>
  );
}
