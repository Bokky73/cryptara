import type { FormEvent } from "react";
import type { AllowancePair } from "@/server/research/allowance-inventory/schema";

type Props = {
  network: string;
  fromBlock: string;
  toBlock: string;
  token: string;
  spender: string;
  pairs: AllowancePair[];
  busy: boolean;
  onNetwork: (value: string) => void;
  onFromBlock: (value: string) => void;
  onToBlock: (value: string) => void;
  onToken: (value: string) => void;
  onSpender: (value: string) => void;
  onAddPair: () => void;
  onRemovePair: (index: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export const ALLOWANCE_NETWORKS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "goat"];
const inputClass = "h-11 w-full rounded-xl border border-white/15 bg-black/25 px-3 text-sm text-white outline-none focus:border-[#d9a441]";

export function ScanRangeForm(props: Props) {
  return (
    <form onSubmit={props.onSubmit} className="glass-panel space-y-4 rounded-2xl border border-white/10 p-5">
      <div>
        <h2 className="text-lg font-semibold">Discovery range</h2>
        <p className="mt-1 text-sm text-white/50">Approval logs discover candidates only. Current allowances are read separately at one snapshot block.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-white/60">Network
          <select value={props.network} onChange={(event) => props.onNetwork(event.target.value)} className={inputClass}>
            {ALLOWANCE_NETWORKS.map((network) => <option key={network} value={network}>{network}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-white/60">From block
          <input required inputMode="numeric" pattern="[0-9]+" value={props.fromBlock} onChange={(event) => props.onFromBlock(event.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1 text-xs text-white/60">To block
          <input required inputMode="numeric" pattern="[0-9]+" value={props.toBlock} onChange={(event) => props.onToBlock(event.target.value)} className={inputClass} />
        </label>
      </div>
      <fieldset className="space-y-3 rounded-xl border border-white/10 p-4">
        <legend className="px-2 text-xs uppercase tracking-[0.15em] text-white/45">Optional known pair</legend>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1 text-xs text-white/60">Token address
            <input placeholder="0x…" value={props.token} onChange={(event) => props.onToken(event.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-xs text-white/60">Spender address
            <input placeholder="0x…" value={props.spender} onChange={(event) => props.onSpender(event.target.value)} className={inputClass} />
          </label>
          <button type="button" onClick={props.onAddPair} className="self-end rounded-xl border border-white/15 px-4 py-3 text-sm hover:bg-white/8">Add pair</button>
        </div>
        {props.pairs.length > 0 ? (
          <ul className="space-y-2 text-xs text-white/55">
            {props.pairs.map((pair, index) => (
              <li key={`${pair.token}:${pair.spender}`} className="flex items-center justify-between gap-3 rounded-lg bg-black/20 p-2">
                <span className="min-w-0 truncate font-mono">{pair.token} → {pair.spender}</span>
                <button type="button" onClick={() => props.onRemovePair(index)} className="shrink-0 text-red-200">Remove</button>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>
      <button disabled={props.busy} className="rounded-full bg-[#d9a441] px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-60">
        {props.busy ? "Reading snapshot…" : "Build read-only inventory"}
      </button>
    </form>
  );
}
