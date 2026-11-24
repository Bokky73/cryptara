import { webcrypto } from "node:crypto";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SigningVerificationError } from "@/lib/signing/previewVerification";
import { useEvmSigning, useStellarSigning } from "@/hooks/useSigning";
import {
  ATTACKER_CONTRACT,
  EVM_CONTRACT,
  EVM_WALLET,
  STELLAR_NETWORK,
  STELLAR_SOURCE,
  TAMPERED_EVM_DATA,
  createEvmFixture,
  createStellarFixture,
} from "./fixtures";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const mocks = vi.hoisted(() => ({
  evmAddress: "" as string,
  evmSignTransaction: vi.fn(),
  stellarAddress: "" as string,
  stellarSignTransaction: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.evmAddress, chainId: 48816 }),
  useWalletClient: () => ({
    data: {
      account: mocks.evmAddress,
      signTransaction: mocks.evmSignTransaction,
    },
  }),
}));

vi.mock("@/providers/StellarWalletProvider", () => ({
  useStellarWallet: () => ({
    address: mocks.stellarAddress,
    network: STELLAR_NETWORK,
    isConnected: true,
    signTransaction: mocks.stellarSignTransaction,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.evmAddress = EVM_WALLET;
  mocks.stellarAddress = STELLAR_SOURCE;
  mocks.evmSignTransaction.mockResolvedValue("0xsigned");
  mocks.stellarSignTransaction.mockResolvedValue("signed-xdr");
});

describe("useEvmSigning.signPreparedTransaction", () => {
  it("signs only when the prepared calldata matches the preview and simulation digest", async () => {
    const { preview, payload } = await createEvmFixture();
    const { result } = hookForEvm();

    const signed = await result.current.signPreparedTransaction(payload, preview);

    expect(signed).toBe("0xsigned");
    expect(mocks.evmSignTransaction).toHaveBeenCalledTimes(1);
  });

  it("aborts before the wallet prompt when the recipient is tampered with", async () => {
    const { preview, payload } = await createEvmFixture();
    const tampered = { ...payload, to: ATTACKER_CONTRACT };
    const { result } = hookForEvm();

    await expect(result.current.signPreparedTransaction(tampered, preview)).rejects.toBeInstanceOf(SigningVerificationError);
    expect(mocks.evmSignTransaction).not.toHaveBeenCalled();
  });

  it("aborts before the wallet prompt when the calldata hash no longer matches the simulation", async () => {
    const { preview, payload } = await createEvmFixture();
    const tampered = { ...payload, data: TAMPERED_EVM_DATA };
    const { result } = hookForEvm();

    await expect(result.current.signPreparedTransaction(tampered, preview)).rejects.toMatchObject({
      name: "SigningVerificationError",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "simulation_hash_mismatch", refreshRequired: true }),
      ]),
    });
    expect(mocks.evmSignTransaction).not.toHaveBeenCalled();
  });

  it("aborts when the quote attached to the preview has expired", async () => {
    const { preview, payload } = await createEvmFixture();
    const expiredPreview = {
      ...preview,
      quote: {
        ...preview.quote!,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    };
    const { result } = hookForEvm();

    await expect(result.current.signPreparedTransaction(payload, expiredPreview)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "quote_expired", refreshRequired: true }),
      ]),
    });
    expect(mocks.evmSignTransaction).not.toHaveBeenCalled();
  });

  it("uses the reviewed EVM contract rather than a stale preview target", async () => {
    const { preview, payload } = await createEvmFixture();
    const { result } = hookForEvm();

    // Sanity check that the fixed fixture is internally consistent.
    expect(payload.to).toBe(EVM_CONTRACT);
    await expect(result.current.signPreparedTransaction(payload, preview)).resolves.toBe("0xsigned");
  });
});

describe("useStellarSigning.signPreparedTransaction", () => {
  it("decodes the XDR and signs a matching prepared envelope", async () => {
    const { preview, payload } = await createStellarFixture();
    const { result } = hookForStellar();

    const signed = await result.current.signPreparedTransaction(payload, preview);

    expect(signed.signedXdr).toBe("signed-xdr");
    expect(mocks.stellarSignTransaction).toHaveBeenCalledTimes(1);
  });

  it("aborts before the wallet prompt when the prepared passphrase is wrong", async () => {
    const { preview, payload } = await createStellarFixture();
    const tampered = {
      ...payload,
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    };
    const { result } = hookForStellar();

    await expect(result.current.signPreparedTransaction(tampered, preview)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "passphrase_mismatch", refreshRequired: true }),
      ]),
    });
    expect(mocks.stellarSignTransaction).not.toHaveBeenCalled();
  });

  it("aborts before the wallet prompt when the prepared XDR has a different source", async () => {
    const { preview, payload } = await createStellarFixture();
    const other = await createStellarFixtureWithDifferentSource();
    const tampered = { ...payload, xdr: other.xdr };
    const { result } = hookForStellar();

    await expect(result.current.signPreparedTransaction(tampered, preview)).rejects.toBeInstanceOf(SigningVerificationError);
    expect(mocks.stellarSignTransaction).not.toHaveBeenCalled();
  });

  it("aborts when the displayed operation count does not match the XDR", async () => {
    const { preview, payload } = await createStellarFixture();
    const tampered = {
      ...payload,
      operations: [...payload.operations, { ...payload.operations[0] }],
    };
    const { result } = hookForStellar();

    await expect(result.current.signPreparedTransaction(tampered, preview)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "operation_count_mismatch", refreshRequired: true }),
      ]),
    });
    expect(mocks.stellarSignTransaction).not.toHaveBeenCalled();
  });
});

function hookForEvm() {
  return renderHook(() => useEvmSigning());
}

function hookForStellar() {
  return renderHook(() => useStellarSigning());
}

async function createStellarFixtureWithDifferentSource() {
  const { Keypair, Account, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = await import("@stellar/stellar-sdk");
  const other = Keypair.random().publicKey();
  const transaction = new TransactionBuilder(new Account(other, "38373288"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: other, asset: Asset.native(), amount: "10" }))
    .setTimeout(600)
    .build();

  return { xdr: transaction.toXDR() };
}
