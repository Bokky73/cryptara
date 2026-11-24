import { BlockList, isIP } from "node:net";

export type UrlSafetyResult = {
  url: string;
  safe: boolean;
  normalizedUrl?: string;
  hostname?: string;
  issues: string[];
  redirectLimit: number;
};

export const externalFetchSandboxRules = {
  allowPrivateNetwork: false,
  allowedProtocols: ["https:", "http:"],
  redirectLimit: 3,
  maxResponseBytes: 1_000_000,
  allowedContentTypes: [
    "text/html",
    "application/json",
    "application/rss+xml",
    "application/xml",
    "text/xml",
    "text/plain",
    "text/toml",
    "application/toml",
    "text/x-toml",
    "application/x-toml",
  ],
};

// Every non-public IPv4 range that can be reached from a browser/server fetch,
// including link-local (cloud metadata), CGNAT, benchmarking and documentation
// ranges. Anything not explicitly public is treated as private (fail closed).
const blockedIpv4Subnets = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const blockedIpv6Subnets = [
  ["::", 128],
  ["::1", 128],
  ["::", 96], // IPv4-compatible addresses
  ["::ffff:0:0", 96], // IPv4-mapped addresses (checked again against IPv4 blocks)
  ["64:ff9b::", 96], // NAT64 well-known prefix
  ["64:ff9b:1::", 48], // NAT64 local-use prefix
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo
  ["2001:10::", 28],
  ["2001:db8::", 32], // documentation
  ["3fff::", 20], // documentation
  ["2002::", 16], // 6to4 (embeds an IPv4 address)
  ["fc00::", 7], // unique local
  ["fec0::", 10], // deprecated site-local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const;

const blockedIpv4 = new BlockList();
for (const [address, prefix] of blockedIpv4Subnets) {
  blockedIpv4.addSubnet(address, prefix, "ipv4");
}

const blockedIpv6 = new BlockList();
for (const [address, prefix] of blockedIpv6Subnets) {
  blockedIpv6.addSubnet(address, prefix, "ipv6");
}

const blockedHostnames = new Set([
  "localhost",
  "metadata",
  "metadata.goog",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

const blockedHostnameSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".test",
  ".invalid",
  ".home.arpa",
];

function stripBrackets(value: string) {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

/**
 * Normalize the decimal, octal and hexadecimal IPv4 spellings accepted by the
 * WHATWG URL parser (`2130706433`, `0177.0.0.1`, `0x7f.1`, `127.1`). Returns
 * undefined for anything that is not an IPv4-looking literal.
 */
export function canonicalizeNumericIpv4(host: string): string | undefined {
  const normalized = stripBrackets(host);
  if (!normalized || !/^[0-9a-fx.]+$/i.test(normalized)) return undefined;

  // Delegate to the WHATWG parser so decimal, octal, hexadecimal and
  // abbreviated forms are interpreted exactly as a browser would.
  try {
    const canonical = new URL(`http://${normalized}/`).hostname;
    return isIP(canonical) === 4 ? canonical : undefined;
  } catch {
    return undefined;
  }
}

/** Extract an embedded IPv4 address from mapped/compatible IPv6 spellings. */
export function ipv4FromIpv6(address: string): string | undefined {
  const normalized = stripBrackets(address);

  const dotted = normalized.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return canonicalizeNumericIpv4(dotted[1]) ?? dotted[1];

  const hexGroups = normalized.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexGroups) {
    const high = Number.parseInt(hexGroups[1], 16);
    const low = Number.parseInt(hexGroups[2], 16);
    return `${(high >>> 8) & 255}.${high & 255}.${(low >>> 8) & 255}.${low & 255}`;
  }

  const sixToFour = normalized.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) {
    const high = Number.parseInt(sixToFour[1], 16);
    const low = Number.parseInt(sixToFour[2], 16);
    return `${(high >>> 8) & 255}.${high & 255}.${(low >>> 8) & 255}.${low & 255}`;
  }

  return undefined;
}

export function isPublicIpv4Address(address: string): boolean {
  const canonical = canonicalizeNumericIpv4(address) ?? stripBrackets(address);
  if (isIP(canonical) !== 4) return false;
  return !blockedIpv4.check(canonical, "ipv4");
}

export function isPublicIpAddress(address: string): boolean {
  if (isPublicIpv4Address(address)) return true;

  const canonical = stripBrackets(address);
  if (isIP(canonical) !== 6 || blockedIpv6.check(canonical, "ipv6")) return false;

  const embedded = ipv4FromIpv6(canonical);
  return !embedded || isPublicIpv4Address(embedded);
}

export function isAllowedContentType(contentType: string | null | undefined, allowed: readonly string[] = externalFetchSandboxRules.allowedContentTypes): boolean {
  if (!contentType) return false;
  const baseType = contentType.split(";", 1)[0].trim().toLowerCase();
  return allowed.some((candidate) => candidate.toLowerCase() === baseType);
}

export function isPrivateOrLocalHost(hostname: string) {
  const normalized = stripBrackets(hostname);
  if (!normalized || normalized.includes("%")) return true;

  if (blockedHostnames.has(normalized) || blockedHostnameSuffixes.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  const canonical = canonicalizeNumericIpv4(normalized) ?? normalized;
  if (isIP(canonical) === 4) return !isPublicIpv4Address(canonical);
  if (isIP(canonical) === 6) return !isPublicIpAddress(canonical);

  // Numeric-only hosts are IP literal attempts that did not parse; never let
  // one through as if it were a normal domain name.
  return /^[\d.]+$/.test(normalized);
}

function skeletonDomain(hostname: string) {
  return hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replaceAll("0", "o")
    .replaceAll("1", "l")
    .replaceAll("3", "e")
    .replaceAll("@", "a")
    .replaceAll("-", "");
}

export function getHostname(value?: string) {
  if (!value) return undefined;

  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function evaluateUrlSafety(value: string, officialHostname?: string, redirectLimit = 3): UrlSafetyResult {
  const issues: string[] = [];

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (!externalFetchSandboxRules.allowedProtocols.includes(url.protocol)) {
      issues.push("unsupported protocol");
    }

    if (url.username || url.password) {
      issues.push("credentials in URL");
    }

    if (isPrivateOrLocalHost(hostname)) {
      issues.push("private or localhost target blocked");
    }

    if (hostname.startsWith("xn--") || /[^\u0000-\u007f]/.test(hostname)) {
      issues.push("punycode or homograph-like hostname");
    }

    if (officialHostname) {
      const official = officialHostname.toLowerCase().replace(/^www\./, "");
      const targetSkeleton = skeletonDomain(hostname);
      const officialSkeleton = skeletonDomain(official);

      if (hostname !== official && targetSkeleton.includes(officialSkeleton) && targetSkeleton !== officialSkeleton) {
        issues.push("suspicious official-domain similarity");
      }
    }

    if (redirectLimit < 0 || redirectLimit > 5) {
      issues.push("redirect limit outside allowed range");
    }

    return {
      url: value,
      safe: issues.length === 0,
      normalizedUrl: `${url.protocol}//${hostname}${url.pathname.replace(/\/$/, "")}`,
      hostname,
      issues,
      redirectLimit,
    };
  } catch {
    return {
      url: value,
      safe: false,
      issues: ["invalid URL"],
      redirectLimit,
    };
  }
}

export function assertExternalFetchAllowed(url: string, contentType?: string, responseBytes?: number) {
  const result = evaluateUrlSafety(url, undefined, externalFetchSandboxRules.redirectLimit);
  const contentAllowed = !contentType || isAllowedContentType(contentType);
  const sizeAllowed = typeof responseBytes !== "number" || responseBytes <= externalFetchSandboxRules.maxResponseBytes;

  return {
    allowed: result.safe && contentAllowed && sizeAllowed,
    issues: [
      ...result.issues,
      ...(contentAllowed ? [] : ["content type not allowed"]),
      ...(sizeAllowed ? [] : ["response size limit exceeded"]),
    ],
    rules: externalFetchSandboxRules,
  };
}

export function assertSep1FetchAllowed(url: string, contentType?: string, responseBytes?: number) {
  const safety = evaluateUrlSafety(url, undefined, 3);
  const isHttps = url.toLowerCase().startsWith("https://");
  const contentAllowed = !contentType || isAllowedContentType(contentType);
  const maxSep1Bytes = 250_000;
  const sizeAllowed = typeof responseBytes !== "number" || responseBytes <= maxSep1Bytes;

  const issues: string[] = [...safety.issues];
  if (!isHttps) issues.push("SEP-1 metadata must be fetched via HTTPS");
  if (!contentAllowed) issues.push("content type not allowed for SEP-1 metadata");
  if (!sizeAllowed) issues.push("SEP-1 response size limit exceeded");

  return {
    allowed: safety.safe && isHttps && contentAllowed && sizeAllowed,
    issues,
  };
}
