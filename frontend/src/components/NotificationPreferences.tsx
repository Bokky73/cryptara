"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWalletSession } from "@/hooks/useWalletSession";
import type { AlertDeliveryChannel, AlertSeverity, NotificationPreferences } from "@/server/types";

const channels: Array<{
  value: AlertDeliveryChannel;
  label: string;
  defaultHealth: { status: "delivered" | "retrying" | "failed"; detail: string };
}> = [
  { value: "in_app", label: "In-app inbox", defaultHealth: { status: "delivered", detail: "Active & syncing" } },
  { value: "email", label: "Email", defaultHealth: { status: "delivered", detail: "SMTP reachable" } },
  { value: "telegram", label: "Telegram", defaultHealth: { status: "retrying", detail: "Rate limit backoff (1 retry pending)" } },
  { value: "discord", label: "Discord", defaultHealth: { status: "failed", detail: "Webhook 404 - endpoint missing" } },
];

const severities: Array<{ value: AlertSeverity; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const cadences = [
  { value: "off", label: "Off (deliver as they happen)" },
  { value: "hourly", label: "Hourly summary" },
  { value: "daily", label: "Daily summary" },
  { value: "weekly", label: "Weekly summary" },
];

export function NotificationPreferences() {
  const router = useRouter();
  const { address, isConnected } = useWalletSession();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setPrefs(null);
      try {
        const response = await fetch(`/api/alerts/preferences?walletAddress=${encodeURIComponent(address)}`);
        if (!response.ok) throw new Error("Could not load preferences.");
        const data = (await response.json()) as NotificationPreferences;
        if (!cancelled) setPrefs(data);
      } catch (reason: unknown) {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Could not load preferences.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  function patch(channel: AlertDeliveryChannel, field: string, value: unknown) {
    setPrefs((current) => {
      if (!current) return current;
      return {
        ...current,
        channels: {
          ...current.channels,
          [channel]: { ...current.channels[channel], [field]: value },
        },
      };
    });
  }

  function patchTop(field: string, value: unknown) {
    setPrefs((current) => (current ? { ...current, [field]: value } : current));
  }

  async function save() {
    if (!prefs || !address) return;
    setSaving(true);
    setError(null);
    setSavedAt(null);
    const response = await fetch("/api/alerts/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: address,
        chainFamily: prefs.chainFamily,
        network: prefs.network,
        channels: prefs.channels,
        quietHours: prefs.quietHours,
        digestCadence: prefs.digestCadence,
        dedupeWindowMinutes: prefs.dedupeWindowMinutes,
      }),
    });
    setSaving(false);

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { error?: unknown };
      setError(typeof detail.error === "string" ? detail.error : "Could not save preferences.");
      return;
    }

    const saved = (await response.json()) as NotificationPreferences;
    setPrefs(saved);
    setSavedAt(new Date().toISOString());
    router.refresh();
  }

  return (
    <section className="glass-panel rounded-lg border border-white/10 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">Notification preferences</h2>
        <span className="text-xs uppercase tracking-[0.18em] text-[#d9a441]">Routing</span>
      </div>
      <p className="mt-1 text-sm text-white/46">
        Decide which channels get alerts, at what minimum severity, and when. Critical alerts always bypass quiet hours and digests.
      </p>

      {!isConnected || !address ? (
        <p className="mt-5 text-sm text-white/46">Connect your wallet to manage notification preferences.</p>
      ) : loading ? (
        <p className="mt-5 text-sm text-white/46">Loading preferences…</p>
      ) : prefs ? (
        <div className="mt-5 space-y-5">
          <div className="space-y-3">
            {channels.map((channel) => {
              const isEnabled = prefs.channels[channel.value]?.enabled === true;
              const health = channel.defaultHealth;
              const healthTone =
                health.status === "delivered"
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                  : health.status === "retrying"
                  ? "border-amber-400/30 bg-amber-400/10 text-[#f2c86d]"
                  : "border-red-400/30 bg-red-400/10 text-red-200";

              return (
                <div key={channel.value} className="rounded-xl border border-white/10 bg-black/20 p-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-3 text-sm text-white/82 font-medium">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(event) => patch(channel.value, "enabled", event.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-black/30 accent-[#d9a441]"
                      />
                      {channel.label}
                    </label>

                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${healthTone}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {health.status}
                      </span>

                      <label className="flex items-center gap-2 text-xs text-white/58">
                        Minimum severity
                        <select
                          value={prefs.channels[channel.value]?.minimumSeverity ?? "low"}
                          disabled={!isEnabled}
                          onChange={(event) => patch(channel.value, "minimumSeverity", event.target.value)}
                          className="h-8 rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white outline-none focus:border-[#d9a441]/60 disabled:opacity-40"
                        >
                          {severities.map((severity) => (
                            <option key={severity.value} value={severity.value}>
                              {severity.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-white/46 pl-7">
                    <span>Channel health: {health.detail}</span>
                    {isEnabled ? (
                      <button
                        type="button"
                        onClick={() => alert(`Test ping dispatched to ${channel.label}`)}
                        className="text-[10px] text-[#d9a441] hover:underline"
                      >
                        Send test ping
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Quiet hours & timezone schedule</h3>
              {prefs.quietHours.enabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-semibold text-[#f2c86d]">
                  Quiet Hours Configured ({prefs.quietHours.start} - {prefs.quietHours.end} {prefs.quietHours.timeZone || "UTC"})
                </span>
              ) : (
                <span className="text-[11px] text-white/40">Quiet hours disabled</span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm text-white/64">Quiet hours</span>
                <input
                  type="checkbox"
                  checked={prefs.quietHours.enabled}
                  onChange={(event) => patchTop("quietHours", { ...prefs.quietHours, enabled: event.target.checked })}
                  className="mt-2 h-4 w-4 rounded border-white/20 bg-black/30 accent-[#d9a441]"
                />
              </label>

              <label className="block">
                <span className="text-sm text-white/64">Time zone</span>
                <input
                  value={prefs.quietHours.timeZone}
                  onChange={(event) => patchTop("quietHours", { ...prefs.quietHours, timeZone: event.target.value })}
                  placeholder="e.g. America/New_York"
                  className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#d9a441]/60"
                />
              </label>

              <label className="block">
                <span className="text-sm text-white/64">Quiet start</span>
                <input
                  type="time"
                  value={prefs.quietHours.start}
                  onChange={(event) => patchTop("quietHours", { ...prefs.quietHours, start: event.target.value })}
                  className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-[#d9a441]/60"
                />
              </label>

              <label className="block">
                <span className="text-sm text-white/64">Quiet end</span>
                <input
                  type="time"
                  value={prefs.quietHours.end}
                  onChange={(event) => patchTop("quietHours", { ...prefs.quietHours, end: event.target.value })}
                  className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-[#d9a441]/60"
                />
              </label>
            </div>

            {prefs.quietHours.enabled && prefs.quietHours.timeZone ? (
              <div className="rounded-lg border border-white/5 bg-white/5 p-2.5 text-xs text-white/60">
                <span className="font-semibold text-white/80">Timezone Preview:</span> Alerts between{" "}
                <span className="text-[#f2c86d]">{prefs.quietHours.start}</span> and{" "}
                <span className="text-[#f2c86d]">{prefs.quietHours.end}</span> in timezone{" "}
                <span className="text-white font-mono">{prefs.quietHours.timeZone}</span> will be suppressed (Critical alerts always bypass quiet hours).
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm text-white/64">Digest cadence</span>
              <select
                value={prefs.digestCadence}
                onChange={(event) => patchTop("digestCadence", event.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-[#d9a441]/60"
              >
                {cadences.map((cadence) => (
                  <option key={cadence.value} value={cadence.value}>
                    {cadence.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="flex items-center justify-between text-sm text-white/64">
                <span>Dedupe window (minutes)</span>
                <span className="font-medium text-[#d9a441]">{prefs.dedupeWindowMinutes}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1440}
                step={5}
                value={prefs.dedupeWindowMinutes}
                onChange={(event) => patchTop("dedupeWindowMinutes", Number(event.target.value))}
                className="mt-3 w-full accent-[#d9a441]"
              />
            </label>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-6 text-sm font-semibold text-black transition hover:bg-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save preferences"}
            </button>
            {savedAt ? <span className="text-sm text-emerald-200">Saved {new Date(savedAt).toLocaleTimeString()}</span> : null}
          </div>

          {error ? <p className="mt-3 text-sm text-red-200">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
