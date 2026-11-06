// Semaphore v4 identities, groups and proofs, with AnonAI's binding of message and scope.
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/** Fixed proof depth: constant verifier gas, up to 1024 members per policy class. */
export const MERKLE_DEPTH = 10;

export interface Policy {
  target: Address;
  selector: Hex; // bytes4, 0x00000000 = any
  maxValue: bigint;
  maxAmount: bigint; // 2^256-1 = no cap
}

export const MAX_UINT256 = (1n << 256n) - 1n;

const POLICY_ABI = [
  {
    type: "tuple",
    components: [
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "maxValue", type: "uint256" },
      { name: "maxAmount", type: "uint256" },
    ],
  },
] as const;

/** keccak256(abi.encode(policy)), as SharedAccount.policyClassOf computes it. */
export const policyClassOf = (p: Policy): Hex => keccak256(encodeAbiParameters(POLICY_ABI, [p]));

export const ACTION_DOMAIN = keccak256(new TextEncoder().encode("AnonAI.action.v1"));

/** The Semaphore message bound to one action, as SharedAccount.computeMessage computes it. */
export function actionMessage(a: { chainId: bigint; account: Address; policyClass: Hex; target: Address; value: bigint; data: Hex }): bigint {
  const h = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [ACTION_DOMAIN, a.chainId, a.account, a.policyClass, a.target, a.value, keccak256(a.data)],
    ),
  );
  return BigInt(h) >> 8n;
}

export const identityFromSecret = (secret: string): Identity => new Identity(secret);
export const commitmentOf = (secret: string): bigint => new Identity(secret).commitment;

/** The group as the Keystore holds it: leaves in insertion order, 0 for revoked ones (kept as zero leaves). */
export const groupFromMembers = (members: bigint[]): Group => new Group(members);

/** Merkle siblings of a member, as Keystore.revoke needs them. */
export function siblingsOf(members: bigint[], commitment: bigint): bigint[] {
  const g = groupFromMembers(members);
  const i = g.indexOf(commitment);
  if (i < 0) throw new Error("commitment is not a member");
  return g.generateMerkleProof(i).siblings;
}

export interface ProofBundle {
  merkleTreeDepth: number;
  merkleTreeRoot: bigint;
  nullifier: bigint;
  message: bigint;
  scope: bigint;
  points: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
}

const toBundle = (p: SemaphoreProof): ProofBundle => ({
  merkleTreeDepth: Number(p.merkleTreeDepth),
  merkleTreeRoot: BigInt(p.merkleTreeRoot),
  nullifier: BigInt(p.nullifier),
  message: BigInt(p.message),
  scope: BigInt(p.scope),
  points: p.points.map((x) => BigInt(x)) as ProofBundle["points"],
});

/**
 * Proves membership of `secret`'s identity in `members`, bound to `message` (the action) and `scope` (the root's
 * epoch, i.e. the Keystore commit sequence number). Semaphore hashes message and scope (keccak >> 8) itself; the
 * SharedAccount applies the same hash on chain. First call downloads the depth-10 snark artifacts unless
 * `artifacts` points at local wasm/zkey files.
 */
export async function proveMembership(a: {
  secret: string;
  members: bigint[];
  message: bigint;
  scope: bigint;
  artifacts?: { wasm: string; zkey: string };
}): Promise<ProofBundle> {
  const identity = identityFromSecret(a.secret);
  const group = groupFromMembers(a.members);
  const proof = await generateProof(identity, group, a.message, a.scope, MERKLE_DEPTH, a.artifacts);
  return toBundle(proof);
}

export const checkProofOffchain = (p: ProofBundle): Promise<boolean> =>
  verifyProof({
    merkleTreeDepth: p.merkleTreeDepth,
    merkleTreeRoot: p.merkleTreeRoot.toString(),
    nullifier: p.nullifier.toString(),
    message: p.message.toString(),
    scope: p.scope.toString(),
    points: p.points.map((x) => x.toString()) as SemaphoreProof["points"],
  });
