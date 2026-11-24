import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock3, Database, FileWarning, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RiskSnapshotActions } from "@/components/RiskSnapshotActions";
import { StellarRiskPublishButton } from "@/components/StellarRiskPublishButton";
import { canonicalAssetIdentity } from "@/server/snapshots/canonical";
import { findLatestRiskSnapshot, readRiskSnapshot } from "@/server/snapshots/store";

export const dynamic = "force-dynamic";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

function failureTitle(code: string) {
  if (code === "expired") return "Snapshot expired";
  if (code === "revoked") return "Snapshot revoked";
  if (code === "tampered") return "Integrity check failed";
  if (code === "identity_collision") return "Asset identity mismatch";
  if (code === "unknown_version") return "Unsupported snapshot version";
  return "Snapshot not found";
}

export default async function RiskSnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await readRiskSnapshot(id);

  if (!result.ok && result.code === "not_found") notFound();

  if (!result.ok) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl py-8">
          <section role="alert" className="rounded-[28px] border border-red-300/25 bg-red-400/10 p-7">
            <FileWarning className="h-8 w-8 text-red-200" aria-hidden="true" />
            <h1 className="mt-5 text-3xl font-semibold">{failureTitle(result.code)}</h1>
            <p className="mt-3 text-sm leading-6 text-red-100/75">{result.detail}</p>
            <p className="mt-5 text-xs text-white/45">The report is hidden because snapshot validation fails closed.</p>
          </section>
        </div>
      </AppShell>
    );
  }

  const { snapshot } = result;
  const report = snapshot.document;
  const staleAtCreation = Date.parse(snapshot.createdAt) >= Date.parse(report.freshness.staleAt);
  const latest = await findLatestRiskSnapshot(canonicalAssetIdentity(report.asset), {
    excludeId: snapshot.id,
  });
  const comparisonIds = latest
    ? Date.parse(latest.createdAt) >= Date.parse(snapshot.createdAt)
      ? { left: snapshot.id, right: latest.id }
      : { left: latest.id, right: snapshot.id }
    : undefined;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-5 py-4 sm:py-8">
        <section className="rounded-[28px] border border-[#d9a441]/25 bg-[#d9a441]/8 p-5 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#f2c86d]">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verified risk snapshot
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight">{report.asset.symbol}</h1>
              <p className="mt-2 text-sm text-white/55">{report.asset.name ?? report.asset.identity.canonicalId}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-black/25 p-4 text-center">
                <div className="text-4xl font-semibold">{report.scores.buyRisk}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.15em] text-white/42">Buy risk</div>
              </div>
              <div className="rounded-2xl bg-black/25 p-4 text-center">
                <div className="text-4xl font-semibold">{Math.round(report.scores.confidence * 100)}%</div>
                <div className="mt-1 text-xs uppercase tracking-[0.15em] text-white/42">Confidence</div>
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/8 bg-black/18 p-4"><div className="text-xs text-white/42">Network</div><div className="mt-1 font-semibold uppercase">{report.asset.network}</div></div>
            <div className="rounded-2xl border border-white/8 bg-black/18 p-4"><div className="text-xs text-white/42">Verdict</div><div className="mt-1 font-semibold capitalize">{report.verdict.replaceAll("_", " ")}</div></div>
            <div className={`rounded-2xl border p-4 ${staleAtCreation ? "border-orange-300/25 bg-orange-400/10 text-orange-100" : "border-emerald-300/20 bg-emerald-400/8 text-emerald-100"}`}>
              <div className="text-xs opacity-60">Source freshness</div><div className="mt-1 flex items-center gap-2 font-semibold">{staleAtCreation ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{staleAtCreation ? "Stale when captured" : "Fresh when captured"}</div>
            </div>
          </div>
          <p className="mt-6 max-w-3xl text-sm leading-6 text-white/70">{report.summary}</p>
          <RiskSnapshotActions
            snapshotId={snapshot.id}
            document={report}
            expectedHash={snapshot.canonicalHash}
            comparisonIds={comparisonIds}
          />
          {report.asset.chainFamily === "stellar" ? (
            <StellarRiskPublishButton
              network={report.asset.network}
              assetKey={report.asset.identity.canonicalId}
              assetLabel={report.asset.symbol}
              score={report.scores.buyRisk}
              verdict={report.verdict}
              report={report}
              expectedHash={snapshot.canonicalHash}
            />
          ) : null}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="glass-panel rounded-[28px] p-6">
            <h2 className="text-xl font-semibold">Report provenance</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div><dt className="text-white/40">Generated</dt><dd className="mt-1">{formatTime(report.freshness.generatedAt)}</dd></div>
              <div><dt className="text-white/40">Stale after</dt><dd className="mt-1">{formatTime(report.freshness.staleAt)}</dd></div>
              <div><dt className="text-white/40">Snapshot expires</dt><dd className="mt-1">{formatTime(snapshot.expiresAt)}</dd></div>
              <div><dt className="text-white/40">Canonical SHA-256</dt><dd className="mt-1 break-all font-mono text-xs text-white/65">{snapshot.canonicalHash}</dd></div>
              <div><dt className="text-white/40">Schema / product</dt><dd className="mt-1">v{snapshot.schemaVersion} / {report.product.version}</dd></div>
            </dl>
          </div>
          <div className="glass-panel rounded-[28px] p-6">
            <h2 className="text-xl font-semibold">Top reasons</h2>
            <ol className="mt-5 space-y-3">
              {report.topReasons.length ? report.topReasons.map((reason, index) => (
                <li key={`${index}:${reason}`} className="rounded-2xl bg-white/6 p-4 text-sm leading-6 text-white/65"><span className="mr-2 text-[#d9a441]">{index + 1}.</span>{reason}</li>
              )) : <li className="text-sm text-white/45">No public reasons were included.</li>}
            </ol>
          </div>
        </section>

        <section className="glass-panel rounded-[28px] p-6">
          <div className="flex items-center gap-2"><Database className="h-5 w-5 text-[#d9a441]" aria-hidden="true" /><h2 className="text-xl font-semibold">Evidence and missing data</h2></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              {report.evidence.map((item) => (
                <article key={`${item.label}:${item.checkedAt ?? "unknown"}`} className="rounded-2xl border border-white/8 bg-black/18 p-4">
                  <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{item.label}</h3><span className="text-xs capitalize text-white/45">{item.status}</span></div>
                  <div className="mt-2 text-xs text-white/45">{item.checkedAt ? `Checked ${formatTime(item.checkedAt)}` : "Check time unavailable"}</div>
                  {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-[#f2c86d] underline-offset-4 hover:underline">Open evidence source</a> : null}
                </article>
              ))}
            </div>
            <div className="space-y-3">
              {report.missingData.length ? report.missingData.map((item) => (
                <div key={`${item.field}:${item.impact}`} className="rounded-2xl border border-orange-300/20 bg-orange-400/8 p-4 text-sm"><div className="font-semibold">{item.field}</div><div className="mt-1 text-xs capitalize text-orange-100/60">{item.impact} impact</div></div>
              )) : <div className="rounded-2xl border border-emerald-300/15 bg-emerald-400/7 p-4 text-sm text-emerald-100">No missing-data markers were recorded.</div>}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-white/55">
          <div className="flex items-start gap-3"><Clock3 className="mt-1 h-4 w-4 shrink-0 text-[#d9a441]" aria-hidden="true" /><p><strong className="text-white/75">Information only.</strong> This snapshot is not financial advice. Its hash proves that the displayed public artifact has not changed; it does not prove that upstream providers were correct. Check freshness and independently verify material claims before acting.</p></div>
        </section>
      </div>
    </AppShell>
  );
}
