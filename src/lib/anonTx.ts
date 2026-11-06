// The AnonAI transaction: [only_verify (SharedAccount), pre_verify (paymaster), pay (paymaster), body], in zk or key mode.
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { arbitrarySignature, assemble, preVerifyFrame, senderFrame, sign, verifyFrame, type FrameTx, type RecentRootReference } from "./frameTx.js";
import { policyClassOf, type Policy, type ProofBundle } from "./semaphore.js";

export const MODE_ZK = 1n;
export const MODE_KEY = 2n;

/** Frame gas limits; measured on the devnet before the demo (docs/SPEC.md 8.3). */
export const LIMITS = {
  verifyZk: 600_000n,
  verifyKey: 250_000n,
  preVerify: 150_000n,
  preVerifyState: 100_000n, // the charge receipt is a new storage slot: state gas on this devnet
  pay: 150_000n,
  body: 120_000n,
  bodyState: 200_000n,
};

export interface Action {
  target: Address;
  value: bigint;
  data: Hex;
}

const POLICY_COMPONENTS = [
  { name: "target", type: "address" },
  { name: "selector", type: "bytes4" },
  { name: "maxValue", type: "uint256" },
  { name: "maxAmount", type: "uint256" },
] as const;

const ZK_AUTH = [
  {
    type: "tuple",
    components: [
      { name: "policy", type: "tuple", components: POLICY_COMPONENTS },
      { name: "merkleTreeDepth", type: "uint256" },
      { name: "merkleTreeRoot", type: "uint256" },
      { name: "nullifier", type: "uint256" },
      { name: "scope", type: "uint256" },
      { name: "points", type: "uint256[8]" },
    ],
  },
] as const;

const KEY_AUTH = [{ type: "tuple", components: [{ name: "policy", type: "tuple", components: POLICY_COMPONENTS }] }] as const;

const MODE_ENVELOPE = [{ type: "uint256" }, { type: "bytes" }] as const;

/** Frame-0 data for zk mode: abi.encode(1, abi.encode(ZkAuth)). */
export function encodeZkAuth(policy: Policy, proof: ProofBundle): Hex {
  const auth = encodeAbiParameters(ZK_AUTH, [
    { policy, merkleTreeDepth: BigInt(proof.merkleTreeDepth), merkleTreeRoot: proof.merkleTreeRoot, nullifier: proof.nullifier, scope: proof.scope, points: proof.points },
  ]);
  return encodeAbiParameters(MODE_ENVELOPE, [MODE_ZK, auth]);
}

/** Frame-0 data for key mode: abi.encode(2, abi.encode(KeyAuth)). */
export function encodeKeyAuth(policy: Policy): Hex {
  return encodeAbiParameters(MODE_ENVELOPE, [MODE_KEY, encodeAbiParameters(KEY_AUTH, [{ policy }])]);
}

/** The four frames shared by both modes. */
function frames(a: { account: Address; paymaster: Address; policy: Policy; auth: Hex; verifyLimit: bigint; action: Action }) {
  return [
    verifyFrame("EXECUTION", null, a.verifyLimit, { data: a.auth }),
    preVerifyFrame(a.paymaster, LIMITS.preVerify, { data: policyClassOf(a.policy), state: LIMITS.preVerifyState }),
    verifyFrame("PAYMENT", a.paymaster, LIMITS.pay),
    senderFrame(a.action.target, LIMITS.body, { value: a.action.value, data: a.action.data, state: LIMITS.bodyState }),
  ];
}

/** zk mode: ARBITRARY signature, nonce key = nullifier, the root declared as an EIP-8272 reference. */
export function buildZkTx(a: {
  account: Address; paymaster: Address; policy: Policy; proof: ProofBundle; action: Action; recentRoot: RecentRootReference;
}): FrameTx {
  return assemble({
    sender: a.account,
    nonceKeys: [a.proof.nullifier],
    nonceSeq: 0n,
    signatures: [arbitrarySignature()],
    recentRootReferences: [a.recentRoot],
    frames: frames({ ...a, auth: encodeZkAuth(a.policy, a.proof), verifyLimit: LIMITS.verifyZk }),
  });
}

/** key mode: SECP256K1 signature by a one-time key, nonce key = that key's address. Returns the signed tx. */
export async function buildKeyTx(a: {
  account: Address; paymaster: Address; policy: Policy; oneTimeKey: Hex; oneTimeAddress: Address; action: Action;
}): Promise<FrameTx> {
  const tx = assemble({
    sender: a.account,
    nonceKeys: [BigInt(a.oneTimeAddress)],
    nonceSeq: 0n,
    signer: a.oneTimeAddress,
    frames: frames({ ...a, auth: encodeKeyAuth(a.policy), verifyLimit: LIMITS.verifyKey }),
  });
  return sign(tx, a.oneTimeKey);
}
