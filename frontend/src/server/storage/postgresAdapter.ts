/**
 * Postgres adapter for the V3 alert engine. Optional: when a connection
 * string (SUPABASE_DB_URL, POSTGRES_URL, or DATABASE_URL) is present and
 * `pg` is installed, the alert storage functions dual-write rows to the
 * Postgres tables defined by the canonical migration tree in
 * `db/migrations/`.
 *
 * Design notes:
 *  - Reads stay in-memory so existing synchronous callers (routes,
 *    fixtures, dashboards) keep working without async refactors.
 *  - Writes go through memory immediately so the caller sees the row,
 *    then fire a best-effort mirror write to Postgres. When the mirror
 *    fails the row stays in memory and `getStorageHealth()` flags
 *    `persistent: false` so operators see the degraded state.
 *  - All mirror writes share a single promise chain so the natural
 *    call order (`createAlertRule` -> `createAlert` -> `createAlertDelivery`)
 *    is preserved across the Postgres boundary and the alerts FOREIGN
 *    KEY on `alerts.rule_id references alert_rules(id)` cannot fire
 *    before the rule row exists.
 *  - If the very first connection attempt fails the cached `connectPromise`
 *    is reset so the next write can retry instead of being permanently
 *    silenced.
 *  - The adapter no longer executes raw DDL on the runtime request path.
 *    Schema changes are applied out-of-band by `scripts/migrate.mjs`
 *    against the single canonical migration tree (`db/migrations/`).
 *    On connect we only *verify* that the database has the expected
 *    schema version recorded in `schema_migrations`; a mismatch marks
 *    the adapter unhealthy and refuses mirror writes rather than
 *    silently running `schema.sql`.
 *
 * This file does not assume `pg` is present. If the dependency is not
 * installed we fall back to a "schema connection string detected but no
 * pg client" state that `getStorageHealth()` exposes honestly.
 */

import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type {
  Alert,
  AlertDelivery,
  AlertObservation,
  AlertRule,
  ChainFamily,
  DiscoveryClassification,
  NotificationPreferences,
  TransactionLifecycleEvent,
  TransactionLifecycleStatus,
  TransactionRecord,
  WatchlistEntry,
  WatchlistScanRun,
} from "@/server/types";

type MaybePgPool = {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
  end(): Promise<void>;
};

type PgModule = {
  Pool: new (config: { connectionString: string; ssl?: { rejectUnauthorized: boolean } | false }) => MaybePgPool;
};

let loadedPgModule: PgModule | null | undefined;

async function tryLoadPg(): Promise<PgModule | null> {
  if (loadedPgModule !== undefined) return loadedPgModule;

  try {
    // pathToFileURL handles spaces and odd characters on disk; safer than
    // a synthetic `process.cwd()/pg` string.
    const localRequire = createRequire(pathToFileURL(`${process.cwd()}/_pg_loader.cjs`).href);
    const mod = localRequire("pg") as PgModule;
    loadedPgModule = mod;

    return mod;
  } catch (error) {
    loadedPgModule = null;
    // Surface the load error so start-up health reflects it instead of
    // reporting a falsely "installed" state that never tries to connect.
    lastPgLoadError = error instanceof Error ? error.message : String(error);

    return null;
  }
}

let lastPgLoadError: string | null = null;

function resolveConnectionString(): string | undefined {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    undefined
  );
}

/**
 * Canonical migration list. This mirrors the ordered, idempotent
 * migrations in `db/migrations/` (the single source of truth) and is
 * used only to know which version the runtime expects. Schema DDL is
 * applied by `scripts/migrate.mjs`, never by this adapter.
 *
 * Keep this list in sync with `db/migrations/*.up.sql`; the
 * `scripts/schema-drift-check.mjs` guard fails CI when they diverge.
 */
export const CANONICAL_MIGRATIONS: ReadonlyArray<{ name: string; checksum: string }> = [
  { name: "0001_init", checksum: "" },
  { name: "20260728_chain_aware_identity", checksum: "" },
  { name: "20260912_watchlist_collections", checksum: "" },
];

