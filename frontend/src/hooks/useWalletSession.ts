"use client";

import { useEffect } from "react";
import { useSignMessage } from "wagmi";
import { discardStaleSession, enqueueChallenge, getSessionEpoch } from "@/lib/wallet/sessionRevocation";
import { useWalletSessionContext } from "@/providers/WalletSessionProvider";

type Family = "evm" | "stellar";

type ChallengePayload = {
  nonce: string;
  family: Family;
  walletAddress: string;
  issuedAt: string;
  expiresAt: string;
  network: string | null;
  challenge?: string;
  challengeXdr?: string;
};

/** Re-challenge shortly before the server's 12 hour session expires. */
const SESSION_REFRESH_MS = 11 * 60 * 60 * 1000;

// The session cookie is shared by the whole tab, so this state is too: several
// mounted consumers must not each prompt for a signature.
let syncedSession: { key: string; at: number } | null = null;
let inflightKey: string | null = null;

function isSynced(key: string) {
  return syncedSession?.key === key && Date.now() - syncedSession.at < SESSION_REFRESH_MS;
}

export function useWalletSession() {
  const session = useWalletSessionContext();
  const signMessageAsync = useSignMessage().signMessageAsync;
  const address = session.isConnected ? session.address : undefined;
  const family = session.isConnected ? session.family : null;
  const network =
    family === "stellar"
      ? session.stellar.network === "stellar-pubnet"
        ? "Public Global Stellar Network ; September 2015"
        : "Test SDF Network ; September 2015"
      : session.chainId?.toString() ?? "";

  const signStellarTransaction = session.stellar.signTransaction;

  useEffect(() => {
    if (!address || !family) return;

    const epoch = getSessionEpoch();
    const identity = family === "evm" ? address.toLowerCase() : address;
    const key = [epoch, family, identity, family === "stellar" ? network : ""].join("|");
    if (isSynced(key) || inflightKey === key) return;
    inflightKey = key;

    const isCurrent = () => getSessionEpoch() === epoch;

    enqueueChallenge(async () => {
      if (!isCurrent() || isSynced(key)) return;
      const claimed = await runChallenge(address, family, network, signMessageAsync, signStellarTransaction, isCurrent);
      if (claimed) syncedSession = { key, at: Date.now() };
    })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("wallet session challenge failed", err);
        }
      })
      .finally(() => {
        if (inflightKey === key) inflightKey = null;
      });
  }, [address, family, network, signMessageAsync, signStellarTransaction]);

  return {
    ...session,
    walletCapabilities: session.family === "stellar" ? session.stellar.capabilities : null,
    networkStatus: session.family === "stellar" ? session.stellar.networkStatus : null,
    sessionNotice: session.family === "stellar" ? session.stellar.sessionNotice : null,
  } as const;
}

async function runChallenge(
  walletAddress: string,
  family: Family,
  network: string,
  signMessageAsync: (input: { message: string }) => Promise<string>,
  stellarSignTransaction: (xdr: string) => Promise<string>,
  isCurrent: () => boolean,
): Promise<boolean> {
  const nonceResponse = await fetch("/api/wallet-session/nonce", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, family, network: network || undefined }),
  });
  if (!nonceResponse.ok) {
    throw new Error(`challenge_issue_failed:${nonceResponse.status}`);
  }
  const challenge = (await nonceResponse.json()) as ChallengePayload;

  // The wallet may have been switched or disconnected while awaiting.
  if (!isCurrent()) return false;

  let signature: string | undefined;
  let signedTxXdr: string | undefined;

  if (family === "evm") {
    if (!challenge.challenge) throw new Error("evm_challenge_missing");
    signature = await signMessageAsync({ message: challenge.challenge });
  } else {
    if (!challenge.challengeXdr) throw new Error("stellar_challenge_missing");
    signedTxXdr = await stellarSignTransaction(challenge.challengeXdr);
  }

  if (!isCurrent()) return false;

  const claimResponse = await fetch("/api/wallet-session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress,
      family,
      nonce: challenge.nonce,
      signature,
      signedTxXdr,
      network: network || undefined,
    }),
  });
  if (!claimResponse.ok) {
    const detail = await claimResponse.text().catch(() => "");
    throw new Error(`claim_rejected:${claimResponse.status}:${detail}`);
  }
  if (!isCurrent()) {
    await discardStaleSession();
    return false;
  }
  return true;
}
