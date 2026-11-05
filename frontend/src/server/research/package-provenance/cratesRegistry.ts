/**
 * Bounded, fail-closed reads from the public crates.io registry.
 *
 * Same redirect-and-DNS-rebinding guard as `npmRegistry.ts`; crates.io
 * additionally requires a descriptive `User-Agent` on every request or it
 * returns 403, so one is always sent.
 *
 * crates.io exposes no per-version maintainer snapshot — only the
 * crate-wide `owners` endpoint, which is a current-state list with no
 * history — so `maintainers` is always `null` here. It does expose
 * Trusted Publishing provenance (`trustpub_data`) per version where the
 * release was published via GitHub Actions OIDC, which this module reads
 * directly without a second fetch.
 */
import { lookup } from "node:dns/promises";
import { assertExternalFetchAllowed, isPrivateOrLocalHost } from "@/server/security/urlSafety";
import { PACKAGE_PROVENANCE_LIMITS } from "./limits";

const USER_AGENT = "cryptara-package-provenance (research tool, read-only, no auth)";

export type CratesTrustedPublishing = {
  provider: string;
  repository: string;
  runId: string;
  sha: string;
};

export type CratesVersionRecord = {
  version: string;
  publishedAt: string | null;
  trustedPublishing: CratesTrustedPublishing | null;
};

export type CratesPackageMetadata = {
  name: string;
  repository: string | null;
  /** Newest first. */
  versions: CratesVersionRecord[];
};

export type CratesFetchOutcome = "ok" | "not_found" | "private_or_local_target" | "oversized" | "timeout" | "http_error" | "dns_failure" | "unsupported_content_type";

export type CratesFetchResult = { outcome: "ok"; crateMeta: CratesPackageMetadata } | { outcome: Exclude<CratesFetchOutcome, "ok">; issues: string[] };

async function assertResolvedHostIsPublic(url: string): Promise<string[]> {
  const hostname = new URL(url).hostname;
  if (isPrivateOrLocalHost(hostname)) {
    return ["private or localhost target blocked"];
  }
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    const privateAddresses = records.map((record) => record.address).filter(isPrivateOrLocalHost);
    return privateAddresses.length > 0 ? [`DNS resolves to private or local address: ${privateAddresses.join(", ")}`] : [];
  } catch (error) {
    return [`DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export async function fetchCratesPackage(name: string, fetchImpl: typeof fetch = fetch): Promise<CratesFetchResult> {
  const requestedUrl = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;

  const safety = assertExternalFetchAllowed(requestedUrl);
  if (!safety.allowed) {
    const privateHit = safety.issues.some((issue) => issue.includes("private") || issue.includes("localhost"));
    return { outcome: privateHit ? "private_or_local_target" : "http_error", issues: safety.issues };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PACKAGE_PROVENANCE_LIMITS.fetchTimeoutMs);

  try {
    let currentUrl = requestedUrl;
    for (let hop = 0; hop <= PACKAGE_PROVENANCE_LIMITS.maxRedirects; hop++) {
      const dnsIssues = await assertResolvedHostIsPublic(currentUrl);
      if (dnsIssues.length > 0) {
        return { outcome: "private_or_local_target", issues: dnsIssues };
      }

      const response = await fetchImpl(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return { outcome: "http_error", issues: ["redirect missing location"] };
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (response.status === 404) {
        return { outcome: "not_found", issues: ["crate not found"] };
      }
      if (!response.ok) {
        return { outcome: "http_error", issues: [`HTTP status ${response.status}`] };
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!/application\/json/i.test(contentType)) {
        return { outcome: "unsupported_content_type", issues: [`unsupported content type: ${contentType}`] };
      }

      const text = await response.text();
      if (text.length > PACKAGE_PROVENANCE_LIMITS.maxResponseBytes) {
        return { outcome: "oversized", issues: ["response size limit exceeded"] };
      }

      let doc: Record<string, unknown>;
      try {
        doc = asRecord(JSON.parse(text));
      } catch (error) {
        return { outcome: "http_error", issues: [`malformed JSON: ${error instanceof Error ? error.message : String(error)}`] };
      }

      const crate = asRecord(doc.crate);
      const versionsRaw = Array.isArray(doc.versions) ? doc.versions : [];

      const versions: CratesVersionRecord[] = versionsRaw
        .map((entry) => {
          const version = asRecord(entry);
          const trustpub = asRecord(version.trustpub_data);
          const trustedPublishing: CratesTrustedPublishing | null =
            typeof trustpub.provider === "string" && typeof trustpub.repository === "string" && typeof trustpub.sha === "string"
              ? {
                  provider: trustpub.provider,
                  repository: trustpub.repository,
                  runId: typeof trustpub.run_id === "string" ? trustpub.run_id : "",
                  sha: trustpub.sha,
                }
              : null;

          return {
            version: typeof version.num === "string" ? version.num : "",
            publishedAt: typeof version.created_at === "string" ? version.created_at : null,
            trustedPublishing,
          } satisfies CratesVersionRecord;
        })
        .filter((version) => version.version.length > 0)
        .sort((a, b) => {
          const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
          const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
          return bTime - aTime;
        });

      return {
        outcome: "ok",
        crateMeta: {
          name,
          repository: typeof crate.repository === "string" ? crate.repository : null,
          versions,
        },
      };
    }
    return { outcome: "http_error", issues: ["redirect limit exceeded"] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = message.toLowerCase().includes("abort") || message.toLowerCase().includes("timeout");
    return { outcome: timedOut ? "timeout" : "http_error", issues: [message] };
  } finally {
    clearTimeout(timer);
  }
}
