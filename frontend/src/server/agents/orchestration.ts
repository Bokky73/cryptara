import { createRunDeadline, withinAgentDeadline, AgentDeadlineError } from "./deadline";
import type { AgentInputIdentity, AgentResult, AgentRunRecord, PortfolioSnapshot } from "@/server/types";
import { runDecisionAgent } from "@/server/agents/decision";
import { runExecutionAgent } from "@/server/agents/execution";
import { runNewsAgent } from "@/server/agents/news";
import { runOnchainAgent } from "@/server/agents/onchain";
import { runPortfolioAgent } from "@/server/agents/portfolio";
import { runSocialAgent } from "@/server/agents/social";
import { runAgentSafely } from "@/server/agents/shared";
import { createAgentRunId, createRunStepMetadata, getRunPartialStatus } from "@/server/agents/orchestrationState";
import { resolveTokenIdentity } from "@/server/identity/tokenIdentity";
import { createAgentRunRecord, getUserRuleRecord } from "@/server/storage";
import { createTranscriptRecorder, type AgentRunTranscript } from "@/server/evaluation/harness";
import { withSpan } from "@/server/observability/tracing";

export type AgentRunMode = "portfolio_review" | "token_scan" | "pre_buy_check" | "holding_review" | "execution_prepare" | "discovery_candidate";

type AgentOrchestrationInput = {
  mode: AgentRunMode;
  walletAddress?: string;
  identity?: AgentInputIdentity;
  portfolio?: PortfolioSnapshot;
  persistRun?: boolean;
  /** Explicit evaluation timestamp; when omitted a single clock read is captured for the whole run. */
  evaluatedAt?: string;
  discoveryContext?: {
    source?: string;
    metrics?: Record<string, unknown>;
  };
};

type AgentOrchestrationResult = {
  mode: AgentRunMode;
  identity?: ReturnType<typeof resolveTokenIdentity>;
  dependencyGraph: Record<string, string[]>;
  results: AgentResult[];
  decision: AgentResult;
  runRecord?: AgentRunRecord;
  runId: string;
  evaluatedAt: string;
  partialStatus: ReturnType<typeof getRunPartialStatus>;
  transcript?: AgentRunTranscript;
};

function getRiskiestHolding(portfolio?: PortfolioSnapshot): AgentInputIdentity | undefined {
  const holding = [...(portfolio?.holdings ?? [])].sort((left, right) => {
    const riskGap = right.riskScore - left.riskScore;

    return riskGap !== 0 ? riskGap : right.allocationPercent - left.allocationPercent;
  })[0];

  if (!holding) {
    return undefined;
  }

  return {
    chain: holding.chainId ?? holding.chainName,
    contractAddress: holding.tokenAddress,
    symbol: holding.symbol,
    tokenName: holding.name,
  };
}

function getCandidateHoldings(portfolio?: PortfolioSnapshot): AgentInputIdentity[] {
  return [...(portfolio?.holdings ?? [])]
    .sort((left, right) => {
      const riskGap = right.riskScore - left.riskScore;

      return riskGap !== 0 ? riskGap : right.allocationPercent - left.allocationPercent;
    })
    .slice(0, 3)
    .map((holding) => ({
      chain: holding.chainId ?? holding.chainName,
      contractAddress: holding.tokenAddress.startsWith("0x") ? holding.tokenAddress : undefined,
      symbol: holding.symbol,
      tokenName: holding.name,
    }));
}

async function runWithRunMetadata(runId: string, deadline: number, agent: AgentResult["agent"], task: () => Promise<AgentResult>, timeoutMs = 12_000) {
  let deadlineExceeded = false;
  const result = await withSpan(`agent.${agent}`, { agentName: agent, runId }, () =>
    runAgentSafely(agent, async () => {
      try { return await withinAgentDeadline(deadline, timeoutMs, task); }
      catch (error) { deadlineExceeded = error instanceof AgentDeadlineError; throw error; }
    }),
  );

  return {
    ...result,
    rawSignals: {
      ...(result.rawSignals ?? {}),
      orchestration: { ...createRunStepMetadata(runId, agent), outcome: deadlineExceeded ? "skipped-by-deadline" : "completed" },
    },
  };
}

async function runTokenSpecialists(identity: ReturnType<typeof resolveTokenIdentity>, runId: string, deadline: number, evaluatedAt: string) {
  const [onchain, news, social] = await Promise.all([
    runWithRunMetadata(runId, deadline, "onchain", () =>
      runOnchainAgent({
        chain: identity.chain,
        contractAddress: identity.contractAddress,
        evaluatedAt,
      }),
    ),
    runWithRunMetadata(runId, deadline, "news", () =>
      runNewsAgent({
        tokenName: identity.tokenName,
        symbol: identity.symbol,
        contractAddress: identity.contractAddress,
        websiteUrl: identity.websiteUrl,
        chain: identity.chain,
        evaluatedAt,
      }),
    ),
    runWithRunMetadata(runId, deadline, "social", () =>
      runSocialAgent({
        tokenName: identity.tokenName,
        symbol: identity.symbol,
        contractAddress: identity.contractAddress,
        websiteUrl: identity.websiteUrl,
        twitterUrl: identity.twitterUrl,
        telegramUrl: identity.telegramUrl,
        evaluatedAt,
      }),
    ),
  ]);

  return [onchain, news, social];
}

