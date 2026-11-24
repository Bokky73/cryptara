import { describe, expect, it } from "vitest";
import {
  assertExternalFetchAllowed,
  assertSep1FetchAllowed,
  canonicalizeNumericIpv4,
  evaluateUrlSafety,
  isPrivateOrLocalHost,
  isPublicIpAddress,
  isPublicIpv4Address,
} from "@/server/security/urlSafety";

describe("SSRF hostname classification", () => {
  it("blocks every non-public IPv4 range", () => {
    for (const address of [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254",
      "172.16.0.1", "172.31.255.254", "192.0.0.1", "192.0.2.5", "192.88.99.1",
      "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1",
      "240.0.0.1", "255.255.255.255",
    ]) {
      expect(isPrivateOrLocalHost(address), address).toBe(true);
      expect(isPublicIpv4Address(address), address).toBe(false);
    }
  });

  it("allows ordinary public IPv4 addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1"]) {
      expect(isPrivateOrLocalHost(address), address).toBe(false);
      expect(isPublicIpv4Address(address), address).toBe(true);
    }
  });

  it("blocks reserved IPv6 ranges and IPv4-mapped encodings", () => {
    for (const address of [
      "::", "::1", "[::1]", "fc00::1", "fd12::1", "fe80::1", "ff02::1",
      "2001:db8::1", "64:ff9b::7f00:1", "100::1", "2001::1", "2002:7f00:1::",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "[::ffff:7f00:1]",
      "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:8.8.8.8",
    ]) {
      expect(isPrivateOrLocalHost(address), address).toBe(true);
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  it("allows public IPv6 addresses", () => {
    for (const address of ["2001:4860:4860::8888", "2606:4700:4700::1111"]) {
      expect(isPrivateOrLocalHost(address), address).toBe(false);
      expect(isPublicIpAddress(address), address).toBe(true);
    }
  });

  it("canonicalizes decimal, octal, hexadecimal and abbreviated IPv4 literals", () => {
    expect(canonicalizeNumericIpv4("2130706433")).toBe("127.0.0.1");
    expect(canonicalizeNumericIpv4("0177.0.0.1")).toBe("127.0.0.1");
    expect(canonicalizeNumericIpv4("0x7f000001")).toBe("127.0.0.1");
    expect(canonicalizeNumericIpv4("0x7f.1")).toBe("127.0.0.1");
    expect(canonicalizeNumericIpv4("127.1")).toBe("127.0.0.1");
    expect(canonicalizeNumericIpv4("0")).toBe("0.0.0.0");
    expect(canonicalizeNumericIpv4("2852039166")).toBe("169.254.169.254");

    for (const literal of ["2130706433", "0177.0.0.1", "0x7f000001", "127.1", "0"]) {
      expect(isPrivateOrLocalHost(literal), literal).toBe(true);
      expect(isPublicIpv4Address(literal), literal).toBe(false);
    }
    expect(evaluateUrlSafety("http://2130706433/admin").issues).toContain("private or localhost target blocked");
    expect(evaluateUrlSafety("https://0x7f000001/admin").safe).toBe(false);
  });

  it("blocks local, metadata and reserved hostnames", () => {
    for (const hostname of [
      "localhost", "api.localhost", "metadata", "metadata.goog",
      "metadata.google.internal", "instance-data", "ec2.internal",
      "printer.local", "site.test", "site.invalid", "host.home.arpa",
      "localhost.", "127.0.0.1.", "fe80::1%eth0",
    ]) {
      expect(isPrivateOrLocalHost(hostname), hostname).toBe(true);
    }
    expect(isPrivateOrLocalHost("example.com")).toBe(false);
  });
});

describe("external fetch URL guard", () => {
  it("rejects non-HTTP schemes and embedded credentials", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/file", "javascript:alert(1)", "data:text/plain,hi"]) {
      const result = evaluateUrlSafety(url);
      expect(result.safe, url).toBe(false);
      expect(result.issues, url).toContain("unsupported protocol");
      expect(assertExternalFetchAllowed(url).allowed, url).toBe(false);
    }
    expect(evaluateUrlSafety("https://user:secret@example.com/").issues).toContain("credentials in URL");
  });

  it("allows ordinary HTTPS URLs and applies content-type and byte limits", () => {
    expect(evaluateUrlSafety("https://example.com/feed").safe).toBe(true);
    expect(assertExternalFetchAllowed("https://example.com/feed", "text/plain; charset=utf-8", 100).allowed).toBe(true);
    expect(assertExternalFetchAllowed("https://example.com/feed", "text/plain-evil", 100).allowed).toBe(false);
    expect(assertExternalFetchAllowed("https://example.com/feed", "text/plain", 1_000_001).allowed).toBe(false);
  });

  it("requires HTTPS for SEP-1 metadata", () => {
    const result = assertSep1FetchAllowed("http://example.com/.well-known/stellar.toml");
    expect(result.allowed).toBe(false);
    expect(result.issues.join(" ")).toMatch(/HTTPS/);
    expect(assertSep1FetchAllowed("https://example.com/.well-known/stellar.toml").allowed).toBe(true);
  });
});
