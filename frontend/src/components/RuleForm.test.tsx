import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuleForm } from "@/components/RuleForm";
import { STRATEGY_PRESETS } from "@/server/rules/presets";
import type { UserRule } from "@/server/types";
import { renderWithProviders } from "@/test/renderWithProviders";

const fixture = vi.hoisted(() => ({ actionsDisabled: false }));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => ({ actionsDisabled: fixture.actionsDisabled }) }));

const ADDRESS = "0xabc";
const presets = [STRATEGY_PRESETS.conservative, STRATEGY_PRESETS.balanced];
const chains = [{ id: "goat", name: "Goat", chainFamily: "evm" }];
const categories = ["meme", "unaudited"];

function initialRules(): UserRule {
  return {
    walletAddress: ADDRESS,
    maxRiskScore: 70,
    maxBuyRisk: 70,
    maxTradePercent: 10,
    maxTradeValueUsd: 1000,
    maxDailyValueUsd: 5000,
    minLiquidityUsd: 50000,
    maxSingleTokenExposurePercent: 20,
    minStableReservePercent: 20,
    maxMemeExposurePercent: 5,
    maxSlippageBps: 100,
    allowedChains: ["goat"],
    blockedAssets: [],
    blockedCategories: [],
    autoExecute: false,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  } as unknown as UserRule;
}

function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 422, json: async () => body } as Response;
}

function renderForm(save: (rule: UserRule) => Promise<Response>, walletAddress: string | null = ADDRESS) {
  return renderWithProviders(
    <RuleForm
      initialRules={initialRules()}
      presets={presets}
      chains={chains}
      categories={categories}
      walletAddress={walletAddress ?? undefined}
      save={save}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.actionsDisabled = false;
});

describe("RuleForm", () => {
  it("applies a preset and warns when the slippage ceiling is raised", async () => {
    const save = vi.fn().mockResolvedValue(response({ ok: true }));
    renderForm(save);

    fireEvent.click(screen.getByRole("radio", { name: /Balanced/ }));
    expect(screen.getByRole("radio", { name: /Balanced/ }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("Max Buy Risk") as HTMLInputElement).value).toBe("60");
    expect((screen.getByLabelText("Max slippage") as HTMLInputElement).value).toBe("100");

    fireEvent.change(screen.getByLabelText("Max slippage"), { target: { value: "500" } });
    expect(screen.getByText(/High slippage warning/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ profileId: "balanced", maxSlippageBps: 500, maxBuyRisk: 60 });
  });

  it("shows field-level validation issues from a rejected save", async () => {
    const save = vi.fn().mockResolvedValue(response({
      error: "Strategy rejected",
      issues: [{ field: "maxSlippageBps", message: "Slippage cap exceeded" }],
    }, false));
    renderForm(save);

    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));

    expect(await screen.findByText("Slippage cap exceeded")).toBeTruthy();
    expect(screen.getByText("Strategy rejected")).toBeTruthy();
    expect(screen.getByLabelText("Max slippage").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("keeps the form read-only without a wallet", () => {
    const save = vi.fn().mockResolvedValue(response({ ok: true }));
    renderForm(save, null);

    expect((screen.getByRole("button", { name: "Save strategy" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Connect a wallet to load and save a strategy profile.")).toBeTruthy();
    expect(screen.getByLabelText("Max slippage").closest("fieldset")?.hasAttribute("disabled")).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("locks strategy changes while offline", () => {
    fixture.actionsDisabled = true;
    const save = vi.fn().mockResolvedValue(response({ ok: true }));
    renderForm(save);

    expect((screen.getByRole("button", { name: "Save strategy" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Strategy changes are disabled until connectivity returns/)).toBeTruthy();
  });

  it("validates blocked asset keys before adding them", () => {
    const save = vi.fn().mockResolvedValue(response({ ok: true }));
    renderForm(save);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Enter an asset key first.")).toBeTruthy();

    const input = screen.getByLabelText("Asset key to block");
    fireEvent.change(input, { target: { value: "evm:base:0xabc" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("evm:base:0xabc")).toBeTruthy();

    fireEvent.change(input, { target: { value: "evm:base:0xabc" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("That asset is already blocked.")).toBeTruthy();
  });
});
