"use client";

import dynamic from "next/dynamic";
import type { AgentPoint, AgentScoreTrendCardCanvasProps } from "./charts/AgentScoreTrendCardCanvas";

export type AgentScoreTrendCardProps = {
  agent: string;
  displayName: string;
  scoreKind: string;
  points: AgentPoint[];
};

export type { AgentPoint };

const LazyAgentScoreTrendCardCanvas = dynamic(
  () => import("./charts/AgentScoreTrendCardCanvas").then((module) => module.AgentScoreTrendCardCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/42" role="status" aria-live="polite">
        Loading score trend...
      </div>
    ),
  },
);

export function AgentScoreTrendCard(props: AgentScoreTrendCardProps) {
  const canvasProps: AgentScoreTrendCardCanvasProps = {
    displayName: props.displayName,
    scoreKind: props.scoreKind,
    points: props.points,
  };
  return <LazyAgentScoreTrendCardCanvas {...canvasProps} />;
}
