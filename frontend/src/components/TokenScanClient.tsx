"use client";

import { AlertCircle, CheckCircle2, CreditCard, Lock, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import type { RiskReportVerdict, ScoreFactor, TokenScanResult, TransactionPreview } from "@/server/types";
import { NoDataState } from "@/components/NoDataState";
import { RiskBreakdownCard } from "@/components/RiskBreakdownCard";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { StellarRiskPublishButton } from "@/components/StellarRiskPublishButton";
import { LiveRegion } from "@/components/a11y/LiveRegion";
import { RiskSnapshotActions } from "@/components/RiskSnapshotActions";
import { captureOfflineScan } from "@/lib/offlineStore";
import { recordScannedAsset } from "@/lib/commandPalette/persistedRecents";
import { detectScanTarget } from "@/lib/commandPalette/scanTarget";
import { buildX402Fingerprint, hashX402PaymentHeader, type X402ReceiptEntry } from "@/lib/x402ReceiptStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useX402PaymentReceipts } from "@/hooks/useSigning";

const paymentStatusLabels: Record<PaymentStage, { title: string; detail: string }> = {
  idle: {
    title: "Payment required",
    detail: "Detailed Scan starts the x402 payment first. The premium report is generated only after payment verification.",
  },
  wallet_required: {
    title: "Connect wallet",
    detail: "Connect an EVM wallet to sign the x402 payment and run the scan.",
  },
  requesting: {
    title: "Preparing payment",
    detail: "Fetching the x402 payment requirement for this detailed scan.",
  },
  payment_required: {
    title: "Payment required",
    detail: "The API returned HTTP 402. Your wallet will sign the x402 payment next.",
  },
  signing: {
    title: "Sign payment",
    detail: "Confirm the typed-data signature in your wallet. The detailed scan will start after verification.",
  },
  verifying: {
    title: "Verifying payment",
    detail: "Submitting the signed payment to the protected detailed scan endpoint.",
  },
  verified: {
    title: "Payment verified",
    detail: "Payment was accepted and the AI Risk Report is unlocked.",
  },
  failed: {
    title: "Payment failed",
    detail: "Payment could not be completed. Check wallet/network state and retry.",
  },
};
const chains = [
  { value: "base", label: "Base" },
  { value: "goat", label: "GOAT" },
  { value: "bsc", label: "BNB" },
  { value: "ethereum", label: "Ethereum" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "polygon", label: "Polygon" },
  { value: "optimism", label: "Optimism" },
  { value: "stellar-testnet", label: "Stellar" },
  { value: "stellar-pubnet", label: "Stellar Pubnet" },
  { value: "solana", label: "Solana later", disabled: true },
];

type PaymentStage = "idle" | "wallet_required" | "requesting" | "payment_required" | "signing" | "verifying" | "verified" | "failed";
type PaymentTerms = {
  priceUsd: string;
  network: string;
  asset: string;
  payTo: string;
  available: boolean;
};

function shortenAddress(value?: string) {
  if (!value || value.length < 12) return value ?? "Shown before signature";

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatUsd(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1 ? 0 : 6,
  });
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function verdictLabel(verdict?: RiskReportVerdict) {
  if (!verdict) return "Manual review";

  return verdict.replaceAll("_", " ");
}

function riskTone(score: number) {
  if (score >= 75) return "risk-tone-critical";
  if (score >= 50) return "risk-tone-high";
  if (score >= 25) return "risk-tone-medium";
  return "risk-tone-low";
}

function riskLevelLabel(score: number) {
  if (score >= 75) return "Critical risk";
  if (score >= 50) return "High risk";
  if (score >= 25) return "Medium risk";
  return "Low risk";
}

function factorTone(factor: ScoreFactor) {
  if (factor.severity === "critical") return "risk-tone-critical";
  if (factor.severity === "high") return "risk-tone-high";
  if (factor.direction === "risk_decrease") return "risk-tone-low";
  return "border-[var(--color-border)] bg-[var(--color-glass-bg)] text-muted";
}

function formatMetaValue(value: string | number | boolean | null | undefined) {
  if (value === undefined || value === null || value === "") return "N/A";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(2);

  return value;
}

function factorMetaEntries(factor: ScoreFactor) {
  return Object.entries(factor.meta ?? {})
    .filter(([, value]) => value !== undefined)
    .slice(0, 4);
}

function buildX402RequestPayload(query: string, chain: string, walletAddress: string) {
  const payload = { query: query.trim(), chain };
  if (walletAddress.trim()) {
    return { ...payload, walletAddress: walletAddress.trim() };
  }
  return payload;
}

function buildDeepScanUrl(query: string, chain: string, walletAddress: string) {
  const payload = buildX402RequestPayload(query, chain, walletAddress);
  const params = new URLSearchParams({ query: payload.query, chain: payload.chain });
  if (payload.walletAddress) {
    params.set("walletAddress", payload.walletAddress);
  }

  return `/api/x402/deep-scan?${params.toString()}`;
}

function getPaymentOption(paymentRequirement: PaymentRequired | null) {
  const option = paymentRequirement?.accepts[0];

  if (!option) {
    return null;
  }

  const optionRecord = option as unknown as Record<string, string>;
  const amount = optionRecord.amount ?? optionRecord.maxAmountRequired;

  return {
    amount,
    asset: optionRecord.asset,
    network: optionRecord.network,
    payTo: optionRecord.payTo,
  };
}

function getPaymentChainId(paymentRequirement: PaymentRequired | null) {
  const network = getPaymentOption(paymentRequirement)?.network;

  if (!network?.startsWith("eip155:")) {
    return null;
  }

  const chainId = Number(network.replace("eip155:", ""));
  return Number.isInteger(chainId) ? chainId : null;
}

const SAMPLE_TOKENS = [
  { label: "USDC (Ethereum)", chain: "ethereum", query: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", tag: "EVM Bluechip" },
  { label: "AERO (Base)", chain: "base", query: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", tag: "Base DEX" },
  { label: "XLM (Stellar)", chain: "stellar-testnet", query: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", tag: "Stellar Classic" },
  { label: "Risky MEME (Demo)", chain: "base", query: "MEME", tag: "High Risk" },
];

export function TokenScanClient({ initialQuery = "MEME", initialChain, autoRun = false }: { initialQuery?: string; initialChain?: string; autoRun?: boolean }) {
  const queryErrorId = useId();
  const paymentModalTitleId = useId();
  const paymentModalRef = useRef<HTMLButtonElement>(null);
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [query, setQuery] = useState(initialQuery || "MEME");
  const [chain, setChain] = useState(() => chains.some((item) => item.value === initialChain && !item.disabled) ? initialChain! : "base");
  const [walletAddress, setWalletAddress] = useState("");
  const [scan, setScan] = useState<TokenScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [premiumStatus, setPremiumStatus] = useState<PaymentStage>("idle");
  const [premiumDetail, setPremiumDetail] = useState<string | null>(null);
  const [paymentRequirement, setPaymentRequirement] = useState<PaymentRequired | null>(null);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms | null>(null);
  const [isPreparingPremium, setIsPreparingPremium] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [resumeCandidate, setResumeCandidate] = useState<X402ReceiptEntry | null>(null);
  const [dismissedReceiptHash, setDismissedReceiptHash] = useState<string | null>(null);
  const receipts = useX402PaymentReceipts();
  const { actionsDisabled } = useOnlineStatus();
  const report = scan?.riskReport;
  const normalizedInput = report?.input ?? scan?.normalizedInput;
  const executionPreview = report?.executionPreview as TransactionPreview | undefined;
  const decisionCard = report?.agentCards.find((card) => card.agent === "decision");
  const whatWouldChange = decisionCard?.factors.find((factor) => factor.label === "What would change this decision");
  const paymentOption = getPaymentOption(paymentRequirement);
  const isPaymentWorking = premiumStatus === "requesting" || premiumStatus === "signing" || premiumStatus === "verifying" || isPreparingPremium;
  const isBusy = isScanning || isPaymentWorking;
  const showPaymentPanel = premiumStatus !== "idle";
  const statusMessage = scanError
    ? scanError
    : isScanning
      ? "Analyzing token risk…"
      : isPaymentWorking
        ? premiumDetail ?? paymentStatusLabels[premiumStatus].detail
        : scan
          ? `Scan complete. ${scan.symbol} risk ${scan.overallRiskScore} out of 100.`
          : null;

  useEffect(() => {
    let active = true;

    fetch("/api/x402/terms", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? (response.json() as Promise<PaymentTerms>) : null))
      .then((terms) => {
        if (active && terms) setPaymentTerms(terms);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  // A refresh or a new visit with the same payload automatically offers the
  // stored receipt instead of asking the user to sign (and pay) again.
  useEffect(() => {
    let active = true;
    const payload = buildX402RequestPayload(query, chain, walletAddress);
    if (!payload.query || scan) {
      setResumeCandidate(null);
      return;
    }

    buildX402Fingerprint(payload)
      .then((fingerprint) => receipts.findReceipt(fingerprint))
      .then((entry) => {
        if (active) setResumeCandidate(entry && entry.paymentHeaderHash !== dismissedReceiptHash ? entry : null);
      })
      .catch(() => {
        if (active) setResumeCandidate(null);
      });

    return () => {
      active = false;
    };
  }, [query, chain, walletAddress, scan, dismissedReceiptHash, receipts]);

  useEffect(() => {
    if (!showPaymentModal) return;
    paymentModalRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowPaymentModal(false);
        setPremiumStatus("idle");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showPaymentModal]);

  // Palette "Run AI Risk Scan" handoff. Only the free scan auto-runs; paid scans always need a click.
  // The run marker is dropped so a refresh does not scan again.
  useEffect(() => {
    if (!autoRun) return;
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("run");
      window.history.replaceState(null, "", url);
      void runScan();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  async function runScan() {
    if (actionsDisabled) return;
    setIsScanning(true);
    setScanError(null);
    setPremiumStatus("idle");
    setPremiumDetail(null);
    setPaymentRequirement(null);

    try {
      const response = await fetch("/api/scan/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, chain, walletAddress: walletAddress.trim() || undefined }),
      });

      if (!response.ok) {
        throw new Error("Free trial scan failed. Check the input and try again.");
      }

      const data = (await response.json()) as TokenScanResult;
      setScan(data);
      captureOfflineScan(data, "free token scan");
      const target = detectScanTarget(query, null);
      if (target) recordScannedAsset({ query: target.query, chain });
    } catch (error) {
      setScan(null);
      setScanError(error instanceof Error ? error.message : "Free trial scan failed.");
    } finally {
      setIsScanning(false);
    }
  }

  function createEvmHttpClient() {
    if (!walletClient || !address) throw new Error("Connect an EVM wallet first.");

    const protocolClient = new x402Client();
    const signer = toClientEvmSigner(
      {
        address: address as `0x${string}`,
        signTypedData: (message) =>
          walletClient.signTypedData({
            account: address as `0x${string}`,
            domain: message.domain,
            types: message.types,
            primaryType: message.primaryType,
            message: message.message,
          }),
      },
      publicClient,
    );
    registerExactEvmScheme(protocolClient, { signer });
    return new x402HTTPClient(protocolClient);
  }

  async function runDetailedScan() {
    if (actionsDisabled) return;
    setScanError(null);
    setPremiumDetail(null);

    if (!query.trim()) {
      setPremiumStatus("failed");
      setScanError("Enter a contract address, token symbol, or DexScreener URL before starting detailed scan payment.");
      return;
    }

    if (!isConnected || !walletClient || !address) {
      setScan(null);
      setPremiumStatus("wallet_required");
      setPremiumDetail("Connect your wallet, then press Continue detailed scan to sign the x402 payment.");
      return;
    }

    setScan(null);
    setPaymentRequirement(null);
    setIsPreparingPremium(true);
    setIsScanning(false);
    setPremiumStatus("requesting");
    setPremiumDetail("Requesting x402 payment terms from the protected detailed scan endpoint.");

    try {
      const url = buildDeepScanUrl(query, chain, walletAddress);
      const httpClient = createEvmHttpClient();
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (response.status === 402) {
        const body = (await response.json().catch(() => null)) as unknown;
        const required = httpClient.getPaymentRequiredResponse((name) => response.headers.get(name), body);
        if (!required) {
          throw new Error("The server did not return valid x402 payment requirements.");
        }
        setPaymentRequirement(required);
        setPremiumStatus("payment_required");
        setPremiumDetail("Review the exact x402 payment details before your wallet signs anything.");

        const fingerprint = await buildX402Fingerprint(buildX402RequestPayload(query, chain, walletAddress));
        const existing = await receipts.findReceipt(fingerprint);
        setResumeCandidate(existing && existing.paymentHeaderHash !== dismissedReceiptHash ? existing : null);
        setShowPaymentModal(true);
        return;
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { detail?: string; error?: string } | null;
        throw new Error(data?.detail ?? data?.error ?? "Detailed scan request failed.");
      }

      const data = (await response.json()) as { premium?: { receiptId?: string; note?: string }; scan?: TokenScanResult };

      if (!data.scan) {
        throw new Error("Scan completed without a report payload.");
      }

      setScan(data.scan);
      captureOfflineScan(data.scan, "paid detailed scan");
      setPremiumStatus("verified");
      setPremiumDetail(`Payment verified. Receipt: ${data.premium?.receiptId ?? "recorded"}.`);
    } catch (error) {
      setScan(null);
      setPremiumStatus("failed");
      setScanError(error instanceof Error ? error.message : "Scan failed.");
      setPremiumDetail(error instanceof Error ? error.message : "Payment or scan failed.");
    } finally {
      setIsScanning(false);
      setIsPreparingPremium(false);
    }
  }

  async function signAndSubmitPayment(required: PaymentRequired) {
    setShowPaymentModal(false);
    setScanError(null);
    setPremiumDetail(null);
    setScan(null);
    setIsPreparingPremium(true);
    setPremiumStatus("signing");
    setPremiumDetail("Wallet signature is open. Sign the x402 payment authorization.");

    try {
      const httpClient = createEvmHttpClient();
      const url = buildDeepScanUrl(query, chain, walletAddress);
      const requiredChainId = getPaymentChainId(required);

      if (requiredChainId && chainId !== requiredChainId) {
        setPremiumDetail(`Switching wallet network to eip155:${requiredChainId} for x402 payment.`);
        await switchChainAsync({ chainId: requiredChainId });
      }

      setPremiumStatus("signing");
      setPremiumDetail("Wallet signature is open. Sign the x402 payment authorization.");
      const paymentPayload = await httpClient.createPaymentPayload(required);
      const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
      const paymentSignature = Object.values(paymentHeaders)[0] ?? "";
      const paymentHeaderHash = await hashX402PaymentHeader(paymentSignature);
      const fingerprint = await buildX402Fingerprint(buildX402RequestPayload(query, chain, walletAddress));

      // Persist BEFORE submitting: a lost response must not force a second
      // signature, and the hash matches the server's receipt lookup.
      receipts.savePending({ fingerprint, paymentSignature, paymentHeaderHash, payer: address });

      setPremiumStatus("verifying");
      setPremiumDetail("Submitting signed payment and generating the detailed AI Risk Report.");
      setIsScanning(true);
      const paidResponse = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...paymentHeaders,
        },
      });

      if (!paidResponse.ok) {
        const data = (await paidResponse.json().catch(() => null)) as { code?: string; detail?: string; error?: string } | null;
        const settlementLikely = paidResponse.status === 409 || paidResponse.status >= 500 || data?.code === "duplicate_x402_payment";
        const stored = receipts.findReceipt(fingerprint);
        if (stored && settlementLikely) setResumeCandidate(stored);
        throw new Error(
          data?.detail ??
            data?.error ??
            (settlementLikely
              ? "The scan response was lost after payment. Resume with the stored receipt; do not sign again yet."
              : "Paid scan request failed after payment signature."),
        );
      }

      const data = (await paidResponse.json()) as { premium?: { receiptId?: string; note?: string }; scan?: TokenScanResult };

      if (!data.scan) {
        throw new Error("Detailed scan completed without a report payload.");
      }

      setScan(data.scan);
      captureOfflineScan(data.scan, "paid detailed scan");
      receipts.markSettled(fingerprint, data.premium?.receiptId);
      setResumeCandidate(null);
      setDismissedReceiptHash(null);
      setPremiumStatus("verified");
      setPremiumDetail(`Payment verified. Receipt: ${data.premium?.receiptId ?? "recorded"}.`);
    } catch (error) {
      const stored = await buildX402Fingerprint(buildX402RequestPayload(query, chain, walletAddress)).then((fingerprint) =>
        receipts.findReceipt(fingerprint),
      );
      if (stored) setResumeCandidate(stored);

      setScan(null);
      setPremiumStatus("failed");
      setScanError(error instanceof Error ? error.message : "Scan failed.");
      setPremiumDetail(
        stored
          ? "Payment may have settled. Use “Resume with existing receipt” below instead of signing again."
          : error instanceof Error
            ? error.message
            : "Payment or scan failed.",
      );
    } finally {
      setIsScanning(false);
      setIsPreparingPremium(false);
    }
  }

  async function resumeWithReceipt(entry: X402ReceiptEntry) {
    if (actionsDisabled) return;
    setShowPaymentModal(false);
    setScanError(null);
    setPremiumDetail(null);
    setScan(null);
    setIsScanning(true);
    setPremiumStatus("verifying");
    setPremiumDetail("Reusing the stored x402 receipt to retrieve your paid scan. No new payment will be requested.");

    try {
      const response = await fetch("/api/x402/deep-scan/resume", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentHeaderHash: entry.paymentHeaderHash,
          ...buildX402RequestPayload(query, chain, walletAddress),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { code?: string; detail?: string; error?: string } | null;
        if (
          response.status === 404 ||
          response.status === 410 ||
          data?.code === "receipt_not_found" ||
          data?.code === "receipt_expired"
        ) {
          receipts.discard(entry);
          setDismissedReceiptHash(entry.paymentHeaderHash);
          setResumeCandidate(null);
          throw new Error("The stored receipt is no longer usable. Review the payment details to sign a new payment.");
        }
        throw new Error(data?.detail ?? data?.error ?? "Could not resume the paid scan with the stored receipt.");
      }

      const data = (await response.json()) as { premium?: { receiptId?: string; note?: string }; scan?: TokenScanResult };
      if (!data.scan) {
        throw new Error("Resumed scan completed without a report payload.");
      }

      setScan(data.scan);
      captureOfflineScan(data.scan, "resumed paid detailed scan");
      receipts.markSettled(entry, data.premium?.receiptId ?? entry.receiptId);
      setResumeCandidate(null);
      setPremiumStatus("verified");
      setPremiumDetail(`Payment verified from stored receipt. Receipt: ${data.premium?.receiptId ?? "recorded"}.`);
    } catch (error) {
      setPremiumStatus("failed");
      setScanError(error instanceof Error ? error.message : "Could not resume the paid scan.");
      setPremiumDetail(error instanceof Error ? error.message : "Could not resume the paid scan.");
    } finally {
      setIsScanning(false);
    }
  }

  function discardStoredReceipt() {
    if (!resumeCandidate) return;
    receipts.discard(resumeCandidate);
    setDismissedReceiptHash(resumeCandidate.paymentHeaderHash);
    setResumeCandidate(null);
  }

  function cancelPayment() {
    setShowPaymentModal(false);
    setPremiumStatus("idle");
    setPremiumDetail(null);
  }

  async function confirmPayment() {
    if (!paymentRequirement || !walletClient || !address) return;
    await signAndSubmitPayment(paymentRequirement);
  }

  async function preparePremiumScan() {
    await runDetailedScan();
  }

  return (
    <div className="space-y-5">
      <LiveRegion message={statusMessage} politeness={scanError ? "assertive" : "polite"} />
      <section className="glass-panel rounded-lg p-5">
          {showOnboarding ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d9a441]/25 bg-[#d9a441]/8 p-3 text-xs text-white/80">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[#f2c86d]">How Cryptara works:</span>
                <span>1. No wallet needed to scan</span>
                <span className="text-white/30">•</span>
                <span>2. 5 deterministic evaluation agents</span>
                <span className="text-white/30">•</span>
                <span>3. Approval-only action plan</span>
              </div>
              <button
                type="button"
                onClick={() => setShowOnboarding(false)}
                className="text-[11px] text-white/50 hover:text-white"
                aria-label="Dismiss guide"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <h1 className="text-3xl font-semibold tracking-tight">Scan token</h1>
          <div className="mt-5 grid gap-3 lg:grid-cols-[9rem_1fr_auto_auto]">
            <select
              value={chain}
              onChange={(event) => setChain(event.target.value)}
              className="h-12 rounded-full input-surface h-12 rounded-full border px-4 text-sm outline-none transition"
            >
              {chains.map((item) => (
                <option key={item.value} value={item.value} disabled={item.disabled} className="bg-dropdown text-foreground">
                  {item.label}
                </option>
              ))}
            </select>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="DexScreener URL or contract address"
              aria-label="DexScreener URL or contract address"
              aria-invalid={Boolean(scanError)}
              aria-describedby={scanError ? queryErrorId : undefined}
              className="h-12 min-w-0 flex-1 rounded-full input-surface h-12 rounded-full border px-5 text-sm outline-none transition"
            />
            <button
              type="button"
              onClick={runScan}
              disabled={isBusy || actionsDisabled}
              className="h-12 rounded-full bg-brand px-6 text-sm font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isScanning && !isPaymentWorking ? "Running token agents..." : "Run token agents"}
            </button>
            <button
              type="button"
              onClick={runDetailedScan}
              disabled={isBusy || actionsDisabled}
              className="h-12 rounded-full border border-brand px-6 text-sm font-semibold text-brand-muted transition hover:border-brand hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPaymentWorking ? "Processing..." : "Run deep scan agents"}
            </button>
          </div>
          <input
            value={walletAddress}
            onChange={(event) => setWalletAddress(event.target.value)}
            placeholder="Optional wallet address for portfolio exposure"
            className="mt-3 h-12 w-full rounded-full input-surface h-12 rounded-full border px-5 text-sm outline-none transition"
          />

          {/* Quick-try sample token chips */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-white/46">Try an example:</span>
            {SAMPLE_TOKENS.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => {
                  setChain(sample.chain);
                  setQuery(sample.query);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/72 transition hover:border-[#d9a441]/40 hover:bg-white/10 hover:text-white"
              >
                <span>{sample.label}</span>
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-[#f2c86d]">{sample.tag}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 text-xs text-white/42">Free Trial is free. Detailed Scan costs {paymentTerms?.priceUsd ?? "$0.99"}.</div>
      </section>

      {showPaymentPanel ? (
        <section className="overflow-hidden rounded-lg border border-brand bg-brand-subtle">
          <div className="grid gap-0 lg:grid-cols-[1fr_18rem]">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-brand-subtle p-3 text-brand">
                  {premiumStatus === "verified" ? <CheckCircle2 className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <h2 className="mt-2 text-xl font-semibold">{paymentStatusLabels[premiumStatus].title}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">{premiumDetail ?? paymentStatusLabels[premiumStatus].detail}</p>
                </div>
              </div>

              {premiumStatus === "wallet_required" ? (
                <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-black/18 p-4">
                  <WalletConnectButton />
                  {isConnected ? (
                    <button
                      type="button"
                      onClick={preparePremiumScan}
                      disabled={isPaymentWorking || actionsDisabled}
                      className="inline-flex h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Continue detailed scan
                    </button>
                  ) : null}
                </div>
              ) : null}

              {resumeCandidate && premiumStatus !== "verified" ? (
                <div className="mt-5 rounded-2xl border border-brand/40 bg-black/18 p-4">
                  <div className="flex items-start gap-2 text-sm text-white/72">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                    <div>
                      <div className="font-semibold">Resume with existing receipt</div>
                      <p className="mt-1 text-xs leading-5 text-white/52">
                        A recent x402 payment receipt matches this exact scan payload. Reuse it to retrieve the report
                        without signing (or paying) again.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => resumeWithReceipt(resumeCandidate)}
                      disabled={isBusy || actionsDisabled}
                      className="inline-flex h-10 items-center justify-center rounded-full bg-brand px-5 text-xs font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Resume with existing receipt
                    </button>
                    <button
                      type="button"
                      onClick={discardStoredReceipt}
                      disabled={isBusy}
                      className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 px-5 text-xs text-white/60 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Discard receipt
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-brand bg-[var(--color-glass-bg)] p-6 lg:border-l lg:border-t-0">
              <div className="rounded-2xl bg-black/22 p-4">
                <div className="flex items-center gap-2 text-sm text-white/52">
                  <CreditCard className="h-4 w-4 text-brand" />
                  x402 payment
                </div>
                <div className="mt-4 text-4xl font-semibold text-white">{paymentTerms?.priceUsd ?? "Price loading"}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/36">per detailed scan</div>
                <div className="mt-4 space-y-2 text-xs leading-5 text-white/48">
                  <div>Network: {paymentOption?.network ?? paymentTerms?.network ?? "Shown before signature"}</div>
                  <div>Asset: {paymentOption?.asset ?? paymentTerms?.asset ?? "USDC"}</div>
                  <div>Recipient: {shortenAddress(paymentOption?.payTo ?? paymentTerms?.payTo)}</div>
                  {paymentOption?.amount ? <div>Amount: {paymentOption.amount}</div> : null}
                </div>
              </div>
              <button
                type="button"
                onClick={preparePremiumScan}
                disabled={isPaymentWorking || premiumStatus === "verified" || actionsDisabled}
                className="mt-4 h-12 w-full rounded-full bg-brand px-5 text-sm font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {premiumStatus === "verified" ? "Payment verified" : isPaymentWorking ? "Processing..." : "Pay and Run Detailed Scan"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {isScanning ? (
        <section className="flex items-center gap-3 rounded-lg border border-brand bg-brand-subtle p-4">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
          <div className="text-sm text-white/68">Analyzing token risk...</div>
        </section>
      ) : null}

      {scanError ? (
        <div id={queryErrorId}>
          <NoDataState title="Scan failed" detail={scanError} action="No result was saved. Fix the input or retry with a supported contract/DexScreener URL." />
        </div>
      ) : null}

      {scan ? (
        <section className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
          <div className="space-y-5">
            <div className={`rounded-[28px] border p-6 ${riskTone(report?.buyRisk ?? scan.overallRiskScore)}`}>
              <div className="text-sm uppercase tracking-[0.18em] opacity-75">AI Risk Report</div>
              <div className="mt-2 text-xs font-semibold uppercase tracking-[0.16em]">{riskLevelLabel(report?.buyRisk ?? scan.overallRiskScore)}</div>
              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-4xl font-semibold">{scan.symbol}</h2>
                  <div className="mt-2 text-sm capitalize opacity-70">{verdictLabel(report?.verdict)}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-left sm:text-right">
                  <div>
                    <div className="text-5xl font-semibold">{report?.buyRisk ?? scan.overallRiskScore}%</div>
                    <div className="text-xs uppercase tracking-[0.2em] opacity-60">Buy risk</div>
                  </div>
                  <div>
                    <div className="text-5xl font-semibold">{Math.round((report?.confidence ?? 0) * 100)}%</div>
                    <div className="text-xs uppercase tracking-[0.2em] opacity-60">Confidence</div>
                  </div>
                </div>
              </div>
              <p className="mt-5 max-w-2xl text-sm leading-6 opacity-80">{report?.summary ?? scan.summary}</p>
              <StellarRiskPublishButton
                network={scan.chain}
                assetKey={normalizedInput?.assetKey ?? normalizedInput?.contractAddress}
                assetLabel={scan.symbol}
                score={report?.buyRisk ?? scan.overallRiskScore}
                verdict={report?.verdict ?? scan.verdict}
                report={report ?? scan}
              />
              <RiskSnapshotActions source={scan} />
              {normalizedInput ? (
                <details className="mt-4 text-xs text-white/58">
                  <summary className="cursor-pointer text-white/42">Token details</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl bg-black/20 p-3">Chain: {normalizedInput.chain}</div>
                  <div className="rounded-2xl bg-black/20 p-3">Source: {normalizedInput.source.replaceAll("_", " ")}</div>
                  <div className="rounded-2xl bg-black/20 p-3">Contract: {normalizedInput.contractAddress ?? "unresolved"}</div>
                  <div className="rounded-2xl bg-black/20 p-3">Pair: {normalizedInput.pairAddress ?? "N/A"}</div>
                </div></details>
              ) : null}
            </div>
            <div className="glass-panel rounded-[28px] p-6">
              <h2 className="text-xl font-semibold">Top reasons</h2>
              <div className="mt-4 space-y-3">
                {(report?.topReasons.length ? report.topReasons : scan.reasons).slice(0, 3).map((reason) => (
                  <div key={reason} className="rounded-2xl bg-white/6 p-4 text-sm leading-6 text-white/62">
                    {reason}
                  </div>
                ))}
              </div>
            </div>
            {report?.agentCards.length ? (
              <details className="glass-panel rounded-lg p-5">
                <summary className="cursor-pointer text-sm font-semibold text-white/68">Agent details</summary>
                <div className="mt-5 grid gap-3">
                  {report.agentCards.map((card) => (
                    <article key={card.agent} className="rounded-2xl bg-white/6 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold">{card.displayName}</div>
                          <div className="mt-1 text-xs capitalize text-white/42">{card.scoreKind} score</div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-semibold">{card.score}</div>
                          <div className="text-xs text-white/42">{Math.round(card.confidence * 100)}% conf</div>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-white/54">{card.summary}</p>
                      {card.secondaryScores?.length ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {card.secondaryScores.map((score) => (
                            <div key={`${card.agent}:${score.label}`} className="rounded-xl border border-white/8 bg-black/18 px-3 py-2">
                              <div className="text-xs text-white/42">{score.label}</div>
                              <div className="mt-1 text-xl font-semibold">{score.score}</div>
                              <div className="mt-1 text-[11px] leading-4 text-white/42">{score.detail}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {card.criticalFactors?.length ? (
                        <div className="mt-3 space-y-2">
                          {card.criticalFactors.map((factor) => (
                            <div key={`${card.agent}:critical:${factor.label}`} className={`rounded-xl border px-3 py-2 text-xs leading-5 ${factorTone(factor)}`}>
                              <div className="font-semibold">{factor.label}</div>
                              <div className="mt-1 opacity-80">{factor.detail}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 space-y-2">
                        {card.factors.slice(0, 6).map((factor) => (
                          <div key={`${card.agent}:${factor.category}:${factor.label}`} className={`rounded-xl border px-3 py-2 text-xs leading-5 ${factorTone(factor)}`}>
                            <div className="flex items-start justify-between gap-3">
                              <span className="font-semibold">{factor.label}</span>
                              <span className="shrink-0 opacity-70">{factor.impact > 0 ? "+" : ""}{factor.impact}</span>
                            </div>
                            <div className="mt-1 opacity-80">{factor.detail}</div>
                            {factorMetaEntries(factor).length ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {factorMetaEntries(factor).map(([key, value]) => (
                                  <span key={`${card.agent}:${factor.label}:${key}`} className="rounded-full bg-white/8 px-2 py-1 text-[11px] capitalize opacity-75">
                                    {key.replace(/([A-Z])/g, " $1")}: {formatMetaValue(value)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {card.missingData.length ? (
                        <div className="mt-3 rounded-xl border border-brand bg-brand-subtle px-3 py-2 text-xs leading-5 text-brand-muted">
                          Missing data: {card.missingData.map((item) => item.field).join(", ")}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
            {whatWouldChange ? (
              <div className="glass-panel rounded-[28px] p-6">
                <h2 className="text-xl font-semibold">What would change this decision</h2>
                <div className="mt-3 rounded-2xl bg-white/6 p-4 text-sm leading-6 text-white/58">{whatWouldChange.detail}</div>
              </div>
            ) : null}
            {executionPreview ? (
              <details className="glass-panel rounded-lg p-5">
                <summary className="cursor-pointer text-sm font-semibold text-white/68">Execution details</summary>
                <h2 className="mt-2 text-xl font-semibold">{executionPreview.title}</h2>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ["Suggested action", executionPreview.action?.replaceAll("_", " ") ?? "no action"],
                    ["Trade required", executionPreview.action === "swap" || executionPreview.action === "reduce_exposure" ? "yes" : "no"],
                    ["Quote status", executionPreview.quote?.status ?? "not required"],
                    ["Simulation status", executionPreview.simulation?.status ?? "unavailable"],
                    ["Wallet approval", executionPreview.requiresApproval ? "required" : "not prepared"],
                    ["Server can sign", executionPreview.audit?.serverCanSign ? "yes" : "no"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-white/6 p-4">
                      <div className="text-sm text-white/42">{label}</div>
                      <div className="mt-1 text-lg font-semibold capitalize">{value}</div>
                    </div>
                  ))}
                </div>
                {executionPreview.blockedReason ? (
                  <div className="mt-4 rounded-2xl risk-tone-high p-4 text-sm leading-6">
                    Executable transaction unavailable: {executionPreview.blockedReason}
                  </div>
                ) : null}
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/58">
                  Auto execute is off. The server cannot sign. Any real blockchain action requires explicit wallet approval.
                </div>
              </details>
            ) : null}
            {scan.market ? (
              <details className="glass-panel rounded-lg p-5">
                <summary className="cursor-pointer text-sm font-semibold text-white/68">Market details</summary>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mt-1 text-sm text-white/42">{scan.market.dexId ?? "DEX"} pair data</div>
                  </div>
                  {scan.market.pairUrl ? (
                    <a
                      href={scan.market.pairUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/62 transition hover:text-white"
                    >
                      Open
                    </a>
                  ) : null}
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ["Liquidity", formatUsd(scan.market.liquidityUsd)],
                    ["24h volume", formatUsd(scan.market.volume24hUsd)],
                    ["FDV", formatUsd(scan.market.fdvUsd)],
                    ["24h change", formatPercent(scan.market.priceChange24hPercent)],
                    ["Pair age", typeof scan.market.pairAgeDays === "number" ? `${scan.market.pairAgeDays} days` : "N/A"],
                    ["Price", formatUsd(scan.market.priceUsd)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-white/6 p-4">
                      <div className="text-sm text-white/42">{label}</div>
                      <div className="mt-1 text-lg font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
          <div className="space-y-5">
            <RiskBreakdownCard items={scan.riskBreakdown} />
            {scan.dataQuality ? (
              <details className="glass-panel rounded-lg p-5">
                <summary className="cursor-pointer text-sm font-semibold text-white/68">Data quality</summary>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mt-1 text-sm leading-6 text-white/48">{scan.dataQuality.detail}</div>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/7 px-3 py-1 text-xs capitalize text-white/54">
                    {scan.dataQuality.mode}
                  </span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Connected", scan.dataQuality.connectedSources],
                    ["Unavailable", scan.dataQuality.unavailableSources],
                    ["Mock", scan.dataQuality.mockSources],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-white/6 p-4">
                      <div className="text-sm text-white/42">{label}</div>
                      <div className="mt-1 text-2xl font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
                {scan.dataQuality.mockSources > 0 ? (
                  <div className="mt-4 rounded-2xl risk-tone-high p-4 text-sm leading-6">
                    Demo/mock data is present and explicitly counted here. It must not be treated as live production evidence.
                  </div>
                ) : null}
              </details>
            ) : null}
            {scan.dataQuality?.mode === "unavailable" || scan.dataQuality?.connectedSources === 0 ? (
              <NoDataState
                title="Not enough connected sources"
                detail="Provider unavailable or token identity could not be resolved. This result is conservative and uses no mock data."
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {showPaymentModal && paymentRequirement ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancelPayment();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={paymentModalTitleId}
            className="w-full max-w-lg rounded-2xl border border-brand bg-[var(--color-glass-bg)] p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">x402 payment required</div>
                <h2 id={paymentModalTitleId} className="mt-1 text-xl font-semibold">Confirm detailed scan payment</h2>
              </div>
              <button
                type="button"
                onClick={cancelPayment}
                aria-label="Close payment details"
                className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 text-sm leading-6 text-white/60">
              Review the exact terms below. Your wallet only signs after you confirm; no payment is sent on cancel.
            </p>

            <dl className="mt-5 space-y-3 rounded-xl border border-white/10 bg-black/22 p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-white/48">Asset</dt>
                <dd className="font-medium">{paymentOption?.asset ?? paymentTerms?.asset ?? "USDC"}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-white/48">Amount</dt>
                <dd className="font-medium">{paymentOption?.amount ?? "Shown by the x402 quote"}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-white/48">Price</dt>
                <dd className="font-medium">{paymentTerms?.priceUsd ?? "$0.99"}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-white/48">Network</dt>
                <dd className="font-medium">{paymentOption?.network ?? paymentTerms?.network ?? "Shown by the x402 quote"}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-white/48">Recipient (X402_PAY_TO)</dt>
                <dd className="break-all font-mono text-xs text-white/80">
                  {paymentOption?.payTo ?? paymentTerms?.payTo ?? "Shown by the x402 quote"}
                </dd>
              </div>
            </dl>

            {resumeCandidate ? (
              <div className="mt-4 rounded-xl border border-brand/40 bg-brand-subtle p-4">
                <div className="flex items-start gap-2 text-sm text-white/72">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <span>A matching recent receipt already covers this exact scan payload.</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => resumeWithReceipt(resumeCandidate)}
                    disabled={isBusy || actionsDisabled}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-brand px-5 text-xs font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Resume with existing receipt
                  </button>
                  <button
                    type="button"
                    onClick={discardStoredReceipt}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 px-5 text-xs text-white/60 transition hover:border-white/30 hover:text-white"
                  >
                    Sign a new payment instead
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={cancelPayment}
                className="h-11 rounded-full border border-white/15 px-5 text-sm text-white/60 transition hover:border-white/30 hover:text-white"
              >
                Cancel
              </button>
              <button
                ref={paymentModalRef}
                type="button"
                onClick={confirmPayment}
                disabled={isPaymentWorking || actionsDisabled}
                className="h-11 rounded-full bg-brand px-6 text-sm font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                Confirm &amp; sign payment
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
