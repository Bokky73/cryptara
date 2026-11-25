"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useCallback, useRef, useState } from "react";
import type { HolderDistributionReport } from "@/server/research/stellar-holders/schema";

export type WorkbenchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; report: HolderDistributionReport }
  | { status: "error"; code: string; message: string };

export function useWorkbenchState(initialAsset: string, initialNetwork: string, endpoint = "/api/insights/stellar-holders") {
  const [asset, setAssetValue] = useInsightParam("asset", initialAsset);
  const [network, setNetworkValue] = useInsightParam<"stellar-testnet" | "stellar-pubnet">(
    "network",
    initialNetwork === "stellar-pubnet" ? "stellar-pubnet" : "stellar-testnet",
    ["stellar-testnet", "stellar-pubnet"],
  );
  const [state, setState] = useState<WorkbenchState>({ status: "idle" });
  const generation = useRef(0);

  function setAsset(value: string) {
    generation.current += 1;
    setAssetValue(value);
    setState({ status: "idle" });
  }

  function setNetwork(value: string) {
    generation.current += 1;
    setNetworkValue(value === "stellar-pubnet" ? "stellar-pubnet" : "stellar-testnet");
    setState({ status: "idle" });
  }

  const analyse = useCallback(() => {
    if (asset.trim().length === 0) {
      setState({ status: "error", code: "invalid_asset", message: "Enter an issued asset as CODE:ISSUER." });
      return;
    }

    generation.current += 1;
    const requestGeneration = generation.current;

    setState({ status: "loading" });

    fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset: asset.trim(), network }),
    })
      .then(async (response) => {
        const body = await response.json();

        if (requestGeneration !== generation.current) return;

        if (!response.ok) {
          setState({
            status: "error",
            code: typeof body?.error === "string" ? body.error : "provider_unavailable",
            message: typeof body?.message === "string" ? body.message : "The holder distribution could not be read.",
          });
          return;
        }

        setState({ status: "ready", report: body.report as HolderDistributionReport });
      })
      .catch(() => {
        if (requestGeneration !== generation.current) return;
        setState({ status: "error", code: "network_error", message: "The holder distribution request could not be completed." });
      });
  }, [asset, endpoint, network]);

  return { asset, setAsset, network, setNetwork, state, analyse };
}
