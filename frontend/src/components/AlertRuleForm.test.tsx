import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertRuleForm } from "@/components/AlertRuleForm";
import { renderWithProviders } from "@/test/renderWithProviders";

const fixture = vi.hoisted(() => ({
  connected: false,
  address: "0xabc",
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: fixture.refresh }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a>,
}));
vi.mock("@/hooks/useWalletSession", () => ({
  useWalletSession: () => ({ address: fixture.address, isConnected: fixture.connected }),
}));

function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 422, json: async () => body } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fixture.connected = true;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AlertRuleForm", () => {
  it("applies lower-bound defaults for a liquidity trigger and submits bounded values", async () => {
    fetchMock.mockResolvedValue(response({ id: "rule-1" }));
    renderWithProviders(<AlertRuleForm />);

    fireEvent.change(screen.getByLabelText("Trigger"), { target: { value: "liquidity_drop" } });
    expect(screen.getByText("25000")).toBeTruthy();
    expect(screen.getByText("5000")).toBeTruthy();
    expect((screen.getByRole("slider", { name: /Threshold/ }) as HTMLInputElement).max).toBe("5000000");

    fireEvent.change(screen.getByRole("slider", { name: /Cooldown minutes/ }), { target: { value: "120" } });
    fireEvent.click(screen.getByText("Low", { selector: "button" }));
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      triggerType: "liquidity_drop",
      threshold: 25000,
      hysteresis: 5000,
      cooldownMinutes: 120,
      severity: "low",
      direction: "low_is_bad",
    });
    await waitFor(() => expect(fixture.refresh).toHaveBeenCalled());
  });

  it("keeps upper-bound thresholds for critical risk alerts", () => {
    renderWithProviders(<AlertRuleForm />);

    const slider = screen.getByRole("slider", { name: /Threshold/ }) as HTMLInputElement;
    expect(slider.max).toBe("100");
    expect(screen.getByText("75")).toBeTruthy();
    expect(screen.getByText("critical severity")).toBeTruthy();
  });

  it("refuses to save without a connected wallet", async () => {
    fixture.connected = false;
    const { container } = renderWithProviders(<AlertRuleForm />);

    expect((screen.getByRole("button", { name: "Create rule" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(container.querySelector("form")!);

    expect(await screen.findByText("Connect your wallet to save an alert rule.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces server-side validation errors without claiming a save", async () => {
    fetchMock.mockResolvedValue(response({ error: "Threshold must be within bounds" }, false));
    renderWithProviders(<AlertRuleForm />);

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByText("Threshold must be within bounds")).toBeTruthy();
    expect(screen.queryByText(/^Saved /)).toBeNull();
  });
});
