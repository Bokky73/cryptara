"use client";

import { AlertCircle, CheckCircle2, CreditCard, Lock, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { useI18n, type I18nValue } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import type { RiskReportVerdict, ScoreFactor, TokenScanResult, TransactionPreview } from "@/server/types";
import { NoDataState } from "@/components/NoDataState";
import { RiskBreakdownCard } from "@/components/RiskBreakdownCard";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { StellarRiskPublishButton } from "@/components/StellarRiskPublishButton";
import { LiveRegion } from "@/components/a11y/LiveRegion";
import { RiskSnapshotActions } from "@/components/RiskSnapshotActions";
import { captureOfflineScan } from "@/lib/offlineStore";
import { parseTokenQuery, type TokenInputIssueCode, type TokenInputKind } from "@/lib/tokenQuery";
import { recordScannedAsset } from "@/lib/commandPalette/persistedRecents";
import { detectScanTarget } from "@/lib/commandPalette/scanTarget";
import { buildX402Fingerprint, hashX402PaymentHeader, type X402ReceiptEntry } from "@/lib/x402ReceiptStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useX402PaymentReceipts } from "@/hooks/useSigning";

const paymentStatusLabels: Record<PaymentStage, { title: MessageKey; detail: MessageKey }> = {
  idle: { title: "payIdleTitle", detail: "payIdleDetail" },
  wallet_required: { title: "payWalletRequiredTitle", detail: "payWalletRequiredDetail" },
  requesting: { title: "payPreparingTitle", detail: "payPreparingDetail" },
  payment_required: { title: "payPaymentRequiredTitle", detail: "payPaymentRequiredDetail" },
  signing: { title: "paySigningTitle", detail: "paySigningDetail" },
  verifying: { title: "payVerifyingTitle", detail: "payVerifyingDetail" },
  verified: { title: "payVerifiedTitle", detail: "payVerifiedDetail" },
  failed: { title: "payFailedTitle", detail: "payFailedDetail" },
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

const WHAT_WOULD_CHANGE_LABEL = "What would change this decision";

const verdictKeys: Record<RiskReportVerdict, MessageKey> = {
  buy_small: "verdictBuySmall",
  watch: "verdictWatch",
  avoid: "verdictAvoid",
  hold: "verdictHold",
  reduce_exposure: "verdictReduceExposure",
  manual_review: "verdictManualReview",
};

const statusKeys: Record<string, MessageKey> = {
  prepared: "statusPrepared",
  user_rejected: "statusUserRejected",
  submitted: "statusSubmitted",
  confirmed: "statusConfirmed",
  failed: "statusFailed",
  replaced: "statusReplaced",
  expired: "statusExpired",
  pending: "statusPending",
  stale: "statusStale",
  required: "statusRequired",
  "not required": "statusNotRequired",
  "not prepared": "statusNotPrepared",
  unavailable: "statusUnavailable",
  yes: "statusYes",
  no: "statusNo",
  "no action": "statusNo",
};

const sampleTagKeys = {
  "EVM Bluechip": "tagEvmBluechip",
  "Base DEX": "tagBaseDex",
  "Stellar Classic": "tagStellarClassic",
  "High Risk": "tagHighRisk",
} as const satisfies Record<string, MessageKey>;

const validationIssueKeys: Record<TokenInputIssueCode, MessageKey> = {
  empty: "validationEmpty",
  too_long: "validationTooLong",
  invalid_evm_address: "validationInvalidEvmAddress",
  invalid_evm_checksum: "validationInvalidEvmChecksum",
  invalid_stellar_asset: "validationInvalidStellarAsset",
  invalid_dexscreener_url: "validationInvalidDexUrl",
  unsupported_dexscreener_chain: "validationUnsupportedDexChain",
};

const inputKindKeys: Record<TokenInputKind, MessageKey> = {
  "evm-address": "inputKindEvmAddress",
  "stellar-classic": "inputKindStellarClassic",
  "soroban-contract": "inputKindSorobanContract",
  "dexscreener-url": "inputKindDexScreenerUrl",
  symbol: "inputKindSymbol",
};

type PaymentStage = "idle" | "wallet_required" | "requesting" | "payment_required" | "signing" | "verifying" | "verified" | "failed";
type PaymentTerms = {
  priceUsd: string;
  network: string;
  asset: string;
  payTo: string;
  available: boolean;
};

function shortenAddress(value: string | undefined, t: I18nValue["t"]) {
  if (!value || value.length < 12) return value ?? t("shownBeforeSignature");

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatUsd(value: number | undefined, t: I18nValue["t"], format: I18nValue["format"]) {
  if (typeof value !== "number" || !Number.isFinite(value)) return t("notAvailable");

  return format.currencyWithDigits(value, value >= 1 ? 0 : 6);
}

function formatPercent(value: number | undefined, t: I18nValue["t"], format: I18nValue["format"]) {
  if (typeof value !== "number" || !Number.isFinite(value)) return t("notAvailable");

  return `${value >= 0 ? "+" : ""}${format.number(value)}%`;
}

function verdictLabel(verdict: RiskReportVerdict | undefined, t: I18nValue["t"]) {
  if (!verdict) return t("verdictManualReview");

  return t(verdictKeys[verdict]);
}

function riskTone(score: number) {
  if (score >= 75) return "risk-tone-critical";
  if (score >= 50) return "risk-tone-high";
  if (score >= 25) return "risk-tone-medium";
  return "risk-tone-low";
}

function riskLevelLabel(score: number, t: I18nValue["t"]) {
  if (score >= 75) return t("riskCritical");
  if (score >= 50) return t("riskHigh");
  if (score >= 25) return t("riskMedium");
  return t("riskLow");
}

function factorTone(factor: ScoreFactor) {
  if (factor.severity === "critical") return "risk-tone-critical";
  if (factor.severity === "high") return "risk-tone-high";
  if (factor.direction === "risk_decrease") return "risk-tone-low";
  return "border-[var(--color-border)] bg-[var(--color-glass-bg)] text-muted";
}

function formatMetaValue(value: string | number | boolean | null | undefined, t: I18nValue["t"], format: I18nValue["format"]) {
  if (value === undefined || value === null || value === "") return t("notAvailable");
  if (typeof value === "boolean") return value ? t("statusYes") : t("statusNo");
  if (typeof value === "number") return format.number(value);

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
  { labelKey: "sampleUsdcEthereum", chain: "ethereum", query: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", tag: "EVM Bluechip" },
  { labelKey: "sampleAeroBase", chain: "base", query: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", tag: "Base DEX" },
  { labelKey: "sampleXlmStellar", chain: "stellar-testnet", query: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", tag: "Stellar Classic" },
  { labelKey: "sampleRiskyMeme", chain: "base", query: "MEME", tag: "High Risk" },
] as const satisfies readonly { labelKey: MessageKey; chain: string; query: string; tag: string }[];

export function TokenScanClient({ initialQuery = "MEME" }: { initialQuery?: string }) {
  const { t, format } = useI18n();
export function TokenScanClient({ initialQuery = "MEME", initialChain, autoRun = false }: { initialQuery?: string; initialChain?: string; autoRun?: boolean }) {
  const queryErrorId = useId();
  const inputHelpId = useId();
  const paymentModalTitleId = useId();
  const paymentModalRef = useRef<HTMLButtonElement>(null);
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [query, setQuery] = useState(initialQuery || "MEME");
  const [chain, setChain] = useState(() => {
    const initialInput = parseTokenQuery(query);
    return initialInput.ok && initialInput.suggestedChain ? initialInput.suggestedChain : "base";
  });
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
  const parsedInput = useMemo(() => parseTokenQuery(query, { chain }), [chain, query]);
  const activeQuery = parsedInput.ok ? parsedInput.query : query.trim();
  const activeChain = parsedInput.ok ? parsedInput.suggestedChain ?? chain : chain;
  const inputIssue = !parsedInput.ok ? t(validationIssueKeys[parsedInput.code]) : null;
  const inputWarning = parsedInput.ok && parsedInput.warning ? t("validationInvalidEvmChecksum") : null;
  const localizedStatus = (value: string) => (statusKeys[value] ? t(statusKeys[value]) : value.replaceAll("_", " "));
  const report = scan?.riskReport;
  const normalizedInput = report?.input ?? scan?.normalizedInput;
  const executionPreview = report?.executionPreview as TransactionPreview | undefined;
  const decisionCard = report?.agentCards.find((card) => card.agent === "decision");
  const whatWouldChange = decisionCard?.factors.find((factor) => factor.label === WHAT_WOULD_CHANGE_LABEL);
  const paymentOption = getPaymentOption(paymentRequirement);
  const x402Payload = useMemo(() => buildX402RequestPayload(activeQuery, activeChain, walletAddress), [activeChain, activeQuery, walletAddress]);
  const visibleResumeCandidate = scan || !x402Payload.query ? null : resumeCandidate;
  const isPaymentWorking = premiumStatus === "requesting" || premiumStatus === "signing" || premiumStatus === "verifying" || isPreparingPremium;
  const isBusy = isScanning || isPaymentWorking;
  const showPaymentPanel = premiumStatus !== "idle";
  const statusMessage = scanError
    ? scanError
    : isScanning
      ? t("scanAnalyzing")
      : isPaymentWorking
        ? premiumDetail ?? t(paymentStatusLabels[premiumStatus].detail)
        : scan
          ? t("scanComplete", { symbol: scan.symbol, score: scan.overallRiskScore })
          : null;

  function handleQueryChange(value: string) {
    setQuery(value);
    const nextInput = parseTokenQuery(value, { chain });
    if (nextInput.ok && nextInput.kind === "dexscreener-url" && nextInput.suggestedChain && nextInput.suggestedChain !== chain) {
      setChain(nextInput.suggestedChain);
    }
  }

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
    if (!x402Payload.query || scan) return;

    buildX402Fingerprint(x402Payload)
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
  }, [x402Payload, scan, dismissedReceiptHash, receipts]);

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
    if (actionsDisabled || inputIssue) return;
    setIsScanning(true);
    setScanError(null);
    setPremiumStatus("idle");
    setPremiumDetail(null);
    setPaymentRequirement(null);

    try {
      const response = await fetch("/api/scan/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: activeQuery, chain: activeChain, walletAddress: walletAddress.trim() || undefined }),
      });

      if (!response.ok) {
        throw new Error(t("scanRetryInput"));
      }

      const data = (await response.json()) as TokenScanResult;
      setScan(data);
      captureOfflineScan(data, "free token scan");
      const target = detectScanTarget(query, null);
      if (target) recordScannedAsset({ query: target.query, chain });
    } catch (error) {
      setScan(null);
      setScanError(error instanceof Error ? error.message : t("scanFreeTrialFailed"));
    } finally {
      setIsScanning(false);
    }
  }

  function createEvmHttpClient() {
    if (!walletClient || !address) throw new Error(t("scanConnectEvmFirst"));

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

    if (inputIssue) {
      setPremiumStatus("failed");
      setScanError(inputIssue);
      return;
    }

    if (!isConnected || !walletClient || !address) {
      setScan(null);
      setPremiumStatus("wallet_required");
      setPremiumDetail(t("scanConnectWalletThenContinue"));
      return;
    }

    setScan(null);
    setPaymentRequirement(null);
    setIsPreparingPremium(true);
    setIsScanning(false);
    setPremiumStatus("requesting");
    setPremiumDetail(t("scanRequestingTerms"));

    try {
      const url = buildDeepScanUrl(activeQuery, activeChain, walletAddress);
      const httpClient = createEvmHttpClient();
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (response.status === 402) {
        const body = (await response.json().catch(() => null)) as unknown;
        const required = httpClient.getPaymentRequiredResponse((name) => response.headers.get(name), body);
        if (!required) {
          throw new Error(t("scanInvalidRequirements"));
        }
        setPaymentRequirement(required);
        setPremiumStatus("payment_required");
        setPremiumDetail(t("scanReviewPaymentTerms"));

        const fingerprint = await buildX402Fingerprint(buildX402RequestPayload(activeQuery, activeChain, walletAddress));
        const existing = await receipts.findReceipt(fingerprint);
        setResumeCandidate(existing && existing.paymentHeaderHash !== dismissedReceiptHash ? existing : null);
        setShowPaymentModal(true);
        return;
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { detail?: string; error?: string } | null;
        throw new Error(data?.detail ?? data?.error ?? t("scanDetailedRequestFailed"));
      }

      const data = (await response.json()) as { premium?: { receiptId?: string; note?: string }; scan?: TokenScanResult };

      if (!data.scan) {
        throw new Error(t("scanNoReportPayload"));
      }

      setScan(data.scan);
      captureOfflineScan(data.scan, "paid detailed scan");
      setPremiumStatus("verified");
      setPremiumDetail(t("scanPaymentVerified", { receiptId: data.premium?.receiptId ?? "recorded" }));
    } catch (error) {
      setScan(null);
      setPremiumStatus("failed");
      setScanError(error instanceof Error ? error.message : t("scanFailed"));
      setPremiumDetail(error instanceof Error ? error.message : t("scanPaymentOrScanFailed"));
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
    setPremiumDetail(t("scanWalletSignatureOpen"));

    try {
      const httpClient = createEvmHttpClient();
      const url = buildDeepScanUrl(activeQuery, activeChain, walletAddress);
      const requiredChainId = getPaymentChainId(required);

      if (requiredChainId && chainId !== requiredChainId) {
        setPremiumDetail(t("scanSwitchingNetwork", { chainId: requiredChainId }));
        await switchChainAsync({ chainId: requiredChainId });
      }

      setPremiumStatus("signing");
      setPremiumDetail(t("scanWalletSignatureOpen"));
      const paymentPayload = await httpClient.createPaymentPayload(required);
      const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
      const paymentSignature = Object.values(paymentHeaders)[0] ?? "";
      const paymentHeaderHash = await hashX402PaymentHeader(paymentSignature);
      const fingerprint = await buildX402Fingerprint(buildX402RequestPayload(activeQuery, activeChain, walletAddress));

      // Persist BEFORE submitting: a lost response must not force a second
      // signature, and the hash matches the server's receipt lookup.
      receipts.savePending({ fingerprint, paymentSignature, paymentHeaderHash, payer: address });

      setPremiumStatus("verifying");
      setPremiumDetail(t("scanSubmittingPayment"));
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
              ? t("scanResponseLost")
              : t("scanPaidRequestFailed")),
        );
      }

      const data = (await paidResponse.json()) as { premium?: { receiptId?: string; note?: string }; scan?: TokenScanResult };

      if (!data.scan) {
        throw new Error(t("scanDetailedNoReport"));
      }

      setScan(data.scan);
      captureOfflineScan(data.scan, "paid detailed scan");
      receipts.markSettled(fingerprint, data.premium?.receiptId);
      setResumeCandidate(null);
      setDismissedReceiptHash(null);
      setPremiumStatus("verified");
      setPremiumDetail(t("scanPaymentVerified", { receiptId: data.premium?.receiptId ?? "recorded" }));
    } catch (error) {
      const stored = await buildX402Fingerprint(buildX402RequestPayload(activeQuery, activeChain, walletAddress)).then((fingerprint) =>
        receipts.findReceipt(fingerprint),
      );
      if (stored) setResumeCandidate(stored);

      setScan(null);
      setPremiumStatus("failed");
      setScanError(error instanceof Error ? error.message : t("scanFailed"));
      setPremiumDetail(
        stored
          ? t("scanPaymentMaySettled")
          : error instanceof Error
            ? error.message
            : t("scanPaymentOrScanFailed"),
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
    setPremiumDetail(t("scanResumeStoredReceipt"));

    try {
      const response = await fetch("/api/x402/deep-scan/resume", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentHeaderHash: entry.paymentHeaderHash,
          ...buildX402RequestPayload(activeQuery, activeChain, walletAddress),
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
          throw new Error(t("scanReceiptUnusable"));
        }
        throw new Error(data?.detail ?? data?.error ?? t("scanResumeReceiptFailed"));
      }

      const data = (await response.json()) as { premium?: { receiptId?: string; note?: string }; scan?: TokenScanResult };
      if (!data.scan) {
        throw new Error(t("scanResumedNoReport"));
      }

      setScan(data.scan);
      captureOfflineScan(data.scan, "resumed paid detailed scan");
      receipts.markSettled(entry, data.premium?.receiptId ?? entry.receiptId);
      setResumeCandidate(null);
      setPremiumStatus("verified");
      setPremiumDetail(t("scanPaymentVerifiedFromReceipt", { receiptId: data.premium?.receiptId ?? "recorded" }));
    } catch (error) {
      setPremiumStatus("failed");
      setScanError(error instanceof Error ? error.message : t("scanResumeFailed"));
      setPremiumDetail(error instanceof Error ? error.message : t("scanResumeFailed"));
    } finally {
      setIsScanning(false);
    }
  }

  function discardStoredReceipt() {
    if (!visibleResumeCandidate) return;
    receipts.discard(visibleResumeCandidate);
    setDismissedReceiptHash(visibleResumeCandidate.paymentHeaderHash);
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
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand bg-brand-subtle p-3 text-xs text-white/80">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-brand-muted">{t("scanHowWorks")}</span>
                <span>{t("scanHowNoWallet")}</span>
                <span className="text-white/30">•</span>
                <span>{t("scanHowAgents")}</span>
                <span className="text-white/30">•</span>
                <span>{t("scanHowApprovalOnly")}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowOnboarding(false)}
                className="text-[11px] text-white/50 hover:text-white"
                aria-label={t("dismissGuide")}
              >
                {t("dismiss")}
              </button>
            </div>
          ) : null}
          <h1 className="text-3xl font-semibold tracking-tight">{t("scanTitle")}</h1>
          <div className="mt-5 grid gap-3 lg:grid-cols-[9rem_1fr_auto_auto]">
            <select
              value={chain}
              onChange={(event) => setChain(event.target.value)}
              className="h-12 rounded-full input-surface h-12 rounded-full border px-4 text-sm outline-none transition"
            >
              {chains.map((item) => (
                <option key={item.value} value={item.value} disabled={item.disabled} className="bg-dropdown text-foreground">
                  {item.value === "solana" ? t("chainSolanaSoon") : item.label}
                </option>
              ))}
            </select>
            <input
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              placeholder={t("scanQueryPlaceholder")}
              aria-label={t("scanQueryPlaceholder")}
              aria-invalid={Boolean(inputIssue || scanError)}
              aria-describedby={
                [
                  inputIssue || inputWarning || (parsedInput.ok ? t("validationDetectedInput", { kind: t(inputKindKeys[parsedInput.kind]) }) : null)
                    ? inputHelpId
                    : null,
                  scanError ? queryErrorId : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className="h-12 min-w-0 flex-1 rounded-full input-surface h-12 rounded-full border px-5 text-sm outline-none transition"
            />
            <button
              type="button"
              onClick={runScan}
              disabled={isBusy || actionsDisabled || Boolean(inputIssue)}
              className="h-12 rounded-full bg-brand px-6 text-sm font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isScanning && !isPaymentWorking ? t("runningAgents") : t("runAgents")}
            </button>
            <button
              type="button"
              onClick={runDetailedScan}
              disabled={isBusy || actionsDisabled || Boolean(inputIssue)}
              className="h-12 rounded-full border border-brand px-6 text-sm font-semibold text-brand-muted transition hover:border-brand hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPaymentWorking ? t("processing") : t("runDeepAgents")}
            </button>
          </div>
          <div id={inputHelpId} className="mt-2 space-y-1 text-xs">
            {inputIssue ? <p role="alert" className="text-red-300">{inputIssue}</p> : null}
            {inputWarning ? <p className="text-amber-300">{inputWarning}</p> : null}
            {parsedInput.ok ? (
              <p className="text-white/46">
                {t("validationDetectedInput", { kind: t(inputKindKeys[parsedInput.kind]) })}
                {parsedInput.pairAddress ? ` · ${t("pairLabel")} ${parsedInput.pairAddress}` : ""}
                {parsedInput.kind === "symbol" ? ` · ${t("validationSymboleInput")}` : ""}
              </p>
            ) : null}
          </div>
          <input
            value={walletAddress}
            onChange={(event) => setWalletAddress(event.target.value)}
            placeholder={t("scanWalletPlaceholder")}
            aria-label={t("scanWalletPlaceholder")}
            className="mt-3 h-12 w-full rounded-full input-surface h-12 rounded-full border px-5 text-sm outline-none transition"
          />

          {/* Quick-try sample token chips */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-white/46">{t("tryExample")}</span>
            {SAMPLE_TOKENS.map((sample) => (
              <button
                key={sample.labelKey}
                type="button"
                onClick={() => {
                  setChain(sample.chain);
                  setQuery(sample.query);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/72 transition hover:border-brand hover:bg-white/10 hover:text-white"
              >
                <span>{t(sample.labelKey)}</span>
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-brand-muted">{t(sampleTagKeys[sample.tag as keyof typeof sampleTagKeys])}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 text-xs text-white/42">{t("scanPricing", { price: paymentTerms?.priceUsd ?? "$0.99" })}</div>
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
                  <h2 className="mt-2 text-xl font-semibold">{t(paymentStatusLabels[premiumStatus].title)}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">{premiumDetail ?? t(paymentStatusLabels[premiumStatus].detail)}</p>
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
                      {t("continueDetailedScan")}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {visibleResumeCandidate && premiumStatus !== "verified" ? (
                <div className="mt-5 rounded-2xl border border-brand/40 bg-black/18 p-4">
                  <div className="flex items-start gap-2 text-sm text-white/72">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                    <div>
                      <div className="font-semibold">{t("resumeWithReceipt")}</div>
                      <p className="mt-1 text-xs leading-5 text-white/52">
                        {t("resumeReceiptDetail")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => resumeWithReceipt(visibleResumeCandidate)}
                      disabled={isBusy || actionsDisabled}
                      className="inline-flex h-10 items-center justify-center rounded-full bg-brand px-5 text-xs font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t("resumeWithReceipt")}
                    </button>
                    <button
                      type="button"
                      onClick={discardStoredReceipt}
                      disabled={isBusy}
                      className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 px-5 text-xs text-white/60 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t("discardReceipt")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-brand bg-[var(--color-glass-bg)] p-6 lg:border-l lg:border-t-0">
              <div className="rounded-2xl bg-black/22 p-4">
                <div className="flex items-center gap-2 text-sm text-white/52">
                  <CreditCard className="h-4 w-4 text-brand" />
                  {t("x402Payment")}
                </div>
                <div className="mt-4 text-4xl font-semibold text-white">{paymentTerms?.priceUsd ?? t("priceLoading")}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/36">{t("perDetailedScan")}</div>
                <div className="mt-4 space-y-2 text-xs leading-5 text-white/48">
                  <div>{t("networkLabel")} {paymentOption?.network ?? paymentTerms?.network ?? t("shownBeforeSignature")}</div>
                  <div>{t("assetLabel")} {paymentOption?.asset ?? paymentTerms?.asset ?? "USDC"}</div>
                  <div>{t("recipientLabel")} {shortenAddress(paymentOption?.payTo ?? paymentTerms?.payTo, t)}</div>
                  {paymentOption?.amount ? <div>{t("amountLabel")} {paymentOption.amount}</div> : null}
                </div>
              </div>
              <button
                type="button"
                onClick={preparePremiumScan}
                disabled={isPaymentWorking || premiumStatus === "verified" || actionsDisabled}
                className="mt-4 h-12 w-full rounded-full bg-brand px-5 text-sm font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {premiumStatus === "verified"
                  ? t("payVerifiedTitle")
                  : isPaymentWorking
                    ? t("processing")
                    : t("payAndRunDetailedScan")}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {isScanning ? (
        <section className="flex items-center gap-3 rounded-lg border border-brand bg-brand-subtle p-4">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
          <div className="text-sm text-white/68">{t("scanAnalyzingDots")}</div>
        </section>
      ) : null}

      {scanError ? (
        <div id={queryErrorId}>
          <NoDataState title={t("scanFailed")} detail={scanError} action={t("noResultSaved")} />
        </div>
      ) : null}

      {scan ? (
        <section className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
          <div className="space-y-5">
            <div className={`rounded-[28px] border p-6 ${riskTone(report?.buyRisk ?? scan.overallRiskScore)}`}>
              <div className="text-sm uppercase tracking-[0.18em] opacity-75">{t("aiRiskReport")}</div>
              <div className="mt-2 text-xs font-semibold uppercase tracking-[0.16em]">{riskLevelLabel(report?.buyRisk ?? scan.overallRiskScore, t)}</div>
              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-4xl font-semibold">{scan.symbol}</h2>
                  <div className="mt-2 text-sm opacity-70">{verdictLabel(report?.verdict, t)}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-left sm:text-right">
                  <div>
                    <div className="text-5xl font-semibold">{report?.buyRisk ?? scan.overallRiskScore}%</div>
                    <div className="text-xs uppercase tracking-[0.2em] opacity-60">{t("buyRisk")}</div>
                  </div>
                  <div>
                    <div className="text-5xl font-semibold">{Math.round((report?.confidence ?? 0) * 100)}%</div>
                    <div className="text-xs uppercase tracking-[0.2em] opacity-60">{t("confidence")}</div>
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
                  <summary className="cursor-pointer text-white/42">{t("tokenDetails")}</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl bg-black/20 p-3">{t("chainLabel")} {normalizedInput.chain}</div>
                  <div className="rounded-2xl bg-black/20 p-3">{t("sourceLabel")} {normalizedInput.source.replaceAll("_", " ")}</div>
                  <div className="rounded-2xl bg-black/20 p-3">{t("contractLabel")} {normalizedInput.contractAddress ?? t("unresolved")}</div>
                  <div className="rounded-2xl bg-black/20 p-3">{t("pairLabel")} {normalizedInput.pairAddress ?? t("notAvailable")}</div>
                </div></details>
              ) : null}
            </div>
            <div className="glass-panel rounded-[28px] p-6">
              <h2 className="text-xl font-semibold">{t("topReasons")}</h2>
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
                <summary className="cursor-pointer text-sm font-semibold text-white/68">{t("agentDetails")}</summary>
                <div className="mt-5 grid gap-3">
                  {report.agentCards.map((card) => (
                    <article key={card.agent} className="rounded-2xl bg-white/6 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold">{card.displayName}</div>
                          <div className="mt-1 text-xs text-white/42">{t("scoreKindScore", { scoreKind: card.scoreKind })}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-semibold">{card.score}</div>
                          <div className="text-xs text-white/42">{t("confidenceShort", { percent: Math.round(card.confidence * 100) })}</div>
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
                                    {key.replace(/([A-Z])/g, " $1")}: {formatMetaValue(value, t, format)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {card.missingData.length ? (
                        <div className="mt-3 rounded-xl border border-brand bg-brand-subtle px-3 py-2 text-xs leading-5 text-brand-muted">
                          {t("missingData")} {card.missingData.map((item) => item.field).join(", ")}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
            {whatWouldChange ? (
              <div className="glass-panel rounded-[28px] p-6">
                <h2 className="text-xl font-semibold">{t("whatWouldChangeDecision")}</h2>
                <div className="mt-3 rounded-2xl bg-white/6 p-4 text-sm leading-6 text-white/58">{whatWouldChange.detail}</div>
              </div>
            ) : null}
            {executionPreview ? (
              <details className="glass-panel rounded-lg p-5">
                <summary className="cursor-pointer text-sm font-semibold text-white/68">{t("executionDetails")}</summary>
                <h2 className="mt-2 text-xl font-semibold">{executionPreview.title}</h2>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    [t("suggestedAction"), localizedStatus(executionPreview.action ?? "no action")],
                    [t("tradeRequired"), localizedStatus(executionPreview.action === "swap" || executionPreview.action === "reduce_exposure" ? "yes" : "no")],
                    [t("quoteStatus"), localizedStatus(executionPreview.quote?.status ?? "not required")],
                    [t("simulationStatus"), localizedStatus(executionPreview.simulation?.status ?? "unavailable")],
                    [t("walletApproval"), localizedStatus(executionPreview.requiresApproval ? "required" : "not prepared")],
                    [t("serverCanSign"), localizedStatus(executionPreview.audit?.serverCanSign ? "yes" : "no")],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-white/6 p-4">
                      <div className="text-sm text-white/42">{label}</div>
                      <div className="mt-1 text-lg font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
                {executionPreview.blockedReason ? (
                  <div className="mt-4 rounded-2xl risk-tone-high p-4 text-sm leading-6">
                    {t("executableUnavailable", { reason: executionPreview.blockedReason })}
                  </div>
                ) : null}
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/58">
                  {t("autoExecuteOff")}
                </div>
              </details>
            ) : null}
            {scan.market ? (
              <details className="glass-panel rounded-lg p-5">
                <summary className="cursor-pointer text-sm font-semibold text-white/68">{t("marketDetails")}</summary>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mt-1 text-sm text-white/42">{t("dexPairData", { dex: scan.market.dexId ?? "DEX" })}</div>
                  </div>
                  {scan.market.pairUrl ? (
                    <a
                      href={scan.market.pairUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/62 transition hover:text-white"
                    >
                      {t("open")}
                    </a>
                  ) : null}
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    [t("liquidity"), formatUsd(scan.market.liquidityUsd, t, format)],
                    [t("volume24h"), formatUsd(scan.market.volume24hUsd, t, format)],
                    [t("fdv"), formatUsd(scan.market.fdvUsd, t, format)],
                    [t("change24h"), formatPercent(scan.market.priceChange24hPercent, t, format)],
                    [t("pairAge"), typeof scan.market.pairAgeDays === "number" ? t("days", { count: scan.market.pairAgeDays }) : t("notAvailable")],
                    [t("price"), formatUsd(scan.market.priceUsd, t, format)],
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
                <summary className="cursor-pointer text-sm font-semibold text-white/68">{t("dataQuality")}</summary>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mt-1 text-sm leading-6 text-white/48">{scan.dataQuality.detail}</div>
                  </div>
                    <span className="rounded-full border border-white/10 bg-white/7 px-3 py-1 text-xs text-white/54">
                      {localizedStatus(scan.dataQuality.mode)}
                    </span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    [t("connected"), scan.dataQuality.connectedSources],
                    [t("statusUnavailable"), scan.dataQuality.unavailableSources],
                    [t("mock"), scan.dataQuality.mockSources],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-white/6 p-4">
                      <div className="text-sm text-white/42">{label}</div>
                      <div className="mt-1 text-2xl font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
                {scan.dataQuality.mockSources > 0 ? (
                  <div className="mt-4 rounded-2xl risk-tone-high p-4 text-sm leading-6">
                    {t("mockDataNotice")}
                  </div>
                ) : null}
              </details>
            ) : null}
            {scan.dataQuality?.mode === "unavailable" || scan.dataQuality?.connectedSources === 0 ? (
              <NoDataState
                title={t("notEnoughConnectedSources")}
                detail={t("notEnoughSourcesDetail")}
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
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">{t("x402PaymentRequired")}</div>
                <h2 id={paymentModalTitleId} className="mt-1 text-xl font-semibold">{t("confirmDetailedPayment")}</h2>
              </div>
              <button
                type="button"
                onClick={cancelPayment}
                aria-label={t("closePaymentDetails")}
                className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 text-sm leading-6 text-white/60">
              {t("reviewExactTerms")}
            </p>

            <dl className="mt-5 space-y-3 rounded-xl border border-white/10 bg-black/22 p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-white/48">{t("assetLabel")}</dt>
                <dd className="font-medium">{paymentOption?.asset ?? paymentTerms?.asset ?? "USDC"}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-white/48">{t("amountLabel")}</dt>
                <dd className="font-medium">{paymentOption?.amount ?? t("shownByQuote")}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-white/48">{t("price")}</dt>
                <dd className="font-medium">{paymentTerms?.priceUsd ?? "$0.99"}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-white/48">{t("networkLabel")}</dt>
                <dd className="font-medium">{paymentOption?.network ?? paymentTerms?.network ?? t("shownByQuote")}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-white/48">{t("recipientX402")}</dt>
                <dd className="break-all font-mono text-xs text-white/80">
                  {paymentOption?.payTo ?? paymentTerms?.payTo ?? t("shownByQuote")}
                </dd>
              </div>
            </dl>

            {visibleResumeCandidate ? (
              <div className="mt-4 rounded-xl border border-brand/40 bg-brand-subtle p-4">
                <div className="flex items-start gap-2 text-sm text-white/72">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <span>{t("matchingReceipt")}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => resumeWithReceipt(visibleResumeCandidate)}
                    disabled={isBusy || actionsDisabled}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-brand px-5 text-xs font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t("resumeWithReceipt")}
                  </button>
                  <button
                    type="button"
                    onClick={discardStoredReceipt}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 px-5 text-xs text-white/60 transition hover:border-white/30 hover:text-white"
                  >
                    {t("signNewPayment")}
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
                {t("cancel")}
              </button>
              <button
                ref={paymentModalRef}
                type="button"
                onClick={confirmPayment}
                disabled={isPaymentWorking || actionsDisabled}
                className="h-11 rounded-full bg-brand px-6 text-sm font-semibold text-[var(--color-fg-inverse)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("confirmSignPayment")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
