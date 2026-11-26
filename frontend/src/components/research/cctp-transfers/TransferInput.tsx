"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { FormEvent, useState } from "react";
import type { NetworkMode } from "@/server/research/cctp-transfers/schema";

/**
 * Mirrors the EVM source chains this tool has a configured RPC path for
 * in `domainMap.ts` — kept as a small local list rather than importing
 * that server module here, since it pulls in `@stellar/stellar-sdk` and
 * Node's `Buffer`, neither of which belong in a client bundle. The server
 * route validates the chain independently either way.
 */
const SOURCE_CHAINS = ["Ethereum", "Avalanche", "OP Mainnet", "Arbitrum", "Base", "Polygon PoS"];

export function TransferInput(props: {
  defaultSourceChain?: string;
  defaultNetwork?: NetworkMode;
  busy?: boolean;
  onSubmit: (sourceChain: string, transactionHash: string, network: NetworkMode) => void;
}) {
  const [sourceChain, setSourceChain] = useState(props.defaultSourceChain ?? SOURCE_CHAINS[0]);
  const [transactionHash, setTransactionHash] = useState("");
  const [network, setNetwork] = useInsightParam<NetworkMode>("network", props.defaultNetwork ?? "testnet", ["testnet", "mainnet"]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = transactionHash.trim();
    if (trimmed) props.onSubmit(sourceChain, trimmed, network);
  }

  return (
    <form aria-label="CCTP transfer tracker transfer input" className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5 text-sm sm:w-40">
          <span className="text-muted">Source chain</span>
          <select
            name="sourceChain"
            value={sourceChain}
            onChange={(event) => setSourceChain(event.target.value)}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#d9a441]/60"
          >
            {SOURCE_CHAINS.map((chain) => (
              <option key={chain} value={chain}>
                {chain}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:w-32">
          <span className="text-muted">Network</span>
          <select
            name="network"
            value={network}
            onChange={(event) => setNetwork(event.target.value as NetworkMode)}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#d9a441]/60"
          >
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="text-muted">Source transaction hash</span>
          <input
            name="transactionHash"
            type="text"
            required
            value={transactionHash}
            onChange={(event) => setTransactionHash(event.target.value)}
            placeholder="0x..."
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-mono outline-none focus-visible:ring-2 focus-visible:ring-[#d9a441]/60"
          />
        </label>
        <button
          type="submit"
          disabled={props.busy}
          className="self-start rounded-xl border border-[#d9a441]/40 bg-[#d9a441]/10 px-4 py-2 text-sm font-semibold text-[#f2c86d] outline-none transition hover:bg-[#d9a441]/15 focus-visible:ring-2 focus-visible:ring-[#d9a441]/60 disabled:opacity-50"
        >
          {props.busy ? "Tracking…" : "Track transfer"}
        </button>
      </div>
    </form>
  );
}
