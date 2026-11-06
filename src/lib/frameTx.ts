// Frame transaction building, signing and submission, bound to the devnet profile of @forshtat/hegota-support.
import type { Address, Hex } from "viem";
import { getProfile } from "@forshtat/hegota-support/profiles";
import * as lib from "@forshtat/hegota-support/tx";
import { toWire, explainRejection } from "@forshtat/hegota-support/rpc";
import type { Frame, FrameTx, RecentRootReference } from "@forshtat/hegota-support/tx";
import { loadConfig } from "./config.js";
import { rpc } from "./rpc.js";

export type { Frame, FrameTx, RecentRootReference };
export { toWire, explainRejection };

export const profile = getProfile("ethrex-eip8141-tracer");

type FrameOpts = { value?: bigint; data?: Hex; state?: bigint };

/** A VERIFY frame. `scope` is what it may approve; `null` target = tx.sender. */
export const verifyFrame = (scope: "EXECUTION" | "PAYMENT" | "EXECUTION_AND_PAYMENT", target: Address | null, execution: bigint, o: FrameOpts = {}): Frame =>
  lib.frame(profile, "VERIFY", { scope, target, execution, ...o });
/** A pre_verify frame (ERC-8421): DEFAULT mode, may write state, must immediately precede the approving frame of the same target. */
export const preVerifyFrame = (target: Address, execution: bigint, o: FrameOpts = {}): Frame =>
  lib.frame(profile, "DEFAULT", { target, execution, ...o });
/** An execution-body frame run as tx.sender. */
export const senderFrame = (target: Address, execution: bigint, o: FrameOpts = {}): Frame =>
  lib.frame(profile, "SENDER", { target, execution, ...o });

/** Assembles a transaction with one secp256k1 signature entry (filled by `sign`) for `signer`. */
export function assemble(a: {
  sender: Address; nonceSeq: bigint; nonceKeys?: bigint[]; frames: Frame[]; signer?: Address;
  recentRootReferences?: RecentRootReference[]; maxFeePerGas?: bigint;
}): FrameTx {
  const cfg = loadConfig();
  const tx = lib.newTx({
    chainId: cfg.chainId, sender: a.sender, nonceSeq: a.nonceSeq, nonceKeys: a.nonceKeys, frames: a.frames,
    signatures: [lib.secp256k1Placeholder(profile, a.signer)],
    fees: { maxFeePerGas: a.maxFeePerGas ?? cfg.maxFeePerGasWei },
  });
  return a.recentRootReferences ? { ...tx, recentRootReferences: a.recentRootReferences } : tx;
}

export const sign = (tx: FrameTx, key: Hex): Promise<FrameTx> => lib.signTx(profile, tx, key);
export const txHash = (tx: FrameTx): Hex => lib.txHash(profile, tx);
/** `0x06 || rlp(payload)`: what eth_sendRawTransaction takes. */
export const encodeRaw = (tx: FrameTx): Hex => lib.encodeTx(profile, tx);

/** Standard alt-mempool: the gateway sidecar validates under ERC-8421 rules and gossips to the builder. */
export const sendToAltMempool = (tx: FrameTx): Promise<Hex> => rpc(loadConfig().gatewayUrl, "eth_sendFrameTransaction", [toWire(tx)]);
/** Canonical mempool: the same bytes to ethrex, which applies EIP-8141's own stricter rules. */
export const sendToCanonical = (tx: FrameTx): Promise<Hex> => rpc(loadConfig().ethrexUrl, "eth_sendRawTransaction", [encodeRaw(tx)]);
export const estimateGas = (tx: FrameTx): Promise<unknown> => rpc(loadConfig().gatewayUrl, "eth_estimateFrameTransactionGas", [toWire(tx)]);

/** Sidecar view of a transaction: New, Pending, Submitted, OnChain, Finalized, Cancelled, Reverted. */
export const mempoolStatus = (hash: Hex): Promise<unknown> => rpc(loadConfig().gatewayUrl, "skandha_frameTransactionStatus", [hash]);
/** Explorer record: rule-by-rule admission report, lifecycle events. In-memory on the node; cleared on restart. */
export const explorerRecord = (hash: Hex): Promise<unknown> => rpc(loadConfig().gatewayUrl, "skandha_explorer_getTransaction", [hash]);
