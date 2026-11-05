/**
 * Compares release versions against tags in the declared source repository.
 *
 * The fetch surface is kept narrow on purpose: this module only ever calls
 * `api.github.com`, and only once a declared repository URL has been
 * parsed as a `github.com` owner/repo pair. A declared repository on any
 * other host is reported as `unknown`, never fetched — this tool does not
 * become a general-purpose URL fetcher just because a package author put
 * an arbitrary URL in their `repository` field.
 */
import { lookup } from "node:dns/promises";
import { assertExternalFetchAllowed, isPrivateOrLocalHost } from "@/server/security/urlSafety";
import { PACKAGE_PROVENANCE_LIMITS } from "./limits";
import type { TagMatch } from "./schema";

const USER_AGENT = "cryptara-package-provenance (research tool, read-only, no auth)";

export function parseGithubOwnerRepo(declaredRepository: string | null): { owner: string; repo: string } | null {
  if (!declaredRepository) return null;

  let normalized = declaredRepository.trim();
  normalized = normalized.replace(/^git\+/, "");
  if (normalized.startsWith("git@github.com:")) {
    normalized = `https://github.com/${normalized.slice("git@github.com:".length)}`;
  }
  if (normalized.startsWith("git://")) {
    normalized = `https://${normalized.slice("git://".length)}`;
  }
  normalized = normalized.replace(/\.git$/, "");

  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== "github.com") return null;

    const segments = url.pathname.replace(/^\//, "").split("/").filter(Boolean);
    const [owner, repo] = segments;
    if (!owner || !repo) return null;

    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

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

export type GithubTagsOutcome = "ok" | "unsupported_host" | "not_found" | "private_or_local_target" | "oversized" | "timeout" | "http_error" | "dns_failure" | "rate_limited";

export type GithubTagsResult = { outcome: "ok"; tags: string[] } | { outcome: Exclude<GithubTagsOutcome, "ok">; issues: string[] };

export async function fetchGithubTags(owner: string, repo: string, fetchImpl: typeof fetch = fetch): Promise<GithubTagsResult> {
  const tags: string[] = [];

  for (let page = 1; page <= PACKAGE_PROVENANCE_LIMITS.maxTagPages; page++) {
    const requestedUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=${PACKAGE_PROVENANCE_LIMITS.maxTagsPerPage}&page=${page}`;

    const safety = assertExternalFetchAllowed(requestedUrl);
    if (!safety.allowed) {
      const privateHit = safety.issues.some((issue) => issue.includes("private") || issue.includes("localhost"));
      return { outcome: privateHit ? "private_or_local_target" : "http_error", issues: safety.issues };
    }

    const dnsIssues = await assertResolvedHostIsPublic(requestedUrl);
    if (dnsIssues.length > 0) {
      return { outcome: "private_or_local_target", issues: dnsIssues };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PACKAGE_PROVENANCE_LIMITS.fetchTimeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(requestedUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = message.toLowerCase().includes("abort") || message.toLowerCase().includes("timeout");
      return { outcome: timedOut ? "timeout" : "http_error", issues: [message] };
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      return { outcome: "not_found", issues: ["repository not found"] };
    }
    if (response.status === 403 || response.status === 429) {
      return { outcome: "rate_limited", issues: ["GitHub API rate limit reached"] };
    }
    if (!response.ok) {
      return { outcome: "http_error", issues: [`HTTP status ${response.status}`] };
    }

    const text = await response.text();
    if (text.length > PACKAGE_PROVENANCE_LIMITS.maxResponseBytes) {
      return { outcome: "oversized", issues: ["response size limit exceeded"] };
    }

    let pageTags: unknown;
    try {
      pageTags = JSON.parse(text);
    } catch (error) {
      return { outcome: "http_error", issues: [`malformed JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }

    if (!Array.isArray(pageTags)) {
      return { outcome: "http_error", issues: ["unexpected tags response shape"] };
    }

    for (const entry of pageTags) {
      const name = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).name : null;
      if (typeof name === "string") tags.push(name);
    }

    if (pageTags.length < PACKAGE_PROVENANCE_LIMITS.maxTagsPerPage) {
      break;
    }
  }

  return { outcome: "ok", tags };
}

export function matchReleaseTags(packageName: string, version: string, tags: string[]): TagMatch {
  const tagSet = new Set(tags);
  const bareName = packageName.includes("/") ? packageName.slice(packageName.indexOf("/") + 1) : packageName;
  const candidates = [`v${version}`, version, `${packageName}@${version}`, `${bareName}@${version}`, `${bareName}-v${version}`, `release-${version}`];

  const matched = candidates.find((candidate) => tagSet.has(candidate));
  return matched
    ? { state: "matched", expectedTag: matched, note: `Matched tag ${matched} in the declared repository.` }
    : { state: "no_matching_tag", expectedTag: null, note: "No tag in the declared repository matches this release version." };
}
