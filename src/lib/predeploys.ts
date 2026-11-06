// EIP-8250 NONCE_MANAGER and EIP-8272 RECENT_ROOT_ADDRESS: the hashes the protocol uses to find things in them.
import { concat, keccak256, numberToHex, pad, toBytes, type Address, type Hex } from "viem";
import type { RecentRootReference } from "@forshtat/hegota-support/tx";

/** The predeploy keeps a ring of this many slots per source. */
export const RECENT_ROOT_LENGTH = 8192n;
/** A reference is usable while 1 <= head_slot + 1 - slot <= 8191. */
export const RECENT_ROOT_WINDOW = 8191n;

/** NONCE_MANAGER slot holding the next nonce_seq of (sender, key). */
export const keyedNonceSlot = (sender: Address, key: bigint): Hex => keccak256(concat([pad(sender, { size: 32 }), numberToHex(key, { size: 32 })]));

/** A root source is the committing caller plus the salt it chose. */
export const recentRootSourceId = (caller: Address, salt: Hex): Hex => keccak256(concat([caller, salt]));

const domain = (name: string): Hex => keccak256(toBytes(name));
const u64 = (n: bigint): Hex => numberToHex(n, { size: 8 });

/** What the predeploy stores for a committed root: a hash over the raw slot, so a wrapped-around entry cannot satisfy an old reference. */
export const recentRootEntryHash = (r: RecentRootReference): Hex => keccak256(concat([domain("RECENT_ROOT_ENTRY"), r.sourceId, u64(r.slot), r.root]));

/** The predeploy storage key of a reference: the slot modulo the ring length, under the source. */
export const recentRootStorageKey = (r: Pick<RecentRootReference, "sourceId" | "slot">): Hex =>
  keccak256(concat([domain("RECENT_ROOT_STORAGE"), r.sourceId, u64(r.slot % RECENT_ROOT_LENGTH)]));
