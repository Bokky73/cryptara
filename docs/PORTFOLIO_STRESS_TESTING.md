# Portfolio Stress Testing

This document details the portfolio stress testing functionality.

## Overview

The Portfolio Stress Testing feature allows users to simulate various market scenarios on their wallet's holdings to understand the potential impact on their portfolio's value and risk. This functionality is crucial for risk management and scenario planning in volatile markets.

## Architecture

The system is composed of the following pieces:

1.  **Stress Testing API Endpoint (`/api/portfolio/stress/route.ts`)**:
    *   A `POST` endpoint that accepts a `PortfolioSnapshot` and a `scenarioId`.
    *   It retrieves the predefined scenario configuration.
    *   It applies the logic using `applyStressScenario` from `stress.ts`.
    *   Returns a `PortfolioStressResult` containing the `baseSnapshot`, `stressedSnapshot`, `delta`, and `assumptions`.

2.  **Scenarios Configuration (`scenarios.ts`)**:
    *   Defines scenarios such as "20% Market Crash", "Stablecoin Depeg", and "Memecoin Collapse".
    *   Each scenario specifies changes (e.g., price multipliers, fixed prices, or depegs) for targets (e.g., "all", "stablecoins", "memecoins").

3.  **Stress Logic (`stress.ts`)**:
    *   Iterates through portfolio holdings.
    *   Applies the specified price manipulations.
    *   Calculates the new total value and computes the deltas between the original and stressed portfolios.

4.  **UI Component (`PortfolioStressPanel.tsx`)**:
    *   Recalculates locally with the same `applyStressScenario` function as scenario controls change; no request is made.
    *   Offers the built-in scenarios plus bounded sliders for market drawdown (-10% to -80%, stablecoins exempt), a uniform liquidity haircut (0–90% of exit value) and a depeg of one holding or all stablecoins (relative to the current price).
    *   Shows a before/after bar chart, and an allocation table flagged against the wallet's `user_rules` (`maxMemeExposurePercent`, `minStableReservePercent`, `maxRiskScore`). If rules cannot be loaded, thresholds are reported as not evaluated.
    *   Saves up to 10 presets in local storage (removed by wallet data erasure) and exports a Markdown summary.

## Missing inputs

Holdings without a usable price are excluded from both totals and reported with a `null` impact, never zero. Stellar assets with unknown liquidity are listed in `missingInputs`. EVM holdings only carry a modelled liquidity score, so they are marked `estimated`. Token risk scores are not re-modelled under stress.

## Accessibility

The `PortfolioStressPanel` is designed with accessibility in mind:
*   Includes `aria-label` for semantic grouping.
*   Uses `aria-live="polite"` and `aria-atomic="true"` on the results container to announce changes to screen readers.
*   Form elements have accessible labels.
*   Loading states use `aria-busy` and `aria-hidden` properly.
*   Error messages utilize the `role="alert"` attribute.

## Future Enhancements

*   Integration with historical price data for backtesting.
*   Agent-driven recommendations based on stress test vulnerabilities (e.g., "Your portfolio is highly sensitive to a stablecoin depeg, consider diversifying stablecoins").
