// The devnet's NaiveStakingRegistry: reading an entity's stake and staking a contract entity from itself.
import { encodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient, waitMined } from "./chain.js";
import { loadConfig } from "./config.js";
import { assemble, sendToAltMempool, senderFrame, sign, verifyFrame } from "./frameTx.js";
import { rpc } from "./rpc.js";

const REGISTRY_ABI = [
  { type: "function", name: "getDepositInfo", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }, { type: "uint32" }, { type: "uint64" }] },
  { type: "function", name: "addStake", stateMutability: "payable", inputs: [{ type: "uint32" }], outputs: [] },
] as const;

export interface StakeInfo {
  amount: bigint;
  unstakeDelay: number;
  withdrawTime: number;
}

export async function getStake(entity: Address): Promise<StakeInfo> {
  try {
    const [amount, delay, withdrawTime] = (await publicClient().readContract({
      address: loadConfig().stakingRegistry, abi: REGISTRY_ABI, functionName: "getDepositInfo", args: [entity],
    })) as readonly [bigint, number, bigint];
    return { amount, unstakeDelay: Number(delay), withdrawTime: Number(withdrawTime) };
  } catch {
    return { amount: 0n, unstakeDelay: 0, withdrawTime: 0 }; // empty return data = never staked
  }
}

/** A contract account's protocol nonce (1 + one per contract it created; HegotaSupport contracts start at 8). */
export const accountNonce = async (a: Address): Promise<bigint> => BigInt(await rpc<Hex>(loadConfig().ethrexUrl, "eth_getTransactionCount", [a, "latest"]));

/**
 * Stakes `entity` (a SharedAccount or BudgetPaymaster) from itself: a self-relay frame transaction whose VERIFY
 * frame takes the contract's 1-byte admin path (checked against the admin's SECP256K1 signature) and whose SENDER
 * frame calls the registry's addStake with the stake as value. The entity pays its own gas from its creation value.
 */
export async function stakeEntity(adminKey: Hex, entity: Address): Promise<Hex> {
  const cfg = loadConfig();
  const admin = privateKeyToAccount(adminKey).address;
  const tx = assemble({
    sender: entity,
    nonceSeq: await accountNonce(entity),
    signer: admin,
    frames: [
      verifyFrame("EXECUTION_AND_PAYMENT", null, 80_000n, { data: "0x01" }),
      senderFrame(cfg.stakingRegistry, 150_000n, {
        value: cfg.stakeWei,
        state: 300_000n,
        data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "addStake", args: [cfg.unstakeDelaySec] }),
      }),
    ],
  });
  const hash = await sendToAltMempool(await sign(tx, adminKey));
  const r = await waitMined(hash);
  if (r.status !== "0x1") throw new Error(`stake tx ${hash} reverted`);
  return hash;
}
