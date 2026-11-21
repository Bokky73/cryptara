import { Page } from "@/components/layout/Page";
import { Section } from "@/components/layout/Section";
import { Stack, Row, Columns } from "@/components/layout/Stack";

export default function DesignTokensPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Page
        title="Design System Tokens"
        description="Standardized typographic scale, spacing rhythm, border radii, and focus-ring consistency verification."
      >
        <Stack gap="lg">
          <Section title="Typography Scale" description="Explicit scale tokens across display, heading, subheading, body, caption, and mono">
            <div className="space-y-4">
              <div>
                <p className="text-xs text-[var(--color-fg-subtle)] uppercase">Display (36px / 2.25rem)</p>
                <div style={{ fontSize: "var(--font-size-display)", lineHeight: "var(--line-height-display)" }} className="font-semibold text-white">
                  Deterministic Defense Engine
                </div>
              </div>
              <div>
                <p className="text-xs text-[var(--color-fg-subtle)] uppercase">Heading (24px / 1.5rem)</p>
                <div style={{ fontSize: "var(--font-size-heading)", lineHeight: "var(--line-height-heading)" }} className="font-semibold text-white">
                  Multi-Agent Risk Verification
                </div>
              </div>
              <div>
                <p className="text-xs text-[var(--color-fg-subtle)] uppercase">Subheading (18px / 1.125rem)</p>
                <div style={{ fontSize: "var(--font-size-subheading)", lineHeight: "var(--line-height-subheading)" }} className="font-medium text-white/90">
                  Stellar Soroban & EVM Dual Execution
                </div>
              </div>
              <div>
                <p className="text-xs text-[var(--color-fg-subtle)] uppercase">Body (14px / 0.875rem)</p>
                <div style={{ fontSize: "var(--font-size-body)", lineHeight: "var(--line-height-body)" }} className="text-white/70">
                  Continuous verification against reentrancy, proxy mutations, and unauthorized withdrawals.
                </div>
              </div>
              <div>
                <p className="text-xs text-[var(--color-fg-subtle)] uppercase">Caption (12px / 0.75rem)</p>
                <div style={{ fontSize: "var(--font-size-caption)", lineHeight: "var(--line-height-caption)" }} className="text-white/50">
                  Last verified 2m ago · SHA-256: 0x9493f09...
                </div>
              </div>
              <div>
                <p className="text-xs text-[var(--color-fg-subtle)] uppercase">Mono Address (13px / 0.8125rem)</p>
                <div style={{ fontSize: "var(--font-size-mono-address)", fontFamily: "var(--font-mono)" }} className="text-[#f2c86d]">
                  0x1111111111111111111111111111111111111111
                </div>
              </div>
            </div>
          </Section>

          <Section title="Focus Rings & Interactive Controls" description="Test tab navigation and consistent 2px focus-visible ring">
            <Row gap="md">
              <button className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90">
                Primary Button
              </button>
              <button className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-bg)] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
                Secondary Button
              </button>
              <input
                type="text"
                placeholder="Focus test input..."
                className="rounded-lg border border-[var(--color-border)] bg-black/40 px-3 py-2 text-sm text-white placeholder-white/40"
              />
            </Row>
          </Section>

          <Section title="Spacing & Layout Rhythm" description="Stack, Row, and Responsive Columns">
            <Columns count={3} gap="md">
              <div className="rounded-[var(--radius-md)] border border-white/10 bg-white/5 p-4 text-sm text-white">
                Column 1
              </div>
              <div className="rounded-[var(--radius-md)] border border-white/10 bg-white/5 p-4 text-sm text-white">
                Column 2
              </div>
              <div className="rounded-[var(--radius-md)] border border-white/10 bg-white/5 p-4 text-sm text-white">
                Column 3
              </div>
            </Columns>
          </Section>
        </Stack>
      </Page>
    </main>
  );
}
