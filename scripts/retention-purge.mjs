#!/usr/bin/env node
/**
 * scripts/retention-purge.mjs
 *
 * Scheduled retention purge runner for Cryptara.
 * Intended to be executed by a cron job, container entrypoint, or CI schedule.
 *
 * Usage:
 *   node scripts/retention-purge.mjs
 *   DATABASE_URL=postgres://... node scripts/retention-purge.mjs
 *   DRY_RUN=true node scripts/retention-purge.mjs
 *
 * Exit codes:
 *   0  – purge completed (with or without rows removed)
 *   1  – purge encountered a fatal error
 *   2  – purge completed but with partial Postgres failure (non-fatal)
 *
 * Environment variables (all optional):
 *   DATABASE_URL                            – Postgres connection string
 *   RETENTION_AGENT_RUNS_DAYS              – Override agent_runs retention (days)
 *   RETENTION_ALERT_OBSERVATIONS_DAYS      – Override alert_observations retention (days)
 *   RETENTION_ALERTS_DAYS                  – Override alerts retention (days)
 *   RETENTION_WATCHLIST_RUNS_DAYS          – Override watchlist_scan_runs retention (days)
 *   RETENTION_TRANSACTIONS_UNLINK_DAYS     – Override transactions anonymization threshold
 *   RETENTION_X402_RECEIPTS_UNLINK_DAYS    – Override x402_payment_receipts threshold
 *   DRY_RUN                                – Set to "true" to log what would be purged without deleting
 *   PURGE_BATCH_SIZE                        – Max rows per DELETE/UPDATE statement (default: 500)
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDryRun = process.env.DRY_RUN === "true";
const batchSize = parseInt(process.env.PURGE_BATCH_SIZE ?? "500", 10);

// ─────────────────────────────────────────────────────────────────────────────
// Retention windows (days) — read from environment, with production defaults
// ─────────────────────────────────────────────────────────────────────────────

function parseEnvDays(envName, defaultValue) {
  const raw = process.env[envName];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const config = {
  agentRunsDays: parseEnvDays("RETENTION_AGENT_RUNS_DAYS", 90),
  alertObservationsDays: parseEnvDays("RETENTION_ALERT_OBSERVATIONS_DAYS", 30),
  alertsDays: parseEnvDays("RETENTION_ALERTS_DAYS", 90),
  watchlistRunsDays: parseEnvDays("RETENTION_WATCHLIST_RUNS_DAYS", 90),
  transactionsUnlinkDays: parseEnvDays("RETENTION_TRANSACTIONS_UNLINK_DAYS", 365),
  x402ReceiptsUnlinkDays: parseEnvDays("RETENTION_X402_RECEIPTS_UNLINK_DAYS", 1095),
};

function cutoff(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pretty logging
// ─────────────────────────────────────────────────────────────────────────────

function log(level, message, data) {
  const ts = new Date().toISOString();
  const prefix = { info: "ℹ", ok: "✅", warn: "⚠️", error: "❌" }[level] ?? "·";
  console.log(`[${ts}] ${prefix}  ${message}${data ? "\n" + JSON.stringify(data, null, 2) : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Postgres purge (bounded batches, no long-running locks)
// ─────────────────────────────────────────────────────────────────────────────

async function purgePostgres() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log("warn", "DATABASE_URL not set — skipping Postgres purge (in-memory only).");
    return [];
  }

  // Dynamically import pg so the script can run without node_modules if DB isn't configured
  let pg;
  try {
    pg = await import("pg");
  } catch {
    log("warn", "pg package not found — skipping Postgres purge.");
    return [];
  }

  const client = new pg.default.Client({ connectionString: databaseUrl });
  await client.connect();

  const results = [];

  async function batchDelete(table, timestampCol, cutoffDate, label) {
    if (isDryRun) {
      const { rows } = await client.query(
        `SELECT count(*) as cnt FROM ${table} WHERE ${timestampCol} < $1`,
        [cutoffDate],
      );
      const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
      log("info", `[DRY RUN] Would delete ${cnt} rows from ${table} (${label})`);
      results.push({ table, action: "deleted", rowsPurged: 0, dryRunWouldPurge: cnt });
      return;
    }

    let totalDeleted = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { rowCount } = await client.query(
        `DELETE FROM ${table}
           WHERE ${timestampCol} < $1
             AND id IN (
               SELECT id FROM ${table}
               WHERE ${timestampCol} < $1
               LIMIT $2
             )`,
        [cutoffDate, batchSize],
      );
      totalDeleted += rowCount ?? 0;
      if ((rowCount ?? 0) < batchSize) break;
    }
    log(totalDeleted > 0 ? "ok" : "info", `Purged ${totalDeleted} rows from ${table}`);
    results.push({ table, action: "deleted", rowsPurged: totalDeleted });
  }

  async function batchAnonymize(table, walletCols, timestampCol, cutoffDate, label) {
    const setClause = walletCols.map((c) => `${c} = NULL`).join(", ");
    if (isDryRun) {
      const { rows } = await client.query(
        `SELECT count(*) as cnt FROM ${table} WHERE ${timestampCol} < $1 AND (${walletCols.map((c, i) => `${c} IS NOT NULL`).join(" OR ")})`,
        [cutoffDate],
      );
      const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
      log("info", `[DRY RUN] Would anonymize ${cnt} rows in ${table} (${label})`);
      results.push({ table, action: "anonymized", rowsPurged: 0, dryRunWouldPurge: cnt });
      return;
    }

    let totalUpdated = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { rowCount } = await client.query(
        `UPDATE ${table}
            SET ${setClause}
          WHERE ${timestampCol} < $1
            AND (${walletCols.map((c) => `${c} IS NOT NULL`).join(" OR ")})
            AND id IN (
              SELECT id FROM ${table}
              WHERE ${timestampCol} < $1
                AND (${walletCols.map((c) => `${c} IS NOT NULL`).join(" OR ")})
              LIMIT $2
            )`,
        [cutoffDate, batchSize],
      );
      totalUpdated += rowCount ?? 0;
      if ((rowCount ?? 0) < batchSize) break;
    }
    log(totalUpdated > 0 ? "ok" : "info", `Anonymized ${totalUpdated} rows in ${table}`);
    results.push({ table, action: "anonymized", rowsPurged: totalUpdated });
  }

  try {
    // Hard-delete tables
    await batchDelete("agent_runs", "created_at", cutoff(config.agentRunsDays), "agent_runs");
    await batchDelete("alert_observations", "created_at", cutoff(config.alertObservationsDays), "alert_observations");
    await batchDelete("alerts", "triggered_at", cutoff(config.alertsDays), "alerts");
    await batchDelete("watchlist_scan_runs", "scanned_at", cutoff(config.watchlistRunsDays), "watchlist_scan_runs");

    // Anonymize tables
    await batchAnonymize(
      "transactions",
      ["wallet_address", "source_account"],
      "created_at",
      cutoff(config.transactionsUnlinkDays),
      "transactions",
    );
    await batchAnonymize(
      "x402_payment_receipts",
      ["wallet_address", "payer"],
      "created_at",
      cutoff(config.x402ReceiptsUnlinkDays),
      "x402_payment_receipts",
    );
  } finally {
    await client.end();
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  log("info", `Cryptara — retention purge${isDryRun ? " (DRY RUN)" : ""}`);
  log("info", "Effective retention windows:", config);

  const startMs = Date.now();
  let exitCode = 0;

  let pgResults = [];
  try {
    pgResults = await purgePostgres();
  } catch (err) {
    log("error", "Postgres purge failed", { error: err.message });
    exitCode = 2;
  }

  const totalPurged = pgResults.reduce((s, r) => s + r.rowsPurged, 0);
  const elapsedMs = Date.now() - startMs;

  log(exitCode === 0 ? "ok" : "warn", `Purge complete in ${elapsedMs}ms — ${totalPurged} rows affected`, {
    pgResults,
    dryRun: isDryRun,
    elapsedMs,
  });

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[retention-purge] Fatal error:", err);
  process.exit(1);
});