/** Name of the migration the runtime expects to be applied. */
export const EXPECTED_SCHEMA_VERSION: string =
  CANONICAL_MIGRATIONS[CANONICAL_MIGRATIONS.length - 1]?.name ?? "";

type PersistedAlertRule = Pick<
  AlertRule,
  | "id"
  | "walletAddress"
  | "triggerType"
  | "observationKey"
  | "threshold"
  | "hysteresis"
  | "cooldownMinutes"
  | "direction"
  | "severity"
  | "enabled"
  | "createdAt"
  | "updatedAt"
>;

type PersistedAlertObservation = Pick<
  AlertObservation,
  | "id"
  | "walletAddress"
  | "triggerType"
  | "observationKey"
  | "value"
  | "direction"
  | "createdAt"
  | "incompleteData"
> & { evidence: AlertObservation["evidence"] };

type PersistedAlert = Pick<
  Alert,
  | "id"
  | "walletAddress"
  | "ruleId"
  | "triggerType"
  | "observationKey"
  | "status"
  | "severity"
  | "message"
  | "beforeValue"
  | "afterValue"
  | "evidenceBefore"
  | "evidenceAfter"
  | "evidenceData"
  | "triggeredAt"
  | "recoveredAt"
  | "acknowledgedAt"
>;

type PersistedWatchlistEntry = Pick<
  WatchlistEntry,
  | "id"
  | "walletAddress"
  | "identityKey"
  | "chain"
  | "network"
  | "contractAddress"
  | "pairAddress"
  | "symbol"
  | "tokenName"
  | "assetKey"
  | "issuer"
  | "assetType"
  | "source"
  | "note"
  | "createdAt"
  | "lastScannedAt"
  | "latestScanRunId"
  | "latestClassification"
  | "latestScore"
  | "latestStatus"
>;

type PersistedWatchlistScanRun = Pick<
  WatchlistScanRun,
  | "id"
  | "entryId"
  | "walletAddress"
  | "identityKey"
  | "agentRunId"
  | "classification"
  | "classificationReasons"
  | "confidence"
  | "score"
  | "sourceLineage"
  | "missingData"
  | "riskReport"
  | "status"
  | "previousRunId"
  | "scannedAt"
>;

type PersistedWatchlistEntryLatestScan = {
  classification: DiscoveryClassification;
  score: number;
  scannedAt: string;
  status: WatchlistScanRun["status"];
  scanRunId: string;
};

type PersistedAlertDelivery = Pick<
  AlertDelivery,
  | "id"
  | "alertId"
  | "walletAddress"
  | "channel"
  | "status"
  | "errorDetail"
  | "sanitizedPayload"
  | "attemptCount"
  | "createdAt"
  | "sentAt"
>;

type PersistedNotificationPreferences = Pick<
  NotificationPreferences,
  "id" | "walletAddress" | "chainFamily" | "network" | "channels" | "quietHours" | "digestCadence" | "dedupeWindowMinutes" | "updatedAt"
>;

type SchemaVerification = {
  ok: boolean;
  detail: string;
  expectedVersion: string;
  appliedVersion: string | null;
  appliedChecksum: string | null;
};

class PostgresStorageAdapter {
  private pool: MaybePgPool | null = null;
  private connectionString: string | undefined = resolveConnectionString();
  private verified = false;
  private connected = false;
  private connectedAt: string | null = null;
  private lastError: string | null = null;
  private mirrorFailureCount = 0;
  private mirrorSuccessCount = 0;
  private connectPromise: Promise<{ ok: boolean; detail: string }> | null = null;
  private schemaVerification: SchemaVerification | null = null;

  /**
   * Single promise chain every mirror write is appended to. Ensures
   * foreign-key-sensitive tables (alerts.rule_id, alert_deliveries.alert_id)
   * are inserted in the same order the in-memory store is mutated, so the
   * mirror can never violate the rule → alert → delivery dependency.
   */
  private mirrorQueue: Promise<unknown> = Promise.resolve();

