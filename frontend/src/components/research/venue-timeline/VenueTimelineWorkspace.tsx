"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useInsightPageStatus } from "@/components/research/shared/insightPageStatus";
import { useRef, useState, type FormEvent } from "react";

export function VenueTimelineWorkspace() {
  const [contract, setContract] = useInsightParam("asset", "");
  const [report, setReport] = useState<{
    venues: { venue: string; state: string; source: string }[];
    timeline: { venue: string; from: string | null; to: string; observedAt: string }[];
    coverage: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [capturedAt, setCapturedAt] = useState<string>();
  const generation = useRef(0);
  useInsightPageStatus({
    capturedAt,
    empty: report && report.venues.length === 0
      ? { title: "No venues observed", detail: "No configured venue reported this token." }
      : undefined,
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    try {
      const response = await fetch("/api/insights/venue-timeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: 1, contract, snapshots: [] }),
      });
      const payload = await response.json();
      if (request !== generation.current) return;
      if (!response.ok) {
        setReport(null);
        setCapturedAt(undefined);
        setError(payload.message ?? "The token could not be mapped.");
        return;
      }
      setError(null);
      setReport(payload.report);
      setCapturedAt(new Date().toISOString());
    } catch {
      if (request !== generation.current) return;
      setReport(null);
      setCapturedAt(undefined);
      setError("The token could not be mapped. Try again.");
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <form aria-label="Venue timeline" onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="venue-contract">Token contract</label>
        <input id="venue-contract" value={contract} onChange={(event) => setContract(event.target.value)} />
        <button type="submit">Map venues</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {report ? (
        <article data-testid="venue-report">
          <h2>Current venues</h2>
          <table>
            <tbody>
              {report.venues.map((venue) => (
                <tr key={venue.venue}><td>{venue.venue}</td><td>{venue.state}</td><td>{venue.source}</td></tr>
              ))}
            </tbody>
          </table>
          <h2>Status timeline</h2>
          <ol>
            {report.timeline.map((item) => (
              <li key={`${item.venue}-${item.observedAt}`}>{item.venue} {item.from ?? "none"} to {item.to} at {item.observedAt}</li>
            ))}
          </ol>
          <p data-testid="coverage-notice">{report.coverage}</p>
        </article>
      ) : (
        <p data-testid="venue-idle">Missing venue data is unknown. It is not treated as still listed.</p>
      )}
    </section>
  );
}
