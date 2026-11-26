import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/commandPalette/CommandPalette";
import { CommandTrigger } from "@/components/commandPalette/CommandTrigger";
import type { PaletteScope, SessionAsset } from "@/lib/commandPalette/schema";
import { renderWithProviders } from "@/test/renderWithProviders";

const fixture = vi.hoisted(() => ({
  pathname: "/dashboard",
  push: vi.fn(),
  session: {
    isConnected: true,
    address: "0xabc",
    family: "evm",
    chainId: 48816,
    stellar: { network: "stellar-testnet" },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: fixture.push }),
  usePathname: () => fixture.pathname,
}));

vi.mock("@/providers/WalletSessionProvider", () => ({
  useWalletSessionContext: () => fixture.session,
}));

vi.mock("next/dynamic", async () => {
  const { CommandPalette: Palette } = await import("./CommandPalette");
  return { default: () => Palette };
});

const scope: PaletteScope = { wallet: "0xabc", family: "evm", network: "48816" };
const assets: SessionAsset[] = [{
  scope,
  assetKey: "evm:base:0xabc",
  symbol: "USD",
  name: "USD Coin",
  source: "watchlist",
}];

beforeEach(() => {
  vi.clearAllMocks();
  fixture.pathname = "/dashboard";
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

describe("CommandPalette", () => {
  it("opens and closes with the keyboard shortcut and Escape", () => {
    renderWithProviders(<CommandTrigger />);
    const trigger = screen.getByRole("button", { name: "Search routes and insights" });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("combobox"));

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(window, { key: "K", metaKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("filters results and navigates to the highlighted command", () => {
    const close = vi.fn();
    const navigate = vi.fn();
    renderWithProviders(<CommandPalette open scope={null} assets={[]} close={close} navigate={navigate} />);
    const search = screen.getByRole("combobox");

    fireEvent.change(search, { target: { value: "history" } });
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option").every((option) => option.textContent?.includes("history"))).toBe(true);

    fireEvent.change(search, { target: { value: "dashboard" } });
    expect(screen.getAllByRole("option")[0].textContent).toContain("Dashboard");
    fireEvent.keyDown(search, { key: "Enter" });

    expect(navigate).toHaveBeenCalledWith("/dashboard");
    expect(close).toHaveBeenCalled();
  });

  it("moves selection with arrow keys and activates a result by click", () => {
    const close = vi.fn();
    const navigate = vi.fn();
    renderWithProviders(<CommandPalette open scope={null} assets={[]} close={close} navigate={navigate} />);
    const search = screen.getByRole("combobox");

    fireEvent.keyDown(search, { key: "ArrowUp" });
    const options = screen.getAllByRole("option");
    expect(options[options.length - 1].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getAllByRole("option")[0]);

    expect(navigate).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalled();
  });

  it("announces an empty result and keeps IME Enter inert", () => {
    const navigate = vi.fn();
    renderWithProviders(<CommandPalette open scope={null} assets={[]} close={() => undefined} navigate={navigate} />);
    const search = screen.getByRole("combobox");

    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.change(search, { target: { value: "zzzz-no-match" } });
    expect(screen.getAllByText("No matching pages, insights or session assets.").length).toBeGreaterThan(0);
    expect(search.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("includes session assets and discloses when none are available", () => {
    const withAssets = renderWithProviders(
      <CommandPalette open scope={scope} assets={assets} close={() => undefined} navigate={() => undefined} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "USD" } });
    expect(screen.getAllByRole("option").some((option) => option.textContent?.includes("Session assets"))).toBe(true);
    withAssets.unmount();

    renderWithProviders(<CommandPalette open scope={scope} assets={[]} close={() => undefined} navigate={() => undefined} />);
    expect(screen.getByText("No session assets supplied. Page navigation is available.")).toBeTruthy();
  });
});