function getDependencyGraph(mode: AgentRunMode) {
  return {
    identity_resolver: ["onchain", "news", "social"],
    portfolio: mode === "portfolio_review" ? ["token_candidates", "decision"] : mode === "holding_review" || mode === "execution_prepare" ? ["identity_resolver", "decision"] : mode === "discovery_candidate" ? ["identity_resolver", "decision"] : [],
    token_candidates: mode === "portfolio_review" ? ["identity_resolver"] : [],
    onchain: ["decision"],
    news: ["decision"],
    social: ["decision"],
    decision: mode === "execution_prepare" ? ["execution"] : [],
    execution: mode === "execution_prepare" ? [] : ["never"],
  };
}

export async function runAgentOrchestration(input: AgentOrchestrationInput): Promise<AgentOrchestrationResult> {
  const runId = createAgentRunId();
  const deadline = createRunDeadline();
  // Capture a single evaluation timestamp for the whole run so replay is pure given input snapshots.
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const chainFamily = input.identity?.chain?.startsWith("stellar") ? "stellar" : "evm";
  const network = input.identity?.chain ?? "legacy-evm";
  const recorder = createTranscriptRecorder({
    runId,
    chainFamily,
    network,
    assetIdentity: { asset: input.identity?.symbol ?? "portfolio" },
    inputSnapshot: { mode: input.mode, walletAddress: input.walletAddress, identity: input.identity, evaluatedAt },
  }, { enabled: process.env.AGENT_REPLAY_RECORDING === "1" });

  return withSpan("agent.orchestration", { mode: input.mode, runId, chainFamily, network }, async () => {
    const results: AgentResult[] = [];
    let identityInput = input.identity;
    const candidateInputs: AgentInputIdentity[] = [];

    if (input.mode === "portfolio_review" || input.mode === "holding_review" || input.mode === "execution_prepare") {
      const portfolioResult = await runWithRunMetadata(runId, deadline, "portfolio", () => runPortfolioAgent(input.walletAddress, evaluatedAt), 8_000);
      results.push(portfolioResult);
      identityInput = identityInput ?? getRiskiestHolding(input.portfolio);
      candidateInputs.push(...getCandidateHoldings(input.portfolio));
    }

    const identity = identityInput ? resolveTokenIdentity(identityInput) : undefined;

    // Load user rules once so Decision and Execution share the same versioned snapshot
    const userRules = input.walletAddress ? await getUserRuleRecord(input.walletAddress) : undefined;

    if (input.mode === "portfolio_review" && candidateInputs.length > 0) {
      for (const candidate of candidateInputs) {
        const candidateIdentity = resolveTokenIdentity(candidate);

        results.push(...(await runTokenSpecialists(candidateIdentity, runId, deadline, evaluatedAt)));
      }
    } else if (identity && input.mode !== "execution_prepare") {
      results.push(...(await runTokenSpecialists(identity, runId, deadline, evaluatedAt)));
    }

    const isDeadlineSkipped = (result: AgentResult) =>
      (result.rawSignals?.orchestration as { outcome?: string } | undefined)?.outcome === "skipped-by-deadline";
    const decision = runDecisionAgent({
      results: results.filter(result => !isDeadlineSkipped(result)),
      context: {
        mode: input.mode,
        walletAddress: input.walletAddress,
        userAlreadyOwnsToken: input.mode === "portfolio_review" || input.mode === "holding_review" || input.mode === "execution_prepare",
        tokenSymbol: identity?.symbol,
        evaluatedAt,
        discoveryContext: input.mode === "discovery_candidate"
          ? {
              chainFamily: identity?.chain?.startsWith("stellar") ? "stellar" : "evm",
              source: input.discoveryContext?.source,
              metrics: input.discoveryContext?.metrics,
            }
          : undefined,
      },
    });

    results.push(decision);

    if (input.mode === "execution_prepare") {
      const execution = await runWithRunMetadata(runId, deadline, "execution", () =>
        runExecutionAgent({
          decision,
          walletAddress: input.walletAddress,
          userRules,
          evaluatedAt,
        }),
      );
      results.push(execution);
    }

    const partialStatus = getRunPartialStatus(results);
    const transcript = recorder.finalize({ results, decision });

    let runRecord: AgentRunRecord | undefined;
    if (input.persistRun) {
      runRecord = await createAgentRunRecord({
        runId,
        mode: input.mode,
        walletAddress: input.walletAddress ?? "",
        identity,
        results,
        decision,
        partialStatus,
        evaluatedAt,
      });
    }

    return {
      mode: input.mode,
      identity,
      dependencyGraph: getDependencyGraph(input.mode),
      results,
      decision,
      runRecord,
      runId,
      evaluatedAt,
      partialStatus,
      transcript,
    };
  });
}
