// Reads and owner-side writes against the Keystore contract.
import { encodeFunctionData, type Address, type Hex } from "viem";
import { blockSlot, publicClient, sendLegacy, waitMined } from "./chain.js";
import type { RecentRootReference } from "./frameTx.js";

export const KEYSTORE_ABI = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "policyClass", type: "bytes32" }, { name: "commitments", type: "uint256[]" }], outputs: [] },
  { type: "function", name: "revoke", stateMutability: "nonpayable", inputs: [{ name: "policyClass", type: "bytes32" }, { name: "commitment", type: "uint256" }, { name: "siblings", type: "uint256[]" }], outputs: [] },
  { type: "function", name: "heartbeat", stateMutability: "nonpayable", inputs: [{ name: "policyClass", type: "bytes32" }], outputs: [] },
  { type: "function", name: "members", stateMutability: "view", inputs: [{ name: "policyClass", type: "bytes32" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "rootInfo", stateMutability: "view", inputs: [{ name: "policyClass", type: "bytes32" }, { name: "root", type: "uint256" }], outputs: [{ name: "seq", type: "uint64" }, { name: "generation", type: "uint32" }] },
  { type: "function", name: "generation", stateMutability: "view", inputs: [{ name: "policyClass", type: "bytes32" }], outputs: [{ type: "uint32" }] },
  { type: "function", name: "rootSeq", stateMutability: "view", inputs: [{ name: "policyClass", type: "bytes32" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "root", stateMutability: "view", inputs: [{ name: "policyClass", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isMember", stateMutability: "view", inputs: [{ name: "policyClass", type: "bytes32" }, { name: "leaf", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "sourceId", stateMutability: "view", inputs: [{ name: "policyClass", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "lastCommitBlock", stateMutability: "view", inputs: [{ name: "policyClass", type: "bytes32" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "epochBlocks", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "event", name: "RootCommitted", inputs: [{ name: "policyClass", type: "bytes32", indexed: true }, { name: "seq", type: "uint64", indexed: false }, { name: "generation", type: "uint32", indexed: false }, { name: "root", type: "uint256", indexed: false }] },
] as const;

export class KeystoreClient {
  constructor(readonly address: Address) {}

  private read<T>(functionName: string, args: unknown[] = []): Promise<T> {
    return publicClient().readContract({ address: this.address, abi: KEYSTORE_ABI, functionName: functionName as any, args: args as any }) as Promise<T>;
  }

  members = (policyClass: Hex) => this.read<readonly bigint[]>("members", [policyClass]).then((m) => [...m]);
  rootInfo = (policyClass: Hex, root: bigint) => this.read<readonly [bigint, number]>("rootInfo", [policyClass, root]).then(([seq, generation]) => ({ seq: BigInt(seq), generation: Number(generation) }));
  generation = (policyClass: Hex) => this.read<number>("generation", [policyClass]);
  rootSeq = (policyClass: Hex) => this.read<bigint>("rootSeq", [policyClass]);
  root = (policyClass: Hex) => this.read<bigint>("root", [policyClass]);
  isMember = (policyClass: Hex, leaf: bigint) => this.read<boolean>("isMember", [policyClass, leaf]);
  sourceId = (policyClass: Hex) => this.read<Hex>("sourceId", [policyClass]);
  lastCommitBlock = (policyClass: Hex) => this.read<bigint>("lastCommitBlock", [policyClass]);
  epochBlocks = () => this.read<bigint>("epochBlocks");

  /** Sends an owner-side call and returns the EIP-8272 reference of the root it committed (slot from the receipt's block). */
  private async commitCall(ownerKey: Hex, data: Hex, policyClass: Hex): Promise<{ txHash: Hex; recentRoot: RecentRootReference; seq: bigint }> {
    const txHash = await sendLegacy(ownerKey, this.address, data, 0n); // gas estimated: Poseidon inserts + state gas vary
    const receipt = await waitMined(txHash);
    const slot = await blockSlot(receipt.blockNumber);
    const root = await this.root(policyClass);
    const { seq } = await this.rootInfo(policyClass, root);
    return { txHash, seq, recentRoot: { sourceId: await this.sourceId(policyClass), slot, root: `0x${root.toString(16).padStart(64, "0")}` as Hex } };
  }

  register = (ownerKey: Hex, policyClass: Hex, leaves: bigint[]) =>
    this.commitCall(ownerKey, encodeFunctionData({ abi: KEYSTORE_ABI, functionName: "register", args: [policyClass, leaves] }), policyClass);

  revoke = (ownerKey: Hex, policyClass: Hex, leaf: bigint, siblings: bigint[]) =>
    this.commitCall(ownerKey, encodeFunctionData({ abi: KEYSTORE_ABI, functionName: "revoke", args: [policyClass, leaf, siblings] }), policyClass);

  heartbeat = (ownerKey: Hex, policyClass: Hex) =>
    this.commitCall(ownerKey, encodeFunctionData({ abi: KEYSTORE_ABI, functionName: "heartbeat", args: [policyClass] }), policyClass);

  /** The current root's EIP-8272 reference, for building a transaction without a fresh commit. Needs the slot the
   *  root was committed in: looked up from the latest RootCommitted event of the class. */
  async currentReference(policyClass: Hex, fromBlock = 0n): Promise<{ recentRoot: RecentRootReference; seq: bigint; generation: number }> {
    const root = await this.root(policyClass);
    const info = await this.rootInfo(policyClass, root);
    const logs = await publicClient().getContractEvents({ address: this.address, abi: KEYSTORE_ABI, eventName: "RootCommitted", args: { policyClass }, fromBlock, toBlock: "latest" });
    const last = logs.at(-1);
    if (!last) throw new Error("no RootCommitted event for this class");
    const slot = await blockSlot(`0x${last.blockNumber.toString(16)}`);
    return { seq: info.seq, generation: info.generation, recentRoot: { sourceId: await this.sourceId(policyClass), slot, root: `0x${root.toString(16).padStart(64, "0")}` as Hex } };
  }
}
