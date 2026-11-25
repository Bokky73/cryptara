"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Orbit, Wallet } from "lucide-react";
import { useWalletSession } from "@/hooks/useWalletSession";
import { shortenWalletAddress } from "@/lib/wallet/session";

const LazyWalletSessionDialog = dynamic(
  () => import("./wallet/WalletSessionDialog").then((module) => module.WalletSessionDialog),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-x-4 top-20 z-50 rounded-3xl border border-white/15 bg-[#111116] p-5 text-xs text-white/50" role="status" aria-live="polite">
        Opening wallet selector...
      </div>
    ),
  },
);

export function WalletConnectButton() {
  const session = useWalletSession();
  const [isOpen, setIsOpen] = useState(false);
  const hasSession = session.isConnected || session.isRestored;

  useEffect(() => {
    if (!isOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  const buttonLabel = hasSession
    ? shortenWalletAddress(session.address)
    : session.isConnecting
      ? "Connecting..."
      : "Connect Wallet";

  return (
    <div className="relative">
      <ConnectButton.Custom>
        {({ account, chain, openAccountModal, openChainModal, openConnectModal }) => (
          <>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              onClick={() => setIsOpen((value) => !value)}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition sm:px-5 ${
                hasSession
                  ? "border border-white/10 bg-white/8 text-white hover:bg-white/12"
                  : "bg-[#d9a441] text-black hover:bg-[#f2c86d]"
              }`}
            >
              {session.family === "stellar" ? (
                <Orbit className="h-4 w-4 text-[#a99aff]" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              <span className="max-w-28 truncate">{buttonLabel}</span>
            </button>

            {isOpen ? (
              <LazyWalletSessionDialog
                session={session}
                account={account}
                chain={chain}
                openAccountModal={openAccountModal}
                openChainModal={openChainModal}
                openConnectModal={openConnectModal}
                onClose={() => setIsOpen(false)}
              />
            ) : null}
          </>
        )}
      </ConnectButton.Custom>
    </div>
  );
}