  isConfigured(): boolean {
    return Boolean(this.connectionString);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getHealthSnapshot() {
    // pgInstalled is a tri-state: true (module loaded successfully),
    // false (load attempted but failed), null (never attempted). This
    // lets health consumers distinguish "we don't know yet" from
    // "we tried and pg is broken".
    const pgInstalled: true | false | null =
      loadedPgModule === undefined ? null : loadedPgModule === null ? false : true;

    return {
      connectionStringPresent: this.isConfigured(),
      pgInstalled,
      pgLoadError: lastPgLoadError,
      connected: this.connected,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      mirrorSuccessCount: this.mirrorSuccessCount,
      mirrorFailureCount: this.mirrorFailureCount,
      expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
      appliedSchemaVersion: this.schemaVerification?.appliedVersion ?? null,
      appliedSchemaChecksum: this.schemaVerification?.appliedChecksum ?? null,
      schemaVerified: this.schemaVerification?.ok ?? false,
      schemaVerificationDetail: this.schemaVerification?.detail ?? null,
    };
  }

  async connect(): Promise<{ ok: boolean; detail: string }> {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.doConnect();

    return this.connectPromise;
  }

  private async doConnect(): Promise<{ ok: boolean; detail: string }> {
    if (!this.connectionString) {
      return { ok: false, detail: "No SUPABASE_DB_URL/POSTGRES_URL/DATABASE_URL configured." };
    }

    const pg = await tryLoadPg();

    if (!pg) {
      this.lastError = lastPgLoadError ?? "pg dependency not installed in this deployment bundle.";

      return { ok: false, detail: this.lastError };
    }

    if (this.pool) {
      return { ok: this.connected, detail: "Already connected." };
    }

    try {
      this.pool = new pg.Pool({
        connectionString: this.connectionString,
        ssl: process.env.SUPABASE_DB_URL ? { rejectUnauthorized: false } : false,
      });
      await this.pool.query("SELECT 1");
      this.connected = true;
      this.connectedAt = new Date().toISOString();
      this.lastError = null;
      const verification = await this.verifySchemaVersion();
      this.schemaVerification = verification;

      if (!verification.ok) {
        this.connected = false;
        await this.safeEnd();
        // Allow the next call to try again: the cached failure potential
        // would otherwise mask transient blips.
        this.connectPromise = null;

        return { ok: false, detail: verification.detail };
      }

      return { ok: true, detail: "Connected; schema version verified." };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.connected = false;
      await this.safeEnd();
      this.connectPromise = null;

      return { ok: false, detail: this.lastError };
    }
  }

  private async safeEnd() {
    if (!this.pool) return;
    try {
      await this.pool.end();
    } catch {
      // ignore — already closed or never opened
    }
    this.pool = null;
  }

  /**
   * Verify that the database has the expected schema version recorded in
   * `schema_migrations`. This intentionally does NOT execute any DDL:
   * migrations are applied out-of-band by `scripts/migrate.mjs`. A
   * mismatch (missing table, missing migration, or a checksum drift on
   * the expected migration) marks the adapter unhealthy so mirror writes
   * are refused instead of running against a stale schema.
   */
  private async verifySchemaVersion(): Promise<SchemaVerification> {
    const expectedVersion = EXPECTED_SCHEMA_VERSION;

    if (this.verified && this.schemaVerification) return this.schemaVerification;

    if (!this.pool) {
      return {
        ok: false,
        detail: "No pool available for schema verification.",
        expectedVersion,
        appliedVersion: null,
        appliedChecksum: null,
      };
    }

    try {
      const result = await this.pool.query(
        `SELECT name, checksum
           FROM schema_migrations
          ORDER BY name DESC
          LIMIT 1`,
      );
      const row = (result.rows[0] ?? null) as Record<string, unknown> | null;
      const appliedVersion = row && typeof row.name === "string" ? row.name : null;
      const appliedChecksum = row && typeof row.checksum === "string" ? row.checksum : null;

      if (!appliedVersion) {
        const detail = `schema_migrations is empty; expected ${expectedVersion}. Run \`node scripts/migrate.mjs\`.`;
        this.lastError = detail;

        return { ok: false, detail, expectedVersion, appliedVersion: null, appliedChecksum: null };
      }

      if (appliedVersion !== expectedVersion) {
        const detail = `Schema version mismatch: applied ${appliedVersion}, expected ${expectedVersion}. Run \`node scripts/migrate.mjs\`.`;
        this.lastError = detail;

        return { ok: false, detail, expectedVersion, appliedVersion, appliedChecksum };
      }

      const expected = CANONICAL_MIGRATIONS.find((migration) => migration.name === expectedVersion);

      if (expected && expected.checksum && appliedChecksum && expected.checksum !== appliedChecksum) {
        const detail = `Schema checksum mismatch for ${expectedVersion}: applied ${appliedChecksum}, expected ${expected.checksum}.`;
        this.lastError = detail;

        return { ok: false, detail, expectedVersion, appliedVersion, appliedChecksum };
      }

      this.verified = true;

      return {
        ok: true,
        detail: `Schema version ${appliedVersion} verified.`,
        expectedVersion,
        appliedVersion,
        appliedChecksum,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = `Schema verification failed (${message}). Ensure migrations were applied via \`node scripts/migrate.mjs\`.`;
      this.lastError = detail;

      return { ok: false, detail, expectedVersion, appliedVersion: null, appliedChecksum: null };
    }
  }

  /**
   * Append a mirror operation to the shared chain so that rule -> alert
   * -> delivery writes honour the FK ordering regardless of how the
   * caller fired them. The returned promise is wrapped in `.catch` so
   * callers that fire-and-forget (`void adapter.mirrorAlert(...)`) do
   * not produce unhandled-rejection warnings when the actual SQL
   * statement throws.
   */
  private enqueueMirror<T>(work: () => Promise<T>): Promise<T | undefined> {
    const previous = this.mirrorQueue;
    const next = previous.then(work, work);
    const safe = next.catch(() => undefined);
    // Don't let one failed write break the chain for subsequent writes.
    this.mirrorQueue = safe;

    return safe;
  }

  private async doMirrorAlertRule(rule: PersistedAlertRule): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO alert_rules (id, wallet_address, trigger_type, observation_key, threshold, hysteresis, cooldown_minutes, direction, severity, enabled, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           wallet_address = EXCLUDED.wallet_address,
           trigger_type = EXCLUDED.trigger_type,
           observation_key = EXCLUDED.observation_key,
           threshold = EXCLUDED.threshold,
           hysteresis = EXCLUDED.hysteresis,
           cooldown_minutes = EXCLUDED.cooldown_minutes,
           direction = EXCLUDED.direction,
           severity = EXCLUDED.severity,
           enabled = EXCLUDED.enabled,
           updated_at = EXCLUDED.updated_at`,
        [
          rule.id,
          rule.walletAddress,
          rule.triggerType,
          rule.observationKey ?? null,
          rule.threshold,
          rule.hysteresis,
          rule.cooldownMinutes,
          rule.direction ?? "high_is_bad",
          rule.severity,
          rule.enabled,
          rule.createdAt,
          rule.updatedAt,
        ],
      );
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async doMirrorAlertObservation(observation: PersistedAlertObservation): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO alert_observations (id, wallet_address, trigger_type, observation_key, value, direction, evidence, incomplete_data, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [
          observation.id,
          observation.walletAddress,
          observation.triggerType,
          observation.observationKey,
          observation.value,
          observation.direction,
          JSON.stringify(observation.evidence ?? {}),
          observation.incompleteData ?? false,
          observation.createdAt,
        ],
      );
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async doMirrorAlert(alert: PersistedAlert): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO alerts (id, wallet_address, rule_id, trigger_type, observation_key, status, severity, message, before_value, after_value, evidence_before, evidence_after, evidence_data, triggered_at, recovered_at, acknowledged_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           severity = EXCLUDED.severity,
           message = EXCLUDED.message,
           before_value = EXCLUDED.before_value,
           after_value = EXCLUDED.after_value,
           evidence_before = EXCLUDED.evidence_before,
           evidence_after = EXCLUDED.evidence_after,
           evidence_data = EXCLUDED.evidence_data,
           recovered_at = EXCLUDED.recovered_at,
           acknowledged_at = EXCLUDED.acknowledged_at`,
        [
          alert.id,
          alert.walletAddress,
          alert.ruleId,
          alert.triggerType,
          alert.observationKey,
          alert.status,
          alert.severity,
          alert.message,
          alert.beforeValue,
          alert.afterValue,
          JSON.stringify(alert.evidenceBefore ?? {}),
          JSON.stringify(alert.evidenceAfter ?? {}),
          JSON.stringify(alert.evidenceData ?? {}),
          alert.triggeredAt,
          alert.recoveredAt ?? null,
          alert.acknowledgedAt ?? null,
        ],
      );
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async doMirrorWatchlistEntry(entry: PersistedWatchlistEntry): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO watchlist_entries (
           id, wallet_address, identity_key, chain, network,
           contract_address, pair_address, symbol, token_name, asset_key,
           issuer, asset_type, source, note, last_scanned_at,
           latest_scan_run_id, latest_classification, latest_score, latest_status, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (id) DO UPDATE SET
           wallet_address = EXCLUDED.wallet_address,
           identity_key = EXCLUDED.identity_key,
           chain = EXCLUDED.chain,
           network = EXCLUDED.network,
           contract_address = EXCLUDED.contract_address,
           pair_address = EXCLUDED.pair_address,
           symbol = EXCLUDED.symbol,
           token_name = EXCLUDED.token_name,
           asset_key = EXCLUDED.asset_key,
           issuer = EXCLUDED.issuer,
           asset_type = EXCLUDED.asset_type,
           source = EXCLUDED.source,
           note = EXCLUDED.note,
           last_scanned_at = EXCLUDED.last_scanned_at,
           latest_scan_run_id = EXCLUDED.latest_scan_run_id,
           latest_classification = EXCLUDED.latest_classification,
           latest_score = EXCLUDED.latest_score,
           latest_status = EXCLUDED.latest_status`,
        [
          entry.id,
          entry.walletAddress,
          entry.identityKey,
          entry.chain,
          entry.network ?? null,
          entry.contractAddress ?? null,
          entry.pairAddress ?? null,
          entry.symbol ?? null,
          entry.tokenName ?? null,
          entry.assetKey ?? null,
          entry.issuer ?? null,
          entry.assetType ?? null,
          entry.source,
          entry.note ?? null,
          entry.lastScannedAt ?? null,
          entry.latestScanRunId ?? null,
          entry.latestClassification ?? null,
          entry.latestScore ?? null,
          entry.latestStatus ?? null,
          entry.createdAt,
        ],
      );
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async doRemoveMirrorWatchlistEntry(id: string): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query("DELETE FROM watchlist_scan_runs WHERE entry_id = $1", [id]);
      await this.pool.query("DELETE FROM discovery_alerts WHERE entry_id = $1", [id]);
      await this.pool.query("DELETE FROM watchlist_entries WHERE id = $1", [id]);
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async doMirrorWatchlistScanRun(run: PersistedWatchlistScanRun): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO watchlist_scan_runs (
           id, entry_id, wallet_address, identity_key, agent_run_id,
           classification, classification_reasons, confidence, score,
           source_lineage, missing_data, risk_report, status, previous_run_id, scanned_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
           entry_id = EXCLUDED.entry_id,
           classification = EXCLUDED.classification,
           classification_reasons = EXCLUDED.classification_reasons,
           confidence = EXCLUDED.confidence,
           score = EXCLUDED.score,
           source_lineage = EXCLUDED.source_lineage,
           missing_data = EXCLUDED.missing_data,
           risk_report = EXCLUDED.risk_report,
           status = EXCLUDED.status`,
        [
          run.id,
          run.entryId,
          run.walletAddress,
          run.identityKey,
          run.agentRunId ?? null,
          run.classification,
          JSON.stringify(run.classificationReasons),
          run.confidence,
          run.score,
          JSON.stringify(run.sourceLineage),
          JSON.stringify(run.missingData),
          run.riskReport ? JSON.stringify(run.riskReport) : null,
          run.status,
          run.previousRunId ?? null,
          run.scannedAt,
        ],
      );
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async doUpdateMirrorWatchlistEntryLatestScan(entryId: string, update: PersistedWatchlistEntryLatestScan): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `UPDATE watchlist_entries SET
           last_scanned_at = $1,
           latest_scan_run_id = $2,
           latest_classification = $3,
           latest_score = $4,
           latest_status = $5
         WHERE id = $6`,
        [update.scannedAt, update.scanRunId, update.classification, update.score, update.status, entryId],
      );
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async doMirrorAlertDelivery(delivery: PersistedAlertDelivery): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO alert_deliveries (id, alert_id, wallet_address, channel, status, error_detail, sanitized_payload, attempt_count, created_at, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           error_detail = EXCLUDED.error_detail,
           sent_at = EXCLUDED.sent_at,
           attempt_count = EXCLUDED.attempt_count`,
        [
          delivery.id,
          delivery.alertId,
          delivery.walletAddress,
          delivery.channel,
          delivery.status,
          delivery.errorDetail ?? null,
          JSON.stringify(delivery.sanitizedPayload ?? {}),
          delivery.attemptCount,
          delivery.createdAt,
          delivery.sentAt ?? null,
        ],
      );
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async doMirrorNotificationPreferences(prefs: PersistedNotificationPreferences): Promise<void> {
    if (!this.pool) return;
    const channels = prefs.channels ?? {};
    const payload = {
      channels,
      quietHours: prefs.quietHours,
      digestCadence: prefs.digestCadence,
      dedupeWindowMinutes: prefs.dedupeWindowMinutes,
    };
    try {
      await this.pool.query(
        `INSERT INTO notification_preferences (id, wallet_address, chain_family, network, prefs, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT (id) DO UPDATE SET
           wallet_address = EXCLUDED.wallet_address,
           chain_family = EXCLUDED.chain_family,
           network = EXCLUDED.network,
           prefs = EXCLUDED.prefs,
           updated_at = EXCLUDED.updated_at`,
        [
          prefs.id,
          prefs.walletAddress,
          prefs.chainFamily,
          prefs.network,
          JSON.stringify(payload),
          prefs.updatedAt,
        ],
      );
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async doDeleteNotificationPreferences(id: string): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query("DELETE FROM notification_preferences WHERE id = $1", [id]);
      this.mirrorSuccessCount += 1;
    } catch (error) {
      this.mirrorFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  async mirrorAlertRule(rule: PersistedAlertRule): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doMirrorAlertRule(rule));
  }

  async mirrorAlertObservation(observation: PersistedAlertObservation): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doMirrorAlertObservation(observation));
  }

  async mirrorAlert(alert: PersistedAlert): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doMirrorAlert(alert));
  }

  async mirrorAlertDelivery(delivery: PersistedAlertDelivery): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doMirrorAlertDelivery(delivery));
  }

  async mirrorNotificationPreferences(prefs: PersistedNotificationPreferences): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doMirrorNotificationPreferences(prefs));
  }

  async deleteMirrorNotificationPreferences(id: string): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doDeleteNotificationPreferences(id));
  }

  async mirrorTransaction(record: TransactionRecord): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => doMirrorTransactionRecord(this.pool!, record));
  }

  async mirrorTransactionLifecycleEvent(event: TransactionLifecycleEvent): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => doMirrorTransactionLifecycleEvent(this.pool!, event));
  }

  async mirrorWatchlistEntry(entry: PersistedWatchlistEntry): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doMirrorWatchlistEntry(entry));
  }

  async mirrorWatchlistEntryBulk(entries: PersistedWatchlistEntry[]): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(async () => {
      for (const entry of entries) {
        await this.doMirrorWatchlistEntry(entry);
      }
    });
  }

  async removeMirrorWatchlistEntry(id: string): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doRemoveMirrorWatchlistEntry(id));
  }

  async mirrorWatchlistScanRun(run: PersistedWatchlistScanRun): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doMirrorWatchlistScanRun(run));
  }

  async updateMirrorWatchlistEntryLatestScan(entryId: string, update: PersistedWatchlistEntryLatestScan): Promise<void> {
    if (!this.connectionString || !(await this.ensurePool())) return;
    await this.enqueueMirror(() => this.doUpdateMirrorWatchlistEntryLatestScan(entryId, update));
  }

  async hydrateWatchlistTables(target: {
    entries: WatchlistEntry[];
    scanRuns: WatchlistScanRun[];
  }): Promise<{ hydrated: number; skipped: number }> {
    if (!this.connectionString || !(await this.ensurePool())) {
      return { hydrated: 0, skipped: 0 };
    }
    return (await this.enqueueMirror(() => this.doHydrateWatchlistTables(target))) ?? { hydrated: 0, skipped: 0 };
  }

  private async doHydrateWatchlistTables(target: {
    entries: WatchlistEntry[];
    scanRuns: WatchlistScanRun[];
  }): Promise<{ hydrated: number; skipped: number }> {
    if (!this.pool) return { hydrated: 0, skipped: 0 };

    let hydrated = 0;
    let skipped = 0;

    hydrated += await this.mergeWatchlistEntriesFromPostgres(target.entries, () => skipped++);
    hydrated += await this.mergeWatchlistScanRunsFromPostgres(target.scanRuns, () => skipped++);

    return { hydrated, skipped };
  }

  private async mergeWatchlistEntriesFromPostgres(
    store: WatchlistEntry[],
    onSkip: () => void,
  ): Promise<number> {
    if (!this.pool) return 0;
    const result = await this.pool.query("SELECT * FROM watchlist_entries ORDER BY created_at ASC");
    let hydrationCount = 0;

    for (const row of result.rows as Array<Record<string, unknown>>) {
      const mapped = mapWatchlistEntryRow(row);
      const existing = store.find((entry) => entry.id === mapped.id);

      if (existing) {
        onSkip();
        continue;
      }
      store.push(mapped);
      hydrationCount += 1;
    }

    return hydrationCount;
  }

  private async mergeWatchlistScanRunsFromPostgres(
    store: WatchlistScanRun[],
    onSkip: () => void,
  ): Promise<number> {
    if (!this.pool) return 0;
    const result = await this.pool.query("SELECT * FROM watchlist_scan_runs ORDER BY scanned_at ASC");
    let hydrationCount = 0;

    for (const row of result.rows as Array<Record<string, unknown>>) {
      const mapped = mapWatchlistScanRunRow(row);
      const existing = store.find((run) => run.id === mapped.id);

      if (existing) {
        onSkip();
        continue;
      }
      store.push(mapped);
      hydrationCount += 1;
    }

    return hydrationCount;
  }

  async hydrateTransactionTables(target: {
    transactions: TransactionRecord[];
    events: TransactionLifecycleEvent[];
  }): Promise<{ hydrated: number; skipped: number }> {
    if (!this.connectionString || !(await this.ensurePool())) {
      return { hydrated: 0, skipped: 0 };
    }
    return (await this.enqueueMirror(() => this.doHydrateTransactionTables(target))) ?? { hydrated: 0, skipped: 0 };
  }

  private async doHydrateTransactionTables(target: {
    transactions: TransactionRecord[];
    events: TransactionLifecycleEvent[];
  }): Promise<{ hydrated: number; skipped: number }> {
    if (!this.pool) return { hydrated: 0, skipped: 0 };

    let hydrated = 0;
    let skipped = 0;

    hydrated += await this.mergeTransactionsFromPostgres(target.transactions, () => skipped++);
    hydrated += await this.mergeTransactionEventsFromPostgres(target.events, () =>