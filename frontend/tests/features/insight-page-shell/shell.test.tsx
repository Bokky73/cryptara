import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { useInsightPageStatus, type InsightPageStatus } from "@/components/research/shared/insightPageStatus";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <><nav aria-label="Primary" />{children}</>,
}));

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });

function Report(props: InsightPageStatus) {
  useInsightPageStatus(props);
  return <p>content</p>;
}

describe("InsightPageShell", () => {
  it("shows the heading, navigation, and content without a stamp by default", () => {
    render(<InsightPageShell id="demo" title="Demo" description="About"><p>content</p></InsightPageShell>);
    expect(screen.getByRole("heading", { level: 1, name: "Demo" })).toBeTruthy();
    expect(screen.getByText("content")).toBeTruthy();
    expect(screen.queryByText("Data captured")).toBeNull();
  });

  it("shows and withdraws the freshness and empty state a view reports", () => {
    const view = render(
      <InsightPageShell id="demo"><Report capturedAt={new Date().toISOString()} empty={{ title: "Nothing", detail: "None" }} /></InsightPageShell>,
    );
    expect(screen.getByText("Data captured")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Nothing" })).toBeTruthy();

    view.rerender(<InsightPageShell id="demo"><Report /></InsightPageShell>);
    expect(screen.queryByText("Data captured")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Nothing" })).toBeNull();
  });

  it("isolates a failing workbench and recovers", () => {
    let broken = true;
    function Workbench() {
      if (broken) throw new Error("chart failed");
      return <p>recovered</p>;
    }
    render(<InsightPageShell id="demo" title="Demo"><Workbench /></InsightPageShell>);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Demo" })).toBeTruthy();

    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("recovered")).toBeTruthy();
  });

  it("lets views report status outside a shell", () => {
    render(<Report capturedAt="2026-01-01T00:00:00.000Z" />);
    expect(screen.getByText("content")).toBeTruthy();
  });
});
