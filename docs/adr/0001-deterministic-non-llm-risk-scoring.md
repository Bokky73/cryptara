# ADR 0001: Deterministic Non-LLM Risk Scoring

## Status
Accepted

## Context
Decentralized finance (DeFi) users and token analysis tools frequently suffer from hallucinated or unexplainable outputs when using Large Language Models (LLMs) to assess token safety. Institutional reviewers, auditors, and users require mathematical traceability: every score must be reproducible from observable onchain, liquidity, and security data.

## Decision
We enforce that all risk scoring in Cryptara is strictly deterministic:
1. No LLMs are used within the scoring or verdict calculation pipeline.
2. Risk scores (0-100%) are computed through weighted mathematical functions applied to verified provider signals (e.g. GoPlus, DexScreener, Horizon).
3. Missing data strictly incurs documented confidence penalties rather than synthetic approximations.
4. Any auditor can replay the calculation with the same inputs and arrive at the exact same risk percentage and verdict.

## Consequences
- **Positive**: Eliminates hallucination, enables audit replay, provides 100% predictable compliance and testing.
- **Trade-off**: Requires explicit signal mapping for every supported metric and token model.
