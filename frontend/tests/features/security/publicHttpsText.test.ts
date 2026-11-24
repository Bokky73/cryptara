import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));

import {
  isPublicIpAddressString,
  isPublicIpv4,
  parsePublicHttpsUrl,
  readPublicHttpsText,
} from "@/server/security/publicHttpsText";

type Scenario = { status?: number; headers?: Record<string, string | null>; chunks?: string[] };
type RequestOptionsSpy = {
  lookup: (hostname: string, options: object, callback: (error: null, address: string, family: number) => void) => void;
  servername?: string;
};

function configure(scenarios: Record<string, Scenario>, dnsAnswers?: Record<string, Array<{ address: string; family: number }>>) {
  const responses: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const options: RequestOptionsSpy[] = [];

  mocks.lookup.mockImplementation(async (hostname: string) => {
    return dnsAnswers?.[hostname] ?? [{ address: "8.8.8.8", family: 4 }];
  });

  mocks.request.mockImplementation((_url: URL, requestOptions: RequestOptionsSpy, callback: (response: EventEmitter) => void) => {
    options.push(requestOptions);
    const hostname = _url.hostname;
    const scenario = scenarios[hostname] ?? { chunks: ["ok"] };
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
      destroy: ReturnType<typeof vi.fn>;
      destroyedByTest?: boolean;
    };
    response.statusCode = scenario.status ?? 200;
    const headers: Record<string, string> = { "content-type": "text/plain" };
    for (const [name, value] of Object.entries(scenario.headers ?? {})) {
      if (value === null) delete headers[name];
      else headers[name] = value;
    }
    response.headers = headers;
    response.destroy = vi.fn(() => { response.destroyedByTest = true; });
    responses.push(response);

    queueMicrotask(() => {
      for (const chunk of scenario.chunks ?? []) {
        if (response.destroyedByTest) break;
        response.emit("data", Buffer.from(chunk));
      }
      if (!response.destroyedByTest) response.emit("end");
    });

    const req = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> };
    req.end = vi.fn(() => callback(response));
    return req;
  });

  return { responses, options };
}

describe("public HTTPS URL guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts only HTTPS domains and rejects literal or local targets", () => {
    for (const url of [
      "http://example.com/file", "file:///etc/passwd",
      "https://127.0.0.1/", "https://[::1]/", "https://[::ffff:127.0.0.1]/",
      "https://2130706433/", "https://0177.0.0.1/", "https://0x7f000001/",
      "https://metadata.google.internal/", "https://host.internal/",
      "https://user:secret@example.com/", "https://example.com:8443/",
      "https://example.com/#fragment", "https://example.com./",
      "https://xn--bcher-kva.example/",
    ]) {
      expect(() => parsePublicHttpsUrl(url), url).toThrow();
    }
    expect(parsePublicHttpsUrl("https://stellar.org/.well-known/stellar.toml").hostname).toBe("stellar.org");
  });

  it("rejects private IPv4 and IPv6 answers, including mapped and mixed sets", async () => {
    expect(isPublicIpv4("::ffff:169.254.169.254")).toBe(false);
    expect(isPublicIpAddressString("::ffff:7f00:1")).toBe(false);
    expect(isPublicIpAddressString("2001:4860:4860::8888")).toBe(true);

    const privateAnswers = [
      [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }],
      [{ address: "::ffff:169.254.169.254", family: 6 }],
      [{ address: "2606:4700::1111", family: 6 }, { address: "fd00::1", family: 6 }],
      [],
    ];

    for (const answers of privateAnswers) {
      const { responses } = configure({ "public.example": { chunks: ["secret"] } }, { "public.example": answers });
      await expect(readPublicHttpsText("https://public.example/file", 1000, 1000)).rejects.toThrow(/public addresses/);
      expect(responses).toHaveLength(0);
    }
  });

  it("pins the validated address on each redirect hop", async () => {
    const { options } = configure({
      "first.example": { status: 302, headers: { location: "https://second.example/final" } },
      "second.example": { chunks: ["done"] },
    });

    await expect(readPublicHttpsText("https://first.example/start", 1000, 1000)).resolves.toBe("done");
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.servername)).toEqual(["first.example", "second.example"]);

    const pinned = options.map((option) => {
      let answer: [string | null, number | undefined] | undefined;
      option.lookup("rebind.example", {}, (_error, address, family) => { answer = [address, family]; });
      return answer;
    });
    expect(pinned).toEqual([["8.8.8.8", 4], ["8.8.8.8", 4]]);
  });

  it("rejects redirects to local, private, metadata or non-HTTPS targets", async () => {
    const locations = [
      "http://127.0.0.1/admin",
      "https://localhost/admin",
      "https://10.0.0.1/admin",
      "https://192.168.1.1/admin",
      "https://169.254.169.254/latest/meta-data/",
      "https://metadata.google.internal/",
      "https://[::ffff:127.0.0.1]/",
      "https://2130706433/",
      "file:///etc/passwd",
    ];

    for (const location of locations) {
      vi.clearAllMocks();
      configure({ "first.example": { status: 302, headers: { location } } });
      await expect(readPublicHttpsText("https://first.example/start", 1000, 1000), location).rejects.toThrow();
      expect(mocks.request, location).toHaveBeenCalledTimes(1);
    }
  });

  it("re-validates DNS on redirect hops and caps the chain at three hops", async () => {
    configure({
      "first.example": { status: 302, headers: { location: "https://second.example/" } },
      "second.example": { status: 302, headers: { location: "https://third.example/" } },
      "third.example": { status: 302, headers: { location: "https://fourth.example/" } },
      "fourth.example": { status: 302, headers: { location: "https://fifth.example/" } },
    });
    await expect(readPublicHttpsText("https://first.example/", 1000, 1000)).rejects.toThrow("Redirect limit exceeded");
    expect(mocks.request).toHaveBeenCalledTimes(4);

    configure(
      {
        "first.example": { status: 302, headers: { location: "https://second.example/" } },
      },
      { "second.example": [{ address: "169.254.169.254", family: 4 }] }
    );
    await expect(readPublicHttpsText("https://first.example/", 1000, 1000)).rejects.toThrow(/public addresses/);
  });

  it("aborts oversized responses mid-stream", async () => {
    const { responses } = configure({
      "public.example": { chunks: ["x".repeat(500), "y".repeat(500)] },
    });

    await expect(readPublicHttpsText("https://public.example/file", 100, 1000)).rejects.toThrow("Response exceeds byte limit");
    expect(responses[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects declared oversized bodies and disallowed or missing content types", async () => {
    configure({ "public.example": { headers: { "content-length": "1000" }, chunks: ["small"] } });
    await expect(readPublicHttpsText("https://public.example/file", 100, 1000)).rejects.toThrow("Response exceeds byte limit");

    for (const contentType of ["application/octet-stream", "text/html", ""]) {
      configure({ "public.example": { headers: { "content-type": contentType }, chunks: ["body"] } });
      await expect(readPublicHttpsText("https://public.example/file", 100, 1000), contentType).rejects.toThrow("Content type not allowed");
    }

    configure({ "public.example": { headers: { "content-type": null }, chunks: ["body"] } });
    await expect(readPublicHttpsText("https://public.example/file", 100, 1000)).rejects.toThrow("Content type not allowed");
  });

  it("accepts allowed content types with charset parameters", async () => {
    configure({ "public.example": { headers: { "content-type": "application/json; charset=utf-8" }, chunks: ["{}"] } });
    await expect(readPublicHttpsText("https://public.example/file", 100, 1000)).resolves.toBe("{}");
  });
});
