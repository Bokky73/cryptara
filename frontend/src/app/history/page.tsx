import { requestLocale } from "@/i18n/server";
import { messages } from "@/i18n/messages";
import { createFormatters } from "@/i18n/format";
import { LocaleSelect } from "@/i18n/LocaleSelect";
import { AppShell } from "@/components/AppShell";
import { AuditExportButton } from "@/components/AuditExportButton";
import { listAgentRunRecords, listApprovalRecords, listRecommendationRecords, listTransactionRecords } from "@/server/storage";
import { DataTable } from "@/components/layout/DataTable";
import { RecentTransactions } from "@/components/RecentTransactions";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const { locale, timeZone } = await requestLocale();
  const t = messages(locale);
  const format = createFormatters(locale, timeZone);
  const [agentRuns, recommendations, approvals, transactions] = await Promise.all([
    listAgentRunRecords(),
    listRecommendationRecords(),
    listApprovalRecords(),
    listTransactionRecords(),
  ]);

  return (
    <AppShell>
      <div lang={locale} className="space-y-5">
        <section className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">{t("history")}</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-white/46">
            <span>{format.number(recommendations.length)} {t("recommendations")}</span>
            <span>{format.number(approvals.length)} {t("approvals")}</span>
            <span>{format.number(transactions.length)} {t("transactions")}</span>
            <LocaleSelect locale={locale} />
            <AuditExportButton />
          </div>
        </section>
        <section className="glass-panel rounded-lg p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-semibold">{t("agentRuns")}</h2>
            </div>
            <div className="rounded-full border border-white/10 bg-white/7 px-3 py-1 text-xs text-white/46">
              {format.number(agentRuns.length)} {t("savedRuns")}
            </div>
          </div>
          <DataTable caption={t("savedAgentRuns")} minWidth={860} className="mt-5">
              <thead className="text-xs uppercase tracking-[0.16em] text-white/36">
                <tr>
                  <th className="pb-3 font-medium">{t("recommendation")}</th>
                  <th className="pb-3 font-medium">{t("target")}</th>
                  <th className="pb-3 font-medium">{t("score")}</th>
                  <th className="pb-3 font-medium">{t("confidence")}</th>
                  <th className="pb-3 font-medium">{t("status")}</th>
                  <th className="pb-3 font-medium">{t("created")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {agentRuns.length > 0 ? (
                  agentRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="py-4">
                        <div className="font-semibold capitalize">{run.recommendation.replaceAll("_", " ")}</div>
                        <div className="mt-1 max-w-xl text-xs text-white/42">{run.summary}</div>
                      </td>
                      <td className="py-4 text-white/64">
                        {run.targetToken?.symbol ?? t("portfolio")}
                        {run.targetToken?.riskScore ? <span className="ml-2 text-white/34">{format.number(run.targetToken.riskScore)}/{format.number(100)}</span> : null}
                      </td>
                      <td className="py-4 text-white/70">{format.number(run.decisionScore)}/{format.number(100)}</td>
                      <td className="py-4 text-white/70">{format.percent(run.confidence)}</td>
                      <td className="py-4">
                        <span className="rounded-full border border-white/10 bg-white/7 px-3 py-1 text-xs capitalize">
                          {run.status}
                        </span>
                      </td>
                      <td className="py-4 text-white/58">{format.dateTime(run.createdAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-white/42">
                      {t("emptyRuns")}
                    </td>
                  </tr>
                )}
              </tbody>
          </DataTable>
        </section>

        <details className="glass-panel rounded-lg p-5">
          <summary className="cursor-pointer text-sm font-semibold text-white/72">{t("recentActivity")}</summary>
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div>
            <div className="text-sm uppercase tracking-[0.16em] text-[#d9a441]">{t("recommendations")}</div>
            <div className="mt-4 space-y-3">
              {recommendations.length > 0 ? (
                recommendations.slice(0, 5).map((recommendation) => (
                  <div key={recommendation.id} className="rounded-2xl bg-white/6 p-4">
                    <div className="text-sm font-semibold capitalize">{recommendation.action.replaceAll("_", " ")}</div>
                    <div className="mt-1 text-xs leading-5 text-white/44">{recommendation.summary}</div>
                    <div className="mt-3 flex justify-between text-xs text-white/38">
                      <span>{format.number(recommendation.decisionScore)}/{format.number(100)}</span>
                      <span>{format.percent(recommendation.confidence)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/42">{t("emptyRecommendations")}</div>
              )}
            </div>
          </div>

          <div>
            <div className="text-sm uppercase tracking-[0.16em] text-[#d9a441]">{t("approvals")}</div>
            <div className="mt-4 space-y-3">
              {approvals.length > 0 ? (
                approvals.slice(0, 5).map((approval) => (
                  <div key={approval.id} className="rounded-2xl bg-white/6 p-4">
                    <div className="text-sm font-semibold">{t("walletConfirmed")}</div>
                    <div className="mt-1 break-all text-xs leading-5 text-white/44">{approval.txHash}</div>
                    <div className="mt-3 text-xs text-white/38">{format.dateTime(approval.createdAt)}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/42">{t("emptyApprovals")}</div>
              )}
            </div>
          </div>

          <div>
            <div className="text-sm uppercase tracking-[0.16em] text-[#d9a441]">{t("transactions")}</div>
            <div className="mt-4">
              <RecentTransactions transactions={transactions} />
            </div>
          </div>
          </div>
        </details>
      </div>
    </AppShell>
  );
}
