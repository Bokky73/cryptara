# Risk Scoring Methodology & Agent Weighting Specification

## 1. Overview & Architecture

Cryptara evaluates blockchain token risk through a **deterministic, multi-agent evaluation pipeline**. Unlike probabilistic LLM-based scoring engines, Cryptara's risk calculations are mathematical, reproducible, and verifiable.

```
+-----------------------------------------------------------------------------------+
|                            Multi-Stage Risk Pipeline                              |
+-----------------------------------------------------------------------------------+
| 1. Identity Resolution: Normalizes token inputs (address, ticker, pair URL).      |
| 2. Specialist Agents: Parallel execution across independent signal domains:       |
|    - Onchain (Contract Guard): GoPlus flags, sellability, taxes, liquidity, LP    |
|    - Social (Social Scout): Phishing scanner, domain link verification, metrics   |
|    - News (News Oracle): Catalyst discovery, scam/exploit reports                 |
|    - Portfolio (Portfolio Keeper): Wallet exposure, concentration, stable reserve |
| 3. Decision Core: Mathematical aggregation, conflict resolution, score & verdict  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Agent Weighting Matrix

The Decision Agent weights specialist agent outputs based on execution mode and asset maturity:

| Specialist Agent | Pre-Buy / Scan Mode | Established Asset Mode | Holding / Portfolio Review |
|------------------|---------------------|------------------------|----------------------------|
| **Onchain**      | 54%                 | 80%                    | 45%                        |
| **Portfolio**    | 12% (2% if absent)  | 4% (0% if absent)      | 25%                        |
| **News**         | 17%                 | 8%                     | 15%                        |
| **Social**       | 14%                 | 6%                     | 10%                        |
| **Execution**    | 3%                  | 2%                     | 5%                         |

Weights are normalized dynamically when specific agents (e.g., Portfolio when evaluating an unheld token) are omitted.

---

## 3. Score Scale & Missing-Data Penalties

- **Score Scale**: `0` to `100`, where:
  - `0–24`: Low Risk
  - `25–49`: Watch Risk
  - `50–74`: High Risk
  - `75–100`: Critical Risk

### Missing-Data & Source Coverage Rules
Missing signals penalize the score to prevent deceptive high-confidence ratings:
- **Zero Connected Sources**: Clamps score to `Math.max(score, 72)` and caps confidence at `0.32`.
- **Coverage Ratio < 0.35**: Clamps score to `Math.max(score, 66)`.
- **Coverage Ratio < 0.50**: Clamps score to `Math.max(score, 58)`.
- **Missing DexScreener**: Adds `+52` risk impact for unverified market liquidity.
- **Missing GoPlus Security**: Adds `+58` risk impact for unverified contract security.

---

## 4. Confidence Score Formula

Decision confidence is calculated deterministically as:

$$\text{RawConfidence} = (\bar{C}_{\text{agents}} \times 0.35) + (\text{Coverage} \times 0.25) + (\text{Identity} \times 0.15) + (\text{Freshness} \times 0.10) + (\text{Agreement} \times 0.15)$$

$$\text{FinalConfidence} = \min(0.90, \max(0.18, \text{RawConfidence} - \text{ConflictPenalty}))$$

Where:
- $\bar{C}_{\text{agents}}$ is the mean confidence of contributing agents.
- $\text{Coverage}$ is the proportion of connected data sources.
- $\text{Identity}$ is the identity resolution confidence score.
- $\text{Freshness}$ reflects timestamp recency ($>0.95$ for $<1\text{h}$, down to $0.35$ for $>48\text{h}$).
- $\text{Agreement}$ measures score convergence across specialist agents.
- $\text{ConflictPenalty} = \min(0.28, \text{conflicts} \times 0.07)$.

---

## 5. Verdict Threshold Matrix

The final recommendation is determined by threshold gates:

| Final Verdict | Criteria |
|---------------|----------|
| **Buy Small** | Risk Score $\le 24$ AND Confidence $\ge 0.62$ AND no critical blockers |
| **Watch** | Risk Score between $25$ and $49$ without critical blockers |
| **Reduce Exposure** | High portfolio concentration or exit liquidity degradation |
| **Avoid** | Critical blockers present (honeypot, unsellable, active blacklist, verified drainer) |
| **Manual Review** | Confidence $< 0.42$ OR unresolved identity/simulation conflict |

---

## 6. Determinism & Replay Verification

Every report is reproducible. To verify an evaluation independently:
1. Extract the `report_hash` from the report metadata.
2. Replay the input parameters using the replay harness:
   ```bash
   npm run test:agent-replay
   ```
3. Compare the generated hash and agent scores against the original report.

---

## 7. Disclaimer & Limitations

> **Informational Only — Not Financial Advice.**
> Cryptara's risk reports are automated computational assessments based on public onchain and offchain data sources. They do not constitute investment advice or guarantees of financial safety.
