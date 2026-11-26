import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel";
import { buildErrorDiagnostics, redactDiagnosticText } from "@/lib/errors/diagnostics";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <><nav aria-label="Primary" />{children}</>,
}));

const evm = "0x1111111111111111111111111111111111111111";
const stellar = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  window.history.replaceState({}, "", `/scan/${evm}?wallet=${stellar}&signature=abc`);
});

afterEach(() => window.history.replaceState({}, "", "/"));

describe("redactDiagnosticText", () => {
  it.each([
    ["EVM address", `owner ${evm} failed`, evm],
    ["Stellar address", `owner ${stellar} failed`, stellar],
    ["lowercased Stellar address", `owner ${stellar.toLowerCase()}`, stellar.toLowerCase()],
    ["Stellar secret", `S${stellar.slice(1)}`, stellar.slice(1)],
    ["signature", `0x${"ab".repeat(65)}`, "abab"],
    ["bearer token", "Bearer abc.def", "abc.def"],
    ["cookie header", "Cookie: gr_wallet_session=v2:x; theme=dark", "theme=dark"],
    ["authorization json", '{"authorization":"Basic Zm9v"}', "Zm9v"],
    ["JWT", "jwt eyJhbGciOi.eyJzdWIi.sig", "eyJzdWIi"],
    ["query string", "GET https://api.test/x?wallet=me&cursor=1 failed", "wallet=me"],
    ["URL credentials", "postgres://user:hunter2@db/x", "hunter2"],
    ["assignment", 'password="two words"', "two words"],
    ["email", "from a.user@example.com", "a.user"],
    ["XDR", `AAAAAgAAAA${"Ab1/".repeat(20)}==`, "Ab1/Ab1/"],
  ])("removes a %s", (_label, input, secret) => {
    expect(redactDiagnosticText(input)).not.toContain(secret);
  });

  it("keeps ordinary messages readable", () => {
    expect(redactDiagnosticText("Cannot read properties of undefined (reading 'map')"))
      .toBe("Cannot read properties of undefined (reading 'map')");
  });
});

describe("ErrorRecoveryPanel", () => {
  it("shows correlation IDs and prefers retry over reset", () => {
    const retry = vi.fn();
    const reset = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: "1234567890", requestId: "req_42" });
    render(<ErrorRecoveryPanel error={error} retry={retry} reset={reset} />);

    expect(screen.getByText("1234567890")).toBeTruthy();
    expect(screen.getByText("req_42")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Return to dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.getByRole("link", { name: "Check system health" })).toBeTruthy();
  });

  it("copies and logs only redacted diagnostics", async () => {
    const error = Object.assign(new Error(`wallet ${evm} cookie: session=abc`), { digest: evm, requestId: stellar });
    render(<ErrorRecoveryPanel error={error} reset={() => undefined} boundary="scan" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" })); });

    const outputs = [
      writeText.mock.calls[0][0],
      JSON.stringify(vi.mocked(console.error).mock.calls),
      document.body.textContent ?? "",
    ];
    for (const output of outputs) {
      for (const secret of [evm, stellar, "session=abc", "signature=abc"]) expect(output).not.toContain(secret);
    }
    expect(outputs[0]).toContain("boundary: scan");
    expect(outputs[0]).toContain("path: /scan/[WALLET_REDACTED]");
  });

  it("offers manual copying when the clipboard is blocked", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<ErrorRecoveryPanel error={new Error("boom")} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" })); });
    expect((screen.getByLabelText(/manually/) as HTMLTextAreaElement).value).toContain("message: boom");
  });

  it.each([["string", "thrown"], ["null", null], ["undefined", undefined], ["number", 7]])("handles a thrown %s", (_label, error) => {
    render(<ErrorRecoveryPanel error={error} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(buildErrorDiagnostics(error, "x").name).toBe("UnknownError");
  });

  it("never offers a retry for an ambiguous submission", () => {
    render(<ErrorRecoveryPanel error={{ code: "submission_failure" }} retry={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("route boundaries", () => {
  it.each([
    ["agents", () => import("@/app/agents/error")],
    ["alerts", () => import("@/app/alerts/error")],
    ["dashboard", () => import("@/app/dashboard/error")],
    ["history", () => import("@/app/history/error")],
    ["insights", () => import("@/app/insights/error")],
    ["operations", () => import("@/app/operations/error")],
    ["recovery", () => import("@/app/recovery/error")],
    ["scan", () => import("@/app/scan/error")],
    ["strategy", () => import("@/app/strategy/error")],
  ])("keeps navigation when /%s fails", async (_segment, load) => {
    const { default: Boundary } = await load();
    render(<Boundary error={new Error("boom")} reset={() => undefined} />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
