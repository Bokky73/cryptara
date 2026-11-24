import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import {
  canonicalizeNumericIpv4,
  isAllowedContentType,
  isPrivateOrLocalHost,
  isPublicIpAddress,
  isPublicIpv4Address,
} from "@/server/security/urlSafety";

const allowedTextContentTypes = [
  "application/json",
  "text/plain",
  "text/toml",
  "application/toml",
  "text/x-toml",
  "application/x-toml",
] as const;

const maxRedirects = 3;

export function isPublicIpv4(address: string): boolean {
  return isPublicIpv4Address(address);
}

export function isPublicIpAddressString(address: string): boolean {
  return isPublicIpAddress(address);
}

export function parsePublicHttpsUrl(value: string): URL {
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("External HTTPS domain required");
  }

  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();

  if (
    url.protocol !== "https:" || url.username || url.password || url.hash || url.port ||
    isIP(hostname.replace(/^\[|\]$/g, "")) !== 0 ||
    canonicalizeNumericIpv4(hostname) ||
    isPrivateOrLocalHost(hostname) ||
    hostname.startsWith("xn--") || /[^\u0000-\u007f]/.test(hostname) ||
    !hostname.includes(".") || hostname.endsWith(".")
  ) {
    throw new Error("External HTTPS domain required");
  }
  return url;
}

type PinnedAddress = { address: string; family: 4 | 6 };

/**
 * Resolve once per hop and fail closed if any answer is private. The returned
 * address is used for the connection so a second DNS lookup cannot rebind the
 * hostname to an internal address before the socket is opened.
 */
async function resolvePublicAddress(hostname: string): Promise<PinnedAddress> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("Domain has no exclusively public addresses");
  }

  const validated = addresses.map((entry) => {
    const address = entry.address.trim().toLowerCase();
    if (!isPublicIpAddress(address)) {
      throw new Error("Domain has no exclusively public addresses");
    }
    return { address, family: (isIP(address) === 6 ? 6 : 4) as 4 | 6 };
  });

  const ipv4 = validated.find((entry) => entry.family === 4);
  return ipv4 ?? validated[0];
}

type OneResponse = { status: number; location: string | null; body: string };

function requestPinnedText(url: URL, pinned: PinnedAddress, maxBytes: number, timeoutMs: number): Promise<OneResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      servername: url.hostname,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: allowedTextContentTypes.join(", ") },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location ?? null;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        response.destroy();
        reject(error);
      };
      response.on("error", fail);

      if (status >= 300 && status < 400) {
        settled = true;
        response.destroy();
        resolve({ status, location, body: "" });
        return;
      }

      if (!isAllowedContentType(response.headers["content-type"], allowedTextContentTypes)) {
        fail(new Error("Content type not allowed"));
        return;
      }

      const declared = Number(response.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > maxBytes) {
        fail(new Error("Response exceeds byte limit"));
        return;
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) {
          fail(new Error("Response exceeds byte limit"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ status, location: null, body: Buffer.concat(chunks, bytes).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** Fetch untrusted text without allowing redirects or DNS changes to reach private networks. */
export async function readPublicHttpsText(value: string, maxBytes: number, timeoutMs: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Invalid byte limit");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid timeout");

  let url = parsePublicHttpsUrl(value);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const pinned = await resolvePublicAddress(url.hostname);
    const response = await requestPinnedText(url, pinned, maxBytes, timeoutMs);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || hop === maxRedirects) throw new Error("Redirect limit exceeded");
      url = parsePublicHttpsUrl(new URL(response.location, url).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    return response.body;
  }
  throw new Error("Redirect limit exceeded");
}
